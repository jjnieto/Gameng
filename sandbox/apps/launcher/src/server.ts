import Fastify from "fastify";
import cors from "@fastify/cors";
import { resolveConfig } from "./config.js";
import { EngineProcessManager } from "./engine.js";
import { registerRoutes } from "./routes.js";

const config = resolveConfig();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
});

// CORS: allow the SPA (any localhost origin) to call the launcher
await app.register(cors, { origin: true });

const engine = new EngineProcessManager(config);

registerRoutes(app, config, engine);

// Graceful shutdown: stop engine when launcher exits
const shutdown = async () => {
  if (engine.running) {
    app.log.info("Stopping engine before launcher exit...");
    await engine.stop();
  }
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

// Last-resort: synchronously kill the engine when this process exits.
// On Windows, SIGINT/SIGTERM may not fire (concurrently kills with taskkill),
// but the "exit" event always fires. This prevents orphaned engine processes.
process.on("exit", () => {
  engine.killSync();
});

app.listen(
  { port: config.launcherPort, host: "127.0.0.1" },
  (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
  },
);
