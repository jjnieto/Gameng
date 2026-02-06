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

describe("Slice 6 — Gear multi-slot (2 slots) + conflicts (strict mode)", () => {
  const ADMIN_KEY = "test-admin-key-slice6";
  const TEST_API_KEY = "test-key-slice6";
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

  beforeAll(async () => {
    app = createApp({ adminApiKey: ADMIN_KEY });
    await app.ready();

    // Bootstrap: CreateActor (requires admin key)
    await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      payload: {
        txId: "s6_setup_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "test_actor",
        apiKey: TEST_API_KEY,
      },
    });

    // Seed: CreatePlayer
    const p = await postTx({
      txId: "s6_setup_001",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "player_1",
    });
    version = p.json<TransactionResult>().stateVersion;

    // Seed: CreateCharacter (char_1, warrior)
    const c = await postTx({
      txId: "s6_setup_002",
      type: "CreateCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      classId: "warrior",
    });
    version = c.json<TransactionResult>().stateVersion;

    // Seed: CreateGear (greatsword_1, greatsword — 2-slot)
    const g1 = await postTx({
      txId: "s6_setup_003",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "greatsword_1",
      gearDefId: "greatsword",
    });
    version = g1.json<TransactionResult>().stateVersion;

    // Seed: CreateGear (sword_1, sword_basic — 1-slot)
    const g2 = await postTx({
      txId: "s6_setup_004",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "sword_1",
      gearDefId: "sword_basic",
    });
    version = g2.json<TransactionResult>().stateVersion;

    // Seed: CreateGear (versatile_1, versatile_sword — 2 patterns)
    const g3 = await postTx({
      txId: "s6_setup_005",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "versatile_1",
      gearDefId: "versatile_sword",
    });
    version = g3.json<TransactionResult>().stateVersion;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("EquipGear — 2-slot happy path", () => {
    it("equips greatsword with explicit slotPattern occupying both slots", async () => {
      const res = await postTx({
        txId: "s6_eq_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "greatsword_1",
        characterId: "char_1",
        slotPattern: ["right_hand", "off_hand"],
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);
      expect(body.stateVersion).toBe(version + 1);
      version = body.stateVersion;
    });

    it("both slots show the same gearId in player state", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<PlayerState>();
      expect(body.characters.char_1.equipped).toEqual({
        right_hand: "greatsword_1",
        off_hand: "greatsword_1",
      });
      expect(body.gear.greatsword_1.equippedBy).toBe("char_1");
    });

    it("stats count gear once (not per slot)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/character/char_1/stats",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<CharacterStats>();
      // warrior base: strength=5, hp=20; greatsword: strength=5, hp=5
      expect(body.finalStats).toEqual({ strength: 10, hp: 25 });
    });
  });

  describe("UnequipGear — 2-slot", () => {
    it("unequip frees both slots", async () => {
      const res = await postTx({
        txId: "s6_uq_001",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "greatsword_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);
      expect(body.stateVersion).toBe(version + 1);
      version = body.stateVersion;
    });

    it("player state shows both slots free and gear unequipped", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      const body = res.json<PlayerState>();
      expect(body.characters.char_1.equipped).toEqual({});
      expect(body.gear.greatsword_1.equippedBy).toBeNull();
    });

    it("stats revert to base after unequip", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/character/char_1/stats",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      const body = res.json<CharacterStats>();
      expect(body.finalStats).toEqual({ strength: 5, hp: 20 });
    });
  });

  describe("EquipGear — auto-resolve single pattern (2-slot)", () => {
    it("auto-resolves when gearDef has exactly one equipPattern", async () => {
      // greatsword has exactly 1 pattern [["right_hand", "off_hand"]]
      const res = await postTx({
        txId: "s6_eq_auto_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "greatsword_1",
        characterId: "char_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);
      version = body.stateVersion;
    });

    it("both slots occupied after auto-resolve", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      const body = res.json<PlayerState>();
      expect(body.characters.char_1.equipped).toEqual({
        right_hand: "greatsword_1",
        off_hand: "greatsword_1",
      });
    });
  });

  describe("EquipGear — SLOT_OCCUPIED (strict mode, partial conflict)", () => {
    // greatsword_1 is equipped in both slots from previous test

    it("rejects when one of the target slots is occupied", async () => {
      // Unequip greatsword, equip sword_1 in right_hand only
      await postTx({
        txId: "s6_occ_setup_001",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "greatsword_1",
      });
      version++;

      const eqSword = await postTx({
        txId: "s6_occ_setup_002",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "sword_1",
        characterId: "char_1",
      });
      version = eqSword.json<TransactionResult>().stateVersion;

      // Now right_hand is occupied by sword_1, off_hand is free
      // Try to equip greatsword_1 (needs both) → SLOT_OCCUPIED
      const res = await postTx({
        txId: "s6_occ_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "greatsword_1",
        characterId: "char_1",
        slotPattern: ["right_hand", "off_hand"],
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("SLOT_OCCUPIED");
      expect(body.stateVersion).toBe(version);
    });
  });

  describe("EquipGear — SLOT_INCOMPATIBLE (pattern mismatch)", () => {
    it("rejects when slotPattern does not match any equipPattern", async () => {
      // greatsword patterns: [["right_hand", "off_hand"]]
      // Try with reversed order: ["off_hand", "right_hand"]
      const res = await postTx({
        txId: "s6_inc_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "greatsword_1",
        characterId: "char_1",
        slotPattern: ["off_hand", "right_hand"],
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("SLOT_INCOMPATIBLE");
      expect(body.stateVersion).toBe(version);
    });
  });

  describe("EquipGear — ambiguity rejection", () => {
    it("rejects when gearDef has multiple patterns and no slotPattern provided", async () => {
      // versatile_sword has patterns: [["right_hand"], ["off_hand"]]
      const res = await postTx({
        txId: "s6_amb_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "versatile_1",
        characterId: "char_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("SLOT_INCOMPATIBLE");
      expect(body.stateVersion).toBe(version);
    });

    it("accepts when explicit slotPattern disambiguates", async () => {
      // Unequip sword_1 first to free right_hand
      await postTx({
        txId: "s6_amb_setup_001",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "sword_1",
      });
      version++;

      const res = await postTx({
        txId: "s6_amb_002",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "versatile_1",
        characterId: "char_1",
        slotPattern: ["off_hand"],
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);
      version = body.stateVersion;
    });

    it("versatile_sword occupies only the chosen slot", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      const body = res.json<PlayerState>();
      expect(body.characters.char_1.equipped).toEqual({
        off_hand: "versatile_1",
      });
    });
  });

  describe("Atomicity — multi-slot", () => {
    it("failed 2-slot equip does not change stateVersion", async () => {
      const versionBefore = version;

      // off_hand is occupied by versatile_1
      // Try to equip greatsword (needs right_hand + off_hand) → off_hand occupied
      const res = await postTx({
        txId: "s6_atom_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "greatsword_1",
        characterId: "char_1",
      });

      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("SLOT_OCCUPIED");
      expect(body.stateVersion).toBe(versionBefore);
    });

    it("no slots were partially mutated after failed equip", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      const body = res.json<PlayerState>();
      // right_hand should still be empty (not partially set)
      expect(body.characters.char_1.equipped).toEqual({
        off_hand: "versatile_1",
      });
      expect(body.gear.greatsword_1.equippedBy).toBeNull();
    });
  });

  describe("Consistency — 2-slot equip + 1-slot equip coexist", () => {
    it("can equip a 1-slot gear in remaining free slot alongside 2-slot check", async () => {
      // Unequip versatile_1 to free off_hand
      await postTx({
        txId: "s6_con_setup_001",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "versatile_1",
      });
      version++;

      // Equip greatsword (2-slot) → occupies both
      const eq = await postTx({
        txId: "s6_con_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "greatsword_1",
        characterId: "char_1",
      });
      version = eq.json<TransactionResult>().stateVersion;

      // Unequip greatsword, then equip sword_1 in right_hand only
      await postTx({
        txId: "s6_con_002",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "greatsword_1",
      });
      version++;

      const eqSword = await postTx({
        txId: "s6_con_003",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "sword_1",
        characterId: "char_1",
      });
      version = eqSword.json<TransactionResult>().stateVersion;

      // Equip versatile_1 in off_hand (explicit pattern)
      const eqVersatile = await postTx({
        txId: "s6_con_004",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "versatile_1",
        characterId: "char_1",
        slotPattern: ["off_hand"],
      });
      version = eqVersatile.json<TransactionResult>().stateVersion;

      const res = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      const body = res.json<PlayerState>();
      expect(body.characters.char_1.equipped).toEqual({
        right_hand: "sword_1",
        off_hand: "versatile_1",
      });
    });

    it("stats sum both equipped gear once each", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/character/char_1/stats",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      const body = res.json<CharacterStats>();
      // warrior(5,20) + sword_basic(3,0) + versatile_sword(4,0)
      expect(body.finalStats).toEqual({ strength: 12, hp: 20 });
    });

    it("equip/equippedBy invariants hold after mixed equip operations", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });
      assertEquipInvariants(res.json<PlayerState>());
    });
  });
});
