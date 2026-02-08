import { describe, it, expect } from "vitest";
import Ajv, { type ValidateFunction } from "ajv";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf-8"));
}

const ajv = new Ajv({ allErrors: true });

function compileSchema(schemaPath: string): ValidateFunction {
  const schema = loadJson(schemaPath) as Record<string, unknown>;
  const id = schema.$id as string | undefined;
  if (id) {
    const existing = ajv.getSchema(id);
    if (existing) return existing;
  }
  return ajv.compile(schema);
}

function expectValid(validate: ValidateFunction, data: unknown): void {
  const valid = validate(data);
  if (!valid) {
    const messages = (validate.errors ?? [])
      .map((e) => `${e.instancePath || "/"}: ${e.message}`)
      .join("\n");
    expect.fail(`Schema validation failed:\n${messages}`);
  }
}

describe("JSON Schema validation — examples match schemas", () => {
  it("config_minimal.json validates against game_config.schema.json", () => {
    const validate = compileSchema("schemas/game_config.schema.json");
    const data = loadJson("examples/config_minimal.json");
    expectValid(validate, data);
  });

  it("config_sets.json validates against game_config.schema.json", () => {
    const validate = compileSchema("schemas/game_config.schema.json");
    const data = loadJson("examples/config_sets.json");
    expectValid(validate, data);
  });

  it("state_empty.json validates against game_state.schema.json", () => {
    const validate = compileSchema("schemas/game_state.schema.json");
    const data = loadJson("examples/state_empty.json");
    expectValid(validate, data);
  });

  it("tx_create_player.json validates against transaction.schema.json", () => {
    const validate = compileSchema("schemas/transaction.schema.json");
    const data = loadJson("examples/tx_create_player.json");
    expectValid(validate, data);
  });

  it("expected_create_player.json validates against transaction_result.schema.json", () => {
    const validate = compileSchema("schemas/transaction_result.schema.json");
    const data = loadJson("examples/expected_create_player.json");
    expectValid(validate, data);
  });

  it("tx_grant_character_resources.json validates against transaction.schema.json", () => {
    const validate = compileSchema("schemas/transaction.schema.json");
    const data = loadJson("examples/tx_grant_character_resources.json");
    expectValid(validate, data);
  });

  it("rejects gearDef with both allowedClasses and blockedClasses", () => {
    const validate = compileSchema("schemas/game_config.schema.json");
    const config = {
      gameConfigId: "test_mutual_exclusion",
      maxLevel: 10,
      stats: ["strength"],
      slots: ["right_hand"],
      classes: { warrior: { baseStats: { strength: 5 } } },
      gearDefs: {
        sword: {
          baseStats: { strength: 2 },
          equipPatterns: [["right_hand"]],
          restrictions: {
            allowedClasses: ["warrior"],
            blockedClasses: ["mage"],
          },
        },
      },
      sets: {},
      algorithms: {
        growth: { algorithmId: "flat", params: {} },
        levelCostCharacter: { algorithmId: "flat", params: {} },
        levelCostGear: { algorithmId: "flat", params: {} },
      },
    };
    const valid = validate(config);
    expect(valid).toBe(false);
  });
});
