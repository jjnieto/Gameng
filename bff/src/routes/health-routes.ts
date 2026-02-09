import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

interface HealthRoutesOpts {
  engineUrl: string;
  db: Database.Database;
}

/**
 * BFF health check — probes engine and DB.
 */
export async function healthRoutes(
  app: FastifyInstance,
  opts: HealthRoutesOpts,
): Promise<void> {
  const { engineUrl, db } = opts;
  const startTime = Date.now();

  app.get("/health", async () => {
    const uptimeMs = Date.now() - startTime;

    // Probe engine
    let engineReachable = false;
    let engineLatencyMs = -1;
    try {
      const t0 = performance.now();
      const res = await fetch(`${engineUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      engineLatencyMs = Math.round(performance.now() - t0);
      engineReachable = res.ok;
    } catch {
      engineReachable = false;
    }

    // Probe DB
    let dbConnected = false;
    try {
      db.prepare("SELECT 1").get();
      dbConnected = true;
    } catch {
      dbConnected = false;
    }

    return {
      status: "ok",
      uptimeMs,
      engine: { reachable: engineReachable, latencyMs: engineLatencyMs },
      db: { connected: dbConnected },
    };
  });
}
