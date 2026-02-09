import { join, resolve } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { resolveConfig } from "./config.js";
import { initDb, closeDb } from "./db.js";
import { UserStore } from "./user-store.js";
import { registerJwt } from "./auth/jwt.js";
import { gameRoutes } from "./routes/game-routes.js";
import { authRoutes } from "./routes/auth-routes.js";
import { adminRoutes } from "./routes/admin-routes.js";
import { healthRoutes } from "./routes/health-routes.js";

const config = resolveConfig();

// Validate required config
if (!config.jwtSecret) {
  throw new Error("BFF_JWT_SECRET is required.");
}
if (!config.adminApiKey) {
  throw new Error("BFF_ADMIN_API_KEY is required.");
}

const app = Fastify({
  logger: {
    level: config.logLevel,
  },
});

await app.register(cors, { origin: true });
await app.register(helmet, { global: true });
await app.register(rateLimit, {
  global: true,
  max: Number(process.env.BFF_RATE_LIMIT_MAX ?? "100"),
  timeWindow: Number(process.env.BFF_RATE_LIMIT_WINDOW_MS ?? "60000"),
});

// JWT plugin
await registerJwt(app, config.jwtSecret, config.jwtExpiry);

// Database
const migrationsDir = resolve(join("bff", "migrations"));
const db = initDb(config.dbPath, migrationsDir);
const userStore = new UserStore(db);

// Routes
await app.register(healthRoutes, { engineUrl: config.engineUrl, db });
await app.register(gameRoutes, { config, userStore });
await app.register(authRoutes, {
  userStore,
  adminApiKey: config.adminApiKey,
  engineUrl: config.engineUrl,
  gameInstanceId: config.gameInstanceId,
  bcryptRounds: config.bcryptRounds,
  jwtExpiresInSeconds: config.jwtExpiresInSeconds,
});

if (config.internalAdminSecret) {
  await app.register(adminRoutes, {
    userStore,
    adminApiKey: config.adminApiKey,
    internalAdminSecret: config.internalAdminSecret,
    engineUrl: config.engineUrl,
    gameInstanceId: config.gameInstanceId,
  });
}

// Graceful shutdown
const shutdown = async () => {
  closeDb();
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

app.listen({ port: config.port, host: config.host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
