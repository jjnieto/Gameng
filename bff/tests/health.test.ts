import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "./helpers.js";

// ---- Fake engine for health probe ----

let fakeEngine: FastifyInstance;
let fakeEngineUrl: string;

beforeAll(async () => {
  fakeEngine = Fastify({ logger: false });
  fakeEngine.get("/health", async () => ({ status: "ok" }));
  const addr = await fakeEngine.listen({ port: 0, host: "127.0.0.1" });
  fakeEngineUrl = addr;
});

afterAll(async () => {
  await fakeEngine.close();
});

describe("BFF health check (Slice 6)", () => {
  it("GET /health returns status with engine reachable", async () => {
    const { app } = await buildApp({ engineUrl: fakeEngineUrl, withAuth: true });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      status: string;
      uptimeMs: number;
      engine: { reachable: boolean; latencyMs: number };
      db: { connected: boolean };
    };
    expect(body.status).toBe("ok");
    expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(body.engine.reachable).toBe(true);
    expect(body.engine.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.db.connected).toBe(true);
    await app.close();
  });

  it("GET /health reports engine unreachable when down", async () => {
    const { app } = await buildApp({
      engineUrl: "http://127.0.0.1:19999",
      withAuth: true,
    });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      engine: { reachable: boolean };
      db: { connected: boolean };
    };
    expect(body.engine.reachable).toBe(false);
    expect(body.db.connected).toBe(true);
    await app.close();
  });
});
