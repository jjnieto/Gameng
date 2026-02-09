import type { FastifyInstance } from "fastify";
import fjwt from "@fastify/jwt";

export interface JwtPayload {
  sub: number;
  email: string;
  actorId: string;
  playerId: string;
}

/**
 * Register the @fastify/jwt plugin.
 */
export async function registerJwt(
  app: FastifyInstance,
  secret: string,
  expiresIn: string,
): Promise<void> {
  await app.register(fjwt, {
    secret,
    sign: { expiresIn },
  });
}
