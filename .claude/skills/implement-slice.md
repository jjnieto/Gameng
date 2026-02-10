# Implement Slice

Full workflow for implementing a feature slice in Gameng.

## Input

The user provides a slice plan (inline or as a document path). The plan specifies files to create/edit, tests, and expected behavior.

## Workflow

1. **Read the plan** — Understand all files, changes, and test expectations.
2. **Read existing code** — Before editing any file, read it first. Understand patterns.
3. **Implement in order:**
   - Types/interfaces first (`src/state.ts` if needed)
   - Core logic (algorithms, handlers)
   - Routes (`src/routes/<name>.ts`) — use FastifyPluginCallback + `done` pattern
   - Register in `src/app.ts`
   - Update `openapi/openapi.yaml` if there's a new endpoint or schema
   - Create tests (`tests/<name>.test.ts`)
4. **Run verification:**
   - `npm run check` (lint + typecheck + unit tests + schema validation + openapi)
   - `npm run test:e2e` (E2E tests)
   - `npm run bff:test` (if BFF was touched)
5. **Fix any failures** — Lint errors, type errors, test failures.
6. **Update MEMORY.md** — Add the slice to "Phases Completed" with summary and test counts. Record any new gotchas.

## Conventions

- ESM imports with `.js` extension
- Fastify plugins: async or use `done` callback
- Tests use `app.inject()` (no network)
- ADMIN_API_KEY tests need both `ADMIN_KEY` and `TEST_API_KEY`
- Game instance ID in tests is `instance_001`
- Use `structuredClone()` for deep copies
- Never change example configs without auditing all tests that use them

## Output

Report: files created/edited, test count before→after, all checks green.
