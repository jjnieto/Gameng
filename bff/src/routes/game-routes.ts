import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { proxyToEngine } from "../proxy.js";
import type { BffConfig } from "../config.js";
import type { UserStore } from "../user-store.js";
import { requireAuth } from "../auth/middleware.js";
import type {
  CreateCharacterRequest,
  CreateGearRequest,
  EquipGearRequest,
  UnequipGearRequest,
  LevelUpCharacterRequest,
  LevelUpGearRequest,
} from "../types.js";

interface GameRoutesOpts {
  config: BffConfig;
  userStore?: UserStore;
}

/**
 * Resolve the actor's apiKey from the DB for authenticated requests.
 */
function resolveApiKey(
  request: { user?: { sub: number } },
  userStore?: UserStore,
): string | undefined {
  if (!userStore || !request.user) return undefined;
  return userStore.getApiKeyById(request.user.sub);
}

/**
 * Send a transaction to the engine, filling in txId, gameInstanceId, and playerId.
 * Logs the action with timing and relevant IDs (never apiKeys or JWTs).
 */
async function sendTx(
  config: BffConfig,
  apiKey: string,
  playerId: string,
  type: string,
  fields: Record<string, unknown>,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const start = performance.now();
  await proxyToEngine(
    {
      engineUrl: config.engineUrl,
      path: `/${config.gameInstanceId}/tx`,
      method: "POST",
      body: {
        txId: `bff_${randomUUID()}`,
        type,
        gameInstanceId: config.gameInstanceId,
        playerId,
        ...fields,
      },
      apiKey,
    },
    reply,
  );
  const durationMs = Math.round(performance.now() - start);
  request.log.info(
    {
      userId: (request.user as { sub?: number } | undefined)?.sub,
      action: type,
      playerId,
      ...filterActionFields(fields),
      statusCode: reply.statusCode,
      durationMs,
    },
    "game action",
  );
}

/**
 * Log a read operation with timing.
 */
function logRead(
  request: FastifyRequest,
  reply: FastifyReply,
  action: string,
  fields: Record<string, unknown>,
  durationMs: number,
): void {
  request.log.info(
    {
      userId: (request.user as { sub?: number } | undefined)?.sub,
      action,
      ...fields,
      statusCode: reply.statusCode,
      durationMs,
    },
    "game read",
  );
}

/** Pick only safe fields from action fields (IDs and flags, never secrets). */
function filterActionFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  const ALLOWED_KEYS = [
    "characterId",
    "classId",
    "gearId",
    "gearDefId",
    "slotPattern",
    "swap",
    "levels",
  ];
  for (const key of ALLOWED_KEYS) {
    if (fields[key] !== undefined) {
      safe[key] = fields[key];
    }
  }
  return safe;
}

/**
 * Game routes — public and authenticated.
 */
export async function gameRoutes(
  app: FastifyInstance,
  opts: GameRoutesOpts,
): Promise<void> {
  const { config, userStore } = opts;
  const instanceId = config.gameInstanceId;
  const hasAuth = !!userStore;
  const authHooks = hasAuth ? { preHandler: [requireAuth] } : {};

  // ---- Public routes (no auth) ----

  app.get("/game/health", async (_request, reply) => {
    await proxyToEngine(
      { engineUrl: config.engineUrl, path: "/health", method: "GET" },
      reply,
    );
  });

  app.get("/game/config", async (_request, reply) => {
    await proxyToEngine(
      {
        engineUrl: config.engineUrl,
        path: `/${instanceId}/config`,
        method: "GET",
      },
      reply,
    );
  });

  app.get("/game/version", async (_request, reply) => {
    await proxyToEngine(
      {
        engineUrl: config.engineUrl,
        path: `/${instanceId}/stateVersion`,
        method: "GET",
      },
      reply,
    );
  });

  // ---- Read routes (auth required) ----

  // GET /game/player — own player state (playerId from JWT)
  app.get("/game/player", authHooks, async (request, reply) => {
    const apiKey = resolveApiKey(request, userStore);
    const playerId = hasAuth ? request.user.playerId : undefined;

    if (!apiKey || !playerId) {
      return reply.code(401).send({
        errorCode: "UNAUTHORIZED",
        errorMessage: "Authentication required.",
      });
    }

    const start = performance.now();
    await proxyToEngine(
      {
        engineUrl: config.engineUrl,
        path: `/${instanceId}/state/player/${playerId}`,
        method: "GET",
        apiKey,
      },
      reply,
    );
    logRead(request, reply, "getPlayer", { playerId }, Math.round(performance.now() - start));
  });

  // GET /game/player/:playerId — explicit player (passthrough compat)
  app.get<{ Params: { playerId: string } }>(
    "/game/player/:playerId",
    authHooks,
    async (request, reply) => {
      const apiKey = resolveApiKey(request, userStore);
      const start = performance.now();
      await proxyToEngine(
        {
          engineUrl: config.engineUrl,
          path: `/${instanceId}/state/player/${request.params.playerId}`,
          method: "GET",
          apiKey,
          authHeader: apiKey ? undefined : request.headers.authorization,
        },
        reply,
      );
      logRead(
        request, reply, "getPlayer",
        { playerId: request.params.playerId },
        Math.round(performance.now() - start),
      );
    },
  );

  // GET /game/stats/:characterId
  app.get<{ Params: { characterId: string } }>(
    "/game/stats/:characterId",
    authHooks,
    async (request, reply) => {
      const apiKey = resolveApiKey(request, userStore);
      const start = performance.now();
      await proxyToEngine(
        {
          engineUrl: config.engineUrl,
          path: `/${instanceId}/character/${request.params.characterId}/stats`,
          method: "GET",
          apiKey,
          authHeader: apiKey ? undefined : request.headers.authorization,
        },
        reply,
      );
      logRead(
        request, reply, "getStats",
        { characterId: request.params.characterId },
        Math.round(performance.now() - start),
      );
    },
  );

  // ---- Typed action routes (auth required) ----

  // POST /game/character
  app.post<{ Body: CreateCharacterRequest }>(
    "/game/character",
    authHooks,
    async (request, reply) => {
      const apiKey = resolveApiKey(request, userStore);
      const playerId = hasAuth ? request.user.playerId : undefined;
      if (!apiKey || !playerId) {
        return reply
          .code(401)
          .send({ errorCode: "UNAUTHORIZED", errorMessage: "Authentication required." });
      }
      const { characterId, classId } = request.body;
      await sendTx(config, apiKey, playerId, "CreateCharacter", { characterId, classId }, request, reply);
    },
  );

  // POST /game/gear
  app.post<{ Body: CreateGearRequest }>(
    "/game/gear",
    authHooks,
    async (request, reply) => {
      const apiKey = resolveApiKey(request, userStore);
      const playerId = hasAuth ? request.user.playerId : undefined;
      if (!apiKey || !playerId) {
        return reply
          .code(401)
          .send({ errorCode: "UNAUTHORIZED", errorMessage: "Authentication required." });
      }
      const { gearId, gearDefId } = request.body;
      await sendTx(config, apiKey, playerId, "CreateGear", { gearId, gearDefId }, request, reply);
    },
  );

  // POST /game/equip
  app.post<{ Body: EquipGearRequest }>(
    "/game/equip",
    authHooks,
    async (request, reply) => {
      const apiKey = resolveApiKey(request, userStore);
      const playerId = hasAuth ? request.user.playerId : undefined;
      if (!apiKey || !playerId) {
        return reply
          .code(401)
          .send({ errorCode: "UNAUTHORIZED", errorMessage: "Authentication required." });
      }
      const { characterId, gearId, slotPattern, swap } = request.body;
      const fields: Record<string, unknown> = { characterId, gearId };
      if (slotPattern) fields.slotPattern = slotPattern;
      if (swap !== undefined) fields.swap = swap;
      await sendTx(config, apiKey, playerId, "EquipGear", fields, request, reply);
    },
  );

  // POST /game/unequip
  app.post<{ Body: UnequipGearRequest }>(
    "/game/unequip",
    authHooks,
    async (request, reply) => {
      const apiKey = resolveApiKey(request, userStore);
      const playerId = hasAuth ? request.user.playerId : undefined;
      if (!apiKey || !playerId) {
        return reply
          .code(401)
          .send({ errorCode: "UNAUTHORIZED", errorMessage: "Authentication required." });
      }
      const { gearId, characterId } = request.body;
      const fields: Record<string, unknown> = { gearId };
      if (characterId) fields.characterId = characterId;
      await sendTx(config, apiKey, playerId, "UnequipGear", fields, request, reply);
    },
  );

  // POST /game/levelup/character
  app.post<{ Body: LevelUpCharacterRequest }>(
    "/game/levelup/character",
    authHooks,
    async (request, reply) => {
      const apiKey = resolveApiKey(request, userStore);
      const playerId = hasAuth ? request.user.playerId : undefined;
      if (!apiKey || !playerId) {
        return reply
          .code(401)
          .send({ errorCode: "UNAUTHORIZED", errorMessage: "Authentication required." });
      }
      const { characterId, levels } = request.body;
      const fields: Record<string, unknown> = { characterId };
      if (levels !== undefined) fields.levels = levels;
      await sendTx(config, apiKey, playerId, "LevelUpCharacter", fields, request, reply);
    },
  );

  // POST /game/levelup/gear
  app.post<{ Body: LevelUpGearRequest }>(
    "/game/levelup/gear",
    authHooks,
    async (request, reply) => {
      const apiKey = resolveApiKey(request, userStore);
      const playerId = hasAuth ? request.user.playerId : undefined;
      if (!apiKey || !playerId) {
        return reply
          .code(401)
          .send({ errorCode: "UNAUTHORIZED", errorMessage: "Authentication required." });
      }
      const { gearId, levels, characterId } = request.body;
      const fields: Record<string, unknown> = { gearId };
      if (levels !== undefined) fields.levels = levels;
      if (characterId) fields.characterId = characterId;
      await sendTx(config, apiKey, playerId, "LevelUpGear", fields, request, reply);
    },
  );

  // POST /game/tx — raw transaction passthrough (backward compat)
  app.post(
    "/game/tx",
    authHooks,
    async (request, reply) => {
      const apiKey = resolveApiKey(request, userStore);
      const body = request.body as Record<string, unknown> | undefined;
      const txType = typeof body?.type === "string" ? body.type : "unknown";
      const start = performance.now();
      await proxyToEngine(
        {
          engineUrl: config.engineUrl,
          path: `/${instanceId}/tx`,
          method: "POST",
          body,
          apiKey,
          authHeader: apiKey ? undefined : request.headers.authorization,
        },
        reply,
      );
      const durationMs = Math.round(performance.now() - start);
      request.log.info(
        {
          userId: (request.user as { sub?: number } | undefined)?.sub,
          action: txType,
          route: "passthrough",
          statusCode: reply.statusCode,
          durationMs,
        },
        "game action",
      );
    },
  );
}
