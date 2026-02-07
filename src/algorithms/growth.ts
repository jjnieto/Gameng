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

const registry: Record<string, GrowthFn> = {
  flat,
  linear,
  exponential,
};

// -- Public helper --

export function applyGrowth(
  baseStats: StatMap,
  level: number,
  algorithmRef: { algorithmId: string; params?: Record<string, unknown> },
): StatMap {
  const effectiveLevel = level < 1 ? 1 : level;
  const fn = registry[algorithmRef.algorithmId];
  if (!fn) {
    throw new Error(`Unknown growth algorithmId: '${algorithmRef.algorithmId}'`);
  }
  return fn(baseStats, effectiveLevel, algorithmRef.params ?? {});
}
