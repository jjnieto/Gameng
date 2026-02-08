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

## Sandbox

El sandbox es un entorno visual para probar el motor. Incluye un **launcher** (Node/Fastify, puerto 4010) que controla el motor como child process, y una **web** (React + Vite + Tailwind, puerto 5173 por defecto) como SPA.

> **Demo paso a paso**: ver [`sandbox/DEMO_GAME_PLAYBOOK.md`](sandbox/DEMO_GAME_PLAYBOOK.md) para un manual completo desde arranque hasta stats, incluyendo Scenario Runner, flujo manual y troubleshooting.

### Requisitos previos

1. Compilar el motor (el launcher arranca `node dist/server.js`):

```bash
npm run build
```

2. Instalar dependencias de cada sub-app (una sola vez):

```bash
npm install --prefix sandbox/apps/launcher
npm install --prefix sandbox/apps/web
```

### Sincronizar schemas y presets

Los schemas (`schemas/game_config.schema.json`) y presets (`examples/config_*.json`) se copian automaticamente al front antes de arrancar. Si cambias un schema o un ejemplo en el repo, ejecuta:

```bash
npm run sandbox:sync
```

Esto copia:

| Origen (repo root) | Destino (web app) |
|---|---|
| `schemas/game_config.schema.json` | `sandbox/apps/web/src/schemas/` |
| `examples/config_minimal.json` | `sandbox/apps/web/src/presets/` |
| `examples/config_sets.json` | `sandbox/apps/web/src/presets/` |

> Los archivos en `src/schemas/` y `src/presets/` del web app **no se editan a mano** — se regeneran con `sandbox:sync`. Los scripts `sandbox:web` y `sandbox` ejecutan el sync automaticamente.

### Arrancar

Un solo comando (sincroniza assets, arranca launcher + web en paralelo):

```bash
npm run sandbox
```

O por separado:

```bash
npm run sandbox:launcher   # Solo launcher (puerto 4010)
npm run sandbox:web        # Solo web (puerto 5173, incluye sync)
```

Abre la URL que aparece en el terminal (normalmente `http://localhost:5173`; Vite auto-incrementa el puerto si esta ocupado).

### Configurar SANDBOX_ADMIN_API_KEY

Para usar CreateActor/GrantResources, el launcher necesita la admin API key:

**Linux / macOS / Git Bash:**

```bash
SANDBOX_ADMIN_API_KEY=mi-clave-admin npm run sandbox
```

**Windows (PowerShell):**

```powershell
$env:SANDBOX_ADMIN_API_KEY="mi-clave-admin"
npm run sandbox
```

**Windows (cmd):**

```cmd
set SANDBOX_ADMIN_API_KEY=mi-clave-admin
npm run sandbox
```

### Paginas del SPA

**Server** (`/server`):

- Toggle **Proxy through launcher** (default ON) — la SPA enruta todas las llamadas al motor a traves del launcher (`/engine/*`), evitando CORS y simplificando la config a un solo baseUrl
- Editar las URLs de launcher y engine (con persistencia en localStorage)
- Ver el estado del motor (running, pid, port, health)
- Start / Stop / Restart con botones
- Ver logs del motor en tiempo real (poll cada 1s, auto-scroll)

**Config** (`/config`):

Dos modos de edicion: **Visual** y **JSON** (tabs en la parte superior del editor). Ambos se sincronizan bidireccionalmente — los cambios en Visual actualizan el JSON y viceversa.

**JSON tab** (modo original):

1. Pulsa **minimal** o **sets** para cargar un preset.
2. Pulsa **Validate** — verifica contra el JSON Schema real de GameConfig.
3. Pulsa **Save to launcher** — guarda el JSON en `sandbox/data/configs/active.json`.
4. Pulsa **Save + Restart engine** — guarda y reinicia el motor con la nueva config.
5. Con el motor arrancado, pulsa **Load from engine** — carga la config activa del motor.

**Visual tab** — editor visual con tres sub-tabs:

- **Classes**: tarjetas colapsables por clase. Editar baseStats con K/V inputs. Agregar/eliminar clases.
- **Gear Defs**: tarjetas por gearDef. Editar baseStats, equipPatterns (slot pills), set (setId + pieceCount), restrictions (allow/block list, requiredCharacterLevel, maxLevelDelta).
- **Algorithms**: cards para growth, levelCostCharacter, levelCostGear. Dropdowns para algorithmId con campos de parametros contextuales (perLevelMultiplier, exponent, resourceId/base/perLevel). Stat Clamps: toggle + tabla de min/max por stat.

> Al cambiar de JSON a Visual, el JSON debe ser valido (parseable). Si hay errores de sintaxis, el tab Visual se bloquea con un mensaje de error. Los scalars top-level (`gameConfigId`, `maxLevel`, `stats`, `slots`) y los sets se editan en el tab JSON.

**Admin** (`/admin`):

1. En la seccion **Connection**, introduce la Admin API Key (la misma que `SANDBOX_ADMIN_API_KEY`).
2. **CreateActor**: crea un actor con su API key.
3. **GrantResources**: asigna recursos a un player existente (JSON `{"gold":100}`).
4. **Seed Demo**: crea actor + player + grant en un click. Actualiza automaticamente los inputs de `/player`.
5. **Load Player State**: verifica que los recursos se aplicaron.

**Player** (`/player`) — 3-column player client:

1. En `/config`, carga un preset (e.g. **sets**), valida y pulsa **Save + Restart engine**.
2. Ve a `/admin`, introduce la admin key y pulsa **Seed Demo** (crea actor + player + recursos).
3. Ve a `/player` — el playerId y apiKey ya estan rellenos por el seed.
4. Pulsa **Refresh State** — carga el estado del player y la config del motor.
5. Pulsa **Reload Config** — carga slots, clases y gear definitions del motor para los dropdowns.
6. En la columna Characters, selecciona una clase del dropdown (e.g. `warrior`) y pulsa **Create**.
7. Click en el personaje creado — aparece el grid de slots y sus stats.
8. En la columna Gear, selecciona un gearDef del dropdown (e.g. `sword_basic`) y pulsa **Create**.
9. Click en el gear creado, luego pulsa **Equip** — el slot grid se actualiza.
10. Crea otro gear con el mismo slot (e.g. otro `sword_basic`) e intenta equipar — recibiras `SLOT_OCCUPIED`.
11. Activa **Swap mode** y vuelve a equipar — el gear anterior se desequipa automaticamente.
12. Para desequipar gear, seleccionalo y pulsa **Unequip**.
13. Con la config **costs** (o una que tenga `levelCostCharacter` con algoritmId `linear_cost`), ve a `/admin` y haz **GrantResources** con `{"xp": 500, "gold": 300}`.
14. En `/player` el panel de **Resources** se actualiza automaticamente (auto-refresh por stateVersion).
15. Selecciona un personaje y pulsa **Level Up Char** — el level sube, los recursos decrecen, los stats cambian.
16. Selecciona un gear y pulsa **Level Up Gear** — el gear level sube, los recursos decrecen, los stats cambian si el gear esta equipado.
17. Si los recursos son insuficientes, la tx falla con `INSUFFICIENT_RESOURCES` y aparece en el **Activity feed**.

Auto-refresh: cuando **Auto-refresh** esta activado (default ON), la UI hace polling de `stateVersion` cada 1s. Si la version cambia (e.g. por un GrantResources desde `/admin`), refresca automaticamente el estado del player, recursos y stats. Si el motor no responde, backoff a 3s y muestra indicador "Disconnected".

**GM** (`/gm`) — Game Master inspector:

1. Ve a `/gm` despues de haber hecho Seed Demo en `/admin`.
2. Pulsa **Import from Admin seed** o **Import from /player** — importa el playerId y apiKey conocidos.
3. Click en el player en la lista — se carga su estado automaticamente.
4. Panel derecho muestra: resources (tabla), contadores (characters/gear), lista de characters.
5. Click en un character — muestra level, class, slots equipados y stats calculados.
6. Pulsa **JSON** para ver el estado crudo del player, **Summary** para volver a la vista compacta.
7. Con **Auto-refresh** ON (default), los cambios desde `/player` o `/admin` se reflejan en 1.5s.
8. **Tx Builder**: escribe un JSON de transaccion crudo y pulsa **Send Tx**. txId y gameInstanceId se auto-rellenan si estan vacios.
9. Pulsa **Load Config** para cargar slots del motor (necesario para ver el grid de slots equipados).

Flujo tipico GM:
- Seed en `/admin` → acciones del jugador en `/player` → GM inspecciona en `/gm` en tiempo real.
- GM puede ejecutar transacciones via Tx Builder (GrantResources, LevelUp, etc.) y ver el impacto inmediato.

**Scenarios** (`/scenarios`) — Scenario Runner:

Un scenario es una secuencia de transacciones (TX) que se puede guardar, exportar/importar y ejecutar paso a paso o de corrido contra el motor.

Cada scenario tiene:
- **name**: nombre descriptivo
- **gameInstanceId**: instancia del motor sobre la que ejecutar
- **configSource**: config a aplicar antes de ejecutar (none / minimal / sets / inline JSON)
- **steps**: array de TransactionRequest JSON
- **continueOnFail**: si se detiene al primer fallo (default) o continúa

Flujo tipico:
1. Pulsa **+ New** o **Load Demo Scenario** para crear un scenario.
2. Edita los steps en el textarea JSON. Cada step es un `TransactionRequest`. Los campos `txId` y `gameInstanceId` se auto-rellenan si estan vacios.
3. Si el scenario tiene config (e.g. `sets`), pulsa **Apply Config + Restart** para cargar la config y reiniciar el motor.
4. Pulsa **Run All** para ejecutar todos los steps secuencialmente. El panel de resultados muestra por cada step: tipo, status (accepted/rejected), errorCode, duracion, stateVersion y delta.
5. Pulsa un boton de **step individual** (numerados) para ejecutar un step concreto.
6. Pulsa **Resume from N** para continuar la ejecucion desde un step concreto hasta el final (util cuando un paso falla y quieres reintentarlo).
7. Si hay un fallo y `continueOnFail` esta desactivado, la ejecucion se detiene con un mensaje de error.
8. Pulsa **Stop** durante la ejecucion para cancelar.
9. **Export JSON** descarga el scenario como `.scenario.json`. **Import** (en la sidebar) carga un archivo `.scenario.json`.

Variables para credenciales:
- `${ADMIN_API_KEY}` — se resuelve desde Settings globales (campo Admin API Key en `/admin` > Connection).
- `${ACTOR_API_KEY}` — se resuelve desde el campo "Actor key" en la barra del scenario.
- `${GAME_INSTANCE_ID}` — se resuelve desde el gameInstanceId del scenario.
- Los valores reales nunca se muestran en logs ni en el panel de resultados (se redactan como `***`).

Variables de runtime (capturadas automaticamente de pasos ejecutados):
- `${LAST_PLAYER_ID}` — ultimo `playerId` visto en un paso aceptado.
- `${LAST_CHARACTER_ID}` — ultimo `characterId`.
- `${LAST_GEAR_ID}` — ultimo `gearId`.
- `${LAST_ACTOR_ID}` — ultimo `actorId`.

El **Runtime Context** se muestra como tabla debajo de los botones de accion. Se actualiza tras cada paso aceptado. Si un paso posterior usa `${LAST_PLAYER_ID}` y el paso anterior creo un player con `playerId: "player_demo"`, la variable se resuelve automaticamente. Si una variable no tiene valor, el paso se marca como "invalid" y no se envia.

Push to Player / GM:
- **Push to Player**: escribe los IDs capturados (playerId, characterId, gearId) en la localStorage de `/player`. Si hay Actor key configurada, un boton secundario permite incluirla.
- **Push to GM**: añade el playerId al registry de GM y lo selecciona.
- **Open Player** / **Open GM**: pushea los IDs y navega directamente a la pagina.

Flujo completo: run scenario -> push IDs -> open Player -> equip/level-up manual -> open GM para inspeccionar.

Si un step contiene credenciales (campo `apiKey` o variables `${...}`), la UI muestra un warning amarillo.

Ejemplo de scenario (incluido como preset `scenario_demo.json`):
```json
{
  "name": "Demo: Full Flow",
  "gameInstanceId": "instance_001",
  "configSource": "sets",
  "steps": [
    { "type": "CreateActor", "actorId": "actor_demo", "apiKey": "${ACTOR_API_KEY}" },
    { "type": "CreatePlayer", "playerId": "player_demo" },
    { "type": "GrantResources", "playerId": "${LAST_PLAYER_ID}", "resources": {"xp":500,"gold":200} },
    { "type": "CreateCharacter", "playerId": "${LAST_PLAYER_ID}", "characterId": "hero_1", "classId": "warrior" },
    { "type": "CreateGear", "playerId": "${LAST_PLAYER_ID}", "gearId": "sword_1", "gearDefId": "sword_basic" },
    { "type": "EquipGear", "playerId": "${LAST_PLAYER_ID}", "characterId": "${LAST_CHARACTER_ID}", "gearId": "${LAST_GEAR_ID}" },
    { "type": "LevelUpCharacter", "playerId": "${LAST_PLAYER_ID}", "characterId": "${LAST_CHARACTER_ID}", "levels": 2 }
  ]
}
```

### Variables de entorno del launcher

| Variable | Default | Descripcion |
|---|---|---|
| `SANDBOX_LAUNCHER_PORT` | `4010` | Puerto del launcher |
| `SANDBOX_ENGINE_PORT` | `4000` | Puerto del motor |
| `SANDBOX_CONFIG_PATH` | `sandbox/data/configs/active.json` | Ruta a la config activa |
| `SANDBOX_SNAPSHOT_DIR` | `sandbox/data/snapshots` | Directorio de snapshots |
| `SANDBOX_ENGINE_LOG_LEVEL` | `warn` | Nivel de log del motor |
| `SANDBOX_ADMIN_API_KEY` | _(sin definir)_ | Admin API key para CreateActor/GrantResources |

### Endpoints del launcher

| Endpoint | Metodo | Descripcion |
|---|---|---|
| `/status` | GET | Estado del launcher y del motor (running, pid, port, config) |
| `/logs` | GET | Logs del motor (`?limit=N`, default 200) |
| `/engine/start` | POST | Arranca el motor (409 si ya corre) |
| `/engine/stop` | POST | Para el motor (graceful via `/__shutdown`) |
| `/engine/restart` | POST | Stop + start |
| `/config` | POST | Guarda config JSON a disco (`?restart=true` para reiniciar) |

**Proxy routes** — reenvian al motor (503 `ENGINE_NOT_RUNNING` si el motor no esta arrancado):

| Endpoint | Metodo | Destino en motor |
|---|---|---|
| `/engine/health` | GET | `/health` |
| `/engine/:id/config` | GET | `/:id/config` |
| `/engine/:id/stateVersion` | GET | `/:id/stateVersion` |
| `/engine/:id/tx` | POST | `/:id/tx` |
| `/engine/:id/state/player/:pid` | GET | `/:id/state/player/:pid` |
| `/engine/:id/character/:cid/stats` | GET | `/:id/character/:cid/stats` |

El proxy copia las cabeceras `Content-Type` y `Authorization`, timeout de 10s. Si el motor no responde, devuelve 502 `ENGINE_UNREACHABLE`.

### Scripts del sandbox

| Comando | Descripcion |
|---|---|
| `npm run sandbox` | Sync + launcher + web en paralelo |
| `npm run sandbox:launcher` | Solo launcher |
| `npm run sandbox:web` | Sync + solo web |
| `npm run sandbox:sync` | Copia schemas/presets al front |
| `npm run sandbox:reset` | Limpia `sandbox/data/` (configs, snapshots, logs) |

### Estructura

```
sandbox/
  apps/
    launcher/    # Node/TS — control del motor (Fastify, puerto 4010)
    web/         # React + Vite + Tailwind (puerto 5173)
      src/
        schemas/   # (auto-generado por sandbox:sync)
        presets/   # (auto-generado por sandbox:sync)
  packages/
    shared/      # tipos compartidos (futuro)
  data/          # runtime, gitignored
    configs/     # config activa (active.json)
    snapshots/   # SNAPSHOT_DIR para el motor
    logs/        # logs persistidos
```

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
| [`sandbox/SANDBOX_DELIVERY_PLAN.md`](sandbox/SANDBOX_DELIVERY_PLAN.md) | Plan de delivery del sandbox visual |
