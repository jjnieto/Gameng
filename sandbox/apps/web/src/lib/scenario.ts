// Scenario types, persistence, variable resolution, and cross-page push.

import type { TransactionRequest, TxResponse } from "./types.ts";

// ---- Types ----

export interface Scenario {
  id: string;
  name: string;
  gameInstanceId: string;
  /** "none" | "minimal" | "sets" | inline JSON string */
  configSource: string;
  steps: TransactionRequest[];
  continueOnFail: boolean;
}

export interface StepResult {
  index: number;
  tx: TransactionRequest;
  response: TxResponse | null;
  httpError: string | null;
  durationMs: number;
  versionBefore: number | null;
  versionAfter: number | null;
}

/**
 * Runtime context built up as steps execute.
 * Contains IDs extracted from TransactionRequests.
 * NEVER contains credentials — apiKey is deliberately excluded.
 */
export interface RuntimeContext {
  lastPlayerId: string;
  lastCharacterId: string;
  lastGearId: string;
  lastActorId: string;
}

export const EMPTY_CONTEXT: RuntimeContext = {
  lastPlayerId: "",
  lastCharacterId: "",
  lastGearId: "",
  lastActorId: "",
};

/**
 * Extract IDs from a step's request and merge into existing context.
 * Only updates fields that are present and non-empty in the step.
 * apiKey is deliberately NOT captured — credentials stay out of context.
 */
export function extractContext(prev: RuntimeContext, step: TransactionRequest): RuntimeContext {
  return {
    lastPlayerId: step.playerId ?? prev.lastPlayerId,
    lastCharacterId: step.characterId ?? prev.lastCharacterId,
    lastGearId: step.gearId ?? prev.lastGearId,
    lastActorId: step.actorId ?? prev.lastActorId,
  };
}

// ---- Default scenario ----

export function createEmptyScenario(name = "New Scenario"): Scenario {
  return {
    id: `scn_${Date.now()}_${String(Math.random()).slice(2, 8)}`,
    name,
    gameInstanceId: "instance_001",
    configSource: "none",
    steps: [],
    continueOnFail: false,
  };
}

// ---- localStorage ----

const STORAGE_KEY = "gameng-sandbox-scenarios";

export function loadScenarios(): Scenario[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Scenario[];
  } catch {
    // ignore corrupt
  }
  return [];
}

export function saveScenarios(scenarios: Scenario[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
}

// ---- Variable resolution ----

const VAR_PATTERN = /\$\{([A-Z_]+)\}/g;

export interface VariableMap {
  // Settings-level (credentials — resolved but never displayed)
  ADMIN_API_KEY: string;
  ACTOR_API_KEY: string;
  GAME_INSTANCE_ID: string;
  // Runtime context (non-sensitive — displayed in context table)
  LAST_PLAYER_ID: string;
  LAST_CHARACTER_ID: string;
  LAST_GEAR_ID: string;
  LAST_ACTOR_ID: string;
}

/**
 * Resolve all ${VAR} references in step fields.
 * Returns a deep copy with variables replaced.
 * Unresolved variables (empty value or unknown name) are left as-is.
 */
export function resolveVariables(
  step: TransactionRequest,
  vars: VariableMap,
): TransactionRequest {
  const json = JSON.stringify(step);
  const resolved = json.replace(VAR_PATTERN, (match, name: string) => {
    const value = (vars as unknown as Record<string, string>)[name];
    // Leave unresolved if variable unknown or empty
    if (value === undefined || value === "") return match;
    return value;
  });
  return JSON.parse(resolved) as TransactionRequest;
}

/**
 * Find unresolved ${VAR} references that would fail at runtime.
 * Returns list of variable names that are empty/missing in the map.
 */
export function findUnresolvedVars(
  step: TransactionRequest,
  vars: VariableMap,
): string[] {
  const json = JSON.stringify(step);
  const unresolved: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(VAR_PATTERN.source, "g");
  while ((m = re.exec(json)) !== null) {
    const name = m[1];
    const value = (vars as unknown as Record<string, string>)[name];
    if (value === undefined || value === "") {
      if (!unresolved.includes(name)) unresolved.push(name);
    }
  }
  return unresolved;
}

/** Check if a step contains credential fields or variable references. */
export function hasCredentials(step: TransactionRequest): boolean {
  const json = JSON.stringify(step);
  return (
    step.apiKey !== undefined ||
    json.includes("apiKey") ||
    json.includes("ADMIN_API_KEY") ||
    json.includes("ACTOR_API_KEY")
  );
}

/** Redact apiKey values for display. Never show real keys in logs. */
export function redactStep(step: TransactionRequest): TransactionRequest {
  const copy = { ...step };
  if (copy.apiKey !== undefined) {
    copy.apiKey = copy.apiKey.startsWith("${") ? copy.apiKey : "***";
  }
  return copy;
}

// ---- Export / Import ----

export function exportScenario(scenario: Scenario): string {
  return JSON.stringify(scenario, null, 2);
}

export function importScenario(json: string): Scenario {
  const obj = JSON.parse(json) as Record<string, unknown>;
  if (typeof obj.name !== "string") throw new Error("Missing 'name'");
  if (typeof obj.gameInstanceId !== "string") throw new Error("Missing 'gameInstanceId'");
  if (!Array.isArray(obj.steps)) throw new Error("Missing 'steps' array");
  // Re-assign ID so imported scenarios don't collide
  return {
    ...(obj as unknown as Scenario),
    id: `scn_${Date.now()}_${String(Math.random()).slice(2, 8)}`,
  };
}

// ---- Steps JSON validation ----

export function parseStepsJson(json: string): { steps: TransactionRequest[] | null; error: string | null } {
  if (!json.trim()) return { steps: null, error: "Steps JSON is empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { steps: null, error: `JSON parse error: ${(e as Error).message}` };
  }
  if (!Array.isArray(parsed)) {
    return { steps: null, error: "Steps must be a JSON array" };
  }
  for (let i = 0; i < parsed.length; i++) {
    const s = parsed[i] as Record<string, unknown>;
    if (typeof s !== "object" || s === null) {
      return { steps: null, error: `Step ${String(i)}: must be an object` };
    }
    if (typeof s["type"] !== "string") {
      return { steps: null, error: `Step ${String(i)}: missing 'type'` };
    }
  }
  return { steps: parsed as TransactionRequest[], error: null };
}

// ---- Push to Player / GM ----

const PLAYER_STORAGE_KEY = "gameng-sandbox-player-inputs";
const GM_STORAGE_KEY = "gameng-sandbox-gm";

/**
 * Write scenario context IDs into the Player page's localStorage.
 * apiKey is only written if `includeApiKey` is explicitly true and a value is provided.
 * Merges over existing values — preserves other player inputs.
 */
export function pushToPlayer(
  ctx: RuntimeContext,
  opts?: { apiKey?: string; includeApiKey?: boolean },
): void {
  let existing: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem(PLAYER_STORAGE_KEY);
    if (raw) existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // ignore
  }
  const patch: Record<string, unknown> = {};
  if (ctx.lastPlayerId) patch["playerId"] = ctx.lastPlayerId;
  if (ctx.lastCharacterId) patch["selectedCharacterId"] = ctx.lastCharacterId;
  if (ctx.lastGearId) patch["selectedGearId"] = ctx.lastGearId;
  if (opts?.includeApiKey && opts.apiKey) {
    patch["apiKey"] = opts.apiKey;
  }
  localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify({ ...existing, ...patch }));
}

/**
 * Add player to GM's known registry and select it.
 * apiKey is only written if `includeApiKey` is explicitly true.
 * Merges over existing values.
 */
export function pushToGm(
  ctx: RuntimeContext,
  opts?: { apiKey?: string; includeApiKey?: boolean },
): void {
  let existing: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem(GM_STORAGE_KEY);
    if (raw) existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // ignore
  }
  // Add playerId to knownPlayerIds if not already there
  const knownIds = Array.isArray(existing["knownPlayerIds"])
    ? (existing["knownPlayerIds"] as string[])
    : [];
  if (ctx.lastPlayerId && !knownIds.includes(ctx.lastPlayerId)) {
    knownIds.push(ctx.lastPlayerId);
  }
  const patch: Record<string, unknown> = {
    knownPlayerIds: knownIds,
  };
  if (ctx.lastPlayerId) patch["selectedPlayerId"] = ctx.lastPlayerId;
  if (ctx.lastCharacterId) patch["selectedCharacterId"] = ctx.lastCharacterId;
  if (opts?.includeApiKey && opts.apiKey) {
    patch["apiKey"] = opts.apiKey;
  }
  localStorage.setItem(GM_STORAGE_KEY, JSON.stringify({ ...existing, ...patch }));
}
