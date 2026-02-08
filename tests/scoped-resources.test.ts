import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TransactionResult {
  txId: string;
  accepted: boolean;
  stateVersion: number;
  errorCode?: string;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Slice A: GrantCharacterResources + Character.resources
// ---------------------------------------------------------------------------

describe("Scoped Resources — Slice A (GrantCharacterResources)", () => {
  let app: FastifyInstance;
  const ADMIN_KEY = "test-admin-scoped-a";
  const TEST_API_KEY = "test-key-scoped-a";

  function adminTx(payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      payload,
    });
  }

  function postTx(payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload,
    });
  }

  beforeAll(async () => {
    app = createApp({
      configPath: "examples/config_costs.json",
      adminApiKey: ADMIN_KEY,
    });
    await app.ready();

    // Bootstrap actor
    await adminTx({
      txId: "scoped_a_actor",
      type: "CreateActor",
      gameInstanceId: "instance_001",
      actorId: "scoped_actor",
      apiKey: TEST_API_KEY,
    });

    // Create player
    await postTx({
      txId: "scoped_a_player",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "player_1",
    });

    // Create character
    await postTx({
      txId: "scoped_a_char",
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

  // -- CreateCharacter initializes resources = {} --

  it("CreateCharacter initializes character with resources={}", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = res.json<{
      characters: Record<string, { resources?: Record<string, number> }>;
    }>();
    expect(player.characters["char_1"].resources).toEqual({});
  });

  // -- GrantCharacterResources: accepted --

  it("GrantCharacterResources adds resources to character", async () => {
    const res = await adminTx({
      txId: "gcr_add_001",
      type: "GrantCharacterResources",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      resources: { xp: 500 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(true);

    // Verify via player state
    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{
      characters: Record<string, { resources?: Record<string, number> }>;
    }>();
    expect(player.characters["char_1"].resources).toEqual({ xp: 500 });
  });

  // -- GrantCharacterResources: accumulates --

  it("GrantCharacterResources accumulates (second grant)", async () => {
    const res = await adminTx({
      txId: "gcr_add_002",
      type: "GrantCharacterResources",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      resources: { xp: 200, mp: 100 },
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(true);

    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{
      characters: Record<string, { resources?: Record<string, number> }>;
    }>();
    expect(player.characters["char_1"].resources).toEqual({ xp: 700, mp: 100 });
  });

  // -- GrantCharacterResources: requires admin key --

  it("GrantCharacterResources requires admin key (401)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: {
        txId: "gcr_unauth",
        type: "GrantCharacterResources",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        resources: { xp: 100 },
      },
    });
    expect(res.statusCode).toBe(401);
  });

  // -- GrantCharacterResources: PLAYER_NOT_FOUND --

  it("GrantCharacterResources rejects nonexistent player", async () => {
    const res = await adminTx({
      txId: "gcr_no_player",
      type: "GrantCharacterResources",
      gameInstanceId: "instance_001",
      playerId: "nobody",
      characterId: "char_1",
      resources: { xp: 100 },
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(false);
    expect(body.errorCode).toBe("PLAYER_NOT_FOUND");
  });

  // -- GrantCharacterResources: CHARACTER_NOT_FOUND --

  it("GrantCharacterResources rejects nonexistent character", async () => {
    const res = await adminTx({
      txId: "gcr_no_char",
      type: "GrantCharacterResources",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "no_such_char",
      resources: { xp: 100 },
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(false);
    expect(body.errorCode).toBe("CHARACTER_NOT_FOUND");
  });

  // -- GrantCharacterResources does NOT affect player.resources --

  it("GrantCharacterResources does not touch player.resources", async () => {
    // Grant some player resources first
    await adminTx({
      txId: "gcr_p_gold",
      type: "GrantResources",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      resources: { gold: 999 },
    });

    // Grant character resources
    await adminTx({
      txId: "gcr_c_xp_extra",
      type: "GrantCharacterResources",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      resources: { xp: 1 },
    });

    // Verify player resources untouched
    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{
      resources?: Record<string, number>;
      characters: Record<string, { resources?: Record<string, number> }>;
    }>();
    expect(player.resources).toEqual({ gold: 999 });
    // char_1: accumulated xp = 700 + 1 = 701
    expect(player.characters["char_1"].resources?.xp).toBe(701);
  });
});

// ---------------------------------------------------------------------------
// Slice A: Migration adds resources={} to legacy characters
// ---------------------------------------------------------------------------

describe("Scoped Resources — migration normalizes character resources", () => {
  it("migrateStateToConfig adds resources={} to legacy characters", async () => {
    // Dynamically import to avoid ESM resolution issues at top level
    const { migrateStateToConfig } = await import("../src/migrator.js");
    const { readFileSync } = await import("node:fs");

    const config = JSON.parse(
      readFileSync("examples/config_costs.json", "utf-8"),
    ) as import("../src/state.js").GameConfig;

    // Build a legacy state with characters that lack resources
    const legacyState: import("../src/state.js").GameState = {
      gameInstanceId: "inst_legacy",
      gameConfigId: "old_config",
      stateVersion: 5,
      players: {
        p1: {
          characters: {
            c1: { classId: "warrior", level: 3, equipped: {} },
            c2: { classId: "warrior", level: 1, equipped: {} },
          },
          gear: {},
          resources: { gold: 50 },
        },
      },
      actors: {},
      txIdCache: [],
    };

    const { migratedState } = migrateStateToConfig(legacyState, config);

    // Both characters should have resources: {}
    expect(migratedState.players["p1"].characters["c1"].resources).toEqual({});
    expect(migratedState.players["p1"].characters["c2"].resources).toEqual({});
    // Player resources untouched
    expect(migratedState.players["p1"].resources).toEqual({ gold: 50 });
  });

  it("migrateStateToConfig preserves existing character resources", async () => {
    const { migrateStateToConfig } = await import("../src/migrator.js");
    const { readFileSync } = await import("node:fs");

    const config = JSON.parse(
      readFileSync("examples/config_costs.json", "utf-8"),
    ) as import("../src/state.js").GameConfig;

    const stateWithResources: import("../src/state.js").GameState = {
      gameInstanceId: "inst_res",
      gameConfigId: "old_config",
      stateVersion: 1,
      players: {
        p1: {
          characters: {
            c1: { classId: "warrior", level: 2, equipped: {}, resources: { xp: 100 } },
          },
          gear: {},
        },
      },
      actors: {},
      txIdCache: [],
    };

    const { migratedState } = migrateStateToConfig(stateWithResources, config);
    expect(migratedState.players["p1"].characters["c1"].resources).toEqual({ xp: 100 });
  });
});

// ---------------------------------------------------------------------------
// Slice B: Scoped LevelUp with mixed_linear_cost
// ---------------------------------------------------------------------------

describe("Scoped Resources — Slice B (mixed_linear_cost + scoped LevelUp)", () => {
  let app: FastifyInstance;
  const ADMIN_KEY = "test-admin-scoped-b";
  const TEST_API_KEY = "test-key-scoped-b";

  function adminTx(payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      payload,
    });
  }

  function postTx(payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload,
    });
  }

  beforeAll(async () => {
    // config_scoped_costs uses mixed_linear_cost for levelCostCharacter:
    //   character.xp: base=100 perLevel=50
    //   player.gold: base=10 perLevel=5
    // levelCostGear uses linear_cost with player.gold: base=50 perLevel=25
    app = createApp({
      configPath: "examples/config_scoped_costs.json",
      adminApiKey: ADMIN_KEY,
    });
    await app.ready();

    await adminTx({
      txId: "sb_actor", type: "CreateActor",
      gameInstanceId: "instance_001", actorId: "sb_actor", apiKey: TEST_API_KEY,
    });
    await postTx({
      txId: "sb_player", type: "CreatePlayer",
      gameInstanceId: "instance_001", playerId: "player_1",
    });
    await postTx({
      txId: "sb_char", type: "CreateCharacter",
      gameInstanceId: "instance_001", playerId: "player_1",
      characterId: "char_1", classId: "warrior",
    });
    await postTx({
      txId: "sb_gear", type: "CreateGear",
      gameInstanceId: "instance_001", playerId: "player_1",
      gearId: "sword_1", gearDefId: "sword_basic",
    });

    // Grant resources
    await adminTx({
      txId: "sb_grant_gold", type: "GrantResources",
      gameInstanceId: "instance_001", playerId: "player_1",
      resources: { gold: 500 },
    });
    await adminTx({
      txId: "sb_grant_xp", type: "GrantCharacterResources",
      gameInstanceId: "instance_001", playerId: "player_1",
      characterId: "char_1", resources: { xp: 1000 },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("LevelUpCharacter with mixed costs deducts from both wallets", async () => {
    // Level 1→2: character.xp=100, player.gold=10
    const res = await postTx({
      txId: "sb_lu_char1", type: "LevelUpCharacter",
      gameInstanceId: "instance_001", playerId: "player_1",
      characterId: "char_1",
    });
    expect(res.json<TransactionResult>().accepted).toBe(true);

    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{
      resources: Record<string, number>;
      characters: Record<string, { resources?: Record<string, number> }>;
    }>();
    expect(player.characters["char_1"].resources?.xp).toBe(900); // 1000 - 100
    expect(player.resources.gold).toBe(490); // 500 - 10
  });

  it("LevelUpCharacter multi-level with mixed costs", async () => {
    // Level 2→4 (2 levels):
    // target 3: xp=150, gold=15; target 4: xp=200, gold=20
    // Total: xp=350, gold=35
    const res = await postTx({
      txId: "sb_lu_char2", type: "LevelUpCharacter",
      gameInstanceId: "instance_001", playerId: "player_1",
      characterId: "char_1", levels: 2,
    });
    expect(res.json<TransactionResult>().accepted).toBe(true);

    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{
      resources: Record<string, number>;
      characters: Record<string, { resources?: Record<string, number> }>;
    }>();
    expect(player.characters["char_1"].resources?.xp).toBe(550); // 900 - 350
    expect(player.resources.gold).toBe(455); // 490 - 35
  });

  it("LevelUpCharacter INSUFFICIENT from character wallet", async () => {
    // Drain character xp
    await adminTx({
      txId: "sb_drain_xp", type: "GrantCharacterResources",
      gameInstanceId: "instance_001", playerId: "player_1",
      characterId: "char_1", resources: { xp: -550 },
    });

    const res = await postTx({
      txId: "sb_lu_char_no_xp", type: "LevelUpCharacter",
      gameInstanceId: "instance_001", playerId: "player_1",
      characterId: "char_1",
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(false);
    expect(body.errorCode).toBe("INSUFFICIENT_RESOURCES");
  });

  it("LevelUpGear (player-only cost) works without characterId", async () => {
    const res = await postTx({
      txId: "sb_lu_gear1", type: "LevelUpGear",
      gameInstanceId: "instance_001", playerId: "player_1",
      gearId: "sword_1",
    });
    expect(res.json<TransactionResult>().accepted).toBe(true);

    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{ resources: Record<string, number> }>();
    // 455 - 50 = 405
    expect(player.resources.gold).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// Slice B: INVALID_COST_RESOURCE_KEY + CHARACTER_REQUIRED
// ---------------------------------------------------------------------------

describe("Scoped Resources — error codes", () => {
  it("INVALID_COST_RESOURCE_KEY for unprefixed resourceId in config", async () => {
    // Inline config with unprefixed resourceId
    const { createApp: createAppFn } = await import("../src/app.js");
    const { writeFileSync, mkdirSync, existsSync } = await import("node:fs");
    const tmpDir = "C:\\Users\\jjnie\\AppData\\Local\\Temp\\claude\\D--Gameng\\a1c6ae59-a0ab-4e48-9c40-1bef32feb9b2\\scratchpad";
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

    const badConfig = {
      gameConfigId: "bad_unprefixed",
      maxLevel: 10,
      stats: ["strength"],
      slots: ["right_hand"],
      classes: { warrior: { baseStats: { strength: 5 } } },
      gearDefs: {},
      sets: {},
      algorithms: {
        growth: { algorithmId: "flat", params: {} },
        levelCostCharacter: {
          algorithmId: "linear_cost",
          params: { resourceId: "xp", base: 100, perLevel: 50 },
        },
        levelCostGear: { algorithmId: "flat", params: {} },
      },
    };
    const configPath = `${tmpDir}/config_bad_prefix.json`;
    writeFileSync(configPath, JSON.stringify(badConfig));

    const badApp = createAppFn({
      configPath,
      adminApiKey: "bad-admin",
    });
    await badApp.ready();

    // Setup
    await badApp.inject({
      method: "POST", url: "/instance_001/tx",
      headers: { authorization: "Bearer bad-admin" },
      payload: {
        txId: "bad1", type: "CreateActor",
        gameInstanceId: "instance_001", actorId: "a1", apiKey: "k1",
      },
    });
    await badApp.inject({
      method: "POST", url: "/instance_001/tx",
      headers: { authorization: "Bearer k1" },
      payload: {
        txId: "bad2", type: "CreatePlayer",
        gameInstanceId: "instance_001", playerId: "p1",
      },
    });
    await badApp.inject({
      method: "POST", url: "/instance_001/tx",
      headers: { authorization: "Bearer k1" },
      payload: {
        txId: "bad3", type: "CreateCharacter",
        gameInstanceId: "instance_001", playerId: "p1",
        characterId: "c1", classId: "warrior",
      },
    });

    const res = await badApp.inject({
      method: "POST", url: "/instance_001/tx",
      headers: { authorization: "Bearer k1" },
      payload: {
        txId: "bad4", type: "LevelUpCharacter",
        gameInstanceId: "instance_001", playerId: "p1",
        characterId: "c1",
      },
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(false);
    expect(body.errorCode).toBe("INVALID_COST_RESOURCE_KEY");

    await badApp.close();
  });

  it("CHARACTER_REQUIRED for LevelUpGear with character-scoped cost and no characterId", async () => {
    const { createApp: createAppFn } = await import("../src/app.js");
    const { writeFileSync, existsSync, mkdirSync } = await import("node:fs");
    const tmpDir = "C:\\Users\\jjnie\\AppData\\Local\\Temp\\claude\\D--Gameng\\a1c6ae59-a0ab-4e48-9c40-1bef32feb9b2\\scratchpad";
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

    // Config where gear cost includes character-scoped resource
    const charGearConfig = {
      gameConfigId: "char_gear_cost",
      maxLevel: 10,
      stats: ["strength"],
      slots: ["right_hand"],
      classes: { warrior: { baseStats: { strength: 5 } } },
      gearDefs: { sword: { baseStats: { strength: 3 }, equipPatterns: [["right_hand"]] } },
      sets: {},
      algorithms: {
        growth: { algorithmId: "flat", params: {} },
        levelCostCharacter: { algorithmId: "flat", params: {} },
        levelCostGear: {
          algorithmId: "mixed_linear_cost",
          params: { costs: [
            { scope: "character", resourceId: "mats", base: 10, perLevel: 5 },
            { scope: "player", resourceId: "gold", base: 5, perLevel: 2 },
          ] },
        },
      },
    };
    const cfgPath = `${tmpDir}/config_char_gear.json`;
    writeFileSync(cfgPath, JSON.stringify(charGearConfig));

    const cgApp = createAppFn({ configPath: cfgPath, adminApiKey: "cg-admin" });
    await cgApp.ready();

    await cgApp.inject({ method: "POST", url: "/instance_001/tx",
      headers: { authorization: "Bearer cg-admin" },
      payload: { txId: "cg1", type: "CreateActor", gameInstanceId: "instance_001", actorId: "a1", apiKey: "k1" },
    });
    await cgApp.inject({ method: "POST", url: "/instance_001/tx",
      headers: { authorization: "Bearer k1" },
      payload: { txId: "cg2", type: "CreatePlayer", gameInstanceId: "instance_001", playerId: "p1" },
    });
    await cgApp.inject({ method: "POST", url: "/instance_001/tx",
      headers: { authorization: "Bearer k1" },
      payload: { txId: "cg3", type: "CreateGear", gameInstanceId: "instance_001", playerId: "p1", gearId: "g1", gearDefId: "sword" },
    });

    // Try LevelUpGear without characterId
    const res = await cgApp.inject({ method: "POST", url: "/instance_001/tx",
      headers: { authorization: "Bearer k1" },
      payload: { txId: "cg4", type: "LevelUpGear", gameInstanceId: "instance_001", playerId: "p1", gearId: "g1" },
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(false);
    expect(body.errorCode).toBe("CHARACTER_REQUIRED");

    await cgApp.close();
  });
});
