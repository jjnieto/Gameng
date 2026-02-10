export type StatMap = Record<string, number>;
export type GrowthFn = (
  baseStats: StatMap,
  level: number,
  params: Record<string, unknown>,
) => StatMap;

// -- Algorithm implementations --

const flat: GrowthFn = (baseStats) => {
  const result: StatMap = {};
  for (const [stat, value] of Object.entries(baseStats)) {
    result[stat] = Math.floor(value);
  }
  return result;
};

const linear: GrowthFn = (baseStats, level, params) => {
  const perLevelMultiplier = params.perLevelMultiplier;
  if (typeof perLevelMultiplier !== "number") {
    throw new Error(
      "linear growth: 'perLevelMultiplier' must be a number in params.",
    );
  }
  const additivePerLevel =
    (params.additivePerLevel as Record<string, number> | undefined) ?? {};
  const lvlDelta = level - 1;
  const result: StatMap = {};
  for (const [stat, base] of Object.entries(baseStats)) {
    const additive = additivePerLevel[stat] ?? 0;
    result[stat] = Math.floor(
      base * (1 + perLevelMultiplier * lvlDelta) + additive * lvlDelta,
    );
  }
  return result;
};

const exponential: GrowthFn = (baseStats, level, params) => {
  const exponent = params.exponent;
  if (typeof exponent !== "number") {
    throw new Error(
      "exponential growth: 'exponent' must be a number in params.",
    );
  }
  const lvlDelta = level - 1;
  const result: StatMap = {};
  for (const [stat, base] of Object.entries(baseStats)) {
    result[stat] = Math.floor(base * Math.pow(exponent, lvlDelta));
  }
  return result;
};

// -- Registry --

export const growthRegistry: Record<string, GrowthFn> = {
  flat,
  linear,
  exponential,
};

// -- Catalog metadata --

import type { AlgorithmMeta } from "./index.js";

export const growthCatalog: Record<string, AlgorithmMeta> = {
  flat: {
    description: "Returns base stats as-is (floor). No scaling by level.",
    params: {},
  },
  linear: {
    description:
      "Scales stats linearly: base * (1 + perLevelMultiplier * (level-1)) + additivePerLevel * (level-1).",
    params: {
      perLevelMultiplier: "number — multiplicative scaling factor per level",
      "additivePerLevel?":
        "Record<string, number> — optional flat bonus per stat per level",
    },
  },
  exponential: {
    description: "Scales stats exponentially: base * exponent^(level-1).",
    params: {
      exponent: "number — exponential base applied per level",
    },
  },
};

// -- Public helper --

export function applyGrowth(
  baseStats: StatMap,
  level: number,
  algorithmRef: { algorithmId: string; params?: Record<string, unknown> },
): StatMap {
  const effectiveLevel = level < 1 ? 1 : level;
  const fn = growthRegistry[algorithmRef.algorithmId];
  if (!fn) {
    throw new Error(`Unknown growth algorithmId: '${algorithmRef.algorithmId}'`);
  }
  return fn(baseStats, effectiveLevel, algorithmRef.params ?? {});
}
