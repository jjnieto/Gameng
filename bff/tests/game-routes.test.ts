import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp } from "./helpers.js";

// ---- Fake engine that records what it receives ----

let fakeEngine: FastifyInstance;
let fakeEngineUrl: string;
let lastAuthHeader: string | undefined;
let lastTxBody: Record<string, unknown> | undefined;

beforeAll(async () => {
  fakeEngine = Fastify({ logger: false });

  fakeEngine.get("/health", async () => ({ status: "ok" }));

  fakeEngine.get("/instance_001/config", async () => ({
    gameConfigId: "test",
    maxLevel: 60,
    slots: {},
    classes: {},
    gearDefs: {},
  }));

  fakeEngine.get("/instance_001/stateVersion", async () => ({
    gameInstanceId: "instance_001",
    stateVersion: 10,
  }));

  fakeEngine.get<{ Params: { playerId: string } }>(
    "/instance_001/state/player/:playerId",
    async (request) => {
      lastAuthHeader = request.headers.authorization;
      return { characters: {}, gear: {}, resources: {} };
    },
  );

  fakeEngine.get<{ Params: { characterId: string } }>(
    "/instance_001/character/:characterId/stats",
    async (request) => {
      lastAuthHeader = request.headers.authorization;
      return {
        characterId: request.params.characterId,
        classId: "warrior",
        level: 1,
        finalStats: { str: 10 },
      };
    },
  );

  fakeEngine.post<{ Body: Record<string, unknown> }>(
    "/instance_001/tx",
    async (request) => {
      lastAuthHeader = request.headers.authorization;
      lastTxBody = request.body;
      const body = request.body;
      return { txId: body.txId ?? "tx", accepted: true, stateVersion: 1 };
    },
  );

  const addr = await fakeEngine.listen({ port: 0, host: "127.0.0.1" });
  fakeEngineUrl = addr;
});

afterAll(async () => {
  await fakeEngine.close();
});

// ---- Shared setup ----

async function setupBffWithUser() {
  const bff = await buildApp({ engineUrl: fakeEngineUrl, withAuth: true });

  const { hashPassword } = await import("../src/auth/passwords.js");
  const hash = await hashPassword("testpassword", 4);
  bff.userStore!.createUser({
    email: "gamer@test.com",
    passwordHash: hash,
    actorId: "actor_1",
    apiKey: "secret-actor-key",
    playerId: "player_1",
  });

  const loginRes = await bff.app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: "gamer@test.com", password: "testpassword" },
  });
  const jwt = (loginRes.json() as { token: string }).token;

  return { bff, jwt };
}

// ---- Slice 2 tests: authenticated proxy ----

describe("Game routes — authenticated proxy (Slice 2)", () => {
  let bff: Awaited<ReturnType<typeof buildApp>>;
  let jwt: string;
  const ACTOR_API_KEY = "secret-actor-key";

  beforeAll(async () => {
    const setup = await setupBffWithUser();
    bff = setup.bff;
    jwt = setup.jwt;
  });

  afterAll(async () => {
    await bff.app.close();
  });

  it("public routes work without auth", async () => {
    const res = await bff.app.inject({ method: "GET", url: "/game/health" });
    expect(res.statusCode).toBe(200);
  });

  it("GET /game/player/:id requires JWT", async () => {
    const res = await bff.app.inject({
      method: "GET",
      url: "/game/player/player_1",
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /game/player/:id with JWT injects actor apiKey", async () => {
    lastAuthHeader = undefined;
    const res = await bff.app.inject({
      method: "GET",
      url: "/game/player/player_1",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(lastAuthHeader).toBe(`Bearer ${ACTOR_API_KEY}`);
  });

  it("GET /game/stats/:charId with JWT injects actor apiKey", async () => {
    lastAuthHeader = undefined;
    const res = await bff.app.inject({
      method: "GET",
      url: "/game/stats/hero_1",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(lastAuthHeader).toBe(`Bearer ${ACTOR_API_KEY}`);
  });

  it("POST /game/tx with JWT injects actor apiKey", async () => {
    lastAuthHeader = undefined;
    const res = await bff.app.inject({
      method: "POST",
      url: "/game/tx",
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        txId: "test_tx",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "hero_1",
        classId: "warrior",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(lastAuthHeader).toBe(`Bearer ${ACTOR_API_KEY}`);
  });

  it("POST /game/tx without JWT returns 401", async () => {
    const res = await bff.app.inject({
      method: "POST",
      url: "/game/tx",
      payload: { txId: "x", type: "CreatePlayer" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /game/config works without auth", async () => {
    const res = await bff.app.inject({ method: "GET", url: "/game/config" });
    expect(res.statusCode).toBe(200);
  });

  it("GET /game/version works without auth", async () => {
    const res = await bff.app.inject({ method: "GET", url: "/game/version" });
    expect(res.statusCode).toBe(200);
  });
});

// ---- Slice 3 tests: typed gameplay routes ----

describe("Game routes — typed routes (Slice 3)", () => {
  let bff: Awaited<ReturnType<typeof buildApp>>;
  let jwt: string;

  beforeAll(async () => {
    const setup = await setupBffWithUser();
    bff = setup.bff;
    jwt = setup.jwt;
  });

  afterAll(async () => {
    await bff.app.close();
  });

  it("GET /game/player (no playerId param) returns own player", async () => {
    lastAuthHeader = undefined;
    const res = await bff.app.inject({
      method: "GET",
      url: "/game/player",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(lastAuthHeader).toBe("Bearer secret-actor-key");
  });

  it("GET /game/player without JWT returns 401", async () => {
    const res = await bff.app.inject({
      method: "GET",
      url: "/game/player",
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /game/character creates character with auto-filled fields", async () => {
    lastTxBody = undefined;
    const res = await bff.app.inject({
      method: "POST",
      url: "/game/character",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { characterId: "hero_1", classId: "warrior" },
    });
    expect(res.statusCode).toBe(200);
    expect(lastTxBody).toBeDefined();
    expect(lastTxBody!.type).toBe("CreateCharacter");
    expect(lastTxBody!.characterId).toBe("hero_1");
    expect(lastTxBody!.classId).toBe("warrior");
    expect(lastTxBody!.playerId).toBe("player_1");
    expect(lastTxBody!.gameInstanceId).toBe("instance_001");
    expect(lastTxBody!.txId).toMatch(/^bff_/);
  });

  it("POST /game/gear creates gear with auto-filled fields", async () => {
    lastTxBody = undefined;
    const res = await bff.app.inject({
      method: "POST",
      url: "/game/gear",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { gearId: "sword_1", gearDefId: "sword_basic" },
    });
    expect(res.statusCode).toBe(200);
    expect(lastTxBody!.type).toBe("CreateGear");
    expect(lastTxBody!.gearId).toBe("sword_1");
    expect(lastTxBody!.gearDefId).toBe("sword_basic");
    expect(lastTxBody!.playerId).toBe("player_1");
    expect(lastTxBody!.txId).toMatch(/^bff_/);
  });

  it("POST /game/equip sends EquipGear with auto-filled fields", async () => {
    lastTxBody = undefined;
    const res = await bff.app.inject({
      method: "POST",
      url: "/game/equip",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { characterId: "hero_1", gearId: "sword_1" },
    });
    expect(res.statusCode).toBe(200);
    expect(lastTxBody!.type).toBe("EquipGear");
    expect(lastTxBody!.characterId).toBe("hero_1");
    expect(lastTxBody!.gearId).toBe("sword_1");
    expect(lastTxBody!.playerId).toBe("player_1");
  });

  it("POST /game/equip with swap=true", async () => {
    lastTxBody = undefined;
    await bff.app.inject({
      method: "POST",
      url: "/game/equip",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { characterId: "hero_1", gearId: "sword_1", swap: true },
    });
    expect(lastTxBody!.swap).toBe(true);
  });

  it("POST /game/unequip sends UnequipGear", async () => {
    lastTxBody = undefined;
    const res = await bff.app.inject({
      method: "POST",
      url: "/game/unequip",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { gearId: "sword_1" },
    });
    expect(res.statusCode).toBe(200);
    expect(lastTxBody!.type).toBe("UnequipGear");
    expect(lastTxBody!.gearId).toBe("sword_1");
  });

  it("POST /game/levelup/character sends LevelUpCharacter", async () => {
    lastTxBody = undefined;
    const res = await bff.app.inject({
      method: "POST",
      url: "/game/levelup/character",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { characterId: "hero_1" },
    });
    expect(res.statusCode).toBe(200);
    expect(lastTxBody!.type).toBe("LevelUpCharacter");
    expect(lastTxBody!.characterId).toBe("hero_1");
    expect(lastTxBody!.playerId).toBe("player_1");
  });

  it("POST /game/levelup/character with levels param", async () => {
    lastTxBody = undefined;
    await bff.app.inject({
      method: "POST",
      url: "/game/levelup/character",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { characterId: "hero_1", levels: 3 },
    });
    expect(lastTxBody!.levels).toBe(3);
  });

  it("POST /game/levelup/gear sends LevelUpGear", async () => {
    lastTxBody = undefined;
    const res = await bff.app.inject({
      method: "POST",
      url: "/game/levelup/gear",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { gearId: "sword_1" },
    });
    expect(res.statusCode).toBe(200);
    expect(lastTxBody!.type).toBe("LevelUpGear");
    expect(lastTxBody!.gearId).toBe("sword_1");
  });

  it("POST /game/levelup/gear with characterId", async () => {
    lastTxBody = undefined;
    await bff.app.inject({
      method: "POST",
      url: "/game/levelup/gear",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { gearId: "sword_1", characterId: "hero_1" },
    });
    expect(lastTxBody!.characterId).toBe("hero_1");
  });

  it("typed routes without JWT return 401", async () => {
    const routes = [
      { method: "POST" as const, url: "/game/character", payload: { characterId: "x", classId: "y" } },
      { method: "POST" as const, url: "/game/gear", payload: { gearId: "x", gearDefId: "y" } },
      { method: "POST" as const, url: "/game/equip", payload: { characterId: "x", gearId: "y" } },
      { method: "POST" as const, url: "/game/unequip", payload: { gearId: "x" } },
      { method: "POST" as const, url: "/game/levelup/character", payload: { characterId: "x" } },
      { method: "POST" as const, url: "/game/levelup/gear", payload: { gearId: "x" } },
    ];
    for (const r of routes) {
      const res = await bff.app.inject(r);
      expect(res.statusCode, `${r.url} should return 401`).toBe(401);
    }
  });

  it("each request generates a unique txId", async () => {
    const txIds = new Set<string>();
    for (let i = 0; i < 3; i++) {
      lastTxBody = undefined;
      await bff.app.inject({
        method: "POST",
        url: "/game/character",
        headers: { authorization: `Bearer ${jwt}` },
        payload: { characterId: `h${String(i)}`, classId: "warrior" },
      });
      txIds.add(lastTxBody!.txId as string);
    }
    expect(txIds.size).toBe(3);
  });
});
