import { describe, it, expect, afterAll } from "vitest";
import { startServer, type ServerHandle } from "./process.js";
import { step } from "./logger.js";
import {
  tx,
  getStateVersion,
  expectAccepted,
  expectRejected,
  expectHttp,
} from "./client.js";

describe("E2E — txId Idempotency", () => {
  let srv: ServerHandle;
  const ADMIN_KEY = "e2e-admin-key-idem";
  const API_KEY = "e2e-idem-key-001";

  afterAll(async () => {
    if (srv) await srv.stop();
  });

  it("replay accepted tx returns cached response, stateVersion unchanged", async () => {
    srv = await startServer({
      configPath: "examples/config_minimal.json",
      extraEnv: { ADMIN_API_KEY: ADMIN_KEY },
    });

    await step("CreateActor", async () => {
      const res = await tx(srv.baseUrl, ADMIN_KEY, {
        txId: "idem_e2e_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "idem_actor",
        apiKey: API_KEY,
      });
      expectAccepted(res);
    }, srv.logs);

    let firstVersion: number;

    await step("CreatePlayer (first)", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "idem_e2e_cp1",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "idem_p1",
      });
      expectAccepted(res);
      firstVersion = res.body.stateVersion;
    }, srv.logs);

    await step("CreatePlayer (replay same txId) → cached", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "idem_e2e_cp1",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "idem_p1",
      });
      expectAccepted(res);
      expect(res.body.stateVersion).toBe(firstVersion!);
    }, srv.logs);

    await step("stateVersion via GET confirms no bump", async () => {
      const res = await getStateVersion(srv.baseUrl, "instance_001");
      expectHttp(res, 200);
      expect(res.body.stateVersion).toBe(firstVersion!);
    }, srv.logs);

    await srv.stop();
  }, 30_000);

  it("replay rejected tx (ALREADY_EXISTS) returns cached error", async () => {
    srv = await startServer({
      configPath: "examples/config_minimal.json",
      extraEnv: { ADMIN_API_KEY: ADMIN_KEY },
    });

    await step("CreateActor", async () => {
      const res = await tx(srv.baseUrl, ADMIN_KEY, {
        txId: "idem_e2e_actor2",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "idem_actor2",
        apiKey: API_KEY,
      });
      expectAccepted(res);
    }, srv.logs);

    await step("CreatePlayer", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "idem_e2e_pre",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "idem_dup_p",
      });
      expectAccepted(res);
    }, srv.logs);

    let rejectedVersion: number;

    await step("CreatePlayer duplicate (new txId) → ALREADY_EXISTS", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "idem_e2e_dup",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "idem_dup_p",
      });
      expectRejected(res, "ALREADY_EXISTS");
      rejectedVersion = res.body.stateVersion;
    }, srv.logs);

    await step("Replay same txId → cached ALREADY_EXISTS", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "idem_e2e_dup",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "idem_dup_p",
      });
      expectRejected(res, "ALREADY_EXISTS");
      expect(res.body.stateVersion).toBe(rejectedVersion!);
    }, srv.logs);

    await srv.stop();
  }, 30_000);

  it("snapshot+restart persistence: cached tx survives restart", async () => {
    srv = await startServer({
      configPath: "examples/config_minimal.json",
      extraEnv: { ADMIN_API_KEY: ADMIN_KEY },
    });
    const snapshotDir = srv.snapshotDir;

    await step("CreateActor", async () => {
      const res = await tx(srv.baseUrl, ADMIN_KEY, {
        txId: "idem_e2e_snap_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "idem_snap_actor",
        apiKey: API_KEY,
      });
      expectAccepted(res);
    }, srv.logs);

    let cachedVersion: number;

    await step("CreatePlayer", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "idem_e2e_snap_tx",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "idem_snap_p",
      });
      expectAccepted(res);
      cachedVersion = res.body.stateVersion;
    }, srv.logs);

    await step("stop server (flush snapshots)", async () => {
      await srv.stop();
    });

    await step("restart with same snapshotDir", async () => {
      srv = await startServer({
        configPath: "examples/config_minimal.json",
        snapshotDir,
        extraEnv: { ADMIN_API_KEY: ADMIN_KEY },
      });
    });

    await step("replay same txId → cached response from snapshot", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "idem_e2e_snap_tx",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "idem_snap_p",
      });
      expectAccepted(res);
      expect(res.body.stateVersion).toBe(cachedVersion!);
    }, srv.logs);

    await srv.stop();
  }, 60_000);

  it("eviction: GAMENG_MAX_IDEMPOTENCY_ENTRIES=3, oldest evicted", async () => {
    srv = await startServer({
      configPath: "examples/config_minimal.json",
      extraEnv: {
        ADMIN_API_KEY: ADMIN_KEY,
        GAMENG_MAX_IDEMPOTENCY_ENTRIES: "3",
      },
    });

    await step("CreateActor", async () => {
      const res = await tx(srv.baseUrl, ADMIN_KEY, {
        txId: "idem_evict_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "idem_evict_actor",
        apiKey: API_KEY,
      });
      expectAccepted(res);
    }, srv.logs);

    // txIds in cache after actor: [idem_evict_actor]
    await step("tx1: CreatePlayer p1", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "idem_evict_tx1",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "evict_p1",
      });
      expectAccepted(res);
    }, srv.logs);

    // cache: [idem_evict_actor, idem_evict_tx1]
    await step("tx2: CreatePlayer p2", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "idem_evict_tx2",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "evict_p2",
      });
      expectAccepted(res);
    }, srv.logs);

    // cache: [idem_evict_actor, idem_evict_tx1, idem_evict_tx2] — full at 3
    await step("tx3: CreatePlayer p3 → evicts idem_evict_actor", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "idem_evict_tx3",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "evict_p3",
      });
      expectAccepted(res);
    }, srv.logs);

    // cache: [idem_evict_tx1, idem_evict_tx2, idem_evict_tx3]
    await step("tx4: CreateCharacter → evicts idem_evict_tx1", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "idem_evict_tx4",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "evict_p1",
        characterId: "evict_c1",
        classId: "warrior",
      });
      expectAccepted(res);
    }, srv.logs);

    // cache: [idem_evict_tx2, idem_evict_tx3, idem_evict_tx4]
    // idem_evict_tx1 was evicted. Replaying it → re-executes → ALREADY_EXISTS
    await step("replay evicted tx1 → re-executes as fresh (ALREADY_EXISTS)", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "idem_evict_tx1",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "evict_p1",
      });
      expectRejected(res, "ALREADY_EXISTS");
    }, srv.logs);

    await srv.stop();
  }, 30_000);

  it("401 UNAUTHORIZED is cached — replay returns same 401", async () => {
    srv = await startServer({
      configPath: "examples/config_minimal.json",
      extraEnv: { ADMIN_API_KEY: ADMIN_KEY },
    });

    await step("CreateActor", async () => {
      const res = await tx(srv.baseUrl, ADMIN_KEY, {
        txId: "idem_e2e_infra_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "idem_infra_actor",
        apiKey: API_KEY,
      });
      expectAccepted(res);
    }, srv.logs);

    await step("POST tx without auth → 401", async () => {
      const res = await tx(srv.baseUrl, null, {
        txId: "idem_e2e_infra_tx",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "idem_infra_p",
      });
      expectHttp(res, 401, "UNAUTHORIZED");
    }, srv.logs);

    await step("POST same txId with valid auth → cached 401 (not re-executed)", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "idem_e2e_infra_tx",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "idem_infra_p",
      });
      expectHttp(res, 401, "UNAUTHORIZED");
    }, srv.logs);

    await srv.stop();
  }, 30_000);
});
