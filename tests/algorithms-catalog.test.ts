import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  growthRegistry,
  growthCatalog,
  levelCostRegistry,
  levelCostCatalog,
  getFullCatalog,
} from "../src/algorithms/index.js";
import { loadGameConfig } from "../src/config-loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const tmpDir = resolve(root, "test-tmp-algorithms-catalog");

interface AlgorithmMeta {
  description: string;
  params: Record<string, string>;
}

interface CatalogResponse {
  growth: Record<string, AlgorithmMeta>;
  levelCost: Record<string, AlgorithmMeta>;
}

function makeConfig(overrides: {
  growthId?: string;
  charCostId?: string;
  gearCostId?: string;
}): object {
  return {
    gameConfigId: "algo_test_v1",
    maxLevel: 10,
    stats: ["strength"],
    slots: ["right_hand"],
    classes: { warrior: { baseStats: { strength: 5 } } },
    gearDefs: {},
    sets: {},
    algorithms: {
      growth: { algorithmId: overrides.growthId ?? "flat", params: {} },
      levelCostCharacter: {
        algorithmId: overrides.charCostId ?? "flat",
        params: {},
      },
      levelCostGear: {
        algorithmId: overrides.gearCostId ?? "flat",
        params: {},
      },
    },
  };
}

describe("Algorithm Catalog — Registry exports", () => {
  it("growthRegistry contains flat, linear, exponential", () => {
    expect(Object.keys(growthRegistry)).toEqual(
      expect.arrayContaining(["flat", "linear", "exponential"]),
    );
    expect(Object.keys(growthRegistry)).toHaveLength(3);
  });

  it("levelCostRegistry contains flat, free, linear_cost, mixed_linear_cost", () => {
    expect(Object.keys(levelCostRegistry)).toEqual(
      expect.arrayContaining(["flat", "free", "linear_cost", "mixed_linear_cost"]),
    );
    expect(Object.keys(levelCostRegistry)).toHaveLength(4);
  });

  it("growthCatalog has entry for each registry key", () => {
    for (const key of Object.keys(growthRegistry)) {
      expect(growthCatalog[key]).toBeDefined();
      expect(typeof growthCatalog[key].description).toBe("string");
      expect(typeof growthCatalog[key].params).toBe("object");
    }
  });

  it("levelCostCatalog has entry for each registry key", () => {
    for (const key of Object.keys(levelCostRegistry)) {
      expect(levelCostCatalog[key]).toBeDefined();
      expect(typeof levelCostCatalog[key].description).toBe("string");
      expect(typeof levelCostCatalog[key].params).toBe("object");
    }
  });

  it("getFullCatalog() returns growth and levelCost", () => {
    const catalog = getFullCatalog();
    expect(catalog).toHaveProperty("growth");
    expect(catalog).toHaveProperty("levelCost");
    expect(catalog.growth).toBe(growthCatalog);
    expect(catalog.levelCost).toBe(levelCostCatalog);
  });
});

describe("Algorithm Catalog — Config validation", () => {
  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws on invalid growth algorithmId", () => {
    const configPath = resolve(tmpDir, "bad_growth.json");
    writeFileSync(configPath, JSON.stringify(makeConfig({ growthId: "bogus" })));
    expect(() => loadGameConfig(configPath)).toThrow(
      "Unknown growth algorithmId: 'bogus'",
    );
  });

  it("throws on invalid levelCostCharacter algorithmId", () => {
    const configPath = resolve(tmpDir, "bad_char_cost.json");
    writeFileSync(
      configPath,
      JSON.stringify(makeConfig({ charCostId: "nope" })),
    );
    expect(() => loadGameConfig(configPath)).toThrow(
      "Unknown levelCostCharacter algorithmId: 'nope'",
    );
  });

  it("throws on invalid levelCostGear algorithmId", () => {
    const configPath = resolve(tmpDir, "bad_gear_cost.json");
    writeFileSync(
      configPath,
      JSON.stringify(makeConfig({ gearCostId: "missing" })),
    );
    expect(() => loadGameConfig(configPath)).toThrow(
      "Unknown levelCostGear algorithmId: 'missing'",
    );
  });

  it("error message includes Available: ...", () => {
    const configPath = resolve(tmpDir, "bad_avail.json");
    writeFileSync(configPath, JSON.stringify(makeConfig({ growthId: "xxx" })));
    expect(() => loadGameConfig(configPath)).toThrow("Available:");
  });

  it("does not throw with valid algorithmIds (config_minimal)", () => {
    expect(() => loadGameConfig("examples/config_minimal.json")).not.toThrow();
  });
});

describe("Algorithm Catalog — Endpoint", () => {
  let app: FastifyInstance;
  const ADMIN_KEY = "algo-catalog-admin";
  const TEST_API_KEY = "algo-catalog-actor-key";
  const GAME_ID = "instance_001";

  beforeAll(async () => {
    app = createApp({ adminApiKey: ADMIN_KEY });
    await app.ready();

    // Create an actor and player so the game instance exists
    await app.inject({
      method: "POST",
      url: `/${GAME_ID}/tx`,
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      payload: {
        txId: "cat-setup-1",
        type: "CreateActor",
        gameInstanceId: GAME_ID,
        actorId: "actor1",
        apiKey: TEST_API_KEY,
      },
    });
    await app.inject({
      method: "POST",
      url: `/${GAME_ID}/tx`,
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: {
        txId: "cat-setup-2",
        type: "CreatePlayer",
        gameInstanceId: GAME_ID,
        playerId: "p1",
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /:id/algorithms returns 200 with growth and levelCost", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/${GAME_ID}/algorithms`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<CatalogResponse>();
    expect(body).toHaveProperty("growth");
    expect(body).toHaveProperty("levelCost");
  });

  it("each entry has description (string) and params (object)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/${GAME_ID}/algorithms`,
    });
    const body = res.json<CatalogResponse>();
    for (const entry of Object.values(body.growth)) {
      expect(typeof entry.description).toBe("string");
      expect(typeof entry.params).toBe("object");
    }
    for (const entry of Object.values(body.levelCost)) {
      expect(typeof entry.description).toBe("string");
      expect(typeof entry.params).toBe("object");
    }
  });

  it("growth contains flat, linear, exponential", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/${GAME_ID}/algorithms`,
    });
    const body = res.json<CatalogResponse>();
    expect(Object.keys(body.growth)).toEqual(
      expect.arrayContaining(["flat", "linear", "exponential"]),
    );
  });

  it("levelCost contains flat, free, linear_cost, mixed_linear_cost", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/${GAME_ID}/algorithms`,
    });
    const body = res.json<CatalogResponse>();
    expect(Object.keys(body.levelCost)).toEqual(
      expect.arrayContaining(["flat", "free", "linear_cost", "mixed_linear_cost"]),
    );
  });

  it("GET /nonexistent/algorithms returns 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/nonexistent/algorithms",
    });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ errorCode: string }>();
    expect(body.errorCode).toBe("INSTANCE_NOT_FOUND");
  });
});
