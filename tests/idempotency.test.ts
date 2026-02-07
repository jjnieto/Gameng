import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import {
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

interface TransactionResult {
  txId: string;
  accepted: boolean;
  stateVersion: number;
  errorCode?: string;
  errorMessage?: string;
}

const ADMIN_KEY = "test-admin-key-idem";
const TEST_API_KEY = "test-key-idem";

function postTx(
  app: FastifyInstance,
  payload: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return app.inject({
    method: "POST",
    url: "/instance_001/tx",
    headers: headers ?? { authorization: `Bearer ${TEST_API_KEY}` },
    payload,
  });
}

function postTxAdmin(app: FastifyInstance, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/instance_001/tx",
    headers: { authorization: `Bearer ${ADMIN_KEY}` },
    payload,
  });
}

async function bootstrapActor(app: FastifyInstance, txId: string) {
  await postTxAdmin(app, {
    txId,
    type: "CreateActor",
    gameInstanceId: "instance_001",
    actorId: "test_actor",
    apiKey: TEST_API_KEY,
  });
}

describe("txId Idempotency", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = createApp({ adminApiKey: ADMIN_KEY });
    await app.ready();
    await bootstrapActor(app, "idem_setup_actor");
  });

  afterAll(async () => {
    await app.close();
  });

  it("duplicate accepted tx returns same response, no stateVersion bump", async () => {
    const payload = {
      txId: "idem_dup_ok_1",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "p_dup_ok",
    };

    const res1 = await postTx(app, payload);
    const body1 = res1.json<TransactionResult>();
    expect(res1.statusCode).toBe(200);
    expect(body1.accepted).toBe(true);
    const v1 = body1.stateVersion;

    // Replay with same txId
    const res2 = await postTx(app, payload);
    const body2 = res2.json<TransactionResult>();
    expect(res2.statusCode).toBe(200);
    expect(body2.accepted).toBe(true);
    expect(body2.stateVersion).toBe(v1);
    expect(body2.txId).toBe("idem_dup_ok_1");
  });

  it("duplicate rejected tx (ALREADY_EXISTS) returns same error, no stateVersion change", async () => {
    // Create a player first
    await postTx(app, {
      txId: "idem_pre_dup",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "p_dup_err",
    });

    // Try to create same player again with new txId → rejected
    const payload = {
      txId: "idem_dup_err_1",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "p_dup_err",
    };

    const res1 = await postTx(app, payload);
    const body1 = res1.json<TransactionResult>();
    expect(body1.accepted).toBe(false);
    expect(body1.errorCode).toBe("ALREADY_EXISTS");
    const v1 = body1.stateVersion;

    // Replay same txId → same cached error
    const res2 = await postTx(app, payload);
    const body2 = res2.json<TransactionResult>();
    expect(body2.accepted).toBe(false);
    expect(body2.errorCode).toBe("ALREADY_EXISTS");
    expect(body2.stateVersion).toBe(v1);
  });

  it("401 UNAUTHORIZED is cached — replay returns same 401", async () => {
    const payload = {
      txId: "idem_401_cached",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "p_401_cached",
    };

    // First: send without auth → 401
    const res1 = await postTx(app, payload, {});
    expect(res1.statusCode).toBe(401);
    const body1 = res1.json<{ errorCode: string }>();
    expect(body1.errorCode).toBe("UNAUTHORIZED");

    // Replay same txId (even with valid auth) → cached 401
    const res2 = await postTx(app, payload);
    expect(res2.statusCode).toBe(401);
    const body2 = res2.json<{ errorCode: string }>();
    expect(body2.errorCode).toBe("UNAUTHORIZED");
  });

  it("500 CONFIG_NOT_FOUND is cached — replay returns same 500", async () => {
    // To trigger CONFIG_NOT_FOUND, we need a state whose gameConfigId doesn't match
    // any loaded config. We can do this by directly mutating the state.
    const state = app.gameInstances.get("instance_001")!;
    const origConfigId = state.gameConfigId;

    // Temporarily set an invalid configId
    state.gameConfigId = "nonexistent_config";

    const payload = {
      txId: "idem_500_cached",
      type: "CreateCharacter",
      gameInstanceId: "instance_001",
      playerId: "p_dup_ok", // already exists from earlier test
      characterId: "c_500_test",
      classId: "warrior",
    };

    // First: 500 CONFIG_NOT_FOUND
    const res1 = await postTx(app, payload);
    expect(res1.statusCode).toBe(500);
    const body1 = res1.json<{ errorCode: string }>();
    expect(body1.errorCode).toBe("CONFIG_NOT_FOUND");

    // Restore configId so other tests aren't affected
    state.gameConfigId = origConfigId;

    // Replay same txId → cached 500 (even though config is now valid)
    const res2 = await postTx(app, payload);
    expect(res2.statusCode).toBe(500);
    const body2 = res2.json<{ errorCode: string }>();
    expect(body2.errorCode).toBe("CONFIG_NOT_FOUND");
  });

  it("400 INSTANCE_MISMATCH is NOT cached — retry with correct body works", async () => {
    const txId = "idem_400_retry";

    // First: send with mismatched gameInstanceId → 400
    const res1 = await postTx(app, {
      txId,
      type: "CreatePlayer",
      gameInstanceId: "wrong_instance",
      playerId: "p_400_retry",
    });
    expect(res1.statusCode).toBe(400);

    // Retry same txId with correct gameInstanceId → should execute fresh
    const res2 = await postTx(app, {
      txId,
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "p_400_retry",
    });
    const body2 = res2.json<TransactionResult>();
    expect(res2.statusCode).toBe(200);
    expect(body2.accepted).toBe(true);
  });

  it("stateVersion: V→V+1 on first, V+1 on replay, V+2 on new tx", async () => {
    // Create player → V+1
    const res1 = await postTx(app, {
      txId: "idem_sv_1",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "p_sv_test",
    });
    const v1 = res1.json<TransactionResult>().stateVersion;

    // Replay same txId → still V+1
    const res2 = await postTx(app, {
      txId: "idem_sv_1",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "p_sv_test",
    });
    expect(res2.json<TransactionResult>().stateVersion).toBe(v1);

    // New txId → V+2
    const res3 = await postTx(app, {
      txId: "idem_sv_2",
      type: "CreateCharacter",
      gameInstanceId: "instance_001",
      playerId: "p_sv_test",
      characterId: "c_sv_1",
      classId: "warrior",
    });
    expect(res3.json<TransactionResult>().stateVersion).toBe(v1 + 1);
  });

  it("eviction end-to-end (maxIdempotencyEntries=3): oldest txId evicted, replayed as fresh", async () => {
    const evictApp = createApp({
      adminApiKey: ADMIN_KEY,
      maxIdempotencyEntries: 3,
    });
    await evictApp.ready();

    // Bootstrap actor
    await evictApp.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      payload: {
        txId: "evict_setup_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "evict_actor",
        apiKey: TEST_API_KEY,
      },
    });

    const postEvict = (payload: Record<string, unknown>) =>
      evictApp.inject({
        method: "POST",
        url: "/instance_001/tx",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
        payload,
      });

    // tx1: CreatePlayer p1 (fills slot 1 of 3; note: evict_setup_actor is also cached = slot 0)
    // Actually, the evict_setup_actor used a different cache since maxEntries=3
    // Let's send 3 more txs after setup to fill the cache
    const res1 = await postEvict({
      txId: "evict_tx1",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "evict_p1",
    });
    expect(res1.json<TransactionResult>().accepted).toBe(true);

    const res2 = await postEvict({
      txId: "evict_tx2",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "evict_p2",
    });
    expect(res2.json<TransactionResult>().accepted).toBe(true);

    const res3 = await postEvict({
      txId: "evict_tx3",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "evict_p3",
    });
    expect(res3.json<TransactionResult>().accepted).toBe(true);

    // Cache now has: evict_setup_actor, evict_tx1, evict_tx2 (evict_tx3 pushed out evict_setup_actor since maxEntries=3)
    // Wait, let's think: maxEntries=3. After evict_setup_actor (1), evict_tx1 (2), evict_tx2 (3), evict_tx3 would evict evict_setup_actor.
    // So evict_tx1, evict_tx2, evict_tx3 should all be cached.

    // Replay evict_tx3 → should return cached
    const replayRes3 = await postEvict({
      txId: "evict_tx3",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "evict_p3",
    });
    expect(replayRes3.json<TransactionResult>().accepted).toBe(true);

    // Now send a 4th tx to push evict_tx1 out
    const res4 = await postEvict({
      txId: "evict_tx4",
      type: "CreateCharacter",
      gameInstanceId: "instance_001",
      playerId: "evict_p1",
      characterId: "evict_c1",
      classId: "warrior",
    });
    expect(res4.json<TransactionResult>().accepted).toBe(true);

    // evict_tx1 (CreatePlayer evict_p1) should now be evicted.
    // Replaying it should re-execute: player already exists → ALREADY_EXISTS
    const replayRes1 = await postEvict({
      txId: "evict_tx1",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "evict_p1",
    });
    const replayBody1 = replayRes1.json<TransactionResult>();
    expect(replayBody1.accepted).toBe(false);
    expect(replayBody1.errorCode).toBe("ALREADY_EXISTS");

    await evictApp.close();
  });
});

describe("txId Idempotency — Snapshot round-trip", () => {
  const SNAP_DIR = resolve("test-snapshots-idem");

  function cleanDir(dir: string): void {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true });
    }
  }

  beforeEach(() => {
    cleanDir(SNAP_DIR);
  });

  afterAll(() => {
    cleanDir(SNAP_DIR);
  });

  it("flush → new app with same snapshotDir → replay returns cached", async () => {
    const app1 = createApp({
      adminApiKey: ADMIN_KEY,
      snapshotDir: SNAP_DIR,
    });
    await app1.ready();

    // Bootstrap actor + create player
    await postTxAdmin(app1, {
      txId: "snap_idem_actor",
      type: "CreateActor",
      gameInstanceId: "instance_001",
      actorId: "snap_actor",
      apiKey: TEST_API_KEY,
    });

    const res1 = await postTx(app1, {
      txId: "snap_idem_tx1",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "snap_p1",
    });
    const body1 = res1.json<TransactionResult>();
    expect(body1.accepted).toBe(true);
    const v1 = body1.stateVersion;

    // Flush and close
    app1.flushSnapshots();
    await app1.close();

    // New app with same snapshotDir
    const app2 = createApp({
      adminApiKey: ADMIN_KEY,
      snapshotDir: SNAP_DIR,
    });
    await app2.ready();

    // Replay same txId → should return cached result
    const res2 = await postTx(app2, {
      txId: "snap_idem_tx1",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "snap_p1",
    });
    const body2 = res2.json<TransactionResult>();
    expect(body2.accepted).toBe(true);
    expect(body2.stateVersion).toBe(v1);

    await app2.close();
  });

  it("legacy snapshot without txIdCache → migrator adds it, works normally", async () => {
    // Write a legacy snapshot without txIdCache
    mkdirSync(SNAP_DIR, { recursive: true });
    const legacyState: Record<string, unknown> = {
      gameInstanceId: "instance_001",
      gameConfigId: "minimal_v1",
      stateVersion: 5,
      players: {},
      actors: {},
    };
    writeFileSync(
      resolve(SNAP_DIR, "instance_001.json"),
      JSON.stringify(legacyState),
    );

    const app1 = createApp({
      adminApiKey: ADMIN_KEY,
      snapshotDir: SNAP_DIR,
    });
    await app1.ready();

    // State should have been restored and migrated (txIdCache added)
    const state = app1.gameInstances.get("instance_001");
    expect(state).toBeDefined();
    expect(state!.txIdCache).toBeDefined();
    expect(Array.isArray(state!.txIdCache)).toBe(true);
    expect(state!.txIdCache).toHaveLength(0);

    // Now perform a tx — should work and be cached
    await postTxAdmin(app1, {
      txId: "legacy_actor",
      type: "CreateActor",
      gameInstanceId: "instance_001",
      actorId: "legacy_actor",
      apiKey: TEST_API_KEY,
    });

    const res = await postTx(app1, {
      txId: "legacy_tx1",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "legacy_p1",
    });
    const body = res.json<TransactionResult>();
    expect(body.accepted).toBe(true);

    // Replay → cached
    const res2 = await postTx(app1, {
      txId: "legacy_tx1",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "legacy_p1",
    });
    const body2 = res2.json<TransactionResult>();
    expect(body2.accepted).toBe(true);
    expect(body2.stateVersion).toBe(body.stateVersion);

    await app1.close();
  });
});
