import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { createLauncherClient, LauncherClientError } from "../lib/launcherClient.ts";
import { createEngineClient, getEngineBaseUrl, EngineClientError } from "../lib/engineClient.ts";
import type { Settings } from "../lib/useSettings.ts";
import type { TransactionRequest, TxResponse } from "../lib/types.ts";
import type { Scenario, StepResult, VariableMap, RuntimeContext } from "../lib/scenario.ts";
import {
  EMPTY_CONTEXT,
  extractContext,
  createEmptyScenario,
  loadScenarios,
  saveScenarios,
  resolveVariables,
  findUnresolvedVars,
  hasCredentials,
  redactStep,
  exportScenario,
  importScenario,
  parseStepsJson,
  pushToPlayer,
  pushToGm,
} from "../lib/scenario.ts";

import configMinimal from "../presets/config_minimal.json";
import configSets from "../presets/config_sets.json";

// ---- Helpers ----

function formatError(err: unknown): string {
  if (err instanceof EngineClientError) {
    const code = err.body?.errorCode ?? "";
    const msg = err.body?.errorMessage ?? err.message;
    return code ? `${code}: ${msg}` : msg;
  }
  if (err instanceof LauncherClientError) {
    const body = err.body as { error?: string } | null;
    return body?.error ?? `Launcher HTTP ${String(err.status)}`;
  }
  return err instanceof Error ? err.message : "Unknown error";
}

let txCounter = 0;
function nextTxId(): string {
  txCounter += 1;
  return `scn_tx_${Date.now()}_${String(txCounter)}`;
}

const PRESETS: Record<string, unknown> = {
  minimal: configMinimal,
  sets: configSets,
};

// ---- Scenario list sidebar sub-component ----

function ScenarioList({
  scenarios,
  selectedId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onImport,
}: {
  scenarios: Scenario[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onImport: (json: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onImport(reader.result as string);
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Scenarios</h2>
        <div className="flex gap-1">
          <button
            onClick={onAdd}
            className="rounded bg-green-700 px-2 py-0.5 text-xs text-white hover:bg-green-600"
          >
            + New
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-600"
          >
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </div>
      {scenarios.length === 0 && (
        <p className="text-xs text-gray-600 italic">No scenarios yet. Create one!</p>
      )}
      {scenarios.map((s) => (
        <div
          key={s.id}
          className={`rounded px-2 py-1.5 text-xs cursor-pointer flex items-center justify-between group ${
            selectedId === s.id
              ? "bg-blue-700 text-white"
              : "bg-gray-800 text-gray-300 hover:bg-gray-700"
          }`}
          onClick={() => onSelect(s.id)}
        >
          <span className="truncate flex-1">{s.name}</span>
          <span className="text-gray-500 text-[10px] mr-1">{s.steps.length} steps</span>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100">
            <button
              onClick={(e) => {
                e.stopPropagation();
                const name = prompt("Rename scenario:", s.name);
                if (name?.trim()) onRename(s.id, name.trim());
              }}
              className="text-gray-400 hover:text-white text-[10px]"
              title="Rename"
            >
              ✎
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete "${s.name}"?`)) onDelete(s.id);
              }}
              className="text-red-400 hover:text-red-300 text-[10px]"
              title="Delete"
            >
              &times;
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Credential warning ----

function CredentialWarning({ steps }: { steps: TransactionRequest[] }) {
  const count = steps.filter(hasCredentials).length;
  if (count === 0) return null;
  return (
    <div className="rounded border border-yellow-700 bg-yellow-900/30 text-yellow-300 px-3 py-1.5 text-xs">
      {count} step{count !== 1 ? "s" : ""} contain credentials.
      Use <code className="bg-gray-800 px-1 rounded">${"{ADMIN_API_KEY}"}</code> or{" "}
      <code className="bg-gray-800 px-1 rounded">${"{ACTOR_API_KEY}"}</code> variables to avoid storing raw keys.
    </div>
  );
}

// ---- Runtime context table ----

function ContextTable({ ctx }: { ctx: RuntimeContext }) {
  const entries = [
    { label: "LAST_PLAYER_ID", value: ctx.lastPlayerId },
    { label: "LAST_CHARACTER_ID", value: ctx.lastCharacterId },
    { label: "LAST_GEAR_ID", value: ctx.lastGearId },
    { label: "LAST_ACTOR_ID", value: ctx.lastActorId },
  ];
  const hasAny = entries.some((e) => e.value);
  if (!hasAny) return null;

  return (
    <div className="rounded bg-gray-800 border border-gray-700 p-2">
      <h4 className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Runtime Context</h4>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {entries.filter((e) => e.value).map((e) => (
          <div key={e.label} className="flex items-center gap-1 text-xs">
            <code className="text-blue-400 text-[10px]">${`{${e.label}}`}</code>
            <span className="text-gray-400">=</span>
            <span className="text-gray-300 font-mono truncate">{e.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Step result row ----

function StepResultRow({ result, index }: { result: StepResult; index: number }) {
  const redacted = redactStep(result.tx);
  const ok = result.response?.accepted === true;
  const failed = result.response?.accepted === false || result.httpError !== null;

  const versionDelta =
    result.versionBefore !== null && result.versionAfter !== null
      ? result.versionAfter - result.versionBefore
      : null;

  return (
    <tr className={`border-b border-gray-800 text-xs ${failed ? "bg-red-900/20" : ""}`}>
      <td className="px-2 py-1 text-gray-500">{index + 1}</td>
      <td className="px-2 py-1 font-mono text-gray-300">{redacted.type}</td>
      <td className="px-2 py-1">
        {result.httpError ? (
          <span className="text-red-400">HTTP Error</span>
        ) : ok ? (
          <span className="text-green-400">accepted</span>
        ) : (
          <span className="text-red-400">rejected</span>
        )}
      </td>
      <td className="px-2 py-1 font-mono text-gray-500">
        {result.response?.errorCode ?? result.httpError ?? "—"}
      </td>
      <td className="px-2 py-1 text-gray-500 text-right">{result.durationMs}ms</td>
      <td className="px-2 py-1 text-gray-500 text-right">
        {result.response?.stateVersion ?? "—"}
      </td>
      <td className="px-2 py-1 text-right">
        {versionDelta !== null ? (
          <span className={versionDelta > 0 ? "text-green-500" : "text-gray-600"}>
            +{versionDelta}
          </span>
        ) : (
          <span className="text-gray-700">—</span>
        )}
      </td>
    </tr>
  );
}

// ---- Main component ----

export default function ScenarioRunner({ settings }: { settings: Settings }) {
  const navigate = useNavigate();

  // Scenario list state
  const [scenarios, setScenarios] = useState<Scenario[]>(loadScenarios);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => loadScenarios()[0]?.id ?? null,
  );

  // Editor state
  const [stepsJson, setStepsJson] = useState("");
  const [stepsError, setStepsError] = useState<string | null>(null);
  const [actorApiKey, setActorApiKey] = useState("");

  // Execution state
  const [results, setResults] = useState<StepResult[]>([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);

  // Runtime context — populated as steps execute
  const [runtimeCtx, setRuntimeCtx] = useState<RuntimeContext>(EMPTY_CONTEXT);

  // Banner
  const [banner, setBanner] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const launcherClient = createLauncherClient(settings.launcherBaseUrl);
  const engineClient = createEngineClient(getEngineBaseUrl(settings), settings.gameInstanceId);

  const selected = scenarios.find((s) => s.id === selectedId) ?? null;

  const hasContext = runtimeCtx.lastPlayerId || runtimeCtx.lastCharacterId || runtimeCtx.lastGearId;

  // ---- Persist helper ----
  const persist = useCallback((updated: Scenario[]) => {
    setScenarios(updated);
    saveScenarios(updated);
  }, []);

  // ---- Scenario CRUD ----
  const addScenario = useCallback(() => {
    const scn = createEmptyScenario();
    const updated = [...scenarios, scn];
    persist(updated);
    setSelectedId(scn.id);
    setStepsJson("[]");
    setStepsError(null);
    setResults([]);
    setCurrentStep(-1);
    setRuntimeCtx(EMPTY_CONTEXT);
  }, [scenarios, persist]);

  const renameScenario = useCallback((id: string, name: string) => {
    persist(scenarios.map((s) => (s.id === id ? { ...s, name } : s)));
  }, [scenarios, persist]);

  const deleteScenario = useCallback((id: string) => {
    const updated = scenarios.filter((s) => s.id !== id);
    persist(updated);
    if (selectedId === id) {
      setSelectedId(updated[0]?.id ?? null);
      setStepsJson(updated[0] ? JSON.stringify(updated[0].steps, null, 2) : "");
      setResults([]);
      setRuntimeCtx(EMPTY_CONTEXT);
    }
  }, [scenarios, selectedId, persist]);

  const importScenarioHandler = useCallback((json: string) => {
    try {
      const scn = importScenario(json);
      const updated = [...scenarios, scn];
      persist(updated);
      setSelectedId(scn.id);
      setStepsJson(JSON.stringify(scn.steps, null, 2));
      setResults([]);
      setRuntimeCtx(EMPTY_CONTEXT);
      setBanner({ type: "info", message: `Imported: ${scn.name}` });
    } catch (e) {
      setBanner({ type: "error", message: `Import failed: ${(e as Error).message}` });
    }
  }, [scenarios, persist]);

  // ---- Select scenario ----
  const selectScenario = useCallback((id: string) => {
    setSelectedId(id);
    const scn = scenarios.find((s) => s.id === id);
    if (scn) {
      setStepsJson(JSON.stringify(scn.steps, null, 2));
      setStepsError(null);
    }
    setResults([]);
    setCurrentStep(-1);
    setRuntimeCtx(EMPTY_CONTEXT);
  }, [scenarios]);

  // ---- Update selected scenario fields ----
  const updateSelected = useCallback((patch: Partial<Scenario>) => {
    if (!selectedId) return;
    persist(scenarios.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)));
  }, [selectedId, scenarios, persist]);

  // ---- Steps JSON editing ----
  const onStepsJsonChange = useCallback((text: string) => {
    setStepsJson(text);
    const { steps, error } = parseStepsJson(text);
    setStepsError(error);
    if (steps && selectedId) {
      updateSelected({ steps });
    }
  }, [selectedId, updateSelected]);

  // ---- Format steps JSON ----
  const formatSteps = useCallback(() => {
    try {
      const parsed = JSON.parse(stepsJson) as unknown;
      setStepsJson(JSON.stringify(parsed, null, 2));
    } catch {
      // ignore if invalid
    }
  }, [stepsJson]);

  // ---- Build variable map (settings + runtime context) ----
  const buildVarMap = useCallback((ctx: RuntimeContext): VariableMap => ({
    ADMIN_API_KEY: settings.adminApiKey,
    ACTOR_API_KEY: actorApiKey,
    GAME_INSTANCE_ID: selected?.gameInstanceId ?? settings.gameInstanceId,
    LAST_PLAYER_ID: ctx.lastPlayerId,
    LAST_CHARACTER_ID: ctx.lastCharacterId,
    LAST_GEAR_ID: ctx.lastGearId,
    LAST_ACTOR_ID: ctx.lastActorId,
  }), [settings, actorApiKey, selected]);

  // ---- Try read stateVersion (best-effort, non-blocking) ----
  const tryGetVersion = async (): Promise<number | null> => {
    try {
      const sv = await engineClient.getStateVersion();
      return sv.stateVersion;
    } catch {
      return null;
    }
  };

  // ---- Apply config ----
  const applyConfig = async () => {
    if (!selected || selected.configSource === "none") return;
    setBanner(null);
    try {
      let config: unknown;
      if (selected.configSource === "minimal" || selected.configSource === "sets") {
        config = PRESETS[selected.configSource];
      } else {
        config = JSON.parse(selected.configSource);
      }
      await launcherClient.saveConfig(config, { restart: true });
      setBanner({ type: "success", message: "Config applied + engine restarting..." });
      // Wait a bit for engine to be ready
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (e) {
      setBanner({ type: "error", message: `Apply config failed: ${formatError(e)}` });
    }
  };

  // ---- Execute single step ----
  const executeStep = async (
    step: TransactionRequest,
    index: number,
    ctx: RuntimeContext,
  ): Promise<{ result: StepResult; newCtx: RuntimeContext }> => {
    const vars = buildVarMap(ctx);

    // Check for unresolved variables
    const unresolved = findUnresolvedVars(step, vars);
    if (unresolved.length > 0) {
      return {
        result: {
          index,
          tx: step,
          response: null,
          httpError: `Unresolved variables: ${unresolved.map((v) => `\${${v}}`).join(", ")}`,
          durationMs: 0,
          versionBefore: null,
          versionAfter: null,
        },
        newCtx: ctx,
      };
    }

    const resolved = resolveVariables(step, vars);
    // Auto-fill txId and gameInstanceId
    if (!resolved.txId) resolved.txId = nextTxId();
    if (!resolved.gameInstanceId) resolved.gameInstanceId = selected?.gameInstanceId ?? settings.gameInstanceId;

    // Read stateVersion before (best-effort)
    const versionBefore = await tryGetVersion();

    const start = performance.now();
    try {
      const isAdmin = resolved.type === "CreateActor" || resolved.type === "GrantResources";
      const authOpts = isAdmin
        ? { adminApiKey: vars.ADMIN_API_KEY }
        : { apiKey: resolved.apiKey ?? vars.ACTOR_API_KEY };
      // Remove apiKey from tx body since we pass it as auth header
      const { apiKey: _removed, ...txBody } = resolved;
      const response = await engineClient.postTx(txBody as TransactionRequest, authOpts);
      const durationMs = Math.round(performance.now() - start);
      const versionAfter = response.stateVersion ?? null;
      // Extract IDs from the ORIGINAL step (pre-resolve) to capture literal IDs,
      // and also from resolved to capture variable-resolved IDs
      const newCtx = response.accepted ? extractContext(ctx, resolved) : ctx;
      return {
        result: { index, tx: step, response, httpError: null, durationMs, versionBefore, versionAfter },
        newCtx,
      };
    } catch (e) {
      const durationMs = Math.round(performance.now() - start);
      // Try to extract TxResponse from EngineClientError
      if (e instanceof EngineClientError && e.body) {
        const body = e.body as TxResponse;
        if (body.txId !== undefined) {
          return {
            result: { index, tx: step, response: body, httpError: null, durationMs, versionBefore, versionAfter: body.stateVersion ?? null },
            newCtx: ctx,
          };
        }
      }
      return {
        result: { index, tx: step, response: null, httpError: formatError(e), durationMs, versionBefore, versionAfter: null },
        newCtx: ctx,
      };
    }
  };

  // ---- Run single step (uses current context) ----
  const runStep = async (index: number) => {
    if (!selected || index >= selected.steps.length) return;
    setRunning(true);
    setCurrentStep(index);
    const { result, newCtx } = await executeStep(selected.steps[index], index, runtimeCtx);
    setRuntimeCtx(newCtx);
    setResults((prev) => {
      const copy = [...prev];
      copy[index] = result;
      return copy;
    });
    setCurrentStep(-1);
    setRunning(false);
  };

  // ---- Run from step N to end ----
  const runFrom = async (startIndex: number) => {
    if (!selected || startIndex >= selected.steps.length) return;
    setRunning(true);
    cancelRef.current = false;

    // Keep results before startIndex, clear the rest
    setResults((prev) => prev.slice(0, startIndex));
    let ctx = runtimeCtx;
    let allCompleted = true;

    for (let i = startIndex; i < selected.steps.length; i++) {
      if (cancelRef.current) { allCompleted = false; break; }
      setCurrentStep(i);
      const { result, newCtx } = await executeStep(selected.steps[i], i, ctx);
      ctx = newCtx;
      setRuntimeCtx(ctx);
      setResults((prev) => {
        const copy = [...prev];
        copy[i] = result;
        return copy;
      });

      const failed = result.response?.accepted === false || result.httpError !== null;
      if (failed && !selected.continueOnFail) {
        setBanner({ type: "error", message: `Stopped at step ${String(i + 1)}: ${result.response?.errorCode ?? result.httpError ?? "rejected"}` });
        allCompleted = false;
        break;
      }
    }

    setCurrentStep(-1);
    setRunning(false);
    if (allCompleted && !cancelRef.current) {
      setBanner({ type: "success", message: "All steps completed" });
    }
  };

  // ---- Run all (from 0, resets context) ----
  const runAll = async () => {
    if (!selected || selected.steps.length === 0) return;
    setRuntimeCtx(EMPTY_CONTEXT);
    setResults([]);
    // Small delay to let state clear before starting
    await new Promise((r) => setTimeout(r, 0));
    await runFrom(0);
  };

  // ---- Stop ----
  const stopExecution = useCallback(() => {
    cancelRef.current = true;
    setBanner({ type: "info", message: "Execution stopped by user" });
  }, []);

  // ---- Export ----
  const doExport = useCallback(() => {
    if (!selected) return;
    const json = exportScenario(selected);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selected.name.replace(/\s+/g, "_")}.scenario.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selected]);

  // ---- Push to Player ----
  const doPushToPlayer = useCallback((withApiKey: boolean) => {
    pushToPlayer(runtimeCtx, {
      apiKey: actorApiKey,
      includeApiKey: withApiKey,
    });
    setBanner({ type: "success", message: `IDs sent to /player${withApiKey ? " (with API key)" : ""}` });
  }, [runtimeCtx, actorApiKey]);

  // ---- Push to GM ----
  const doPushToGm = useCallback((withApiKey: boolean) => {
    pushToGm(runtimeCtx, {
      apiKey: actorApiKey,
      includeApiKey: withApiKey,
    });
    setBanner({ type: "success", message: `IDs sent to /gm${withApiKey ? " (with API key)" : ""}` });
  }, [runtimeCtx, actorApiKey]);

  // ---- Load demo scenario ----
  const loadDemo = useCallback(() => {
    const demo: Scenario = {
      id: `scn_${Date.now()}_demo`,
      name: "Demo: Full Flow",
      gameInstanceId: "instance_001",
      configSource: "sets",
      continueOnFail: false,
      steps: [
        { txId: "", type: "CreateActor", gameInstanceId: "", actorId: "actor_demo", apiKey: "${ACTOR_API_KEY}" },
        { txId: "", type: "CreatePlayer", gameInstanceId: "", playerId: "player_demo" },
        { txId: "", type: "GrantResources", gameInstanceId: "", playerId: "${LAST_PLAYER_ID}", resources: { xp: 500, gold: 200 } },
        { txId: "", type: "CreateCharacter", gameInstanceId: "", playerId: "${LAST_PLAYER_ID}", characterId: "hero_1", classId: "warrior" },
        { txId: "", type: "CreateGear", gameInstanceId: "", playerId: "${LAST_PLAYER_ID}", gearId: "sword_1", gearDefId: "sword_basic" },
        { txId: "", type: "EquipGear", gameInstanceId: "", playerId: "${LAST_PLAYER_ID}", characterId: "${LAST_CHARACTER_ID}", gearId: "${LAST_GEAR_ID}" },
        { txId: "", type: "LevelUpCharacter", gameInstanceId: "", playerId: "${LAST_PLAYER_ID}", characterId: "${LAST_CHARACTER_ID}", levels: 2 },
      ],
    };
    const updated = [...scenarios, demo];
    persist(updated);
    setSelectedId(demo.id);
    setStepsJson(JSON.stringify(demo.steps, null, 2));
    setResults([]);
    setRuntimeCtx(EMPTY_CONTEXT);
    setBanner({ type: "info", message: "Loaded demo scenario" });
  }, [scenarios, persist]);

  // ---- Render ----

  return (
    <div className="flex flex-col gap-4 p-6 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Scenario Runner</h1>
        {selected && (
          <span className="text-xs text-gray-500">
            {selected.steps.length} steps &middot; {results.length} results
          </span>
        )}
      </div>

      {banner && (
        <div className={`rounded border px-3 py-2 text-sm flex items-center justify-between ${
          banner.type === "success" ? "bg-green-900/50 border-green-700 text-green-300"
            : banner.type === "error" ? "bg-red-900/50 border-red-700 text-red-300"
              : "bg-blue-900/50 border-blue-700 text-blue-300"
        }`}>
          <span>{banner.message}</span>
          <button onClick={() => setBanner(null)} className="ml-2 opacity-60 hover:opacity-100">&times;</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 flex-1 min-h-0">
        {/* Left sidebar: scenario list */}
        <div className="lg:col-span-1 rounded-lg bg-gray-800 p-3 overflow-y-auto max-h-[calc(100vh-180px)]">
          <ScenarioList
            scenarios={scenarios}
            selectedId={selectedId}
            onSelect={selectScenario}
            onAdd={addScenario}
            onRename={renameScenario}
            onDelete={deleteScenario}
            onImport={importScenarioHandler}
          />
          <div className="mt-3 pt-3 border-t border-gray-700">
            <button
              onClick={loadDemo}
              className="rounded bg-purple-700 px-3 py-1 text-xs text-white hover:bg-purple-600 w-full"
            >
              Load Demo Scenario
            </button>
          </div>
        </div>

        {/* Main area */}
        <div className="lg:col-span-3 flex flex-col gap-3 min-h-0">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-gray-600">
              Select or create a scenario to get started
            </div>
          ) : (
            <>
              {/* Top bar: scenario settings */}
              <div className="rounded-lg bg-gray-800 p-3 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  {/* Name */}
                  <label className="text-xs text-gray-400 flex items-center gap-1">
                    Name:
                    <input
                      type="text"
                      value={selected.name}
                      onChange={(e) => updateSelected({ name: e.target.value })}
                      className="rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none w-40"
                    />
                  </label>

                  {/* Game Instance */}
                  <label className="text-xs text-gray-400 flex items-center gap-1">
                    Instance:
                    <input
                      type="text"
                      value={selected.gameInstanceId}
                      onChange={(e) => updateSelected({ gameInstanceId: e.target.value })}
                      className="rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none w-28"
                    />
                  </label>

                  {/* Config */}
                  <label className="text-xs text-gray-400 flex items-center gap-1">
                    Config:
                    <select
                      value={
                        selected.configSource === "none" || selected.configSource === "minimal" || selected.configSource === "sets"
                          ? selected.configSource
                          : "inline"
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "inline") {
                          updateSelected({ configSource: "{}" });
                        } else {
                          updateSelected({ configSource: val });
                        }
                      }}
                      className="rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="none">None</option>
                      <option value="minimal">minimal</option>
                      <option value="sets">sets</option>
                      <option value="inline">Inline JSON</option>
                    </select>
                  </label>

                  {/* Continue on fail */}
                  <label className="text-xs text-gray-400 flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={selected.continueOnFail}
                      onChange={(e) => updateSelected({ continueOnFail: e.target.checked })}
                      className="rounded"
                    />
                    Continue on fail
                  </label>

                  {/* Actor API Key for variable resolution */}
                  <label className="text-xs text-gray-400 flex items-center gap-1">
                    Actor key:
                    <input
                      type="password"
                      value={actorApiKey}
                      onChange={(e) => setActorApiKey(e.target.value)}
                      placeholder="for ${'{ACTOR_API_KEY}'}"
                      className="rounded bg-gray-900 border border-gray-700 px-2 py-0.5 text-xs text-white focus:border-blue-500 focus:outline-none w-32"
                    />
                  </label>
                </div>

                {/* Inline config editor */}
                {selected.configSource !== "none" && selected.configSource !== "minimal" && selected.configSource !== "sets" && (
                  <textarea
                    className="w-full rounded bg-gray-950 text-green-400 font-mono text-xs p-2 border border-gray-700 focus:border-blue-500 focus:outline-none resize-none h-24"
                    value={selected.configSource}
                    onChange={(e) => updateSelected({ configSource: e.target.value })}
                    placeholder="Paste GameConfig JSON..."
                    spellCheck={false}
                  />
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void applyConfig()}
                    disabled={running || selected.configSource === "none"}
                    className="rounded bg-yellow-700 px-3 py-1 text-xs text-white hover:bg-yellow-600 disabled:opacity-40"
                  >
                    Apply Config + Restart
                  </button>
                  <button
                    onClick={() => void runAll()}
                    disabled={running || selected.steps.length === 0}
                    className="rounded bg-green-700 px-3 py-1 text-xs text-white hover:bg-green-600 disabled:opacity-40"
                  >
                    Run All
                  </button>
                  {running && (
                    <button
                      onClick={stopExecution}
                      className="rounded bg-red-700 px-3 py-1 text-xs text-white hover:bg-red-600"
                    >
                      Stop
                    </button>
                  )}
                  <button
                    onClick={() => { setResults([]); setCurrentStep(-1); setRuntimeCtx(EMPTY_CONTEXT); setBanner(null); }}
                    disabled={running}
                    className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-40"
                  >
                    Clear Results
                  </button>
                  <button
                    onClick={doExport}
                    className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-300 hover:bg-gray-600"
                  >
                    Export JSON
                  </button>
                </div>
              </div>

              {/* Credential warning */}
              <CredentialWarning steps={selected.steps} />

              {/* Runtime context + push buttons + deep links */}
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex-1 min-w-[200px]">
                  <ContextTable ctx={runtimeCtx} />
                </div>
                {hasContext && (
                  <div className="flex flex-col gap-1">
                    <div className="flex gap-1">
                      <button
                        onClick={() => doPushToPlayer(false)}
                        disabled={!runtimeCtx.lastPlayerId}
                        className="rounded bg-blue-700 px-2 py-0.5 text-xs text-white hover:bg-blue-600 disabled:opacity-40"
                        title="Write IDs to Player page localStorage (no API key)"
                      >
                        Push to Player
                      </button>
                      <button
                        onClick={() => doPushToGm(false)}
                        disabled={!runtimeCtx.lastPlayerId}
                        className="rounded bg-blue-700 px-2 py-0.5 text-xs text-white hover:bg-blue-600 disabled:opacity-40"
                        title="Add player to GM registry"
                      >
                        Push to GM
                      </button>
                    </div>
                    {actorApiKey && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => doPushToPlayer(true)}
                          disabled={!runtimeCtx.lastPlayerId}
                          className="rounded bg-yellow-800 px-2 py-0.5 text-[10px] text-yellow-200 hover:bg-yellow-700 disabled:opacity-40"
                          title="Write IDs + Actor API key to Player page"
                        >
                          + with API key
                        </button>
                        <button
                          onClick={() => doPushToGm(true)}
                          disabled={!runtimeCtx.lastPlayerId}
                          className="rounded bg-yellow-800 px-2 py-0.5 text-[10px] text-yellow-200 hover:bg-yellow-700 disabled:opacity-40"
                          title="Push to GM + Actor API key"
                        >
                          + with API key
                        </button>
                      </div>
                    )}
                    <div className="flex gap-1 mt-1">
                      <button
                        onClick={() => {
                          doPushToPlayer(!!actorApiKey);
                          navigate("/player");
                        }}
                        disabled={!runtimeCtx.lastPlayerId}
                        className="rounded border border-blue-700 px-2 py-0.5 text-[10px] text-blue-400 hover:bg-blue-900/30 disabled:opacity-40"
                      >
                        Open Player
                      </button>
                      <button
                        onClick={() => {
                          doPushToGm(!!actorApiKey);
                          navigate("/gm");
                        }}
                        disabled={!runtimeCtx.lastPlayerId}
                        className="rounded border border-blue-700 px-2 py-0.5 text-[10px] text-blue-400 hover:bg-blue-900/30 disabled:opacity-40"
                      >
                        Open GM
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Steps editor + results in side-by-side layout */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 flex-1 min-h-0">
                {/* Steps editor */}
                <div className="flex flex-col min-h-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase">Steps (JSON Array)</h3>
                    <div className="flex gap-1">
                      <button
                        onClick={formatSteps}
                        className="rounded bg-gray-700 px-2 py-0.5 text-[10px] text-gray-400 hover:bg-gray-600"
                      >
                        Format
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="flex-1 w-full rounded bg-gray-950 text-green-400 font-mono text-xs p-2 border border-gray-700 focus:border-blue-500 focus:outline-none resize-none min-h-[200px]"
                    value={stepsJson}
                    onChange={(e) => onStepsJsonChange(e.target.value)}
                    spellCheck={false}
                    placeholder={'[\n  { "type": "CreateActor", "actorId": "a1", "apiKey": "${ACTOR_API_KEY}" },\n  { "type": "CreatePlayer", "playerId": "p1" },\n  { "type": "CreateCharacter", "playerId": "${LAST_PLAYER_ID}", "characterId": "c1", "classId": "warrior" }\n]'}
                  />
                  {stepsError && (
                    <p className="text-red-400 text-xs mt-1">{stepsError}</p>
                  )}
                </div>

                {/* Results panel */}
                <div className="flex flex-col min-h-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase">
                      Results
                      {running && currentStep >= 0 && (
                        <span className="ml-2 text-blue-400 animate-pulse">
                          Running step {currentStep + 1}...
                        </span>
                      )}
                    </h3>
                  </div>

                  {/* Individual step run buttons */}
                  {selected.steps.length > 0 && !running && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {selected.steps.map((step, i) => (
                        <button
                          key={i}
                          onClick={() => void runStep(i)}
                          className={`rounded px-2 py-0.5 text-[10px] border ${
                            results[i]
                              ? results[i].response?.accepted
                                ? "border-green-700 text-green-400"
                                : "border-red-700 text-red-400"
                              : "border-gray-700 text-gray-400"
                          } hover:bg-gray-800`}
                          title={`Run step ${String(i + 1)}: ${step.type}`}
                        >
                          {i + 1}: {step.type}
                        </button>
                      ))}
                      {/* Run from step N buttons */}
                      {selected.steps.length > 1 && results.length > 0 && results.length < selected.steps.length && (
                        <button
                          onClick={() => void runFrom(results.length)}
                          className="rounded px-2 py-0.5 text-[10px] border border-blue-700 text-blue-400 hover:bg-blue-900/30"
                          title={`Run from step ${String(results.length + 1)} to end`}
                        >
                          Resume from {results.length + 1}
                        </button>
                      )}
                    </div>
                  )}

                  <div className="flex-1 overflow-auto rounded border border-gray-700 bg-gray-950">
                    {results.length === 0 ? (
                      <p className="text-gray-600 text-xs italic p-3">No results yet. Run steps to see output.</p>
                    ) : (
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-gray-700 text-[10px] text-gray-500 uppercase">
                            <th className="px-2 py-1">#</th>
                            <th className="px-2 py-1">Type</th>
                            <th className="px-2 py-1">Status</th>
                            <th className="px-2 py-1">Error</th>
                            <th className="px-2 py-1 text-right">Time</th>
                            <th className="px-2 py-1 text-right">Ver.</th>
                            <th className="px-2 py-1 text-right">Delta</th>
                          </tr>
                        </thead>
                        <tbody>
                          {results.map((r, i) => (
                            <StepResultRow key={i} result={r} index={i} />
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
