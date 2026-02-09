import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { UserStore } from "../user-store.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import type { JwtPayload } from "../auth/jwt.js";
import { requireAuth } from "../auth/middleware.js";

interface AuthRoutesOpts {
  userStore: UserStore;
  adminApiKey: string;
  engineUrl: string;
  gameInstanceId: string;
  bcryptRounds: number;
  jwtExpiresInSeconds: number;
}

/**
 * Auth routes: register, login, refresh.
 */
export async function authRoutes(
  app: FastifyInstance,
  opts: AuthRoutesOpts,
): Promise<void> {
  const {
    userStore,
    adminApiKey,
    engineUrl,
    gameInstanceId,
    bcryptRounds,
    jwtExpiresInSeconds,
  } = opts;

  // ---- POST /auth/register ----
  app.post<{
    Body: { email: string; password: string };
  }>("/auth/register", {
    config: { rateLimit: { max: 5, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const { email, password } = request.body ?? {};

    // Validate input
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return reply.code(400).send({
        errorCode: "VALIDATION_ERROR",
        errorMessage: "A valid email is required.",
      });
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return reply.code(400).send({
        errorCode: "VALIDATION_ERROR",
        errorMessage: "Password must be at least 8 characters.",
      });
    }

    // Check for duplicate email
    const existing = userStore.findByEmail(email);
    if (existing) {
      return reply.code(409).send({
        errorCode: "CONFLICT",
        errorMessage: "Email already registered.",
      });
    }

    // Generate IDs
    const actorId = `actor_${randomUUID()}`;
    const apiKey = randomUUID();
    const playerId = `player_${randomUUID()}`;

    // Step 1: Create actor in engine
    let createActorRes: Response;
    try {
      createActorRes = await fetch(`${engineUrl}/${gameInstanceId}/tx`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminApiKey}`,
        },
        body: JSON.stringify({
          txId: `bff_ca_${randomUUID()}`,
          type: "CreateActor",
          gameInstanceId,
          actorId,
          apiKey,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return reply.code(502).send({
        errorCode: "ENGINE_ERROR",
        errorMessage: "Could not connect to game engine for actor creation.",
      });
    }

    const actorResult = (await createActorRes.json()) as {
      accepted?: boolean;
      errorCode?: string;
    };
    if (!actorResult.accepted) {
      return reply.code(502).send({
        errorCode: "ENGINE_ERROR",
        errorMessage: `Engine rejected CreateActor: ${actorResult.errorCode ?? "unknown"}`,
      });
    }

    // Step 2: Create player in engine
    let createPlayerRes: Response;
    try {
      createPlayerRes = await fetch(`${engineUrl}/${gameInstanceId}/tx`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          txId: `bff_cp_${randomUUID()}`,
          type: "CreatePlayer",
          gameInstanceId,
          playerId,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return reply.code(502).send({
        errorCode: "ENGINE_ERROR",
        errorMessage:
          "Could not connect to game engine for player creation. Actor was created but player was not.",
      });
    }

    const playerResult = (await createPlayerRes.json()) as {
      accepted?: boolean;
      errorCode?: string;
    };
    if (!playerResult.accepted) {
      return reply.code(502).send({
        errorCode: "ENGINE_ERROR",
        errorMessage: `Engine rejected CreatePlayer: ${playerResult.errorCode ?? "unknown"}. Actor was created but player was not.`,
      });
    }

    // Step 3: Hash password and insert into DB
    const passwordHash = await hashPassword(password, bcryptRounds);
    userStore.createUser({
      email,
      passwordHash,
      actorId,
      apiKey,
      playerId,
    });

    // Step 4: Generate JWT
    const payload: JwtPayload = {
      sub: userStore.findByEmail(email)!.id,
      email,
      actorId,
      playerId,
    };
    const token = app.jwt.sign(payload);

    return reply.code(201).send({
      token,
      expiresIn: jwtExpiresInSeconds,
      playerId,
    });
  });

  // ---- POST /auth/login ----
  app.post<{
    Body: { email: string; password: string };
  }>("/auth/login", {
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const { email, password } = request.body ?? {};

    if (!email || !password) {
      return reply.code(400).send({
        errorCode: "VALIDATION_ERROR",
        errorMessage: "Email and password are required.",
      });
    }

    const user = userStore.findByEmail(email);
    if (!user) {
      return reply.code(401).send({
        errorCode: "INVALID_CREDENTIALS",
        errorMessage: "Invalid email or password.",
      });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return reply.code(401).send({
        errorCode: "INVALID_CREDENTIALS",
        errorMessage: "Invalid email or password.",
      });
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      actorId: user.actor_id,
      playerId: user.player_id,
    };
    const token = app.jwt.sign(payload);

    return {
      token,
      expiresIn: jwtExpiresInSeconds,
      playerId: user.player_id,
    };
  });

  // ---- POST /auth/refresh ----
  app.post(
    "/auth/refresh",
    { preHandler: [requireAuth] },
    async (request) => {
      const user = request.user;
      const payload: JwtPayload = {
        sub: user.sub,
        email: user.email,
        actorId: user.actorId,
        playerId: user.playerId,
      };
      const token = app.jwt.sign(payload);

      return {
        token,
        expiresIn: jwtExpiresInSeconds,
        playerId: user.playerId,
      };
    },
  );
}
