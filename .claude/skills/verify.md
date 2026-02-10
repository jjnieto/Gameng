# Verify

Run the full verification pipeline for the Gameng project.

## Steps

Run these commands in sequence. Stop at the first failure and fix it before continuing.

### 1. Engine check (lint + typecheck + unit tests + schemas + openapi)

```bash
npm run check
```

This runs: `npm run lint && npm run typecheck && npm test && npm run validate`

Report the test count from the output (e.g., "373 passed").

### 2. Engine E2E tests

```bash
npm run test:e2e
```

This builds first (`tsc`), then runs E2E tests against a spawned server.

Report the test count (e.g., "81 passed").

### 3. BFF tests

```bash
npm run bff:test
```

Report the test count (e.g., "63 passed").

### 4. Summary

Report total:
- Engine unit: X tests
- Engine E2E: X tests
- BFF: X tests
- Total: X tests
- Status: all green / N failures

## If something fails

- **Lint error**: Fix the specific file. Common: unused imports, unsafe `any`.
- **Type error**: Read the file, understand the type mismatch.
- **Test failure**: Read the failing test, understand what changed.
- **Schema validation**: Check `examples/` match `schemas/`.
- **OpenAPI lint**: Check `openapi/openapi.yaml` structure.

Do NOT skip failing checks. Fix the root cause.
