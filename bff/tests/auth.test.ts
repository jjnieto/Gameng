import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "./helpers.js";

// ---- Fake engine for auth flows ----

let fakeEngine: FastifyInstance;
let fakeEngineUrl: string;

// Track calls to the engine
let engineCalls: { type: string; body: Record<string, unknown> }[] = [];
let engineShouldReject = false;

beforeAll(async () => {
  fakeEngine = Fastify({ logger: false });

  fakeEngine.post<{ Body: Record<string, unknown> }>(
    "/instance_001/tx",
    async (request, reply) => {
      const body = request.body;
      engineCalls.push({ type: body.type as string, body });

      if (engineShouldReject) {
        return {
          txId: body.txId,
          accepted: false,
          stateVersion: 0,
          errorCode: "FORCED_REJECT",
        };
      }

      return {
        txId: body.txId,
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

describe("Auth routes (Slice 1)", () => {
  let bff: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    engineCalls = [];
    engineShouldReject = false;
    bff = await buildApp({ engineUrl: fakeEngineUrl, withAuth: true });
  });

  afterAll(async () => {
    await bff.app.close();
  });

  // -- Register --

  it("POST /auth/register — happy path", async () => {
    engineCalls = [];
    const res = await bff.app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "test@example.com", password: "password123" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      token: string;
      expiresIn: number;
      playerId: string;
    };
    expect(body.token).toBeTruthy();
    expect(body.expiresIn).toBe(3600);
    expect(body.playerId).toMatch(/^player_/);

    // Verify engine was called with CreateActor then CreatePlayer
    expect(engineCalls).toHaveLength(2);
    expect(engineCalls[0].type).toBe("CreateActor");
    expect(engineCalls[1].type).toBe("CreatePlayer");
  });

  it("POST /auth/register — duplicate email returns 409", async () => {
    const res = await bff.app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "test@example.com", password: "password123" },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { errorCode: string };
    expect(body.errorCode).toBe("CONFLICT");
  });

  it("POST /auth/register — invalid email returns 400", async () => {
    const res = await bff.app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "not-an-email", password: "password123" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { errorCode: string };
    expect(body.errorCode).toBe("VALIDATION_ERROR");
  });

  it("POST /auth/register — short password returns 400", async () => {
    const res = await bff.app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "short@example.com", password: "abc" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { errorCode: string };
    expect(body.errorCode).toBe("VALIDATION_ERROR");
  });

  // -- Login --

  it("POST /auth/login — happy path", async () => {
    const res = await bff.app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "test@example.com", password: "password123" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      token: string;
      expiresIn: number;
      playerId: string;
    };
    expect(body.token).toBeTruthy();
    expect(body.expiresIn).toBe(3600);
    expect(body.playerId).toMatch(/^player_/);
  });

  it("POST /auth/login — wrong password returns 401", async () => {
    const res = await bff.app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "test@example.com", password: "wrongpassword" },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { errorCode: string };
    expect(body.errorCode).toBe("INVALID_CREDENTIALS");
  });

  it("POST /auth/login — unknown email returns 401", async () => {
    const res = await bff.app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "nobody@example.com", password: "password123" },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { errorCode: string };
    expect(body.errorCode).toBe("INVALID_CREDENTIALS");
  });

  it("POST /auth/login — missing fields returns 400", async () => {
    const res = await bff.app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  // -- Refresh --

  it("POST /auth/refresh — renews JWT with valid token", async () => {
    // First login to get a token
    const loginRes = await bff.app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "test@example.com", password: "password123" },
    });
    const { token } = loginRes.json() as { token: string };

    const res = await bff.app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; playerId: string };
    expect(body.token).toBeTruthy();
    expect(body.playerId).toMatch(/^player_/);
  });

  it("POST /auth/refresh — without token returns 401", async () => {
    const res = await bff.app.inject({
      method: "POST",
      url: "/auth/refresh",
    });
    expect(res.statusCode).toBe(401);
  });

  // -- Middleware --

  it("requireAuth blocks requests without JWT", async () => {
    const res = await bff.app.inject({
      method: "POST",
      url: "/auth/refresh",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { errorCode: string };
    expect(body.errorCode).toBe("UNAUTHORIZED");
  });
});

describe("Auth routes — engine failures", () => {
  let bff: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    engineShouldReject = true;
    bff = await buildApp({ engineUrl: fakeEngineUrl, withAuth: true });
  });

  afterAll(async () => {
    engineShouldReject = false;
    await bff.app.close();
  });

  it("POST /auth/register — engine rejects CreateActor → 502", async () => {
    const res = await bff.app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "fail@example.com", password: "password123" },
    });
    expect(res.statusCode).toBe(502);
    const body = res.json() as { errorCode: string };
    expect(body.errorCode).toBe("ENGINE_ERROR");
  });
});

describe("Auth routes — engine unreachable", () => {
  let bff: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    bff = await buildApp({
      engineUrl: "http://127.0.0.1:19999",
      withAuth: true,
    });
  });

  afterAll(async () => {
    await bff.app.close();
  });

  it("POST /auth/register — engine down → 502", async () => {
    const res = await bff.app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "down@example.com", password: "password123" },
    });
    expect(res.statusCode).toBe(502);
    const body = res.json() as { errorCode: string };
    expect(body.errorCode).toBe("ENGINE_ERROR");
  });
});
