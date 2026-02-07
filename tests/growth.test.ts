import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { applyGrowth } from "../src/algorithms/growth.js";
import { createApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Unit tests — applyGrowth
// ---------------------------------------------------------------------------

describe("Growth algorithms — unit tests", () => {
  describe("flat", () => {
    it("returns floored baseStats at any level", () => {
      const result = applyGrowth(
        { strength: 5, hp: 20 },
        10,
        { algorithmId: "flat", params: {} },
      );
      expect(result).toEqual({ strength: 5, hp: 20 });
    });
  });

  describe("linear", () => {
    const params = {
      perLevelMultiplier: 0.1,
      additivePerLevel: { hp: 1 },
    };

    it("returns base at level 1 (identity)", () => {
      const result = applyGrowth(
        { strength: 5, hp: 20 },
        1,
        { algorithmId: "linear", params },
      );
      expect(result).toEqual({ strength: 5, hp: 20 });
    });

    it("scales warrior stats at level 3", () => {
      // str = floor(5 * (1 + 0.1*2)) = floor(5*1.2) = 6
      // hp  = floor(20 * (1 + 0.1*2) + 1*2) = floor(20*1.2 + 2) = 26
      const result = applyGrowth(
        { strength: 5, hp: 20 },
        3,
        { algorithmId: "linear", params },
      );
      expect(result).toEqual({ strength: 6, hp: 26 });
    });

    it("scales warrior stats at level 10", () => {
      // str = floor(5 * (1 + 0.1*9)) = floor(5*1.9) = 9
      // hp  = floor(20 * (1 + 0.1*9) + 1*9) = floor(20*1.9 + 9) = 47
      const result = applyGrowth(
        { strength: 5, hp: 20 },
        10,
        { algorithmId: "linear", params },
      );
      expect(result).toEqual({ strength: 9, hp: 47 });
    });

    it("defaults additivePerLevel to {} when missing", () => {
      const result = applyGrowth(
        { strength: 5, hp: 20 },
        3,
        { algorithmId: "linear", params: { perLevelMultiplier: 0.1 } },
      );
      // str = floor(5 * 1.2) = 6, hp = floor(20 * 1.2) = 24
      expect(result).toEqual({ strength: 6, hp: 24 });
    });

    it("throws on missing perLevelMultiplier", () => {
      expect(() =>
        applyGrowth({ strength: 5 }, 2, {
          algorithmId: "linear",
          params: {},
        }),
      ).toThrow("perLevelMultiplier");
    });
  });

  describe("exponential", () => {
    it("returns base at level 1 (identity)", () => {
      const result = applyGrowth(
        { strength: 10 },
        1,
        { algorithmId: "exponential", params: { exponent: 1.1 } },
      );
      expect(result).toEqual({ strength: 10 });
    });

    it("scales at level 5 with exponent 1.1", () => {
      // str = floor(10 * 1.1^4) = floor(10 * 1.4641) = 14
      const result = applyGrowth(
        { strength: 10 },
        5,
        { algorithmId: "exponential", params: { exponent: 1.1 } },
      );
      expect(result).toEqual({ strength: 14 });
    });

    it("throws on missing exponent", () => {
      expect(() =>
        applyGrowth({ strength: 10 }, 2, {
          algorithmId: "exponential",
          params: {},
        }),
      ).toThrow("exponent");
    });
  });

  describe("edge cases", () => {
    it("throws on unknown algorithmId", () => {
      expect(() =>
        applyGrowth({ strength: 5 }, 1, {
          algorithmId: "unknown_algo",
          params: {},
        }),
      ).toThrow("Unknown growth algorithmId");
    });

    it("empty baseStats → empty result", () => {
      const result = applyGrowth(
        {},
        10,
        { algorithmId: "linear", params: { perLevelMultiplier: 0.5 } },
      );
      expect(result).toEqual({});
    });

    it("level < 1 is treated as level 1", () => {
      const result = applyGrowth(
        { strength: 5, hp: 20 },
        0,
        {
          algorithmId: "linear",
          params: { perLevelMultiplier: 0.1, additivePerLevel: { hp: 1 } },
        },
      );
      // Level 0 → treated as 1 → identity
      expect(result).toEqual({ strength: 5, hp: 20 });
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests — stats endpoint with growth
// ---------------------------------------------------------------------------

interface CharacterStats {
  characterId: string;
  classId: string;
  level: number;
  finalStats: Record<string, number>;
}

describe("Growth algorithms — stats endpoint integration", () => {
  let app: FastifyInstance;
  const ADMIN_KEY = "test-admin-key-growth";
  const TEST_API_KEY = "test-key-growth";

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
    app = createApp({ adminApiKey: ADMIN_KEY });
    await app.ready();

    // Bootstrap actor
    await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      payload: {
        txId: "growth_setup_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "growth_actor",
        apiKey: TEST_API_KEY,
      },
    });

    // Create player
    await postTx({
      txId: "growth_setup_player",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "player_1",
    });

    // Create warrior character (starts at level 1)
    await postTx({
      txId: "growth_create_char",
      type: "CreateCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      classId: "warrior",
    });

    // Create sword_basic gear
    await postTx({
      txId: "growth_create_sword",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "sword_1",
      gearDefId: "sword_basic",
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("level 1 character: stats = base (linear growth, no change at level 1)", async () => {
    const res = await getStats("char_1");
    expect(res.statusCode).toBe(200);
    const body = res.json<CharacterStats>();
    expect(body.finalStats).toEqual({ strength: 5, hp: 20 });
  });

  it("level 5 character with gear level 1: class scales, gear stays flat", async () => {
    // Level up to 5
    await postTx({
      txId: "growth_lu_5",
      type: "LevelUpCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      levels: 4,
    });

    // Equip sword
    await postTx({
      txId: "growth_equip_sword",
      type: "EquipGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      gearId: "sword_1",
    });

    const res = await getStats("char_1");
    expect(res.statusCode).toBe(200);
    const body = res.json<CharacterStats>();
    // class at level 5: str = floor(5*(1+0.1*4)) = floor(5*1.4) = 7
    //                   hp  = floor(20*(1+0.1*4) + 1*4) = floor(20*1.4+4) = 32
    // sword at gear level 1: str = 3 (identity)
    // total: str = 7+3 = 10, hp = 32
    expect(body.finalStats).toEqual({ strength: 10, hp: 32 });
  });

  it("level 3 character with gear level 3: both scale", async () => {
    // Create a new character for clean test
    await postTx({
      txId: "growth_create_char2",
      type: "CreateCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_2",
      classId: "warrior",
    });

    // Level up char_2 to 3
    await postTx({
      txId: "growth_lu_char2",
      type: "LevelUpCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_2",
      levels: 2,
    });

    // Create gear and level it up to 3
    await postTx({
      txId: "growth_create_sword2",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "sword_2",
      gearDefId: "sword_basic",
    });
    await postTx({
      txId: "growth_lu_sword2",
      type: "LevelUpGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "sword_2",
      levels: 2,
    });

    // Equip
    await postTx({
      txId: "growth_equip_sword2",
      type: "EquipGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_2",
      gearId: "sword_2",
    });

    const res = await getStats("char_2");
    expect(res.statusCode).toBe(200);
    const body = res.json<CharacterStats>();
    // class at level 3: str = floor(5*1.2) = 6, hp = floor(20*1.2+2) = 26
    // sword at gear level 3: str = floor(3*1.2) = 3 (floor(3.6)=3)
    // total: str = 6+3 = 9, hp = 26
    expect(body.finalStats).toEqual({ strength: 9, hp: 26 });
  });

  it("set bonuses are applied flat (not scaled)", async () => {
    // This test uses config_sets which has flat growth
    const setsApp = createApp({
      configPath: "examples/config_sets.json",
      adminApiKey: ADMIN_KEY,
    });
    await setsApp.ready();

    // Bootstrap
    await setsApp.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      payload: {
        txId: "sets_growth_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "sets_actor",
        apiKey: TEST_API_KEY,
      },
    });

    await setsApp.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: {
        txId: "sets_growth_player",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_1",
      },
    });

    await setsApp.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: {
        txId: "sets_growth_char",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        classId: "warrior",
      },
    });

    // Verify flat growth config works
    const res = await setsApp.inject({
      method: "GET",
      url: "/instance_001/character/char_1/stats",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<CharacterStats>();
    // flat growth → base stats unchanged
    expect(body.finalStats.strength).toBe(5);

    await setsApp.close();
  });

  it("unknown algorithmId → 500 INVALID_CONFIG_REFERENCE", async () => {
    // Directly manipulate the config to test error handling
    const config = app.gameConfigs.values().next().value;
    if (!config) throw new Error("No config loaded");
    const originalAlgo = config.algorithms.growth.algorithmId;
    config.algorithms.growth.algorithmId = "nonexistent";

    try {
      const res = await getStats("char_1");
      expect(res.statusCode).toBe(500);
      const body = res.json<{ errorCode: string }>();
      expect(body.errorCode).toBe("INVALID_CONFIG_REFERENCE");
    } finally {
      config.algorithms.growth.algorithmId = originalAlgo;
    }
  });

  it("config with 'flat' algorithmId still works", async () => {
    const config = app.gameConfigs.values().next().value;
    if (!config) throw new Error("No config loaded");
    const originalAlgo = config.algorithms.growth.algorithmId;
    const originalParams = config.algorithms.growth.params;
    config.algorithms.growth.algorithmId = "flat";
    config.algorithms.growth.params = {};

    try {
      const res = await getStats("char_1");
      expect(res.statusCode).toBe(200);
      const body = res.json<CharacterStats>();
      // char_1 is level 5 with sword equipped
      // flat: class str=5, hp=20. sword str=3.
      expect(body.finalStats).toEqual({ strength: 8, hp: 20 });
    } finally {
      config.algorithms.growth.algorithmId = originalAlgo;
      config.algorithms.growth.params = originalParams;
    }
  });
});
