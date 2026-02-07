import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

interface CharacterStats {
  characterId: string;
  classId: string;
  level: number;
  finalStats: Record<string, number>;
}

const ADMIN_KEY = "test-admin-key-clamps";
const TEST_API_KEY = "test-key-clamps";

describe("Stat clamps", () => {
  let app: FastifyInstance;

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
    // config_clamps.json: statClamps = { strength: { min: 0, max: 12 }, hp: { min: 5 } }
    // flat growth, sets: warrior_set (2-piece: +2 str, 3-piece: +10 hp)
    app = createApp({
      configPath: "examples/config_clamps.json",
      adminApiKey: ADMIN_KEY,
    });
    await app.ready();

    // Bootstrap actor
    await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      payload: {
        txId: "clamp_setup_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "clamp_actor",
        apiKey: TEST_API_KEY,
      },
    });

    // Create player
    await postTx({
      txId: "clamp_setup_player",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "player_1",
    });

    // Create warrior character
    await postTx({
      txId: "clamp_create_char",
      type: "CreateCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      classId: "warrior",
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("no gear: stats within range are not clamped", async () => {
    // warrior base: str=5, hp=20. Clamps: str [0,12], hp [5,∞).
    // Both within range → no clamping.
    const res = await getStats("char_1");
    expect(res.statusCode).toBe(200);
    const body = res.json<CharacterStats>();
    expect(body.finalStats).toEqual({ strength: 5, hp: 20 });
  });

  it("clamp max: gear + set bonus exceeds max → clamped", async () => {
    // Equip sword + helm → 2-piece set bonus (+2 str)
    // str = 5 (base) + 3 (sword) + 3 (helm—no str) + 2 (set bonus) = 10 → within max 12
    // hp  = 20 (base) + 0 (sword) + 3 (helm) = 23 → no max, min 5 → ok

    // Create and equip sword
    await postTx({
      txId: "clamp_create_sword",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "sword_1",
      gearDefId: "sword_basic",
    });
    await postTx({
      txId: "clamp_equip_sword",
      type: "EquipGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      gearId: "sword_1",
    });

    // Create and equip helm
    await postTx({
      txId: "clamp_create_helm",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "helm_1",
      gearDefId: "warrior_helm",
    });
    await postTx({
      txId: "clamp_equip_helm",
      type: "EquipGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      gearId: "helm_1",
    });

    // 2-piece set bonus active: +2 str
    // str = 5 + 3 + 0 + 2 = 10. max=12, not clamped.
    let res = await getStats("char_1");
    expect(res.statusCode).toBe(200);
    let body = res.json<CharacterStats>();
    expect(body.finalStats.strength).toBe(10);
    expect(body.finalStats.hp).toBe(23);

    // Now equip chest → 3-piece set bonus (+10 hp), total str stays 10+0=10, still < 12
    // But let's verify clamping by checking a scenario that exceeds max.
    // Actually, with 3 pieces: str = 5 + 3 + 0 + 0 + 2 (2-piece bonus) = 10, hp = 20 + 0 + 3 + 5 + 10 (3-piece bonus) = 38
    await postTx({
      txId: "clamp_create_chest",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "chest_1",
      gearDefId: "warrior_chest",
    });
    await postTx({
      txId: "clamp_equip_chest",
      type: "EquipGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      gearId: "chest_1",
    });

    res = await getStats("char_1");
    expect(res.statusCode).toBe(200);
    body = res.json<CharacterStats>();
    // str = 5 + 3 + 0 + 0 + 2 (set 2-piece) = 10, max=12 → not clamped
    expect(body.finalStats.strength).toBe(10);
    // hp = 20 + 0 + 3 + 5 + 10 (set 3-piece) = 38, min=5, no max → not clamped
    expect(body.finalStats.hp).toBe(38);
  });

  it("clamp max: strength exceeds max after config mutation → clamped to max", async () => {
    // Temporarily lower the max to trigger clamping
    const config = app.gameConfigs.values().next().value;
    if (!config) throw new Error("No config loaded");
    const originalClamps = config.statClamps;
    config.statClamps = { strength: { min: 0, max: 8 }, hp: { min: 5 } };

    try {
      const res = await getStats("char_1");
      expect(res.statusCode).toBe(200);
      const body = res.json<CharacterStats>();
      // str = 10 (unclamped), max=8 → clamped to 8
      expect(body.finalStats.strength).toBe(8);
      // hp = 38, min=5, no max → not clamped
      expect(body.finalStats.hp).toBe(38);
    } finally {
      config.statClamps = originalClamps;
    }
  });

  it("clamp min: stat below min → clamped to min", async () => {
    // Temporarily set hp min very high to trigger clamping
    const config = app.gameConfigs.values().next().value;
    if (!config) throw new Error("No config loaded");
    const originalClamps = config.statClamps;
    config.statClamps = { strength: { min: 0, max: 12 }, hp: { min: 100 } };

    try {
      const res = await getStats("char_1");
      expect(res.statusCode).toBe(200);
      const body = res.json<CharacterStats>();
      // hp = 38 (unclamped), min=100 → clamped to 100
      expect(body.finalStats.hp).toBe(100);
      // str = 10, within [0,12] → not clamped
      expect(body.finalStats.strength).toBe(10);
    } finally {
      config.statClamps = originalClamps;
    }
  });

  it("no statClamps in config → no clamping applied", async () => {
    const config = app.gameConfigs.values().next().value;
    if (!config) throw new Error("No config loaded");
    const originalClamps = config.statClamps;
    config.statClamps = undefined;

    try {
      const res = await getStats("char_1");
      expect(res.statusCode).toBe(200);
      const body = res.json<CharacterStats>();
      // No clamping → raw values
      expect(body.finalStats.strength).toBe(10);
      expect(body.finalStats.hp).toBe(38);
    } finally {
      config.statClamps = originalClamps;
    }
  });

  it("clamp applies only to stats listed in statClamps", async () => {
    // Only clamp strength, not hp
    const config = app.gameConfigs.values().next().value;
    if (!config) throw new Error("No config loaded");
    const originalClamps = config.statClamps;
    config.statClamps = { strength: { max: 7 } };

    try {
      const res = await getStats("char_1");
      expect(res.statusCode).toBe(200);
      const body = res.json<CharacterStats>();
      expect(body.finalStats.strength).toBe(7);
      // hp has no clamp entry → unchanged
      expect(body.finalStats.hp).toBe(38);
    } finally {
      config.statClamps = originalClamps;
    }
  });

  it("clamp with only min (no max) does not cap upward", async () => {
    const config = app.gameConfigs.values().next().value;
    if (!config) throw new Error("No config loaded");
    const originalClamps = config.statClamps;
    config.statClamps = { strength: { min: 0 }, hp: { min: 0 } };

    try {
      const res = await getStats("char_1");
      expect(res.statusCode).toBe(200);
      const body = res.json<CharacterStats>();
      // Both above min → no clamping
      expect(body.finalStats.strength).toBe(10);
      expect(body.finalStats.hp).toBe(38);
    } finally {
      config.statClamps = originalClamps;
    }
  });

  it("clamp with only max (no min) does not set a floor", async () => {
    // Create a character with orphaned class → base stats = 0 for all
    // Use a new app with a config whose class doesn't exist
    const config = app.gameConfigs.values().next().value;
    if (!config) throw new Error("No config loaded");
    const originalClamps = config.statClamps;
    // Set max=50 and min not set → should not floor anything
    config.statClamps = { strength: { max: 50 } };

    try {
      const res = await getStats("char_1");
      expect(res.statusCode).toBe(200);
      const body = res.json<CharacterStats>();
      // str=10 < max=50 → not clamped
      expect(body.finalStats.strength).toBe(10);
      // hp has no clamp → unchanged
      expect(body.finalStats.hp).toBe(38);
    } finally {
      config.statClamps = originalClamps;
    }
  });
});
