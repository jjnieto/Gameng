/**
 * Sync schemas and presets from the repo root into the sandbox web app.
 *
 * Copies:
 *   schemas/game_config.schema.json  →  sandbox/apps/web/src/schemas/
 *   examples/config_minimal.json     →  sandbox/apps/web/src/presets/
 *   examples/config_sets.json        →  sandbox/apps/web/src/presets/
 *
 * Run via: npm run sandbox:sync
 */

import { cpSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const webSrc = resolve(root, "sandbox", "apps", "web", "src");

const copies = [
  {
    from: resolve(root, "schemas", "game_config.schema.json"),
    to: resolve(webSrc, "schemas", "game_config.schema.json"),
  },
  {
    from: resolve(root, "examples", "config_minimal.json"),
    to: resolve(webSrc, "presets", "config_minimal.json"),
  },
  {
    from: resolve(root, "examples", "config_sets.json"),
    to: resolve(webSrc, "presets", "config_sets.json"),
  },
];

let changed = 0;
for (const { from, to } of copies) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  changed++;
}

console.log(`sandbox:sync — ${String(changed)} files synced`);
