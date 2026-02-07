// Minimal engine types — hand-written to match the real API.
// NOT auto-generated from OpenAPI (yet).

// ---- Health ----

export interface HealthResponse {
  status: string;
  timestamp: string;
  uptime: number;
}

// ---- State version ----

export interface StateVersionResponse {
  gameInstanceId: string;
  stateVersion: number;
}

// ---- Transactions ----

export interface TransactionRequest {
  txId: string;
  type: string;
  gameInstanceId: string;
  playerId?: string;
  characterId?: string;
  classId?: string;
  gearId?: string;
  gearDefId?: string;
  levels?: number;
  slotPattern?: string[];
  swap?: boolean;
  actorId?: string;
  apiKey?: string;
  resources?: Record<string, number>;
}

export interface TxResponse {
  txId: string;
  accepted: boolean;
  stateVersion: number;
  errorCode?: string;
  errorMessage?: string;
}

// ---- Player state ----

export interface Character {
  classId: string;
  level: number;
  equipped: Record<string, string>;
}

export interface GearInstance {
  gearDefId: string;
  level: number;
  equippedBy?: string | null;
}

export interface PlayerState {
  characters: Record<string, Character>;
  gear: Record<string, GearInstance>;
  resources?: Record<string, number>;
}

// ---- Stats ----

export interface StatsResponse {
  characterId: string;
  classId: string;
  level: number;
  finalStats: Record<string, number>;
}

// ---- Config (subset used by UI) ----

export interface GameConfig {
  gameConfigId: string;
  maxLevel: number;
  stats: string[];
  slots: string[];
  classes: Record<string, { baseStats: Record<string, number> }>;
  gearDefs: Record<string, unknown>;
  sets: Record<string, unknown>;
  algorithms: Record<string, unknown>;
  statClamps?: Record<string, unknown>;
}

// ---- Error body from non-200 responses ----

export interface ErrorBody {
  errorCode?: string;
  errorMessage?: string;
  error?: string;
}
