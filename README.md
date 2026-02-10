# Gameng

Motor RPG data-driven del lado del servidor. Toda la lógica de juego (clases, equipo, sets, progresión, recursos) se define en un **archivo de configuración JSON** — sin recompilar, sin redeploy.

## Inicio rápido

```bash
# Requisitos: Node.js >= 20, npm >= 10

npm install
npm run dev          # Servidor en http://localhost:3000
```

Para la experiencia completa con interfaz gráfica:

```bash
npm run build        # Compilar engine (necesario la primera vez)
npm run sandbox      # Lanza engine + launcher + SPA (puertos 3000, 4010, 5173)
```

Ver [docs/QUICKSTART.md](docs/QUICKSTART.md) para un tutorial paso a paso.

---

## Arquitectura

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  SPA React  │─────▶│  Launcher   │─────▶│   Engine     │
│  :5173      │      │  :4010      │      │   :3000      │
└─────────────┘      └─────────────┘      └─────────────┘
       │                                         ▲
       │              ┌─────────────┐             │
       └─────────────▶│    BFF      │─────────────┘
                      │  :3001      │
                      └─────────────┘
```

| Componente | Descripción |
|------------|-------------|
| **Engine** | Servidor Fastify 5 — procesa transacciones, calcula stats, persiste snapshots |
| **BFF** | Backend For Frontend — auth JWT + bcrypt, proxy autenticado al engine |
| **Launcher** | Gestiona el proceso del engine (start/stop/restart), sirve config, proxy |
| **SPA** | React + Tailwind — Server Control, Config Studio, Admin, Player, GM, Scenarios |

---

## Estructura del proyecto

```
src/                  Código fuente del engine
  algorithms/         Algoritmos de crecimiento y coste (catálogo parametrizable)
  routes/             Plugins de rutas Fastify
tests/                Tests unitarios del engine (Vitest)
  e2e/                Tests end-to-end (servidor real)
scripts/              Scripts de validación (tsx)
openapi/              Especificación OpenAPI 3.1.0
schemas/              Contratos JSON Schema (draft-07)
examples/             Archivos de ejemplo / golden files
docs/                 Documentación completa
bff/                  Backend For Frontend
  src/auth/           JWT, bcrypt, middleware
  src/routes/         Rutas: auth, game, admin, health
  tests/              Tests del BFF
sandbox/              Herramientas de desarrollo
  apps/launcher/      Gestor de procesos del engine (Fastify :4010)
  apps/web/           SPA React + Tailwind (Vite :5173)
```

---

## Características del engine

- **Clases** con stats base y algoritmo de crecimiento configurable
- **Equipo** con definiciones, slots, patrones de equipamiento y restricciones (clase + nivel)
- **Sets de equipo** con bonificaciones por 2 y 4 piezas
- **Progresión** — LevelUp de personajes y equipo con costes configurables
- **Recursos** — wallets a nivel de jugador y personaje con costes por scope
- **Algoritmos parametrizables** — catálogo extensible (flat, linear, exponential, mixed_linear_cost...)
- **Stat clamps** — límites min/max por stat
- **Gear swap** — intercambio automático de equipo en conflicto
- **Snapshots** — persistencia periódica + restauración al arrancar
- **Migración** — best-effort al restaurar snapshots con config cambiada
- **Auth** — modelo Actor con API key + ADMIN_API_KEY para operaciones administrativas
- **Idempotencia** — cache FIFO por txId, todas las respuestas cacheadas
- **Validación** — JSON Schema en compilación, algorithmId al arrancar

---

## Endpoints del engine

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/health` | No | Health check |
| `GET` | `/:id/config` | No | Configuración activa |
| `GET` | `/:id/algorithms` | No | Catálogo de algoritmos disponibles |
| `GET` | `/:id/stateVersion` | No | Versión del estado (polling ligero) |
| `POST` | `/:id/tx` | Varía | Enviar transacción |
| `GET` | `/:id/state/player/:pid` | Actor | Estado del jugador |
| `GET` | `/:id/state/player/:pid/character/:cid/stats` | Actor | Stats calculados del personaje |

### Tipos de transacción

| Tipo | Auth | Descripción |
|------|------|-------------|
| `CreateActor` | Admin | Crear actor con API key |
| `CreatePlayer` | Actor | Crear jugador |
| `CreateCharacter` | Actor | Crear personaje con clase |
| `EquipGear` | Actor | Equipar/desequipar pieza (swap opcional) |
| `LevelUpCharacter` | Actor | Subir nivel de personaje (consume recursos) |
| `LevelUpGear` | Actor | Subir nivel de equipo (consume recursos) |
| `GrantResources` | Admin | Otorgar recursos al jugador |
| `GrantCharacterResources` | Admin | Otorgar recursos al personaje |

---

## BFF (Backend For Frontend)

Capa de autenticación JWT entre clientes y engine:

- **Registro/Login** — bcrypt + SQLite + JWT (access + refresh)
- **Proxy autenticado** — JWT → API key del actor, inyección automática
- **Rutas tipadas** — `/game/equip`, `/game/levelup-character`, etc.
- **Admin API** — `X-Admin-Secret` header, grant resources, list users
- **Rate limiting** — `@fastify/rate-limit` por ruta
- **Observabilidad** — health check con probe al engine + structured logging

---

## Sandbox (interfaz gráfica)

| Página | Descripción |
|--------|-------------|
| **Server Control** | Start/stop/restart engine, logs en vivo, proxy toggle |
| **Config Studio** | Editor visual + JSON, validación Ajv, presets, save & restart |
| **Admin** | CreateActor, GrantResources, Seed Demo automatizado |
| **Player** | Equipar, level up, ver stats, recursos, activity feed |
| **GM Dashboard** | Inspector de jugadores/personajes, Tx Builder, registry de IDs |
| **Scenarios** | Runner de escenarios con variables, captura de contexto, export/import |

---

## Stack tecnológico

| Categoría | Tecnología |
|-----------|------------|
| Runtime | Node.js >= 20 |
| Framework | Fastify 5 (TypeScript-first) |
| Build | TypeScript 5, `tsx` para dev |
| Tests | Vitest 2 |
| Lint | ESLint 9 (flat config + typescript-eslint) |
| Format | Prettier 3 |
| API Spec | OpenAPI 3.1.0 (Redocly CLI) |
| Schemas | JSON Schema draft-07 (Ajv 8) |
| BFF Auth | `@fastify/jwt`, `bcrypt`, `better-sqlite3` |
| SPA | React 19, Tailwind CSS 4, Vite, React Router |

---

## Comandos

### Engine

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Servidor dev con hot reload |
| `npm start` | Servidor producción (requiere build) |
| `npm run build` | Compilar TypeScript a `dist/` |
| `npm test` | Tests unitarios |
| `npm run test:e2e` | Tests E2E (build + servidor real) |
| `npm run check` | Pipeline completa (lint + typecheck + test + validate) |
| `npm run lint` | Lint de fuentes y tests |
| `npm run format` | Formatear con Prettier |
| `npm run typecheck` | Verificar tipos sin emitir |
| `npm run validate` | Validar schemas + OpenAPI |

### BFF

| Comando | Descripción |
|---------|-------------|
| `npm run bff` | Servidor BFF en dev |
| `npm run bff:build` | Compilar BFF |
| `npm run bff:test` | Tests del BFF |

### Sandbox

| Comando | Descripción |
|---------|-------------|
| `npm run sandbox` | Todo: engine + launcher + SPA |
| `npm run sandbox:launcher` | Solo launcher |
| `npm run sandbox:web` | Solo SPA |
| `npm run sandbox:reset` | Limpiar datos del sandbox |
| `npm run sandbox:stop` | Matar procesos en puertos del sandbox |

---

## Tests

| Suite | Tests | Comando |
|-------|-------|---------|
| Engine unitarios | 373 | `npm test` |
| Engine E2E | 81 | `npm run test:e2e` |
| BFF | 63 | `npm run bff:test` |
| Launcher | 22 | (incluidos en sandbox) |
| **Total** | **539** | |

---

## Schemas y contratos

Los contratos JSON Schema en `schemas/` definen la estructura de:

- `game_config.schema.json` — configuración del juego (clases, equipo, sets, algoritmos, clamps)
- `game_state.schema.json` — estado completo de una instancia (jugadores, actores, cache)
- `transaction.schema.json` — request de transacción (todos los tipos)
- `transaction_result.schema.json` — respuesta de transacción (accepted/rejected)

Los archivos en `examples/` sirven como golden files validados contra los schemas.

---

## Documentación

### Inicio

| Documento | Descripción |
|-----------|-------------|
| [QUICKSTART.md](docs/QUICKSTART.md) | Tutorial paso a paso para arrancar el proyecto |
| [CLIENT_TUTORIAL.md](docs/CLIENT_TUTORIAL.md) | Guía exhaustiva para clientes del engine (1300+ líneas) |

### Referencia técnica

| Documento | Descripción |
|-----------|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitectura del sistema y decisiones de diseño |
| [IMPLEMENTATION_GUIDE.md](docs/IMPLEMENTATION_GUIDE.md) | Guía de implementación con detalles internos y debugging |
| [SEMANTICS.md](docs/SEMANTICS.md) | Decisiones semánticas del dominio (17 decisiones documentadas) |
| [ALGORITHMS.md](docs/ALGORITHMS.md) | Catálogo de algoritmos parametrizables y cómo extenderlo |
| [ERROR_CODES.md](docs/ERROR_CODES.md) | Todos los códigos de error con causa y resolución |
| [SOURCE_OF_TRUTH.md](docs/SOURCE_OF_TRUTH.md) | Mapa de qué documento es autoridad para cada aspecto |

### Planificación

| Documento | Descripción |
|-----------|-------------|
| [SPEC.md](docs/specs/SPEC.md) | Especificación original del engine |
| [PLAN.md](docs/specs/PLAN.md) | Plan de desarrollo por fases |
| [DELIVERABLES.md](docs/specs/DELIVERABLES.md) | Entregables por fase |
| [BFF_IMPLEMENTATION_PLAN.md](docs/BFF_IMPLEMENTATION_PLAN.md) | Plan de 6 slices del BFF |
| [SANDBOX_DELIVERY_PLAN.md](docs/sandbox/SANDBOX_DELIVERY_PLAN.md) | Plan de entrega del sandbox |
| [DEMO_GAME_PLAYBOOK.md](docs/sandbox/DEMO_GAME_PLAYBOOK.md) | Playbook de demostración del juego |

---

## Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `3000` | Puerto del engine |
| `HOST` | `0.0.0.0` | Host del engine |
| `ADMIN_API_KEY` | — | Token admin (requerido para CreateActor/Grant*) |
| `GAMENG_SNAPSHOT_DIR` | — | Directorio de snapshots |
| `GAMENG_SNAPSHOT_INTERVAL_MS` | `30000` | Intervalo de flush de snapshots |
| `GAMENG_MAX_IDEMPOTENCY_ENTRIES` | `1000` | Tamaño máximo de la cache de idempotencia |
| `GAMENG_E2E` | — | Habilita endpoint `/__shutdown` para E2E |
| `GAMENG_E2E_LOG_LEVEL` | `silent` | Nivel de log en E2E |
