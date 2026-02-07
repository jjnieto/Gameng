import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(resolve(root, relativePath), "utf-8"));
}

const mappings: Array<{ schema: string; example: string }> = [
  {
    schema: "schemas/game_config.schema.json",
    example: "examples/config_minimal.json",
  },
  {
    schema: "schemas/game_config.schema.json",
    example: "examples/config_sets.json",
  },
  {
    schema: "schemas/game_state.schema.json",
    example: "examples/state_empty.json",
  },
  {
    schema: "schemas/transaction.schema.json",
    example: "examples/tx_create_player.json",
  },
  {
    schema: "schemas/transaction_result.schema.json",
    example: "examples/expected_create_player.json",
  },
  {
    schema: "schemas/transaction.schema.json",
    example: "examples/tx_create_actor.json",
  },
  {
    schema: "schemas/game_config.schema.json",
    example: "examples/config_costs.json",
  },
  {
    schema: "schemas/game_config.schema.json",
    example: "examples/config_clamps.json",
  },
  {
    schema: "schemas/transaction.schema.json",
    example: "examples/tx_grant_resources.json",
  },
];

const ajv = new Ajv({ allErrors: true });
const compiledCache = new Map<string, ReturnType<typeof ajv.compile>>();
let hasErrors = false;

for (const { schema, example } of mappings) {
  let validate = compiledCache.get(schema);
  if (!validate) {
    const schemaObj = loadJson(schema);
    validate = ajv.compile(schemaObj as object);
    compiledCache.set(schema, validate);
  }
  const data = loadJson(example);
  const valid = validate(data);
  if (valid) {
    console.log(`  ✓ ${example} validates against ${schema}`);
  } else {
    console.error(`  ✗ ${example} FAILS against ${schema}:`);
    for (const err of validate.errors ?? []) {
      console.error(`    - ${err.instancePath || "/"}: ${err.message}`);
    }
    hasErrors = true;
  }
}

if (hasErrors) {
  process.exit(1);
} else {
  console.log("\nAll examples valid.");
}
