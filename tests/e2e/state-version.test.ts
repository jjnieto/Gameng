import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { startServer, type ServerHandle } from "./process.js";
import { step } from "./logger.js";
import {
  tx,
  getStateVersion,
  expectAccepted,
  expectRejected,
  expectHttp,
} from "./client.js";

describe("E2E — GET /:gameInstanceId/stateVersion", () => {
  let srv: ServerHandle;
  const ADMIN_KEY = "e2e-admin-key-sv";
  const API_KEY = "e2e-sv-key-001";

  beforeAll(async () => {
    srv = await startServer({
      configPath: "examples/config_minimal.json",
      extraEnv: { ADMIN_API_KEY: ADMIN_KEY },
    });
  }, 30_000);

  afterAll(async () => {
    await srv.stop();
  });

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  it("returns stateVersion 0 for a fresh instance", async () => {
    await step("GET stateVersion on fresh instance", async () => {
      const res = await getStateVersion(srv.baseUrl, "instance_001");
      expectHttp(res, 200);
      expect(res.body.gameInstanceId).toBe("instance_001");
      expect(res.body.stateVersion).toBe(0);
    }, srv.logs);
  });

  it("returns 404 INSTANCE_NOT_FOUND for unknown instance", async () => {
    await step("GET stateVersion unknown instance", async () => {
      const res = await getStateVersion(srv.baseUrl, "unknown_instance");
      expectHttp(res, 404, "INSTANCE_NOT_FOUND");
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // Increment after accepted tx
  // -----------------------------------------------------------------------

  it("stateVersion increments after each accepted transaction", async () => {
    await step("CreateActor", async () => {
      const res = await tx(srv.baseUrl, ADMIN_KEY, {
        txId: "sv_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "sv_actor_1",
        apiKey: API_KEY,
      });
      expectAccepted(res, "CreateActor");
    }, srv.logs);

    await step("verify stateVersion = 1 after CreateActor", async () => {
      const res = await getStateVersion(srv.baseUrl, "instance_001");
      expectHttp(res, 200);
      expect(res.body.stateVersion).toBe(1);
    }, srv.logs);

    await step("CreatePlayer", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "sv_player",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "sv_player_1",
      });
      expectAccepted(res, "CreatePlayer");
    }, srv.logs);

    await step("verify stateVersion = 2 after CreatePlayer", async () => {
      const res = await getStateVersion(srv.baseUrl, "instance_001");
      expectHttp(res, 200);
      expect(res.body.stateVersion).toBe(2);
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // No increment after rejected tx
  // -----------------------------------------------------------------------

  it("stateVersion does NOT increment after a rejected transaction", async () => {
    await step("capture current stateVersion", async () => {
      const res = await getStateVersion(srv.baseUrl, "instance_001");
      expect(res.body.stateVersion).toBe(2);
    }, srv.logs);

    await step("duplicate CreatePlayer → ALREADY_EXISTS", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "sv_dup_player",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "sv_player_1",
      });
      expectRejected(res, "ALREADY_EXISTS");
    }, srv.logs);

    await step("verify stateVersion still 2", async () => {
      const res = await getStateVersion(srv.baseUrl, "instance_001");
      expectHttp(res, 200);
      expect(res.body.stateVersion).toBe(2);
    }, srv.logs);
  });
});
