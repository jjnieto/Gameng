import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  computeLevelCost,
  computeTotalCost,
  hasResources,
  deductResources,
  parseScopedCost,
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

  describe("mixed_linear_cost", () => {
    const params = {
      costs: [
        { scope: "character", resourceId: "xp", base: 100, perLevel: 50 },
        { scope: "player", resourceId: "gold", base: 10, perLevel: 5 },
      ],
    };

    it("level 1 target returns empty", () => {
      expect(
        computeLevelCost(1, { algorithmId: "mixed_linear_cost", params }),
      ).toEqual({});
    });

    it("level 2 target produces both prefixed keys", () => {
      const cost = computeLevelCost(2, {
        algorithmId: "mixed_linear_cost",
        params,
      });
      expect(cost).toEqual({ "character.xp": 100, "player.gold": 10 });
    });

    it("level 4 target: correct calculation", () => {
      // xp: 100 + 50*2 = 200, gold: 10 + 5*2 = 20
      const cost = computeLevelCost(4, {
        algorithmId: "mixed_linear_cost",
        params,
      });
      expect(cost).toEqual({ "character.xp": 200, "player.gold": 20 });
    });

    it("multi-level: total from 1→3", () => {
      // target 2: xp=100, gold=10; target 3: xp=150, gold=15. Totals: xp=250, gold=25
      const total = computeTotalCost(1, 2, {
        algorithmId: "mixed_linear_cost",
        params,
      });
      expect(total).toEqual({ "character.xp": 250, "player.gold": 25 });
    });

    it("throws on missing costs array", () => {
      expect(() =>
        computeLevelCost(2, {
          algorithmId: "mixed_linear_cost",
          params: {},
        }),
      ).toThrow("costs");
    });

    it("throws on invalid scope", () => {
      expect(() =>
        computeLevelCost(2, {
          algorithmId: "mixed_linear_cost",
          params: { costs: [{ scope: "global", resourceId: "xp", base: 1, perLevel: 1 }] },
        }),
      ).toThrow("scope");
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

  describe("parseScopedCost", () => {
    it("parses player-prefixed keys", () => {
      const scoped = parseScopedCost({ "player.gold": 100, "player.gems": 5 });
      expect(scoped).toEqual({
        player: { gold: 100, gems: 5 },
        character: {},
      });
    });

    it("parses character-prefixed keys", () => {
      const scoped = parseScopedCost({ "character.xp": 200 });
      expect(scoped).toEqual({
        player: {},
        character: { xp: 200 },
      });
    });

    it("parses mixed keys", () => {
      const scoped = parseScopedCost({
        "player.gold": 50,
        "character.xp": 100,
      });
      expect(scoped).toEqual({
        player: { gold: 50 },
        character: { xp: 100 },
      });
    });

    it("returns empty scopes for empty cost", () => {
      const scoped = parseScopedCost({});
      expect(scoped).toEqual({ player: {}, character: {} });
    });

    it("throws on unprefixed key", () => {
      expect(() => parseScopedCost({ gold: 100 })).toThrow(
        "Invalid cost resource key",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Integration tests — LevelUp cost + GrantResources via tx endpoint
// (config_costs.json now uses prefixed keys: character.xp, player.gold)
// ---------------------------------------------------------------------------

interface TransactionResult {
  txId: string;
  accepted: boolean;
  stateVersion: number;
  errorCode?: string;
  errorMessage?: string;
}

describe("Level cost — integration tests (config_costs, scoped)", () => {
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

  // -- GrantResources (player gold) --

  it("GrantResources adds gold to player", async () => {
    const res = await adminTx({
      txId: "cost_grant_001",
      type: "GrantResources",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      resources: { gold: 300 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(true);

    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{ resources: Record<string, number> }>();
    expect(player.resources).toEqual({ gold: 300 });
  });

  // -- GrantCharacterResources (character xp) --

  it("GrantCharacterResources adds xp to character", async () => {
    const res = await adminTx({
      txId: "cost_gcr_001",
      type: "GrantCharacterResources",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      resources: { xp: 700 },
    });
    expect(res.json<TransactionResult>().accepted).toBe(true);
  });

  it("GrantResources accumulates (second grant)", async () => {
    const res = await adminTx({
      txId: "cost_grant_002",
      type: "GrantResources",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      resources: { gold: 200 },
    });
    expect(res.json<TransactionResult>().accepted).toBe(true);

    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{ resources: Record<string, number> }>();
    expect(player.resources.gold).toBe(500);
  });

  it("GrantResources rejects nonexistent player", async () => {
    const res = await adminTx({
      txId: "cost_grant_bad",
      type: "GrantResources",
      gameInstanceId: "instance_001",
      playerId: "nobody",
      resources: { gold: 100 },
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
        resources: { gold: 100 },
      },
    });
    expect(res.statusCode).toBe(401);
  });

  // -- LevelUpCharacter with scoped costs (character.xp) --

  it("LevelUpCharacter without resources → INSUFFICIENT_RESOURCES", async () => {
    await postTx({
      txId: "cost_setup_player2",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "player_2",
    });

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

  it("LevelUpCharacter with enough resources → accepted, xp deducted from character", async () => {
    // char_1 is level 1, level up by 1.
    // linear_cost: resourceId=character.xp, target=2, cost = 100 + 50*(2-2) = 100
    // char_1 has 700 xp
    const res = await postTx({
      txId: "cost_lu_char_ok",
      type: "LevelUpCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(true);

    // Verify character xp deducted: 700 - 100 = 600
    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{
      resources: Record<string, number>;
      characters: Record<string, { resources?: Record<string, number> }>;
    }>();
    expect(player.characters["char_1"].resources?.xp).toBe(600);
    // Player gold unchanged
    expect(player.resources.gold).toBe(500);
  });

  it("LevelUpCharacter multi-level deducts cumulative cost", async () => {
    // char_1 is now level 2, level up by 3 (to 5).
    // target 3: 100 + 50*1 = 150
    // target 4: 100 + 50*2 = 200
    // target 5: 100 + 50*3 = 250
    // total: 600 xp. char_1 has 600 xp → exactly enough
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

    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{
      characters: Record<string, { resources?: Record<string, number> }>;
    }>();
    expect(player.characters["char_1"].resources?.xp).toBe(0);
  });

  it("LevelUpCharacter rejected when insufficient for multi-level", async () => {
    // char_1 is now level 5, try levels=2.
    // char_1 has 0 xp → rejected
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

  // -- LevelUpGear with scoped costs (player.gold) --

  it("LevelUpGear without resources → INSUFFICIENT_RESOURCES", async () => {
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

  it("LevelUpGear with enough resources → accepted, gold deducted from player", async () => {
    // sword_1 is level 1. levelCostGear: linear_cost with resourceId=player.gold, base=50, perLevel=25.
    // target=2: cost = 50 gold. player_1 has 500 gold
    const res = await postTx({
      txId: "cost_lu_gear_ok",
      type: "LevelUpGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "sword_1",
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(true);

    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{ resources: Record<string, number> }>();
    expect(player.resources.gold).toBe(450);
  });

  it("LevelUpGear multi-level deducts cumulative cost", async () => {
    // sword_1 is now level 2, level up by 2 (to 4).
    // target 3: 50 + 25*1 = 75, target 4: 50 + 25*2 = 100. Total: 175 gold.
    // player_1 has 450 gold → enough
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

    const playerRes = await app.inject({
      method: "GET",
      url: "/instance_001/state/player/player_1",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    const player = playerRes.json<{ resources: Record<string, number> }>();
    expect(player.resources.gold).toBe(275);
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
