import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { SnapshotManager } from "../src/snapshot-manager.js";
import type { FastifyInstance } from "fastify";
import type { GameState } from "../src/state.js";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

interface TransactionResult {
  txId: string;
  accepted: boolean;
  stateVersion: number;
  errorCode?: string;
  errorMessage?: string;
}

const TEST_SNAPSHOT_DIR = resolve("test-snapshots");
const ADMIN_KEY = "test-admin-key-slice9a";
const TEST_API_KEY = "test-key-slice9a";

function cleanDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
  }
}

async function bootstrapActor(app: FastifyInstance, txId: string) {
  await app.inject({
    method: "POST",
    url: "/instance_001/tx",
    headers: { authorization: `Bearer ${ADMIN_KEY}` },
    payload: {
      txId,
      type: "CreateActor",
      gameInstanceId: "instance_001",
      actorId: "test_actor",
      apiKey: TEST_API_KEY,
    },
  });
}

function postTx(app: FastifyInstance, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/instance_001/tx",
    headers: { authorization: `Bearer ${TEST_API_KEY}` },
    payload,
  });
}

describe("Slice 9A — Snapshots (persistence and restore)", () => {
  beforeEach(() => {
    cleanDir(TEST_SNAPSHOT_DIR);
  });

  afterAll(() => {
    cleanDir(TEST_SNAPSHOT_DIR);
  });

  describe("SnapshotManager unit — saveOne / loadAll round-trip", () => {
    it("saves and loads a valid GameState", () => {
      const mgr = new SnapshotManager(TEST_SNAPSHOT_DIR);
      const state: GameState = {
        gameInstanceId: "instance_rt",
        gameConfigId: "config_minimal",
        stateVersion: 5,
        players: {},
        actors: {},
      };

      mgr.saveOne(state);

      const filePath = join(TEST_SNAPSHOT_DIR, "instance_rt.json");
      expect(existsSync(filePath)).toBe(true);

      const loaded = mgr.loadAll();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toEqual(state);
    });

    it("saves multiple states via saveAll", () => {
      const mgr = new SnapshotManager(TEST_SNAPSHOT_DIR);
      const store = new Map<string, GameState>();
      store.set("inst_a", {
        gameInstanceId: "inst_a",
        gameConfigId: "cfg_a",
        stateVersion: 1,
        players: {},
        actors: {},
      });
      store.set("inst_b", {
        gameInstanceId: "inst_b",
        gameConfigId: "cfg_b",
        stateVersion: 2,
        players: {},
        actors: {},
      });

      mgr.saveAll(store);

      const loaded = mgr.loadAll();
      expect(loaded).toHaveLength(2);
      const ids = loaded.map((s) => s.gameInstanceId).sort();
      expect(ids).toEqual(["inst_a", "inst_b"]);
    });

    it("persists full nested player/character/gear state", () => {
      const mgr = new SnapshotManager(TEST_SNAPSHOT_DIR);
      const state: GameState = {
        gameInstanceId: "instance_full",
        gameConfigId: "config_minimal",
        stateVersion: 10,
        players: {
          player_1: {
            characters: {
              char_1: {
                classId: "warrior",
                level: 3,
                equipped: { right_hand: "sword_1" },
              },
            },
            gear: {
              sword_1: {
                gearDefId: "sword_basic",
                level: 1,
                equippedBy: "char_1",
              },
              shield_1: {
                gearDefId: "scaled_shield",
                level: 1,
                equippedBy: null,
              },
            },
          },
        },
        actors: {},
      };

      mgr.saveOne(state);
      const loaded = mgr.loadAll();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toEqual(state);
    });
  });

  describe("SnapshotManager — invalid data handling", () => {
    it("skips invalid JSON files on load", () => {
      mkdirSync(TEST_SNAPSHOT_DIR, { recursive: true });
      writeFileSync(
        join(TEST_SNAPSHOT_DIR, "bad.json"),
        "NOT VALID JSON{{{",
        "utf-8",
      );

      const mgr = new SnapshotManager(TEST_SNAPSHOT_DIR);
      const loaded = mgr.loadAll();
      expect(loaded).toHaveLength(0);
    });

    it("skips schema-invalid snapshots on load", () => {
      mkdirSync(TEST_SNAPSHOT_DIR, { recursive: true });
      // Missing required fields
      writeFileSync(
        join(TEST_SNAPSHOT_DIR, "incomplete.json"),
        JSON.stringify({ gameInstanceId: "x" }),
        "utf-8",
      );

      const mgr = new SnapshotManager(TEST_SNAPSHOT_DIR);
      const loaded = mgr.loadAll();
      expect(loaded).toHaveLength(0);
    });

    it("ignores .tmp leftover files", () => {
      mkdirSync(TEST_SNAPSHOT_DIR, { recursive: true });
      writeFileSync(
        join(TEST_SNAPSHOT_DIR, "instance_001.json.tmp"),
        JSON.stringify({
          gameInstanceId: "instance_001",
          gameConfigId: "c",
          stateVersion: 1,
          players: {},
        }),
        "utf-8",
      );

      const mgr = new SnapshotManager(TEST_SNAPSHOT_DIR);
      const loaded = mgr.loadAll();
      expect(loaded).toHaveLength(0);
    });

    it("loads valid snapshots alongside invalid ones", () => {
      mkdirSync(TEST_SNAPSHOT_DIR, { recursive: true });
      // One valid
      writeFileSync(
        join(TEST_SNAPSHOT_DIR, "good.json"),
        JSON.stringify({
          gameInstanceId: "good_inst",
          gameConfigId: "cfg",
          stateVersion: 3,
          players: {},
        }),
        "utf-8",
      );
      // One invalid
      writeFileSync(
        join(TEST_SNAPSHOT_DIR, "bad.json"),
        "broken json!",
        "utf-8",
      );

      const mgr = new SnapshotManager(TEST_SNAPSHOT_DIR);
      const loaded = mgr.loadAll();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].gameInstanceId).toBe("good_inst");
    });

    it("creates snapshot directory if it does not exist", () => {
      const newDir = join(TEST_SNAPSHOT_DIR, "nested", "deep");
      const mgr = new SnapshotManager(newDir);
      expect(existsSync(newDir)).toBe(true);

      // Should still work with empty dir
      const loaded = mgr.loadAll();
      expect(loaded).toHaveLength(0);
    });
  });

  describe("Integration — createApp with snapshotDir", () => {
    let app: FastifyInstance;

    afterAll(async () => {
      await app.close();
    });

    it("round-trip: mutate state → flush → restore in new app", async () => {
      // Step 1: Create app with snapshot dir and mutate state
      app = createApp({ snapshotDir: TEST_SNAPSHOT_DIR, adminApiKey: ADMIN_KEY });
      await app.ready();

      await bootstrapActor(app, "s9a_int_actor");

      const p = await postTx(app, {
        txId: "s9a_int_001",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_1",
      });
      expect(p.json<TransactionResult>().accepted).toBe(true);

      const c = await postTx(app, {
        txId: "s9a_int_002",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        classId: "warrior",
      });
      expect(c.json<TransactionResult>().accepted).toBe(true);

      // Flush snapshots to disk
      app.flushSnapshots();

      // Verify file exists
      const snapshotFile = join(TEST_SNAPSHOT_DIR, "instance_001.json");
      expect(existsSync(snapshotFile)).toBe(true);

      // Verify snapshot content
      const raw = readFileSync(snapshotFile, "utf-8");
      const saved = JSON.parse(raw) as GameState;
      expect(saved.gameInstanceId).toBe("instance_001");
      expect(saved.stateVersion).toBe(3); // CreateActor + CreatePlayer + CreateCharacter
      expect(saved.players.player_1.characters.char_1.classId).toBe("warrior");

      await app.close();

      // Step 2: Create new app with same snapshot dir — state should restore
      const app2 = createApp({ snapshotDir: TEST_SNAPSHOT_DIR });
      await app2.ready();

      // Verify state was restored — need auth for GET
      // The restored snapshot has our actor, so we can use the same key
      const stateRes = await app2.inject({
        method: "GET",
        url: "/instance_001/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });
      expect(stateRes.statusCode).toBe(200);
      const body = stateRes.json<{
        characters: Record<string, { classId: string }>;
      }>();
      expect(body.characters.char_1.classId).toBe("warrior");

      // Verify stateVersion was restored (can do another tx)
      const g = await postTx(app2, {
        txId: "s9a_int_003",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "sword_1",
        gearDefId: "sword_basic",
      });
      const gResult = g.json<TransactionResult>();
      expect(gResult.accepted).toBe(true);
      expect(gResult.stateVersion).toBe(4); // continues from restored version

      await app2.close();
      app = createApp(); // reset for afterAll
    });
  });

  describe("Integration — flushSnapshots noop without snapshotDir", () => {
    it("flushSnapshots does nothing when no snapshotDir configured", async () => {
      const app = createApp();
      await app.ready();

      // Should not throw
      app.flushSnapshots();

      // No snapshot files created
      expect(existsSync(TEST_SNAPSHOT_DIR)).toBe(false);

      await app.close();
    });
  });

  describe("Integration — onClose hook flushes", () => {
    it("closing the app writes snapshots to disk", async () => {
      const app = createApp({ snapshotDir: TEST_SNAPSHOT_DIR, adminApiKey: ADMIN_KEY });
      await app.ready();

      await bootstrapActor(app, "s9a_close_actor");

      await postTx(app, {
        txId: "s9a_close_001",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_1",
      });

      // Close triggers flush
      await app.close();

      const snapshotFile = join(TEST_SNAPSHOT_DIR, "instance_001.json");
      expect(existsSync(snapshotFile)).toBe(true);

      const raw = readFileSync(snapshotFile, "utf-8");
      const saved = JSON.parse(raw) as GameState;
      expect(saved.stateVersion).toBe(2); // CreateActor + CreatePlayer
      expect(saved.players.player_1).toBeDefined();
    });
  });

  describe("Integration — unknown configId snapshots migrated on restore", () => {
    it("migrates snapshots with unknown gameConfigId to current config", async () => {
      // Write a snapshot with an unknown config
      mkdirSync(TEST_SNAPSHOT_DIR, { recursive: true });
      writeFileSync(
        join(TEST_SNAPSHOT_DIR, "unknown_inst.json"),
        JSON.stringify({
          gameInstanceId: "unknown_inst",
          gameConfigId: "nonexistent_config",
          stateVersion: 5,
          players: {},
        }),
        "utf-8",
      );

      const app = createApp({ snapshotDir: TEST_SNAPSHOT_DIR });
      await app.ready();

      // The instance should be present with the current config's gameConfigId
      expect(app.gameInstances.has("unknown_inst")).toBe(true);
      const state = app.gameInstances.get("unknown_inst")!;
      expect(state.gameConfigId).toBe("minimal_v1");
      // No players → no migration warnings → stateVersion unchanged
      expect(state.stateVersion).toBe(5);

      await app.close();
    });
  });
});
