import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { startServer, type ServerHandle } from "./process.js";
import { step } from "./logger.js";
import {
  tx,
  getPlayer,
  expectAccepted,
  expectRejected,
  expectHttp,
} from "./client.js";

describe("E2E — Scoped Resources (config_costs)", () => {
  let srv: ServerHandle;
  const ADMIN_KEY = "e2e-admin-scoped";
  const API_KEY = "e2e-scoped-key";

  beforeAll(async () => {
    srv = await startServer({
      configPath: "examples/config_costs.json",
      extraEnv: { ADMIN_API_KEY: ADMIN_KEY },
    });
  }, 30_000);

  afterAll(async () => {
    await srv.stop();
  });

  // -- Setup --

  it("setup: actor + player + character + gear", async () => {
    await step("CreateActor", async () => {
      const res = await tx(srv.baseUrl, ADMIN_KEY, {
        txId: "sr_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "sr_actor",
        apiKey: API_KEY,
      });
      expectAccepted(res);
    }, srv.logs);

    await step("CreatePlayer", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "sr_player",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_1",
      });
      expectAccepted(res);
    }, srv.logs);

    await step("CreateCharacter", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "sr_char",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        classId: "warrior",
      });
      expectAccepted(res);
    }, srv.logs);

    await step("CreateGear", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "sr_gear",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "sword_1",
        gearDefId: "sword_basic",
      });
      expectAccepted(res);
    }, srv.logs);
  });

  // -- GrantCharacterResources --

  it("GrantCharacterResources adds xp to character", async () => {
    await step("GrantCharacterResources", async () => {
      const res = await tx(srv.baseUrl, ADMIN_KEY, {
        txId: "sr_gcr",
        type: "GrantCharacterResources",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        resources: { xp: 1000 },
      });
      expectAccepted(res);
    }, srv.logs);
  });

  it("GrantResources adds gold to player", async () => {
    await step("GrantResources", async () => {
      const res = await tx(srv.baseUrl, ADMIN_KEY, {
        txId: "sr_gr",
        type: "GrantResources",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        resources: { gold: 500 },
      });
      expectAccepted(res);
    }, srv.logs);
  });

  it("verify wallets: player.gold=500, char.xp=1000", async () => {
    await step("verify wallets", async () => {
      const res = await getPlayer(srv.baseUrl, API_KEY, "instance_001", "player_1");
      expectHttp(res, 200);
      expect(res.body.resources?.gold).toBe(500);
      expect(res.body.characters["char_1"].resources?.xp).toBe(1000);
    }, srv.logs);
  });

  // -- GrantCharacterResources: error cases --

  it("GrantCharacterResources requires admin key", async () => {
    await step("GCR without admin key", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "sr_gcr_unauth",
        type: "GrantCharacterResources",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        resources: { xp: 100 },
      });
      expectHttp(res, 401);
    }, srv.logs);
  });

  it("GrantCharacterResources rejects missing character", async () => {
    await step("GCR bad char", async () => {
      const res = await tx(srv.baseUrl, ADMIN_KEY, {
        txId: "sr_gcr_nochar",
        type: "GrantCharacterResources",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "no_such",
        resources: { xp: 100 },
      });
      expectRejected(res, "CHARACTER_NOT_FOUND");
    }, srv.logs);
  });

  // -- LevelUpCharacter: deducts from character wallet --

  it("LevelUpCharacter deducts xp from character wallet", async () => {
    await step("LevelUpCharacter", async () => {
      // config_costs: levelCostCharacter uses character.xp, base=100 perLevel=50
      // level 1→2: cost = 100 character.xp
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "sr_luc",
        type: "LevelUpCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
      });
      expectAccepted(res);
    }, srv.logs);

    await step("verify after LevelUpCharacter", async () => {
      const res = await getPlayer(srv.baseUrl, API_KEY, "instance_001", "player_1");
      expectHttp(res, 200);
      // 1000 - 100 = 900
      expect(res.body.characters["char_1"].resources?.xp).toBe(900);
      // player gold unchanged
      expect(res.body.resources?.gold).toBe(500);
    }, srv.logs);
  });

  // -- LevelUpGear: deducts from player wallet --

  it("LevelUpGear deducts gold from player wallet", async () => {
    await step("LevelUpGear", async () => {
      // config_costs: levelCostGear uses player.gold, base=50 perLevel=25
      // level 1→2: cost = 50 player.gold
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "sr_lug",
        type: "LevelUpGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "sword_1",
      });
      expectAccepted(res);
    }, srv.logs);

    await step("verify after LevelUpGear", async () => {
      const res = await getPlayer(srv.baseUrl, API_KEY, "instance_001", "player_1");
      expectHttp(res, 200);
      // 500 - 50 = 450
      expect(res.body.resources?.gold).toBe(450);
      // char xp unchanged
      expect(res.body.characters["char_1"].resources?.xp).toBe(900);
    }, srv.logs);
  });

  // -- Insufficient resources --

  it("LevelUpCharacter fails with insufficient character xp", async () => {
    // Drain xp first
    await step("drain xp", async () => {
      const res = await tx(srv.baseUrl, ADMIN_KEY, {
        txId: "sr_drain_xp",
        type: "GrantCharacterResources",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        resources: { xp: -900 },
      });
      expectAccepted(res);
    }, srv.logs);

    await step("LevelUpCharacter fails", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "sr_luc_fail",
        type: "LevelUpCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
      });
      expectRejected(res, "INSUFFICIENT_RESOURCES");
    }, srv.logs);
  });
});
