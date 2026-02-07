import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { assertEquipInvariants } from "./helpers.js";

interface TransactionResult {
  txId: string;
  accepted: boolean;
  stateVersion: number;
  errorCode?: string;
  errorMessage?: string;
}

interface GearInstance {
  gearDefId: string;
  level: number;
  equippedBy?: string | null;
}

interface CharacterState {
  classId: string;
  level: number;
  equipped: Record<string, string>;
}

interface PlayerState {
  characters: Record<string, CharacterState>;
  gear: Record<string, GearInstance>;
}

interface CharacterStats {
  characterId: string;
  classId: string;
  level: number;
  finalStats: Record<string, number>;
}

const ADMIN_KEY = "test-admin-key-swap";
const TEST_API_KEY = "test-key-swap";

describe("EquipGear — swap mode", () => {
  let app: FastifyInstance;
  let version: number;

  function postTx(payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload,
    });
  }

  function getPlayer() {
    return app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
  }

  function getStats(characterId: string) {
    return app.inject({
      method: "GET",
      url: `/instance_001/character/${characterId}/stats`,
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
  }

  beforeAll(async () => {
    // config_minimal.json:
    //   slots: [right_hand, off_hand]
    //   sword_basic: str+3, patterns: [[right_hand]]
    //   greatsword:  str+5 hp+5, patterns: [[right_hand, off_hand]]
    //   versatile_sword: str+4, patterns: [[right_hand], [off_hand]]
    app = createApp({ adminApiKey: ADMIN_KEY });
    await app.ready();

    // Bootstrap actor
    await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      payload: {
        txId: "swap_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "swap_actor",
        apiKey: TEST_API_KEY,
      },
    });

    // Create player
    const pRes = await postTx({
      txId: "swap_player",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "player_1",
    });
    version = pRes.json<TransactionResult>().stateVersion;

    // Create character
    const cRes = await postTx({
      txId: "swap_char",
      type: "CreateCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      classId: "warrior",
    });
    version = cRes.json<TransactionResult>().stateVersion;

    // Create gear pieces
    const gears = [
      { txId: "swap_g1", gearId: "sword_a", gearDefId: "sword_basic" },
      { txId: "swap_g2", gearId: "sword_b", gearDefId: "sword_basic" },
      { txId: "swap_g3", gearId: "gs_1", gearDefId: "greatsword" },
      { txId: "swap_g4", gearId: "vers_1", gearDefId: "versatile_sword" },
    ];
    for (const g of gears) {
      const r = await postTx({
        ...g,
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
      });
      version = r.json<TransactionResult>().stateVersion;
    }

    // Equip sword_a in right_hand (strict, slot is free)
    const eqRes = await postTx({
      txId: "swap_eq_initial",
      type: "EquipGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      gearId: "sword_a",
    });
    version = eqRes.json<TransactionResult>().stateVersion;
  });

  afterAll(async () => {
    await app.close();
  });

  // ---- Strict mode ----

  it("strict: equip over occupied slot fails with SLOT_OCCUPIED", async () => {
    // sword_a is in right_hand; try to equip sword_b (also right_hand) without swap
    const res = await postTx({
      txId: "swap_strict_001",
      type: "EquipGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      gearId: "sword_b",
    });

    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(false);
    expect(body.errorCode).toBe("SLOT_OCCUPIED");
    expect(body.stateVersion).toBe(version);
  });

  it("strict: swap=false is same as omitting swap", async () => {
    const res = await postTx({
      txId: "swap_strict_002",
      type: "EquipGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      gearId: "sword_b",
      swap: false,
    });

    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(false);
    expect(body.errorCode).toBe("SLOT_OCCUPIED");
  });

  // ---- Swap mode: single-slot ----

  it("swap: replaces occupied single-slot gear", async () => {
    // sword_a is in right_hand; swap sword_b into right_hand
    const res = await postTx({
      txId: "swap_do_001",
      type: "EquipGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      gearId: "sword_b",
      swap: true,
    });

    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(true);
    version = body.stateVersion;
  });

  it("swap: old gear is unequipped, new gear is equipped", async () => {
    const res = await getPlayer();
    const player = res.json<PlayerState>();

    // sword_b is now in right_hand
    expect(player.characters.char_1.equipped).toEqual({
      right_hand: "sword_b",
    });
    // sword_a is back in inventory
    expect(player.gear.sword_a.equippedBy).toBeNull();
    // sword_b is equipped by char_1
    expect(player.gear.sword_b.equippedBy).toBe("char_1");
  });

  it("swap: equip invariants hold after single-slot swap", async () => {
    const res = await getPlayer();
    const player = res.json<PlayerState>();
    assertEquipInvariants(player as unknown as import("../src/state.js").Player);
  });

  it("swap: stats reflect newly equipped gear", async () => {
    // warrior base str=5, sword_b str+3 → 8 (linear growth at lvl 1 = flat)
    const res = await getStats("char_1");
    const stats = res.json<CharacterStats>();
    expect(stats.finalStats.strength).toBe(8);
  });

  // ---- Swap mode: 2-slot replaces 1-slot ----

  it("swap: greatsword (2-slot) replaces sword_b in right_hand", async () => {
    // sword_b occupies right_hand, off_hand is free
    // greatsword needs [right_hand, off_hand] → should auto-unequip sword_b
    const res = await postTx({
      txId: "swap_2slot_001",
      type: "EquipGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      gearId: "gs_1",
      swap: true,
    });

    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(true);
    version = body.stateVersion;
  });

  it("swap: greatsword occupies both slots, sword_b is unequipped", async () => {
    const res = await getPlayer();
    const player = res.json<PlayerState>();

    expect(player.characters.char_1.equipped).toEqual({
      right_hand: "gs_1",
      off_hand: "gs_1",
    });
    expect(player.gear.sword_b.equippedBy).toBeNull();
    expect(player.gear.gs_1.equippedBy).toBe("char_1");

    assertEquipInvariants(player as unknown as import("../src/state.js").Player);
  });

  // ---- Swap mode: 1-slot replaces 2-slot gear (partial overlap) ----

  it("swap: sword into right_hand unequips greatsword from BOTH slots", async () => {
    // greatsword occupies right_hand + off_hand
    // equip sword_a into right_hand with swap → greatsword should be fully unequipped
    const res = await postTx({
      txId: "swap_partial_001",
      type: "EquipGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      gearId: "sword_a",
      swap: true,
    });

    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(true);
    version = body.stateVersion;
  });

  it("swap: greatsword fully unequipped, sword_a in right_hand only", async () => {
    const res = await getPlayer();
    const player = res.json<PlayerState>();

    // sword_a should only occupy right_hand; off_hand should be free
    expect(player.characters.char_1.equipped).toEqual({
      right_hand: "sword_a",
    });
    // greatsword fully unequipped
    expect(player.gear.gs_1.equippedBy).toBeNull();
    expect(player.gear.sword_a.equippedBy).toBe("char_1");

    assertEquipInvariants(player as unknown as import("../src/state.js").Player);
  });

  // ---- Swap mode: no-op when slots are free ----

  it("swap: equipping into free slot works (no conflict to resolve)", async () => {
    // off_hand is free, equip versatile_sword into off_hand
    const res = await postTx({
      txId: "swap_free_001",
      type: "EquipGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      gearId: "vers_1",
      slotPattern: ["off_hand"],
      swap: true,
    });

    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(true);
    version = body.stateVersion;

    const pRes = await getPlayer();
    const player = pRes.json<PlayerState>();
    expect(player.characters.char_1.equipped).toEqual({
      right_hand: "sword_a",
      off_hand: "vers_1",
    });
    expect(player.gear.vers_1.equippedBy).toBe("char_1");

    assertEquipInvariants(player as unknown as import("../src/state.js").Player);
  });

  // ---- Swap mode: multiple gears displaced at once ----

  it("swap: greatsword displaces TWO different gears at once", async () => {
    // State: sword_a in right_hand, vers_1 in off_hand
    // Equip greatsword (needs both) with swap → both should be unequipped
    const res = await postTx({
      txId: "swap_multi_001",
      type: "EquipGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      gearId: "gs_1",
      swap: true,
    });

    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(true);
    version = body.stateVersion;
  });

  it("swap: both displaced gears are fully unequipped", async () => {
    const res = await getPlayer();
    const player = res.json<PlayerState>();

    expect(player.characters.char_1.equipped).toEqual({
      right_hand: "gs_1",
      off_hand: "gs_1",
    });
    expect(player.gear.sword_a.equippedBy).toBeNull();
    expect(player.gear.vers_1.equippedBy).toBeNull();
    expect(player.gear.gs_1.equippedBy).toBe("char_1");

    assertEquipInvariants(player as unknown as import("../src/state.js").Player);
  });

  // ---- Swap still validates restrictions ----

  it("swap: restriction checks still apply (GEAR_ALREADY_EQUIPPED on other char)", async () => {
    // gs_1 is equipped on char_1. Create char_2 and try to equip gs_1 there → GEAR_ALREADY_EQUIPPED
    await postTx({
      txId: "swap_restrict_char2",
      type: "CreateCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_2",
      classId: "warrior",
    });
    version++;

    const res = await postTx({
      txId: "swap_restrict_001",
      type: "EquipGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_2",
      gearId: "gs_1",
      swap: true,
    });

    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(false);
    expect(body.errorCode).toBe("GEAR_ALREADY_EQUIPPED");
  });
});
