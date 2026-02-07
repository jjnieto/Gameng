import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  computeLevelCost,
  computeTotalCost,
  hasResources,
  deductResources,
} from "../src/algorithms/level-cost.js";
import { createApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Unit tests — level cost algorithms
// ---------------------------------------------------------------------------

describe("Level cost algorithms — unit tests", () => {
  describe("flat / free", () => {
    it("flat returns empty cost at any level", () => {
      expect(computeLevelCost(5, { algorithmId: "flat" })).toEqual({});
    });

    it("free is an alias for flat", () => {
      expect(computeLevelCost(5, { algorithmId: "free" })).toEqual({});
    });

    it("flat total cost for multi-level is empty", () => {
      expect(computeTotalCost(1, 5, { algorithmId: "flat" })).toEqual({});
    });
  });

  describe("linear_cost", () => {
    const params = { resourceId: "xp", base: 100, perLevel: 50 };

    it("level 1 target returns empty (defensive)", () => {
      expect(
        computeLevelCost(1, { algorithmId: "linear_cost", params }),
      ).toEqual({});
    });

    it("level 2 target: cost = base + perLevel*(2-2) = base", () => {
      expect(
        computeLevelCost(2, { algorithmId: "linear_cost", params }),
      ).toEqual({ xp: 100 });
    });

    it("level 3 target: cost = 100 + 50*1 = 150", () => {
      expect(
        computeLevelCost(3, { algorithmId: "linear_cost", params }),
      ).toEqual({ xp: 150 });
    });

    it("level 5 target: cost = 100 + 50*3 = 250", () => {
      expect(
        computeLevelCost(5, { algorithmId: "linear_cost", params }),
      ).toEqual({ xp: 250 });
    });

    it("multi-level: level 1→4 (3 levels)", () => {
      // target 2: 100, target 3: 150, target 4: 200. Total: 450
      const total = computeTotalCost(1, 3, {
        algorithmId: "linear_cost",
        params,
      });
      expect(total).toEqual({ xp: 450 });
    });

    it("multi-level: level 3→6 (3 levels)", () => {
      // target 4: 200, target 5: 250, target 6: 300. Total: 750
      const total = computeTotalCost(3, 3, {
        algorithmId: "linear_cost",
        params,
      });
      expect(total).toEqual({ xp: 750 });
    });

    it("throws on missing resourceId", () => {
      expect(() =>
        computeLevelCost(2, {
          algorithmId: "linear_cost",
          params: { base: 100, perLevel: 50 },
        }),
      ).toThrow("resourceId");
    });

    it("throws on missing base", () => {
      expect(() =>
        computeLevelCost(2, {
          algorithmId: "linear_cost",
          params: { resourceId: "xp", perLevel: 50 },
        }),
      ).toThrow("base");
    });

    it("throws on missing perLevel", () => {
      expect(() =>
        computeLevelCost(2, {
          algorithmId: "linear_cost",
          params: { resourceId: "xp", base: 100 },
        }),
      ).toThrow("perLevel");
    });
  });

  describe("unknown algorithmId", () => {
    it("throws on unknown algorithmId", () => {
      expect(() =>
        computeLevelCost(2, { algorithmId: "bogus" }),
      ).toThrow("Unknown level cost algorithmId");
    });
  });

  describe("hasResources / deductResources", () => {
    it("empty cost always passes", () => {
      expect(hasResources({}, {})).toBe(true);
      expect(hasResources({ xp: 0 }, {})).toBe(true);
    });

    it("returns true when wallet has enough", () => {
      expect(hasResources({ xp: 100, gold: 50 }, { xp: 100 })).toBe(true);
    });

    it("returns false when wallet is short", () => {
      expect(hasResources({ xp: 50 }, { xp: 100 })).toBe(false);
    });

    it("returns false for missing resource key", () => {
      expect(hasResources({}, { xp: 1 })).toBe(false);
    });

    it("deductResources subtracts correctly", () => {
      const wallet = { xp: 500, gold: 200 };
      deductResources(wallet, { xp: 150, gold: 75 });
      expect(wallet).toEqual({ xp: 350, gold: 125 });
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests — LevelUp cost + GrantResources via tx endpoint
// ---------------------------------------------------------------------------

interface TransactionResult {
  txId: string;
  accepted: boolean;
  stateVersion: number;
  errorCode?: string;
  errorMessage?: string;
}

describe("Level cost — integration tests (config_costs)", () => {
  let app: FastifyInstance;
  const ADMIN_KEY = "test-admin-key-costs";
  const TEST_API_KEY = "test-key-costs";

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
      txId: "cost_setup_actor",
      type: "CreateActor",
      gameInstanceId: "instance_001",
      actorId: "cost_actor",
      apiKey: TEST_API_KEY,
    });

    // Create player
    await postTx({
      txId: "cost_setup_player",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "player_1",
    });

    // Create character (starts at level 1)
    await postTx({
      txId: "cost_create_char",
      type: "CreateCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      classId: "warrior",
    });

    // Create gear (starts at level 1)
    await postTx({
      txId: "cost_create_gear",
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

  // -- GrantResources --

  it("GrantResources adds resources to player", async () => {
    const res = await adminTx({
      txId: "cost_grant_001",
      type: "GrantResources",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      resources: { xp: 500, gold: 300 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(true);

    // Verify resources via player state
    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{ resources: Record<string, number> }>();
    expect(player.resources).toEqual({ xp: 500, gold: 300 });
  });

  it("GrantResources accumulates (second grant)", async () => {
    const res = await adminTx({
      txId: "cost_grant_002",
      type: "GrantResources",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      resources: { xp: 200 },
    });
    expect(res.json<TransactionResult>().accepted).toBe(true);

    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{ resources: Record<string, number> }>();
    expect(player.resources.xp).toBe(700);
    expect(player.resources.gold).toBe(300);
  });

  it("GrantResources rejects nonexistent player", async () => {
    const res = await adminTx({
      txId: "cost_grant_bad",
      type: "GrantResources",
      gameInstanceId: "instance_001",
      playerId: "nobody",
      resources: { xp: 100 },
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(false);
    expect(body.errorCode).toBe("PLAYER_NOT_FOUND");
  });

  it("GrantResources requires admin key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: {
        txId: "cost_grant_unauth",
        type: "GrantResources",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        resources: { xp: 100 },
      },
    });
    expect(res.statusCode).toBe(401);
  });

  // -- LevelUpCharacter with costs --

  it("LevelUpCharacter without resources → INSUFFICIENT_RESOURCES", async () => {
    // Create a second player with no resources to test rejection
    await postTx({
      txId: "cost_setup_player2",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "player_2",
    });

    // Need to associate player_2 with actor
    // player_2 is already associated via CreatePlayer

    await postTx({
      txId: "cost_create_char2",
      type: "CreateCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_2",
      characterId: "char_2",
      classId: "warrior",
    });

    const res = await postTx({
      txId: "cost_lu_no_res",
      type: "LevelUpCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_2",
      characterId: "char_2",
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(false);
    expect(body.errorCode).toBe("INSUFFICIENT_RESOURCES");
  });

  it("LevelUpCharacter with enough resources → accepted, resources deducted", async () => {
    // char_1 is level 1, level up by 1.
    // linear_cost: target=2, cost = 100 + 50*(2-2) = 100 xp
    // player_1 has 700 xp, 300 gold
    const res = await postTx({
      txId: "cost_lu_char_ok",
      type: "LevelUpCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(true);

    // Verify resources deducted: 700 - 100 = 600 xp
    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{ resources: Record<string, number> }>();
    expect(player.resources.xp).toBe(600);
    expect(player.resources.gold).toBe(300); // unchanged
  });

  it("LevelUpCharacter multi-level deducts cumulative cost", async () => {
    // char_1 is now level 2, level up by 3 (to 5).
    // target 3: 100 + 50*1 = 150
    // target 4: 100 + 50*2 = 200
    // target 5: 100 + 50*3 = 250
    // total: 600 xp
    // player_1 has 600 xp → exactly enough
    const res = await postTx({
      txId: "cost_lu_char_multi",
      type: "LevelUpCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      levels: 3,
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(true);

    // Verify: 600 - 600 = 0 xp
    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{ resources: Record<string, number> }>();
    expect(player.resources.xp).toBe(0);
  });

  it("LevelUpCharacter rejected when insufficient for multi-level", async () => {
    // char_1 is now level 5, try levels=2 (to 7).
    // target 6: 100 + 50*4 = 300
    // target 7: 100 + 50*5 = 350
    // total: 650 xp. player_1 has 0 xp → rejected
    const res = await postTx({
      txId: "cost_lu_char_insufficient",
      type: "LevelUpCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      levels: 2,
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(false);
    expect(body.errorCode).toBe("INSUFFICIENT_RESOURCES");
  });

  it("MAX_LEVEL_REACHED still takes priority over cost check", async () => {
    // char_1 is level 5, try levels=6 (to 11, maxLevel=10)
    const res = await postTx({
      txId: "cost_lu_char_max",
      type: "LevelUpCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      levels: 6,
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(false);
    expect(body.errorCode).toBe("MAX_LEVEL_REACHED");
  });

  // -- LevelUpGear with costs --

  it("LevelUpGear without resources → INSUFFICIENT_RESOURCES", async () => {
    // sword_1 is level 1. player_1 has 0 xp, 300 gold.
    // linear_cost for gear: target=2, cost = 50 + 25*(2-2) = 50 gold
    // player_1 has 300 gold → actually enough! Use player_2 instead.
    await postTx({
      txId: "cost_create_gear2",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_2",
      gearId: "sword_2",
      gearDefId: "sword_basic",
    });

    const res = await postTx({
      txId: "cost_lu_gear_no_res",
      type: "LevelUpGear",
      gameInstanceId: "instance_001",
      playerId: "player_2",
      gearId: "sword_2",
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(false);
    expect(body.errorCode).toBe("INSUFFICIENT_RESOURCES");
  });

  it("LevelUpGear with enough resources → accepted, gold deducted", async () => {
    // sword_1 is level 1. levelCostGear: linear_cost with resourceId=gold, base=50, perLevel=25.
    // target=2: cost = 50 + 25*(2-2) = 50 gold
    // player_1 has 300 gold
    const res = await postTx({
      txId: "cost_lu_gear_ok",
      type: "LevelUpGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "sword_1",
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(true);

    // Verify: 300 - 50 = 250 gold
    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{ resources: Record<string, number> }>();
    expect(player.resources.gold).toBe(250);
  });

  it("LevelUpGear multi-level deducts cumulative cost", async () => {
    // sword_1 is now level 2, level up by 2 (to 4).
    // target 3: 50 + 25*1 = 75
    // target 4: 50 + 25*2 = 100
    // total: 175 gold. player_1 has 250 → enough
    const res = await postTx({
      txId: "cost_lu_gear_multi",
      type: "LevelUpGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "sword_1",
      levels: 2,
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(true);

    // 250 - 175 = 75 gold
    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{ resources: Record<string, number> }>();
    expect(player.resources.gold).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// Backward compat — flat cost (config_minimal) still works freely
// ---------------------------------------------------------------------------

describe("Level cost — backward compat (flat cost = free)", () => {
  let app: FastifyInstance;
  const ADMIN_KEY = "test-admin-key-flat-cost";
  const TEST_API_KEY = "test-key-flat-cost";

  beforeAll(async () => {
    app = createApp({ adminApiKey: ADMIN_KEY });
    await app.ready();

    await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      payload: {
        txId: "flat_cost_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "flat_actor",
        apiKey: TEST_API_KEY,
      },
    });

    await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: {
        txId: "flat_cost_player",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_1",
      },
    });

    await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: {
        txId: "flat_cost_char",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        classId: "warrior",
      },
    });

    await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: {
        txId: "flat_cost_gear",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "sword_1",
        gearDefId: "sword_basic",
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("LevelUpCharacter succeeds without resources (flat=free)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: {
        txId: "flat_lu_char",
        type: "LevelUpCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        levels: 3,
      },
    });
    expect(res.json<TransactionResult>().accepted).toBe(true);
  });

  it("LevelUpGear succeeds without resources (flat=free)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: {
        txId: "flat_lu_gear",
        type: "LevelUpGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "sword_1",
        levels: 2,
      },
    });
    expect(res.json<TransactionResult>().accepted).toBe(true);
  });
});
