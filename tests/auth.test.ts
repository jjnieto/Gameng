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

describe("Authorization — ADMIN_API_KEY not configured", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // No adminApiKey passed — admin operations must fail
    app = createApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("CreateActor fails with 401 UNAUTHORIZED when ADMIN_API_KEY is not configured", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: "Bearer some-key" },
      payload: {
        txId: "no_admin_ca",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "actor_1",
        apiKey: "key_1",
      },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ errorCode: string }>();
    expect(body.errorCode).toBe("UNAUTHORIZED");
  });

  it("GrantResources fails with 401 UNAUTHORIZED when ADMIN_API_KEY is not configured", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: "Bearer some-key" },
      payload: {
        txId: "no_admin_gr",
        type: "GrantResources",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        resources: { gold: 100 },
      },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json<{ errorCode: string }>();
    expect(body.errorCode).toBe("UNAUTHORIZED");
  });
});

describe("Authorization — API Key (Bearer Token)", () => {
  let app: FastifyInstance;
  const ADMIN_KEY = "test-admin-key-auth";
  const TEST_API_KEY = "test-key-auth";

  function postTx(
    payload: Record<string, unknown>,
    headers?: Record<string, string>,
  ) {
    return app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers,
      payload,
    });
  }

  function postTxAuth(payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload,
    });
  }

  function postTxAdmin(payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      payload,
    });
  }

  beforeAll(async () => {
    app = createApp({ adminApiKey: ADMIN_KEY });
    await app.ready();

    // Bootstrap actor (requires admin key)
    const res = await postTxAdmin({
      txId: "auth_setup_actor",
      type: "CreateActor",
      gameInstanceId: "instance_001",
      actorId: "test_actor",
      apiKey: TEST_API_KEY,
    });
    expect(res.json<TransactionResult>().accepted).toBe(true);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("CreateActor", () => {
    it("happy path — creates actor with admin key", async () => {
      const res = await postTxAdmin({
        txId: "auth_ca_001",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "actor_new",
        apiKey: "new-key",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);
    });

    it("CreateActor without Authorization → 401", async () => {
      const res = await postTx({
        txId: "auth_ca_no_header",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "actor_blocked",
        apiKey: "blocked-key",
      });

      expect(res.statusCode).toBe(401);
      const body = res.json<{ errorCode: string }>();
      expect(body.errorCode).toBe("UNAUTHORIZED");
    });

    it("CreateActor with valid actor token (not admin) → 401", async () => {
      const res = await postTx(
        {
          txId: "auth_ca_wrong_key",
          type: "CreateActor",
          gameInstanceId: "instance_001",
          actorId: "actor_blocked_2",
          apiKey: "blocked-key-2",
        },
        { authorization: `Bearer ${TEST_API_KEY}` },
      );

      expect(res.statusCode).toBe(401);
      const body = res.json<{ errorCode: string }>();
      expect(body.errorCode).toBe("UNAUTHORIZED");
    });

    it("duplicate actorId → ALREADY_EXISTS", async () => {
      const res = await postTxAdmin({
        txId: "auth_ca_002",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "test_actor",
        apiKey: "different-key",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("ALREADY_EXISTS");
    });

    it("duplicate apiKey → DUPLICATE_API_KEY", async () => {
      const res = await postTxAdmin({
        txId: "auth_ca_003",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "actor_dup_key",
        apiKey: TEST_API_KEY,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("DUPLICATE_API_KEY");
    });
  });

  describe("CreatePlayer assigns ownership", () => {
    it("CreatePlayer auto-associates playerId to actor", async () => {
      const res = await postTxAuth({
        txId: "auth_cp_001",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_auth_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);

      // Verify ownership by successfully getting player state
      const getRes = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_auth_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });
      expect(getRes.statusCode).toBe(200);
    });
  });

  describe("TX without auth → 401", () => {
    it("rejects TX without Authorization header", async () => {
      const res = await postTx({
        txId: "auth_noauth_001",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_noauth",
      });

      expect(res.statusCode).toBe(401);
      const body = res.json<{ errorCode: string }>();
      expect(body.errorCode).toBe("UNAUTHORIZED");
    });

    it("rejects TX with invalid Bearer token", async () => {
      const res = await postTx(
        {
          txId: "auth_badtoken_001",
          type: "CreatePlayer",
          gameInstanceId: "instance_001",
          playerId: "player_badtoken",
        },
        { authorization: "Bearer invalid-token-xyz" },
      );

      expect(res.statusCode).toBe(401);
      const body = res.json<{ errorCode: string }>();
      expect(body.errorCode).toBe("UNAUTHORIZED");
    });

    it("rejects TX with malformed header (no Bearer prefix)", async () => {
      const res = await postTx(
        {
          txId: "auth_malformed_001",
          type: "CreatePlayer",
          gameInstanceId: "instance_001",
          playerId: "player_malformed",
        },
        { authorization: TEST_API_KEY },
      );

      expect(res.statusCode).toBe(401);
      const body = res.json<{ errorCode: string }>();
      expect(body.errorCode).toBe("UNAUTHORIZED");
    });
  });

  describe("TX on non-owned player → OWNERSHIP_VIOLATION", () => {
    it("rejects TX for player not owned by actor", async () => {
      // Create another actor that owns a different player (requires admin key)
      await postTxAdmin({
        txId: "auth_own_setup_001",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "other_actor",
        apiKey: "other-key",
      });
      await postTx(
        {
          txId: "auth_own_setup_002",
          type: "CreatePlayer",
          gameInstanceId: "instance_001",
          playerId: "other_player",
        },
        { authorization: "Bearer other-key" },
      );

      // Try to access other_player with test_actor's key
      const res = await postTxAuth({
        txId: "auth_own_001",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "other_player",
        characterId: "char_x",
        classId: "warrior",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("OWNERSHIP_VIOLATION");
    });
  });

  describe("GET player state — auth + ownership", () => {
    it("GET player state without auth → 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_auth_1",
      });

      expect(res.statusCode).toBe(401);
      const body = res.json<{ errorCode: string }>();
      expect(body.errorCode).toBe("UNAUTHORIZED");
    });

    it("GET player state for non-owned player → 403 OWNERSHIP_VIOLATION", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/other_player",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json<{ errorCode: string }>();
      expect(body.errorCode).toBe("OWNERSHIP_VIOLATION");
    });
  });

  describe("GET character stats — auth + ownership", () => {
    it("GET character stats without auth → 401", async () => {
      // Create a character first
      await postTxAuth({
        txId: "auth_stats_setup_001",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_auth_1",
        characterId: "char_stats_1",
        classId: "warrior",
      });

      const res = await app.inject({
        method: "GET",
        url: "/instance_001/character/char_stats_1/stats",
      });

      expect(res.statusCode).toBe(401);
      const body = res.json<{ errorCode: string }>();
      expect(body.errorCode).toBe("UNAUTHORIZED");
    });

    it("GET character stats for non-owned player → 403 OWNERSHIP_VIOLATION", async () => {
      // Create a character under other_player
      await postTx(
        {
          txId: "auth_stats_setup_002",
          type: "CreateCharacter",
          gameInstanceId: "instance_001",
          playerId: "other_player",
          characterId: "char_other_1",
          classId: "warrior",
        },
        { authorization: "Bearer other-key" },
      );

      const res = await app.inject({
        method: "GET",
        url: "/instance_001/character/char_other_1/stats",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json<{ errorCode: string }>();
      expect(body.errorCode).toBe("OWNERSHIP_VIOLATION");
    });
  });

  describe("Full flow — end to end", () => {
    it("actor creates player, character, gear, equips — all accepted", async () => {
      const createPlayer = await postTxAuth({
        txId: "auth_flow_001",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_flow",
      });
      expect(createPlayer.json<TransactionResult>().accepted).toBe(true);

      const createChar = await postTxAuth({
        txId: "auth_flow_002",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_flow",
        characterId: "char_flow_1",
        classId: "warrior",
      });
      expect(createChar.json<TransactionResult>().accepted).toBe(true);

      const createGear = await postTxAuth({
        txId: "auth_flow_003",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "player_flow",
        gearId: "gear_flow_1",
        gearDefId: "sword_basic",
      });
      expect(createGear.json<TransactionResult>().accepted).toBe(true);

      const equip = await postTxAuth({
        txId: "auth_flow_004",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_flow",
        characterId: "char_flow_1",
        gearId: "gear_flow_1",
      });
      expect(equip.json<TransactionResult>().accepted).toBe(true);

      // Verify via GET endpoints
      const playerRes = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_flow",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });
      expect(playerRes.statusCode).toBe(200);

      const statsRes = await app.inject({
        method: "GET",
        url: "/instance_001/character/char_flow_1/stats",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });
      expect(statsRes.statusCode).toBe(200);
      const stats = statsRes.json<CharacterStats>();
      expect(stats.finalStats.strength).toBe(8); // warrior(5) + sword_basic(3)
    });
  });
});
