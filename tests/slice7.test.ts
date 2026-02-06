import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

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

describe("Slice 7 — Equipment Restrictions (class + level)", () => {
  const ADMIN_KEY = "test-admin-key-slice7";
  const TEST_API_KEY = "test-key-slice7";
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
        txId: "s7_setup_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "test_actor",
        apiKey: TEST_API_KEY,
      },
    });

    // Seed: CreatePlayer
    const p = await postTx({
      txId: "s7_setup_001",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "player_1",
    });
    version = p.json<TransactionResult>().stateVersion;

    // Seed: CreateCharacter (char_1, warrior, level 1)
    const c = await postTx({
      txId: "s7_setup_002",
      type: "CreateCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      classId: "warrior",
    });
    version = c.json<TransactionResult>().stateVersion;

    // Seed: CreateGear (elite_sword_1, elite_sword) — level 1
    const g1 = await postTx({
      txId: "s7_setup_003",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "elite_sword_1",
      gearDefId: "elite_sword",
    });
    version = g1.json<TransactionResult>().stateVersion;

    // Seed: CreateGear (shield_1, scaled_shield) — level 1
    const g2 = await postTx({
      txId: "s7_setup_004",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "shield_1",
      gearDefId: "scaled_shield",
    });
    version = g2.json<TransactionResult>().stateVersion;

    // Seed: CreateGear (cursed_blade_1, cursed_blade) — level 1
    const g3 = await postTx({
      txId: "s7_setup_005",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "cursed_blade_1",
      gearDefId: "cursed_blade",
    });
    version = g3.json<TransactionResult>().stateVersion;

    // Seed: CreateGear (greatsword_1, greatsword) — no restrictions, 2-slot
    const g4 = await postTx({
      txId: "s7_setup_006",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "greatsword_1",
      gearDefId: "greatsword",
    });
    version = g4.json<TransactionResult>().stateVersion;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("requiredCharacterLevel", () => {
    it("rejects when character level is below required", async () => {
      // char_1 is level 1, elite_sword requires level 3
      const res = await postTx({
        txId: "s7_lvl_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "elite_sword_1",
        characterId: "char_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("RESTRICTION_FAILED");
      expect(body.errorMessage).toContain("level");
      expect(body.stateVersion).toBe(version);
    });

    it("stateVersion unchanged after restriction rejection", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      const body = res.json<PlayerState>();
      expect(body.characters.char_1.equipped).toEqual({});
      expect(body.gear.elite_sword_1.equippedBy).toBeUndefined();
    });

    it("accepts after leveling character to meet requirement", async () => {
      // Level up char_1 to level 3 (needs +2)
      const lvl = await postTx({
        txId: "s7_lvl_002",
        type: "LevelUpCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        levels: 2,
      });
      version = lvl.json<TransactionResult>().stateVersion;

      // Now equip elite_sword_1 — warrior is in allowedClasses, level 3 >= 3
      const res = await postTx({
        txId: "s7_lvl_003",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "elite_sword_1",
        characterId: "char_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);
      expect(body.stateVersion).toBe(version + 1);
      version = body.stateVersion;
    });

    it("state reflects equip after passing restrictions", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      const body = res.json<PlayerState>();
      expect(body.characters.char_1.equipped).toEqual({
        right_hand: "elite_sword_1",
      });
      expect(body.gear.elite_sword_1.equippedBy).toBe("char_1");
    });
  });

  describe("maxLevelDelta", () => {
    it("accepts at boundary (gear.level == char.level + delta)", async () => {
      // Unequip elite_sword_1 first to free right_hand
      const uneq = await postTx({
        txId: "s7_delta_setup_001",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "elite_sword_1",
      });
      version = uneq.json<TransactionResult>().stateVersion;

      // shield_1 level 1, char_1 level 3, delta 0 → 1 <= 3+0=3 → pass
      const res = await postTx({
        txId: "s7_delta_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "shield_1",
        characterId: "char_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);
      version = body.stateVersion;
    });

    it("rejects when gear level exceeds char.level + maxLevelDelta", async () => {
      // Unequip shield, level it up to 4, then try to re-equip
      const uneq = await postTx({
        txId: "s7_delta_setup_002",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "shield_1",
      });
      version = uneq.json<TransactionResult>().stateVersion;

      // Level up shield_1 from 1 to 4 (+3)
      const lvl = await postTx({
        txId: "s7_delta_002",
        type: "LevelUpGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "shield_1",
        levels: 3,
      });
      version = lvl.json<TransactionResult>().stateVersion;

      // shield_1 level 4, char_1 level 3, delta 0 → 4 > 3+0=3 → fail
      const res = await postTx({
        txId: "s7_delta_003",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "shield_1",
        characterId: "char_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("RESTRICTION_FAILED");
      expect(body.errorMessage).toContain("maxLevelDelta");
      expect(body.stateVersion).toBe(version);
    });

    it("accepts after leveling character to match", async () => {
      // Level up char_1 from 3 to 4 (+1)
      const lvl = await postTx({
        txId: "s7_delta_004",
        type: "LevelUpCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        levels: 1,
      });
      version = lvl.json<TransactionResult>().stateVersion;

      // shield_1 level 4, char_1 level 4, delta 0 → 4 <= 4+0=4 → pass
      const res = await postTx({
        txId: "s7_delta_005",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "shield_1",
        characterId: "char_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);
      version = body.stateVersion;
    });
  });

  describe("blockedClasses", () => {
    it("rejects when character class is in blockedClasses", async () => {
      // Unequip shield to free off_hand, unequip anything in right_hand
      const uneq = await postTx({
        txId: "s7_block_setup_001",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "shield_1",
      });
      version = uneq.json<TransactionResult>().stateVersion;

      // cursed_blade has blockedClasses: ["warrior"], char_1 is warrior
      const res = await postTx({
        txId: "s7_block_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "cursed_blade_1",
        characterId: "char_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("RESTRICTION_FAILED");
      expect(body.errorMessage).toContain("blockedClasses");
      expect(body.stateVersion).toBe(version);
    });
  });

  describe("allowedClasses — pass", () => {
    it("accepts when character class is in allowedClasses", async () => {
      // elite_sword has allowedClasses: ["warrior"], char_1 is warrior, level 4 >= 3
      const res = await postTx({
        txId: "s7_allow_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "elite_sword_1",
        characterId: "char_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);
      version = body.stateVersion;
    });
  });

  describe("No restrictions — regression", () => {
    it("gear without restrictions still equips normally", async () => {
      // Unequip elite_sword to free right_hand
      const uneq = await postTx({
        txId: "s7_noreg_setup_001",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "elite_sword_1",
      });
      version = uneq.json<TransactionResult>().stateVersion;

      // greatsword has no restrictions, 2-slot
      const res = await postTx({
        txId: "s7_noreg_001",
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

    it("both slots occupied by unrestricted gear", async () => {
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
});
