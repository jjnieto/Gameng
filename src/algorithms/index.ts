export interface AlgorithmMeta {
  description: string;
  params: Record<string, string>;
}

export { growthRegistry, growthCatalog } from "./growth.js";
export { levelCostRegistry, levelCostCatalog } from "./level-cost.js";

import { growthCatalog } from "./growth.js";
import { levelCostCatalog } from "./level-cost.js";

export function getFullCatalog(): {
  growth: Record<string, AlgorithmMeta>;
  levelCost: Record<string, AlgorithmMeta>;
} {
  return {
    growth: growthCatalog,
    levelCost: levelCostCatalog,
  };
}
