import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { proxyToEngine } from "../proxy.js";
import type { UserStore } from "../user-store.js";

interface AdminRoutesOpts {
  userStore: UserStore;
  adminApiKey: string;
  internalAdminSecret: string;
  engineUrl: string;
  gameInstanceId: string;
}

/**
 * Pre-handler that validates X-Admin-Secret header.
 */
function buildRequireAdminSecret(secret: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const provided = request.headers["x-admin-secret"];
    if (!provided || provided !== secret) {
      void reply.code(401).send({
        errorCode: "UNAUTHORIZED",
        errorMessage: "Missing or invalid X-Admin-Secret header.",
      });
    }
  };
}

/**
 * Admin routes: grant resources, list users, etc.
 * Protected by X-Admin-Secret header.
 */
export async function adminRoutes(
  app: FastifyInstance,
  opts: AdminRoutesOpts,
): Promise<void> {
  const { userStore, adminApiKey, internalAdminSecret, engineUrl, gameInstanceId } =
    opts;

  const requireAdminSecret = buildRequireAdminSecret(internalAdminSecret);

  // POST /admin/grant-resources
  app.post<{
    Body: { playerId: string; resources: Record<string, number> };
  }>(
    "/admin/grant-resources",
    { preHandler: [requireAdminSecret] },
    async (request, reply) => {
      const { playerId, resources } = request.body ?? {};

      if (!playerId || !resources) {
        return reply.code(400).send({
          errorCode: "VALIDATION_ERROR",
          errorMessage: "playerId and resources are required.",
        });
      }

      await proxyToEngine(
        {
          engineUrl,
          path: `/${gameInstanceId}/tx`,
          method: "POST",
          body: {
            txId: `bff_admin_${randomUUID()}`,
            type: "GrantResources",
            gameInstanceId,
            playerId,
            resources,
          },
          apiKey: adminApiKey,
        },
        reply,
      );
    },
  );

  // POST /admin/grant-character-resources
  app.post<{
    Body: {
      playerId: string;
      characterId: string;
      resources: Record<string, number>;
    };
  }>(
    "/admin/grant-character-resources",
    { preHandler: [requireAdminSecret] },
    async (request, reply) => {
      const { playerId, characterId, resources } = request.body ?? {};

      if (!playerId || !characterId || !resources) {
        return reply.code(400).send({
          errorCode: "VALIDATION_ERROR",
          errorMessage: "playerId, characterId, and resources are required.",
        });
      }

      await proxyToEngine(
        {
          engineUrl,
          path: `/${gameInstanceId}/tx`,
          method: "POST",
          body: {
            txId: `bff_admin_${randomUUID()}`,
            type: "GrantCharacterResources",
            gameInstanceId,
            playerId,
            characterId,
            resources,
          },
          apiKey: adminApiKey,
        },
        reply,
      );
    },
  );

  // POST /admin/create-actor
  app.post<{
    Body: { actorId: string; apiKey: string };
  }>(
    "/admin/create-actor",
    { preHandler: [requireAdminSecret] },
    async (request, reply) => {
      const { actorId, apiKey } = request.body ?? {};

      if (!actorId || !apiKey) {
        return reply.code(400).send({
          errorCode: "VALIDATION_ERROR",
          errorMessage: "actorId and apiKey are required.",
        });
      }

      await proxyToEngine(
        {
          engineUrl,
          path: `/${gameInstanceId}/tx`,
          method: "POST",
          body: {
            txId: `bff_admin_${randomUUID()}`,
            type: "CreateActor",
            gameInstanceId,
            actorId,
            apiKey,
          },
          apiKey: adminApiKey,
        },
        reply,
      );
    },
  );

  // GET /admin/users
  app.get<{
    Querystring: { limit?: string; offset?: string };
  }>(
    "/admin/users",
    { preHandler: [requireAdminSecret] },
    async (request) => {
      const limit = Math.min(Number(request.query.limit ?? "50"), 100);
      const offset = Number(request.query.offset ?? "0");
      const users = userStore.list(limit, offset);
      const total = userStore.count();
      return { users, total, limit, offset };
    },
  );

  // GET /admin/users/:id
  app.get<{ Params: { id: string } }>(
    "/admin/users/:id",
    { preHandler: [requireAdminSecret] },
    async (request, reply) => {
      const user = userStore.findById(Number(request.params.id));
      if (!user) {
        return reply.code(404).send({
          errorCode: "USER_NOT_FOUND",
          errorMessage: "User not found.",
        });
      }
      // Don't expose sensitive fields
      return {
        id: user.id,
        email: user.email,
        actor_id: user.actor_id,
        player_id: user.player_id,
        created_at: user.created_at,
      };
    },
  );
}
