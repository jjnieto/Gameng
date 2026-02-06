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

interface CharacterStats {
  characterId: string;
  classId: string;
  level: number;
  finalStats: Record<string, number>;
}

describe("Slice 8 — Set Bonuses (2-piece, 4-piece)", () => {
  const ADMIN_KEY = "test-admin-key-slice8";
  const TEST_API_KEY = "test-key-slice8";
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

  function getStats(characterId: string) {
    return app.inject({
      method: "GET",
      url: `/instance_001/character/${characterId}/stats`,
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
  }

  beforeAll(async () => {
    app = createApp({
      configPath: "examples/config_sets.json",
      adminApiKey: ADMIN_KEY,
    });
    await app.ready();

    // Bootstrap: CreateActor (requires admin key)
    await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      payload: {
        txId: "s8_setup_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "test_actor",
        apiKey: TEST_API_KEY,
      },
    });

    // Seed: CreatePlayer
    const p = await postTx({
      txId: "s8_setup_001",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "player_1",
    });
    version = p.json<TransactionResult>().stateVersion;

    // Seed: CreateCharacter (char_1, warrior, level 1)
    const c = await postTx({
      txId: "s8_setup_002",
      type: "CreateCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      classId: "warrior",
    });
    version = c.json<TransactionResult>().stateVersion;

    // Seed: CreateGear — sword_basic (setId: warrior_set, setPieceCount: 1)
    const g1 = await postTx({
      txId: "s8_setup_003",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "sword_1",
      gearDefId: "sword_basic",
    });
    version = g1.json<TransactionResult>().stateVersion;

    // Seed: CreateGear — versatile_sword (setId: warrior_set, setPieceCount: 1)
    const g2 = await postTx({
      txId: "s8_setup_004",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "versatile_1",
      gearDefId: "versatile_sword",
    });
    version = g2.json<TransactionResult>().stateVersion;

    // Seed: CreateGear — warrior_helm (setId: warrior_set, setPieceCount: 1)
    const g3 = await postTx({
      txId: "s8_setup_005",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "helm_1",
      gearDefId: "warrior_helm",
    });
    version = g3.json<TransactionResult>().stateVersion;

    // Seed: CreateGear — warrior_chest (setId: warrior_set, setPieceCount: 1)
    const g4 = await postTx({
      txId: "s8_setup_006",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "chest_1",
      gearDefId: "warrior_chest",
    });
    version = g4.json<TransactionResult>().stateVersion;

    // Seed: CreateGear — greatsword (setId: warrior_set, setPieceCount: 2)
    const g5 = await postTx({
      txId: "s8_setup_007",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "greatsword_1",
      gearDefId: "greatsword",
    });
    version = g5.json<TransactionResult>().stateVersion;

    // Seed: CreateGear — elite_sword (no setId, for zero-bonus test)
    const g6 = await postTx({
      txId: "s8_setup_008",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "elite_1",
      gearDefId: "elite_sword",
    });
    version = g6.json<TransactionResult>().stateVersion;

    // Level up char to 3 so elite_sword restriction passes
    const lvl = await postTx({
      txId: "s8_setup_009",
      type: "LevelUpCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      levels: 2,
    });
    version = lvl.json<TransactionResult>().stateVersion;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("0 pieces — no set bonus", () => {
    it("stats are base only when no set gear is equipped", async () => {
      // No gear equipped yet — version tracks setup state
      expect(version).toBeGreaterThan(0);

      const res = await getStats("char_1");
      expect(res.statusCode).toBe(200);
      const body = res.json<CharacterStats>();
      // warrior base: strength=5, hp=20
      expect(body.finalStats).toEqual({ strength: 5, hp: 20 });
    });

    it("gear without setId does not trigger any set bonus", async () => {
      // Equip elite_sword (no setId)
      const eq = await postTx({
        txId: "s8_zero_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "elite_1",
        characterId: "char_1",
      });
      version = eq.json<TransactionResult>().stateVersion;

      const res = await getStats("char_1");
      const body = res.json<CharacterStats>();
      // warrior(5,20) + elite_sword(8,0) = (13,20), no set bonus
      expect(body.finalStats).toEqual({ strength: 13, hp: 20 });

      // Cleanup: unequip
      const uneq = await postTx({
        txId: "s8_zero_002",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "elite_1",
      });
      version = uneq.json<TransactionResult>().stateVersion;
    });
  });

  describe("1 piece — below threshold, no bonus", () => {
    it("single set piece does not activate 2-piece bonus", async () => {
      // Equip sword_basic (1 set piece)
      const eq = await postTx({
        txId: "s8_one_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "sword_1",
        characterId: "char_1",
      });
      version = eq.json<TransactionResult>().stateVersion;

      const res = await getStats("char_1");
      const body = res.json<CharacterStats>();
      // warrior(5,20) + sword_basic(3,0) = (8,20), 1 piece < 2 → no bonus
      expect(body.finalStats).toEqual({ strength: 8, hp: 20 });
    });
  });

  describe("2 pieces — activates 2-piece bonus only", () => {
    it("two set pieces activate the 2-piece bonus", async () => {
      // sword_1 already equipped in right_hand. Equip helm_1 in head.
      const eq = await postTx({
        txId: "s8_two_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "helm_1",
        characterId: "char_1",
      });
      version = eq.json<TransactionResult>().stateVersion;

      const res = await getStats("char_1");
      const body = res.json<CharacterStats>();
      // warrior(5,20) + sword_basic(3,0) + warrior_helm(0,3)
      // + 2-piece bonus(2,0) = (10,23)
      expect(body.finalStats).toEqual({ strength: 10, hp: 23 });
    });

    it("4-piece bonus is NOT active with only 2 pieces", async () => {
      const res = await getStats("char_1");
      const body = res.json<CharacterStats>();
      // If 4-piece were active, hp would be 33 (23+10). It's 23.
      expect(body.finalStats.hp).toBe(23);
    });
  });

  describe("4 pieces — activates both 2-piece and 4-piece bonuses", () => {
    it("four set pieces activate both thresholds", async () => {
      // Currently: sword_1 (right_hand), helm_1 (head). Equip versatile_1 (off_hand), chest_1 (chest).
      const eq1 = await postTx({
        txId: "s8_four_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "versatile_1",
        characterId: "char_1",
        slotPattern: ["off_hand"],
      });
      version = eq1.json<TransactionResult>().stateVersion;

      const eq2 = await postTx({
        txId: "s8_four_002",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "chest_1",
        characterId: "char_1",
      });
      version = eq2.json<TransactionResult>().stateVersion;

      const res = await getStats("char_1");
      const body = res.json<CharacterStats>();
      // warrior(5,20) + sword_basic(3,0) + versatile_sword(4,0) + warrior_helm(0,3) + warrior_chest(0,5)
      // + 2-piece bonus(2,0) + 4-piece bonus(0,10)
      // = strength: 5+3+4+2 = 14, hp: 20+3+5+10 = 38
      expect(body.finalStats).toEqual({ strength: 14, hp: 38 });
    });
  });

  describe("setPieceCount=2 — multi-slot gear counts as 2 pieces", () => {
    it("greatsword with setPieceCount=2 alone activates 2-piece bonus", async () => {
      // Unequip all current gear
      for (const gearId of ["sword_1", "versatile_1", "helm_1", "chest_1"]) {
        const uneq = await postTx({
          txId: `s8_spc_uneq_${gearId}`,
          type: "UnequipGear",
          gameInstanceId: "instance_001",
          playerId: "player_1",
          gearId,
        });
        version = uneq.json<TransactionResult>().stateVersion;
      }

      // Equip greatsword (setPieceCount=2, occupies right_hand + off_hand)
      const eq = await postTx({
        txId: "s8_spc_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "greatsword_1",
        characterId: "char_1",
      });
      version = eq.json<TransactionResult>().stateVersion;

      const res = await getStats("char_1");
      const body = res.json<CharacterStats>();
      // warrior(5,20) + greatsword(5,5) + 2-piece bonus(2,0)
      // = strength: 12, hp: 25
      expect(body.finalStats).toEqual({ strength: 12, hp: 25 });
    });

    it("greatsword(2) + helm(1) + chest(1) = 4 pieces, activates both bonuses", async () => {
      // Equip helm and chest alongside greatsword
      const eq1 = await postTx({
        txId: "s8_spc_002",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "helm_1",
        characterId: "char_1",
      });
      version = eq1.json<TransactionResult>().stateVersion;

      const eq2 = await postTx({
        txId: "s8_spc_003",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "chest_1",
        characterId: "char_1",
      });
      version = eq2.json<TransactionResult>().stateVersion;

      const res = await getStats("char_1");
      const body = res.json<CharacterStats>();
      // warrior(5,20) + greatsword(5,5) + warrior_helm(0,3) + warrior_chest(0,5)
      // + 2-piece bonus(2,0) + 4-piece bonus(0,10)
      // = strength: 5+5+2 = 12, hp: 20+5+3+5+10 = 43
      expect(body.finalStats).toEqual({ strength: 12, hp: 43 });
    });
  });

  describe("Unequip reverts set bonuses", () => {
    it("removing gear below 2-piece threshold removes all set bonuses", async () => {
      // Currently: greatsword(right_hand+off_hand), helm_1(head), chest_1(chest) = 4 pieces
      // Unequip helm and chest → greatsword alone = 2 pieces → only 2-piece bonus
      const uneq1 = await postTx({
        txId: "s8_revert_001",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "helm_1",
      });
      version = uneq1.json<TransactionResult>().stateVersion;

      const uneq2 = await postTx({
        txId: "s8_revert_002",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "chest_1",
      });
      version = uneq2.json<TransactionResult>().stateVersion;

      const res = await getStats("char_1");
      const body = res.json<CharacterStats>();
      // warrior(5,20) + greatsword(5,5) + 2-piece bonus(2,0) only
      expect(body.finalStats).toEqual({ strength: 12, hp: 25 });
    });

    it("unequipping all set gear removes all set bonuses", async () => {
      // Unequip greatsword
      const uneq = await postTx({
        txId: "s8_revert_003",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "greatsword_1",
      });
      version = uneq.json<TransactionResult>().stateVersion;

      const res = await getStats("char_1");
      const body = res.json<CharacterStats>();
      // warrior base only: (5, 20)
      expect(body.finalStats).toEqual({ strength: 5, hp: 20 });
    });
  });

  describe("Multi-slot gear counted once (not per slot)", () => {
    it("greatsword occupying 2 slots contributes setPieceCount once, not twice", async () => {
      // Equip greatsword again (setPieceCount=2, occupies 2 slots)
      const eq = await postTx({
        txId: "s8_dedup_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "greatsword_1",
        characterId: "char_1",
      });
      version = eq.json<TransactionResult>().stateVersion;

      const res = await getStats("char_1");
      const body = res.json<CharacterStats>();
      // If counted per slot (2 slots × setPieceCount=2 = 4), we'd see 4-piece bonus
      // Correct: counted once × setPieceCount=2 = 2 pieces → only 2-piece bonus
      // warrior(5,20) + greatsword(5,5) + 2-piece bonus(2,0) = (12, 25)
      expect(body.finalStats).toEqual({ strength: 12, hp: 25 });
      // Specifically: no 4-piece bonus (hp would be 35 if counted per slot)
      expect(body.finalStats.hp).toBe(25);
    });
  });
});
