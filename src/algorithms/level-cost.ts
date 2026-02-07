export type ResourceMap = Record<string, number>;
export type LevelCostFn = (
  targetLevel: number,
  params: Record<string, unknown>,
) => ResourceMap;

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

// -- Registry --

const registry: Record<string, LevelCostFn> = {
  flat,
  free: flat,
  linear_cost: linearCost,
};

// -- Public helpers --

export function computeLevelCost(
  targetLevel: number,
  algorithmRef: { algorithmId: string; params?: Record<string, unknown> },
): ResourceMap {
  const fn = registry[algorithmRef.algorithmId];
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
