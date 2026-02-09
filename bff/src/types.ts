// Request bodies for the simplified BFF API.
// The BFF fills txId, gameInstanceId, and playerId automatically.

export interface CreateCharacterRequest {
  characterId: string;
  classId: string;
}

export interface CreateGearRequest {
  gearId: string;
  gearDefId: string;
}

export interface EquipGearRequest {
  characterId: string;
  gearId: string;
  slotPattern?: string[];
  swap?: boolean;
}

export interface UnequipGearRequest {
  gearId: string;
  characterId?: string;
}

export interface LevelUpCharacterRequest {
  characterId: string;
  levels?: number;
}

export interface LevelUpGearRequest {
  gearId: string;
  levels?: number;
  characterId?: string;
}
