// -- State domain types --

import type { TxIdCacheEntry } from "./idempotency-store.js";

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

export interface Player {
  characters: Record<string, Character>;
  gear: Record<string, GearInstance>;
  resources?: Record<string, number>;
}

export interface Actor {
  apiKey: string;
  playerIds: string[];
}

export interface GameState {
  gameInstanceId: string;
  gameConfigId: string;
  stateVersion: number;
  players: Record<string, Player>;
  actors: Record<string, Actor>;
  txIdCache: TxIdCacheEntry[];
}

// -- Config domain types --

export interface ClassDef {
  baseStats: Record<string, number>;
}

export interface GearRestrictions {
  allowedClasses?: string[];
  blockedClasses?: string[];
  requiredCharacterLevel?: number;
  maxLevelDelta?: number;
}

export interface GearDef {
  baseStats: Record<string, number>;
  equipPatterns: string[][];
  setId?: string;
  restrictions?: GearRestrictions;
  setPieceCount?: number;
}

export interface SetBonus {
  pieces: number;
  bonusStats: Record<string, number>;
}

export interface SetDef {
  bonuses: SetBonus[];
}

export interface StatClamp {
  min?: number;
  max?: number;
}

export interface GameConfig {
  gameConfigId: string;
  maxLevel: number;
  stats: string[];
  slots: string[];
  classes: Record<string, ClassDef>;
  gearDefs: Record<string, GearDef>;
  sets: Record<string, SetDef>;
  algorithms: {
    growth: { algorithmId: string; params?: Record<string, unknown> };
    levelCostCharacter: {
      algorithmId: string;
      params?: Record<string, unknown>;
    };
    levelCostGear: { algorithmId: string; params?: Record<string, unknown> };
  };
  statClamps?: Record<string, StatClamp>;
}

// -- Store factory --

export function createGameInstanceStore(
  gameConfigId: string,
): Map<string, GameState> {
  const store = new Map<string, GameState>();
  store.set("instance_001", {
    gameInstanceId: "instance_001",
    gameConfigId,
    stateVersion: 0,
    players: {},
    actors: {},
    txIdCache: [],
  });
  return store;
}

declare module "fastify" {
  interface FastifyInstance {
    gameInstances: Map<string, GameState>;
    gameConfigs: Map<string, GameConfig>;
    activeConfig: GameConfig;
    flushSnapshots: () => void;
    adminApiKey: string | undefined;
    txIdCacheMaxEntries: number;
  }
}
