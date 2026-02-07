import type { FastifyInstance } from "fastify";
import { writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LauncherConfig } from "./config.js";
import type { EngineProcessManager } from "./engine.js";

/**
 * Register all launcher routes.
 */
export function registerRoutes(
  app: FastifyInstance,
  config: LauncherConfig,
  engine: EngineProcessManager,
): void {
  // ---- GET /status ----
  app.get("/status", async () => {
    return {
      ok: true,
      launcher: {
        port: config.launcherPort,
      },
      engine: engine.status(),
      config: {
        path: config.configPath,
      },
      snapshotDir: config.snapshotDir,
    };
  });

  // ---- GET /logs ----
  app.get<{ Querystring: { limit?: string } }>("/logs", async (request) => {
    const limit = request.query.limit ? Number(request.query.limit) : 200;
    return engine.logs.tail(limit);
  });

  // ---- POST /engine/start ----
  app.post("/engine/start", async (_request, reply) => {
    try {
      const started = engine.start();
      if (!started) {
        return reply.code(409).send({
          ok: false,
          error: "Engine is already running.",
          engine: engine.status(),
        });
      }
      return { ok: true, engine: engine.status() };
    } catch (err) {
      return reply.code(500).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ---- POST /engine/stop ----
  app.post("/engine/stop", async () => {
    const stopped = await engine.stop();
    return {
      ok: true,
      stopped,
      engine: engine.status(),
    };
  });

  // ---- POST /engine/restart ----
  app.post("/engine/restart", async (_request, reply) => {
    try {
      const restarted = await engine.restart();
      return { ok: true, restarted, engine: engine.status() };
    } catch (err) {
      return reply.code(500).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ---- POST /config ----
  app.post<{
    Body: unknown;
    Querystring: { restart?: string };
  }>("/config", async (request, reply) => {
    const body = request.body;

    // Basic validation: must be a non-null object
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({
        ok: false,
        error: "Body must be a JSON object (GameConfig).",
      });
    }

    // Atomic write: write to .tmp, then rename
    const dir = dirname(config.configPath);
    mkdirSync(dir, { recursive: true });

    const tmpPath = join(dir, `.active.json.tmp`);
    writeFileSync(tmpPath, JSON.stringify(body, null, 2), "utf-8");
    renameSync(tmpPath, config.configPath);

    const shouldRestart = request.query.restart === "true";
    let restarted = false;

    if (shouldRestart) {
      try {
        await engine.restart();
        restarted = true;
      } catch (err) {
        return reply.code(500).send({
          ok: false,
          saved: true,
          path: config.configPath,
          error: `Config saved but restart failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    return {
      ok: true,
      saved: true,
      path: config.configPath,
      ...(shouldRestart ? { restarted } : {}),
    };
  });
}
