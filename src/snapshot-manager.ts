import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  readdirSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { Ajv, type ValidateFunction } from "ajv";
import type { GameState } from "./state.js";

const SCHEMA_PATH = "schemas/game_state.schema.json";

export class SnapshotManager {
  private readonly dir: string;
  private readonly validate: ValidateFunction;

  constructor(dir: string) {
    this.dir = resolve(dir);
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }

    const schemaRaw = readFileSync(resolve(SCHEMA_PATH), "utf-8");
    const schema: unknown = JSON.parse(schemaRaw);
    const ajv = new Ajv({ allErrors: true });
    this.validate = ajv.compile(schema as object);
  }

  /** Persist a single GameState to disk (atomic write). */
  saveOne(state: GameState): void {
    const filename = `${state.gameInstanceId}.json`;
    const target = join(this.dir, filename);
    const tmp = `${target}.tmp`;

    const json = JSON.stringify(state, null, 2);

    // Validate before writing
    const data: unknown = JSON.parse(json);
    if (!this.validate(data)) {
      const messages = (this.validate.errors ?? [])
        .map((e) => `${e.instancePath || "/"}: ${e.message}`)
        .join(", ");
      console.error(
        `[snapshot] Skipping save for ${state.gameInstanceId}: validation failed — ${messages}`,
      );
      return;
    }

    // Atomic write: write tmp → delete target → rename
    writeFileSync(tmp, json, "utf-8");
    try {
      if (existsSync(target)) {
        unlinkSync(target);
      }
      renameSync(tmp, target);
    } catch (err) {
      // Clean up tmp on failure
      try {
        unlinkSync(tmp);
      } catch {
        // ignore cleanup errors
      }
      throw err;
    }

    console.log(
      `[snapshot] Saved ${state.gameInstanceId} v${String(state.stateVersion)}`,
    );
  }

  /** Persist all GameState instances from the store. */
  saveAll(store: Map<string, GameState>): void {
    for (const state of store.values()) {
      this.saveOne(state);
    }
  }

  /** Load all valid snapshots from disk. Invalid files are logged and skipped. */
  loadAll(): GameState[] {
    if (!existsSync(this.dir)) {
      return [];
    }

    const entries = readdirSync(this.dir);
    const states: GameState[] = [];

    for (const entry of entries) {
      // Only process .json files, skip .tmp leftovers
      if (!entry.endsWith(".json")) {
        continue;
      }

      const filePath = join(this.dir, entry);
      try {
        const raw = readFileSync(filePath, "utf-8");
        const data: unknown = JSON.parse(raw);

        if (!this.validate(data)) {
          const messages = (this.validate.errors ?? [])
            .map((e) => `${e.instancePath || "/"}: ${e.message}`)
            .join(", ");
          console.warn(
            `[snapshot] Skipping invalid snapshot ${entry}: ${messages}`,
          );
          continue;
        }

        const state = data as GameState;
        states.push(state);
        console.log(
          `[snapshot] Loaded ${state.gameInstanceId} v${String(state.stateVersion)}`,
        );
      } catch (err) {
        console.warn(
          `[snapshot] Skipping unreadable file ${entry}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return states;
  }
}
