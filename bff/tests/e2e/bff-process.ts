/**
 * E2E BFF + Engine process manager.
 *
 * - startEngine(): spawns the Gameng engine with env overrides.
 * - startBff(): spawns the BFF process pointing to the engine.
 * - Both poll /health for readiness.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const ENGINE_ROOT = resolve(PROJECT_ROOT, "..");
const ENGINE_ENTRY = resolve(ENGINE_ROOT, "dist", "server.js");
const BFF_ENTRY = resolve(PROJECT_ROOT, "dist", "server.js");

export interface ProcessHandle {
  baseUrl: string;
  port: number;
  proc: ChildProcess;
  logs: string[];
  stop: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Free-port helper
// ---------------------------------------------------------------------------

async function findFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        reject(new Error("Could not determine port"));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Health polling
// ---------------------------------------------------------------------------

async function waitForHealth(
  url: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let delay = 50;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 500);
  }

  throw new Error(`${url} did not become healthy within ${String(timeoutMs)}ms`);
}

// ---------------------------------------------------------------------------
// Spawn helpers
// ---------------------------------------------------------------------------

function spawnProcess(
  entry: string,
  cwd: string,
  env: Record<string, string>,
): { proc: ChildProcess; logs: string[] } {
  const logs: string[] = [];

  const proc = spawn(process.execPath, [entry], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stdout?.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) logs.push(line);
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) logs.push(`[stderr] ${line}`);
  });

  return { proc, logs };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface EngineOptions {
  port?: number;
  configPath?: string;
  adminApiKey: string;
}

export async function startEngine(opts: EngineOptions): Promise<ProcessHandle> {
  const port = opts.port ?? (await findFreePort());
  const snapshotDir = mkdtempSync(join(tmpdir(), "gameng-bff-e2e-snap-"));
  const configPath = opts.configPath
    ? resolve(ENGINE_ROOT, opts.configPath)
    : undefined;

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(port),
    HOST: "127.0.0.1",
    SNAPSHOT_DIR: snapshotDir,
    SNAPSHOT_INTERVAL_MS: "0",
    LOG_LEVEL: process.env.GAMENG_E2E_LOG_LEVEL ?? "warn",
    GAMENG_E2E: "1",
    ADMIN_API_KEY: opts.adminApiKey,
    ...(configPath ? { CONFIG_PATH: configPath } : {}),
  };

  const { proc, logs } = spawnProcess(ENGINE_ENTRY, ENGINE_ROOT, env);
  const baseUrl = `http://127.0.0.1:${String(port)}`;

  try {
    await waitForHealth(`${baseUrl}/health`, 15_000);
  } catch (err) {
    console.error("ENGINE LOGS:", logs.slice(-30).join("\n"));
    proc.kill("SIGKILL");
    throw err;
  }

  const stop = async (): Promise<void> => {
    if (proc.exitCode !== null) return;
    try {
      await fetch(`${baseUrl}/__shutdown`, {
        method: "POST",
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // ok
    }
    return new Promise<void>((resolve) => {
      if (proc.exitCode !== null) { resolve(); return; }
      const t = setTimeout(() => proc.kill("SIGKILL"), 5000);
      proc.on("exit", () => { clearTimeout(t); resolve(); });
    });
  };

  return { baseUrl, port, proc, logs, stop };
}

// ---------------------------------------------------------------------------
// BFF
// ---------------------------------------------------------------------------

export interface BffOptions {
  port?: number;
  engineUrl: string;
  adminApiKey: string;
  jwtSecret?: string;
  internalAdminSecret?: string;
  dbPath?: string;
}

export async function startBff(opts: BffOptions): Promise<ProcessHandle> {
  const port = opts.port ?? (await findFreePort());
  const dbPath =
    opts.dbPath ??
    join(mkdtempSync(join(tmpdir(), "gameng-bff-e2e-db-")), "bff.sqlite");

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    BFF_PORT: String(port),
    BFF_HOST: "127.0.0.1",
    BFF_LOG_LEVEL: process.env.GAMENG_E2E_LOG_LEVEL ?? "warn",
    ENGINE_URL: opts.engineUrl,
    GAME_INSTANCE_ID: "instance_001",
    BFF_JWT_SECRET: opts.jwtSecret ?? "e2e-test-jwt-secret",
    BFF_JWT_EXPIRY: "1h",
    BFF_ADMIN_API_KEY: opts.adminApiKey,
    BFF_INTERNAL_ADMIN_SECRET: opts.internalAdminSecret ?? "e2e-admin-secret",
    BFF_DB_PATH: dbPath,
    BFF_BCRYPT_ROUNDS: "4", // fast for tests
    BFF_RATE_LIMIT_MAX: "1000", // high limit for tests
  };

  const { proc, logs } = spawnProcess(BFF_ENTRY, PROJECT_ROOT, env);
  const baseUrl = `http://127.0.0.1:${String(port)}`;

  try {
    await waitForHealth(`${baseUrl}/health`, 15_000);
  } catch (err) {
    console.error("BFF LOGS:", logs.slice(-30).join("\n"));
    proc.kill("SIGKILL");
    throw err;
  }

  const stop = async (): Promise<void> => {
    if (proc.exitCode !== null) return;
    proc.kill("SIGTERM");
    return new Promise<void>((resolve) => {
      if (proc.exitCode !== null) { resolve(); return; }
      const t = setTimeout(() => proc.kill("SIGKILL"), 5000);
      proc.on("exit", () => { clearTimeout(t); resolve(); });
    });
  };

  return { baseUrl, port, proc, logs, stop };
}
