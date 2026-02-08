import { useState, useCallback, useEffect, useRef } from "react";
import { createEngineClient, getEngineBaseUrl, EngineClientError } from "../lib/engineClient.ts";
import type { Settings } from "../lib/useSettings.ts";
import type {
  TransactionRequest,
  PlayerState,
  GameConfig,
  StatsResponse,
  GearDef,
} from "../lib/types.ts";

// ---- localStorage helpers ----

const PLAYER_STORAGE_KEY = "gameng-sandbox-player-inputs";

interface PlayerInputs {
  playerId: string;
  apiKey: string;
  selectedCharacterId: string;
  selectedGearId: string;
  swapMode: boolean;
  autoRefresh: boolean;
  newCharacterClassId: string;
  newCharacterId: string;
  newGearDefId: string;
  newGearId: string;
}

const INPUT_DEFAULTS: PlayerInputs = {
  playerId: "player_1",
  apiKey: "",
  selectedCharacterId: "",
  selectedGearId: "",
  swapMode: false,
  autoRefresh: true,
  newCharacterClassId: "",
  newCharacterId: "",
  newGearDefId: "",
  newGearId: "",
};

function loadInputs(): PlayerInputs {
  try {
    const raw = localStorage.getItem(PLAYER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        ...INPUT_DEFAULTS,
        ...parsed,
        // Backward compat with old format
        ...(parsed["characterId"] && !parsed["newCharacterId"]
          ? { newCharacterId: parsed["characterId"] as string }
          : {}),
        ...(parsed["classId"] && !parsed["newCharacterClassId"]
          ? { newCharacterClassId: parsed["classId"] as string }
          : {}),
      };
    }
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
function nextTxId(prefix = "ui_tx"): string {
  txCounter += 1;
  return `${prefix}_${Date.now()}_${String(txCounter)}`;
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

// ---- Activity feed entry ----

interface ActivityEntry {
  ts: number;
  type: string;
  accepted: boolean;
  errorCode?: string;
}

const MAX_ACTIVITY = 5;

// ---- Sub-components ----

function InputField({
  label,
  value,
  onChange,
  placeholder,
}: {
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

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <select
        className="w-full rounded bg-gray-700 px-2 py-1 text-sm text-white border border-gray-600 focus:border-blue-500 focus:outline-none font-mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder ?? "-- select --"}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

function Btn({
  label,
  onClick,
  disabled,
  variant = "blue",
  small,
  className: extraClass,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "blue" | "green" | "red" | "purple" | "gray" | "yellow";
  small?: boolean;
  className?: string;
}) {
  const colors: Record<string, string> = {
    blue: "bg-blue-700 hover:bg-blue-600",
    green: "bg-green-700 hover:bg-green-600",
    red: "bg-red-700 hover:bg-red-600",
    purple: "bg-purple-700 hover:bg-purple-600",
    gray: "bg-gray-600 hover:bg-gray-500",
    yellow: "bg-yellow-700 hover:bg-yellow-600",
  };
  const size = small ? "px-2 py-0.5 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded ${size} text-white ${colors[variant]} disabled:opacity-40 disabled:cursor-not-allowed ${extraClass ?? ""}`}
    >
      {label}
    </button>
  );
}

function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="rounded-lg bg-gray-800 p-3 space-y-1">
      <h3 className="text-xs font-semibold text-gray-400 mb-1">
        Activity
      </h3>
      {entries.map((e, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className={e.accepted ? "text-green-400" : "text-red-400"}>
            {e.accepted ? "\u2713" : "\u2717"}
          </span>
          <span className="text-gray-300 font-mono">{e.type}</span>
          {e.errorCode && (
            <span className="text-red-400 text-[10px]">{e.errorCode}</span>
          )}
          <span className="text-gray-600 ml-auto text-[10px]">
            {timeAgo(e.ts)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---- Main component ----

export default function PlayerView({ settings }: { settings: Settings }) {
  const [inputs, setInputs] = useState<PlayerInputs>(loadInputs);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [playerState, setPlayerState] = useState<PlayerState | null>(null);
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [stateVersion, setStateVersion] = useState<number | null>(null);
  const [selectedPatternIdx, setSelectedPatternIdx] = useState(0);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [connected, setConnected] = useState(true);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);

  // Refs for polling to avoid stale closures
  const stateVersionRef = useRef(stateVersion);
  stateVersionRef.current = stateVersion;
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const playerStateRef = useRef(playerState);
  playerStateRef.current = playerState;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const updateInput = useCallback((patch: Partial<PlayerInputs>) => {
    setInputs((prev) => {
      const next = { ...prev, ...patch };
      saveInputs(next);
      return next;
    });
  }, []);

  const addActivity = useCallback(
    (type: string, accepted: boolean, errorCode?: string) => {
      setActivity((prev) => {
        const next = [{ ts: Date.now(), type, accepted, errorCode }, ...prev];
        return next.slice(0, MAX_ACTIVITY);
      });
    },
    [],
  );

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

  // ---- Silent data fetchers (no pending/error for polling) ----
  const silentRefreshData = useCallback(async () => {
    const inp = inputsRef.current;
    if (!inp.playerId || !inp.apiKey) return;
    try {
      const state = await clientRef.current.getPlayerState(
        inp.playerId,
        inp.apiKey,
      );
      setPlayerState(state);
      setLastRefreshAt(Date.now());
      setConnected(true);
      // Also refresh stats if a character is selected
      if (inp.selectedCharacterId) {
        try {
          const s = await clientRef.current.getCharacterStats(
            inp.selectedCharacterId,
            inp.apiKey,
          );
          setStats(s);
        } catch {
          // stats fetch can fail silently
        }
      }
    } catch {
      // Don't set error for silent refresh
    }
  }, []);

  // ---- stateVersion polling ----
  useEffect(() => {
    if (!inputs.autoRefresh) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let failCount = 0;

    const poll = async () => {
      if (cancelled) return;
      try {
        const sv = await clientRef.current.getStateVersion();
        setConnected(true);
        failCount = 0;
        // If version changed, refresh data
        if (
          stateVersionRef.current !== null &&
          sv.stateVersion !== stateVersionRef.current
        ) {
          setStateVersion(sv.stateVersion);
          await silentRefreshData();
        } else if (stateVersionRef.current === null) {
          // First poll — just store version
          setStateVersion(sv.stateVersion);
        }
      } catch {
        failCount += 1;
        setConnected(false);
      }
      if (!cancelled) {
        const delay = failCount > 0 ? 3000 : 1000;
        timeoutId = setTimeout(() => void poll(), delay);
      }
    };

    timeoutId = setTimeout(() => void poll(), 1000);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [inputs.autoRefresh, silentRefreshData]);

  // ---- Manual refresh ----
  const refreshState = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const state = await clientRef.current.getPlayerState(
        inputsRef.current.playerId,
        inputsRef.current.apiKey,
      );
      setPlayerState(state);
      setLastRefreshAt(Date.now());
      setConnected(true);
      try {
        const sv = await clientRef.current.getStateVersion();
        setStateVersion(sv.stateVersion);
      } catch {
        // nice-to-have
      }
    } catch (err) {
      setError(formatError(err));
      setConnected(false);
    } finally {
      setPending(false);
    }
  }, []);

  // ---- Load config ----
  const loadConfig = useCallback(async () => {
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

  // ---- Fetch stats for selected character ----
  const fetchStats = useCallback(async () => {
    const charId = inputsRef.current.selectedCharacterId;
    if (!charId) return;
    setPending(true);
    setError(null);
    try {
      const s = await clientRef.current.getCharacterStats(
        charId,
        inputsRef.current.apiKey,
      );
      setStats(s);
    } catch (err) {
      setError(formatError(err));
      setStats(null);
    } finally {
      setPending(false);
    }
  }, []);

  // Auto-load config on mount (and when engine URL changes)
  useEffect(() => {
    void loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineUrl, settings.gameInstanceId]);

  // Auto-fetch stats when character selection changes
  useEffect(() => {
    if (inputs.selectedCharacterId && playerState) {
      void fetchStats();
    } else {
      setStats(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs.selectedCharacterId]);

  // ---- TX helper: post, refresh, add to activity ----
  const postTxAndRefresh = async (tx: TransactionRequest) => {
    setPending(true);
    setError(null);
    try {
      const res = await clientRef.current.postTx(tx, {
        apiKey: inputsRef.current.apiKey,
      });
      addActivity(tx.type, res.accepted, res.errorCode);
      if (res.accepted) {
        setStateVersion(res.stateVersion);
        // Refresh state + stats
        try {
          const state = await clientRef.current.getPlayerState(
            inputsRef.current.playerId,
            inputsRef.current.apiKey,
          );
          setPlayerState(state);
          setLastRefreshAt(Date.now());
        } catch {
          // ignore
        }
        if (inputsRef.current.selectedCharacterId) {
          try {
            const s = await clientRef.current.getCharacterStats(
              inputsRef.current.selectedCharacterId,
              inputsRef.current.apiKey,
            );
            setStats(s);
          } catch {
            // ignore
          }
        }
      } else {
        setError(
          res.errorCode
            ? `${res.errorCode}: ${res.errorMessage ?? "rejected"}`
            : "Transaction rejected",
        );
      }
    } catch (err) {
      addActivity(tx.type, false, "NETWORK");
      setError(formatError(err));
    } finally {
      setPending(false);
    }
  };

  // ---- Actions ----

  const doCreatePlayer = () =>
    void postTxAndRefresh({
      txId: nextTxId("cp"),
      type: "CreatePlayer",
      gameInstanceId: settings.gameInstanceId,
      playerId: inputs.playerId,
    });

  const doCreateCharacter = () => {
    const charId =
      inputs.newCharacterId.trim() ||
      `char_${Date.now()}_${String(Math.floor(Math.random() * 1000))}`;
    if (!inputs.newCharacterClassId) {
      setError("Select a class first");
      return;
    }
    void postTxAndRefresh({
      txId: nextTxId("cc"),
      type: "CreateCharacter",
      gameInstanceId: settings.gameInstanceId,
      playerId: inputs.playerId,
      characterId: charId,
      classId: inputs.newCharacterClassId,
    });
  };

  const doCreateGear = () => {
    const gearId =
      inputs.newGearId.trim() ||
      `gear_${Date.now()}_${String(Math.floor(Math.random() * 1000))}`;
    if (!inputs.newGearDefId) {
      setError("Select a gear definition first");
      return;
    }
    void postTxAndRefresh({
      txId: nextTxId("cg"),
      type: "CreateGear",
      gameInstanceId: settings.gameInstanceId,
      playerId: inputs.playerId,
      gearId,
      gearDefId: inputs.newGearDefId,
    });
  };

  const doEquip = () => {
    if (!inputs.selectedCharacterId || !inputs.selectedGearId) return;
    const gearInst = playerState?.gear[inputs.selectedGearId];
    const gearDef: GearDef | undefined = gearInst
      ? config?.gearDefs[gearInst.gearDefId]
      : undefined;
    const eqPatterns = gearDef?.equipPatterns ?? [];
    const pattern = eqPatterns[selectedPatternIdx] ?? eqPatterns[0];

    void postTxAndRefresh({
      txId: nextTxId("eq"),
      type: "EquipGear",
      gameInstanceId: settings.gameInstanceId,
      playerId: inputs.playerId,
      characterId: inputs.selectedCharacterId,
      gearId: inputs.selectedGearId,
      slotPattern: pattern,
      swap: inputs.swapMode || undefined,
    });
  };

  const doUnequip = () => {
    if (!inputs.selectedGearId) return;
    void postTxAndRefresh({
      txId: nextTxId("uq"),
      type: "UnequipGear",
      gameInstanceId: settings.gameInstanceId,
      playerId: inputs.playerId,
      gearId: inputs.selectedGearId,
    });
  };

  const doLevelUpCharacter = () => {
    if (!inputs.selectedCharacterId) return;
    void postTxAndRefresh({
      txId: nextTxId("luc"),
      type: "LevelUpCharacter",
      gameInstanceId: settings.gameInstanceId,
      playerId: inputs.playerId,
      characterId: inputs.selectedCharacterId,
    });
  };

  const doLevelUpGear = () => {
    if (!inputs.selectedGearId) return;
    void postTxAndRefresh({
      txId: nextTxId("lug"),
      type: "LevelUpGear",
      gameInstanceId: settings.gameInstanceId,
      playerId: inputs.playerId,
      gearId: inputs.selectedGearId,
    });
  };

  // ---- Derived data ----

  const classIds = config ? Object.keys(config.classes) : [];
  const gearDefIds = config ? Object.keys(config.gearDefs) : [];
  const characters = playerState?.characters ?? {};
  const gear = playerState?.gear ?? {};
  const resources = playerState?.resources ?? {};
  const selectedChar = inputs.selectedCharacterId
    ? characters[inputs.selectedCharacterId]
    : null;
  const selectedGearInst = inputs.selectedGearId
    ? gear[inputs.selectedGearId]
    : null;
  const selectedGearDef: GearDef | undefined =
    selectedGearInst && config
      ? config.gearDefs[selectedGearInst.gearDefId]
      : undefined;
  const patterns = selectedGearDef?.equipPatterns ?? [];
  const slots = config?.slots ?? [];
  const isGearEquipped = selectedGearInst?.equippedBy != null;
  const maxLevel = config?.maxLevel ?? 999;

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 flex-1 min-h-0 overflow-auto">
        {/* ============ Column A: Player ============ */}
        <div className="space-y-3">
          <div className="rounded-lg bg-gray-800 p-4 space-y-3">
            <h2 className="text-lg font-semibold text-white">Player</h2>
            <InputField
              label="Player ID"
              value={inputs.playerId}
              onChange={(v) => updateInput({ playerId: v })}
            />
            <InputField
              label="API Key"
              value={inputs.apiKey}
              onChange={(v) => updateInput({ apiKey: v })}
              placeholder="Bearer token"
            />
            <div className="flex flex-wrap gap-2">
              <Btn
                label="CreatePlayer"
                onClick={doCreatePlayer}
                disabled={pending}
                variant="green"
              />
              <Btn
                label="Refresh State"
                onClick={() => void refreshState()}
                disabled={pending}
              />
              <Btn
                label="Reload Config"
                onClick={() => void loadConfig()}
                disabled={pending}
                variant="gray"
              />
            </div>
          </div>

          {/* Connection + version + auto-refresh */}
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
                  checked={inputs.autoRefresh}
                  onChange={(e) =>
                    updateInput({ autoRefresh: e.target.checked })
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
              {config && (
                <p>
                  Config:{" "}
                  <span className="text-gray-300 font-mono">
                    {config.gameConfigId}
                  </span>
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

          {/* Player Resources */}
          <div className="rounded-lg bg-gray-800 p-3">
            <h3 className="text-sm font-semibold text-gray-300 mb-2">
              Player Resources
            </h3>
            {playerState && Object.keys(resources).length > 0 ? (
              <table className="w-full text-xs">
                <tbody>
                  {Object.entries(resources).map(([k, v]) => (
                    <tr key={k} className="border-b border-gray-700/50">
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
                {playerState ? "No player resources" : "Refresh state to load"}
              </p>
            )}
          </div>

          {/* Character Resources (shown when character selected) */}
          {selectedChar && (
            <div className="rounded-lg bg-gray-800 p-3">
              <h3 className="text-sm font-semibold text-gray-300 mb-2">
                Character Resources
                <span className="text-xs text-gray-500 font-normal ml-1">
                  ({inputs.selectedCharacterId})
                </span>
              </h3>
              {Object.keys(selectedChar.resources ?? {}).length > 0 ? (
                <table className="w-full text-xs">
                  <tbody>
                    {Object.entries(selectedChar.resources ?? {}).map(([k, v]) => (
                      <tr key={k} className="border-b border-gray-700/50">
                        <td className="py-0.5 text-gray-400">{k}</td>
                        <td className="py-0.5 text-right text-cyan-300 font-mono font-semibold">
                          {v}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-gray-600 italic">No character resources</p>
              )}
            </div>
          )}

          {/* Activity feed */}
          <ActivityFeed entries={activity} />
        </div>

        {/* ============ Column B: Characters ============ */}
        <div className="space-y-3">
          {/* Character list */}
          <div className="rounded-lg bg-gray-800 p-4 space-y-2">
            <h2 className="text-lg font-semibold text-white">Characters</h2>
            {Object.keys(characters).length === 0 && (
              <p className="text-xs text-gray-500 italic">
                No characters. Refresh State first.
              </p>
            )}
            <div className="space-y-1 max-h-[150px] overflow-y-auto">
              {Object.entries(characters).map(([charId, char]) => (
                <button
                  key={charId}
                  onClick={() => updateInput({ selectedCharacterId: charId })}
                  className={`w-full text-left rounded px-2 py-1 text-sm ${
                    inputs.selectedCharacterId === charId
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
          </div>

          {/* Create character form */}
          <div className="rounded-lg bg-gray-800 p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-300">
              Create Character
            </h3>
            <InputField
              label="Character ID (optional)"
              value={inputs.newCharacterId}
              onChange={(v) => updateInput({ newCharacterId: v })}
              placeholder="auto-generated if empty"
            />
            <SelectField
              label="Class"
              value={inputs.newCharacterClassId}
              onChange={(v) => updateInput({ newCharacterClassId: v })}
              options={classIds}
              placeholder={
                classIds.length > 0
                  ? "-- select class --"
                  : "Load config first"
              }
            />
            <Btn
              label="Create"
              onClick={doCreateCharacter}
              disabled={pending || !inputs.newCharacterClassId}
              variant="green"
              small
            />
          </div>

          {/* Slot grid */}
          {selectedChar && (
            <div className="rounded-lg bg-gray-800 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-gray-300">
                Slots —{" "}
                <span className="font-mono text-blue-400">
                  {inputs.selectedCharacterId}
                </span>
              </h3>
              <div className="space-y-1">
                {slots.map((slot) => {
                  const equippedGearId = selectedChar.equipped[slot];
                  const hasGear = equippedGearId != null;
                  const eqGear = hasGear ? gear[equippedGearId] : null;
                  return (
                    <button
                      key={slot}
                      onClick={() => {
                        if (hasGear)
                          updateInput({ selectedGearId: equippedGearId });
                      }}
                      className={`w-full text-left rounded px-2 py-1 text-xs flex justify-between items-center ${
                        hasGear
                          ? "bg-gray-600 text-white hover:bg-gray-500 cursor-pointer"
                          : "bg-gray-700/50 text-gray-500 cursor-default"
                      }`}
                    >
                      <span className="text-gray-400">{slot}</span>
                      <span className="font-mono">
                        {hasGear ? (
                          <>
                            {equippedGearId}
                            {eqGear && (
                              <span className="text-gray-400 ml-1">
                                Lv{eqGear.level}
                              </span>
                            )}
                          </>
                        ) : (
                          "empty"
                        )}
                      </span>
                    </button>
                  );
                })}
                {slots.length === 0 && (
                  <p className="text-xs text-gray-500 italic">
                    No slots. Load config.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Stats + Progression */}
          {selectedChar && (
            <div className="rounded-lg bg-gray-800 p-4 space-y-3">
              {/* Stats */}
              {stats && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-gray-300">
                    Stats —{" "}
                    <span className="font-mono text-blue-400">
                      {stats.characterId}
                    </span>
                  </h3>
                  <p className="text-xs text-gray-500">
                    {stats.classId} Lv{stats.level}
                  </p>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    {Object.entries(stats.finalStats).map(([stat, val]) => (
                      <div key={stat} className="flex justify-between">
                        <span className="text-gray-400">{stat}</span>
                        <span className="text-cyan-300 font-mono">{val}</span>
                      </div>
                    ))}
                  </div>
                  <Btn
                    label="Refresh Stats"
                    onClick={() => void fetchStats()}
                    disabled={pending}
                    small
                    variant="purple"
                  />
                </div>
              )}

              {/* Progression */}
              <div className="border-t border-gray-700 pt-3 space-y-2">
                <h3 className="text-sm font-semibold text-gray-300">
                  Progression
                </h3>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-gray-400">
                    <span className="text-gray-300 font-mono">
                      {inputs.selectedCharacterId}
                    </span>
                    {" — "}
                    Lv{selectedChar.level}
                    {selectedChar.level >= maxLevel && (
                      <span className="text-yellow-400 ml-1">(MAX)</span>
                    )}
                  </div>
                  <Btn
                    label="Level Up Char"
                    onClick={doLevelUpCharacter}
                    disabled={
                      pending ||
                      !inputs.selectedCharacterId ||
                      selectedChar.level >= maxLevel
                    }
                    variant="yellow"
                    small
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ============ Column C: Gear ============ */}
        <div className="space-y-3">
          {/* Gear list */}
          <div className="rounded-lg bg-gray-800 p-4 space-y-2">
            <h2 className="text-lg font-semibold text-white">Gear</h2>
            {Object.keys(gear).length === 0 && (
              <p className="text-xs text-gray-500 italic">
                No gear. Refresh State first.
              </p>
            )}
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {Object.entries(gear).map(([gearId, g]) => (
                <button
                  key={gearId}
                  onClick={() => {
                    updateInput({ selectedGearId: gearId });
                    setSelectedPatternIdx(0);
                  }}
                  className={`w-full text-left rounded px-2 py-1 text-sm ${
                    inputs.selectedGearId === gearId
                      ? "bg-blue-700 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-mono">{gearId}</span>
                    <span className="text-xs text-gray-400">
                      {g.gearDefId} Lv{g.level}
                    </span>
                  </div>
                  {g.equippedBy && (
                    <div className="text-xs text-yellow-400">
                      on {g.equippedBy}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Create gear form */}
          <div className="rounded-lg bg-gray-800 p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-300">
              Create Gear
            </h3>
            <InputField
              label="Gear ID (optional)"
              value={inputs.newGearId}
              onChange={(v) => updateInput({ newGearId: v })}
              placeholder="auto-generated if empty"
            />
            <SelectField
              label="Gear Definition"
              value={inputs.newGearDefId}
              onChange={(v) => updateInput({ newGearDefId: v })}
              options={gearDefIds}
              placeholder={
                gearDefIds.length > 0
                  ? "-- select gearDef --"
                  : "Load config first"
              }
            />
            <Btn
              label="Create"
              onClick={doCreateGear}
              disabled={pending || !inputs.newGearDefId}
              variant="green"
              small
            />
          </div>

          {/* Equip / Unequip controls */}
          <div className="rounded-lg bg-gray-800 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-300">
              Equip / Unequip
            </h3>

            {/* Selected gear info */}
            {selectedGearInst ? (
              <div className="text-xs text-gray-400 space-y-1">
                <p>
                  Gear:{" "}
                  <span className="text-white font-mono">
                    {inputs.selectedGearId}
                  </span>
                </p>
                <p>
                  Def:{" "}
                  <span className="text-gray-300 font-mono">
                    {selectedGearInst.gearDefId}
                  </span>
                </p>
                <p>
                  Level:{" "}
                  <span className="text-gray-300 font-mono">
                    {selectedGearInst.level}
                  </span>
                  {selectedGearInst.level >= maxLevel && (
                    <span className="text-yellow-400 ml-1">(MAX)</span>
                  )}
                </p>
                {selectedGearInst.equippedBy && (
                  <p>
                    Equipped by:{" "}
                    <span className="text-yellow-400 font-mono">
                      {selectedGearInst.equippedBy}
                    </span>
                  </p>
                )}
                {selectedGearDef && Object.keys(selectedGearDef.baseStats).length > 0 && (
                  <div className="border-t border-gray-700 pt-1 mt-1">
                    <p className="text-gray-400 font-semibold mb-0.5">Base Stats:</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      {Object.entries(selectedGearDef.baseStats).map(([stat, val]) => (
                        <div key={stat} className="flex justify-between">
                          <span className="text-gray-400">{stat}</span>
                          <span className="text-cyan-300 font-mono">+{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-500 italic">
                Select a gear piece from the list above.
              </p>
            )}

            {/* Pattern selector */}
            {patterns.length > 1 && (
              <SelectField
                label="Slot Pattern"
                value={String(selectedPatternIdx)}
                onChange={(v) => setSelectedPatternIdx(Number(v))}
                options={patterns.map((_, i) => String(i))}
                placeholder="-- pattern --"
              />
            )}
            {patterns.length > 0 && (
              <div className="text-xs text-gray-500">
                Pattern:{" "}
                <span className="text-gray-300 font-mono">
                  [
                  {(patterns[selectedPatternIdx] ?? patterns[0]).join(", ")}
                  ]
                </span>
              </div>
            )}

            {/* Swap toggle */}
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={inputs.swapMode}
                onChange={(e) => updateInput({ swapMode: e.target.checked })}
                className="rounded"
              />
              Swap mode
              <span className="text-xs text-gray-500">
                (auto-unequip conflicting gear)
              </span>
            </label>

            {/* Buttons */}
            <div className="flex flex-wrap gap-2">
              <Btn
                label="Equip"
                onClick={doEquip}
                disabled={
                  pending ||
                  !inputs.selectedCharacterId ||
                  !inputs.selectedGearId
                }
                variant="green"
              />
              <Btn
                label="Unequip"
                onClick={doUnequip}
                disabled={pending || !inputs.selectedGearId || !isGearEquipped}
                variant="red"
              />
              <Btn
                label="Level Up Gear"
                onClick={doLevelUpGear}
                disabled={
                  pending ||
                  !inputs.selectedGearId ||
                  (selectedGearInst != null &&
                    selectedGearInst.level >= maxLevel)
                }
                variant="yellow"
              />
            </div>

            {/* Restrictions info */}
            {selectedGearDef?.restrictions && (
              <div className="text-xs text-gray-500 border-t border-gray-700 pt-2 space-y-0.5">
                <p className="text-gray-400 font-semibold">Restrictions:</p>
                {selectedGearDef.restrictions.allowedClasses && (
                  <p>
                    Allowed:{" "}
                    {selectedGearDef.restrictions.allowedClasses.join(", ")}
                  </p>
                )}
                {selectedGearDef.restrictions.blockedClasses && (
                  <p>
                    Blocked:{" "}
                    {selectedGearDef.restrictions.blockedClasses.join(", ")}
                  </p>
                )}
                {selectedGearDef.restrictions.requiredCharacterLevel !=
                  null && (
                  <p>
                    Req. char level:{" "}
                    {selectedGearDef.restrictions.requiredCharacterLevel}
                  </p>
                )}
                {selectedGearDef.restrictions.maxLevelDelta != null && (
                  <p>
                    Max level delta:{" "}
                    {selectedGearDef.restrictions.maxLevelDelta}
                  </p>
                )}
              </div>
            )}

            {/* Set info */}
            {selectedGearDef?.setId && (
              <div className="text-xs text-gray-500 border-t border-gray-700 pt-2">
                <p>
                  Set:{" "}
                  <span className="text-purple-400 font-mono">
                    {selectedGearDef.setId}
                  </span>
                  {selectedGearDef.setPieceCount != null && (
                    <span className="text-gray-400">
                      {" "}
                      (counts as {selectedGearDef.setPieceCount})
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
