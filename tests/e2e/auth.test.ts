import { describe, it, afterAll, beforeAll } from "vitest";
import { startServer, type ServerHandle } from "./process.js";
import { step } from "./logger.js";
import {
  tx,
  getPlayer,
  getStats,
  expectAccepted,
  expectRejected,
  expectHttp,
} from "./client.js";

describe("E2E — Auth", () => {
  let srv: ServerHandle;
  const ADMIN_KEY = "e2e-admin-key-auth";
  const API_KEY = "e2e-auth-key-001";

  beforeAll(async () => {
    srv = await startServer({
      configPath: "examples/config_minimal.json",
      extraEnv: { ADMIN_API_KEY: ADMIN_KEY },
    });

    // Bootstrap: create actor + player + character so ownership checks can be tested
    await step("bootstrap actor", () =>
      tx(srv.baseUrl, ADMIN_KEY, {
        txId: "auth_boot_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "auth_actor",
        apiKey: API_KEY,
      }),
    );

    await step("bootstrap player", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "auth_boot_player",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "player_auth",
      });
      expectAccepted(res, "bootstrap player");
    });

    await step("bootstrap character", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "auth_boot_char",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_auth",
        characterId: "char_auth",
        classId: "warrior",
      });
      expectAccepted(res, "bootstrap character");
    });
  }, 30_000);

  afterAll(async () => {
    await srv.stop();
  });

  // -----------------------------------------------------------------------
  // POST /tx — no auth
  // -----------------------------------------------------------------------

  it("POST /tx without Authorization returns 401", async () => {
    await step("tx without auth → 401", async () => {
      const res = await tx(srv.baseUrl, null, {
        txId: "auth_no_header",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "p_new",
      });
      expectHttp(res, 401, "UNAUTHORIZED");
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // POST /tx — invalid token
  // -----------------------------------------------------------------------

  it("POST /tx with invalid Bearer token returns 401", async () => {
    await step("tx with bad token → 401", async () => {
      const res = await tx(srv.baseUrl, "wrong-key-xxx", {
        txId: "auth_bad_token",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "p_new",
      });
      expectHttp(res, 401, "UNAUTHORIZED");
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // POST /tx — malformed Authorization header
  // -----------------------------------------------------------------------

  it("POST /tx with malformed header (no Bearer prefix) returns 401", async () => {
    await step("tx with malformed header → 401", async () => {
      const res = await tx(srv.baseUrl, "", {
        txId: "auth_malformed",
        type: "CreatePlayer",
        gameInstanceId: "instance_001",
        playerId: "p_new",
      });
      expectHttp(res, 401, "UNAUTHORIZED");
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // POST /tx — valid token, non-owned player → OWNERSHIP_VIOLATION
  // -----------------------------------------------------------------------

  it("POST /tx on non-owned player returns OWNERSHIP_VIOLATION", async () => {
    // Create a second actor that does NOT own player_auth
    await step("create second actor", async () => {
      const res = await tx(srv.baseUrl, ADMIN_KEY, {
        txId: "auth_second_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "actor_intruder",
        apiKey: "intruder-key-999",
      });
      expectAccepted(res, "create second actor");
    });

    await step("tx from intruder → OWNERSHIP_VIOLATION", async () => {
      const res = await tx(srv.baseUrl, "intruder-key-999", {
        txId: "auth_intruder_tx",
        type: "CreateCharacter",
        gameInstanceId: "instance_001",
        playerId: "player_auth",
        characterId: "char_stolen",
        classId: "warrior",
      });
      expectRejected(res, "OWNERSHIP_VIOLATION");
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // GET /state/player — no auth → 401
  // -----------------------------------------------------------------------

  it("GET player state without auth returns 401", async () => {
    await step("GET player no auth → 401", async () => {
      const res = await getPlayer(
        srv.baseUrl,
        "",
        "instance_001",
        "player_auth",
      );
      expectHttp(res, 401, "UNAUTHORIZED");
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // GET /state/player — non-owned → 403
  // -----------------------------------------------------------------------

  it("GET player state for non-owned player returns 403", async () => {
    await step("GET player non-owned → 403", async () => {
      const res = await getPlayer(
        srv.baseUrl,
        "intruder-key-999",
        "instance_001",
        "player_auth",
      );
      expectHttp(res, 403, "OWNERSHIP_VIOLATION");
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // GET /character/stats — no auth → 401
  // -----------------------------------------------------------------------

  it("GET character stats without auth returns 401", async () => {
    await step("GET stats no auth → 401", async () => {
      const res = await getStats(
        srv.baseUrl,
        "",
        "instance_001",
        "char_auth",
      );
      expectHttp(res, 401, "UNAUTHORIZED");
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // GET /character/stats — non-owned → 403
  // -----------------------------------------------------------------------

  it("GET character stats for non-owned player returns 403", async () => {
    await step("GET stats non-owned → 403", async () => {
      const res = await getStats(
        srv.baseUrl,
        "intruder-key-999",
        "instance_001",
        "char_auth",
      );
      expectHttp(res, 403, "OWNERSHIP_VIOLATION");
    }, srv.logs);
  });

  // -----------------------------------------------------------------------
  // CreateActor — no auth needed (public bootstrap)
  // -----------------------------------------------------------------------

  it("CreateActor without admin key returns 401", async () => {
    await step("CreateActor no auth → 401", async () => {
      const res = await tx(srv.baseUrl, null, {
        txId: "auth_public_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "actor_public",
        apiKey: "public-key-42",
      });
      expectHttp(res, 401, "UNAUTHORIZED");
    }, srv.logs);
  });

  it("CreateActor with actor token (not admin) returns 401", async () => {
    await step("CreateActor actor token → 401", async () => {
      const res = await tx(srv.baseUrl, API_KEY, {
        txId: "auth_actor_token_ca",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "actor_nonadmin",
        apiKey: "nonadmin-key",
      });
      expectHttp(res, 401, "UNAUTHORIZED");
    }, srv.logs);
  });

  it("CreateActor with admin key succeeds", async () => {
    await step("CreateActor admin key → accepted", async () => {
      const res = await tx(srv.baseUrl, ADMIN_KEY, {
        txId: "auth_admin_actor",
        type: "CreateActor",
        gameInstanceId: "instance_001",
        actorId: "actor_admin_ok",
        apiKey: "admin-ok-key",
      });
      expectAccepted(res, "CreateActor admin");
    }, srv.logs);
  });
});
