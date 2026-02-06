import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { startServer, type ServerHandle } from "./process.js";
import { step } from "./logger.js";
import {
  tx,
  getStats,
  expectAccepted,
} from "./client.js";

describe("E2E — Set Bonuses (config_sets)", () => {
  let srv: ServerHandle;
  const ADMIN_KEY = "e2e-admin-key-sets";
  const API_KEY = "e2e-sets-key-001";

  beforeAll(async () => {
    srv = await startServer({
      configPath: "examples/config_sets.json",
      extraEnv: { ADMIN_API_KEY: ADMIN_KEY },
    });

    // Bootstrap: actor → player → character
    await step("bootstrap actor", async () => {
      const res = await tx(srv.baseUrl, ADMIN_KEY, {
        txId: "sets_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "sets_actor",
        apiKey: API_KEY,
      });
      expectAccepted(res);
    });

    await step("bootstrap player", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "sets_player",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_1",
      });
      expectAccepted(res);
    });

    await step("bootstrap character", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "sets_char",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        classId: "warrior",
      });
      expectAccepted(res);
    });

    // Create 4 set pieces: sword_basic (1 piece), warrior_helm (1 piece),
    // warrior_chest (1 piece), versatile_sword (1 piece)
    const gearDefs = [
      { gearId: "sb_1", gearDefId: "sword_basic" },
      { gearId: "helm_1", gearDefId: "warrior_helm" },
      { gearId: "chest_1", gearDefId: "warrior_chest" },
      { gearId: "vs_1", gearDefId: "versatile_sword" },
    ];
    for (const g of gearDefs) {
      await step(`CreateGear: ${g.gearId} (${g.gearDefId})`, async () => {
        const res = await tx(srv.baseUrl, API_KEY, {
          txId: `sets_gear_${g.gearId}`,
          type: "CreateGear",
          gameInstanceId: "instance_001",
          playerId: "player_1",
          gearId: g.gearId,
          gearDefId: g.gearDefId,
        });
        expectAccepted(res, `CreateGear ${g.gearId}`);
      });
    }
  }, 30_000);

  afterAll(async () => {
    await srv.stop();
  });

  // -----------------------------------------------------------------------
  // No set bonus with 0 pieces
  // -----------------------------------------------------------------------

  it("base stats with no gear equipped (no set bonus)", async () => {
    await step("stats with no gear → base only", async () => {
      const res = await getStats(
        srv.baseUrl,
        API_KEY,
        "instance_001",
        "char_1",
      );
      // warrior base: str=5, hp=20. No gear.
      expect(res.body.finalStats.strength).toBe(5);
      expect(res.body.finalStats.hp).toBe(20);
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // 1 set piece — no 2-piece bonus yet
  // -----------------------------------------------------------------------

  it("equip 1 set piece → gear stats but no set bonus", async () => {
    await step("EquipGear: sword_basic → right_hand", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "sets_equip_sb",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        gearId: "sb_1",
      });
      expectAccepted(res, "equip sword_basic");
    }, srv.logs);

    await step("stats → base + sword (no set bonus yet)", async () => {
      const res = await getStats(
        srv.baseUrl,
        API_KEY,
        "instance_001",
        "char_1",
      );
      // base str=5 + sword str=3 = 8. No 2-piece bonus (only 1 piece).
      expect(res.body.finalStats.strength).toBe(8);
      expect(res.body.finalStats.hp).toBe(20);
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // 2 set pieces → 2-piece bonus activates (str+2)
  // -----------------------------------------------------------------------

  it("equip 2nd set piece → 2-piece bonus activates", async () => {
    await step("EquipGear: warrior_helm → head", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "sets_equip_helm",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        gearId: "helm_1",
      });
      expectAccepted(res, "equip helm");
    }, srv.logs);

    await step("stats → 2-piece bonus active (str +2)", async () => {
      const res = await getStats(
        srv.baseUrl,
        API_KEY,
        "instance_001",
        "char_1",
      );
      // base str=5 + sword=3 + helm=0 + 2piece bonus=2 = 10
      // base hp=20 + helm=3 = 23
      expect(res.body.finalStats.strength).toBe(10);
      expect(res.body.finalStats.hp).toBe(23);
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // 3 set pieces — still only 2-piece bonus
  // -----------------------------------------------------------------------

  it("equip 3rd set piece → still only 2-piece bonus", async () => {
    await step("EquipGear: warrior_chest → chest", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "sets_equip_chest",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        gearId: "chest_1",
      });
      expectAccepted(res, "equip chest");
    }, srv.logs);

    await step("stats → 3 pieces, only 2-piece bonus active", async () => {
      const res = await getStats(
        srv.baseUrl,
        API_KEY,
        "instance_001",
        "char_1",
      );
      // base str=5 + sword=3 + 2piece=2 = 10
      // base hp=20 + helm=3 + chest=5 = 28 (no 4-piece yet)
      expect(res.body.finalStats.strength).toBe(10);
      expect(res.body.finalStats.hp).toBe(28);
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // 4 set pieces → both 2-piece AND 4-piece bonuses active
  // -----------------------------------------------------------------------

  it("equip 4th set piece → 2-piece AND 4-piece bonuses both active", async () => {
    await step("EquipGear: versatile_sword → off_hand", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "sets_equip_vs",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        gearId: "vs_1",
        slotPattern: ["off_hand"],
      });
      expectAccepted(res, "equip versatile off_hand");
    }, srv.logs);

    await step("stats → 4 pieces, both bonuses active (str+2, hp+10)", async () => {
      const res = await getStats(
        srv.baseUrl,
        API_KEY,
        "instance_001",
        "char_1",
      );
      // base str=5 + sword=3 + versatile=4 + 2piece=2 = 14
      // base hp=20 + helm=3 + chest=5 + 4piece=10 = 38
      expect(res.body.finalStats.strength).toBe(14);
      expect(res.body.finalStats.hp).toBe(38);
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // Unequip one piece → drops below 4, only 2-piece remains
  // -----------------------------------------------------------------------

  it("unequip one piece → drops to 3 pieces, 4-piece bonus deactivates", async () => {
    await step("UnequipGear: versatile_sword", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "sets_unequip_vs",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "vs_1",
      });
      expectAccepted(res, "unequip versatile");
    }, srv.logs);

    await step("stats → back to 3 pieces, only 2-piece bonus", async () => {
      const res = await getStats(
        srv.baseUrl,
        API_KEY,
        "instance_001",
        "char_1",
      );
      // base str=5 + sword=3 + 2piece=2 = 10
      // base hp=20 + helm=3 + chest=5 = 28 (4-piece deactivated)
      expect(res.body.finalStats.strength).toBe(10);
      expect(res.body.finalStats.hp).toBe(28);
    }, srv.logs);
  });
});
