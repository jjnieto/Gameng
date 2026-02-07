/**
 * E2E server process manager.
 *
 * - startServer(): spawns `node dist/server.js` with env overrides,
 *   polls GET /health for readiness, captures stdout/stderr.
 * - Returned handle has stop() for graceful SIGTERM + SIGKILL fallback.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServerLogBuffer } from "./logger.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const SERVER_ENTRY = resolve(PROJECT_ROOT, "dist", "server.js");

export interface ServerOptions {
  port?: number;
  configPath?: string;
  snapshotDir?: string;
  snapshotIntervalMs?: number;
  logLevel?: string;
  extraEnv?: Record<string, string>;
}

export interface ServerHandle {
  baseUrl: string;
  port: number;
  proc: ChildProcess;
  logs: ServerLogBuffer;
  snapshotDir: string;
  stop: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Free-port helper: pick a random high port and verify it's free
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
// Health-check polling with exponential backoff
// ---------------------------------------------------------------------------

async function waitForHealth(
  baseUrl: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let delay = 50;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 500);
  }

  throw new Error(
    `Server at ${baseUrl} did not become healthy within ${String(timeoutMs)}ms`,
  );
}

// ---------------------------------------------------------------------------
// startServer / stopServer
// ---------------------------------------------------------------------------

export async function startServer(
  opts: ServerOptions = {},
): Promise<ServerHandle> {
  const port = opts.port ?? (await findFreePort());
  const snapshotDir =
    opts.snapshotDir ?? mkdtempSync(join(tmpdir(), "gameng-e2e-snap-"));
  const configPath = opts.configPath
    ? resolve(PROJECT_ROOT, opts.configPath)
    : undefined;

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PORT: String(port),
    HOST: "127.0.0.1",
    SNAPSHOT_DIR: snapshotDir,
    SNAPSHOT_INTERVAL_MS: String(opts.snapshotIntervalMs ?? 0),
    LOG_LEVEL: opts.logLevel ?? process.env.GAMENG_E2E_LOG_LEVEL ?? "warn",
    GAMENG_E2E: "1",
    ...(configPath ? { CONFIG_PATH: configPath } : {}),
    ...(opts.extraEnv ?? {}),
  };

  const logs = new ServerLogBuffer();

  // Use process.execPath to get the exact node binary (avoids shell wrapper issues)
  const proc = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Capture stdout/stderr
  proc.stdout?.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) logs.push(line);
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) logs.push(`[stderr] ${line}`);
  });

  const baseUrl = `http://127.0.0.1:${String(port)}`;

  // Wait for server readiness
  try {
    await waitForHealth(baseUrl, 15_000);
  } catch (err) {
    // Server failed to start — dump logs and kill
    logs.dump("SERVER (startup failure)", 50);
    proc.kill("SIGKILL");
    throw err;
  }

  const stop = async (): Promise<void> => {
    if (proc.exitCode !== null) return; // already exited

    // Use the /__shutdown endpoint for graceful shutdown (flushes snapshots)
    try {
      await fetch(`${baseUrl}/__shutdown`, {
        method: "POST",
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Server may have already closed the connection — that's ok
    }

    // Wait for process exit, fall back to SIGKILL
    return new Promise<void>((resolve) => {
      if (proc.exitCode !== null) {
        resolve();
        return;
      }

      const killTimer = setTimeout(() => {
        proc.kill("SIGKILL");
      }, 5000);

      proc.on("exit", () => {
        clearTimeout(killTimer);
        resolve();
      });
    });
  };

  return { baseUrl, port, proc, logs, snapshotDir, stop };
}
