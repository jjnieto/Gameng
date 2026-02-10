import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { getFullCatalog } from "../algorithms/index.js";

interface AlgorithmsParams {
  gameInstanceId: string;
}

const algorithmsRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
) => {
  app.get<{ Params: AlgorithmsParams }>(
    "/:gameInstanceId/algorithms",
    (request, reply) => {
      const { gameInstanceId } = request.params;

      const state = app.gameInstances.get(gameInstanceId);
      if (!state) {
        return reply.code(404).send({
          errorCode: "INSTANCE_NOT_FOUND",
          errorMessage: `Game instance '${gameInstanceId}' not found.`,
        });
      }

      return reply.send(getFullCatalog());
    },
  );

  done();
};

export default algorithmsRoutes;
