import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { resolveActor, actorOwnsPlayer } from "../auth.js";

interface PlayerParams {
  gameInstanceId: string;
  playerId: string;
}

const playerRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
) => {
  app.get<{ Params: PlayerParams }>(
    "/:gameInstanceId/state/player/:playerId",
    (request, reply) => {
      const { gameInstanceId, playerId } = request.params;
      const store = app.gameInstances;

      const state = store.get(gameInstanceId);
      if (!state) {
        return reply.code(404).send({
          errorCode: "INSTANCE_NOT_FOUND",
          errorMessage: `Game instance '${gameInstanceId}' not found.`,
        });
      }

      const resolved = resolveActor(request.headers.authorization, state);
      if (!resolved) {
        return reply.code(401).send({
          errorCode: "UNAUTHORIZED",
          errorMessage: "Missing or invalid Bearer token.",
        });
      }

      if (!actorOwnsPlayer(resolved.actor, playerId)) {
        return reply.code(403).send({
          errorCode: "OWNERSHIP_VIOLATION",
          errorMessage: `Actor does not own player '${playerId}'.`,
        });
      }

      const player = state.players[playerId];
      if (!player) {
        return reply.code(404).send({
          errorCode: "PLAYER_NOT_FOUND",
          errorMessage: `Player '${playerId}' not found.`,
        });
      }

      return reply.send(player);
    },
  );

  done();
};

export default playerRoutes;
