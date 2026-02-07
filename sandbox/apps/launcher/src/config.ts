import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * Centralized launcher configuration.
 * All paths are resolved to absolute from the repo root.
 */
export interface LauncherConfig {
  /** Port for the launcher HTTP server */
  launcherPort: number;
  /** Port the engine will listen on */
  enginePort: number;
  /** Absolute path to the active config JSON */
  configPath: string;
  /** Absolute path to the snapshot directory */
  snapshotDir: string;
  /** Log level passed to the engine */
  engineLogLevel: string;
  /** Admin API key passed to the engine (optional) */
  adminApiKey: string | undefined;
  /** Absolute path to the repo root (engine cwd) */
  repoRoot: string;
  /** Absolute path to the engine entry point (dist/server.js) */
  engineEntry: string;
}

/**
 * Resolve configuration from environment variables with sensible defaults.
 * Creates data directories if they don't exist.
 */
export function resolveConfig(): LauncherConfig {
  // The repo root is three levels up from this file:
  //   sandbox/apps/launcher/src/config.ts -> repo root
  const repoRoot = resolve(import.meta.dirname, "..", "..", "..", "..");

  const configPath = resolve(
    repoRoot,
    process.env.SANDBOX_CONFIG_PATH ?? "sandbox/data/configs/active.json",
  );
  const snapshotDir = resolve(
    repoRoot,
    process.env.SANDBOX_SNAPSHOT_DIR ?? "sandbox/data/snapshots",
  );

  // Ensure data directories exist
  mkdirSync(resolve(repoRoot, "sandbox/data/configs"), { recursive: true });
  mkdirSync(snapshotDir, { recursive: true });
  mkdirSync(resolve(repoRoot, "sandbox/data/logs"), { recursive: true });

  return {
    launcherPort: Number(process.env.SANDBOX_LAUNCHER_PORT ?? 4010),
    enginePort: Number(process.env.SANDBOX_ENGINE_PORT ?? 4000),
    configPath,
    snapshotDir,
    engineLogLevel: process.env.SANDBOX_ENGINE_LOG_LEVEL ?? "warn",
    adminApiKey: process.env.SANDBOX_ADMIN_API_KEY ?? undefined,
    repoRoot,
    engineEntry: resolve(repoRoot, "dist", "server.js"),
  };
}
