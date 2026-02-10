import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv, type ErrorObject } from "ajv";
import type { GameConfig } from "./state.js";
import {
  growthRegistry,
  levelCostRegistry,
} from "./algorithms/index.js";

const DEFAULT_CONFIG_PATH = "examples/config_minimal.json";
const SCHEMA_PATH = "schemas/game_config.schema.json";

export function loadGameConfig(configPath?: string): GameConfig {
  const path = configPath ?? process.env.CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
  const resolvedPath = resolve(path);

  const raw = readFileSync(resolvedPath, "utf-8");
  const data: unknown = JSON.parse(raw);

  const schemaRaw = readFileSync(resolve(SCHEMA_PATH), "utf-8");
  const schema: unknown = JSON.parse(schemaRaw);

  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema as object);

  if (!validate(data)) {
    const messages = (validate.errors ?? [])
      .map((e: ErrorObject) => `${e.instancePath || "/"}: ${e.message}`)
      .join("\n");
    throw new Error(
      `GameConfig validation failed for '${resolvedPath}':\n${messages}`,
    );
  }

  validateAlgorithmIds(data as GameConfig);

  return data as GameConfig;
}

function validateAlgorithmIds(config: GameConfig): void {
  const growthId = config.algorithms.growth.algorithmId;
  if (!(growthId in growthRegistry)) {
    const available = Object.keys(growthRegistry).join(", ");
    throw new Error(
      `Unknown growth algorithmId: '${growthId}'. Available: ${available}`,
    );
  }

  const charCostId = config.algorithms.levelCostCharacter.algorithmId;
  if (!(charCostId in levelCostRegistry)) {
    const available = Object.keys(levelCostRegistry).join(", ");
    throw new Error(
      `Unknown levelCostCharacter algorithmId: '${charCostId}'. Available: ${available}`,
    );
  }

  const gearCostId = config.algorithms.levelCostGear.algorithmId;
  if (!(gearCostId in levelCostRegistry)) {
    const available = Object.keys(levelCostRegistry).join(", ");
    throw new Error(
      `Unknown levelCostGear algorithmId: '${gearCostId}'. Available: ${available}`,
    );
  }
}
