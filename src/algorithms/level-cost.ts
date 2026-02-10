export type ResourceMap = Record<string, number>;
export type LevelCostFn = (
  targetLevel: number,
  params: Record<string, unknown>,
) => ResourceMap;

export interface ScopedCost {
  player: ResourceMap;
  character: ResourceMap;
}

/**
 * Parse a flat cost map with prefixed keys into scoped player/character wallets.
 * Keys must be prefixed with "player." or "character.".
 * Empty cost maps (from flat algorithm) are fine and return empty scopes.
 * Throws on unprefixed keys.
 */
export function parseScopedCost(cost: ResourceMap): ScopedCost {
  const result: ScopedCost = { player: {}, character: {} };
  for (const [key, amount] of Object.entries(cost)) {
    if (key.startsWith("player.")) {
      result.player[key.slice(7)] = amount;
    } else if (key.startsWith("character.")) {
      result.character[key.slice(10)] = amount;
    } else {
      throw new Error(
        `Invalid cost resource key '${key}': must be prefixed with 'player.' or 'character.'.`,
      );
    }
  }
  return result;
}

// -- Algorithm implementations --

/** Always returns empty cost (free level-ups). */
const flat: LevelCostFn = () => ({});

/**
 * Linear cost: cost = base + perLevel * (targetLevel - 2)
 * For targetLevel <= 1, cost is 0 (defensive).
 * params: { resourceId: string, base: number, perLevel: number }
 */
const linearCost: LevelCostFn = (targetLevel, params) => {
  const resourceId = params.resourceId;
  if (typeof resourceId !== "string") {
    throw new Error(
      "linear_cost: 'resourceId' must be a string in params.",
    );
  }
  const base = params.base;
  if (typeof base !== "number") {
    throw new Error("linear_cost: 'base' must be a number in params.");
  }
  const perLevel = params.perLevel;
  if (typeof perLevel !== "number") {
    throw new Error("linear_cost: 'perLevel' must be a number in params.");
  }
  if (targetLevel <= 1) return {};
  const cost = base + perLevel * (targetLevel - 2);
  return { [resourceId]: cost };
};

/**
 * Mixed linear cost: produces multiple prefixed cost keys from an array of cost components.
 * params.costs: Array<{ scope: "player"|"character", resourceId: string, base: number, perLevel: number }>
 */
const mixedLinearCost: LevelCostFn = (targetLevel, params) => {
  const costs = params.costs;
  if (!Array.isArray(costs)) {
    throw new Error(
      "mixed_linear_cost: 'costs' must be an array in params.",
    );
  }
  if (targetLevel <= 1) return {};
  const result: ResourceMap = {};
  for (const entry of costs) {
    const e = entry as Record<string, unknown>;
    const scope = e.scope;
    if (scope !== "player" && scope !== "character") {
      throw new Error(
        "mixed_linear_cost: each cost entry must have scope 'player' or 'character'.",
      );
    }
    const resourceId = e.resourceId;
    if (typeof resourceId !== "string") {
      throw new Error(
        "mixed_linear_cost: each cost entry must have a string resourceId.",
      );
    }
    const base = e.base;
    if (typeof base !== "number") {
      throw new Error("mixed_linear_cost: each cost entry must have a number base.");
    }
    const perLevel = e.perLevel;
    if (typeof perLevel !== "number") {
      throw new Error("mixed_linear_cost: each cost entry must have a number perLevel.");
    }
    const cost = base + perLevel * (targetLevel - 2);
    const key = `${scope}.${resourceId}`;
    result[key] = (result[key] ?? 0) + cost;
  }
  return result;
};

// -- Registry --

export const levelCostRegistry: Record<string, LevelCostFn> = {
  flat,
  free: flat,
  linear_cost: linearCost,
  mixed_linear_cost: mixedLinearCost,
};

// -- Catalog metadata --

import type { AlgorithmMeta } from "./index.js";

export const levelCostCatalog: Record<string, AlgorithmMeta> = {
  flat: {
    description: "Always returns empty cost (free level-ups).",
    params: {},
  },
  free: {
    description: "Alias for flat — free level-ups.",
    params: {},
  },
  linear_cost: {
    description:
      "cost = base + perLevel * (targetLevel - 2). Single resource.",
    params: {
      resourceId: "string — resource key to charge",
      base: "number — base cost at level 2",
      perLevel: "number — additional cost per level above 2",
    },
  },
  mixed_linear_cost: {
    description:
      "Multi-resource linear cost with scoped keys (player.*/character.*).",
    params: {
      costs:
        "Array<{ scope: 'player'|'character', resourceId: string, base: number, perLevel: number }>",
    },
  },
};

// -- Public helpers --

export function computeLevelCost(
  targetLevel: number,
  algorithmRef: { algorithmId: string; params?: Record<string, unknown> },
): ResourceMap {
  const fn = levelCostRegistry[algorithmRef.algorithmId];
  if (!fn) {
    throw new Error(
      `Unknown level cost algorithmId: '${algorithmRef.algorithmId}'`,
    );
  }
  return fn(targetLevel, algorithmRef.params ?? {});
}

export function computeTotalCost(
  currentLevel: number,
  levelsToGain: number,
  algorithmRef: { algorithmId: string; params?: Record<string, unknown> },
): ResourceMap {
  const total: ResourceMap = {};
  for (let i = 1; i <= levelsToGain; i++) {
    const targetLevel = currentLevel + i;
    const cost = computeLevelCost(targetLevel, algorithmRef);
    for (const [resourceId, amount] of Object.entries(cost)) {
      total[resourceId] = (total[resourceId] ?? 0) + amount;
    }
  }
  return total;
}

/** Returns true if wallet has enough for all costs. */
export function hasResources(
  wallet: Record<string, number>,
  cost: ResourceMap,
): boolean {
  for (const [resourceId, amount] of Object.entries(cost)) {
    if (amount <= 0) continue;
    if ((wallet[resourceId] ?? 0) < amount) return false;
  }
  return true;
}

/** Deducts cost from wallet in-place. Caller must verify hasResources first. */
export function deductResources(
  wallet: Record<string, number>,
  cost: ResourceMap,
): void {
  for (const [resourceId, amount] of Object.entries(cost)) {
    if (amount <= 0) continue;
    wallet[resourceId] = (wallet[resourceId] ?? 0) - amount;
  }
}
