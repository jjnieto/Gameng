import { useState, useCallback, useEffect, useRef } from "react";
import {
  createEngineClient,
  getEngineBaseUrl,
  EngineClientError,
} from "../lib/engineClient.ts";
import type { Settings } from "../lib/useSettings.ts";
import type {
  PlayerState,
  StatsResponse,
  GameConfig,
  TransactionRequest,
  TxResponse,
} from "../lib/types.ts";

// ---- localStorage keys ----

const GM_STORAGE_KEY = "gameng-sandbox-gm";
const PLAYER_STORAGE_KEY = "gameng-sandbox-player-inputs";
const ADMIN_STORAGE_KEY = "gameng-sandbox-admin-inputs";

// ---- GM persisted state ----

interface GmState {
  knownPlayerIds: string[];
  selectedPlayerId: string;
  selectedCharacterId: string;
  apiKey: string;
  autoRefresh: boolean;
  jsonView: boolean;
  txBuilderJson: string;
}

const GM_DEFAULTS: GmState = {
  knownPlayerIds: [],
  selectedPlayerId: "",
  selectedCharacterId: "",
  apiKey: "",
  autoRefresh: true,
  jsonView: false,
  txBuilderJson: '{\n  "txId": "",\n  "type": "",\n  "gameInstanceId": "",\n  "playerId": ""\n}',
};

function loadGmState(): GmState {
  try {
    const raw = localStorage.getItem(GM_STORAGE_KEY);
    if (raw) return { ...GM_DEFAULTS, ...(JSON.parse(raw) as Partial<GmState>) };
  } catch {
    // ignore
  }
  return { ...GM_DEFAULTS };
}

function saveGmState(s: GmState): void {
  localStorage.setItem(GM_STORAGE_KEY, JSON.stringify(s));
}

// ---- Helpers ----

function formatError(err: unknown): string {
  if (err instanceof EngineClientError) {
    const code = err.body?.errorCode ?? "";
    const msg = err.body?.errorMessage ?? err.message;
    return code ? `${code}: ${msg}` : msg;
  }
  return "Engine unreachable";
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 2) return "just now";
  if (sec < 60) return `${String(sec)}s ago`;
  return `${String(Math.floor(sec / 60))}m ago`;
}

let txCounter = 0;
function nextTxId(): string {
  txCounter += 1;
  return `gm_tx_${Date.now()}_${String(txCounter)}`;
}

// ---- Sub-components ----

function Btn({
  label,
  onClick,
  disabled,
  variant = "blue",
  small,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "blue" | "green" | "red" | "purple" | "gray";
  small?: boolean;
}) {
  const colors: Record<string, string> = {
    blue: "bg-blue-700 hover:bg-blue-600",
    green: "bg-green-700 hover:bg-green-600",
    red: "bg-red-700 hover:bg-red-600",
    purple: "bg-purple-700 hover:bg-purple-600",
    gray: "bg-gray-600 hover:bg-gray-500",
  };
  const size = small ? "px-2 py-0.5 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded ${size} text-white ${colors[variant]} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {label}
    </button>
  );
}

// ---- Main component ----

export default function GameMaster({ settings }: { settings: Settings }) {
  const [gm, setGm] = useState<GmState>(loadGmState);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [playerState, setPlayerState] = useState<PlayerState | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [stateVersion, setStateVersion] = useState<number | null>(null);
  const [connected, setConnected] = useState(true);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [addPlayerInput, setAddPlayerInput] = useState("");
  const [txResult, setTxResult] = useState<TxResponse | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  // Refs for polling
  const stateVersionRef = useRef(stateVersion);
  stateVersionRef.current = stateVersion;
  const gmRef = useRef(gm);
  gmRef.current = gm;

  const engineUrl = getEngineBaseUrl(settings);
  const clientRef = useRef(
    createEngineClient(engineUrl, settings.gameInstanceId),
  );
  useEffect(() => {
    clientRef.current = createEngineClient(
      engineUrl,
      settings.gameInstanceId,
    );
  }, [engineUrl, settings.gameInstanceId]);

  const updateGm = useCallback((patch: Partial<GmState>) => {
    setGm((prev) => {
      const next = { ...prev, ...patch };
      saveGmState(next);
      return next;
    });
  }, []);

  // ---- Registry management ----

  const addPlayerId = useCallback(
    (id: string) => {
      const trimmed = id.trim();
      if (!trimmed) return;
      setGm((prev) => {
        if (prev.knownPlayerIds.includes(trimmed)) return prev;
        const next = {
          ...prev,
          knownPlayerIds: [...prev.knownPlayerIds, trimmed],
        };
        saveGmState(next);
        return next;
      });
    },
    [],
  );

  const removePlayerId = useCallback((id: string) => {
    setGm((prev) => {
      const next = {
        ...prev,
        knownPlayerIds: prev.knownPlayerIds.filter((p) => p !== id),
        selectedPlayerId:
          prev.selectedPlayerId === id ? "" : prev.selectedPlayerId,
      };
      saveGmState(next);
      return next;
    });
    setPlayerState(null);
    setStats(null);
  }, []);

  const importFromPlayerPage = useCallback(() => {
    try {
      const raw = localStorage.getItem(PLAYER_STORAGE_KEY);
      if (!raw) {
        setError("No player data found in /player localStorage");
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const pid = (parsed["playerId"] as string | undefined) ?? "";
      const key = (parsed["apiKey"] as string | undefined) ?? "";
      if (pid) {
        addPlayerId(pid);
        if (key && !gmRef.current.apiKey) updateGm({ apiKey: key });
      } else {
        setError("No playerId found in /player data");
      }
    } catch {
      setError("Failed to read /player localStorage");
    }
  }, [addPlayerId, updateGm]);

  const importFromAdminSeed = useCallback(() => {
    try {
      // Admin seed writes to the player storage key
      const raw = localStorage.getItem(PLAYER_STORAGE_KEY);
      if (!raw) {
        setError("No seeded data found. Run Seed Demo in /admin first.");
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const pid = (parsed["playerId"] as string | undefined) ?? "";
      const key = (parsed["apiKey"] as string | undefined) ?? "";
      if (pid) {
        addPlayerId(pid);
        if (key && !gmRef.current.apiKey) updateGm({ apiKey: key });
      }
      // Also try admin storage for additional context
      const adminRaw = localStorage.getItem(ADMIN_STORAGE_KEY);
      if (adminRaw) {
        const adminParsed = JSON.parse(adminRaw) as Record<string, unknown>;
        const seedPid =
          (adminParsed["seedPlayerId"] as string | undefined) ?? "";
        if (seedPid && seedPid !== pid) addPlayerId(seedPid);
        const grantPid =
          (adminParsed["grantPlayerId"] as string | undefined) ?? "";
        if (grantPid && grantPid !== pid && grantPid !== seedPid)
          addPlayerId(grantPid);
      }
    } catch {
      setError("Failed to read admin localStorage");
    }
  }, [addPlayerId, updateGm]);

  const clearAll = useCallback(() => {
    if (!window.confirm("Clear all known player IDs?")) return;
    updateGm({
      knownPlayerIds: [],
      selectedPlayerId: "",
      selectedCharacterId: "",
    });
    setPlayerState(null);
    setStats(null);
  }, [updateGm]);

  // ---- Data fetching ----

  const silentRefreshData = useCallback(async () => {
    const g = gmRef.current;
    if (!g.selectedPlayerId || !g.apiKey) return;
    try {
      const state = await clientRef.current.getPlayerState(
        g.selectedPlayerId,
        g.apiKey,
      );
      setPlayerState(state);
      setLastRefreshAt(Date.now());
      setConnected(true);
      if (g.selectedCharacterId) {
        try {
          const s = await clientRef.current.getCharacterStats(
            g.selectedCharacterId,
            g.apiKey,
          );
          setStats(s);
        } catch {
          // silent
        }
      }
    } catch {
      // silent
    }
  }, []);

  const fetchPlayerState = useCallback(async () => {
    const g = gmRef.current;
    if (!g.selectedPlayerId || !g.apiKey) {
      setError("Select a player and set an API key first");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const state = await clientRef.current.getPlayerState(
        g.selectedPlayerId,
        g.apiKey,
      );
      setPlayerState(state);
      setLastRefreshAt(Date.now());
      setConnected(true);
      try {
        const sv = await clientRef.current.getStateVersion();
        setStateVersion(sv.stateVersion);
      } catch {
        // nice to have
      }
    } catch (err) {
      setError(formatError(err));
      setConnected(false);
    } finally {
      setPending(false);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const cfg = await clientRef.current.getConfig();
      setConfig(cfg);
      setConnected(true);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setPending(false);
    }
  }, []);

  const fetchStats = useCallback(async (charId: string) => {
    if (!gmRef.current.apiKey) return;
    setPending(true);
    setError(null);
    try {
      const s = await clientRef.current.getCharacterStats(
        charId,
        gmRef.current.apiKey,
      );
      setStats(s);
    } catch (err) {
      setError(formatError(err));
      setStats(null);
    } finally {
      setPending(false);
    }
  }, []);

  // Auto-fetch stats on character change
  useEffect(() => {
    if (gm.selectedCharacterId && playerState) {
      void fetchStats(gm.selectedCharacterId);
    } else {
      setStats(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gm.selectedCharacterId]);

  // Fetch player state on player selection change
  useEffect(() => {
    setPlayerState(null);
    setStats(null);
    updateGm({ selectedCharacterId: "" });
    if (gm.selectedPlayerId && gm.apiKey) {
      void fetchPlayerState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gm.selectedPlayerId]);

  // ---- stateVersion polling ----
  useEffect(() => {
    if (!gm.autoRefresh) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let failCount = 0;

    const poll = async () => {
      if (cancelled) return;
      try {
        const sv = await clientRef.current.getStateVersion();
        setConnected(true);
        failCount = 0;
        if (
          stateVersionRef.current !== null &&
          sv.stateVersion !== stateVersionRef.current
        ) {
          setStateVersion(sv.stateVersion);
          await silentRefreshData();
        } else if (stateVersionRef.current === null) {
          setStateVersion(sv.stateVersion);
        }
      } catch {
        failCount += 1;
        setConnected(false);
      }
      if (!cancelled) {
        const delay = failCount > 0 ? 3000 : 1500;
        timeoutId = setTimeout(() => void poll(), delay);
      }
    };

    timeoutId = setTimeout(() => void poll(), 1500);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [gm.autoRefresh, silentRefreshData]);

  // ---- Tx Builder ----
  const sendTx = useCallback(async () => {
    setPending(true);
    setTxError(null);
    setTxResult(null);
    let tx: TransactionRequest;
    try {
      tx = JSON.parse(gmRef.current.txBuilderJson) as TransactionRequest;
    } catch {
      setTxError("Invalid JSON");
      setPending(false);
      return;
    }
    if (!tx.txId) tx.txId = nextTxId();
    if (!tx.gameInstanceId) tx.gameInstanceId = settings.gameInstanceId;
    try {
      const res = await clientRef.current.postTx(tx, {
        apiKey: gmRef.current.apiKey,
      });
      setTxResult(res);
      if (res.accepted) {
        setStateVersion(res.stateVersion);
        if (gmRef.current.selectedPlayerId) {
          await silentRefreshData();
        }
      }
    } catch (err) {
      setTxError(formatError(err));
    } finally {
      setPending(false);
    }
  }, [settings.gameInstanceId, silentRefreshData]);

  // ---- Derived data ----

  const characters = playerState?.characters ?? {};
  const gear = playerState?.gear ?? {};
  const resources = playerState?.resources ?? {};
  const selectedChar = gm.selectedCharacterId
    ? characters[gm.selectedCharacterId]
    : null;
  const slots = config?.slots ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Error banner */}
      {error && (
        <div className="rounded bg-red-900/50 border border-red-700 px-3 py-2 text-sm text-red-300 mx-4 mt-3">
          {error}
          <button
            onClick={() => setError(null)}
            className="float-right text-red-400 hover:text-red-200 font-bold"
          >
            X
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 flex-1 min-h-0 overflow-auto">
        {/* ============ Left: Registry + Selector ============ */}
        <div className="space-y-3">
          {/* API Key */}
          <div className="rounded-lg bg-gray-800 p-4 space-y-2">
            <h2 className="text-lg font-semibold text-white">
              Game Master
            </h2>
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                API Key (to inspect players)
              </label>
              <input
                className="w-full rounded bg-gray-700 px-2 py-1 text-sm text-white border border-gray-600 focus:border-blue-500 focus:outline-none font-mono"
                value={gm.apiKey}
                onChange={(e) => updateGm({ apiKey: e.target.value })}
                placeholder="Bearer token (actor key that owns players)"
              />
            </div>
          </div>

          {/* Connection + auto-refresh */}
          <div className="rounded-lg bg-gray-800 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-500 animate-pulse"}`}
                />
                <span className="text-xs text-gray-400">
                  {connected ? "Connected" : "Disconnected"}
                </span>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gm.autoRefresh}
                  onChange={(e) =>
                    updateGm({ autoRefresh: e.target.checked })
                  }
                  className="rounded w-3 h-3"
                />
                Auto-refresh
              </label>
            </div>
            <div className="text-xs text-gray-500 space-y-0.5">
              <p>
                Engine:{" "}
                <span className="text-gray-300 font-mono">
                  {engineUrl}
                </span>
                {settings.useProxy && <span className="text-blue-400 ml-1">(proxy)</span>}
              </p>
              <p>
                Instance:{" "}
                <span className="text-gray-300 font-mono">
                  {settings.gameInstanceId}
                </span>
              </p>
              {stateVersion !== null && (
                <p>
                  Version:{" "}
                  <span className="text-white font-mono">{stateVersion}</span>
                </p>
              )}
              {lastRefreshAt && (
                <p>
                  Last refresh:{" "}
                  <span className="text-gray-300">
                    {timeAgo(lastRefreshAt)}
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* Known Players Registry */}
          <div className="rounded-lg bg-gray-800 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-300">
              Known Players
            </h3>

            {/* Add manually */}
            <div className="flex gap-2">
              <input
                className="flex-1 rounded bg-gray-700 px-2 py-1 text-sm text-white border border-gray-600 focus:border-blue-500 focus:outline-none font-mono"
                value={addPlayerInput}
                onChange={(e) => setAddPlayerInput(e.target.value)}
                placeholder="player_id"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    addPlayerId(addPlayerInput);
                    setAddPlayerInput("");
                  }
                }}
              />
              <Btn
                label="Add"
                onClick={() => {
                  addPlayerId(addPlayerInput);
                  setAddPlayerInput("");
                }}
                disabled={!addPlayerInput.trim()}
                variant="green"
                small
              />
            </div>

            {/* Import buttons */}
            <div className="flex flex-wrap gap-2">
              <Btn
                label="Import from /player"
                onClick={importFromPlayerPage}
                small
                variant="blue"
              />
              <Btn
                label="Import from Admin seed"
                onClick={importFromAdminSeed}
                small
                variant="purple"
              />
              {gm.knownPlayerIds.length > 0 && (
                <Btn
                  label="Clear all"
                  onClick={clearAll}
                  small
                  variant="red"
                />
              )}
            </div>

            {/* Player list */}
            {gm.knownPlayerIds.length === 0 ? (
              <p className="text-xs text-gray-500 italic">
                No known players. Add manually or import.
              </p>
            ) : (
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {gm.knownPlayerIds.map((pid) => (
                  <div
                    key={pid}
                    className={`flex items-center justify-between rounded px-2 py-1 text-sm ${
                      gm.selectedPlayerId === pid
                        ? "bg-blue-700 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    <button
                      className="flex-1 text-left font-mono"
                      onClick={() => updateGm({ selectedPlayerId: pid })}
                    >
                      {pid}
                    </button>
                    <button
                      onClick={() => removePlayerId(pid)}
                      className="text-gray-500 hover:text-red-400 text-xs ml-2 px-1"
                      title="Remove"
                    >
                      X
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tx Builder Lite */}
          <div className="rounded-lg bg-gray-800 p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-300">
              Tx Builder
            </h3>
            <p className="text-[10px] text-gray-500">
              Raw JSON transaction. txId and gameInstanceId auto-filled if
              empty.
            </p>
            <textarea
              className="w-full rounded bg-gray-700 px-2 py-1 text-xs text-white border border-gray-600 focus:border-blue-500 focus:outline-none font-mono resize-y h-28"
              value={gm.txBuilderJson}
              onChange={(e) => updateGm({ txBuilderJson: e.target.value })}
              spellCheck={false}
            />
            <div className="flex gap-2">
              <Btn
                label="Send Tx"
                onClick={() => void sendTx()}
                disabled={pending}
                variant="green"
              />
              <Btn
                label="Load Config"
                onClick={() => void fetchConfig()}
                disabled={pending}
                variant="gray"
                small
              />
            </div>
            {txError && (
              <div className="rounded bg-red-900/50 border border-red-700 px-2 py-1 text-xs text-red-300">
                {txError}
              </div>
            )}
            {txResult && (
              <pre className="bg-gray-950 rounded p-2 text-xs text-green-400 font-mono overflow-x-auto max-h-[120px] overflow-y-auto whitespace-pre-wrap">
                {JSON.stringify(txResult, null, 2)}
              </pre>
            )}
          </div>
        </div>

        {/* ============ Right: Inspector ============ */}
        <div className="space-y-3">
          {!gm.selectedPlayerId ? (
            <div className="rounded-lg bg-gray-800 p-6 text-center">
              <p className="text-gray-500 text-sm">
                Select a player from the registry to inspect.
              </p>
            </div>
          ) : (
            <>
              {/* Player header + actions */}
              <div className="rounded-lg bg-gray-800 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">
                    <span className="text-gray-400 text-sm font-normal mr-1">
                      Player:
                    </span>
                    <span className="font-mono">{gm.selectedPlayerId}</span>
                  </h2>
                  <div className="flex gap-2">
                    <Btn
                      label="Refresh"
                      onClick={() => void fetchPlayerState()}
                      disabled={pending}
                      small
                    />
                    <Btn
                      label={gm.jsonView ? "Summary" : "JSON"}
                      onClick={() => updateGm({ jsonView: !gm.jsonView })}
                      small
                      variant="gray"
                    />
                  </div>
                </div>
              </div>

              {/* Player data */}
              {!playerState ? (
                <div className="rounded-lg bg-gray-800 p-4">
                  <p className="text-xs text-gray-500 italic">
                    {pending
                      ? "Loading..."
                      : "No data. Press Refresh or set API key."}
                  </p>
                </div>
              ) : gm.jsonView ? (
                /* JSON view */
                <div className="rounded-lg bg-gray-800 p-4">
                  <h3 className="text-sm font-semibold text-gray-300 mb-2">
                    Raw Player State
                  </h3>
                  <pre className="bg-gray-950 rounded p-3 text-xs text-green-400 font-mono overflow-x-auto max-h-[500px] overflow-y-auto whitespace-pre-wrap">
                    {JSON.stringify(playerState, null, 2)}
                  </pre>
                </div>
              ) : (
                <>
                  {/* Summary view */}
                  {/* Resources */}
                  <div className="rounded-lg bg-gray-800 p-4 space-y-2">
                    <h3 className="text-sm font-semibold text-gray-300">
                      Resources
                    </h3>
                    {Object.keys(resources).length > 0 ? (
                      <table className="w-full text-xs">
                        <tbody>
                          {Object.entries(resources).map(([k, v]) => (
                            <tr
                              key={k}
                              className="border-b border-gray-700/50"
                            >
                              <td className="py-0.5 text-gray-400">{k}</td>
                              <td className="py-0.5 text-right text-yellow-300 font-mono font-semibold">
                                {v}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-xs text-gray-600 italic">
                        No resources
                      </p>
                    )}
                  </div>

                  {/* Overview counts */}
                  <div className="rounded-lg bg-gray-800 p-4">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded bg-gray-700/50 p-2 text-center">
                        <div className="text-2xl font-bold text-white">
                          {Object.keys(characters).length}
                        </div>
                        <div className="text-gray-400">Characters</div>
                      </div>
                      <div className="rounded bg-gray-700/50 p-2 text-center">
                        <div className="text-2xl font-bold text-white">
                          {Object.keys(gear).length}
                        </div>
                        <div className="text-gray-400">Gear</div>
                      </div>
                    </div>
                  </div>

                  {/* Character list */}
                  <div className="rounded-lg bg-gray-800 p-4 space-y-2">
                    <h3 className="text-sm font-semibold text-gray-300">
                      Characters
                    </h3>
                    {/* Direct character ID input */}
                    <div className="flex gap-2">
                      <input
                        className="flex-1 rounded bg-gray-700 px-2 py-0.5 text-xs text-white border border-gray-600 focus:border-blue-500 focus:outline-none font-mono"
                        value={gm.selectedCharacterId}
                        onChange={(e) =>
                          updateGm({ selectedCharacterId: e.target.value })
                        }
                        placeholder="character_id (direct input)"
                      />
                      <Btn
                        label="Inspect"
                        onClick={() => {
                          if (gm.selectedCharacterId)
                            void fetchStats(gm.selectedCharacterId);
                        }}
                        disabled={pending || !gm.selectedCharacterId}
                        small
                        variant="purple"
                      />
                    </div>
                    {Object.keys(characters).length === 0 ? (
                      <p className="text-xs text-gray-500 italic">
                        No characters
                      </p>
                    ) : (
                      <div className="space-y-1 max-h-[180px] overflow-y-auto">
                        {Object.entries(characters).map(([charId, char]) => (
                          <button
                            key={charId}
                            onClick={() =>
                              updateGm({ selectedCharacterId: charId })
                            }
                            className={`w-full text-left rounded px-2 py-1 text-sm ${
                              gm.selectedCharacterId === charId
                                ? "bg-blue-700 text-white"
                                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                            }`}
                          >
                            <span className="font-mono">{charId}</span>
                            <span className="text-xs text-gray-400 ml-2">
                              {char.classId} Lv{char.level}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Character Inspector */}
                  {(stats || selectedChar) && (
                    <div className="rounded-lg bg-gray-800 p-4 space-y-3">
                      <h3 className="text-sm font-semibold text-gray-300">
                        Character —{" "}
                        <span className="font-mono text-blue-400">
                          {gm.selectedCharacterId}
                        </span>
                      </h3>

                      {selectedChar && (
                        <div className="text-xs text-gray-500 space-y-0.5">
                          <p>
                            Class:{" "}
                            <span className="text-gray-300">
                              {selectedChar.classId}
                            </span>
                          </p>
                          <p>
                            Level:{" "}
                            <span className="text-gray-300">
                              {selectedChar.level}
                            </span>
                          </p>
                        </div>
                      )}

                      {/* Slot grid */}
                      {selectedChar && slots.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs text-gray-400 font-semibold">
                            Equipped:
                          </p>
                          {slots.map((slot) => {
                            const eqId = selectedChar.equipped[slot];
                            const hasGear = eqId != null;
                            const g = hasGear ? gear[eqId] : null;
                            return (
                              <div
                                key={slot}
                                className={`rounded px-2 py-0.5 text-xs flex justify-between ${
                                  hasGear
                                    ? "bg-gray-600 text-white"
                                    : "bg-gray-700/50 text-gray-500"
                                }`}
                              >
                                <span className="text-gray-400">{slot}</span>
                                <span className="font-mono">
                                  {hasGear ? (
                                    <>
                                      {eqId}
                                      {g && (
                                        <span className="text-gray-400 ml-1">
                                          {g.gearDefId} Lv{g.level}
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    "empty"
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Character Resources */}
                      {selectedChar && Object.keys(selectedChar.resources ?? {}).length > 0 && (
                        <div className="space-y-1 border-t border-gray-700 pt-2">
                          <p className="text-xs text-gray-400 font-semibold">
                            Character Resources:
                          </p>
                          <table className="w-full text-xs">
                            <tbody>
                              {Object.entries(selectedChar.resources ?? {}).map(
                                ([k, v]) => (
                                  <tr
                                    key={k}
                                    className="border-b border-gray-700/50"
                                  >
                                    <td className="py-0.5 text-gray-400">{k}</td>
                                    <td className="py-0.5 text-right text-cyan-300 font-mono font-semibold">
                                      {v}
                                    </td>
                                  </tr>
                                ),
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Stats */}
                      {stats && (
                        <div className="space-y-2 border-t border-gray-700 pt-2">
                          <p className="text-xs text-gray-400 font-semibold">
                            Final Stats:
                          </p>
                          <div className="grid grid-cols-2 gap-1 text-xs">
                            {Object.entries(stats.finalStats).map(
                              ([stat, val]) => (
                                <div
                                  key={stat}
                                  className="flex justify-between"
                                >
                                  <span className="text-gray-400">
                                    {stat}
                                  </span>
                                  <span className="text-cyan-300 font-mono">
                                    {val}
                                  </span>
                                </div>
                              ),
                            )}
                          </div>
                          <Btn
                            label="Refresh Stats"
                            onClick={() =>
                              void fetchStats(gm.selectedCharacterId)
                            }
                            disabled={pending}
                            small
                            variant="purple"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Gear summary table */}
                  {Object.keys(gear).length > 0 && (
                    <div className="rounded-lg bg-gray-800 p-4 space-y-2">
                      <h3 className="text-sm font-semibold text-gray-300">
                        Gear Inventory
                      </h3>
                      <div className="space-y-1 max-h-[200px] overflow-y-auto">
                        {Object.entries(gear).map(([gearId, g]) => (
                          <div
                            key={gearId}
                            className="rounded bg-gray-700 px-2 py-1 text-xs flex justify-between items-center"
                          >
                            <span className="font-mono text-gray-300">
                              {gearId}
                            </span>
                            <span className="text-gray-400">
                              {g.gearDefId} Lv{g.level}
                              {g.equippedBy && (
                                <span className="text-yellow-400 ml-1">
                                  on {g.equippedBy}
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
