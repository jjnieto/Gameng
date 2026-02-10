# Gameng — Claude Code Project Guide

Server-side data-driven RPG engine. TypeScript + Fastify 5 + ESM.

## Commands

```bash
npm run check          # lint + typecheck + unit tests + schema validation + openapi lint
npm run test:e2e       # build + E2E tests (spawns engine process)
npm run bff:test       # BFF unit/integration tests
npm run build          # TypeScript compile
npm run dev            # Dev server with tsx
npm run sandbox        # Launcher + React SPA (ports 4010 + 5173)
```

## Architecture

```
src/              Engine source (Fastify 5, port 3000)
  routes/         Route plugins (health, tx, player, stats, config, algorithms, state-version)
  algorithms/     Growth + level-cost registries with parametrizable catalog
bff/              Backend For Frontend (JWT auth + engine proxy, port 5000)
  src/auth/       JWT, bcrypt, middleware
  src/routes/     Auth, game, admin, health routes
sandbox/          Dev tools (launcher + React SPA)
tests/            Engine unit tests (vitest, app.inject())
tests/e2e/        Engine E2E tests (real HTTP, spawned process)
schemas/          JSON Schema draft-07 contracts
openapi/          OpenAPI 3.1.0 spec
examples/         Golden files / example configs
docs/             Documentation
```

## Key Conventions

### ESM
- All imports use `.js` extension: `import { foo } from "./bar.js"`
- `"type": "module"` in package.json
- Ajv: use `import { Ajv } from "ajv"` (named), NOT default import

### Fastify Plugins
- Must be `async` or use `done` callback. Sync without `done` silently breaks.
- Routes follow the pattern in `src/routes/config.ts` (FastifyPluginCallback + done)
- Register in `src/app.ts`

### Testing
- Engine unit tests: `app.inject()` (no network, no port)
- E2E tests: spawn real server via `process.execPath`, use `POST /__shutdown` for graceful stop
- BFF tests: fake engine (Fastify on random port) + in-memory SQLite
- `npm test` excludes `tests/e2e/**` and `sandbox/**`

### Auth Model
- Engine: API keys (Bearer token). `ADMIN_API_KEY` for CreateActor/GrantResources/GrantCharacterResources.
- BFF: JWT (register/login) → maps to engine actor apiKey via SQLite DB
- Admin TX types use fall-through switch — each handler MUST be guarded by `if (body.type === "X")`

### Config
- `createApp()` accepts `string | AppOptions` (backward-compatible)
- Single config per process (`app.activeConfig`)
- Game instance store: hardcoded `instance_001` at startup
- Algorithm IDs validated post-Ajv at config load

### State
- `Player.resources` and `Character.resources` are optional (legacy compat)
- Always initialize to `{}` in CreatePlayer
- Idempotency: FIFO cache per instance (`txIdCache`), ALL responses cached (not just 200)
- Snapshots: atomic writes, migration on restore via `migrateStateToConfig()`

## Important Gotchas

- **Windows SIGTERM**: `process.kill(pid, 'SIGTERM')` is a hard kill on Windows. Use `POST /__shutdown` (gated by `GAMENG_E2E=1`) for graceful shutdown.
- **`response.json()` returns `any`**: Use `response.json<Type>()` generic to avoid eslint unsafe errors.
- **Changing example configs breaks tests**: `config_minimal.json` with linear growth affects all tests with characters at level>1. Audit test impact.
- **GET nonexistent player returns 403**: Ownership check runs before player existence check.
- **Swap unequips ALL slots**: When a 1-slot equip displaces a 2-slot gear, swap clears both slots.
- **`parseScopedCost` throws Error, not errorCode**: Caught in LevelUp handler, converted to response.
- **BFF `@fastify/jwt` augmentation**: Augment `@fastify/jwt` module, NOT `FastifyRequest.user`.
- **Sandbox `erasableSyntaxOnly`**: No constructor parameter properties. Use field declarations.
- **Sandbox `verbatimModuleSyntax`**: Must use `import type` for type-only imports.

## What NOT to Change

- Engine `src/` when working on BFF (BFF is a separate process)
- `schemas/` without updating `examples/` and running `npm run validate`
- `openapi/openapi.yaml` without running `npm run validate:openapi`
- Example configs without auditing all test files that use them
