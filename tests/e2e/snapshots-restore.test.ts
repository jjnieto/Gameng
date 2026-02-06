import { describe, it, expect, afterAll } from "vitest";
import { startServer, type ServerHandle } from "./process.js";
import { step } from "./logger.js";
import {
  tx,
  getPlayer,
  expectAccepted,
  expectHttp,
} from "./client.js";

describe("E2E — Snapshot Persistence & Restore", () => {
  // All tests in this suite share the same snapshotDir across restarts
  let snapshotDir: string;
  let srv: ServerHandle;
  const ADMIN_KEY = "e2e-admin-key-snap";
  const API_KEY = "e2e-snap-key-001";

  afterAll(async () => {
    if (srv) await srv.stop();
  });

  // -----------------------------------------------------------------------
  // Phase 1: Start server, mutate state, stop (triggers flush)
  // -----------------------------------------------------------------------

  it("phase 1: create state and persist via shutdown flush", async () => {
    srv = await startServer({
      configPath: "examples/config_minimal.json",
      extraEnv: { ADMIN_API_KEY: ADMIN_KEY },
    });
    snapshotDir = srv.snapshotDir;
    console.log(`  [info] snapshotDir = ${snapshotDir}`);

    await step("CreateActor", async () => {
      const res = await tx(srv.baseUrl, ADMIN_KEY, {
        txId: "snap_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "snap_actor",
        apiKey: API_KEY,
      });
      expectAccepted(res);
    }, srv.logs);

    await step("CreatePlayer", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "snap_player",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_snap",
      });
      expectAccepted(res);
    }, srv.logs);

    await step("CreateCharacter", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "snap_char",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_snap",
        characterId: "char_snap",
        classId: "warrior",
      });
      expectAccepted(res);
    }, srv.logs);

    await step("CreateGear", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "snap_gear",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "player_snap",
        gearId: "sword_snap",
        gearDefId: "sword_basic",
      });
      expectAccepted(res);
    }, srv.logs);

    await step("EquipGear", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "snap_equip",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_snap",
        characterId: "char_snap",
        gearId: "sword_snap",
      });
      expectAccepted(res);
    }, srv.logs);

    await step("verify player state before shutdown", async () => {
      const res = await getPlayer(
        srv.baseUrl,
        API_KEY,
        "instance_001",
        "player_snap",
      );
      expectHttp(res, 200);
      expect(res.body.characters.char_snap.equipped.right_hand).toBe(
        "sword_snap",
      );
    }, srv.logs);

    await step("stop server (triggers onClose flush)", async () => {
      await srv.stop();
    });
  }, 30_000);

  // -----------------------------------------------------------------------
  // Phase 2: Restart with same snapshotDir → state restored
  // -----------------------------------------------------------------------

  it("phase 2: restart and verify state is restored from snapshot", async () => {
    await step("start server with same snapshotDir", async () => {
      srv = await startServer({
        configPath: "examples/config_minimal.json",
        snapshotDir,
        extraEnv: { ADMIN_API_KEY: ADMIN_KEY },
      });
    });

    await step("verify player state restored (character + gear + equipped)", async () => {
      const res = await getPlayer(
        srv.baseUrl,
        API_KEY,
        "instance_001",
        "player_snap",
      );
      expectHttp(res, 200);
      expect(res.body.characters.char_snap).toBeDefined();
      expect(res.body.characters.char_snap.classId).toBe("warrior");
      expect(res.body.characters.char_snap.equipped.right_hand).toBe(
        "sword_snap",
      );
      expect(res.body.gear.sword_snap.equippedBy).toBe("char_snap");
    }, srv.logs);

    await step("new transactions work on restored state", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "snap_after_restore",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "player_snap",
        gearId: "sword_2",
        gearDefId: "sword_basic",
      });
      expectAccepted(res);
      // stateVersion continues from restored state (> initial)
      expect(res.body.stateVersion).toBeGreaterThan(0);
    }, srv.logs);

    await step("stop server for cleanup", async () => {
      await srv.stop();
    });
  }, 30_000);

  // -----------------------------------------------------------------------
  // Phase 3: Restart with different config → migration
  // -----------------------------------------------------------------------

  it("phase 3: restart with different config triggers migration", async () => {
    await step("start server with config_sets.json + same snapshotDir", async () => {
      srv = await startServer({
        configPath: "examples/config_sets.json",
        snapshotDir,
        extraEnv: { ADMIN_API_KEY: ADMIN_KEY },
      });
    });

    await step("verify player data survived migration", async () => {
      const res = await getPlayer(
        srv.baseUrl,
        API_KEY,
        "instance_001",
        "player_snap",
      );
      expectHttp(res, 200);
      // Character should still exist
      expect(res.body.characters.char_snap).toBeDefined();
      expect(res.body.characters.char_snap.classId).toBe("warrior");
      // Gear should still be in inventory (sword_basic exists in config_sets too)
      expect(res.body.gear.sword_snap).toBeDefined();
    }, srv.logs);
  }, 30_000);
});
