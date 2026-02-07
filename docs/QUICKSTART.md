# Quickstart — Gameng Engine

Guía práctica para ir de 0 a funcionando.

---

## Requisitos

- **Node.js** >= 20 (recomendado: LTS actual)
- **npm** >= 9

Verificar:

```bash
node -v    # v20.x o superior
npm -v     # 9.x o superior
```

---

## Instalación

```bash
git clone <repo-url> gameng
cd gameng
npm ci
```

> `npm ci` instala dependencias exactas del lockfile. Usar `npm install` solo si es la primera vez sin `package-lock.json`.

---

## Arranque rápido

### Modo desarrollo (hot-reload)

```bash
npm run dev
```

Servidor en `http://localhost:3000` con la config por defecto (`examples/config_minimal.json`).

### Modo producción

```bash
npm run build
npm start
```

---

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `CONFIG_PATH` | `examples/config_minimal.json` | Ruta a la GameConfig JSON. Una config activa por proceso. |
| `PORT` | `3000` | Puerto HTTP. |
| `HOST` | `0.0.0.0` | Host de escucha. |
| `LOG_LEVEL` | `info` | Nivel de log de Fastify (`trace`, `debug`, `info`, `warn`, `error`). |
| `SNAPSHOT_DIR` | _(sin definir = sin persistencia)_ | Directorio para snapshots JSON por instancia. |
| `SNAPSHOT_INTERVAL_MS` | _(sin definir = sin flush periódico)_ | Intervalo en ms para flush periódico de snapshots. |
| `ADMIN_API_KEY` | _(requerido para admin ops)_ | Bearer token obligatorio para `CreateActor` y `GrantResources`. Si no se define, estas operaciones devuelven 401. |
| `GAMENG_MAX_IDEMPOTENCY_ENTRIES` | `1000` | Tamaño del cache FIFO de idempotencia por instancia. |
| `GAMENG_E2E_LOG_LEVEL` | `warn` | Nivel de log del servidor en tests E2E. |

### Configurar variables de entorno

**Linux / macOS:**

```bash
CONFIG_PATH=examples/config_sets.json \
  SNAPSHOT_DIR=./data \
  SNAPSHOT_INTERVAL_MS=30000 \
  ADMIN_API_KEY=mi-clave-admin \
  npm run dev
```

**Windows (PowerShell):**

```powershell
$env:CONFIG_PATH="examples\config_sets.json"
$env:SNAPSHOT_DIR=".\data"
$env:SNAPSHOT_INTERVAL_MS="30000"
$env:ADMIN_API_KEY="mi-clave-admin"
npm run dev
```

**Windows (cmd):**

```cmd
set CONFIG_PATH=examples\config_sets.json
set SNAPSHOT_DIR=.\data
set SNAPSHOT_INTERVAL_MS=30000
set ADMIN_API_KEY=mi-clave-admin
npm run dev
```

---

## Build y tests

| Comando | Descripción |
|---|---|
| `npm run build` | Compila TypeScript a `dist/`. |
| `npm test` | Tests unitarios (Vitest, excluye E2E). |
| `npm run test:e2e` | Build + tests E2E contra servidor real. |
| `npm run lint` | ESLint sobre `src/` y `tests/`. |
| `npm run typecheck` | `tsc --noEmit` — verifica tipos. |
| `npm run validate` | Valida examples contra JSON Schemas + lint OpenAPI. |
| `npm run check` | Todo junto: lint + typecheck + test + validate. |

### Verificar que todo está verde

```bash
npm run check
```

---

## Verificar que el servidor funciona

```bash
curl http://localhost:3000/health
```

```json
{ "status": "ok", "timestamp": "2025-01-15T10:30:00.000Z", "uptime": 1.23 }
```

---

## Flujo típico: de 0 a stats

### 1. Crear un actor (auth bootstrap)

Requiere `ADMIN_API_KEY`:

```bash
curl -X POST http://localhost:3000/instance_001/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mi-clave-admin" \
  -d '{
    "txId": "tx_001",
    "type": "CreateActor",
    "gameInstanceId": "instance_001",
    "actorId": "actor_1",
    "apiKey": "mi-token-secreto"
  }'
```

```json
{ "txId": "tx_001", "accepted": true, "stateVersion": 1 }
```

> A partir de aquí, todas las operaciones usan `Bearer mi-token-secreto`.

### 2. Crear un player

```bash
curl -X POST http://localhost:3000/instance_001/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mi-token-secreto" \
  -d '{
    "txId": "tx_002",
    "type": "CreatePlayer",
    "gameInstanceId": "instance_001",
    "playerId": "player_1"
  }'
```

El player queda asociado al actor que lo creó.

### 3. Crear un personaje

```bash
curl -X POST http://localhost:3000/instance_001/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mi-token-secreto" \
  -d '{
    "txId": "tx_003",
    "type": "CreateCharacter",
    "gameInstanceId": "instance_001",
    "playerId": "player_1",
    "characterId": "guerrero_1",
    "classId": "warrior"
  }'
```

### 4. Crear y equipar gear

```bash
curl -X POST http://localhost:3000/instance_001/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mi-token-secreto" \
  -d '{
    "txId": "tx_004",
    "type": "CreateGear",
    "gameInstanceId": "instance_001",
    "playerId": "player_1",
    "gearId": "espada_1",
    "gearDefId": "sword_basic"
  }'
```

```bash
curl -X POST http://localhost:3000/instance_001/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mi-token-secreto" \
  -d '{
    "txId": "tx_005",
    "type": "EquipGear",
    "gameInstanceId": "instance_001",
    "playerId": "player_1",
    "characterId": "guerrero_1",
    "gearId": "espada_1"
  }'
```

### 5. Ver stats

```bash
curl http://localhost:3000/instance_001/character/guerrero_1/stats \
  -H "Authorization: Bearer mi-token-secreto"
```

```json
{
  "characterId": "guerrero_1",
  "classId": "warrior",
  "level": 1,
  "finalStats": { "strength": 8, "hp": 20 }
}
```

---

## Endpoints implementados

| Endpoint | Método | Auth | Descripción |
|---|---|---|---|
| `/health` | GET | No | Health check |
| `/:id/config` | GET | No | Config activa del proceso |
| `/:id/stateVersion` | GET | No | Versión de estado (polling) |
| `/:id/tx` | POST | Sí | Transacciones (mutación de estado) |
| `/:id/state/player/:pid` | GET | Sí | Estado de un player |
| `/:id/character/:cid/stats` | GET | Sí | Stats calculados de un character |

Ver [`IMPLEMENTATION_GUIDE.md`](IMPLEMENTATION_GUIDE.md) para detalles completos.

---

## Cambiar de config

Para cambiar la configuración del juego:

1. Detener el servidor.
2. Reiniciar con la nueva config:

```bash
CONFIG_PATH=examples/config_sets.json SNAPSHOT_DIR=./data npm run dev
```

Si hay snapshots previos, el motor ejecuta **migración best-effort** automáticamente (desequipa gear con gearDefs inexistentes, limpia slots eliminados, etc.).

---

## Documentación adicional

| Documento | Contenido |
|---|---|
| [`IMPLEMENTATION_GUIDE.md`](IMPLEMENTATION_GUIDE.md) | Guía técnica exhaustiva |
| [`ERROR_CODES.md`](ERROR_CODES.md) | Catálogo completo de error codes |
| [`SEMANTICS.md`](SEMANTICS.md) | Decisiones de diseño |
| [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md) | Prioridad de documentos normativos |
| `openapi/openapi.yaml` | Especificación OpenAPI 3.1.0 |
| `schemas/*.schema.json` | Contratos JSON Schema draft-07 |
| `examples/tx_examples.md` | Ejemplos de transacciones JSON |
