import type { FastifyInstance, FastifyPluginCallback } from "fastify";

interface ConfigParams {
  gameInstanceId: string;
}

const configRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
) => {
  app.get<{ Params: ConfigParams }>(
    "/:gameInstanceId/config",
    (request, reply) => {
      const { gameInstanceId } = request.params;

      const state = app.gameInstances.get(gameInstanceId);
      if (!state) {
        return reply.code(404).send({
          errorCode: "INSTANCE_NOT_FOUND",
          errorMessage: `Game instance '${gameInstanceId}' not found.`,
        });
      }

      return reply.send(app.activeConfig);
    },
  );

  done();
};

export default configRoutes;
