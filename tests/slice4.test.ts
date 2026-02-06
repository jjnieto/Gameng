import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
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

interface TransactionResult {
  txId: string;
  accepted: boolean;
  stateVersion: number;
  errorCode?: string;
  errorMessage?: string;
}

interface GearInstance {
  gearDefId: string;
  level: number;
  equippedBy?: string | null;
}

interface PlayerState {
  characters: Record<string, unknown>;
  gear: Record<string, GearInstance>;
}

describe("Slice 4 — Gear + Inventory", () => {
  const ADMIN_KEY = "test-admin-key-slice4";
  const TEST_API_KEY = "test-key-slice4";
  let app: FastifyInstance;
  let version: number;

  function postTx(payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload,
    });
  }

  beforeAll(async () => {
    app = createApp({ adminApiKey: ADMIN_KEY });
    await app.ready();

    // Bootstrap: CreateActor (requires admin key)
    await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      payload: {
        txId: "s4_setup_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "test_actor",
        apiKey: TEST_API_KEY,
      },
    });

    // Seed: create a player
    const res = await postTx({
      txId: "s4_setup_001",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "player_1",
    });
    version = res.json<TransactionResult>().stateVersion;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("CreateGear", () => {
    it("accepts CreateGear with valid gearDefId", async () => {
      const res = await postTx({
        txId: "s4_cg_001",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_1",
        gearDefId: "sword_basic",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);
      expect(body.stateVersion).toBe(version + 1);
      version = body.stateVersion;
    });

    it("response validates against transaction_result schema", async () => {
      const validate = compileSchema("schemas/transaction_result.schema.json");
      const res = await postTx({
        txId: "s4_cg_002",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_2",
        gearDefId: "sword_basic",
      });

      const body: unknown = res.json();
      const valid = validate(body);
      if (!valid) {
        const messages = (validate.errors ?? [])
          .map((e) => `${e.instancePath || "/"}: ${e.message}`)
          .join("\n");
        expect.fail(`Schema validation failed:\n${messages}`);
      }
      version = res.json<TransactionResult>().stateVersion;
    });

    it("rejects duplicate gearId with ALREADY_EXISTS", async () => {
      const res = await postTx({
        txId: "s4_cg_003",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_1",
        gearDefId: "sword_basic",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("ALREADY_EXISTS");
      expect(body.stateVersion).toBe(version);
    });

    it("rejects invalid gearDefId with INVALID_CONFIG_REFERENCE", async () => {
      const res = await postTx({
        txId: "s4_cg_004",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_bad",
        gearDefId: "nonexistent_weapon",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("INVALID_CONFIG_REFERENCE");
      expect(body.stateVersion).toBe(version);
    });

    it("rejects if player does not exist", async () => {
      const res = await postTx({
        txId: "s4_cg_005",
        type: "CreateGear",
        gameInstanceId: "instance_001",
        playerId: "nobody",
        gearId: "gear_x",
        gearDefId: "sword_basic",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("OWNERSHIP_VIOLATION");
    });
  });

  describe("GET player includes gear inventory", () => {
    it("returns gear in player state after creation", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<PlayerState>();
      expect(body.gear).toHaveProperty("gear_1");
      expect(body.gear.gear_1).toEqual({
        gearDefId: "sword_basic",
        level: 1,
      });
      expect(body.gear).toHaveProperty("gear_2");
    });
  });

  describe("LevelUpGear", () => {
    it("levels up by 1 (default)", async () => {
      const res = await postTx({
        txId: "s4_lg_001",
        type: "LevelUpGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);
      version = body.stateVersion;
    });

    it("levels up by explicit levels", async () => {
      // gear_1 is now level 2, level up by 3 → level 5
      const res = await postTx({
        txId: "s4_lg_002",
        type: "LevelUpGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_1",
        levels: 3,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);
      version = body.stateVersion;
    });

    it("gear level is reflected in player state", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<PlayerState>();
      expect(body.gear.gear_1.level).toBe(5);
    });

    it("rejects level up beyond maxLevel with MAX_LEVEL_REACHED", async () => {
      // gear_1 is level 5, maxLevel is 10, try +6 → 11
      const res = await postTx({
        txId: "s4_lg_003",
        type: "LevelUpGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_1",
        levels: 6,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("MAX_LEVEL_REACHED");
      expect(body.stateVersion).toBe(version);
    });

    it("rejects level up when already at maxLevel", async () => {
      // Level gear_1 to max (5 more to reach 10)
      await postTx({
        txId: "s4_lg_004",
        type: "LevelUpGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_1",
        levels: 5,
      });
      version++;

      // Now at 10, try +1
      const res = await postTx({
        txId: "s4_lg_005",
        type: "LevelUpGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("MAX_LEVEL_REACHED");
      expect(body.stateVersion).toBe(version);
    });

    it("rejects if gear does not exist", async () => {
      const res = await postTx({
        txId: "s4_lg_006",
        type: "LevelUpGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "nonexistent",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("GEAR_NOT_FOUND");
    });

    it("rejects if player does not exist", async () => {
      const res = await postTx({
        txId: "s4_lg_007",
        type: "LevelUpGear",
        gameInstanceId: "instance_001",
        playerId: "nobody",
        gearId: "gear_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("OWNERSHIP_VIOLATION");
    });
  });
});
