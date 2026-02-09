import Fastify from "fastify";
import cors from "@fastify/cors";
import { gameRoutes } from "../src/routes/game-routes.js";
import { authRoutes } from "../src/routes/auth-routes.js";
import { adminRoutes } from "../src/routes/admin-routes.js";
import { healthRoutes } from "../src/routes/health-routes.js";
import { registerJwt } from "../src/auth/jwt.js";
import { initDb } from "../src/db.js";
import { UserStore } from "../src/user-store.js";
import type { BffConfig } from "../src/config.js";

const TEST_JWT_SECRET = "test-secret-for-bff-tests";
const TEST_JWT_EXPIRY = "1h";
const TEST_INTERNAL_ADMIN_SECRET = "test-internal-admin-secret";

/**
 * Build a BFF Fastify instance for testing (no listen).
 * Uses in-memory SQLite when withAuth is true.
 */
export async function buildApp(
  overrides: Partial<BffConfig> & { withAuth?: boolean; withAdmin?: boolean } = {},
) {
  const config: BffConfig = {
    port: 0,
    host: "127.0.0.1",
    logLevel: "silent",
    engineUrl: overrides.engineUrl ?? "http://localhost:39999",
    gameInstanceId: overrides.gameInstanceId ?? "instance_001",
    jwtSecret: TEST_JWT_SECRET,
    jwtExpiry: TEST_JWT_EXPIRY,
    jwtExpiresInSeconds: 3600,
    dbPath: ":memory:",
    adminApiKey: overrides.adminApiKey ?? "test-admin-key",
    internalAdminSecret:
      overrides.internalAdminSecret ?? TEST_INTERNAL_ADMIN_SECRET,
    bcryptRounds: overrides.bcryptRounds ?? 4, // fast for tests
    ...overrides,
  };

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  if (overrides.withAuth !== false) {
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

    await app.register(healthRoutes, { engineUrl: config.engineUrl, db });

    await app.register(authRoutes, {
      userStore,
      adminApiKey: config.adminApiKey,
      engineUrl: config.engineUrl,
      gameInstanceId: config.gameInstanceId,
      bcryptRounds: config.bcryptRounds,
      jwtExpiresInSeconds: config.jwtExpiresInSeconds,
    });

    await app.register(gameRoutes, { config, userStore });

    // Register admin routes if requested (or by default when withAuth)
    if (overrides.withAdmin !== false) {
      await app.register(adminRoutes, {
        userStore,
        adminApiKey: config.adminApiKey,
        internalAdminSecret: config.internalAdminSecret,
        engineUrl: config.engineUrl,
        gameInstanceId: config.gameInstanceId,
      });
    }

    await app.ready();
    return { app, config, db, userStore };
  }

  await app.register(gameRoutes, { config });
  await app.ready();
  return { app, config, db: undefined, userStore: undefined };
}

export { TEST_INTERNAL_ADMIN_SECRET };
