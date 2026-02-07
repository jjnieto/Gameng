// Typed client for the Gameng sandbox launcher API.

export interface EngineStatus {
  running: boolean;
  pid: number | null;
  port: number;
  startedAt: string | null;
  lastExitCode: number | null;
  lastExitSignal: string | null;
}

export interface LauncherStatus {
  ok: boolean;
  launcher: { port: number };
  engine: EngineStatus;
  config: { path: string };
  snapshotDir: string;
}

export interface LogEntry {
  ts: string;
  stream: string;
  line: string;
}

export interface EngineActionResult {
  ok: boolean;
  error?: string;
  engine?: EngineStatus;
  stopped?: boolean;
  restarted?: boolean;
}

export class LauncherClientError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Launcher HTTP ${String(status)}`);
    this.name = "LauncherClientError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, init);
  const body: unknown = await res.json();
  if (!res.ok) {
    throw new LauncherClientError(res.status, body);
  }
  return body as T;
}

export interface SaveConfigResult {
  ok: boolean;
  saved: boolean;
  path: string;
  restarted?: boolean;
  error?: string;
}

export function createLauncherClient(baseUrl: string) {
  return {
    status: () => request<LauncherStatus>(baseUrl, "/status"),
    logs: (limit = 200) => request<LogEntry[]>(baseUrl, `/logs?limit=${String(limit)}`),
    start: () => request<EngineActionResult>(baseUrl, "/engine/start", { method: "POST" }),
    stop: () => request<EngineActionResult>(baseUrl, "/engine/stop", { method: "POST" }),
    restart: () => request<EngineActionResult>(baseUrl, "/engine/restart", { method: "POST" }),
    saveConfig: (config: unknown, opts?: { restart?: boolean }) => {
      const qs = opts?.restart ? "?restart=true" : "";
      return request<SaveConfigResult>(baseUrl, `/config${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
    },
  };
}
