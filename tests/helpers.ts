import type { Player } from "../src/state.js";
import { expect } from "vitest";

/**
 * Assert bidirectional equip/equippedBy invariants for a player.
 *
 * Forward:  every character.equipped[slot]=gearId → gear exists AND gear.equippedBy === charId
 * Reverse:  every gear.equippedBy=charId → character exists AND at least one slot references gearId
 */
export function assertEquipInvariants(player: Player): void {
  // Forward sweep
  for (const [charId, character] of Object.entries(player.characters)) {
    for (const [slotId, gearId] of Object.entries(character.equipped)) {
      const gear = player.gear[gearId];
      expect(
        gear,
        `Forward: slot '${slotId}' on char '${charId}' references non-existent gear '${gearId}'`,
      ).toBeDefined();
      expect(
        gear.equippedBy,
        `Forward: gear '${gearId}' in slot '${slotId}' of char '${charId}' has equippedBy='${String(gear.equippedBy)}', expected '${charId}'`,
      ).toBe(charId);
    }
  }

  // Reverse sweep
  for (const [gearId, gear] of Object.entries(player.gear)) {
    if (!gear.equippedBy) continue;
    const charId = gear.equippedBy;
    const character = player.characters[charId];
    expect(
      character,
      `Reverse: gear '${gearId}' has equippedBy='${charId}' but character doesn't exist`,
    ).toBeDefined();
    const hasSlotRef = Object.values(character.equipped).includes(gearId);
    expect(
      hasSlotRef,
      `Reverse: gear '${gearId}' has equippedBy='${charId}' but no slot references it`,
    ).toBe(true);
  }
}
