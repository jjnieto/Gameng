# Semantics — Domain Decisions and Open Questions

This document tracks domain-level decisions and ambiguities. Items marked **TODO** need resolution before the relevant slice is implemented.

## Decided

### 1. Multi-slot gear and set piece counting

**Context:** SPEC §9 says "for gear occupying 2 slots, the config defines whether it counts as 1 or 2 pieces (default 1)."

**Decision:** Per-gearDef, optional field `setPieceCount` (integer, 1 or 2, default 1).

- Placed in `GearDef` because it's a property of the gear type, not the set or a global setting.
- If absent, counts as 1.

**Schema change:** Added `setPieceCount` to `GearDef` in `game_config.schema.json`.

### 2. Stat clamp: min/max per stat

**Context:** SPEC §8.2 says "each stat can optionally define a min (e.g. 0) and/or max to apply clamp after calculation."

**Decision:** Optional `statClamps` map at the root of the config.

- Keeps `stats` as a simple `string[]` (catalogue of IDs only).
- Purely additive: if `statClamps` is absent, no clamping occurs.
- Runtime applies clamp post-calculation only for stats listed in the map.
- Format: `"statClamps": { "hp": { "min": 0 }, "crit_chance": { "min": 0, "max": 1 } }`

**Schema change:** Added optional `statClamps` property at root + `StatClamp` definition in `game_config.schema.json`.

### 3. Algorithm params structure

**Context:** SPEC §7.2, §12 reference `algorithmId` + `params` but the internal structure of params is intentionally open.

**Decision:** Params remain an open `object` in the schema (`"type": "object"` without `additionalProperties` constraint). Concrete algorithm implementations will define their expected param shapes at runtime.

**Schema change:** None (already correct).

### 4. Allowed + blocked classes on same gearDef

**Context:** SPEC §6.3 mentions "allowlist or blocklist of classId."

**Decision:** Mutually exclusive. The schema forbids specifying both on the same gearDef.

- If neither present: no class restriction.
- If `allowedClasses` present: only those classIds may equip.
- If `blockedClasses` present: those classIds may NOT equip.
- If both present: schema validation fails.

**Schema change:** Added `"not": { "required": ["allowedClasses", "blockedClasses"] }` to `GearRestrictions` in `game_config.schema.json`.

### 5. txId format and idempotency

**Context:** DELIVERABLES §1.1 mentions idempotency via txId, but format and duplicate-handling are unspecified.

**Decision:** txId is a freeform non-empty string. Idempotency is server-side with per-instance cache.

- No UUID format imposed (allows client flexibility).
- The server detects duplicate txIds per `gameInstanceId` and returns the cached result.
- Cache TTL is configurable at runtime (suggested 3600s), outside schema scope.

**Schema change:** None (already correct: `"type": "string", "minLength": 1`).

### 6. UnequipGear: required fields

**Context:** SPEC §10.3 lists `UnequipGear` without explicit params.

**Decision:** Only `gearId` is required. `characterId` is optional (validation hint).

- The server is authoritative: it looks up which character has the gear equipped from state.
- If the client sends `characterId`, the server validates that it matches.
- If the gear is not equipped, the server returns an error.

**Schema change:** None (already correct).

### 7. Default growth algorithm (Slice 3)

**Context:** SPEC §7.2 defines `scaledStats = GrowthAlgorithm(baseStats, level, context)`, but no concrete algorithm is implemented yet.

**Decision:** When no supported growth algorithm is implemented, the default behavior is **no scaling**: `finalStats = baseStats` from the class definition, regardless of character level.

- This applies to the `"flat"` algorithmId used in `config_minimal.json`.
- Stats not defined in the class baseStats default to `0`.
- The stats endpoint iterates all statIds from the config catalogue and returns a value for each.
- Once a real growth algorithm is implemented (e.g. linear, exponential), it will replace this default for the corresponding algorithmId.

**Schema change:** None.

### 8. LevelUpCharacter: levels parameter

**Context:** SPEC §10.3 lists `LevelUpCharacter` without specifying multi-level support.

**Decision:** Optional `levels` field (integer >= 1, default 1). The server adds `levels` to the current level in a single transaction.

- If `currentLevel + levels > maxLevel`, the transaction is rejected with `MAX_LEVEL_REACHED`.
- No partial level-up: either all levels are gained or none.
- No cost/resource validation in this slice.

**Schema change:** Added `levels` property to `transaction.schema.json`.

### 9. CreateCharacter: characterId required

**Context:** The transaction schema originally only required `classId` for `CreateCharacter`.

**Decision:** `characterId` is also required for `CreateCharacter`. The client chooses the character ID.

**Schema change:** Added `characterId` to the `then.required` for `CreateCharacter` in `transaction.schema.json`.

### 10. EquipGear / UnequipGear error codes (Slice 5)

**Context:** Slice 5 introduces EquipGear and UnequipGear transactions (1-slot patterns only). Several new error codes are needed for equipment validation.

**Decision:** Six new error codes introduced for equipment validation: `GEAR_ALREADY_EQUIPPED`, `GEAR_NOT_EQUIPPED`, `SLOT_OCCUPIED`, `SLOT_INCOMPATIBLE`, `INVALID_SLOT`, `CHARACTER_MISMATCH`.

See [`docs/ERROR_CODES.md`](ERROR_CODES.md) (Equipment section) for the full catalog with triggers and validation order.

**Schema change:** None (error codes are runtime-only; transaction schema already defines the `slotPattern` field).

### 11. slotPattern resolution rule (Slices 5–6)

**Context:** `slotPattern` is an optional field on EquipGear transactions. Its relationship to `gearDef.equipPatterns` and auto-resolution needed clarification. Updated in Slice 6 to support multi-slot patterns.

**Decision:**

- **When `slotPattern` is provided:** it must exactly match one of the `gearDef.equipPatterns` arrays (element-wise comparison). The server does not infer or modify the pattern.
- **When `slotPattern` is omitted:**
  - If the gearDef has exactly one equipPattern (any size) → auto-select it.
  - If the gearDef has zero equipPatterns → reject with `SLOT_INCOMPATIBLE`.
  - If the gearDef has multiple equipPatterns → reject with `SLOT_INCOMPATIBLE` ("provide slotPattern to disambiguate").

This avoids silent ambiguity when a gearDef can fit multiple slots or patterns.

**Multi-slot validation (Slice 6, strict mode):**
- All slotIds in the resolved pattern must exist in `config.slots` → `INVALID_SLOT`.
- All slots must be free on the character → `SLOT_OCCUPIED` (if any slot is occupied, the entire transaction is rejected with no side effects).
- Mutation is atomic: all slots are set to the gearId in a single operation.
- Stats are counted once per equipped gear, not once per occupied slot.

**Schema change:** None (slotPattern was already optional in the schema).

### 12. Equipment restrictions — class + level (Slice 7)

**Context:** `GearRestrictions` schema already defines `allowedClasses`, `blockedClasses`, `requiredCharacterLevel`, and `maxLevelDelta`. Runtime enforcement needed.

**Decision:** Single `RESTRICTION_FAILED` error code with descriptive `errorMessage` indicating which rule failed. Short-circuits on first failure (no batching of multiple restriction violations).

**Validation order within restrictions:**
1. `allowedClasses` — if present, `character.classId` must be in the list.
2. `blockedClasses` — if present, `character.classId` must NOT be in the list.
3. `requiredCharacterLevel` — if present, `character.level >= value`.
4. `maxLevelDelta` — if present, `gear.level <= character.level + value`.

Restriction checks run after `GEAR_ALREADY_EQUIPPED` and before slot pattern resolution in the EquipGear validation order. If `gearDef.restrictions` is absent or empty, all restrictions pass.

**Schema change:** None (restrictions already defined in `game_config.schema.json`).

### 13. Set bonuses — piece counting and threshold activation (Slice 8)

**Context:** SPEC §9 defines sets with threshold-based bonuses (e.g. 2 pieces, 4 pieces). `GearDef.setId` references a set, and `GearDef.setPieceCount` (default 1) controls how many pieces a single gear contributes.

**Decision:**

- **Piece counting:** For each equipped gear with a `setId`, the set piece count is `sum(gearDef.setPieceCount)` across all distinct equipped gear belonging to that set. Multi-slot gear is counted once (deduplication by gearId, same as gear stats).
- **Threshold activation:** For each set, all bonuses where `equippedPieces >= bonus.pieces` are activated simultaneously. Multiple thresholds can be active at once (e.g. both 2-piece and 4-piece bonuses when 4+ pieces are equipped).
- **Bonus application:** Active `bonusStats` are summed into `finalStats` after gear stats, before any future stat clamp.
- **Missing setId in config:** If a `gearDef.setId` references a `setId` not present in `config.sets`, the gear is silently ignored for set bonus purposes (no error, no bonus). This supports forward-compatible configs where gear may reference sets not yet defined.

**Formula:** `finalStats = charStats + gearStats + setBonusStats` (per SPEC §8.1).

**Schema change:** None (SetDef, SetBonus, setId, setPieceCount already defined in `game_config.schema.json`).

### 14. Snapshot persistence — file policy and restore (Slice 9A)

**Context:** SPEC §11 requires persisting GameState to disk for durability. No database, no migration system.

**Decision:**

- **Storage format:** One JSON file per `gameInstanceId`, named `{gameInstanceId}.json`, in a configurable snapshot directory.
- **Validation:** Snapshots are validated against `schemas/game_state.schema.json` (Ajv) before writing. Invalid states are not persisted.
- **Atomic write:** Write to `.tmp` file first, then delete target (if exists), then rename. This prevents corruption from partial writes. `.tmp` leftovers from interrupted writes are ignored on load.
- **Configuration:** `SNAPSHOT_DIR` env var (or `snapshotDir` in `AppOptions`). If not set, no snapshots are written or loaded.
- **Periodic flush:** `SNAPSHOT_INTERVAL_MS` env var (or `snapshotIntervalMs` in `AppOptions`). If set, snapshots are flushed on a timer. Always flushed on graceful shutdown (`onClose` hook).
- **Manual flush:** `app.flushSnapshots()` method for tests and manual triggers.
- **Restore on startup:** All `.json` files in the snapshot directory are loaded and validated. Invalid JSON and schema-invalid files are logged and skipped (no crash). ~~Snapshots with unknown `gameConfigId` are skipped.~~ **Superseded by decision #15:** all valid snapshots are now migrated to the current config on restore.
- ~~**No migration:** Snapshots that don't match the current schema are discarded.~~ **Superseded by decision #15:** best-effort migration replaces discard-on-mismatch.

**Schema change:** None (game_state.schema.json already covers all required fields).

### 15. Best-effort migration on snapshot restore (Slice 9B)

**Context:** Slice 9A discards snapshots whose `gameConfigId` doesn't match the loaded config. Any config change loses all persisted state.

**Decision:** On startup, every restored snapshot is run through `migrateStateToConfig()`, which adapts state to the current config rather than discarding it. Migration is best-effort: player data is never deleted, but invalid references are cleaned up.

**Migration rules (applied in order):**
1. **Stamp gameConfigId** — set to the current config's `gameConfigId`.
2. **Slot removal** — `equipped[slotId]` entries where `slotId` is not in `config.slots` are deleted.
3. **Orphaned gearDefs** — Gear whose `gearDefId` is not in `config.gearDefs` is unequipped (removed from character's `equipped` map, `equippedBy` cleared). Gear remains in inventory.
4. **EquipPattern mismatch** — For still-equipped gear with a valid gearDef, if the occupied slots don't match any `gearDef.equipPatterns`, the gear is unequipped.
5. **Orphaned classes** — Characters whose `classId` is not in `config.classes` are preserved as-is. Warning emitted. Stats endpoint already returns 0 for unknown classes.
6. **Invariant enforcement** — Bidirectional sweep:
   - Forward: `equipped[slot]=gearId` where gear doesn't exist or `equippedBy` doesn't match → slot cleared.
   - Reverse: `gear.equippedBy=charId` where character doesn't exist or no slot references the gear → `equippedBy` cleared.
7. **stateVersion bump** — Only if any warnings were generated (state was mutated). No-op migrations leave stateVersion unchanged.

**Runtime guard:** EquipGear now validates `gearDefId` exists in config before restriction checks, returning `INVALID_CONFIG_REFERENCE` if missing. This prevents crashes when orphaned gear survives in inventory.

**Orphaned classId — runtime behavior:**
- **Stats endpoint:** `classDef` resolves to `undefined`; `classDef?.baseStats[statId] ?? 0` returns 0 for every stat. Gear stats and set bonuses still sum normally on top of that zero base. No crash.
- **EquipGear:** No explicit classId existence check. Restriction checks work naturally: if the gear has `allowedClasses` that doesn't include the orphaned class, `RESTRICTION_FAILED` is returned; if the gear has no class restrictions, equip succeeds. This is intentional — orphaned-class characters remain fully operational for unrestricted gear.
- **Other transactions:** CreateCharacter rejects unknown classId via `INVALID_CONFIG_REFERENCE` (prevents new orphaned characters). LevelUpCharacter, LevelUpGear, UnequipGear do not check classId and work normally.

**Schema change:** None.

### 16. Authorization — Minimal API Key (Bearer Token)

**Context:** The API had no authentication or authorization. Any client could perform any operation on any player's data.

**Decision:** Static API key authorization via Bearer tokens with an actor ownership model.

- **Actor model:** `GameState.actors: Record<actorId, Actor>` where `Actor = { apiKey: string; playerIds: string[] }`. Actors own players.
- **CreateActor transaction:** Unauthenticated bootstrap. Client chooses `actorId` + `apiKey`. Rejects duplicate actorId (`ALREADY_EXISTS`) and duplicate apiKey (`DUPLICATE_API_KEY`).
- **Auth approach:** Per-handler utility `resolveActor(authHeader, state)` scans `state.actors` for matching apiKey. No global Fastify hook — the TX handler needs per-type auth (CreateActor = no auth).
- **Ownership:** `CreatePlayer` requires auth and auto-associates the new playerId to the calling actor. All other player-scoped transactions check `actorOwnsPlayer(actor, playerId)` before proceeding.
- **Error codes:**
  - `UNAUTHORIZED` (HTTP 401) — missing/invalid Bearer token on protected endpoints.
  - `OWNERSHIP_VIOLATION` — TX: HTTP 200, `accepted: false`. GET: HTTP 403. Valid actor but doesn't own the player.
- **Protected endpoints:** All `POST /:id/tx` (except CreateActor), `GET /:id/state/player/:pid`, `GET /:id/character/:cid/stats`.
- **Unprotected endpoints:** `GET /health`, `GET /:id/config`, `GET /:id/stateVersion`.
- **Schema evolution:** `actors` is optional in `game_state.schema.json` (not in `required`). Old snapshots pass validation. Migrator fills `actors: {}` on legacy snapshots.
- **Transaction schema:** `playerId` removed from base `required`, added via negative conditional ("required unless CreateActor"). `CreateActor` requires `actorId` + `apiKey`.

**Schema change:** `game_state.schema.json` — added optional `actors` property and `Actor` definition. `transaction.schema.json` — added `CreateActor` to type enum, `actorId`/`apiKey` properties, conditional `playerId` requirement.

### 17. ADMIN_API_KEY — CreateActor bootstrap protection

**Context:** Decision #16 left CreateActor unauthenticated, allowing any client to create actors freely. This is a security gap — anyone can register actors and exhaust resources.

**Decision:** CreateActor now requires the server's `ADMIN_API_KEY` via Bearer token.

- **Configuration:** `ADMIN_API_KEY` env var (or `adminApiKey` in `AppOptions`). If not set, CreateActor is unauthenticated (backward-compatible for development).
- **Runtime check:** When `adminApiKey` is configured, the CreateActor handler validates `Authorization: Bearer <token>` against it. Returns 401 `UNAUTHORIZED` if missing, malformed, or mismatched.
- **Other tx types unchanged:** All non-CreateActor transactions continue to use the actor's own Bearer token.
- **Key rotation:** Requires server restart with new `ADMIN_API_KEY` value. No hot-reload.
- **Error code:** Reuses `UNAUTHORIZED` (HTTP 401). The `errorMessage` distinguishes "Missing or invalid admin API key." from actor token failures.

**Schema change:** None. This is a runtime-only configuration.

## TODO — Open Questions

_(No open questions remaining in this phase.)_
