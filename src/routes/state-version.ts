import type { FastifyInstance, FastifyPluginCallback } from "fastify";

interface StateVersionParams {
  gameInstanceId: string;
}

const stateVersionRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
) => {
  app.get<{ Params: StateVersionParams }>(
    "/:gameInstanceId/stateVersion",
    (request, reply) => {
      const { gameInstanceId } = request.params;

      const state = app.gameInstances.get(gameInstanceId);
      if (!state) {
        return reply.code(404).send({
          errorCode: "INSTANCE_NOT_FOUND",
          errorMessage: `Game instance '${gameInstanceId}' not found.`,
        });
      }

      return reply.send({
        gameInstanceId,
        stateVersion: state.stateVersion,
      });
    },
  );

  done();
};

export default stateVersionRoutes;
