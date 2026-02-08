import type { GameState, GameConfig } from "./state.js";

export interface MigrationWarning {
  playerId: string;
  entityType: "character" | "gear";
  entityId: string;
  rule: string;
  detail: string;
}

export interface MigrationReport {
  gameInstanceId: string;
  originalConfigId: string;
  targetConfigId: string;
  warnings: MigrationWarning[];
  slotsRemoved: number;
  gearsUnequipped: number;
  orphanedClasses: number;
  orphanedGearDefs: number;
}

export function migrateStateToConfig(
  state: GameState,
  config: GameConfig,
): { migratedState: GameState; report: MigrationReport } {
  const migratedState: GameState = structuredClone(state);

  // Normalize actors for legacy snapshots that don't have it (runtime JSON may lack it)
  if (!(migratedState as unknown as { actors?: unknown }).actors) {
    migratedState.actors = {};
  }

  // Normalize txIdCache for legacy snapshots that don't have it
  if (!(migratedState as unknown as { txIdCache?: unknown }).txIdCache) {
    migratedState.txIdCache = [];
  }

  // Normalize character resources for legacy snapshots
  for (const player of Object.values(migratedState.players)) {
    for (const character of Object.values(player.characters)) {
      if (
        !(character as unknown as { resources?: unknown }).resources
      ) {
        character.resources = {};
      }
    }
  }

  const report: MigrationReport = {
    gameInstanceId: state.gameInstanceId,
    originalConfigId: state.gameConfigId,
    targetConfigId: config.gameConfigId,
    warnings: [],
    slotsRemoved: 0,
    gearsUnequipped: 0,
    orphanedClasses: 0,
    orphanedGearDefs: 0,
  };

  // Step 1: Stamp gameConfigId
  migratedState.gameConfigId = config.gameConfigId;

  const validSlots = new Set(config.slots);

  for (const [playerId, player] of Object.entries(migratedState.players)) {
    // Step 2: Slot removal — delete equipped[slotId] where slotId not in config.slots
    for (const [charId, character] of Object.entries(player.characters)) {
      for (const slotId of Object.keys(character.equipped)) {
        if (!validSlots.has(slotId)) {
          const gearId = character.equipped[slotId];
          delete character.equipped[slotId];
          report.slotsRemoved++;
          report.warnings.push({
            playerId,
            entityType: "character",
            entityId: charId,
            rule: "SLOT_REMOVED",
            detail: `Slot '${slotId}' removed (gear '${gearId}' was in it)`,
          });
        }
      }
    }

    // Step 3: Orphaned gearDefs — unequip gear whose gearDefId is not in config
    for (const [gearId, gearInst] of Object.entries(player.gear)) {
      if (!(gearInst.gearDefId in config.gearDefs)) {
        report.orphanedGearDefs++;
        if (gearInst.equippedBy) {
          const charId = gearInst.equippedBy;
          const character = player.characters[charId];
          if (character) {
            for (const [slotId, slotGearId] of Object.entries(
              character.equipped,
            )) {
              if (slotGearId === gearId) {
                delete character.equipped[slotId];
              }
            }
          }
          gearInst.equippedBy = null;
          report.gearsUnequipped++;
          report.warnings.push({
            playerId,
            entityType: "gear",
            entityId: gearId,
            rule: "GEARDEF_ORPHANED",
            detail: `GearDef '${gearInst.gearDefId}' not in config; gear unequipped from '${charId}'`,
          });
        } else {
          report.warnings.push({
            playerId,
            entityType: "gear",
            entityId: gearId,
            rule: "GEARDEF_ORPHANED",
            detail: `GearDef '${gearInst.gearDefId}' not in config; gear stays in inventory`,
          });
        }
      }
    }

    // Step 4: EquipPattern mismatch — for still-equipped gear with valid gearDef,
    // check if the occupied slots match any equipPattern
    for (const [charId, character] of Object.entries(player.characters)) {
      // Group equipped slots by gearId
      const slotsByGearId = new Map<string, string[]>();
      for (const [slotId, gearId] of Object.entries(character.equipped)) {
        const slots = slotsByGearId.get(gearId);
        if (slots) {
          slots.push(slotId);
        } else {
          slotsByGearId.set(gearId, [slotId]);
        }
      }

      for (const [gearId, occupiedSlots] of slotsByGearId) {
        const gearInst = player.gear[gearId];
        if (!gearInst) continue; // will be caught by invariant pass
        const gearDef = config.gearDefs[gearInst.gearDefId];
        if (!gearDef) continue; // already handled in step 3

        // Check if occupiedSlots match any equipPattern
        const sortedOccupied = [...occupiedSlots].sort();
        const hasMatch = gearDef.equipPatterns.some((pattern) => {
          const sortedPattern = [...pattern].sort();
          return (
            sortedPattern.length === sortedOccupied.length &&
            sortedPattern.every((s, i) => s === sortedOccupied[i])
          );
        });

        if (!hasMatch) {
          // Unequip: remove from all occupied slots and clear equippedBy
          for (const slotId of occupiedSlots) {
            delete character.equipped[slotId];
          }
          gearInst.equippedBy = null;
          report.gearsUnequipped++;
          report.warnings.push({
            playerId,
            entityType: "gear",
            entityId: gearId,
            rule: "EQUIPPATTERN_MISMATCH",
            detail: `Slots [${occupiedSlots.join(", ")}] on character '${charId}' don't match any equipPattern`,
          });
        }
      }
    }

    // Step 5: Orphaned classes — warn only, no mutation
    for (const [charId, character] of Object.entries(player.characters)) {
      if (!(character.classId in config.classes)) {
        report.orphanedClasses++;
        report.warnings.push({
          playerId,
          entityType: "character",
          entityId: charId,
          rule: "CLASS_ORPHANED",
          detail: `Class '${character.classId}' not in config; character preserved, stats will be 0`,
        });
      }
    }

    // Step 6: Invariant enforcement — bidirectional sweep

    // Forward: character.equipped[slot]=gearId → gear exists and gear.equippedBy == charId
    for (const [charId, character] of Object.entries(player.characters)) {
      for (const [slotId, gearId] of Object.entries(character.equipped)) {
        const gearInst = player.gear[gearId];
        if (!gearInst || gearInst.equippedBy !== charId) {
          delete character.equipped[slotId];
          if (gearInst && gearInst.equippedBy !== charId) {
            // gear exists but points elsewhere — just remove slot reference
          }
          report.warnings.push({
            playerId,
            entityType: "character",
            entityId: charId,
            rule: "INVARIANT_FORWARD",
            detail: `Slot '${slotId}' referenced gear '${gearId}' which ${!gearInst ? "does not exist" : `is equipped by '${String(gearInst.equippedBy)}'`}; slot cleared`,
          });
        }
      }
    }

    // Reverse: gear.equippedBy=charId → character exists and has a slot pointing to gearId
    for (const [gearId, gearInst] of Object.entries(player.gear)) {
      if (!gearInst.equippedBy) continue;
      const charId = gearInst.equippedBy;
      const character = player.characters[charId];
      if (!character) {
        gearInst.equippedBy = null;
        report.warnings.push({
          playerId,
          entityType: "gear",
          entityId: gearId,
          rule: "INVARIANT_REVERSE",
          detail: `equippedBy '${charId}' but character does not exist; equippedBy cleared`,
        });
        continue;
      }

      const hasSlotRef = Object.values(character.equipped).includes(gearId);
      if (!hasSlotRef) {
        gearInst.equippedBy = null;
        report.warnings.push({
          playerId,
          entityType: "gear",
          entityId: gearId,
          rule: "INVARIANT_REVERSE",
          detail: `equippedBy '${charId}' but no slot references this gear; equippedBy cleared`,
        });
      }
    }
  }

  // Step 7: Bump stateVersion only if any warnings were generated
  if (report.warnings.length > 0) {
    migratedState.stateVersion++;
  }

  return { migratedState, report };
}
