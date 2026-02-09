# Plan de desarrollo — Motor RPG server-side data-driven

> **Fuente:** Conversión a Markdown del PDF de planificación de desarrollo.  
> **Fecha del documento original:** 05/02/2026

## 1. Objetivo y alcance inicial

Construir un motor que se ejecute enteramente en servidor, **multi‑instancia** y **data‑driven** (config JSON), que procese **transacciones atómicas** sobre un estado en memoria (persistido por **snapshots**) y que, en esta fase, ofrezca:

- Creación de **jugadores / personajes / gear**
- **Progresión de niveles**
- **Equipamiento** con restricciones
- **Bonos por set**
- **Cálculo de stats finales**

El cliente **no guarda estado**: solo envía transacciones y consulta resultados.

**Fuera de alcance (por ahora):**
- Combate
- Loot aleatorio
- Economía completa
- Habilidades
- Buffs temporales

---

## 2. Principios guía del desarrollo

- **Diseño guiado por contratos:** esquemas JSON y catálogo de errores definidos antes de implementar lógica.
- **Core determinista por defecto:** si existe aleatoriedad, debe quedar registrada en el estado como resultado.
- **Invariantes fuertes:** ownership obligatorio, gear único (una ubicación), equipamiento consistente con slots.
- **Pruebas desde el día 1:** golden tests para cálculo de stats + tests de atomicidad y migración.
- **Incremento por “vertical slices”:** cada hito atraviesa API → validación → transacción → estado → persistencia → tests.

---

## 3. Fase 0 — Preparación (base técnica y criterios de éxito)

### Entregables
- Definición de hitos y **Definition of Done** por hito (qué significa “terminado”).
- Estructura inicial del repositorio, **CI** para tests, linter/formatter.
- Primeros **golden files** de ejemplo (config mínima + casos esperados de stats).

### Decisiones a cerrar
- Nivel de durabilidad: ¿se acepta pérdida entre snapshots? **→ Decidido: sí, se acepta pérdida entre snapshots.** No se implementa log de transacciones ni replay. La persistencia es exclusivamente por snapshots periódicos. La idempotencia por txId usa un cache acotado (anti-duplicados), no un log histórico.
- Modelo de extensibilidad "sin tocar código": **DSL declarativa** vs **catálogo fijo parametrizable** vs **plugins**.
- Política de concurrencia: serialización por instancia o por jugador (suficiente para empezar).

---

## 4. Fase 1 — Concreción final de requisitos (taller de especificación)

**Objetivo:** eliminar ambigüedades antes del diseño definitivo de interfaces.

### 4.1 Semántica del dominio (decisiones)
- Equipamiento: conflicto de slots (**rechazar** vs **swap explícito**), selección de slot cuando hay alternativas.
- Gear multi‑slot: ocupa conjuntos exactos; política de conteo para sets (**1 pieza** vs **2**).
- Restricciones: definición exacta de la regla de nivel (“x niveles por encima”) y listas blancas/negras de clase.
- Cálculo: permitir negativos o **clamp por stat**; redondeo solo en presentación (si aplica).
- Migración config ↔ estado: qué hacer si desaparecen slots / gearDefs / clases en una nueva config.

### 4.2 Esquemas y contratos
- JSON Schema de **GameConfig**, **GameState**, **Transaction** y **TransactionResult**.
- Catálogo de **errorCode** y normas de validación (rechazo sin efectos parciales).
- Ejemplos mínimos: config pequeña, estado pequeño, transacciones de ejemplo y respuestas.

### Entregable principal
- **Anexo de Semántica + Esquemas** (documento breve que deja el sistema “cerrado” en significado).

---

## 5. Fase 2 — Diseño de arquitectura y contratos (sin entrar en implementación profunda)

### Componentes lógicos (interfaces internas)
- **ConfigLoader:** carga y valida config, y genera un modelo interno eficiente.
- **StateStore:** mantiene estado en memoria por instancia; versionado de estado; snapshots.
- **Migrator:** carga snapshots antiguos y aplica best‑effort con config nueva.
- **TransactionProcessor:** valida y aplica transacciones atómicas; genera TransactionResult.
- **Rules/Algorithms Engine:** restricciones, crecimiento de stats, coste de nivel, sets (pluggable/DSL).
- **StatsCalculator:** cálculo final puro y testeable (sin side effects).
- **QueryService:** endpoints de lectura (no mutan estado).

### Contrato API (alto nivel)
- Comando: endpoint único de transacciones (**POST tx**) + consultas (**GET config**, **GET stats**, **GET estado jugador**).
- Idempotencia: decidir si `txId` evita duplicados ante reintentos.
- Respuestas estandarizadas: `accepted`, `errorCode`, `errorMessage`, `stateVersion` (y opcional `stateHash`).

---

## 6. Fase 3 — Implementación incremental por “vertical slices”

La prioridad es tener un esqueleto funcionando end‑to‑end y aumentar complejidad gradualmente.

### Slice 1 — Instancia + config + health + snapshots mínimos
- Arranque del servidor, carga de config válida, creación de instancia vacía, snapshots periódicos y recarga tras reinicio.
- Endpoints mínimos: `health` / `config` / `stateVersion`.

### Slice 2 — Jugadores y ownership
- `CreatePlayer` y consultas de jugador.
- Invariantes: nada existe sin owner; pertenencia a instancia; no duplicados.

### Slice 3 — Personajes (clase + nivel) + stats base
- `CreateCharacter(classId)`, `LevelUpCharacter`, `GetCharacterStats` (solo stats del personaje).
- Golden tests de crecimiento.

### Slice 4 — Gear instanciable + inventario
- `CreateGear(gearDefId)`, `LevelUpGear`, inventario de jugador.
- Golden tests de crecimiento de gear.

### Slice 5 — Equipamiento 1 slot + suma de stats
- Equip/Unequip (caso simple), stats finales = personaje + suma gear.
- Validación de ocupación y unicidad del gear.

### Slice 6 — Gear multi‑slot + conflictos + (opcional) swap
- Ocupación de varios slots (conjuntos exactos). Política de conflicto aplicada (reject o swap explícito).
- Consistencia al desequipar.

### Slice 7 — Restricciones de equipamiento
- Restricciones por clase y por nivel; errores estandarizados.
- Matriz de tests por restricción.

### Slice 8 — Sets (2/4 piezas)
- Activación por conteo, `bonusStats` sumados.
- Casos límite y política para gear multi‑slot.

### Slice 9 — Migración config ↔ estado
- Cambios en stats/slots sin romper carga; políticas para slots/defs desaparecidos.
- Golden tests de migración con snapshots antiguos.

### Slice 10 — Extensibilidad (DSL o mecanismo elegido)
- Incorporar el modelo elegido para añadir algoritmos y reglas sin tocar el core.
- Tests de seguridad/limitación (si hay DSL) y fixtures de expresiones.

---

---

## 7. Fase 4 — Backend For Frontend (BFF)

**Objetivo:** Capa intermedia entre clientes externos y el engine, que ofrece autenticación por JWT, simplificación de la API y aislamiento de las credenciales internas (apiKeys de actores).

### Arquitectura

```
Cliente (Browser/Mobile) → BFF (:5000) → Engine (:3000)
```

- El cliente **nunca** habla directamente con el engine.
- El BFF traduce JWT → apiKey de actor en cada petición.
- Mapeo 1:1: cada usuario BFF = 1 actor engine = 1 player engine.

### Slice BFF‑1 — Esqueleto + proxy passthrough
- Proyecto `bff/` con Fastify, CORS, TypeScript.
- `proxyToEngine()`: reenvía peticiones al engine preservando headers.
- Rutas passthrough: `/game/health`, `/game/config`, `/game/version`.
- Tests con fake engine (Fastify mock).

### Slice BFF‑2 — Autenticación (register, login, refresh)
- **SQLite** (`better-sqlite3`) para tabla `users` (email, password_hash, actor_id, api_key, player_id).
- **bcrypt** para hash de contraseñas.
- **@fastify/jwt** para emisión y verificación de tokens.
- `POST /auth/register`: valida input → CreateActor en engine → CreatePlayer en engine → INSERT en SQLite → JWT.
- `POST /auth/login`: verifica email+password contra SQLite → JWT (no toca el engine).
- `POST /auth/refresh`: renueva el JWT con los mismos datos del usuario.

### Slice BFF‑3 — Proxy autenticado (JWT → apiKey)
- Las rutas `/game/*` protegidas con `requireAuth` (preHandler JWT).
- El BFF extrae `userId` del JWT, busca `api_key` en SQLite, e inyecta `Authorization: Bearer {apiKey}` hacia el engine.
- El cliente nunca ve la apiKey del actor.

### Slice BFF‑4 — Rutas tipadas de gameplay
- Rutas simplificadas que auto-rellenan `txId` (UUID), `gameInstanceId` y `playerId`:
  - `POST /game/character`, `/game/gear`, `/game/equip`, `/game/unequip`
  - `POST /game/levelup/character`, `/game/levelup/gear`
  - `GET /game/player`, `/game/stats/:characterId`
  - `POST /game/tx` (passthrough raw para casos avanzados)

### Slice BFF‑5 — API de administración
- Rutas `/admin/*` protegidas por header `X-Admin-Secret`.
- `POST /admin/grant-resources`, `/admin/grant-character-resources`: inyectan admin key hacia el engine.
- `GET /admin/users`: lista usuarios (sin exponer password_hash ni api_key).

### Slice BFF‑6 — Hardening + observabilidad
- **@fastify/helmet**: security headers.
- **@fastify/rate-limit**: 100 req/min global, 5/min register, 10/min login.
- `GET /health`: probe del engine + check de conectividad SQLite.

### Tests
- 54 tests unitarios (5 ficheros: proxy, auth, game-routes, admin-routes, health).
- 30 tests E2E contra engine + BFF reales (spawned como child processes).

---

## 8. Fase 5 — Sandbox (herramientas de desarrollo)

**Objetivo:** Entorno local para probar el engine sin escribir curl. Un launcher que gestiona el proceso del engine y una SPA React para interactuar visualmente.

### Arquitectura

```
React SPA (:5173) → Launcher (:4010) → Engine (:3000)
```

- El launcher actúa como **process manager** (spawn/stop/restart del engine) y **proxy** (`/engine/*` → engine).
- La SPA no necesita saber el puerto del engine; habla solo con el launcher.

### Slice SBX‑0 — Esqueleto
- `sandbox/apps/launcher/`: Fastify en puerto 4010, `GET /status`.
- `sandbox/apps/web/`: Vite + React + Tailwind en puerto 5173.
- Scripts root: `npm run sandbox` (concurrently launcher + web), `sandbox:reset`, `sandbox:stop`.

### Slice SBX‑1 — Launcher (Process Manager)
- `EngineProcessManager`: spawn engine como child process con `GAMENG_E2E=1`.
- `LogBuffer`: ring buffer de 2000 líneas (stdout + stderr del engine).
- Rutas de control: `POST /control/start`, `/control/stop`, `/control/restart`, `GET /control/status`, `/control/logs`.
- Rutas proxy: `/engine/health`, `/engine/:id/tx`, `/engine/:id/state/player/:pid`, etc.
- `@fastify/cors` para acceso desde la SPA.
- Graceful shutdown: `POST /__shutdown` (engine) + `process.on("exit")` kill síncrono (Windows).

### Slice SBX‑2 — Server Control + Player Client
- **ServerControl** (`/server`): estado del engine, start/stop/restart, visor de logs en vivo.
- **PlayerView** (`/player`): inputs (apiKey, playerId, characterId, classId), botones para CreatePlayer/CreateCharacter/CreateGear/GetStats, panel JSON de resultados, polling de stateVersion.
- `engineClient.ts`: cliente tipado (health, config, stateVersion, postTx, getPlayerState, getCharacterStats).
- `launcherClient.ts`: cliente tipado (start, stop, restart, getStatus, getLogs, saveConfig).
- `useSettings` hook con persistencia en localStorage.

### Slice SBX‑3 — Config Studio
- **ConfigEditor** (`/config`): editor visual + JSON con tabs y sync bidireccional.
- Validación Ajv contra `game_config.schema.json` real.
- Presets (minimal, sets), Load from engine, Save to launcher, Save+Restart, Format, Reset.
- Paneles visuales: ClassesPanel, GearDefsPanel, AlgorithmsPanel, StatMapEditor, EquipPatternsEditor, RestrictionsEditor.

### Slice SBX‑4 — Admin Console
- **AdminPanel** (`/admin`): formularios CreateActor, GrantResources, GrantCharacterResources.
- **Seed Demo**: secuencia automatizada (CreateActor → CreatePlayer → GrantResources → GrantCharacterResources) con log paso a paso.
- Guarda outputs en localStorage para uso inmediato en PlayerView.

### Slice SBX‑5 — Player Client completo
- Layout 3 columnas: personaje + equipo + stats.
- Dropdowns config-driven (clases, gearDefs).
- Slot grid, equip/unequip con toggle swap, selector de patrón, info de restricciones y sets.
- Polling stateVersion (1s, backoff 3s), auto-refresh, indicador connected/disconnected.
- LevelUpCharacter + LevelUpGear con guard de nivel máximo.
- Tabla de recursos (player + character), activity feed (últimas 5 TXs).

### Slice SBX‑6 — GM Dashboard + Scenario Runner
- **GameMaster** (`/gm`): registro de IDs conocidos, inspector de player/character, slot grid + stats, Tx Builder lite (JSON raw con auto-fill txId/gameInstanceId), polling stateVersion.
- **ScenarioRunner** (`/scenarios`): escenarios scriptados con pasos (TransactionRequest[]), variables (`${ADMIN_API_KEY}`, `${LAST_PLAYER_ID}`, etc.), apply config + restart, continueOnFail, export/import `.scenario.json`, demo preset.
- RuntimeContext: captura IDs de TXs aceptadas (`${LAST_*}`), push a PlayerView/GM, deep links, resume from step N.

### Launcher Proxy
- Proxy transparente `/engine/*` → engine para evitar CORS y ocultar puerto del engine.
- `Settings.useProxy` (default true) en la SPA.
- Códigos de error: 503 ENGINE_NOT_RUNNING, 502 ENGINE_UNREACHABLE.

### Tests
- 22 tests del launcher (control + proxy).
- La SPA no tiene tests unitarios (UI manual).

---

## 9. Estrategia de pruebas y validación

- **Tests de esquema:** GameConfig/Transaction válidos e inválidos (falla rápido).
- **Golden tests de StatsCalculator:** configs pequeñas con resultados esperados y reproducibles.
- **Tests de invariantes:** gear no puede estar en dos ubicaciones; slots ocupados coherentes; ownership.
- **Tests de atomicidad:** cualquier fallo deja el estado idéntico (sin efectos parciales).
- **Sequence tests:** aplicar secuencia de transacciones y comparar con estado final esperado.
- **Migration tests:** cargar snapshot antiguo con config nueva y validar best‑effort.

---

## 10. Observabilidad y operación

- Logging estructurado de transacciones (aceptada/rechazada, motivo, duración).
- Métricas básicas: latencia por tx, tamaño del estado, frecuencia y duración de snapshots.
- Herramientas operativas: exportar snapshot, forzar snapshot, listar instancias (si aplica).

---

## 11. Riesgos y mitigaciones

- Extensibilidad "sin tocar código": si no se decide pronto (DSL vs catálogo vs plugins), se rediseña el núcleo.
  **Mitigación:** decisión en Fase 1.
- Snapshots sin log: si luego se exige durabilidad fuerte, añadir log puede ser intrusivo.
  **Decisión tomada:** se acepta pérdida entre snapshots. No se implementa log de transacciones. La arquitectura es servidor autoritativo con estado completo en memoria, persistido periódicamente por snapshots.
- Multi‑instancia: complica aislamiento y memoria.
  **Mitigación:** empezar con 1 instancia funcional y habilitar multi‑instancia después (Slice 2–3).

---

## 12. Checklist de decisiones antes de codificar (cierre de especificación)

- Política de conflictos al equipar (reject vs swap explícito).
- Semántica exacta de restricciones de nivel.
- Conteo de sets con gear multi‑slot.
- Negativos/clamp/redondeo por stat (defaults).
- Durabilidad: **decidido — pérdida aceptable entre snapshots; sin log de transacciones.**
- Modelo de extensibilidad: DSL vs catálogo vs plugins.
- Idempotencia (txId) y serialización de transacciones (instancia vs jugador).
