import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "./helpers.js";

// ---- Fake engine to test proxy against ----

let fakeEngine: FastifyInstance;
let fakeEngineUrl: string;

beforeAll(async () => {
  fakeEngine = Fastify({ logger: false });

  // Health endpoint
  fakeEngine.get("/health", async () => ({ status: "ok" }));

  // Config endpoint
  fakeEngine.get("/instance_001/config", async () => ({
    gameConfigId: "test",
    maxLevel: 60,
    slots: {},
    classes: {},
    gearDefs: {},
  }));

  // stateVersion
  fakeEngine.get("/instance_001/stateVersion", async () => ({
    gameInstanceId: "instance_001",
    stateVersion: 42,
  }));

  // Player state (requires auth)
  fakeEngine.get<{ Params: { playerId: string } }>(
    "/instance_001/state/player/:playerId",
    async (request, reply) => {
      const auth = request.headers.authorization;
      if (!auth) {
        return reply.code(401).send({ errorCode: "UNAUTHORIZED" });
      }
      return {
        characters: {},
        gear: {},
        resources: {},
      };
    },
  );

  // Character stats (requires auth)
  fakeEngine.get<{ Params: { characterId: string } }>(
    "/instance_001/character/:characterId/stats",
    async (request, reply) => {
      const auth = request.headers.authorization;
      if (!auth) {
        return reply.code(401).send({ errorCode: "UNAUTHORIZED" });
      }
      return {
        characterId: request.params.characterId,
        classId: "warrior",
        level: 1,
        finalStats: { str: 10 },
      };
    },
  );

  // Transaction endpoint
  fakeEngine.post<{ Body: Record<string, unknown> }>(
    "/instance_001/tx",
    async (request, reply) => {
      const auth = request.headers.authorization;
      if (!auth) {
        return reply.code(401).send({ errorCode: "UNAUTHORIZED" });
      }
      const body = request.body;
      return {
        txId: body.txId ?? "test-tx",
        accepted: true,
        stateVersion: 1,
      };
    },
  );

  const addr = await fakeEngine.listen({ port: 0, host: "127.0.0.1" });
  fakeEngineUrl = addr;
});

afterAll(async () => {
  await fakeEngine.close();
});

// ---- Tests ----

describe("BFF proxy — passthrough (Slice 0)", () => {
  let bff: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    bff = await buildApp({ engineUrl: fakeEngineUrl, withAuth: false });
  });

  afterAll(async () => {
    await bff.app.close();
  });

  it("GET /game/health proxies to engine", async () => {
    const res = await bff.app.inject({ method: "GET", url: "/game/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /game/config proxies to engine", async () => {
    const res = await bff.app.inject({ method: "GET", url: "/game/config" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.gameConfigId).toBe("test");
  });

  it("GET /game/version proxies to engine", async () => {
    const res = await bff.app.inject({ method: "GET", url: "/game/version" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      gameInstanceId: "instance_001",
      stateVersion: 42,
    });
  });

  it("GET /game/player/:id passes auth header through", async () => {
    const res = await bff.app.inject({
      method: "GET",
      url: "/game/player/p1",
      headers: { authorization: "Bearer test-key" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.characters).toEqual({});
  });

  it("GET /game/player/:id returns 401 without auth", async () => {
    const res = await bff.app.inject({
      method: "GET",
      url: "/game/player/p1",
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /game/stats/:charId passes auth header through", async () => {
    const res = await bff.app.inject({
      method: "GET",
      url: "/game/stats/hero_1",
      headers: { authorization: "Bearer test-key" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.characterId).toBe("hero_1");
  });

  it("POST /game/tx proxies transaction with auth", async () => {
    const res = await bff.app.inject({
      method: "POST",
      url: "/game/tx",
      headers: { authorization: "Bearer test-key" },
      payload: {
        txId: "tx_1",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "p1",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.accepted).toBe(true);
  });

  it("returns 502 when engine is unreachable", async () => {
    const deadBff = await buildApp({
      engineUrl: "http://127.0.0.1:19999",
    });
    const res = await deadBff.app.inject({
      method: "GET",
      url: "/game/health",
    });
    expect(res.statusCode).toBe(502);
    const body = res.json() as Record<string, unknown>;
    expect(body.errorCode).toBe("ENGINE_UNREACHABLE");
    await deadBff.app.close();
  });
});
