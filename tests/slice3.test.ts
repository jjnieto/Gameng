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

interface CharacterStats {
  characterId: string;
  classId: string;
  level: number;
  finalStats: Record<string, number>;
}

describe("Slice 3 — Characters + Level + Base Stats", () => {
  let app: FastifyInstance;
  let version: number;
  const ADMIN_KEY = "test-admin-key-slice3";
  const TEST_API_KEY = "test-key-slice3";

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

    // Bootstrap actor (requires admin key)
    await app.inject({
      method: "POST",
      url: "/instance_001/tx",
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      payload: {
        txId: "s3_setup_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "test_actor",
        apiKey: TEST_API_KEY,
      },
    });

    // Seed: create a player
    const res = await postTx({
      txId: "s3_setup_001",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "player_1",
    });
    version = res.json<TransactionResult>().stateVersion;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("CreateCharacter", () => {
    it("accepts CreateCharacter with valid classId", async () => {
      const res = await postTx({
        txId: "s3_cc_001",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        classId: "warrior",
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
        txId: "s3_cc_002",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_2",
        classId: "warrior",
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

    it("rejects duplicate characterId with ALREADY_EXISTS", async () => {
      const res = await postTx({
        txId: "s3_cc_003",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        classId: "warrior",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("ALREADY_EXISTS");
      expect(body.stateVersion).toBe(version);
    });

    it("rejects invalid classId with INVALID_CONFIG_REFERENCE", async () => {
      const res = await postTx({
        txId: "s3_cc_004",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_bad",
        classId: "mage",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("INVALID_CONFIG_REFERENCE");
      expect(body.stateVersion).toBe(version);
    });

    it("rejects if player does not exist", async () => {
      const res = await postTx({
        txId: "s3_cc_005",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "nobody",
        characterId: "char_x",
        classId: "warrior",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("OWNERSHIP_VIOLATION");
    });
  });

  describe("LevelUpCharacter", () => {
    it("levels up by 1 (default)", async () => {
      const res = await postTx({
        txId: "s3_lu_001",
        type: "LevelUpCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);
      version = body.stateVersion;
    });

    it("levels up by explicit levels", async () => {
      // char_1 is now level 2, level up by 3 → level 5
      const res = await postTx({
        txId: "s3_lu_002",
        type: "LevelUpCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        levels: 3,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);
      version = body.stateVersion;
    });

    it("rejects level up beyond maxLevel with MAX_LEVEL_REACHED", async () => {
      // char_1 is now level 5, maxLevel is 10, try to go +6 → 11
      const res = await postTx({
        txId: "s3_lu_003",
        type: "LevelUpCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        levels: 6,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("MAX_LEVEL_REACHED");
      expect(body.stateVersion).toBe(version);
    });

    it("rejects level up when already at maxLevel", async () => {
      // Level char_1 to max (5 more to reach 10)
      await postTx({
        txId: "s3_lu_004",
        type: "LevelUpCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
        levels: 5,
      });
      version++;

      // Now at 10, try +1
      const res = await postTx({
        txId: "s3_lu_005",
        type: "LevelUpCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("MAX_LEVEL_REACHED");
      expect(body.stateVersion).toBe(version);
    });

    it("rejects if character does not exist", async () => {
      const res = await postTx({
        txId: "s3_lu_006",
        type: "LevelUpCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "nonexistent",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("CHARACTER_NOT_FOUND");
    });
  });

  describe("GET /:gameInstanceId/character/:characterId/stats", () => {
    it("returns base stats for level-1 character (linear growth, level 1 = identity)", async () => {
      // char_2 is still level 1
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/character/char_2/stats",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<CharacterStats>();
      expect(body.characterId).toBe("char_2");
      expect(body.classId).toBe("warrior");
      expect(body.level).toBe(1);
      expect(body.finalStats).toEqual({ strength: 5, hp: 20 });
    });

    it("returns linearly scaled stats at level 10", async () => {
      // char_1 is level 10
      // linear growth: perLevelMultiplier=0.1, additivePerLevel={hp:1}
      // str = floor(5 * (1 + 0.1*9)) = floor(5 * 1.9) = 9
      // hp  = floor(20 * (1 + 0.1*9) + 1*9) = floor(20*1.9 + 9) = 47
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/character/char_1/stats",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<CharacterStats>();
      expect(body.characterId).toBe("char_1");
      expect(body.classId).toBe("warrior");
      expect(body.level).toBe(10);
      expect(body.finalStats).toEqual({ strength: 9, hp: 47 });
    });

    it("response validates against CharacterStats schema (via game_state definitions)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/character/char_2/stats",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      // Manually validate against the OpenAPI CharacterStats shape
      const body = res.json<CharacterStats>();
      expect(body).toHaveProperty("characterId");
      expect(body).toHaveProperty("classId");
      expect(body).toHaveProperty("level");
      expect(body).toHaveProperty("finalStats");
      expect(typeof body.level).toBe("number");
      expect(typeof body.finalStats).toBe("object");
    });

    it("returns 404 with CHARACTER_NOT_FOUND for nonexistent character", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/character/nobody/stats",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json<{ errorCode: string }>();
      expect(body.errorCode).toBe("CHARACTER_NOT_FOUND");
    });

    it("returns 404 with INSTANCE_NOT_FOUND for unknown instance", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/unknown_instance/character/char_1/stats",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json<{ errorCode: string }>();
      expect(body.errorCode).toBe("INSTANCE_NOT_FOUND");
    });
  });
});
