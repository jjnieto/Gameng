import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { resolveActor, actorOwnsPlayer } from "../auth.js";

interface TxParams {
  gameInstanceId: string;
}

interface TxBody {
  txId: string;
  type: string;
  gameInstanceId: string;
  playerId?: string;
  characterId?: string;
  classId?: string;
  gearId?: string;
  gearDefId?: string;
  levels?: number;
  slotPattern?: string[];
  actorId?: string;
  apiKey?: string;
}

const txRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.post<{ Params: TxParams; Body: TxBody }>(
    "/:gameInstanceId/tx",
    (request, reply) => {
      const { gameInstanceId } = request.params;
      const store = app.gameInstances;

      const state = store.get(gameInstanceId);
      if (!state) {
        return reply.code(404).send({
          errorCode: "INSTANCE_NOT_FOUND",
          errorMessage: `Game instance '${gameInstanceId}' not found.`,
        });
      }

      const body = request.body;

      if (body.gameInstanceId !== gameInstanceId) {
        return reply.code(400).send({
          errorCode: "INSTANCE_MISMATCH",
          errorMessage:
            "Body gameInstanceId does not match path gameInstanceId.",
        });
      }

      switch (body.type) {
        case "CreateActor": {
          // CreateActor requires ADMIN_API_KEY via Bearer token
          const adminKey = app.adminApiKey;
          if (adminKey) {
            const authHeader = request.headers.authorization;
            if (
              !authHeader ||
              typeof authHeader !== "string" ||
              !/^Bearer\s+/i.test(authHeader) ||
              authHeader.replace(/^Bearer\s+/i, "") !== adminKey
            ) {
              return reply.code(401).send({
                errorCode: "UNAUTHORIZED",
                errorMessage: "Missing or invalid admin API key.",
              });
            }
          }

          const actorId = body.actorId!;
          const apiKey = body.apiKey!;

          if (state.actors[actorId]) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "ALREADY_EXISTS",
              errorMessage: `Actor '${actorId}' already exists.`,
            });
          }

          for (const existing of Object.values(state.actors)) {
            if (existing.apiKey === apiKey) {
              return reply.send({
                txId: body.txId,
                accepted: false,
                stateVersion: state.stateVersion,
                errorCode: "DUPLICATE_API_KEY",
                errorMessage: `Another actor already uses this apiKey.`,
              });
            }
          }

          state.actors[actorId] = { apiKey, playerIds: [] };
          state.stateVersion++;

          return reply.send({
            txId: body.txId,
            accepted: true,
            stateVersion: state.stateVersion,
          });
        }

        default:
          break;
      }

      // All non-CreateActor types require auth
      const resolved = resolveActor(request.headers.authorization, state);
      if (!resolved) {
        return reply.code(401).send({
          errorCode: "UNAUTHORIZED",
          errorMessage: "Missing or invalid Bearer token.",
        });
      }

      const playerId = body.playerId!;

      // CreatePlayer: auth required but ownership NOT checked (player doesn't exist yet)
      // All other types: require ownership of the target player
      if (body.type !== "CreatePlayer" && !actorOwnsPlayer(resolved.actor, playerId)) {
        return reply.send({
          txId: body.txId,
          accepted: false,
          stateVersion: state.stateVersion,
          errorCode: "OWNERSHIP_VIOLATION",
          errorMessage: `Actor does not own player '${playerId}'.`,
        });
      }

      const player = state.players[playerId];

      switch (body.type) {
        case "CreatePlayer": {
          if (player) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "ALREADY_EXISTS",
              errorMessage: `Player '${playerId}' already exists.`,
            });
          }

          state.players[playerId] = { characters: {}, gear: {} };
          resolved.actor.playerIds.push(playerId);
          state.stateVersion++;

          return reply.send({
            txId: body.txId,
            accepted: true,
            stateVersion: state.stateVersion,
          });
        }

        case "CreateCharacter": {
          if (!player) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "PLAYER_NOT_FOUND",
              errorMessage: `Player '${playerId}' not found.`,
            });
          }

          const config = app.gameConfigs.get(state.gameConfigId);
          if (!config) {
            return reply.code(500).send({
              errorCode: "CONFIG_NOT_FOUND",
              errorMessage: `Config '${state.gameConfigId}' not found.`,
            });
          }

          const classId = body.classId!;
          if (!config.classes[classId]) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "INVALID_CONFIG_REFERENCE",
              errorMessage: `Class '${classId}' does not exist in config.`,
            });
          }

          const characterId = body.characterId!;
          if (player.characters[characterId]) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "ALREADY_EXISTS",
              errorMessage: `Character '${characterId}' already exists.`,
            });
          }

          player.characters[characterId] = {
            classId,
            level: 1,
            equipped: {},
          };
          state.stateVersion++;

          return reply.send({
            txId: body.txId,
            accepted: true,
            stateVersion: state.stateVersion,
          });
        }

        case "LevelUpCharacter": {
          if (!player) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "PLAYER_NOT_FOUND",
              errorMessage: `Player '${playerId}' not found.`,
            });
          }

          const charId = body.characterId!;
          const character = player.characters[charId];
          if (!character) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "CHARACTER_NOT_FOUND",
              errorMessage: `Character '${charId}' not found.`,
            });
          }

          const lvlConfig = app.gameConfigs.get(state.gameConfigId);
          if (!lvlConfig) {
            return reply.code(500).send({
              errorCode: "CONFIG_NOT_FOUND",
              errorMessage: `Config '${state.gameConfigId}' not found.`,
            });
          }

          const levels = body.levels ?? 1;
          const newLevel = character.level + levels;

          if (newLevel > lvlConfig.maxLevel) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "MAX_LEVEL_REACHED",
              errorMessage: `Cannot level up to ${newLevel}; max level is ${lvlConfig.maxLevel}.`,
            });
          }

          character.level = newLevel;
          state.stateVersion++;

          return reply.send({
            txId: body.txId,
            accepted: true,
            stateVersion: state.stateVersion,
          });
        }

        case "CreateGear": {
          if (!player) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "PLAYER_NOT_FOUND",
              errorMessage: `Player '${playerId}' not found.`,
            });
          }

          const gearConfig = app.gameConfigs.get(state.gameConfigId);
          if (!gearConfig) {
            return reply.code(500).send({
              errorCode: "CONFIG_NOT_FOUND",
              errorMessage: `Config '${state.gameConfigId}' not found.`,
            });
          }

          const gearDefId = body.gearDefId!;
          if (!gearConfig.gearDefs[gearDefId]) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "INVALID_CONFIG_REFERENCE",
              errorMessage: `GearDef '${gearDefId}' does not exist in config.`,
            });
          }

          const gearId = body.gearId!;
          if (player.gear[gearId]) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "ALREADY_EXISTS",
              errorMessage: `Gear '${gearId}' already exists.`,
            });
          }

          player.gear[gearId] = { gearDefId, level: 1 };
          state.stateVersion++;

          return reply.send({
            txId: body.txId,
            accepted: true,
            stateVersion: state.stateVersion,
          });
        }

        case "LevelUpGear": {
          if (!player) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "PLAYER_NOT_FOUND",
              errorMessage: `Player '${playerId}' not found.`,
            });
          }

          const lvlGearId = body.gearId!;
          const gearInst = player.gear[lvlGearId];
          if (!gearInst) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "GEAR_NOT_FOUND",
              errorMessage: `Gear '${lvlGearId}' not found.`,
            });
          }

          const gearLvlConfig = app.gameConfigs.get(state.gameConfigId);
          if (!gearLvlConfig) {
            return reply.code(500).send({
              errorCode: "CONFIG_NOT_FOUND",
              errorMessage: `Config '${state.gameConfigId}' not found.`,
            });
          }

          const gearLevels = body.levels ?? 1;
          const newGearLevel = gearInst.level + gearLevels;

          if (newGearLevel > gearLvlConfig.maxLevel) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "MAX_LEVEL_REACHED",
              errorMessage: `Cannot level up to ${newGearLevel}; max level is ${gearLvlConfig.maxLevel}.`,
            });
          }

          gearInst.level = newGearLevel;
          state.stateVersion++;

          return reply.send({
            txId: body.txId,
            accepted: true,
            stateVersion: state.stateVersion,
          });
        }

        case "EquipGear": {
          if (!player) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "PLAYER_NOT_FOUND",
              errorMessage: `Player '${playerId}' not found.`,
            });
          }

          const equipConfig = app.gameConfigs.get(state.gameConfigId);
          if (!equipConfig) {
            return reply.code(500).send({
              errorCode: "CONFIG_NOT_FOUND",
              errorMessage: `Config '${state.gameConfigId}' not found.`,
            });
          }

          const equipCharId = body.characterId!;
          const equipChar = player.characters[equipCharId];
          if (!equipChar) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "CHARACTER_NOT_FOUND",
              errorMessage: `Character '${equipCharId}' not found.`,
            });
          }

          const equipGearId = body.gearId!;
          const equipGearInst = player.gear[equipGearId];
          if (!equipGearInst) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "GEAR_NOT_FOUND",
              errorMessage: `Gear '${equipGearId}' not found.`,
            });
          }

          if (equipGearInst.equippedBy) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "GEAR_ALREADY_EQUIPPED",
              errorMessage: `Gear '${equipGearId}' is already equipped.`,
            });
          }

          const equipGearDef = equipConfig.gearDefs[equipGearInst.gearDefId];

          if (!equipGearDef) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "INVALID_CONFIG_REFERENCE",
              errorMessage: `GearDef '${equipGearInst.gearDefId}' does not exist in config.`,
            });
          }

          // Restriction checks
          const restrictions = equipGearDef.restrictions;
          if (restrictions) {
            if (
              restrictions.allowedClasses &&
              !restrictions.allowedClasses.includes(equipChar.classId)
            ) {
              return reply.send({
                txId: body.txId,
                accepted: false,
                stateVersion: state.stateVersion,
                errorCode: "RESTRICTION_FAILED",
                errorMessage: `Class '${equipChar.classId}' is not in allowedClasses [${restrictions.allowedClasses.join(", ")}].`,
              });
            }

            if (
              restrictions.blockedClasses &&
              restrictions.blockedClasses.includes(equipChar.classId)
            ) {
              return reply.send({
                txId: body.txId,
                accepted: false,
                stateVersion: state.stateVersion,
                errorCode: "RESTRICTION_FAILED",
                errorMessage: `Class '${equipChar.classId}' is in blockedClasses [${restrictions.blockedClasses.join(", ")}].`,
              });
            }

            if (
              restrictions.requiredCharacterLevel != null &&
              equipChar.level < restrictions.requiredCharacterLevel
            ) {
              return reply.send({
                txId: body.txId,
                accepted: false,
                stateVersion: state.stateVersion,
                errorCode: "RESTRICTION_FAILED",
                errorMessage: `Character level ${equipChar.level} is below required level ${restrictions.requiredCharacterLevel}.`,
              });
            }

            if (
              restrictions.maxLevelDelta != null &&
              equipGearInst.level >
                equipChar.level + restrictions.maxLevelDelta
            ) {
              return reply.send({
                txId: body.txId,
                accepted: false,
                stateVersion: state.stateVersion,
                errorCode: "RESTRICTION_FAILED",
                errorMessage: `Gear level ${equipGearInst.level} exceeds character level ${equipChar.level} + maxLevelDelta ${restrictions.maxLevelDelta}.`,
              });
            }
          }

          // Resolve target slot pattern
          let targetPattern: string[];
          if (body.slotPattern) {
            targetPattern = body.slotPattern;
          } else {
            // Auto-resolve: gearDef must have exactly one equipPattern
            if (equipGearDef.equipPatterns.length === 0) {
              return reply.send({
                txId: body.txId,
                accepted: false,
                stateVersion: state.stateVersion,
                errorCode: "SLOT_INCOMPATIBLE",
                errorMessage: `Gear '${equipGearId}' has no equip patterns.`,
              });
            }
            if (equipGearDef.equipPatterns.length > 1) {
              return reply.send({
                txId: body.txId,
                accepted: false,
                stateVersion: state.stateVersion,
                errorCode: "SLOT_INCOMPATIBLE",
                errorMessage: `Gear '${equipGearId}' has multiple equip patterns; provide slotPattern to disambiguate.`,
              });
            }
            targetPattern = equipGearDef.equipPatterns[0];
          }

          // Validate all slotIds exist in config
          for (const slotId of targetPattern) {
            if (!equipConfig.slots.includes(slotId)) {
              return reply.send({
                txId: body.txId,
                accepted: false,
                stateVersion: state.stateVersion,
                errorCode: "INVALID_SLOT",
                errorMessage: `Slot '${slotId}' does not exist in config.`,
              });
            }
          }

          // Validate gearDef has an exact matching equipPattern
          const hasMatchingPattern = equipGearDef.equipPatterns.some(
            (p) =>
              p.length === targetPattern.length &&
              p.every((s, i) => s === targetPattern[i]),
          );
          if (!hasMatchingPattern) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "SLOT_INCOMPATIBLE",
              errorMessage: `Gear '${equipGearId}' has no matching equip pattern for [${targetPattern.join(", ")}].`,
            });
          }

          // Check all slots are free (strict mode)
          for (const slotId of targetPattern) {
            if (equipChar.equipped[slotId]) {
              return reply.send({
                txId: body.txId,
                accepted: false,
                stateVersion: state.stateVersion,
                errorCode: "SLOT_OCCUPIED",
                errorMessage: `Slot '${slotId}' is already occupied.`,
              });
            }
          }

          // Mutation: set all slots atomically
          for (const slotId of targetPattern) {
            equipChar.equipped[slotId] = equipGearId;
          }
          equipGearInst.equippedBy = equipCharId;
          state.stateVersion++;

          return reply.send({
            txId: body.txId,
            accepted: true,
            stateVersion: state.stateVersion,
          });
        }

        case "UnequipGear": {
          if (!player) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "PLAYER_NOT_FOUND",
              errorMessage: `Player '${playerId}' not found.`,
            });
          }

          const unequipGearId = body.gearId!;
          const unequipGearInst = player.gear[unequipGearId];
          if (!unequipGearInst) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "GEAR_NOT_FOUND",
              errorMessage: `Gear '${unequipGearId}' not found.`,
            });
          }

          if (!unequipGearInst.equippedBy) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "GEAR_NOT_EQUIPPED",
              errorMessage: `Gear '${unequipGearId}' is not equipped.`,
            });
          }

          // If client provided characterId, validate it matches
          if (
            body.characterId &&
            body.characterId !== unequipGearInst.equippedBy
          ) {
            return reply.send({
              txId: body.txId,
              accepted: false,
              stateVersion: state.stateVersion,
              errorCode: "CHARACTER_MISMATCH",
              errorMessage: `Gear '${unequipGearId}' is equipped by '${unequipGearInst.equippedBy}', not '${body.characterId}'.`,
            });
          }

          // Find the character and remove the slot entry
          const equippedCharId = unequipGearInst.equippedBy;
          const equippedChar = player.characters[equippedCharId];
          if (equippedChar) {
            for (const [slotId, gId] of Object.entries(
              equippedChar.equipped,
            )) {
              if (gId === unequipGearId) {
                delete equippedChar.equipped[slotId];
              }
            }
          }

          unequipGearInst.equippedBy = null;
          state.stateVersion++;

          return reply.send({
            txId: body.txId,
            accepted: true,
            stateVersion: state.stateVersion,
          });
        }

        default:
          return reply.send({
            txId: body.txId,
            accepted: false,
            stateVersion: state.stateVersion,
            errorCode: "UNSUPPORTED_TX_TYPE",
            errorMessage: `Transaction type '${body.type}' is not yet supported.`,
          });
      }
    },
  );

  done();
};

export default txRoutes;
