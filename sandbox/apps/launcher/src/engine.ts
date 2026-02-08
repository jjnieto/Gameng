/**
 * Engine process manager.
 *
 * Spawns the Gameng engine as a child process (`node dist/server.js`),
 * captures stdout/stderr into a LogBuffer, and exposes start/stop/restart.
 *
 * Uses GAMENG_E2E=1 so the engine registers `POST /__shutdown` for
 * graceful shutdown on Windows (SIGTERM is a hard kill on Windows).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { LauncherConfig } from "./config.js";
import { LogBuffer } from "./log-buffer.js";

export interface EngineStatus {
  running: boolean;
  pid: number | null;
  port: number;
  startedAt: string | null;
  lastExitCode: number | null;
  lastExitSignal: string | null;
}

/**
 * Abstraction for spawning a child process.
 * Allows tests to inject a mock without real spawns.
 */
export interface ProcessSpawner {
  spawn(
    command: string,
    args: string[],
    opts: {
      cwd: string;
      env: Record<string, string>;
      stdio: ["ignore", "pipe", "pipe"];
    },
  ): ChildProcess;
}

/** Default spawner — real child_process.spawn */
export const defaultSpawner: ProcessSpawner = {
  spawn(command, args, opts) {
    return spawn(command, args, opts);
  },
};

export class EngineProcessManager {
  private proc: ChildProcess | null = null;
  private _startedAt: string | null = null;
  private _lastExitCode: number | null = null;
  private _lastExitSignal: string | null = null;

  readonly logs: LogBuffer;
  private readonly config: LauncherConfig;
  private readonly spawner: ProcessSpawner;

  constructor(
    config: LauncherConfig,
    logs?: LogBuffer,
    spawner?: ProcessSpawner,
  ) {
    this.config = config;
    this.logs = logs ?? new LogBuffer();
    this.spawner = spawner ?? defaultSpawner;
  }

  get running(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }

  status(): EngineStatus {
    return {
      running: this.running,
      pid: this.running ? (this.proc?.pid ?? null) : null,
      port: this.config.enginePort,
      startedAt: this._startedAt,
      lastExitCode: this._lastExitCode,
      lastExitSignal: this._lastExitSignal,
    };
  }

  /**
   * Start the engine. Returns true if started, false if already running.
   */
  start(): boolean {
    if (this.running) return false;

    if (!existsSync(this.config.engineEntry)) {
      throw new Error(
        `Engine entry not found: ${this.config.engineEntry}. Run "npm run build" in the repo root first.`,
      );
    }

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PORT: String(this.config.enginePort),
      HOST: "127.0.0.1",
      LOG_LEVEL: this.config.engineLogLevel,
      SNAPSHOT_DIR: this.config.snapshotDir,
      GAMENG_E2E: "1", // enables POST /__shutdown for graceful stop
    };

    if (this.config.configPath) {
      env.CONFIG_PATH = this.config.configPath;
    }
    if (this.config.adminApiKey) {
      env.ADMIN_API_KEY = this.config.adminApiKey;
    }

    this.logs.clear();

    const child = this.spawner.spawn(
      process.execPath,
      [this.config.engineEntry],
      {
        cwd: this.config.repoRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    child.stdout?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) this.logs.push("stdout", line);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) this.logs.push("stderr", line);
    });

    child.on("exit", (code, signal) => {
      this._lastExitCode = code;
      this._lastExitSignal = signal;
      this.proc = null;
    });

    this.proc = child;
    this._startedAt = new Date().toISOString();
    this._lastExitCode = null;
    this._lastExitSignal = null;

    return true;
  }

  /**
   * Stop the engine gracefully via POST /__shutdown, fall back to SIGKILL.
   */
  async stop(): Promise<boolean> {
    if (!this.running || !this.proc) return false;

    const baseUrl = `http://127.0.0.1:${String(this.config.enginePort)}`;

    // Try graceful shutdown via /__shutdown endpoint
    try {
      await fetch(`${baseUrl}/__shutdown`, {
        method: "POST",
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Server may already be down or not responding
    }

    // Wait for exit, fall back to SIGKILL
    return new Promise<boolean>((resolve) => {
      if (!this.proc || this.proc.exitCode !== null) {
        resolve(true);
        return;
      }

      const killTimer = setTimeout(() => {
        this.proc?.kill("SIGKILL");
      }, 5000);

      this.proc.on("exit", () => {
        clearTimeout(killTimer);
        resolve(true);
      });
    });
  }

  /**
   * Stop then start. Returns true if restarted successfully.
   */
  async restart(): Promise<boolean> {
    await this.stop();
    // Small delay to let the port free up
    await new Promise((r) => setTimeout(r, 300));
    return this.start();
  }

  /**
   * Synchronous force-kill of the engine child process.
   * Used in process.on("exit") which does not allow async work.
   * On Windows, child.kill() is always a hard kill.
   */
  killSync(): void {
    if (this.proc && this.proc.exitCode === null) {
      try {
        this.proc.kill();
      } catch {
        // Process may have already exited
      }
    }
  }
}
