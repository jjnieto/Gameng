import { FastifyInstance, FastifyPluginCallback } from "fastify";

const healthRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
) => {
  app.get("/health", () => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });

  done();
};

export default healthRoutes;
