/**
 * E2E test — Full BFF lifecycle against a real engine.
 *
 * Flow:
 *   1. Spawn engine (config_minimal)
 *   2. Spawn BFF pointing at engine
 *   3. BFF /health reports engine reachable
 *   4. Register a user (BFF creates actor + player in engine)
 *   5. Login
 *   6. Refresh token
 *   7. GET /game/config (public)
 *   8. GET /game/version (public)
 *   9. GET /game/player (own player via JWT)
 *  10. POST /game/character (CreateCharacter)
 *  11. POST /game/gear (CreateGear)
 *  12. POST /game/equip (EquipGear)
 *  13. GET /game/stats/:charId (verify stats)
 *  14. POST /game/levelup/character (LevelUpCharacter)
 *  15. GET /game/stats/:charId (verify level 2 stats)
 *  16. POST /game/unequip (UnequipGear)
 *  17. POST /game/equip with swap (re-equip)
 *  18. Admin: POST /admin/grant-resources
 *  19. Admin: GET /admin/users
 *  20. Error: register duplicate email → 409
 *  21. Error: request without JWT → 401
 *  22. Error: equip non-existent gear → engine error
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startEngine,
  startBff,
  type ProcessHandle,
} from "./bff-process.js";

const ADMIN_KEY = "bff-e2e-admin-key";
const ADMIN_SECRET = "bff-e2e-internal-secret";

let engine: ProcessHandle;
let bff: ProcessHandle;

// ---- Helpers ----

interface JsonBody {
  [key: string]: unknown;
}

async function bffFetch(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: JsonBody }> {
  const headers: Record<string, string> = {
    ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(opts.headers ?? {}),
  };
  const res = await fetch(`${bff.baseUrl}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: JsonBody;
  try {
    body = JSON.parse(text) as JsonBody;
  } catch {
    body = { _raw: text } as JsonBody;
  }
  return { status: res.status, body };
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function adminSecret(): Record<string, string> {
  return { "X-Admin-Secret": ADMIN_SECRET };
}

// ---- Setup / Teardown ----

beforeAll(async () => {
  engine = await startEngine({
    configPath: "examples/config_minimal.json",
    adminApiKey: ADMIN_KEY,
  });

  bff = await startBff({
    engineUrl: engine.baseUrl,
    adminApiKey: ADMIN_KEY,
    internalAdminSecret: ADMIN_SECRET,
  });
}, 30_000);

afterAll(async () => {
  await bff.stop();
  await engine.stop();
});

// ---- Tests ----

describe("E2E — BFF full lifecycle", () => {
  let token: string;
  let playerId: string;

  // 1. Health check

  it("GET /health reports engine reachable + DB connected", async () => {
    const { status, body } = await bffFetch("GET", "/health");
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
    expect((body.engine as JsonBody).reachable).toBe(true);
    expect((body.db as JsonBody).connected).toBe(true);
  });

  // 2. Public routes (no auth)

  it("GET /game/health returns engine health", async () => {
    const { status, body } = await bffFetch("GET", "/game/health");
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("GET /game/config returns game config", async () => {
    const { status, body } = await bffFetch("GET", "/game/config");
    expect(status).toBe(200);
    expect(body.gameConfigId).toBe("minimal_v1");
    expect(body.maxLevel).toBe(10);
  });

  it("GET /game/version returns stateVersion", async () => {
    const { status, body } = await bffFetch("GET", "/game/version");
    expect(status).toBe(200);
    expect(body.gameInstanceId).toBe("instance_001");
    expect(typeof body.stateVersion).toBe("number");
  });

  // 3. Register

  it("POST /auth/register creates user + actor + player", async () => {
    const { status, body } = await bffFetch("POST", "/auth/register", {
      body: { email: "hero@example.com", password: "password123" },
    });
    expect(status).toBe(201);
    expect(body.token).toBeTruthy();
    expect(body.expiresIn).toBe(3600);
    expect(body.playerId).toMatch(/^player_/);

    token = body.token as string;
    playerId = body.playerId as string;
  });

  // 4. Login

  it("POST /auth/login returns valid JWT", async () => {
    const { status, body } = await bffFetch("POST", "/auth/login", {
      body: { email: "hero@example.com", password: "password123" },
    });
    expect(status).toBe(200);
    expect(body.token).toBeTruthy();
    expect(body.playerId).toBe(playerId);

    // Use this fresh token
    token = body.token as string;
  });

  // 5. Refresh

  it("POST /auth/refresh renews the JWT", async () => {
    const { status, body } = await bffFetch("POST", "/auth/refresh", {
      headers: auth(token),
    });
    expect(status).toBe(200);
    expect(body.token).toBeTruthy();
    expect(body.playerId).toBe(playerId);
  });

  // 6. GET own player state

  it("GET /game/player returns own player state", async () => {
    const { status, body } = await bffFetch("GET", "/game/player", {
      headers: auth(token),
    });
    expect(status).toBe(200);
    expect(body.characters).toEqual({});
    expect(body.gear).toEqual({});
    expect(body.resources).toEqual({});
  });

  // 7. Create character

  it("POST /game/character creates a character", async () => {
    const { status, body } = await bffFetch("POST", "/game/character", {
      headers: auth(token),
      body: { characterId: "hero_1", classId: "warrior" },
    });
    expect(status).toBe(200);
    expect(body.accepted).toBe(true);
  });

  // 8. Create gear

  it("POST /game/gear creates gear", async () => {
    const { status, body } = await bffFetch("POST", "/game/gear", {
      headers: auth(token),
      body: { gearId: "sword_1", gearDefId: "sword_basic" },
    });
    expect(status).toBe(200);
    expect(body.accepted).toBe(true);
  });

  // 9. Equip gear

  it("POST /game/equip equips gear to character", async () => {
    const { status, body } = await bffFetch("POST", "/game/equip", {
      headers: auth(token),
      body: { characterId: "hero_1", gearId: "sword_1" },
    });
    expect(status).toBe(200);
    expect(body.accepted).toBe(true);
  });

  // 10. Verify stats after equip

  it("GET /game/stats/:charId shows equipped gear stats", async () => {
    const { status, body } = await bffFetch("GET", "/game/stats/hero_1", {
      headers: auth(token),
    });
    expect(status).toBe(200);
    expect(body.characterId).toBe("hero_1");
    expect(body.classId).toBe("warrior");
    expect(body.level).toBe(1);
    const stats = body.finalStats as Record<string, number>;
    // warrior base: str=5, hp=20 + sword_basic: str=3
    // At level 1 with linear growth (perLevelMultiplier=0.1), factor = 1 + (1-1)*0.1 = 1.0
    expect(stats.strength).toBe(8); // 5*1 + 3*1
    expect(stats.hp).toBe(20); // 20*1 + 0 (sword has no hp)
  });

  // 11. Level up character (flat cost = free)

  it("POST /game/levelup/character levels up", async () => {
    const { status, body } = await bffFetch(
      "POST",
      "/game/levelup/character",
      {
        headers: auth(token),
        body: { characterId: "hero_1" },
      },
    );
    expect(status).toBe(200);
    expect(body.accepted).toBe(true);
  });

  // 12. Verify level 2 stats

  it("GET /game/stats/:charId shows level 2 stats with growth", async () => {
    const { status, body } = await bffFetch("GET", "/game/stats/hero_1", {
      headers: auth(token),
    });
    expect(status).toBe(200);
    expect(body.level).toBe(2);
    const stats = body.finalStats as Record<string, number>;
    // Level 2, growth factor = 1 + (2-1)*0.1 = 1.1
    // class: floor(5*1.1)=5, gear: floor(3*1.1)=3 → str = 8
    // class hp: floor(20*1.1)=22 + additivePerLevel hp=1*(2-1)=1 → 23
    expect(stats.strength).toBeGreaterThanOrEqual(8);
    expect(stats.hp).toBeGreaterThan(20);
  });

  // 13. Unequip

  it("POST /game/unequip unequips gear", async () => {
    const { status, body } = await bffFetch("POST", "/game/unequip", {
      headers: auth(token),
      body: { gearId: "sword_1" },
    });
    expect(status).toBe(200);
    expect(body.accepted).toBe(true);
  });

  // 14. Create second gear + equip with swap

  it("POST /game/gear + equip with swap", async () => {
    // Create a second sword
    let res = await bffFetch("POST", "/game/gear", {
      headers: auth(token),
      body: { gearId: "sword_2", gearDefId: "sword_basic" },
    });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);

    // Equip sword_1 first
    res = await bffFetch("POST", "/game/equip", {
      headers: auth(token),
      body: { characterId: "hero_1", gearId: "sword_1" },
    });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);

    // Equip sword_2 with swap=true (should auto-unequip sword_1)
    res = await bffFetch("POST", "/game/equip", {
      headers: auth(token),
      body: { characterId: "hero_1", gearId: "sword_2", swap: true },
    });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(true);
  });

  // 15. Verify player state shows correct equipment

  it("GET /game/player shows final state", async () => {
    const { status, body } = await bffFetch("GET", "/game/player", {
      headers: auth(token),
    });
    expect(status).toBe(200);

    const chars = body.characters as Record<string, JsonBody>;
    expect(chars.hero_1).toBeDefined();
    expect(chars.hero_1.classId).toBe("warrior");
    expect(chars.hero_1.level).toBe(2);

    const gear = body.gear as Record<string, JsonBody>;
    expect(gear.sword_1.equippedBy).toBeNull(); // was swapped out
    expect(gear.sword_2.equippedBy).toBe("hero_1");
  });

  // 16. Level up gear

  it("POST /game/levelup/gear levels up gear", async () => {
    const { status, body } = await bffFetch("POST", "/game/levelup/gear", {
      headers: auth(token),
      body: { gearId: "sword_2" },
    });
    expect(status).toBe(200);
    expect(body.accepted).toBe(true);
  });

  // 17. Admin: grant resources

  it("POST /admin/grant-resources grants gold to player", async () => {
    const { status, body } = await bffFetch(
      "POST",
      "/admin/grant-resources",
      {
        headers: adminSecret(),
        body: { playerId, resources: { gold: 1000 } },
      },
    );
    expect(status).toBe(200);
    expect(body.accepted).toBe(true);
  });

  // 18. Admin: grant character resources

  it("POST /admin/grant-character-resources grants xp to character", async () => {
    const { status, body } = await bffFetch(
      "POST",
      "/admin/grant-character-resources",
      {
        headers: adminSecret(),
        body: { playerId, characterId: "hero_1", resources: { xp: 500 } },
      },
    );
    expect(status).toBe(200);
    expect(body.accepted).toBe(true);
  });

  // 19. Verify resources

  it("GET /game/player shows resources after grants", async () => {
    const { status, body } = await bffFetch("GET", "/game/player", {
      headers: auth(token),
    });
    expect(status).toBe(200);
    expect((body.resources as Record<string, number>).gold).toBe(1000);
    const chars = body.characters as Record<string, JsonBody>;
    expect((chars.hero_1.resources as Record<string, number>).xp).toBe(500);
  });

  // 20. Admin: list users

  it("GET /admin/users returns user list", async () => {
    const { status, body } = await bffFetch("GET", "/admin/users", {
      headers: adminSecret(),
    });
    expect(status).toBe(200);
    expect(body.total).toBe(1);
    const users = body.users as JsonBody[];
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("hero@example.com");
    // Sensitive fields must not be exposed
    expect(users[0].password_hash).toBeUndefined();
    expect(users[0].api_key).toBeUndefined();
  });

  // 21. Raw tx passthrough still works

  it("POST /game/tx passthrough works", async () => {
    const { status, body } = await bffFetch("POST", "/game/tx", {
      headers: auth(token),
      body: {
        txId: "e2e_raw_tx",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId,
        gearId: "sword_raw",
        gearDefId: "sword_basic",
      },
    });
    expect(status).toBe(200);
    expect(body.accepted).toBe(true);
  });

  // ---- Error cases ----

  it("POST /auth/register duplicate email → 409", async () => {
    const { status, body } = await bffFetch("POST", "/auth/register", {
      body: { email: "hero@example.com", password: "password123" },
    });
    expect(status).toBe(409);
    expect(body.errorCode).toBe("CONFLICT");
  });

  it("POST /auth/login wrong password → 401", async () => {
    const { status, body } = await bffFetch("POST", "/auth/login", {
      body: { email: "hero@example.com", password: "wrongpassword" },
    });
    expect(status).toBe(401);
    expect(body.errorCode).toBe("INVALID_CREDENTIALS");
  });

  it("GET /game/player without JWT → 401", async () => {
    const { status } = await bffFetch("GET", "/game/player");
    expect(status).toBe(401);
  });

  it("POST /game/equip without JWT → 401", async () => {
    const { status } = await bffFetch("POST", "/game/equip", {
      body: { characterId: "hero_1", gearId: "sword_1" },
    });
    expect(status).toBe(401);
  });

  it("POST /admin/grant-resources without X-Admin-Secret → 401", async () => {
    const { status } = await bffFetch("POST", "/admin/grant-resources", {
      body: { playerId, resources: { gold: 1 } },
    });
    expect(status).toBe(401);
  });

  it("POST /game/equip non-existent gear → engine rejects", async () => {
    const { status, body } = await bffFetch("POST", "/game/equip", {
      headers: auth(token),
      body: { characterId: "hero_1", gearId: "no_such_gear" },
    });
    expect(status).toBe(200);
    expect(body.accepted).toBe(false);
    expect(body.errorCode).toBe("GEAR_NOT_FOUND");
  });

  it("POST /game/character duplicate → engine rejects", async () => {
    const { status, body } = await bffFetch("POST", "/game/character", {
      headers: auth(token),
      body: { characterId: "hero_1", classId: "warrior" },
    });
    expect(status).toBe(200);
    expect(body.accepted).toBe(false);
    expect(body.errorCode).toBe("ALREADY_EXISTS");
  });
});
