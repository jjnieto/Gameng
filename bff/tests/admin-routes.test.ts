import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { buildApp, TEST_INTERNAL_ADMIN_SECRET } from "./helpers.js";

// ---- Fake engine ----

let fakeEngine: FastifyInstance;
let fakeEngineUrl: string;
let lastTxBody: Record<string, unknown> | undefined;

beforeAll(async () => {
  fakeEngine = Fastify({ logger: false });

  fakeEngine.post<{ Body: Record<string, unknown> }>(
    "/instance_001/tx",
    async (request) => {
      lastTxBody = request.body;
      return {
        txId: request.body.txId,
        accepted: true,
        stateVersion: 1,
      };
    },
  );

  const addr = await fakeEngine.listen({ port: 0, host: "127.0.0.1" });
  fakeEngineUrl = addr;
});

afterAll(async () => {
  await fakeEngine.close();
});

// ---- Tests ----

describe("Admin routes (Slice 4)", () => {
  let bff: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    bff = await buildApp({ engineUrl: fakeEngineUrl, withAuth: true });

    // Seed a user for admin list tests
    const { hashPassword } = await import("../src/auth/passwords.js");
    const hash = await hashPassword("testpass123", 4);
    bff.userStore!.createUser({
      email: "admin-test@example.com",
      passwordHash: hash,
      actorId: "actor_admin",
      apiKey: "admin-api-key",
      playerId: "player_admin",
    });
  });

  afterAll(async () => {
    await bff.app.close();
  });

  // -- Auth: X-Admin-Secret --

  it("POST /admin/grant-resources without secret → 401", async () => {
    const res = await bff.app.inject({
      method: "POST",
      url: "/admin/grant-resources",
      payload: { playerId: "p1", resources: { gold: 100 } },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /admin/grant-resources with wrong secret → 401", async () => {
    const res = await bff.app.inject({
      method: "POST",
      url: "/admin/grant-resources",
      headers: { "x-admin-secret": "wrong-secret" },
      payload: { playerId: "p1", resources: { gold: 100 } },
    });
    expect(res.statusCode).toBe(401);
  });

  // -- Grant resources --

  it("POST /admin/grant-resources proxies GrantResources", async () => {
    lastTxBody = undefined;
    const res = await bff.app.inject({
      method: "POST",
      url: "/admin/grant-resources",
      headers: { "x-admin-secret": TEST_INTERNAL_ADMIN_SECRET },
      payload: { playerId: "player_1", resources: { gold: 500 } },
    });
    expect(res.statusCode).toBe(200);
    expect(lastTxBody!.type).toBe("GrantResources");
    expect(lastTxBody!.playerId).toBe("player_1");
    expect(lastTxBody!.resources).toEqual({ gold: 500 });
  });

  it("POST /admin/grant-resources validates body", async () => {
    const res = await bff.app.inject({
      method: "POST",
      url: "/admin/grant-resources",
      headers: { "x-admin-secret": TEST_INTERNAL_ADMIN_SECRET },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  // -- Grant character resources --

  it("POST /admin/grant-character-resources proxies GrantCharacterResources", async () => {
    lastTxBody = undefined;
    const res = await bff.app.inject({
      method: "POST",
      url: "/admin/grant-character-resources",
      headers: { "x-admin-secret": TEST_INTERNAL_ADMIN_SECRET },
      payload: {
        playerId: "player_1",
        characterId: "char_1",
        resources: { xp: 1000 },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(lastTxBody!.type).toBe("GrantCharacterResources");
    expect(lastTxBody!.characterId).toBe("char_1");
  });

  // -- Create actor --

  it("POST /admin/create-actor proxies CreateActor", async () => {
    lastTxBody = undefined;
    const res = await bff.app.inject({
      method: "POST",
      url: "/admin/create-actor",
      headers: { "x-admin-secret": TEST_INTERNAL_ADMIN_SECRET },
      payload: { actorId: "manual_actor", apiKey: "manual-key" },
    });
    expect(res.statusCode).toBe(200);
    expect(lastTxBody!.type).toBe("CreateActor");
    expect(lastTxBody!.actorId).toBe("manual_actor");
  });

  // -- List users --

  it("GET /admin/users returns user list", async () => {
    const res = await bff.app.inject({
      method: "GET",
      url: "/admin/users",
      headers: { "x-admin-secret": TEST_INTERNAL_ADMIN_SECRET },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      users: { id: number; email: string }[];
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.users).toHaveLength(1);
    expect(body.users[0].email).toBe("admin-test@example.com");
    // Should NOT expose password_hash or api_key
    expect((body.users[0] as Record<string, unknown>).password_hash).toBeUndefined();
    expect((body.users[0] as Record<string, unknown>).api_key).toBeUndefined();
  });

  it("GET /admin/users without secret → 401", async () => {
    const res = await bff.app.inject({
      method: "GET",
      url: "/admin/users",
    });
    expect(res.statusCode).toBe(401);
  });

  // -- Get user by ID --

  it("GET /admin/users/:id returns user detail", async () => {
    const res = await bff.app.inject({
      method: "GET",
      url: "/admin/users/1",
      headers: { "x-admin-secret": TEST_INTERNAL_ADMIN_SECRET },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.email).toBe("admin-test@example.com");
    expect(body.player_id).toBe("player_admin");
    // Should NOT expose sensitive fields
    expect(body.password_hash).toBeUndefined();
    expect(body.api_key).toBeUndefined();
  });

  it("GET /admin/users/999 → 404", async () => {
    const res = await bff.app.inject({
      method: "GET",
      url: "/admin/users/999",
      headers: { "x-admin-secret": TEST_INTERNAL_ADMIN_SECRET },
    });
    expect(res.statusCode).toBe(404);
  });
});
