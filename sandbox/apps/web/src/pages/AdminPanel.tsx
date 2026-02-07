import { useState, useCallback } from "react";
import { createEngineClient, EngineClientError } from "../lib/engineClient.ts";
import type { Settings } from "../lib/useSettings.ts";
import type { TransactionRequest, TxResponse } from "../lib/types.ts";

// ---- localStorage for admin inputs ----

const ADMIN_STORAGE_KEY = "gameng-sandbox-admin-inputs";

interface AdminInputs {
  actorId: string;
  actorApiKey: string;
  grantPlayerId: string;
  grantResources: string;
  seedPlayerId: string;
  seedActorId: string;
  seedApiKey: string;
}

const INPUT_DEFAULTS: AdminInputs = {
  actorId: "actor_1",
  actorApiKey: "my-player-key",
  grantPlayerId: "player_1",
  grantResources: '{"gold": 100}',
  seedPlayerId: "player_1",
  seedActorId: "actor_1",
  seedApiKey: "my-player-key",
};

function loadInputs(): AdminInputs {
  try {
    const raw = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (raw) return { ...INPUT_DEFAULTS, ...(JSON.parse(raw) as Partial<AdminInputs>) };
  } catch {
    // ignore
  }
  return { ...INPUT_DEFAULTS };
}

function saveInputs(inputs: AdminInputs): void {
  localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(inputs));
}

// ---- txId generator ----

let txCounter = 0;
function nextTxId(prefix: string): string {
  txCounter += 1;
  return `${prefix}_${Date.now()}_${String(txCounter)}`;
}

// ---- Sub-components ----

function InputField({ label, value, onChange, placeholder, mono }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        className={`w-full rounded bg-gray-700 px-2 py-1 text-sm text-white border border-gray-600 focus:border-blue-500 focus:outline-none ${mono ? "font-mono" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function ResultPanel({ title, data }: { title: string; data: unknown }) {
  if (data === null) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-300 mb-1">{title}</h3>
      <pre className="bg-gray-950 rounded p-3 text-xs text-green-400 overflow-x-auto max-h-[300px] overflow-y-auto font-mono whitespace-pre-wrap">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

interface SeedStep {
  label: string;
  status: "pending" | "running" | "ok" | "error";
  result?: unknown;
  error?: string;
}

function SeedLog({ steps }: { steps: SeedStep[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold text-gray-300 mb-1">Seed progress</h3>
      {steps.map((step, i) => {
        const icon = { pending: "\u25cb", running: "\u25d4", ok: "\u2713", error: "\u2717" }[step.status];
        const color = { pending: "text-gray-500", running: "text-yellow-400", ok: "text-green-400", error: "text-red-400" }[step.status];
        return (
          <div key={i} className={`text-sm ${color}`}>
            <span className="mr-2">{icon}</span>
            <span>{step.label}</span>
            {step.error && <span className="ml-2 text-xs text-red-400">({step.error})</span>}
          </div>
        );
      })}
    </div>
  );
}

// ---- Main component ----

export default function AdminPanel({ settings, onUpdateSettings }: {
  settings: Settings;
  onUpdateSettings: (patch: Partial<Settings>) => void;
}) {
  const [inputs, setInputs] = useState<AdminInputs>(loadInputs);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [lastResult, setLastResult] = useState<{ title: string; data: unknown } | null>(null);
  const [seedSteps, setSeedSteps] = useState<SeedStep[]>([]);

  const updateInput = useCallback((patch: Partial<AdminInputs>) => {
    setInputs((prev) => {
      const next = { ...prev, ...patch };
      saveInputs(next);
      return next;
    });
  }, []);

  const client = createEngineClient(settings.engineBaseUrl, settings.gameInstanceId);
  const hasAdminKey = settings.adminApiKey.trim().length > 0;

  // ---- Error helper ----
  const formatError = (err: unknown): string => {
    if (err instanceof EngineClientError) {
      const code = err.body?.errorCode ?? "";
      const msg = err.body?.errorMessage ?? err.message;
      return code ? `${code}: ${msg}` : msg;
    }
    return "Engine unreachable";
  };

  // ---- CreateActor ----
  const doCreateActor = async () => {
    setPending(true);
    setError(null);
    try {
      const tx: TransactionRequest = {
        txId: nextTxId("admin_ca"),
        type: "CreateActor",
        gameInstanceId: settings.gameInstanceId,
        actorId: inputs.actorId,
        apiKey: inputs.actorApiKey,
      };
      const res = await client.postTx(tx, { adminApiKey: settings.adminApiKey });
      setLastResult({ title: "CreateActor", data: res });
    } catch (err) {
      setError(formatError(err));
      if (err instanceof EngineClientError && err.body) {
        setLastResult({ title: "CreateActor (error)", data: err.body });
      }
    } finally {
      setPending(false);
    }
  };

  // ---- GrantResources ----
  const doGrantResources = async () => {
    setPending(true);
    setError(null);
    let resources: Record<string, number>;
    try {
      resources = JSON.parse(inputs.grantResources) as Record<string, number>;
    } catch {
      setError("Invalid resources JSON");
      setPending(false);
      return;
    }
    try {
      const tx: TransactionRequest = {
        txId: nextTxId("admin_gr"),
        type: "GrantResources",
        gameInstanceId: settings.gameInstanceId,
        playerId: inputs.grantPlayerId,
        resources,
      };
      const res = await client.postTx(tx, { adminApiKey: settings.adminApiKey });
      setLastResult({ title: "GrantResources", data: res });
    } catch (err) {
      setError(formatError(err));
      if (err instanceof EngineClientError && err.body) {
        setLastResult({ title: "GrantResources (error)", data: err.body });
      }
    } finally {
      setPending(false);
    }
  };

  // ---- Load player state (verify resources) ----
  const doLoadPlayerState = async () => {
    setPending(true);
    setError(null);
    try {
      const state = await client.getPlayerState(inputs.grantPlayerId, inputs.actorApiKey);
      setLastResult({ title: `Player ${inputs.grantPlayerId}`, data: state });
    } catch (err) {
      setError(formatError(err));
    } finally {
      setPending(false);
    }
  };

  // ---- Seed demo ----
  const doSeed = async () => {
    setPending(true);
    setError(null);
    setLastResult(null);

    const steps: SeedStep[] = [
      { label: `CreateActor (${inputs.seedActorId})`, status: "pending" },
      { label: `CreatePlayer (${inputs.seedPlayerId})`, status: "pending" },
      { label: `GrantResources (${inputs.seedPlayerId})`, status: "pending" },
    ];
    setSeedSteps([...steps]);

    const runStep = async (
      index: number,
      fn: () => Promise<TxResponse>,
    ): Promise<boolean> => {
      steps[index].status = "running";
      setSeedSteps([...steps]);
      try {
        const res = await fn();
        if (!res.accepted) {
          steps[index].status = "error";
          steps[index].error = res.errorCode ?? "rejected";
          steps[index].result = res;
          setSeedSteps([...steps]);
          setLastResult({ title: `Seed failed at step ${String(index + 1)}`, data: res });
          return false;
        }
        steps[index].status = "ok";
        steps[index].result = res;
        setSeedSteps([...steps]);
        return true;
      } catch (err) {
        steps[index].status = "error";
        steps[index].error = formatError(err);
        setSeedSteps([...steps]);
        setError(formatError(err));
        return false;
      }
    };

    // Step 1: CreateActor
    const ok1 = await runStep(0, () =>
      client.postTx(
        {
          txId: nextTxId("seed_ca"),
          type: "CreateActor",
          gameInstanceId: settings.gameInstanceId,
          actorId: inputs.seedActorId,
          apiKey: inputs.seedApiKey,
        },
        { adminApiKey: settings.adminApiKey },
      ),
    );
    if (!ok1) { setPending(false); return; }

    // Step 2: CreatePlayer (uses the actor's key)
    const ok2 = await runStep(1, () =>
      client.postTx(
        {
          txId: nextTxId("seed_cp"),
          type: "CreatePlayer",
          gameInstanceId: settings.gameInstanceId,
          playerId: inputs.seedPlayerId,
        },
        { apiKey: inputs.seedApiKey },
      ),
    );
    if (!ok2) { setPending(false); return; }

    // Step 3: GrantResources
    let resources: Record<string, number>;
    try {
      resources = JSON.parse(inputs.grantResources) as Record<string, number>;
    } catch {
      steps[2].status = "error";
      steps[2].error = "Invalid resources JSON";
      setSeedSteps([...steps]);
      setError("Invalid resources JSON");
      setPending(false);
      return;
    }

    const ok3 = await runStep(2, () =>
      client.postTx(
        {
          txId: nextTxId("seed_gr"),
          type: "GrantResources",
          gameInstanceId: settings.gameInstanceId,
          playerId: inputs.seedPlayerId,
          resources,
        },
        { adminApiKey: settings.adminApiKey },
      ),
    );

    if (ok3) {
      // Save seed outputs to PlayerView localStorage for convenience
      const playerInputs = {
        playerId: inputs.seedPlayerId,
        apiKey: inputs.seedApiKey,
        characterId: "hero_1",
        classId: "warrior",
      };
      localStorage.setItem("gameng-sandbox-player-inputs", JSON.stringify(playerInputs));
      setLastResult({ title: "Seed complete", data: { message: "All 3 steps OK. PlayerView inputs updated.", playerInputs } });
    }

    setPending(false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
      {/* Left: forms */}
      <div className="space-y-6">
        {/* Admin key banner */}
        {!hasAdminKey && (
          <div className="rounded bg-yellow-900/50 border border-yellow-700 px-3 py-2 text-sm text-yellow-300">
            Admin API Key not set. Configure it below or in /server settings.
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="rounded bg-red-900/50 border border-red-700 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Connection info */}
        <div className="rounded-lg bg-gray-800 p-4 space-y-2">
          <h2 className="text-sm font-semibold text-white">Connection</h2>
          <div className="text-xs text-gray-500 space-y-1">
            <p>Engine: <span className="text-gray-300 font-mono">{settings.engineBaseUrl}</span></p>
            <p>Instance: <span className="text-gray-300 font-mono">{settings.gameInstanceId}</span></p>
          </div>
          <InputField
            label="Admin API Key"
            value={settings.adminApiKey}
            onChange={(v) => onUpdateSettings({ adminApiKey: v })}
            placeholder="Bearer token for admin operations"
            mono
          />
        </div>

        {/* CreateActor */}
        <div className="rounded-lg bg-gray-800 p-4 space-y-3">
          <h2 className="text-lg font-semibold text-white">CreateActor</h2>
          <InputField label="Actor ID" value={inputs.actorId} onChange={(v) => updateInput({ actorId: v })} mono />
          <InputField label="Actor API Key" value={inputs.actorApiKey} onChange={(v) => updateInput({ actorApiKey: v })} placeholder="Key this actor will use" mono />
          <button
            onClick={() => void doCreateActor()}
            disabled={pending || !hasAdminKey}
            className="rounded bg-green-700 px-3 py-1.5 text-sm text-white hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            CreateActor
          </button>
        </div>

        {/* GrantResources */}
        <div className="rounded-lg bg-gray-800 p-4 space-y-3">
          <h2 className="text-lg font-semibold text-white">GrantResources</h2>
          <InputField label="Player ID" value={inputs.grantPlayerId} onChange={(v) => updateInput({ grantPlayerId: v })} mono />
          <div>
            <label className="block text-xs text-gray-400 mb-1">Resources (JSON)</label>
            <textarea
              className="w-full rounded bg-gray-700 px-2 py-1 text-sm text-white border border-gray-600 focus:border-blue-500 focus:outline-none font-mono resize-none h-16"
              value={inputs.grantResources}
              onChange={(e) => updateInput({ grantResources: e.target.value })}
              spellCheck={false}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void doGrantResources()}
              disabled={pending || !hasAdminKey}
              className="rounded bg-green-700 px-3 py-1.5 text-sm text-white hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              GrantResources
            </button>
            <button
              onClick={() => void doLoadPlayerState()}
              disabled={pending}
              className="rounded bg-blue-700 px-3 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Load Player State
            </button>
          </div>
        </div>

        {/* Seed demo */}
        <div className="rounded-lg bg-gray-800 p-4 space-y-3">
          <h2 className="text-lg font-semibold text-white">Seed Demo</h2>
          <p className="text-xs text-gray-400">Creates actor + player + grants resources in one click. Updates /player inputs.</p>
          <div className="grid grid-cols-2 gap-2">
            <InputField label="Actor ID" value={inputs.seedActorId} onChange={(v) => updateInput({ seedActorId: v })} mono />
            <InputField label="Actor API Key" value={inputs.seedApiKey} onChange={(v) => updateInput({ seedApiKey: v })} mono />
          </div>
          <InputField label="Player ID" value={inputs.seedPlayerId} onChange={(v) => updateInput({ seedPlayerId: v })} mono />
          <button
            onClick={() => void doSeed()}
            disabled={pending || !hasAdminKey}
            className="rounded bg-purple-700 px-3 py-1.5 text-sm text-white hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed w-full"
          >
            Seed Demo
          </button>
          <SeedLog steps={seedSteps} />
        </div>
      </div>

      {/* Right: result panel */}
      <div className="rounded-lg bg-gray-800 p-4">
        <h2 className="text-lg font-semibold text-white mb-3">Result</h2>
        {lastResult ? (
          <ResultPanel title={lastResult.title} data={lastResult.data} />
        ) : (
          <p className="text-gray-500 text-sm italic">Run an action to see results here.</p>
        )}
      </div>
    </div>
  );
}
