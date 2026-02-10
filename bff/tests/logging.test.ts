import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { Writable } from "node:stream";
import { gameRoutes } from "../src/routes/game-routes.js";
import { registerJwt } from "../src/auth/jwt.js";
import { initDb } from "../src/db.js";
import { UserStore } from "../src/user-store.js";
import type { BffConfig } from "../src/config.js";

// ---- Fake engine ----

let fakeEngine: FastifyInstance;
let fakeEngineUrl: string;

beforeAll(async () => {
  fakeEngine = Fastify({ logger: false });

  fakeEngine.get("/health", async () => ({ status: "ok" }));
  fakeEngine.get("/instance_001/config", async () => ({ gameConfigId: "t" }));
  fakeEngine.get("/instance_001/stateVersion", async () => ({
    gameInstanceId: "instance_001",
    stateVersion: 5,
  }));
  fakeEngine.get("/instance_001/state/player/:playerId", async () => ({
    characters: {},
    gear: {},
  }));
  fakeEngine.get("/instance_001/character/:characterId/stats", async () => ({
    characterId: "hero_1",
    classId: "warrior",
    level: 1,
    finalStats: { str: 10 },
  }));
  fakeEngine.post("/instance_001/tx", async (request) => {
    const body = request.body as Record<string, unknown>;
    return { txId: body.txId ?? "tx", accepted: true, stateVersion: 1 };
  });

  const addr = await fakeEngine.listen({ port: 0, host: "127.0.0.1" });
  fakeEngineUrl = addr;
});

afterAll(async () => {
  await fakeEngine.close();
});

// ---- Log capture helper ----

interface LogEntry {
  [key: string]: unknown;
  msg?: string;
  action?: string;
  userId?: number;
  playerId?: string;
  characterId?: string;
  gearId?: string;
  statusCode?: number;
  durationMs?: number;
}

function createLogCapture(): { logs: LogEntry[]; stream: Writable } {
  const logs: LogEntry[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        const entry = JSON.parse(chunk.toString()) as LogEntry;
        logs.push(entry);
      } catch {
        // ignore non-JSON lines
      }
      callback();
    },
  });
  return { logs, stream };
}

// ---- Build app with log capture ----

async function buildLoggedApp() {
  const { logs, stream } = createLogCapture();

  const config: BffConfig = {
    port: 0,
    host: "127.0.0.1",
    logLevel: "info",
    engineUrl: fakeEngineUrl,
    gameInstanceId: "instance_001",
    jwtSecret: "log-test-secret",
    jwtExpiry: "1h",
    jwtExpiresInSeconds: 3600,
    dbPath: ":memory:",
    adminApiKey: "log-test-admin",
    internalAdminSecret: "log-test-internal",
    bcryptRounds: 4,
  };

  const app = Fastify({
    logger: { level: "info", stream },
  });
  await app.register(cors, { origin: true });
  await registerJwt(app, config.jwtSecret, config.jwtExpiry);

  const db = initDb(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      actor_id      TEXT    NOT NULL UNIQUE,
      api_key       TEXT    NOT NULL UNIQUE,
      player_id     TEXT    NOT NULL UNIQUE,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const userStore = new UserStore(db);

  await app.register(gameRoutes, { config, userStore });
  await app.ready();

  // Create user
  const { hashPassword } = await import("../src/auth/passwords.js");
  const hash = await hashPassword("testpass", 4);
  userStore.createUser({
    email: "logger@test.com",
    passwordHash: hash,
    actorId: "log_actor",
    apiKey: "log-actor-key",
    playerId: "log_player",
  });

  // Login to get JWT
  const loginRes = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: "logger@test.com", password: "testpass" },
  });

  // We don't have auth routes registered, so login via direct JWT sign
  const jwt = app.jwt.sign({
    sub: 1,
    email: "logger@test.com",
    actorId: "log_actor",
    playerId: "log_player",
  });

  return { app, logs, jwt, config };
}

function findLog(
  logs: LogEntry[],
  msg: string,
  action?: string,
): LogEntry | undefined {
  return logs.find(
    (l) => l.msg === msg && (action === undefined || l.action === action),
  );
}

// ---- Tests ----

describe("Structured logging — game actions", () => {
  let app: FastifyInstance;
  let logs: LogEntry[];
  let jwt: string;

  beforeAll(async () => {
    const setup = await buildLoggedApp();
    app = setup.app;
    logs = setup.logs;
    jwt = setup.jwt;
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /game/character logs action with characterId, classId", async () => {
    logs.length = 0;
    await app.inject({
      method: "POST",
      url: "/game/character",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { characterId: "hero_1", classId: "warrior" },
    });

    const entry = findLog(logs, "game action", "CreateCharacter");
    expect(entry).toBeDefined();
    expect(entry!.userId).toBe(1);
    expect(entry!.playerId).toBe("log_player");
    expect(entry!.characterId).toBe("hero_1");
    expect(entry!.classId).toBe("warrior");
    expect(entry!.statusCode).toBe(200);
    expect(typeof entry!.durationMs).toBe("number");
  });

  it("POST /game/equip logs action with characterId, gearId, swap", async () => {
    logs.length = 0;
    await app.inject({
      method: "POST",
      url: "/game/equip",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { characterId: "hero_1", gearId: "sword_1", swap: true },
    });

    const entry = findLog(logs, "game action", "EquipGear");
    expect(entry).toBeDefined();
    expect(entry!.characterId).toBe("hero_1");
    expect(entry!.gearId).toBe("sword_1");
    expect(entry!.swap).toBe(true);
  });

  it("POST /game/levelup/character logs levels param", async () => {
    logs.length = 0;
    await app.inject({
      method: "POST",
      url: "/game/levelup/character",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { characterId: "hero_1", levels: 3 },
    });

    const entry = findLog(logs, "game action", "LevelUpCharacter");
    expect(entry).toBeDefined();
    expect(entry!.levels).toBe(3);
  });

  it("POST /game/tx (passthrough) logs action type and route", async () => {
    logs.length = 0;
    await app.inject({
      method: "POST",
      url: "/game/tx",
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        txId: "raw_1",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "log_player",
        gearId: "g1",
        gearDefId: "sword_basic",
      },
    });

    const entry = findLog(logs, "game action", "CreateGear");
    expect(entry).toBeDefined();
    expect(entry!.route).toBe("passthrough");
    expect(entry!.statusCode).toBe(200);
  });
});

describe("Structured logging — game reads", () => {
  let app: FastifyInstance;
  let logs: LogEntry[];
  let jwt: string;

  beforeAll(async () => {
    const setup = await buildLoggedApp();
    app = setup.app;
    logs = setup.logs;
    jwt = setup.jwt;
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /game/player logs read with playerId", async () => {
    logs.length = 0;
    await app.inject({
      method: "GET",
      url: "/game/player",
      headers: { authorization: `Bearer ${jwt}` },
    });

    const entry = findLog(logs, "game read", "getPlayer");
    expect(entry).toBeDefined();
    expect(entry!.userId).toBe(1);
    expect(entry!.playerId).toBe("log_player");
    expect(entry!.statusCode).toBe(200);
    expect(typeof entry!.durationMs).toBe("number");
  });

  it("GET /game/player/:id logs read with playerId param", async () => {
    logs.length = 0;
    await app.inject({
      method: "GET",
      url: "/game/player/player_1",
      headers: { authorization: `Bearer ${jwt}` },
    });

    const entry = findLog(logs, "game read", "getPlayer");
    expect(entry).toBeDefined();
    expect(entry!.playerId).toBe("player_1");
  });

  it("GET /game/stats/:charId logs read with characterId", async () => {
    logs.length = 0;
    await app.inject({
      method: "GET",
      url: "/game/stats/hero_1",
      headers: { authorization: `Bearer ${jwt}` },
    });

    const entry = findLog(logs, "game read", "getStats");
    expect(entry).toBeDefined();
    expect(entry!.characterId).toBe("hero_1");
    expect(entry!.statusCode).toBe(200);
  });
});

describe("Structured logging — security", () => {
  let app: FastifyInstance;
  let logs: LogEntry[];
  let jwt: string;

  beforeAll(async () => {
    const setup = await buildLoggedApp();
    app = setup.app;
    logs = setup.logs;
    jwt = setup.jwt;
  });

  afterAll(async () => {
    await app.close();
  });

  it("logs never contain apiKey values", async () => {
    logs.length = 0;
    await app.inject({
      method: "POST",
      url: "/game/character",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { characterId: "h1", classId: "mage" },
    });
    await app.inject({
      method: "GET",
      url: "/game/player",
      headers: { authorization: `Bearer ${jwt}` },
    });

    const allLogText = JSON.stringify(logs);
    expect(allLogText).not.toContain("log-actor-key");
  });

  it("logs never contain JWT tokens", async () => {
    logs.length = 0;
    await app.inject({
      method: "POST",
      url: "/game/gear",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { gearId: "g1", gearDefId: "sword_basic" },
    });

    const allLogText = JSON.stringify(logs);
    expect(allLogText).not.toContain(jwt);
  });
});
