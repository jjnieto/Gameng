import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { resolve, join } from "node:path";
import {
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import type { ChildProcess } from "node:child_process";
import type { LauncherConfig } from "../src/config.js";
import { EngineProcessManager, type ProcessSpawner } from "../src/engine.js";
import { LogBuffer } from "../src/log-buffer.js";
import { registerRoutes } from "../src/routes.js";

// ---- Mock spawner ----

function createMockProcess(): ChildProcess {
  const emitter = new EventEmitter() as ChildProcess;
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  (emitter as unknown as Record<string, unknown>).stdout = stdout;
  (emitter as unknown as Record<string, unknown>).stderr = stderr;
  (emitter as unknown as Record<string, unknown>).exitCode = null;
  (emitter as unknown as Record<string, unknown>).pid = 99999;
  (emitter as unknown as Record<string, unknown>).kill = (
    _signal?: string,
  ) => {
    (emitter as unknown as Record<string, unknown>).exitCode = 1;
    emitter.emit("exit", 1, null);
    return true;
  };
  return emitter;
}

function createMockSpawner(): {
  spawner: ProcessSpawner;
  lastProc: () => ChildProcess | null;
} {
  let last: ChildProcess | null = null;
  return {
    spawner: {
      spawn(_cmd, _args, _opts) {
        last = createMockProcess();
        return last;
      },
    },
    lastProc: () => last,
  };
}

// ---- Test config ----

const TEST_DATA_DIR = resolve(import.meta.dirname, "..", "test-data-launcher");

function testConfig(): LauncherConfig {
  return {
    launcherPort: 4099,
    enginePort: 4098,
    configPath: join(TEST_DATA_DIR, "configs", "active.json"),
    snapshotDir: join(TEST_DATA_DIR, "snapshots"),
    engineLogLevel: "warn",
    adminApiKey: undefined,
    repoRoot: resolve(import.meta.dirname, "..", "..", "..", ".."),
    // Point to a file that exists for start() checks
    engineEntry: process.execPath,
  };
}

// ---- Build app helper ----

function buildApp(
  config: LauncherConfig,
  engine: EngineProcessManager,
): FastifyInstance {
  const app = Fastify({ logger: false });
  registerRoutes(app, config, engine);
  return app;
}

// ---- Tests ----

describe("Launcher: GET /status", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const config = testConfig();
    const { spawner } = createMockSpawner();
    const engine = new EngineProcessManager(config, new LogBuffer(), spawner);
    app = buildApp(config, engine);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns launcher and engine status", async () => {
    const res = await app.inject({ method: "GET", url: "/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.launcher.port).toBe(4099);
    expect(body.engine.running).toBe(false);
    expect(body.engine.port).toBe(4098);
    expect(body.config.path).toContain("active.json");
    expect(body.snapshotDir).toContain("snapshots");
  });
});

describe("Launcher: POST /config", () => {
  let app: FastifyInstance;
  const config = testConfig();

  beforeAll(async () => {
    // Clean and recreate test dirs
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
    mkdirSync(join(TEST_DATA_DIR, "configs"), { recursive: true });
    mkdirSync(join(TEST_DATA_DIR, "snapshots"), { recursive: true });

    const { spawner } = createMockSpawner();
    const engine = new EngineProcessManager(config, new LogBuffer(), spawner);
    app = buildApp(config, engine);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (existsSync(TEST_DATA_DIR)) {
      rmSync(TEST_DATA_DIR, { recursive: true });
    }
  });

  it("saves config to disk and returns path", async () => {
    const testConfig = {
      gameConfigId: "test_v1",
      maxLevel: 5,
      stats: ["hp"],
      slots: ["hand"],
      classes: { warrior: { baseStats: { hp: 10 } } },
      gearDefs: {},
      sets: {},
      algorithms: {
        growth: { algorithmId: "flat", params: {} },
        levelCostCharacter: { algorithmId: "flat", params: {} },
        levelCostGear: { algorithmId: "flat", params: {} },
      },
    };

    const res = await app.inject({
      method: "POST",
      url: "/config",
      payload: testConfig,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.saved).toBe(true);
    expect(body.path).toContain("active.json");

    // Verify file was written
    const written = JSON.parse(readFileSync(config.configPath, "utf-8"));
    expect(written.gameConfigId).toBe("test_v1");
  });

  it("rejects non-object body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/config",
      payload: "not json",
      headers: { "content-type": "application/json" },
    });
    // Fastify will return 400 for invalid JSON
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("saves and restarts when restart=true", async () => {
    const testConfig = { gameConfigId: "restart_test" };

    const res = await app.inject({
      method: "POST",
      url: "/config?restart=true",
      payload: testConfig,
    });

    const body = res.json();
    expect(body.saved).toBe(true);
    // restart will try to start with mock spawner (engineEntry = process.execPath)
    expect(body).toHaveProperty("restarted");
  });
});

describe("Launcher: engine start/stop", () => {
  it("POST /engine/start transitions to running", async () => {
    const config = testConfig();
    const { spawner } = createMockSpawner();
    const engine = new EngineProcessManager(config, new LogBuffer(), spawner);
    const app = buildApp(config, engine);
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/engine/start" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.engine.running).toBe(true);
    expect(body.engine.pid).toBe(99999);

    await app.close();
  });

  it("POST /engine/start when already running returns 409", async () => {
    const config = testConfig();
    const { spawner } = createMockSpawner();
    const engine = new EngineProcessManager(config, new LogBuffer(), spawner);
    const app = buildApp(config, engine);
    await app.ready();

    await app.inject({ method: "POST", url: "/engine/start" });
    const res = await app.inject({ method: "POST", url: "/engine/start" });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toContain("already running");

    await app.close();
  });

  it("POST /engine/stop when not running is a no-op", async () => {
    const config = testConfig();
    const { spawner } = createMockSpawner();
    const engine = new EngineProcessManager(config, new LogBuffer(), spawner);
    const app = buildApp(config, engine);
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/engine/stop" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stopped).toBe(false);

    await app.close();
  });

  it("status reflects engine state after process exits", async () => {
    const config = testConfig();
    const { spawner, lastProc } = createMockSpawner();
    const engine = new EngineProcessManager(config, new LogBuffer(), spawner);
    const app = buildApp(config, engine);
    await app.ready();

    // Start engine
    await app.inject({ method: "POST", url: "/engine/start" });

    // Verify running
    let statusRes = await app.inject({ method: "GET", url: "/status" });
    expect(statusRes.json().engine.running).toBe(true);

    // Simulate process exit (e.g. crash)
    const proc = lastProc()!;
    (proc as unknown as Record<string, unknown>).exitCode = 1;
    proc.emit("exit", 1, null);

    // Now status should show not running
    statusRes = await app.inject({ method: "GET", url: "/status" });
    expect(statusRes.json().engine.running).toBe(false);
    expect(statusRes.json().engine.lastExitCode).toBe(1);

    await app.close();
  });
});

describe("Launcher: GET /logs", () => {
  let app: FastifyInstance;
  let logs: LogBuffer;

  beforeAll(async () => {
    const config = testConfig();
    logs = new LogBuffer();
    const { spawner } = createMockSpawner();
    const engine = new EngineProcessManager(config, logs, spawner);
    app = buildApp(config, engine);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns empty array when no logs", async () => {
    const res = await app.inject({ method: "GET", url: "/logs" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns log entries with limit", async () => {
    logs.push("stdout", "line 1");
    logs.push("stderr", "line 2");
    logs.push("stdout", "line 3");

    const res = await app.inject({ method: "GET", url: "/logs?limit=2" });
    expect(res.statusCode).toBe(200);
    const entries = res.json();
    expect(entries).toHaveLength(2);
    expect(entries[0].line).toBe("line 2");
    expect(entries[0].stream).toBe("stderr");
    expect(entries[1].line).toBe("line 3");
    expect(entries[1].stream).toBe("stdout");
    expect(entries[0].ts).toBeTruthy();
  });
});

describe("LogBuffer", () => {
  it("evicts oldest entries when over maxLines", () => {
    const buf = new LogBuffer(3);
    buf.push("stdout", "a");
    buf.push("stdout", "b");
    buf.push("stdout", "c");
    buf.push("stdout", "d");

    expect(buf.size).toBe(3);
    const all = buf.tail();
    expect(all.map((e) => e.line)).toEqual(["b", "c", "d"]);
  });

  it("tail with limit returns last N", () => {
    const buf = new LogBuffer();
    buf.push("stdout", "1");
    buf.push("stdout", "2");
    buf.push("stdout", "3");

    const last2 = buf.tail(2);
    expect(last2.map((e) => e.line)).toEqual(["2", "3"]);
  });

  it("clear empties the buffer", () => {
    const buf = new LogBuffer();
    buf.push("stdout", "x");
    buf.clear();
    expect(buf.size).toBe(0);
  });
});

describe("Launcher: POST /engine/restart", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const config = testConfig();
    const { spawner } = createMockSpawner();
    const engine = new EngineProcessManager(config, new LogBuffer(), spawner);
    app = buildApp(config, engine);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("restart from stopped state starts the engine", async () => {
    const res = await app.inject({ method: "POST", url: "/engine/restart" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.restarted).toBe(true);
    expect(body.engine.running).toBe(true);
  });
});
