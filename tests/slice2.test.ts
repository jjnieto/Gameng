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

interface Player {
  characters: Record<string, unknown>;
  gear: Record<string, unknown>;
}

describe("Slice 2 — Players + Ownership", () => {
  let app: FastifyInstance;
  const ADMIN_KEY = "test-admin-key-slice2";
  const TEST_API_KEY = "test-key-slice2";

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
        txId: "s2_setup_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "test_actor",
        apiKey: TEST_API_KEY,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /:gameInstanceId/tx — CreatePlayer", () => {
    it("accepts CreatePlayer and returns stateVersion 2", async () => {
      const response = await postTx({
        txId: "tx_001",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_1",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<TransactionResult>();
      expect(body.accepted).toBe(true);
      expect(body.txId).toBe("tx_001");
      expect(body.stateVersion).toBe(2);
    });

    it("response validates against transaction_result schema", async () => {
      const validate = compileSchema("schemas/transaction_result.schema.json");
      const response = await postTx({
        txId: "tx_002",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_2",
      });

      const body: unknown = response.json();
      const valid = validate(body);
      if (!valid) {
        const messages = (validate.errors ?? [])
          .map((e) => `${e.instancePath || "/"}: ${e.message}`)
          .join("\n");
        expect.fail(`Schema validation failed:\n${messages}`);
      }
    });

    it("rejects duplicate playerId with ALREADY_EXISTS", async () => {
      // player_1 was already created in the first test
      const response = await postTx({
        txId: "tx_003",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_1",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("ALREADY_EXISTS");
      // stateVersion should not have incremented (was 3 after player_2)
      expect(body.stateVersion).toBe(3);
    });

    it("returns 404 with INSTANCE_NOT_FOUND for unknown game instance", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/unknown_instance/tx",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
        payload: {
          txId: "tx_004",
          type: "CreatePlayer",
          gameInstanceId: "unknown_instance",
          playerId: "player_1",
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json<{ errorCode: string }>();
      expect(body.errorCode).toBe("INSTANCE_NOT_FOUND");
    });

    it("returns 400 when gameInstanceId in body mismatches path", async () => {
      const response = await postTx({
        txId: "tx_005",
        type: "CreatePlayer",
        gameInstanceId: "wrong_instance",
        playerId: "player_99",
      });

      expect(response.statusCode).toBe(400);
    });

    it("rejects unsupported tx type with UNSUPPORTED_TX_TYPE and does not mutate state", async () => {
      // Capture version before sending unsupported tx
      const before = await postTx({
        txId: "tx_006_pre",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_1",
      });
      const versionBefore = before.json<TransactionResult>().stateVersion;

      const response = await postTx({
        txId: "tx_006",
        type: "DeletePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_1",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("UNSUPPORTED_TX_TYPE");
      expect(body.txId).toBe("tx_006");
      expect(body.stateVersion).toBe(versionBefore);
    });

    it("UNSUPPORTED_TX_TYPE response validates against transaction_result schema", async () => {
      const validate = compileSchema("schemas/transaction_result.schema.json");
      const response = await postTx({
        txId: "tx_007",
        type: "DeletePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_1",
      });

      expect(response.statusCode).toBe(200);
      const body: unknown = response.json();
      const valid = validate(body);
      if (!valid) {
        const messages = (validate.errors ?? [])
          .map((e) => `${e.instancePath || "/"}: ${e.message}`)
          .join("\n");
        expect.fail(`Schema validation failed:\n${messages}`);
      }
    });
  });

  describe("GET /:gameInstanceId/state/player/:playerId", () => {
    it("returns player data after creation", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<Player>();
      expect(body).toEqual({ characters: {}, gear: {} });
    });

    it("returns 403 with OWNERSHIP_VIOLATION for nonexistent player (ownership checked first)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/nobody",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json<{ errorCode: string }>();
      expect(body.errorCode).toBe("OWNERSHIP_VIOLATION");
    });

    it("returns 404 with INSTANCE_NOT_FOUND for unknown game instance", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/unknown_instance/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json<{ errorCode: string }>();
      expect(body.errorCode).toBe("INSTANCE_NOT_FOUND");
    });
  });
});
