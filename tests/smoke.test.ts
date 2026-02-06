import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

interface HealthResponse {
  status: string;
  timestamp: string;
  uptime: number;
}

describe("GET /health", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = createApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns status 200", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
  });

  it("returns correct body structure", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    const body = response.json<HealthResponse>();
    expect(body).toHaveProperty("status", "ok");
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("uptime");
  });

  it("returns a valid ISO timestamp", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    const body = response.json<HealthResponse>();
    const parsed = new Date(body.timestamp);
    expect(parsed.toISOString()).toBe(body.timestamp);
  });
});
