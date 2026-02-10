import Fastify from "fastify";
import healthRoutes from "./routes/health.js";
import txRoutes from "./routes/tx.js";
import playerRoutes from "./routes/player.js";
import statsRoutes from "./routes/stats.js";
import stateVersionRoutes from "./routes/state-version.js";
import configRoutes from "./routes/config.js";
import algorithmsRoutes from "./routes/algorithms.js";
import { createGameInstanceStore } from "./state.js";
import { loadGameConfig } from "./config-loader.js";
import { SnapshotManager } from "./snapshot-manager.js";
import { migrateStateToConfig } from "./migrator.js";
import { DEFAULT_MAX_IDEMPOTENCY_ENTRIES } from "./idempotency-store.js";

export interface AppOptions {
  configPath?: string;
  snapshotDir?: string;
  snapshotIntervalMs?: number;
  adminApiKey?: string;
  maxIdempotencyEntries?: number;
}

export function createApp(options?: string | AppOptions) {
  const opts: AppOptions =
    typeof options === "string" ? { configPath: options } : (options ?? {});

  const configPath = opts.configPath;
  const adminApiKey =
    opts.adminApiKey ?? process.env.ADMIN_API_KEY ?? undefined;
  const snapshotDir =
    opts.snapshotDir ?? process.env.SNAPSHOT_DIR ?? undefined;
  const snapshotIntervalMs =
    opts.snapshotIntervalMs ??
    (process.env.SNAPSHOT_INTERVAL_MS
      ? Number(process.env.SNAPSHOT_INTERVAL_MS)
      : undefined);
  const maxIdempotencyEntries =
    opts.maxIdempotencyEntries ??
    (process.env.GAMENG_MAX_IDEMPOTENCY_ENTRIES
      ? Number(process.env.GAMENG_MAX_IDEMPOTENCY_ENTRIES)
      : DEFAULT_MAX_IDEMPOTENCY_ENTRIES);

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  const config = loadGameConfig(configPath);
  const store = createGameInstanceStore(config.gameConfigId);
  const configs = new Map([[config.gameConfigId, config]]);

  // Restore snapshots if configured
  let snapshotManager: SnapshotManager | undefined;
  if (snapshotDir) {
    snapshotManager = new SnapshotManager(snapshotDir);
    const restored = snapshotManager.loadAll();
    for (const state of restored) {
      try {
        const { migratedState, report } = migrateStateToConfig(state, config);
        store.set(migratedState.gameInstanceId, migratedState);
        if (report.warnings.length > 0) {
          console.warn(
            `[snapshot] Migrated ${state.gameInstanceId}: ${String(report.warnings.length)} warnings`,
          );
          for (const w of report.warnings) {
            console.warn(
              `  [${w.rule}] ${w.entityType}/${w.entityId}: ${w.detail}`,
            );
          }
        } else {
          console.log(
            `[snapshot] Restored ${state.gameInstanceId} (no migration needed)`,
          );
        }
      } catch (err) {
        console.error(
          `[snapshot] Migration failed for ${state.gameInstanceId}, using empty state: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  app.decorate("gameInstances", store);
  app.decorate("gameConfigs", configs);
  app.decorate("activeConfig", config);
  app.decorate("adminApiKey", adminApiKey);
  app.decorate("txIdCacheMaxEntries", maxIdempotencyEntries);

  // flushSnapshots: manual trigger for tests and graceful shutdown
  const mgr = snapshotManager;
  app.decorate("flushSnapshots", () => {
    if (mgr) {
      mgr.saveAll(store);
    }
  });

  app.register(healthRoutes);
  app.register(txRoutes);
  app.register(playerRoutes);
  app.register(statsRoutes);
  app.register(stateVersionRoutes);
  app.register(configRoutes);
  app.register(algorithmsRoutes);

  // Periodic flush
  let intervalHandle: ReturnType<typeof setInterval> | undefined;
  if (mgr && snapshotIntervalMs && snapshotIntervalMs > 0) {
    intervalHandle = setInterval(() => {
      mgr.saveAll(store);
    }, snapshotIntervalMs);
  }

  // Cleanup on close: flush once, clear interval
  app.addHook("onClose", () => {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = undefined;
    }
    if (mgr) {
      mgr.saveAll(store);
    }
  });

  return app;
}
