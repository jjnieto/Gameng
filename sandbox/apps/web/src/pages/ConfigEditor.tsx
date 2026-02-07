import { useState, useCallback, useRef } from "react";
import Ajv from "ajv";
import type { ErrorObject } from "ajv";
import { createLauncherClient, LauncherClientError } from "../lib/launcherClient.ts";
import { createEngineClient, EngineClientError } from "../lib/engineClient.ts";
import type { Settings } from "../lib/useSettings.ts";

import configMinimal from "../presets/config_minimal.json";
import configSets from "../presets/config_sets.json";
import gameConfigSchema from "../schemas/game_config.schema.json";

// ---- Ajv singleton ----

const ajv = new Ajv({ allErrors: true });
const validateGameConfig = ajv.compile(gameConfigSchema);

// ---- localStorage ----

const EDITOR_KEY = "gameng-sandbox-config-editor";
const SAVED_KEY = "gameng-sandbox-config-saved";

function loadEditorContent(): string {
  return localStorage.getItem(EDITOR_KEY) ?? "";
}
function saveEditorContent(s: string): void {
  localStorage.setItem(EDITOR_KEY, s);
}
function loadLastSaved(): string {
  return localStorage.getItem(SAVED_KEY) ?? "";
}
function saveLastSaved(s: string): void {
  localStorage.setItem(SAVED_KEY, s);
}

// ---- Validation ----

interface ValidationResult {
  ok: boolean;
  parseError?: string;
  schemaErrors?: ErrorObject[];
}

function validate(text: string): ValidationResult {
  if (!text.trim()) {
    return { ok: false, parseError: "Editor is empty" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, parseError: (e as Error).message };
  }
  const valid = validateGameConfig(parsed);
  if (valid) {
    return { ok: true };
  }
  return { ok: false, schemaErrors: validateGameConfig.errors ?? [] };
}

// ---- Sub-components ----

function ValidationPanel({ result }: { result: ValidationResult | null }) {
  if (!result) {
    return <p className="text-gray-500 text-sm italic">Not validated yet.</p>;
  }
  if (result.ok) {
    return <p className="text-green-400 text-sm font-semibold">Valid GameConfig</p>;
  }
  if (result.parseError) {
    return (
      <div className="text-red-400 text-sm">
        <p className="font-semibold">JSON Parse Error</p>
        <p className="font-mono text-xs mt-1">{result.parseError}</p>
      </div>
    );
  }
  return (
    <div className="space-y-1 max-h-[200px] overflow-y-auto">
      {result.schemaErrors?.map((err, i) => (
        <div key={i} className="text-sm text-red-400 border-l-2 border-red-700 pl-2">
          <span className="font-mono text-xs text-gray-500">{err.instancePath || "/"}</span>
          <span className="mx-1 text-gray-600">&mdash;</span>
          <span>{err.message}</span>
        </div>
      ))}
    </div>
  );
}

function Banner({ type, message, onDismiss }: {
  type: "success" | "error" | "info";
  message: string;
  onDismiss?: () => void;
}) {
  const colors = {
    success: "bg-green-900/50 border-green-700 text-green-300",
    error: "bg-red-900/50 border-red-700 text-red-300",
    info: "bg-blue-900/50 border-blue-700 text-blue-300",
  };
  return (
    <div className={`rounded border px-3 py-2 text-sm flex items-center justify-between ${colors[type]}`}>
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100">&times;</button>
      )}
    </div>
  );
}

// ---- Main component ----

export default function ConfigEditor({ settings }: { settings: Settings }) {
  const [content, setContent] = useState<string>(loadEditorContent);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [banner, setBanner] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const lastSavedRef = useRef(loadLastSaved());

  const launcherClient = createLauncherClient(settings.launcherBaseUrl);
  const engineClient = createEngineClient(settings.engineBaseUrl, settings.gameInstanceId);

  const isDirty = content !== lastSavedRef.current && lastSavedRef.current !== "";
  const charCount = content.length;

  // ---- Editor update ----
  const updateContent = useCallback((text: string) => {
    setContent(text);
    saveEditorContent(text);
    setValidation(null); // clear stale validation
  }, []);

  // ---- Load preset ----
  const loadPreset = useCallback((preset: unknown, name: string) => {
    const text = JSON.stringify(preset, null, 2);
    updateContent(text);
    setValidation(null);
    setBanner({ type: "info", message: `Loaded preset: ${name}` });
  }, [updateContent]);

  // ---- Load from engine ----
  const loadFromEngine = async () => {
    setPending(true);
    setBanner(null);
    try {
      const config = await engineClient.getConfig();
      const text = JSON.stringify(config, null, 2);
      updateContent(text);
      setValidation(null);
      setBanner({ type: "info", message: "Loaded config from engine" });
    } catch (err) {
      if (err instanceof EngineClientError) {
        setBanner({ type: "error", message: `Engine error: ${err.message}` });
      } else {
        setBanner({ type: "error", message: "Engine unreachable" });
      }
    } finally {
      setPending(false);
    }
  };

  // ---- Validate ----
  const doValidate = useCallback(() => {
    const result = validate(content);
    setValidation(result);
    return result;
  }, [content]);

  // ---- Format ----
  const doFormat = useCallback(() => {
    try {
      const parsed = JSON.parse(content) as unknown;
      const formatted = JSON.stringify(parsed, null, 2);
      updateContent(formatted);
      setBanner({ type: "info", message: "Formatted" });
    } catch {
      setBanner({ type: "error", message: "Cannot format: invalid JSON" });
    }
  }, [content, updateContent]);

  // ---- Reset to last saved ----
  const doReset = useCallback(() => {
    if (lastSavedRef.current) {
      updateContent(lastSavedRef.current);
      setValidation(null);
      setBanner({ type: "info", message: "Reset to last saved" });
    }
  }, [updateContent]);

  // ---- Save to launcher ----
  const doSave = async (restart: boolean) => {
    const result = doValidate();
    if (!result.ok) {
      setBanner({ type: "error", message: "Fix validation errors before saving" });
      return;
    }

    setPending(true);
    setBanner(null);
    try {
      const parsed = JSON.parse(content) as unknown;
      const res = await launcherClient.saveConfig(parsed, { restart });
      lastSavedRef.current = content;
      saveLastSaved(content);
      if (restart) {
        setBanner({ type: "success", message: `Saved to ${res.path}. Restart requested.` });
      } else {
        setBanner({ type: "success", message: `Saved to ${res.path}` });
      }
    } catch (err) {
      if (err instanceof LauncherClientError) {
        const body = err.body as { error?: string } | null;
        setBanner({ type: "error", message: body?.error ?? `Launcher error: ${String(err.status)}` });
      } else {
        setBanner({ type: "error", message: "Launcher unreachable" });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-6 h-full">
      {/* Header + banner */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Config Editor</h1>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{charCount.toLocaleString()} chars</span>
          {isDirty && <span className="text-yellow-400 font-semibold">unsaved changes</span>}
        </div>
      </div>

      {banner && (
        <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
        {/* Left: editor textarea (spans 2 cols) */}
        <div className="lg:col-span-2 flex flex-col min-h-0">
          <textarea
            className="flex-1 w-full rounded bg-gray-950 text-green-400 font-mono text-xs p-3 border border-gray-700 focus:border-blue-500 focus:outline-none resize-none min-h-[400px]"
            value={content}
            onChange={(e) => updateContent(e.target.value)}
            spellCheck={false}
            placeholder="Paste or load a GameConfig JSON..."
          />
        </div>

        {/* Right: actions + validation */}
        <div className="space-y-4">
          {/* Presets */}
          <div className="rounded-lg bg-gray-800 p-4 space-y-2">
            <h2 className="text-sm font-semibold text-white">Load Preset</h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => loadPreset(configMinimal, "minimal")}
                disabled={pending}
                className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-40"
              >
                minimal
              </button>
              <button
                onClick={() => loadPreset(configSets, "sets")}
                disabled={pending}
                className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-40"
              >
                sets
              </button>
            </div>
            <button
              onClick={() => void loadFromEngine()}
              disabled={pending}
              className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-40 w-full"
            >
              Load from engine
            </button>
          </div>

          {/* Validation */}
          <div className="rounded-lg bg-gray-800 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Validation</h2>
              <button
                onClick={doValidate}
                disabled={pending}
                className="rounded bg-blue-700 px-3 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-40"
              >
                Validate
              </button>
            </div>
            <ValidationPanel result={validation} />
          </div>

          {/* Actions */}
          <div className="rounded-lg bg-gray-800 p-4 space-y-2">
            <h2 className="text-sm font-semibold text-white">Actions</h2>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => void doSave(false)}
                disabled={pending}
                className="rounded bg-green-700 px-3 py-1.5 text-sm text-white hover:bg-green-600 disabled:opacity-40"
              >
                Save to launcher
              </button>
              <button
                onClick={() => void doSave(true)}
                disabled={pending}
                className="rounded bg-yellow-700 px-3 py-1.5 text-sm text-white hover:bg-yellow-600 disabled:opacity-40"
              >
                Save + Restart engine
              </button>
            </div>
          </div>

          {/* Editor tools */}
          <div className="rounded-lg bg-gray-800 p-4 space-y-2">
            <h2 className="text-sm font-semibold text-white">Editor</h2>
            <div className="flex gap-2">
              <button
                onClick={doFormat}
                disabled={pending}
                className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-40"
              >
                Format
              </button>
              <button
                onClick={doReset}
                disabled={pending || !isDirty}
                className="rounded bg-gray-700 px-3 py-1 text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-40"
              >
                Reset to saved
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
