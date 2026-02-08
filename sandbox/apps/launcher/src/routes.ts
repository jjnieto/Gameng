import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LauncherConfig } from "./config.js";
import type { EngineProcessManager } from "./engine.js";

/**
 * Forward a request to the engine process.
 * Returns false if the engine is not running (caller sends 503).
 */
async function proxyToEngine(
  engine: EngineProcessManager,
  engineBaseUrl: string,
  targetPath: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!engine.running) {
    void reply.code(503).send({
      ok: false,
      error: "ENGINE_NOT_RUNNING",
    });
    return;
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  const ct = request.headers["content-type"];
  if (ct) headers["Content-Type"] = ct;
  const auth = request.headers["authorization"];
  if (auth) headers["Authorization"] = auth;

  let upstream: Response;
  try {
    upstream = await fetch(`${engineBaseUrl}${targetPath}`, {
      method: request.method,
      headers,
      body: request.method === "POST" ? JSON.stringify(request.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    void reply.code(502).send({
      ok: false,
      error: "ENGINE_UNREACHABLE",
    });
    return;
  }

  const body = await upstream.text();
  void reply
    .code(upstream.status)
    .header("Content-Type", upstream.headers.get("Content-Type") ?? "application/json")
    .send(body);
}

/**
 * Register all launcher routes.
 */
export function registerRoutes(
  app: FastifyInstance,
  config: LauncherConfig,
  engine: EngineProcessManager,
): void {
  const engineBaseUrl = `http://localhost:${String(config.enginePort)}`;

  // ---- Proxy routes: /engine/* -> engine ----

  app.get("/engine/health", async (request, reply) => {
    await proxyToEngine(engine, engineBaseUrl, "/health", request, reply);
  });

  app.get<{ Params: { gameInstanceId: string } }>(
    "/engine/:gameInstanceId/config",
    async (request, reply) => {
      await proxyToEngine(
        engine,
        engineBaseUrl,
        `/${request.params.gameInstanceId}/config`,
        request,
        reply,
      );
    },
  );

  app.get<{ Params: { gameInstanceId: string } }>(
    "/engine/:gameInstanceId/stateVersion",
    async (request, reply) => {
      await proxyToEngine(
        engine,
        engineBaseUrl,
        `/${request.params.gameInstanceId}/stateVersion`,
        request,
        reply,
      );
    },
  );

  app.post<{ Params: { gameInstanceId: string } }>(
    "/engine/:gameInstanceId/tx",
    async (request, reply) => {
      await proxyToEngine(
        engine,
        engineBaseUrl,
        `/${request.params.gameInstanceId}/tx`,
        request,
        reply,
      );
    },
  );

  app.get<{ Params: { gameInstanceId: string; playerId: string } }>(
    "/engine/:gameInstanceId/state/player/:playerId",
    async (request, reply) => {
      await proxyToEngine(
        engine,
        engineBaseUrl,
        `/${request.params.gameInstanceId}/state/player/${request.params.playerId}`,
        request,
        reply,
      );
    },
  );

  app.get<{ Params: { gameInstanceId: string; characterId: string } }>(
    "/engine/:gameInstanceId/character/:characterId/stats",
    async (request, reply) => {
      await proxyToEngine(
        engine,
        engineBaseUrl,
        `/${request.params.gameInstanceId}/character/${request.params.characterId}/stats`,
        request,
        reply,
      );
    },
  );

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
