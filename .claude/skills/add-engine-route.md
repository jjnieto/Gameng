# Add Engine Route

Pattern for adding a new endpoint to the Gameng engine.

## Steps

### 1. Create route file

Create `src/routes/<name>.ts` following this pattern:

```typescript
import type { FastifyInstance, FastifyPluginCallback } from "fastify";

interface <Name>Params {
  gameInstanceId: string;
}

const <name>Routes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
) => {
  app.get<{ Params: <Name>Params }>(
    "/:gameInstanceId/<path>",
    (request, reply) => {
      const { gameInstanceId } = request.params;

      const state = app.gameInstances.get(gameInstanceId);
      if (!state) {
        return reply.code(404).send({
          errorCode: "INSTANCE_NOT_FOUND",
          errorMessage: `Game instance '${gameInstanceId}' not found.`,
        });
      }

      // Route logic here
      return reply.send(result);
    },
  );

  done();
};

export default <name>Routes;
```

### 2. Register in `src/app.ts`

```typescript
import <name>Routes from "./routes/<name>.js";
// ...
app.register(<name>Routes);
```

### 3. Update OpenAPI spec

Add to `openapi/openapi.yaml`:
- New path under `paths:`
- Any new schemas under `components: schemas:`
- Use `$ref` for reusable schemas
- Add appropriate tag

### 4. Write tests

In `tests/<name>.test.ts`:
- 200 happy path
- 404 INSTANCE_NOT_FOUND for unknown gameInstanceId
- Auth tests if the route requires auth (401, 403)
- Use `app.inject()` pattern

### 5. Verify

```bash
npm run check
npm run test:e2e
```

## Checklist

- [ ] Auth required? (use `resolveActor()` from `src/auth.ts`)
- [ ] Instance existence check (404)?
- [ ] OpenAPI path + schemas added?
- [ ] Tests cover happy path + error cases?
- [ ] Route registered in `app.ts`?
