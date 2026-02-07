import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { resolveActor, actorOwnsPlayer } from "../auth.js";
import { applyGrowth } from "../algorithms/growth.js";

interface StatsParams {
  gameInstanceId: string;
  characterId: string;
}

const statsRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
) => {
  app.get<{ Params: StatsParams }>(
    "/:gameInstanceId/character/:characterId/stats",
    (request, reply) => {
      const { gameInstanceId, characterId } = request.params;

      const state = app.gameInstances.get(gameInstanceId);
      if (!state) {
        return reply.code(404).send({
          errorCode: "INSTANCE_NOT_FOUND",
          errorMessage: `Game instance '${gameInstanceId}' not found.`,
        });
      }

      // Search for character across all players
      let foundCharacter:
        | { classId: string; level: number; equipped: Record<string, string> }
        | undefined;
      let foundPlayer: { gear: Record<string, { gearDefId: string; level: number }> } | undefined;
      let foundPlayerId: string | undefined;
      for (const [pid, player] of Object.entries(state.players)) {
        const char = player.characters[characterId];
        if (char) {
          foundCharacter = char;
          foundPlayer = player;
          foundPlayerId = pid;
          break;
        }
      }

      if (!foundCharacter) {
        return reply.code(404).send({
          errorCode: "CHARACTER_NOT_FOUND",
          errorMessage: `Character '${characterId}' not found.`,
        });
      }

      const resolved = resolveActor(request.headers.authorization, state);
      if (!resolved) {
        return reply.code(401).send({
          errorCode: "UNAUTHORIZED",
          errorMessage: "Missing or invalid Bearer token.",
        });
      }

      if (!actorOwnsPlayer(resolved.actor, foundPlayerId!)) {
        return reply.code(403).send({
          errorCode: "OWNERSHIP_VIOLATION",
          errorMessage: `Actor does not own player '${foundPlayerId!}'.`,
        });
      }

      const config = app.gameConfigs.get(state.gameConfigId);
      if (!config) {
        return reply.code(500).send({
          errorCode: "CONFIG_NOT_FOUND",
          errorMessage: `Config '${state.gameConfigId}' not found.`,
        });
      }

      const classDef = config.classes[foundCharacter.classId];
      const growthRef = config.algorithms.growth;

      // Step 1+2: Class base stats scaled by character level
      let classScaled: Record<string, number>;
      try {
        const classBase: Record<string, number> = {};
        for (const statId of config.stats) {
          classBase[statId] = classDef?.baseStats[statId] ?? 0;
        }
        classScaled = applyGrowth(
          classBase,
          foundCharacter.level,
          growthRef,
        );
      } catch (err) {
        return reply.code(500).send({
          errorCode: "INVALID_CONFIG_REFERENCE",
          errorMessage:
            err instanceof Error ? err.message : "Growth algorithm error.",
        });
      }

      // Initialize finalStats from scaled class stats
      const finalStats: Record<string, number> = {};
      for (const statId of config.stats) {
        finalStats[statId] = classScaled[statId] ?? 0;
      }

      // Step 3: Gear base stats scaled by gear level (deduplicate for multi-slot)
      // Also accumulate set piece counts for set bonus calculation
      const setPieceCounts: Record<string, number> = {};
      if (foundPlayer) {
        const seenGearIds = new Set<string>();
        for (const gearId of Object.values(foundCharacter.equipped)) {
          if (seenGearIds.has(gearId)) continue;
          seenGearIds.add(gearId);
          const gearInst = foundPlayer.gear[gearId];
          if (!gearInst) continue;
          const gearDef = config.gearDefs[gearInst.gearDefId];
          if (!gearDef) continue;
          try {
            const gearScaled = applyGrowth(
              gearDef.baseStats,
              gearInst.level,
              growthRef,
            );
            for (const statId of config.stats) {
              finalStats[statId] += gearScaled[statId] ?? 0;
            }
          } catch (err) {
            return reply.code(500).send({
              errorCode: "INVALID_CONFIG_REFERENCE",
              errorMessage:
                err instanceof Error
                  ? err.message
                  : "Growth algorithm error.",
            });
          }
          // Accumulate set piece count
          if (gearDef.setId) {
            setPieceCounts[gearDef.setId] =
              (setPieceCounts[gearDef.setId] ?? 0) +
              (gearDef.setPieceCount ?? 1);
          }
        }
      }

      // Step 4: Apply set bonuses (flat, not scaled)
      for (const [setId, pieceCount] of Object.entries(setPieceCounts)) {
        const setDef = config.sets[setId];
        if (!setDef) continue; // silently ignore unknown setId
        for (const bonus of setDef.bonuses) {
          if (pieceCount >= bonus.pieces) {
            for (const statId of config.stats) {
              finalStats[statId] += bonus.bonusStats[statId] ?? 0;
            }
          }
        }
      }

      // Step 5: Apply stat clamps (min/max per stat)
      if (config.statClamps) {
        for (const statId of config.stats) {
          const clamp = config.statClamps[statId];
          if (!clamp) continue;
          if (clamp.min != null && finalStats[statId] < clamp.min) {
            finalStats[statId] = clamp.min;
          }
          if (clamp.max != null && finalStats[statId] > clamp.max) {
            finalStats[statId] = clamp.max;
          }
        }
      }

      return reply.send({
        characterId,
        classId: foundCharacter.classId,
        level: foundCharacter.level,
        finalStats,
      });
    },
  );

  done();
};

export default statsRoutes;
