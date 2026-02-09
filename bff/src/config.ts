import { join } from "node:path";

export interface BffConfig {
  port: number;
  host: string;
  logLevel: string;
  engineUrl: string;
  gameInstanceId: string;
  jwtSecret: string;
  jwtExpiry: string;
  jwtExpiresInSeconds: number;
  dbPath: string;
  adminApiKey: string;
  internalAdminSecret: string;
  bcryptRounds: number;
}

function parseExpiryToSeconds(expiry: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(expiry);
  if (!match) return 3600;
  const n = Number(match[1]);
  switch (match[2]) {
    case "s":
      return n;
    case "m":
      return n * 60;
    case "h":
      return n * 3600;
    case "d":
      return n * 86400;
    default:
      return 3600;
  }
}

export function resolveConfig(): BffConfig {
  const jwtExpiry = process.env.BFF_JWT_EXPIRY ?? "1h";
  return {
    port: Number(process.env.BFF_PORT ?? "5000"),
    host: process.env.BFF_HOST ?? "0.0.0.0",
    logLevel: process.env.BFF_LOG_LEVEL ?? "info",
    engineUrl: process.env.ENGINE_URL ?? "http://localhost:3000",
    gameInstanceId: process.env.GAME_INSTANCE_ID ?? "instance_001",
    jwtSecret: process.env.BFF_JWT_SECRET ?? "",
    jwtExpiry,
    jwtExpiresInSeconds: parseExpiryToSeconds(jwtExpiry),
    dbPath: process.env.BFF_DB_PATH ?? join("bff", "data", "bff.sqlite"),
    adminApiKey: process.env.BFF_ADMIN_API_KEY ?? "",
    internalAdminSecret: process.env.BFF_INTERNAL_ADMIN_SECRET ?? "",
    bcryptRounds: Number(process.env.BFF_BCRYPT_ROUNDS ?? "12"),
  };
}
