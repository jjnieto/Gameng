import { useState, useEffect, useRef, useCallback } from "react";
import {
  createLauncherClient,
  LauncherClientError,
} from "../lib/launcherClient.ts";
import type {
  LauncherStatus,
  LogEntry,
  EngineStatus,
} from "../lib/launcherClient.ts";
import type { Settings } from "../lib/useSettings.ts";

// ---- Types ----

interface HealthResult {
  ok: boolean;
  status: string;
  uptime: number | null;
}

// ---- Sub-components ----

function StatusIndicator({ running, health }: { running: boolean; health: HealthResult | null }) {
  if (!running) {
    return <span className="inline-block h-3 w-3 rounded-full bg-gray-500" title="Stopped" />;
  }
  if (health === null) {
    return <span className="inline-block h-3 w-3 rounded-full bg-yellow-400 animate-pulse" title="Checking..." />;
  }
  if (health.ok) {
    return <span className="inline-block h-3 w-3 rounded-full bg-green-500" title="Healthy" />;
  }
  return <span className="inline-block h-3 w-3 rounded-full bg-red-500" title="Unhealthy" />;
}

function EngineInfo({ engine, health }: { engine: EngineStatus | null; health: HealthResult | null }) {
  if (!engine) return <p className="text-gray-500 text-sm">No status yet</p>;

  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-2">
        <StatusIndicator running={engine.running} health={health} />
        <span className="text-gray-300">{engine.running ? "Running" : "Stopped"}</span>
      </div>
      {engine.pid !== null && (
        <p className="text-gray-400">PID: <span className="text-white font-mono">{engine.pid}</span></p>
      )}
      <p className="text-gray-400">Port: <span className="text-white font-mono">{engine.port}</span></p>
      {engine.startedAt && (
        <p className="text-gray-400">Started: <span className="text-white font-mono text-xs">{engine.startedAt}</span></p>
      )}
      {engine.lastExitCode !== null && !engine.running && (
        <p className="text-gray-400">Last exit: <span className="text-red-400 font-mono">{engine.lastExitCode}</span></p>
      )}
      {health?.ok && health.uptime !== null && (
        <p className="text-gray-400">Uptime: <span className="text-white font-mono">{health.uptime.toFixed(1)}s</span></p>
      )}
    </div>
  );
}

function LogPanel({ logs, autoScroll, onToggleAutoScroll }: {
  logs: LogEntry[];
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-white">Logs</h2>
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={onToggleAutoScroll}
            className="rounded"
          />
          Auto-scroll
        </label>
      </div>
      <div className="flex-1 overflow-y-auto bg-gray-950 rounded p-2 font-mono text-xs leading-relaxed min-h-[300px] max-h-[600px]">
        {logs.length === 0 && (
          <p className="text-gray-600 italic">No logs yet</p>
        )}
        {logs.map((entry, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-gray-600 shrink-0 select-none">
              {entry.ts.slice(11, 23)}
            </span>
            <span className={entry.stream === "stderr" ? "text-red-400" : "text-gray-300"}>
              {entry.line}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function SettingsPanel({ settings, onUpdate }: {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}) {
  const [local, setLocal] = useState({
    launcherBaseUrl: settings.launcherBaseUrl,
    engineBaseUrl: settings.engineBaseUrl,
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    onUpdate(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-white">Settings</h2>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Launcher URL</label>
        <input
          className="w-full rounded bg-gray-700 px-2 py-1 text-sm text-white border border-gray-600 focus:border-blue-500 focus:outline-none"
          value={local.launcherBaseUrl}
          onChange={(e) => setLocal({ ...local, launcherBaseUrl: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Engine URL</label>
        <input
          className="w-full rounded bg-gray-700 px-2 py-1 text-sm text-white border border-gray-600 focus:border-blue-500 focus:outline-none"
          value={local.engineBaseUrl}
          onChange={(e) => setLocal({ ...local, engineBaseUrl: e.target.value })}
        />
      </div>
      <button
        onClick={handleSave}
        className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500"
      >
        {saved ? "Saved!" : "Save"}
      </button>
    </div>
  );
}

// ---- Main component ----

export default function ServerControl({ settings, onUpdateSettings }: {
  settings: Settings;
  onUpdateSettings: (patch: Partial<Settings>) => void;
}) {
  const [status, setStatus] = useState<LauncherStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const client = createLauncherClient(settings.launcherBaseUrl);

  // ---- Fetch status ----
  const fetchStatus = useCallback(async () => {
    try {
      const s = await client.status();
      setStatus(s);
      setError(null);
    } catch (err) {
      if (err instanceof LauncherClientError) {
        setError(`Launcher error: ${String(err.status)}`);
      } else {
        setError("Launcher unreachable");
      }
      setStatus(null);
      setHealth(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.launcherBaseUrl]);

  // ---- Fetch logs ----
  const fetchLogs = useCallback(async () => {
    try {
      const entries = await client.logs(200);
      setLogs(entries);
    } catch {
      // silent — status error already shown
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.launcherBaseUrl]);

  // ---- Health check (direct to engine) ----
  const checkHealth = useCallback(async () => {
    if (!status?.engine.running) {
      setHealth(null);
      return;
    }
    try {
      const res = await fetch(`${settings.engineBaseUrl}/health`);
      const body = await res.json() as { status: string; uptime: number };
      setHealth({ ok: res.ok, status: body.status, uptime: body.uptime });
    } catch {
      setHealth({ ok: false, status: "unreachable", uptime: null });
    }
  }, [status?.engine.running, settings.engineBaseUrl]);

  // ---- Polling: status every 3s ----
  useEffect(() => {
    void fetchStatus();
    const id = setInterval(() => void fetchStatus(), 3000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // ---- Polling: logs every 1s ----
  useEffect(() => {
    void fetchLogs();
    const id = setInterval(() => void fetchLogs(), 1000);
    return () => clearInterval(id);
  }, [fetchLogs]);

  // ---- Polling: health every 2s when running ----
  useEffect(() => {
    void checkHealth();
    const id = setInterval(() => void checkHealth(), 2000);
    return () => clearInterval(id);
  }, [checkHealth]);

  // ---- Engine actions ----
  const doAction = async (action: "start" | "stop" | "restart") => {
    setActionPending(true);
    setError(null);
    try {
      const result = await client[action]();
      if (result.engine) {
        setStatus((prev) => prev ? { ...prev, engine: result.engine! } : prev);
      }
    } catch (err) {
      if (err instanceof LauncherClientError) {
        const body = err.body as { error?: string } | null;
        setError(body?.error ?? `Action failed: ${String(err.status)}`);
      } else {
        setError("Action failed: launcher unreachable");
      }
    } finally {
      setActionPending(false);
      void fetchStatus();
    }
  };

  const engineRunning = status?.engine.running ?? false;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
      {/* Left column: status + controls + settings */}
      <div className="space-y-6">
        {/* Error banner */}
        {error && (
          <div className="rounded bg-red-900/50 border border-red-700 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Engine status */}
        <div className="rounded-lg bg-gray-800 p-4">
          <h2 className="text-lg font-semibold text-white mb-3">Engine Status</h2>
          <EngineInfo engine={status?.engine ?? null} health={health} />
          {status && (
            <div className="mt-3 text-xs text-gray-500">
              <p>Config: {status.config.path}</p>
              <p>Snapshots: {status.snapshotDir}</p>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="rounded-lg bg-gray-800 p-4">
          <h2 className="text-lg font-semibold text-white mb-3">Controls</h2>
          <div className="flex gap-2">
            <button
              onClick={() => void doAction("start")}
              disabled={actionPending || engineRunning}
              className="rounded bg-green-700 px-3 py-1.5 text-sm text-white hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Start
            </button>
            <button
              onClick={() => void doAction("stop")}
              disabled={actionPending || !engineRunning}
              className="rounded bg-red-700 px-3 py-1.5 text-sm text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Stop
            </button>
            <button
              onClick={() => void doAction("restart")}
              disabled={actionPending}
              className="rounded bg-yellow-700 px-3 py-1.5 text-sm text-white hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Restart
            </button>
          </div>
        </div>

        {/* Settings */}
        <div className="rounded-lg bg-gray-800 p-4">
          <SettingsPanel settings={settings} onUpdate={onUpdateSettings} />
        </div>
      </div>

      {/* Right column: logs (spans 2 cols on lg) */}
      <div className="lg:col-span-2 rounded-lg bg-gray-800 p-4">
        <LogPanel
          logs={logs}
          autoScroll={autoScroll}
          onToggleAutoScroll={() => setAutoScroll((v) => !v)}
        />
      </div>
    </div>
  );
}
