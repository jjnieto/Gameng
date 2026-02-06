import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { createApp } from "../src/app.js";
import { loadGameConfig } from "../src/config-loader.js";
import { migrateStateToConfig } from "../src/migrator.js";
import type { GameState } from "../src/state.js";
import { assertEquipInvariants } from "./helpers.js";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";

interface TransactionResult {
  txId: string;
  accepted: boolean;
  stateVersion: number;
  errorCode?: string;
  errorMessage?: string;
}

const TEST_SNAPSHOT_DIR = resolve("test-snapshots-9b");
const ADMIN_KEY = "test-admin-key-slice9b";
const TEST_API_KEY = "test-key-slice9b";

function cleanDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
  }
}

const configMinimal = loadGameConfig("examples/config_minimal.json");

describe("Slice 9B — Best-effort migration on snapshot restore", () => {
  beforeEach(() => {
    cleanDir(TEST_SNAPSHOT_DIR);
  });

  afterAll(() => {
    cleanDir(TEST_SNAPSHOT_DIR);
  });

  describe("Unit — migrateStateToConfig", () => {
    it("removes slots not in target config", () => {
      // config_sets has head/chest slots; config_minimal does not
      const state: GameState = {
        gameInstanceId: "inst_slot",
        gameConfigId: "sets_v1",
        stateVersion: 1,
        players: {
          p1: {
            characters: {
              c1: {
                classId: "warrior",
                level: 1,
                equipped: {
                  right_hand: "sword_1",
                  head: "helm_1",
                },
              },
            },
            gear: {
              sword_1: {
                gearDefId: "sword_basic",
                level: 1,
                equippedBy: "c1",
              },
              helm_1: {
                gearDefId: "warrior_helm",
                level: 1,
                equippedBy: "c1",
              },
            },
          },
        },
        actors: {},
      };

      const { migratedState, report } = migrateStateToConfig(
        state,
        configMinimal,
      );

      // head slot removed
      expect(migratedState.players.p1.characters.c1.equipped).not.toHaveProperty("head");
      expect(report.slotsRemoved).toBe(1);
      // warrior_helm also has orphaned gearDef (not in config_minimal)
      // so helm_1 should be unequipped too
      expect(migratedState.players.p1.gear.helm_1.equippedBy).toBeNull();
      expect(report.orphanedGearDefs).toBeGreaterThanOrEqual(1);
    });

    it("unequips gear with orphaned gearDefId but keeps in inventory", () => {
      // warrior_helm exists in config_sets but not config_minimal
      const state: GameState = {
        gameInstanceId: "inst_orphan_gear",
        gameConfigId: "sets_v1",
        stateVersion: 3,
        players: {
          p1: {
            characters: {
              c1: {
                classId: "warrior",
                level: 1,
                equipped: { head: "helm_1" },
              },
            },
            gear: {
              helm_1: {
                gearDefId: "warrior_helm",
                level: 2,
                equippedBy: "c1",
              },
            },
          },
        },
        actors: {},
      };

      const { migratedState, report } = migrateStateToConfig(
        state,
        configMinimal,
      );

      // Gear stays in inventory
      expect(migratedState.players.p1.gear.helm_1).toBeDefined();
      expect(migratedState.players.p1.gear.helm_1.gearDefId).toBe("warrior_helm");
      // But unequipped
      expect(migratedState.players.p1.gear.helm_1.equippedBy).toBeNull();
      // Character no longer has it equipped
      expect(migratedState.players.p1.characters.c1.equipped).not.toHaveProperty("head");
      expect(report.orphanedGearDefs).toBe(1);
      expect(report.gearsUnequipped).toBeGreaterThanOrEqual(1);
    });

    it("warns on orphaned classId without mutating character", () => {
      const state: GameState = {
        gameInstanceId: "inst_orphan_class",
        gameConfigId: "some_config",
        stateVersion: 2,
        players: {
          p1: {
            characters: {
              c1: {
                classId: "mage", // not in config_minimal
                level: 5,
                equipped: {},
              },
            },
            gear: {},
          },
        },
        actors: {},
      };

      const { migratedState, report } = migrateStateToConfig(
        state,
        configMinimal,
      );

      // Character preserved with original classId
      expect(migratedState.players.p1.characters.c1.classId).toBe("mage");
      expect(migratedState.players.p1.characters.c1.level).toBe(5);
      expect(report.orphanedClasses).toBe(1);
      const classWarning = report.warnings.find(
        (w) => w.rule === "CLASS_ORPHANED",
      );
      expect(classWarning).toBeDefined();
      expect(classWarning!.detail).toContain("mage");
    });

    it("unequips gear when equipped slots don't match any equipPattern", () => {
      // sword_basic in config_minimal only has pattern [["right_hand"]]
      // Put it in off_hand instead
      const state: GameState = {
        gameInstanceId: "inst_pattern",
        gameConfigId: "minimal_v1",
        stateVersion: 1,
        players: {
          p1: {
            characters: {
              c1: {
                classId: "warrior",
                level: 1,
                equipped: { off_hand: "sword_1" },
              },
            },
            gear: {
              sword_1: {
                gearDefId: "sword_basic",
                level: 1,
                equippedBy: "c1",
              },
            },
          },
        },
        actors: {},
      };

      const { migratedState, report } = migrateStateToConfig(
        state,
        configMinimal,
      );

      // Gear unequipped because off_hand doesn't match pattern [["right_hand"]]
      expect(migratedState.players.p1.gear.sword_1.equippedBy).toBeNull();
      expect(migratedState.players.p1.characters.c1.equipped).not.toHaveProperty("off_hand");
      expect(report.gearsUnequipped).toBe(1);
      const patternWarning = report.warnings.find(
        (w) => w.rule === "EQUIPPATTERN_MISMATCH",
      );
      expect(patternWarning).toBeDefined();
    });

    it("no-op migration leaves stateVersion unchanged and zero warnings", () => {
      // State that perfectly matches config_minimal
      const state: GameState = {
        gameInstanceId: "inst_clean",
        gameConfigId: "minimal_v1",
        stateVersion: 10,
        players: {
          p1: {
            characters: {
              c1: {
                classId: "warrior",
                level: 3,
                equipped: { right_hand: "sword_1" },
              },
            },
            gear: {
              sword_1: {
                gearDefId: "sword_basic",
                level: 1,
                equippedBy: "c1",
              },
            },
          },
        },
        actors: {},
      };

      const { migratedState, report } = migrateStateToConfig(
        state,
        configMinimal,
      );

      expect(report.warnings).toHaveLength(0);
      expect(migratedState.stateVersion).toBe(10); // unchanged
      expect(report.slotsRemoved).toBe(0);
      expect(report.gearsUnequipped).toBe(0);
      expect(report.orphanedClasses).toBe(0);
      expect(report.orphanedGearDefs).toBe(0);
    });

    it("clears equippedBy when no matching equipped slot exists (invariant reverse)", () => {
      const state: GameState = {
        gameInstanceId: "inst_inv_rev",
        gameConfigId: "minimal_v1",
        stateVersion: 1,
        players: {
          p1: {
            characters: {
              c1: {
                classId: "warrior",
                level: 1,
                equipped: {}, // no slots point to sword_1
              },
            },
            gear: {
              sword_1: {
                gearDefId: "sword_basic",
                level: 1,
                equippedBy: "c1", // dangling reference
              },
            },
          },
        },
        actors: {},
      };

      const { migratedState, report } = migrateStateToConfig(
        state,
        configMinimal,
      );

      expect(migratedState.players.p1.gear.sword_1.equippedBy).toBeNull();
      const revWarning = report.warnings.find(
        (w) => w.rule === "INVARIANT_REVERSE",
      );
      expect(revWarning).toBeDefined();
    });

    it("removes equipped slot referencing non-existent gear (invariant forward)", () => {
      const state: GameState = {
        gameInstanceId: "inst_inv_fwd",
        gameConfigId: "minimal_v1",
        stateVersion: 1,
        players: {
          p1: {
            characters: {
              c1: {
                classId: "warrior",
                level: 1,
                equipped: { right_hand: "ghost_gear" }, // gear doesn't exist
              },
            },
            gear: {},
          },
        },
        actors: {},
      };

      const { migratedState, report } = migrateStateToConfig(
        state,
        configMinimal,
      );

      expect(migratedState.players.p1.characters.c1.equipped).not.toHaveProperty("right_hand");
      const fwdWarning = report.warnings.find(
        (w) => w.rule === "INVARIANT_FORWARD",
      );
      expect(fwdWarning).toBeDefined();
    });

    it("bumps stateVersion when warnings exist", () => {
      const state: GameState = {
        gameInstanceId: "inst_bump",
        gameConfigId: "old_config",
        stateVersion: 7,
        players: {
          p1: {
            characters: {
              c1: {
                classId: "mage", // orphaned
                level: 1,
                equipped: {},
              },
            },
            gear: {},
          },
        },
        actors: {},
      };

      const { migratedState, report } = migrateStateToConfig(
        state,
        configMinimal,
      );

      expect(report.warnings.length).toBeGreaterThan(0);
      expect(migratedState.stateVersion).toBe(8); // bumped
    });

    it("does not mutate the original state", () => {
      const state: GameState = {
        gameInstanceId: "inst_immut",
        gameConfigId: "sets_v1",
        stateVersion: 1,
        players: {
          p1: {
            characters: {
              c1: {
                classId: "warrior",
                level: 1,
                equipped: { head: "helm_1" },
              },
            },
            gear: {
              helm_1: {
                gearDefId: "warrior_helm",
                level: 1,
                equippedBy: "c1",
              },
            },
          },
        },
        actors: {},
      };

      const originalJson = JSON.stringify(state);
      migrateStateToConfig(state, configMinimal);

      // Original state should be unchanged
      expect(JSON.stringify(state)).toBe(originalJson);
    });
  });

  describe("Integration — restore with config mismatch", () => {
    it("round-trip: snapshot with sets_v1 config restored with config_minimal", async () => {
      // Write a snapshot that was created under config_sets (has head slot equipped)
      mkdirSync(TEST_SNAPSHOT_DIR, { recursive: true });
      const snapshotState: GameState = {
        gameInstanceId: "migrated_inst",
        gameConfigId: "sets_v1",
        stateVersion: 5,
        players: {
          p1: {
            characters: {
              c1: {
                classId: "warrior",
                level: 3,
                equipped: {
                  right_hand: "sword_1",
                  head: "helm_1",
                },
              },
            },
            gear: {
              sword_1: {
                gearDefId: "sword_basic",
                level: 1,
                equippedBy: "c1",
              },
              helm_1: {
                gearDefId: "warrior_helm",
                level: 1,
                equippedBy: "c1",
              },
            },
          },
        },
        actors: {
          test_actor: { apiKey: TEST_API_KEY, playerIds: ["p1"] },
        },
      };
      writeFileSync(
        join(TEST_SNAPSHOT_DIR, "migrated_inst.json"),
        JSON.stringify(snapshotState),
        "utf-8",
      );

      // Create app with config_minimal (no head/chest slots, no warrior_helm gearDef)
      const app = createApp({ snapshotDir: TEST_SNAPSHOT_DIR });
      await app.ready();

      // Instance should be present
      expect(app.gameInstances.has("migrated_inst")).toBe(true);
      const state = app.gameInstances.get("migrated_inst")!;
      expect(state.gameConfigId).toBe("minimal_v1");

      // head slot gear should be unequipped (slot removed + gearDef orphaned)
      expect(state.players.p1.characters.c1.equipped).not.toHaveProperty("head");
      expect(state.players.p1.gear.helm_1.equippedBy).toBeNull();

      // sword_1 should still be equipped in right_hand
      expect(state.players.p1.characters.c1.equipped.right_hand).toBe("sword_1");
      expect(state.players.p1.gear.sword_1.equippedBy).toBe("c1");

      // Equip invariants hold post-migration
      assertEquipInvariants(state.players.p1);

      // Stats should work for the character (need auth)
      const statsRes = await app.inject({
        method: "GET",
        url: "/migrated_inst/character/c1/stats",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });
      expect(statsRes.statusCode).toBe(200);
      const stats = statsRes.json<{ finalStats: Record<string, number> }>();
      // warrior base: strength=5, hp=20; sword_basic: strength=3
      expect(stats.finalStats.strength).toBe(8);
      expect(stats.finalStats.hp).toBe(20);

      await app.close();
    });
  });

  describe("Integration — EquipGear rejects orphaned gearDefId at runtime", () => {
    it("returns INVALID_CONFIG_REFERENCE for gear with unknown gearDefId", async () => {
      const app = createApp({ adminApiKey: ADMIN_KEY });
      await app.ready();

      // Bootstrap actor (requires admin key)
      await app.inject({
        method: "POST",
        url: "/instance_001/tx",
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
        payload: {
          txId: "s9b_rt_actor",
          type: "CreateActor",
          gameInstanceId: "instance_001",
          actorId: "test_actor",
          apiKey: TEST_API_KEY,
        },
      });

      // Create player and character
      const createP = await app.inject({
        method: "POST",
        url: "/instance_001/tx",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
        payload: {
          txId: "s9b_rt_001",
          type: "CreatePlayer",
          gameInstanceId: "instance_001",
          playerId: "p1",
        },
      });
      expect(createP.json<TransactionResult>().accepted).toBe(true);

      const createC = await app.inject({
        method: "POST",
        url: "/instance_001/tx",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
        payload: {
          txId: "s9b_rt_002",
          type: "CreateCharacter",
          gameInstanceId: "instance_001",
          playerId: "p1",
          characterId: "c1",
          classId: "warrior",
        },
      });
      expect(createC.json<TransactionResult>().accepted).toBe(true);

      // Manually inject a gear with a bad gearDefId into state
      const state = app.gameInstances.get("instance_001")!;
      state.players.p1.gear.bad_gear = {
        gearDefId: "nonexistent_def",
        level: 1,
      };

      // Try to equip it
      const equipRes = await app.inject({
        method: "POST",
        url: "/instance_001/tx",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
        payload: {
          txId: "s9b_rt_003",
          type: "EquipGear",
          gameInstanceId: "instance_001",
          playerId: "p1",
          characterId: "c1",
          gearId: "bad_gear",
          slotPattern: ["right_hand"],
        },
      });
      const result = equipRes.json<TransactionResult>();
      expect(result.accepted).toBe(false);
      expect(result.errorCode).toBe("INVALID_CONFIG_REFERENCE");
      expect(result.errorMessage).toContain("nonexistent_def");

      await app.close();
    });
  });

  describe("Orphaned classId — stats and equip behavior", () => {
    it("stats returns base=0 for orphaned class, gear still sums correctly", async () => {
      // State with classId="mage" (not in config_minimal) and valid gear equipped
      const state: GameState = {
        gameInstanceId: "inst_orphan_stats",
        gameConfigId: "minimal_v1",
        stateVersion: 1,
        players: {
          p1: {
            characters: {
              c1: {
                classId: "mage", // orphaned
                level: 3,
                equipped: { right_hand: "sword_1" },
              },
            },
            gear: {
              sword_1: {
                gearDefId: "sword_basic",
                level: 1,
                equippedBy: "c1",
              },
            },
          },
        },
        actors: {
          test_actor: { apiKey: TEST_API_KEY, playerIds: ["p1"] },
        },
      };

      // Migrate — classId warning, but gear and slot are valid
      const { migratedState, report } = migrateStateToConfig(
        state,
        configMinimal,
      );
      expect(report.orphanedClasses).toBe(1);
      // Gear stays equipped — gearDef and slot are valid
      expect(migratedState.players.p1.characters.c1.equipped.right_hand).toBe(
        "sword_1",
      );
      assertEquipInvariants(migratedState.players.p1);

      // Write snapshot and restore via app to test stats endpoint
      mkdirSync(TEST_SNAPSHOT_DIR, { recursive: true });
      writeFileSync(
        join(TEST_SNAPSHOT_DIR, "inst_orphan_stats.json"),
        JSON.stringify(migratedState),
        "utf-8",
      );

      const app = createApp({ snapshotDir: TEST_SNAPSHOT_DIR });
      await app.ready();

      const statsRes = await app.inject({
        method: "GET",
        url: "/inst_orphan_stats/character/c1/stats",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });
      expect(statsRes.statusCode).toBe(200);
      const stats = statsRes.json<{
        classId: string;
        finalStats: Record<string, number>;
      }>();
      expect(stats.classId).toBe("mage");
      // Orphaned class base=0 for all stats; sword_basic adds strength=3
      expect(stats.finalStats.strength).toBe(3);
      expect(stats.finalStats.hp).toBe(0);

      await app.close();
    });

    it("EquipGear allows unrestricted gear on orphaned-class character", async () => {
      const app = createApp({ adminApiKey: ADMIN_KEY });
      await app.ready();

      // Bootstrap actor (requires admin key)
      await app.inject({
        method: "POST",
        url: "/instance_001/tx",
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
        payload: {
          txId: "s9b_orphan_eq_actor",
          type: "CreateActor",
          gameInstanceId: "instance_001",
          actorId: "test_actor",
          apiKey: TEST_API_KEY,
        },
      });

      // Create player
      const createP = await app.inject({
        method: "POST",
        url: "/instance_001/tx",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
        payload: {
          txId: "s9b_orphan_eq_001",
          type: "CreatePlayer",
          gameInstanceId: "instance_001",
          playerId: "p1",
        },
      });
      expect(createP.json<TransactionResult>().accepted).toBe(true);

      // Inject character with orphaned classId and unequipped gear
      const state = app.gameInstances.get("instance_001")!;
      state.players.p1.characters.c1 = {
        classId: "mage", // not in config_minimal
        level: 3,
        equipped: {},
      };
      state.players.p1.gear.sword_1 = {
        gearDefId: "sword_basic", // valid in config_minimal, no restrictions
        level: 1,
      };

      // EquipGear should succeed — sword_basic has no class restrictions
      const equipRes = await app.inject({
        method: "POST",
        url: "/instance_001/tx",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
        payload: {
          txId: "s9b_orphan_eq_002",
          type: "EquipGear",
          gameInstanceId: "instance_001",
          playerId: "p1",
          characterId: "c1",
          gearId: "sword_1",
        },
      });
      const result = equipRes.json<TransactionResult>();
      expect(result.accepted).toBe(true);

      // Verify state consistency
      assertEquipInvariants(state.players.p1);

      await app.close();
    });

    it("EquipGear rejects class-restricted gear with RESTRICTION_FAILED for orphaned class", async () => {
      const app = createApp({ adminApiKey: ADMIN_KEY });
      await app.ready();

      // Bootstrap actor (requires admin key)
      await app.inject({
        method: "POST",
        url: "/instance_001/tx",
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
        payload: {
          txId: "s9b_orphan_restr_actor",
          type: "CreateActor",
          gameInstanceId: "instance_001",
          actorId: "test_actor",
          apiKey: TEST_API_KEY,
        },
      });

      const createP = await app.inject({
        method: "POST",
        url: "/instance_001/tx",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
        payload: {
          txId: "s9b_orphan_restr_001",
          type: "CreatePlayer",
          gameInstanceId: "instance_001",
          playerId: "p1",
        },
      });
      expect(createP.json<TransactionResult>().accepted).toBe(true);

      // Inject orphaned-class character + gear with allowedClasses restriction
      const state = app.gameInstances.get("instance_001")!;
      state.players.p1.characters.c1 = {
        classId: "mage", // not in config_minimal
        level: 5,
        equipped: {},
      };
      state.players.p1.gear.elite_1 = {
        gearDefId: "elite_sword", // allowedClasses: ["warrior"]
        level: 1,
      };

      // EquipGear should fail — "mage" not in allowedClasses ["warrior"]
      const equipRes = await app.inject({
        method: "POST",
        url: "/instance_001/tx",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
        payload: {
          txId: "s9b_orphan_restr_002",
          type: "EquipGear",
          gameInstanceId: "instance_001",
          playerId: "p1",
          characterId: "c1",
          gearId: "elite_1",
        },
      });
      const result = equipRes.json<TransactionResult>();
      expect(result.accepted).toBe(false);
      expect(result.errorCode).toBe("RESTRICTION_FAILED");
      expect(result.errorMessage).toContain("mage");
      expect(result.errorMessage).toContain("allowedClasses");

      await app.close();
    });
  });
});
