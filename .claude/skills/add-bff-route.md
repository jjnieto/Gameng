# Add BFF Route

Pattern for adding a new route to the BFF (Backend For Frontend).

## Principles

- BFF never exposes engine apiKeys or ADMIN_API_KEY to clients
- Client authenticates with JWT, BFF maps to actor apiKey via DB
- BFF fills txId (UUID), gameInstanceId, and playerId automatically
- All game actions and reads must have structured logging

## Steps

### 1. Add to `bff/src/routes/game-routes.ts`

**For TX routes** (POST):

```typescript
app.post<{ Body: NewActionRequest }>(
  "/game/<action>",
  authHooks,
  async (request, reply) => {
    const apiKey = resolveApiKey(request, userStore);
    const playerId = hasAuth ? request.user.playerId : undefined;
    if (!apiKey || !playerId) {
      return reply
        .code(401)
        .send({ errorCode: "UNAUTHORIZED", errorMessage: "Authentication required." });
    }
    const { field1, field2 } = request.body;
    await sendTx(config, apiKey, playerId, "TxType", { field1, field2 }, request, reply);
  },
);
```

`sendTx` handles: txId generation, proxy to engine, and structured logging.

**For read routes** (GET):

```typescript
app.get("/game/<path>", authHooks, async (request, reply) => {
  const apiKey = resolveApiKey(request, userStore);
  const start = performance.now();
  await proxyToEngine({ ... }, reply);
  logRead(request, reply, "actionName", { relevantId }, Math.round(performance.now() - start));
});
```

### 2. Add request type

In `bff/src/types.ts`:

```typescript
export interface NewActionRequest {
  field1: string;
  field2?: number;
}
```

### 3. Update `filterActionFields` if needed

In `game-routes.ts`, add any new safe field names to the `ALLOWED_KEYS` array. Only IDs and flags — never secrets.

### 4. Write tests

In `bff/tests/game-routes.test.ts`:
- Happy path: correct TX body sent to engine
- Without JWT: 401
- Auto-filled fields: txId, gameInstanceId, playerId

In `bff/tests/logging.test.ts`:
- Log entry contains expected fields
- No apiKeys or JWTs in logs

### 5. Verify

```bash
npm run bff:test
```

## Logging Rules

- Use `request.log.info({ fields... }, "game action")` for TX routes
- Use `request.log.info({ fields... }, "game read")` for GET routes
- Always include: userId, action, statusCode, durationMs
- NEVER log: apiKeys, JWTs, passwords, request.headers.authorization
- Use `filterActionFields()` allowlist for TX field logging
