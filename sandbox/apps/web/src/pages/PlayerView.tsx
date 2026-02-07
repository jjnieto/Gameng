import { useState, useCallback } from "react";
import { createEngineClient, EngineClientError } from "../lib/engineClient.ts";
import type { Settings } from "../lib/useSettings.ts";
import type { TransactionRequest } from "../lib/types.ts";

// ---- localStorage helpers for player-page inputs ----

const PLAYER_STORAGE_KEY = "gameng-sandbox-player-inputs";

interface PlayerInputs {
  playerId: string;
  characterId: string;
  classId: string;
  apiKey: string;
}

const INPUT_DEFAULTS: PlayerInputs = {
  playerId: "player_1",
  characterId: "hero_1",
  classId: "warrior",
  apiKey: "",
};

function loadInputs(): PlayerInputs {
  try {
    const raw = localStorage.getItem(PLAYER_STORAGE_KEY);
    if (raw) return { ...INPUT_DEFAULTS, ...(JSON.parse(raw) as Partial<PlayerInputs>) };
  } catch {
    // ignore
  }
  return { ...INPUT_DEFAULTS };
}

function saveInputs(inputs: PlayerInputs): void {
  localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(inputs));
}

// ---- Tiny counter for txId generation ----

let txCounter = 0;
function nextTxId(): string {
  txCounter += 1;
  return `ui_tx_${Date.now()}_${String(txCounter)}`;
}

// ---- Sub-components ----

function InputField({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        className="w-full rounded bg-gray-700 px-2 py-1 text-sm text-white border border-gray-600 focus:border-blue-500 focus:outline-none font-mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function ActionButton({ label, onClick, disabled, variant = "blue" }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "blue" | "green" | "purple";
}) {
  const colors = {
    blue: "bg-blue-700 hover:bg-blue-600",
    green: "bg-green-700 hover:bg-green-600",
    purple: "bg-purple-700 hover:bg-purple-600",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-3 py-1.5 text-sm text-white ${colors[variant]} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {label}
    </button>
  );
}

function ResultPanel({ title, data }: { title: string; data: unknown }) {
  if (data === null) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-300 mb-1">{title}</h3>
      <pre className="bg-gray-950 rounded p-3 text-xs text-green-400 overflow-x-auto max-h-[400px] overflow-y-auto font-mono whitespace-pre-wrap">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

// ---- Main component ----

export default function PlayerView({ settings }: { settings: Settings }) {
  const [inputs, setInputs] = useState<PlayerInputs>(loadInputs);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [lastResult, setLastResult] = useState<{ title: string; data: unknown } | null>(null);
  const [stateVersion, setStateVersion] = useState<number | null>(null);

  const updateInput = useCallback((patch: Partial<PlayerInputs>) => {
    setInputs((prev) => {
      const next = { ...prev, ...patch };
      saveInputs(next);
      return next;
    });
  }, []);

  const client = createEngineClient(settings.engineBaseUrl, settings.gameInstanceId);

  // ---- Wrap actions with error handling ----
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      const data = await fn();
      setLastResult({ title: label, data });
    } catch (err) {
      if (err instanceof EngineClientError) {
        const code = err.body?.errorCode ?? "";
        const msg = err.body?.errorMessage ?? err.message;
        setError(code ? `${code}: ${msg}` : msg);
        // Still show the error body as result for debugging
        if (err.body) {
          setLastResult({ title: `${label} (error)`, data: err.body });
        }
      } else {
        setError("Engine unreachable");
      }
    } finally {
      setPending(false);
    }
  };

  // ---- Actions ----

  const doCreatePlayer = () =>
    void run("CreatePlayer", () => {
      const tx: TransactionRequest = {
        txId: nextTxId(),
        type: "CreatePlayer",
        gameInstanceId: settings.gameInstanceId,
        playerId: inputs.playerId,
      };
      return client.postTx(tx, { apiKey: inputs.apiKey });
    });

  const doLoadState = () =>
    void run("Player State", () =>
      client.getPlayerState(inputs.playerId, inputs.apiKey),
    );

  const doCreateCharacter = () =>
    void run("CreateCharacter", () => {
      const tx: TransactionRequest = {
        txId: nextTxId(),
        type: "CreateCharacter",
        gameInstanceId: settings.gameInstanceId,
        playerId: inputs.playerId,
        characterId: inputs.characterId,
        classId: inputs.classId,
      };
      return client.postTx(tx, { apiKey: inputs.apiKey });
    });

  const doGetStats = () =>
    void run("Character Stats", () =>
      client.getCharacterStats(inputs.characterId, inputs.apiKey),
    );

  const doRefreshVersion = () =>
    void run("State Version", async () => {
      const sv = await client.getStateVersion();
      setStateVersion(sv.stateVersion);
      return sv;
    });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
      {/* Left column: inputs + actions */}
      <div className="space-y-6">
        {/* Error banner */}
        {error && (
          <div className="rounded bg-red-900/50 border border-red-700 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Connection info */}
        <div className="rounded-lg bg-gray-800 p-4 space-y-1 text-xs text-gray-500">
          <p>Engine: <span className="text-gray-300 font-mono">{settings.engineBaseUrl}</span></p>
          <p>Instance: <span className="text-gray-300 font-mono">{settings.gameInstanceId}</span></p>
          {stateVersion !== null && (
            <p>State version: <span className="text-white font-mono">{stateVersion}</span></p>
          )}
        </div>

        {/* Inputs */}
        <div className="rounded-lg bg-gray-800 p-4 space-y-3">
          <h2 className="text-lg font-semibold text-white">Inputs</h2>
          <InputField
            label="API Key (actor)"
            value={inputs.apiKey}
            onChange={(v) => updateInput({ apiKey: v })}
            placeholder="Bearer token for this actor"
          />
          <InputField
            label="Player ID"
            value={inputs.playerId}
            onChange={(v) => updateInput({ playerId: v })}
          />
          <InputField
            label="Character ID"
            value={inputs.characterId}
            onChange={(v) => updateInput({ characterId: v })}
          />
          <InputField
            label="Class ID (for CreateCharacter)"
            value={inputs.classId}
            onChange={(v) => updateInput({ classId: v })}
          />
        </div>

        {/* Actions */}
        <div className="rounded-lg bg-gray-800 p-4 space-y-3">
          <h2 className="text-lg font-semibold text-white">Actions</h2>
          <div className="flex flex-wrap gap-2">
            <ActionButton label="CreatePlayer" onClick={doCreatePlayer} disabled={pending} variant="green" />
            <ActionButton label="Load State" onClick={doLoadState} disabled={pending} />
            <ActionButton label="CreateCharacter" onClick={doCreateCharacter} disabled={pending} variant="green" />
            <ActionButton label="Get Stats" onClick={doGetStats} disabled={pending} variant="purple" />
          </div>
          <div className="pt-2 border-t border-gray-700">
            <ActionButton label="Refresh stateVersion" onClick={doRefreshVersion} disabled={pending} />
          </div>
        </div>
      </div>

      {/* Right column: result panel */}
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
