# Gameng

Server-side data-driven RPG engine.

## Prerequisites

- Node.js >= 20
- npm >= 10

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

The server starts on `http://localhost:3000` by default. Configure with `PORT` and `HOST` environment variables.

## Scripts

| Command                | Description                              |
| ---------------------- | ---------------------------------------- |
| `npm run dev`          | Start dev server with hot reload         |
| `npm start`            | Start production server (requires build) |
| `npm run build`        | Compile TypeScript to `dist/`            |
| `npm test`             | Run tests                                |
| `npm run lint`         | Lint source and test files               |
| `npm run lint:fix`     | Lint and auto-fix                        |
| `npm run format`       | Format all files with Prettier           |
| `npm run format:check` | Check formatting                         |
| `npm run typecheck`    | Type-check without emitting              |
| `npm run validate`     | Validate schemas and OpenAPI spec        |

## Verification

Run all checks:

```bash
npm run typecheck && npm run lint && npm run format:check && npm run validate && npm test
```

## Project Structure

```
src/              Source code
  routes/         Fastify route plugins
tests/            Test files
openapi/          OpenAPI specifications
schemas/          JSON Schema definitions (future)
examples/         Golden files (future)
docs/             Documentation
```
