import type { FastifyRequest, FastifyReply } from "fastify";
import type { JwtPayload } from "./jwt.js";

// Augment @fastify/jwt to type request.user as JwtPayload
declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

/**
 * Fastify preHandler that verifies the JWT and populates request.user.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    void reply.code(401).send({
      errorCode: "UNAUTHORIZED",
      errorMessage: "Missing or invalid authentication token.",
    });
  }
}
