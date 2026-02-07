import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { startServer, type ServerHandle } from "./process.js";
import { step } from "./logger.js";
import {
  tx,
  getPlayer,
  getStats,
  getHealth,
  expectAccepted,
  expectRejected,
  expectHttp,
} from "./client.js";

describe("E2E — Happy Path (config_minimal)", () => {
  let srv: ServerHandle;
  const ADMIN_KEY = "e2e-admin-key-happy";
  const API_KEY = "e2e-happy-key-001";

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
  // Health & version
  // -----------------------------------------------------------------------

  it("GET /health returns ok", async () => {
    await step("health check", async () => {
      const res = await getHealth(srv.baseUrl);
      expectHttp(res, 200);
      expect(res.body.status).toBe("ok");
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // Onboarding: CreateActor → CreatePlayer → CreateCharacter
  // -----------------------------------------------------------------------

  it("onboarding flow: actor → player → character", async () => {
    await step("CreateActor", async () => {
      const res = await tx(srv.baseUrl, ADMIN_KEY, {
        txId: "hp_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "hero_actor",
        apiKey: API_KEY,
      });
      expectAccepted(res, "CreateActor");
      expect(res.body.stateVersion).toBe(1);
    }, srv.logs);

    await step("CreatePlayer", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "hp_player",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_1",
      });
      expectAccepted(res, "CreatePlayer");
      expect(res.body.stateVersion).toBe(2);
    }, srv.logs);

    await step("CreateCharacter (warrior)", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "hp_char",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        classId: "warrior",
      });
      expectAccepted(res, "CreateCharacter");
      expect(res.body.stateVersion).toBe(3);
    }, srv.logs);

    await step("verify player exists after onboarding", async () => {
      const res = await getPlayer(
        srv.baseUrl,
        API_KEY,
        "instance_001",
        "player_1",
      );
      expectHttp(res, 200);
      expect(res.body.characters.char_1).toBeDefined();
      expect(res.body.characters.char_1.classId).toBe("warrior");
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // Gear creation: 1-slot sword + 2-slot greatsword
  // -----------------------------------------------------------------------

  it("create 1-slot and 2-slot gear", async () => {
    await step("CreateGear: sword_basic (1-slot)", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "hp_sword",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "sword_1",
        gearDefId: "sword_basic",
      });
      expectAccepted(res, "CreateGear sword");
    }, srv.logs);

    await step("CreateGear: greatsword (2-slot)", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "hp_greatsword",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gs_1",
        gearDefId: "greatsword",
      });
      expectAccepted(res, "CreateGear greatsword");
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // EquipGear 1-slot, verify stats
  // -----------------------------------------------------------------------

  it("equip 1-slot sword → stats reflect gear bonus", async () => {
    await step("EquipGear: sword_1 → right_hand", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "hp_equip_sword",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        gearId: "sword_1",
      });
      expectAccepted(res, "EquipGear sword");
    }, srv.logs);

    await step("GET stats → base + sword bonus", async () => {
      const res = await getStats(
        srv.baseUrl,
        API_KEY,
        "instance_001",
        "char_1",
      );
      expectHttp(res, 200);
      // warrior base: str=5, hp=20. sword_basic: str=3.
      expect(res.body.finalStats.strength).toBe(8);
      expect(res.body.finalStats.hp).toBe(20);
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // UnequipGear, verify stats back to base
  // -----------------------------------------------------------------------

  it("unequip sword → stats return to base", async () => {
    await step("UnequipGear: sword_1", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "hp_unequip_sword",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "sword_1",
      });
      expectAccepted(res, "UnequipGear sword");
    }, srv.logs);

    await step("GET stats → back to base", async () => {
      const res = await getStats(
        srv.baseUrl,
        API_KEY,
        "instance_001",
        "char_1",
      );
      expect(res.body.finalStats.strength).toBe(5);
      expect(res.body.finalStats.hp).toBe(20);
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // EquipGear 2-slot greatsword, verify stats & multi-slot dedup
  // -----------------------------------------------------------------------

  it("equip 2-slot greatsword → occupies both slots, stats counted once", async () => {
    await step("EquipGear: greatsword → right_hand+off_hand", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "hp_equip_gs",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        gearId: "gs_1",
      });
      expectAccepted(res, "EquipGear greatsword");
    }, srv.logs);

    await step("GET player → both slots occupied by gs_1", async () => {
      const res = await getPlayer(
        srv.baseUrl,
        API_KEY,
        "instance_001",
        "player_1",
      );
      expectHttp(res, 200);
      const equipped = res.body.characters.char_1.equipped;
      expect(equipped.right_hand).toBe("gs_1");
      expect(equipped.off_hand).toBe("gs_1");
    }, srv.logs);

    await step("GET stats → greatsword counted once (str=10, hp=25)", async () => {
      const res = await getStats(
        srv.baseUrl,
        API_KEY,
        "instance_001",
        "char_1",
      );
      // warrior base: str=5, hp=20. greatsword: str=5, hp=5. Counted once.
      expect(res.body.finalStats.strength).toBe(10);
      expect(res.body.finalStats.hp).toBe(25);
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // Unequip greatsword for next tests
  // -----------------------------------------------------------------------

  it("unequip greatsword to clear slots", async () => {
    await step("UnequipGear: gs_1", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "hp_unequip_gs",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gs_1",
      });
      expectAccepted(res, "UnequipGear greatsword");
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // Restrictions: gear level / class restrictions
  // -----------------------------------------------------------------------

  it("elite_sword rejected at level 1 (requiredCharacterLevel=3), accepted after LevelUp", async () => {
    await step("CreateGear: elite_sword", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "hp_elite",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "elite_1",
        gearDefId: "elite_sword",
      });
      expectAccepted(res, "CreateGear elite_sword");
    }, srv.logs);

    await step("EquipGear elite_sword at level 1 → RESTRICTION_FAILED", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "hp_equip_elite_fail",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        gearId: "elite_1",
      });
      expectRejected(res, "RESTRICTION_FAILED");
    }, srv.logs);

    await step("LevelUpCharacter to level 3", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "hp_levelup",
        type: "LevelUpCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        levels: 2,
      });
      expectAccepted(res, "LevelUp to 3");
    }, srv.logs);

    await step("EquipGear elite_sword at level 3 → accepted", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "hp_equip_elite_ok",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        gearId: "elite_1",
      });
      expectAccepted(res, "EquipGear elite at level 3");
    }, srv.logs);

    await step("GET stats → scaled class + elite_sword (str=6+8=14)", async () => {
      // linear growth: perLevelMultiplier=0.1, additivePerLevel={hp:1}
      // class at level 3: str = floor(5 * (1 + 0.1*2)) = floor(5*1.2) = 6
      // elite_sword at gear level 1: str = 8 (no scaling at level 1)
      const res = await getStats(
        srv.baseUrl,
        API_KEY,
        "instance_001",
        "char_1",
      );
      expect(res.body.finalStats.strength).toBe(14);
      expect(res.body.level).toBe(3);
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // Blocked class restriction
  // -----------------------------------------------------------------------

  it("cursed_blade rejected for warrior (blockedClasses)", async () => {
    await step("CreateGear: cursed_blade", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "hp_cursed",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "cursed_1",
        gearDefId: "cursed_blade",
      });
      expectAccepted(res, "CreateGear cursed_blade");
    }, srv.logs);

    await step("EquipGear cursed_blade (warrior blocked) → RESTRICTION_FAILED", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "hp_equip_cursed",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        gearId: "cursed_1",
      });
      expectRejected(res, "RESTRICTION_FAILED");
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // Duplicate / error cases
  // -----------------------------------------------------------------------

  it("duplicate CreatePlayer → ALREADY_EXISTS", async () => {
    await step("duplicate CreatePlayer → ALREADY_EXISTS", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "hp_dup_player",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_1",
      });
      expectRejected(res, "ALREADY_EXISTS");
    }, srv.logs);
  });

  it("unknown instance → 404 INSTANCE_NOT_FOUND", async () => {
    await step("GET unknown instance → 404", async () => {
      const res = await getPlayer(srv.baseUrl, API_KEY, "nope", "anyone");
      expectHttp(res, 404, "INSTANCE_NOT_FOUND");
    }, srv.logs);
  });
});
