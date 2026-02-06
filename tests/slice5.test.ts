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

interface CharacterState {
  classId: string;
  level: number;
  equipped: Record<string, string>;
}

interface PlayerState {
  characters: Record<string, CharacterState>;
  gear: Record<string, GearInstance>;
}

interface CharacterStats {
  characterId: string;
  classId: string;
  level: number;
  finalStats: Record<string, number>;
}

describe("Slice 5 — Equipment (1 slot) + Stats Sum", () => {
  const ADMIN_KEY = "test-admin-key-slice5";
  const TEST_API_KEY = "test-key-slice5";
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
        txId: "s5_setup_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "test_actor",
        apiKey: TEST_API_KEY,
      },
    });

    // Seed: CreatePlayer
    const p = await postTx({
      txId: "s5_setup_001",
      type: "CreatePlayer",
      gameInstanceId: "instance_001",
      playerId: "player_1",
    });
    version = p.json<TransactionResult>().stateVersion;

    // Seed: CreateCharacter (char_1, warrior)
    const c = await postTx({
      txId: "s5_setup_002",
      type: "CreateCharacter",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      characterId: "char_1",
      classId: "warrior",
    });
    version = c.json<TransactionResult>().stateVersion;

    // Seed: CreateGear (gear_1, sword_basic)
    const g1 = await postTx({
      txId: "s5_setup_003",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "gear_1",
      gearDefId: "sword_basic",
    });
    version = g1.json<TransactionResult>().stateVersion;

    // Seed: CreateGear (gear_2, sword_basic)
    const g2 = await postTx({
      txId: "s5_setup_004",
      type: "CreateGear",
      gameInstanceId: "instance_001",
      playerId: "player_1",
      gearId: "gear_2",
      gearDefId: "sword_basic",
    });
    version = g2.json<TransactionResult>().stateVersion;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("EquipGear", () => {
    it("accepts EquipGear: equip gear_1 to char_1", async () => {
      const res = await postTx({
        txId: "s5_eq_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_1",
        characterId: "char_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);
      expect(body.stateVersion).toBe(version + 1);
      version = body.stateVersion;
    });

    it("response validates against transaction_result schema", async () => {
      const validate = compileSchema("schemas/transaction_result.schema.json");
      // Use the result of a second equip attempt (already equipped) for schema validation
      const res = await postTx({
        txId: "s5_eq_002",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_1",
        characterId: "char_1",
      });

      const body: unknown = res.json();
      const valid = validate(body);
      if (!valid) {
        const messages = (validate.errors ?? [])
          .map((e) => `${e.instancePath || "/"}: ${e.message}`)
          .join("\n");
        expect.fail(`Schema validation failed:\n${messages}`);
      }
    });

    it("player state reflects equip (gear.equippedBy and character.equipped)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<PlayerState>();
      expect(body.gear.gear_1.equippedBy).toBe("char_1");
      expect(body.characters.char_1.equipped).toEqual({
        right_hand: "gear_1",
      });
    });

    it("rejects SLOT_OCCUPIED when equipping gear_2 to same slot", async () => {
      const res = await postTx({
        txId: "s5_eq_003",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_2",
        characterId: "char_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("SLOT_OCCUPIED");
      expect(body.stateVersion).toBe(version);
    });

    it("rejects GEAR_ALREADY_EQUIPPED when gear is already equipped", async () => {
      // Create a second character to try equipping gear_1 (already on char_1)
      await postTx({
        txId: "s5_eq_004a",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        characterId: "char_2",
        classId: "warrior",
      });
      version++;

      const res = await postTx({
        txId: "s5_eq_004",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_1",
        characterId: "char_2",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("GEAR_ALREADY_EQUIPPED");
      expect(body.stateVersion).toBe(version);
    });

    it("rejects GEAR_NOT_FOUND for nonexistent gearId", async () => {
      const res = await postTx({
        txId: "s5_eq_005",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "nonexistent",
        characterId: "char_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("GEAR_NOT_FOUND");
    });

    it("rejects CHARACTER_NOT_FOUND for nonexistent characterId", async () => {
      const res = await postTx({
        txId: "s5_eq_006",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_2",
        characterId: "nonexistent",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("CHARACTER_NOT_FOUND");
    });

    it("rejects OWNERSHIP_VIOLATION for nonexistent playerId", async () => {
      const res = await postTx({
        txId: "s5_eq_007",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "nobody",
        gearId: "gear_1",
        characterId: "char_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("OWNERSHIP_VIOLATION");
    });

    it("rejects INVALID_SLOT when slotPattern contains nonexistent slot", async () => {
      const res = await postTx({
        txId: "s5_eq_008",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_2",
        characterId: "char_1",
        slotPattern: ["nonexistent_slot"],
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("INVALID_SLOT");
    });
  });

  describe("UnequipGear", () => {
    it("accepts UnequipGear: unequip gear_1", async () => {
      const res = await postTx({
        txId: "s5_uq_001",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(true);
      expect(body.stateVersion).toBe(version + 1);
      version = body.stateVersion;
    });

    it("player state reflects unequip (equippedBy null, slot freed)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<PlayerState>();
      expect(body.gear.gear_1.equippedBy).toBeNull();
      expect(body.characters.char_1.equipped).toEqual({});
    });

    it("rejects GEAR_NOT_EQUIPPED when gear is not equipped", async () => {
      const res = await postTx({
        txId: "s5_uq_002",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("GEAR_NOT_EQUIPPED");
      expect(body.stateVersion).toBe(version);
    });

    it("rejects GEAR_NOT_FOUND for nonexistent gearId", async () => {
      const res = await postTx({
        txId: "s5_uq_003",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "nonexistent",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("GEAR_NOT_FOUND");
    });

    it("rejects OWNERSHIP_VIOLATION for nonexistent playerId", async () => {
      const res = await postTx({
        txId: "s5_uq_004",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "nobody",
        gearId: "gear_1",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("OWNERSHIP_VIOLATION");
    });

    it("rejects CHARACTER_MISMATCH when wrong characterId hint is provided", async () => {
      // Re-equip gear_1 first
      await postTx({
        txId: "s5_uq_005a",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_1",
        characterId: "char_1",
      });
      version++;

      // Try to unequip with wrong characterId
      const res = await postTx({
        txId: "s5_uq_005",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_1",
        characterId: "char_2",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.errorCode).toBe("CHARACTER_MISMATCH");
      expect(body.stateVersion).toBe(version);
    });
  });

  describe("Stats with gear", () => {
    // At this point gear_1 is equipped on char_1 (re-equipped in CHARACTER_MISMATCH test)
    it("finalStats includes gear base stats when gear is equipped", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/instance_001/character/char_1/stats",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<CharacterStats>();
      // warrior base: strength=5, hp=20; sword_basic: strength=3
      expect(body.finalStats).toEqual({ strength: 8, hp: 20 });
    });

    it("finalStats reverts to base stats after unequip", async () => {
      // Unequip gear_1
      await postTx({
        txId: "s5_stats_001",
        type: "UnequipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_1",
      });
      version++;

      const res = await app.inject({
        method: "GET",
        url: "/instance_001/character/char_1/stats",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<CharacterStats>();
      expect(body.finalStats).toEqual({ strength: 5, hp: 20 });
    });
  });

  describe("Consistency", () => {
    it("gear.equippedBy and character.equipped are consistent after equip", async () => {
      // Re-equip gear_1
      await postTx({
        txId: "s5_con_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_1",
        characterId: "char_1",
      });
      version++;

      const res = await app.inject({
        method: "GET",
        url: "/instance_001/state/player/player_1",
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
      });

      const body = res.json<PlayerState>();
      expect(body.gear.gear_1.equippedBy).toBe("char_1");
      expect(body.characters.char_1.equipped.right_hand).toBe("gear_1");
    });
  });

  describe("Atomicity", () => {
    it("failed equip does not change stateVersion", async () => {
      const versionBefore = version;

      // This should fail (SLOT_OCCUPIED since gear_1 is in right_hand)
      const res = await postTx({
        txId: "s5_atom_001",
        type: "EquipGear",
        gameInstanceId: "instance_001",
        playerId: "player_1",
        gearId: "gear_2",
        characterId: "char_1",
      });

      const body = res.json<TransactionResult>();
      expect(body.accepted).toBe(false);
      expect(body.stateVersion).toBe(versionBefore);
    });
  });
});
