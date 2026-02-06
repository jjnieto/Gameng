import type { Actor, GameState } from "./state.js";

export function resolveActor(
  authHeader: string | string[] | undefined,
  state: GameState,
): { actorId: string; actor: Actor } | null {
  if (!authHeader || Array.isArray(authHeader)) return null;

  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return null;

  const token = match[1];
  for (const [actorId, actor] of Object.entries(state.actors)) {
    if (actor.apiKey === token) {
      return { actorId, actor };
    }
  }

  return null;
}

export function actorOwnsPlayer(actor: Actor, playerId: string): boolean {
  return actor.playerIds.includes(playerId);
}
