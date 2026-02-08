# Error Codes Catalog

Canonical reference for every `errorCode` returned by the Gameng API.

> **Source of truth:** This file is the single source of truth for error code strings. Runtime code, OpenAPI spec, and SEMANTICS.md reference this catalog.

---

## Categories

| Category | HTTP Status | Response Shape |
|---|---|---|
| **Infrastructure** | 400 / 401 / 403 / 404 / 500 | `{ errorCode, errorMessage }` |
| **Transaction domain** | 200 | `{ txId, accepted: false, stateVersion, errorCode, errorMessage }` |

---

## Infrastructure Errors

Returned as top-level HTTP error responses (non-200). These apply to any endpoint, not just transactions.

| Code | HTTP | Endpoints | Trigger |
|---|---|---|---|
| `INSTANCE_NOT_FOUND` | 404 | All `/:gameInstanceId/*` | `gameInstanceId` not found in the instance store. |
| `INSTANCE_MISMATCH` | 400 | `POST /:gameInstanceId/tx` | `body.gameInstanceId` does not match the path parameter. |
| `CONFIG_NOT_FOUND` | 500 | `POST /:gameInstanceId/tx`, `GET .../stats` | The `gameConfigId` referenced by the instance is not loaded. Server misconfiguration. |
| `INVALID_CONFIG_REFERENCE` | 500 | `GET .../stats` | The `algorithms.growth.algorithmId` is unknown or its `params` are malformed. |
| `PLAYER_NOT_FOUND` | 404 | `GET .../state/player/:playerId` | `playerId` not found in `state.players`. |
| `CHARACTER_NOT_FOUND` | 404 | `GET .../character/:characterId/stats` | `characterId` not found in any player. |
| `UNAUTHORIZED` | 401 | All protected endpoints | Missing or invalid Bearer token. For `POST /tx` with `CreateActor`, `GrantResources`, or `GrantCharacterResources`, the ADMIN_API_KEY must be set on the server and used as Bearer token. If ADMIN_API_KEY is not configured, admin operations always fail. For all other tx types, a valid actor token is required. |
| `OWNERSHIP_VIOLATION` | 403 | `GET .../state/player/:playerId`, `GET .../character/:characterId/stats` | Authenticated actor does not own the target player. |

> **Note:** `PLAYER_NOT_FOUND` and `CHARACTER_NOT_FOUND` also appear as transaction-domain errors (200 + `accepted: false`) when raised inside a transaction. The HTTP status depends on the endpoint context.

---

## Transaction Domain Errors

Returned with HTTP 200, `accepted: false`. The `stateVersion` reflects the version before the rejected transaction (no mutation occurred).

### Entity Lifecycle

| Code | Transactions | Trigger |
|---|---|---|
| `ALREADY_EXISTS` | CreateActor, CreatePlayer, CreateCharacter, CreateGear | The target entity (actor, player, character, or gear) already exists. |
| `PLAYER_NOT_FOUND` | All (except CreatePlayer, CreateActor) | `playerId` not found in `state.players`. |
| `CHARACTER_NOT_FOUND` | LevelUpCharacter, EquipGear, GrantCharacterResources | `characterId` not found in `player.characters`. |
| `GEAR_NOT_FOUND` | LevelUpGear, EquipGear, UnequipGear | `gearId` not found in `player.gear`. |
| `INVALID_CONFIG_REFERENCE` | CreateCharacter, CreateGear, EquipGear | `classId` or `gearDefId` does not exist in the game config. |

### Level-Up

| Code | Transactions | Trigger |
|---|---|---|
| `MAX_LEVEL_REACHED` | LevelUpCharacter, LevelUpGear | `currentLevel + levels` would exceed `config.maxLevel`. |
| `INSUFFICIENT_RESOURCES` | LevelUpCharacter, LevelUpGear | Player's or character's `resources` wallet does not have enough to cover the total cost computed by the level cost algorithm. |
| `INVALID_COST_RESOURCE_KEY` | LevelUpCharacter, LevelUpGear | A cost key produced by the level cost algorithm lacks a `player.` or `character.` scope prefix. Indicates a config error. |
| `CHARACTER_REQUIRED` | LevelUpGear | The level cost algorithm produced `character.*` cost keys but the transaction body did not include `characterId`. |

### Equipment

| Code | Transactions | Trigger |
|---|---|---|
| `GEAR_ALREADY_EQUIPPED` | EquipGear | `gear.equippedBy` is truthy (gear is already on a character). |
| `GEAR_NOT_EQUIPPED` | UnequipGear | `gear.equippedBy` is falsy (gear is not on any character). |
| `INVALID_SLOT` | EquipGear | A `slotId` in the resolved pattern does not exist in `config.slots`. |
| `SLOT_INCOMPATIBLE` | EquipGear | No `equipPattern` in the gear definition matches the resolved slot pattern; or the gear has zero patterns; or the gear has multiple patterns and no `slotPattern` was provided (ambiguity). |
| `RESTRICTION_FAILED` | EquipGear | A `gearDef.restrictions` rule failed: class not in allowedClasses, class in blockedClasses, character level too low, or gear level exceeds maxLevelDelta. |
| `SLOT_OCCUPIED` | EquipGear | One or more target slots on the character already have gear equipped (strict mode). |
| `CHARACTER_MISMATCH` | UnequipGear | Client-provided `characterId` does not match `gear.equippedBy`. |

### Authorization

| Code | Transactions | Trigger |
|---|---|---|
| `OWNERSHIP_VIOLATION` | All player-scoped tx types | Authenticated actor does not own the target player. |
| `DUPLICATE_API_KEY` | CreateActor | Another actor already uses this apiKey. |

### Catch-All

| Code | Transactions | Trigger |
|---|---|---|
| `UNSUPPORTED_TX_TYPE` | (any unknown `type`) | The `type` field is not a recognized transaction type. |

---

## Validation Order (EquipGear)

When multiple validations fail simultaneously, the first matching error is returned:

1. `PLAYER_NOT_FOUND`
2. `CONFIG_NOT_FOUND` (500)
3. `CHARACTER_NOT_FOUND`
4. `GEAR_NOT_FOUND`
5. `GEAR_ALREADY_EQUIPPED`
6. `INVALID_CONFIG_REFERENCE` (gearDefId not in config)
7. `RESTRICTION_FAILED` (class allowlist/blocklist, then level checks)
8. Resolve slot pattern (auto or explicit)
9. `INVALID_SLOT` (each slot in pattern exists in config)
10. `SLOT_INCOMPATIBLE` (pattern matches a gearDef equipPattern)
11. `SLOT_OCCUPIED` (all target slots are free)
