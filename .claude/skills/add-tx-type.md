# Add Transaction Type

Pattern for adding a new transaction type to the Gameng engine.

## Steps

### 1. Update `src/routes/tx.ts`

Add the new type to the appropriate switch block:

**If admin-gated** (like CreateActor, GrantResources):
- Add case label to the admin fall-through block
- MUST add `if (body.type === "NewType")` guard — fall-through without guard causes all types to execute the first handler
- Uses `ADMIN_API_KEY` auth, not actor auth

**If actor-gated** (like CreateCharacter, EquipGear):
- Add case label to the actor switch block
- Needs `resolveActor()` + ownership check (except CreatePlayer which has no player yet)

### 2. Update TypeScript types

In `src/state.ts` or `src/routes/tx.ts`:
- Add fields to `TxBody` interface if needed
- Add any new state interfaces

### 3. Update JSON Schema

In `schemas/transaction.schema.json`:
- Add to `type.enum` array
- Add `allOf` conditional for required fields
- Add any new field definitions to `properties`

### 4. Update OpenAPI

In `openapi/openapi.yaml`:
- Add to `Transaction.properties.type.enum`
- Add corresponding `allOf` conditional
- Update description if needed

### 5. Create example

In `examples/`:
- Add `tx_<name>.json` example
- Update `scripts/validate-schemas.ts` mapping if needed

### 6. Write tests

- TX accepted (happy path)
- TX rejected (domain error, e.g., ALREADY_EXISTS)
- Auth: 401 without token, 403 ownership violation
- Idempotency: same txId returns cached response
- Edge cases specific to the type

### 7. Verify

```bash
npm run check
npm run test:e2e
```

## Common Pitfalls

- Admin switch fall-through: ALWAYS guard with `if (body.type === "X")`
- CreatePlayer needs auth but NOT ownership check
- GrantResources/GrantCharacterResources are admin-only, no actor auth
- `Player.resources` is optional — use `player.resources ?? {}`
- Resources in GrantCharacterResources are unprefixed (`{ xp: 500 }`)
