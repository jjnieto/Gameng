# Plan de implementacion: BFF (Backend For Frontend)

Capa intermedia entre los clientes (Unity, web, CLI) y el motor Gameng. El motor no se modifica.

---

## Tabla de contenidos

1. [Contexto y objetivo](#1-contexto-y-objetivo)
2. [Arquitectura](#2-arquitectura)
3. [Que se reutiliza del launcher](#3-que-se-reutiliza-del-launcher)
4. [Estructura del proyecto](#4-estructura-del-proyecto)
5. [Slice 0 — Skeleton y proxy passthrough](#5-slice-0--skeleton-y-proxy-passthrough)
6. [Slice 1 — Auth: registro, login, sesiones](#6-slice-1--auth-registro-login-sesiones)
7. [Slice 2 — Proxy autenticado con mapeo de sesion a actor](#7-slice-2--proxy-autenticado-con-mapeo-de-sesion-a-actor)
8. [Slice 3 — Rutas de gameplay tipadas](#8-slice-3--rutas-de-gameplay-tipadas)
9. [Slice 4 — Admin API interna](#9-slice-4--admin-api-interna)
10. [Slice 5 — Rate limiting y hardening](#10-slice-5--rate-limiting-y-hardening)
11. [Slice 6 — Observabilidad](#11-slice-6--observabilidad)
12. [Base de datos](#12-base-de-datos)
13. [Configuracion y variables de entorno](#13-configuracion-y-variables-de-entorno)
14. [Testing](#14-testing)
15. [Documentacion a actualizar](#15-documentacion-a-actualizar)
16. [Lo que NO cambia](#16-lo-que-no-cambia)
17. [Riesgos y decisiones pendientes](#17-riesgos-y-decisiones-pendientes)
18. [Resumen de entregables por slice](#18-resumen-de-entregables-por-slice)

---

## 1. Contexto y objetivo

### Problema

La API de Gameng expone API keys estaticas (Bearer tokens) que el cliente necesita para autenticarse. En un cliente pesado (Unity), cualquier secreto almacenado o transmitido puede ser extraido por el usuario (decompilacion, memory dump, proxy MITM). Ademas, la `ADMIN_API_KEY` daria control total si se filtra.

### Solucion

Un servicio intermedio (BFF) que:

1. Es el **unico** que conoce las API keys de Gameng (tanto la ADMIN_API_KEY como las apiKeys de cada actor).
2. Expone una API publica con su **propio sistema de sesiones** (JWT de corta duracion).
3. Los clientes se autentican contra el BFF, nunca contra Gameng directamente.
4. El BFF traduce las sesiones de usuario a las API keys del motor y proxifica las requests.

### Principio fundamental

**El motor Gameng no se toca.** Cero cambios en `src/`, `schemas/`, `openapi/`, `examples/`, ni en los tests existentes. El BFF es un proceso separado que vive fuera del motor.

---

## 2. Arquitectura

```
                     Internet / LAN
                          |
                          v
                   ┌─────────────┐
                   │   Cliente    │   Unity / Web / CLI
                   │   (publico)  │   Solo conoce: BFF URL + su JWT
                   └──────┬──────┘
                          │ HTTPS
                          │ Authorization: Bearer <jwt>
                          v
                   ┌─────────────┐
                   │     BFF     │   Fastify, puerto 5000
                   │  (tu server)│   Conoce: ADMIN_KEY + todas las actor apiKeys
                   │             │   DB local: users -> actorId/apiKey
                   └──────┬──────┘
                          │ HTTP (red interna)
                          │ Authorization: Bearer <actor-apiKey>
                          v
                   ┌─────────────┐
                   │   Gameng    │   Fastify, puerto 3000
                   │   Engine    │   Sin cambios
                   └─────────────┘
```

### Separacion de responsabilidades

| Componente | Responsabilidad | Secretos que conoce |
|-----------|----------------|---------------------|
| **Cliente** | UI, inputs del jugador | Solo su JWT (expira en 15-60 min) |
| **BFF** | Auth de usuarios, mapeo sesion→actor, proxy, rate limiting, anti-cheat | ADMIN_API_KEY, todas las actor apiKeys, JWT_SECRET |
| **Engine** | Logica de juego, estado, persistencia | ADMIN_API_KEY (via env var) |

### Flujos

**Registro:**
```
Cliente                     BFF                          Engine
  │                          │                             │
  │─POST /auth/register─────>│                             │
  │  {email, password}       │─POST /instance_001/tx──────>│
  │                          │  CreateActor (ADMIN_KEY)     │
  │                          │<────{accepted: true}────────│
  │                          │  Guarda en DB: user→actor    │
  │<────{jwt, playerId}─────│                             │
```

**Gameplay:**
```
Cliente                     BFF                          Engine
  │                          │                             │
  │─POST /game/equip────────>│                             │
  │  Authorization: Bearer   │  1. Valida JWT              │
  │  <jwt>                   │  2. Busca actorApiKey en DB │
  │  {characterId, gearId}   │  3. Construye TX completa   │
  │                          │─POST /instance_001/tx──────>│
  │                          │  Authorization: Bearer      │
  │                          │  <actorApiKey>              │
  │                          │  {txId, type: EquipGear,    │
  │                          │   gameInstanceId, playerId, │
  │                          │   characterId, gearId}      │
  │                          │<────TransactionResult───────│
  │<────{accepted, ...}─────│                             │
```

---

## 3. Que se reutiliza del launcher

El launcher actual (`sandbox/apps/launcher/`) ya implementa la mitad del patron BFF.

### Reutilizable directamente

| Componente | Fichero actual | Que se copia/adapta |
|-----------|---------------|---------------------|
| `proxyToEngine()` | `launcher/src/routes.ts:11-55` | Helper central de proxy. Se adapta para inyectar la apiKey del actor en vez de copiar el header del request. |
| 6 rutas proxy | `launcher/src/routes.ts:69-136` | Mismas rutas pero con auth JWT en vez de passthrough. |
| `LauncherConfig` pattern | `launcher/src/config.ts` | Resolucion de env vars con defaults, creacion de directorios. |
| `@fastify/cors` setup | `launcher/src/server.ts` | Misma config CORS. |
| `tsconfig.json` | `launcher/tsconfig.json` | ES2022, Node16, strict. Copiar tal cual. |
| `package.json` base | `launcher/package.json` | Fastify 5 + cors + tsx + vitest. Añadir deps de auth y DB. |

### NO se reutiliza

| Componente | Por que |
|-----------|---------|
| `EngineProcessManager` | El BFF no controla el proceso del engine. El engine corre como servicio independiente. |
| `LogBuffer` | No hay captura de logs del engine. El BFF tiene sus propios logs. |
| Rutas de control (`/engine/start`, `/stop`, `/restart`) | No aplica. Operaciones de devops, no de BFF. |
| `POST /config` | La config del engine la gestiona ops/admin, no el BFF. |
| `GET /status`, `GET /logs` | Especificas del launcher como herramienta de desarrollo. |

---

## 4. Estructura del proyecto

```
bff/                              # Directorio raiz del BFF (al mismo nivel que sandbox/)
├── src/
│   ├── server.ts                 # Bootstrap: Fastify + plugins + listen
│   ├── config.ts                 # Env vars, defaults, BffConfig interface
│   ├── db.ts                     # Capa de DB (SQLite via better-sqlite3)
│   ├── auth/
│   │   ├── jwt.ts                # Generacion y verificacion de JWT
│   │   ├── passwords.ts          # Hash con bcrypt/argon2
│   │   └── middleware.ts         # Fastify preHandler: extraer user de JWT
│   ├── routes/
│   │   ├── auth-routes.ts        # POST /auth/register, /auth/login, /auth/refresh
│   │   ├── game-routes.ts        # Rutas de gameplay (proxy + transformacion)
│   │   ├── player-routes.ts      # GET /game/player, GET /game/stats
│   │   └── admin-routes.ts       # Rutas admin internas (grant resources, etc.)
│   ├── proxy.ts                  # proxyToEngine() adaptado (inyecta apiKey)
│   ├── user-store.ts             # CRUD de usuarios en DB
│   └── types.ts                  # Interfaces compartidas
├── tests/
│   ├── auth.test.ts
│   ├── game-routes.test.ts
│   ├── proxy.test.ts
│   └── helpers.ts
├── migrations/
│   └── 001-initial.sql           # Schema SQL inicial
├── package.json
├── tsconfig.json
└── .env.example                  # Variables de entorno documentadas
```

### Ubicacion en el monorepo

```
D:\Gameng\
├── src/                          # Motor (sin cambios)
├── sandbox/                      # Dev tools (sin cambios)
├── bff/                          # NUEVO — Backend For Frontend
├── docs/
│   ├── CLIENT_TUTORIAL.md        # Actualizar con seccion BFF
│   └── BFF_IMPLEMENTATION_PLAN.md
└── package.json                  # Añadir scripts bff:*
```

---

## 5. Slice 0 — Skeleton y proxy passthrough

**Objetivo:** BFF arranca y proxifica todas las rutas del engine sin autenticacion propia. Valida que la capa de proxy funciona.

### Ficheros

| Fichero | Contenido |
|---------|-----------|
| `bff/package.json` | Deps: `fastify`, `@fastify/cors`. DevDeps: `tsx`, `typescript`, `vitest`, `@types/node`. Scripts: `dev`, `build`, `test`, `start`. |
| `bff/tsconfig.json` | Copia de `sandbox/apps/launcher/tsconfig.json`. |
| `bff/.env.example` | Variables documentadas con defaults. |
| `bff/src/config.ts` | `BffConfig` interface + `resolveConfig()`. Variables: `BFF_PORT` (5000), `ENGINE_URL` (`http://localhost:3000`), `GAME_INSTANCE_ID` (`instance_001`). |
| `bff/src/proxy.ts` | `proxyToEngine(engineUrl, path, method, headers, body)` — adaptado del launcher. Diferencia: recibe `apiKey` como parametro en vez de copiar del request. |
| `bff/src/routes/game-routes.ts` | 6 rutas passthrough (sin auth propia, copia el Authorization del request tal cual — temporal). |
| `bff/src/server.ts` | Bootstrap: Fastify + CORS + register routes + listen. |

### Tests

| Test | Que valida |
|------|-----------|
| `proxy.test.ts` | `proxyToEngine()` con engine mock (nock/msw). Valida que copia status, body, content-type. Valida 502 si engine no responde. |
| `game-routes.test.ts` (parcial) | Rutas responden con datos del engine. |

### Variables de entorno (Slice 0)

```env
BFF_PORT=5000
ENGINE_URL=http://localhost:3000
GAME_INSTANCE_ID=instance_001
```

### Resultado

El BFF arranca en puerto 5000 y actua como proxy transparente. Puedes hacer:

```bash
curl http://localhost:5000/game/health
curl http://localhost:5000/game/player/player_1 -H "Authorization: Bearer <actor-apiKey>"
```

Y el BFF reenvía al engine en `localhost:3000`.

### root package.json — cambios

```json
{
  "scripts": {
    "bff": "npm run --prefix bff dev",
    "bff:build": "npm run --prefix bff build",
    "bff:test": "npm run --prefix bff test"
  }
}
```

---

## 6. Slice 1 — Auth: registro, login, sesiones

**Objetivo:** sistema de autenticacion propio del BFF. Los usuarios se registran con email+password, reciben un JWT, y lo usan para autenticarse.

### Dependencias nuevas

| Paquete | Version | Uso |
|---------|---------|-----|
| `@fastify/jwt` | ^9.x | Plugin JWT para Fastify. Decorado `request.jwtVerify()`, `app.jwt.sign()`. |
| `better-sqlite3` | ^11.x | SQLite embebido. Sin servidor externo. Sync API. |
| `@types/better-sqlite3` | ^7.x | Tipos. |
| `bcrypt` | ^5.x | Hash de passwords (o `argon2` como alternativa). |
| `@types/bcrypt` | ^5.x | Tipos. |

### DB Schema (`migrations/001-initial.sql`)

```sql
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  actor_id      TEXT    NOT NULL UNIQUE,
  api_key       TEXT    NOT NULL UNIQUE,
  player_id     TEXT    NOT NULL UNIQUE,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_actor_id ON users(actor_id);
```

> Cada usuario del BFF mapea 1:1 a un actor de Gameng. `api_key` es la apiKey del actor en Gameng, generada por el BFF en el registro y **nunca expuesta al cliente**.

### Ficheros

| Fichero | Contenido |
|---------|-----------|
| `bff/src/db.ts` | `initDb(path)`: abre SQLite, ejecuta migraciones, retorna instancia. Exports: `getDb()`. |
| `bff/src/user-store.ts` | `createUser(email, passwordHash, actorId, apiKey, playerId)`, `findByEmail(email)`, `findById(id)`. Queries con prepared statements. |
| `bff/src/auth/passwords.ts` | `hashPassword(plain)`: bcrypt hash con salt 12. `verifyPassword(plain, hash)`: bcrypt compare. |
| `bff/src/auth/jwt.ts` | Config de `@fastify/jwt`. Payload: `{ sub: number, email: string, actorId: string, playerId: string }`. Expiracion: configurable (`BFF_JWT_EXPIRY`, default `"1h"`). |
| `bff/src/auth/middleware.ts` | `requireAuth`: Fastify `preHandler` que llama a `request.jwtVerify()`. Decora `request.user` con el payload del JWT. |
| `bff/src/routes/auth-routes.ts` | Ver endpoints abajo. |

### Endpoints

#### `POST /auth/register`

```
Body: { email: string, password: string }
Sin auth.
```

Flujo interno:
1. Validar email formato y password minimo (8 chars).
2. Hash password con bcrypt.
3. Generar `actorId` (UUID) y `apiKey` (UUID).
4. Llamar a Gameng: `CreateActor` con ADMIN_API_KEY → obtener `accepted: true`.
5. Llamar a Gameng: `CreatePlayer` con la nueva apiKey → obtener `accepted: true`.
6. Insertar en DB: `users(email, password_hash, actor_id, api_key, player_id)`.
7. Generar JWT y retornar.

Respuesta (201):
```json
{
  "token": "<jwt>",
  "expiresIn": 3600,
  "playerId": "player_<uuid>"
}
```

Errores:
- `409 CONFLICT` — email ya registrado.
- `502 ENGINE_ERROR` — CreateActor o CreatePlayer fallaron en el engine.
- `400 VALIDATION_ERROR` — email invalido o password corta.

**Punto critico:** si CreateActor tiene exito pero CreatePlayer falla, hay que hacer rollback logico (el actor queda huerfano en Gameng pero el user no se crea en la DB). Documentar este caso edge. Gameng no tiene DeleteActor, asi que el rollback es imperfecto. En la practica, como los IDs son UUIDs, no hay colision si se reintenta.

#### `POST /auth/login`

```
Body: { email: string, password: string }
Sin auth.
```

Flujo interno:
1. Buscar usuario por email.
2. Verificar password con bcrypt.
3. Generar JWT y retornar.

Respuesta (200):
```json
{
  "token": "<jwt>",
  "expiresIn": 3600,
  "playerId": "player_<uuid>"
}
```

Errores:
- `401 INVALID_CREDENTIALS` — email no encontrado o password incorrecta (mismo mensaje para ambos, no filtrar informacion).

#### `POST /auth/refresh`

```
Auth: Bearer <jwt-valido-o-expirado-hace-menos-de-24h>
```

Emite un nuevo JWT sin requerir password. Util para extender la sesion sin re-login.

### Variables de entorno (Slice 1)

```env
BFF_JWT_SECRET=<string-secreto-largo>       # Obligatorio
BFF_JWT_EXPIRY=1h                           # Default 1 hora
BFF_DB_PATH=bff/data/bff.sqlite             # Default
BFF_ADMIN_API_KEY=<la ADMIN_API_KEY del engine>  # Obligatorio
BFF_BCRYPT_ROUNDS=12                        # Default
```

### Tests

| Test | Que valida |
|------|-----------|
| `auth.test.ts` — register | Happy path: user creado, JWT valido, actor+player creados en engine (mock). |
| `auth.test.ts` — register duplicate | 409 si email ya existe. |
| `auth.test.ts` — register engine fail | 502 si engine no acepta CreateActor. |
| `auth.test.ts` — login | Happy path: JWT valido con claims correctos. |
| `auth.test.ts` — login bad password | 401 sin filtrar si es email o password. |
| `auth.test.ts` — refresh | JWT renovado con mismos claims. |
| `auth.test.ts` — middleware | Request sin JWT → 401. JWT expirado → 401. JWT valido → `request.user` populado. |

---

## 7. Slice 2 — Proxy autenticado con mapeo de sesion a actor

**Objetivo:** las rutas de gameplay validan el JWT del cliente, buscan la apiKey del actor en la DB, y la inyectan en la request al engine. El cliente nunca ve la apiKey.

### Cambios en `proxy.ts`

```typescript
// Antes (Slice 0 — passthrough):
async function proxyToEngine(engineUrl, path, method, headers, body)

// Despues (Slice 2 — inyeccion de apiKey):
async function proxyToEngine(
  engineUrl: string,
  path: string,
  method: string,
  body: unknown,
  actorApiKey: string,  // <-- inyectado por la ruta, NO del request del cliente
): Promise<ProxyResult>
```

La cabecera `Authorization` del request del cliente (que contiene el JWT) **se descarta** en el proxy. En su lugar, el BFF inyecta `Authorization: Bearer <actorApiKey>` con la key sacada de la DB.

### Cambios en `game-routes.ts`

Todas las rutas de gameplay:

1. Ejecutan `requireAuth` preHandler → `request.user` contiene `{ sub, actorId, playerId }`.
2. Buscan `apiKey` en DB: `SELECT api_key FROM users WHERE id = ?` (por `request.user.sub`).
3. Llaman a `proxyToEngine()` con la apiKey.

```typescript
// Patron de cada ruta:
app.get("/game/player", { preHandler: [requireAuth] }, async (request, reply) => {
  const user = request.user;                        // del JWT
  const apiKey = await getUserApiKey(user.sub);      // de la DB
  const playerId = user.playerId;

  return proxyToEngine(
    config.engineUrl,
    `/${config.gameInstanceId}/state/player/${playerId}`,
    "GET",
    undefined,
    apiKey,
  );
});
```

### Simplificacion de la API publica

El BFF puede simplificar la API que expone al cliente. El cliente no necesita saber sobre `gameInstanceId`, `playerId`, ni `txId` — el BFF los rellena:

| API del Engine | API del BFF | Que rellena el BFF |
|---------------|-------------|-------------------|
| `POST /:instanceId/tx` con `{txId, type, gameInstanceId, playerId, ...}` | `POST /game/equip` con `{characterId, gearId}` | `txId` (UUID), `gameInstanceId`, `playerId` (del JWT) |
| `GET /:instanceId/state/player/:playerId` | `GET /game/player` | `gameInstanceId`, `playerId` (del JWT) |
| `GET /:instanceId/character/:charId/stats` | `GET /game/stats/:characterId` | `gameInstanceId` |
| `GET /:instanceId/config` | `GET /game/config` | `gameInstanceId` |
| `GET /:instanceId/stateVersion` | `GET /game/version` | `gameInstanceId` |

### Tests

| Test | Que valida |
|------|-----------|
| `game-routes.test.ts` — sin JWT | 401 en todas las rutas de gameplay. |
| `game-routes.test.ts` — JWT valido | Proxy reenvia con la apiKey correcta del actor (no la del JWT). |
| `game-routes.test.ts` — JWT de otro usuario | No puede acceder a datos de otro player (OWNERSHIP_VIOLATION del engine). |
| `proxy.test.ts` — inyeccion | Verificar que la cabecera Authorization enviada al engine contiene la apiKey del actor, no el JWT. |

---

## 8. Slice 3 — Rutas de gameplay tipadas

**Objetivo:** API publica simplificada. El cliente envia payloads minimos, el BFF construye la transaccion completa.

### Rutas publicas del BFF

#### Lecturas (GET)

| Ruta BFF | Engine target | Auth | Descripcion |
|----------|--------------|------|-------------|
| `GET /game/health` | `GET /health` | No | Health check del engine (passthrough). |
| `GET /game/config` | `GET /:id/config` | No | Config activa. |
| `GET /game/version` | `GET /:id/stateVersion` | No | stateVersion (polling). |
| `GET /game/player` | `GET /:id/state/player/:pid` | JWT | Estado del player del usuario autenticado. |
| `GET /game/stats/:characterId` | `GET /:id/character/:cid/stats` | JWT | Stats de un personaje. |

#### Acciones (POST)

Todas requieren JWT. El BFF genera `txId` (UUID) y rellena `gameInstanceId` + `playerId`.

| Ruta BFF | Body del cliente | TX type en engine | Campos inyectados |
|----------|-----------------|-------------------|-------------------|
| `POST /game/character` | `{ characterId, classId }` | `CreateCharacter` | `txId`, `gameInstanceId`, `playerId` |
| `POST /game/gear` | `{ gearId, gearDefId }` | `CreateGear` | `txId`, `gameInstanceId`, `playerId` |
| `POST /game/equip` | `{ characterId, gearId, slotPattern?, swap? }` | `EquipGear` | `txId`, `gameInstanceId`, `playerId` |
| `POST /game/unequip` | `{ gearId, characterId? }` | `UnequipGear` | `txId`, `gameInstanceId`, `playerId` |
| `POST /game/levelup/character` | `{ characterId, levels? }` | `LevelUpCharacter` | `txId`, `gameInstanceId`, `playerId` |
| `POST /game/levelup/gear` | `{ gearId, levels?, characterId? }` | `LevelUpGear` | `txId`, `gameInstanceId`, `playerId` |

### Transformacion de respuestas

El BFF puede (opcionalmente) transformar las respuestas del engine para simplificar la UX del cliente:

```typescript
// Respuesta del engine:
{ txId: "uuid", accepted: true, stateVersion: 5 }

// Respuesta del BFF (simplificada, sin exponer txId):
{ ok: true, version: 5 }

// Respuesta de rechazo del engine:
{ txId: "uuid", accepted: false, stateVersion: 4, errorCode: "SLOT_OCCUPIED", errorMessage: "..." }

// Respuesta del BFF:
{ ok: false, error: "SLOT_OCCUPIED", message: "..." }
```

**Alternativa:** passthrough directo de la respuesta del engine. Mas simple, menos trabajo, el cliente maneja el formato `TransactionResult` tal cual. Decision del equipo.

### Idempotencia en el BFF

El BFF genera txIds internamente, asi que el engine sigue teniendo idempotencia por txId. Para el cliente, la idempotencia se maneja diferente:

- **Opcion A (simple):** no dar idempotencia al cliente. Cada POST genera un txId nuevo. Si el cliente hace retry, se ejecuta de nuevo (puede fallar con ALREADY_EXISTS o ser una doble mutacion).
- **Opcion B (robusta):** el cliente envia un `requestId` (header o body). El BFF mantiene un cache `requestId → txId` y reutiliza el txId para retries. Asi, el retry del cliente se mapea al mismo txId en el engine y la idempotencia del motor lo protege.

**Recomendacion:** Slice 3 con Opcion A. Añadir Opcion B como mejora futura si se necesita.

### Ficheros

| Fichero | Contenido |
|---------|-----------|
| `bff/src/routes/game-routes.ts` | Reescribir con rutas tipadas. Cada ruta: JWT → DB lookup → construir TX → proxy → transformar respuesta. |
| `bff/src/types.ts` | Interfaces para los bodies simplificados del cliente: `EquipRequest`, `CreateCharacterRequest`, etc. |

### Tests

| Test | Que valida |
|------|-----------|
| `game-routes.test.ts` — create character | Body minimo `{characterId, classId}` → TX completa enviada al engine con txId, gameInstanceId, playerId. |
| `game-routes.test.ts` — equip | `{characterId, gearId}` → EquipGear TX. |
| `game-routes.test.ts` — equip swap | `{characterId, gearId, swap: true}` → EquipGear con swap. |
| `game-routes.test.ts` — error mapping | Engine devuelve `{accepted: false, errorCode: "SLOT_OCCUPIED"}` → BFF retorna formato simplificado (o passthrough). |
| `game-routes.test.ts` — txId generado | Verificar que txId es UUID distinto en cada request. |

---

## 9. Slice 4 — Admin API interna

**Objetivo:** endpoints para que tu backend de negocio (tienda, recompensas, eventos) pueda conceder recursos sin exponer la ADMIN_API_KEY.

### Rutas admin

Protegidas con un token admin del BFF (separado del JWT de usuarios). Mecanismo simple: header `X-Admin-Secret` que coincida con una env var `BFF_INTERNAL_ADMIN_SECRET`.

| Ruta BFF | Engine TX | Uso |
|----------|----------|-----|
| `POST /admin/grant-resources` | `GrantResources` | Conceder recursos al player (gold, gems). Body: `{ playerId, resources }`. |
| `POST /admin/grant-character-resources` | `GrantCharacterResources` | Conceder recursos al character (xp). Body: `{ playerId, characterId, resources }`. |
| `POST /admin/create-actor` | `CreateActor` | Crear actor manualmente (para integraciones). Body: `{ actorId, apiKey }`. |
| `GET /admin/users` | (DB query) | Listar usuarios del BFF. Paginado. |
| `GET /admin/users/:id` | (DB query) | Detalle de un usuario (sin exponer password_hash ni apiKey). |

### Variables de entorno

```env
BFF_INTERNAL_ADMIN_SECRET=<string-secreto>   # Para rutas /admin/*
```

### Tests

| Test | Que valida |
|------|-----------|
| `admin-routes.test.ts` — grant | Proxy a GrantResources con ADMIN_API_KEY, retorna resultado. |
| `admin-routes.test.ts` — sin secret | 401 si falta `X-Admin-Secret`. |
| `admin-routes.test.ts` — list users | Retorna lista paginada sin campos sensibles. |

---

## 10. Slice 5 — Rate limiting y hardening

**Objetivo:** proteger el BFF de abuso.

### Dependencias

| Paquete | Uso |
|---------|-----|
| `@fastify/rate-limit` | Rate limiting por IP y/o por usuario. |
| `@fastify/helmet` | Headers de seguridad (HSTS, no-sniff, etc.). |

### Configuracion de rate limit

```typescript
app.register(rateLimit, {
  global: true,
  max: 100,        // requests por ventana
  timeWindow: 60_000, // 1 minuto
  keyGenerator: (request) => {
    // Si esta autenticado, limitar por userId. Si no, por IP.
    return request.user?.sub?.toString() ?? request.ip;
  },
});
```

Limites mas estrictos para rutas sensibles:

| Ruta | Max por minuto | Razon |
|------|---------------|-------|
| `POST /auth/register` | 5 | Prevenir creacion masiva de cuentas |
| `POST /auth/login` | 10 | Prevenir fuerza bruta |
| `POST /game/*` (tx) | 60 | Limitar operaciones de gameplay |
| `GET /game/*` (reads) | 120 | Lecturas mas permisivas |

### Validacion de inputs

Cada ruta debe validar su body con JSON Schema (Fastify soporta esto nativamente):

```typescript
app.post("/game/equip", {
  schema: {
    body: {
      type: "object",
      required: ["characterId", "gearId"],
      properties: {
        characterId: { type: "string", minLength: 1, maxLength: 100 },
        gearId: { type: "string", minLength: 1, maxLength: 100 },
        slotPattern: { type: "array", items: { type: "string" }, maxItems: 10 },
        swap: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  preHandler: [requireAuth],
}, handler);
```

### Tests

| Test | Que valida |
|------|-----------|
| Rate limit en login | 11a request en 1 min → 429 Too Many Requests. |
| Body validation | Campos extra → 400. Campos faltantes → 400. |

---

## 11. Slice 6 — Observabilidad

**Objetivo:** logs estructurados, metricas basicas, health check del BFF.

### Health check del BFF

```
GET /health
```

Retorna:
```json
{
  "status": "ok",
  "uptime": 123.4,
  "engine": { "reachable": true, "latencyMs": 5 },
  "db": { "connected": true }
}
```

El BFF hace un `GET /health` al engine para verificar conectividad.

### Logs estructurados

Usar el logger integrado de Fastify (pino). Añadir campos custom:

```typescript
request.log.info({
  userId: request.user?.sub,
  action: "equip",
  characterId: body.characterId,
  gearId: body.gearId,
  accepted: result.accepted,
  durationMs: elapsed,
}, "game action");
```

**Regla:** nunca loggear apiKeys, passwords, ni JWTs. Solo IDs y resultados.

### Metricas (opcional, futuro)

Si se necesitan metricas (Prometheus, Datadog):

```typescript
// Contadores
bff_requests_total{route, method, status}
bff_auth_attempts_total{result: "success"|"failure"}
bff_engine_proxy_duration_seconds{route}
```

Esto es una mejora futura. No es critico para el MVP.

---

## 12. Base de datos

### Tecnologia: SQLite via `better-sqlite3`

**Por que SQLite:**
- Sin servidor externo (cero infraestructura adicional).
- El BFF tiene una sola instancia (no hay concurrencia multi-proceso).
- Rendimiento mas que suficiente (10k+ queries/segundo en sync).
- Fichero unico, facil de backupear.
- Migracion a Postgres trivial si escala (mismas queries SQL con minimos cambios).

### Fichero de DB

```
bff/data/bff.sqlite
```

Gitignored. Creado automaticamente al arrancar.

### Migraciones

Directorio `bff/migrations/` con ficheros SQL numerados:

```
001-initial.sql      — Tabla users
002-refresh-tokens.sql  — (futuro) Tabla refresh tokens
```

El BFF ejecuta migraciones pendientes al arrancar (patron simple: tabla `migrations` con los IDs aplicados).

### Schema de la tabla `users`

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  actor_id      TEXT    NOT NULL UNIQUE,    -- actorId en Gameng
  api_key       TEXT    NOT NULL UNIQUE,    -- apiKey del actor en Gameng (NUNCA expuesta)
  player_id     TEXT    NOT NULL UNIQUE,    -- playerId en Gameng
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### Consultas principales

| Operacion | Query | Cuando |
|-----------|-------|--------|
| Registro | `INSERT INTO users (email, password_hash, actor_id, api_key, player_id) VALUES (?, ?, ?, ?, ?)` | `POST /auth/register` |
| Login | `SELECT * FROM users WHERE email = ?` | `POST /auth/login` |
| Lookup apiKey | `SELECT api_key FROM users WHERE id = ?` | Cada request autenticada (preHandler) |
| Listar | `SELECT id, email, player_id, created_at FROM users LIMIT ? OFFSET ?` | `GET /admin/users` |

> **El lookup de apiKey se hace en cada request.** Con SQLite sync y prepared statements, esto toma <0.1ms. Si fuera un bottleneck, se cachea en memoria con TTL corto.

---

## 13. Configuracion y variables de entorno

### Fichero `.env.example`

```env
# ---- Servidor BFF ----
BFF_PORT=5000                          # Puerto del BFF
BFF_HOST=0.0.0.0                       # Host de escucha
BFF_LOG_LEVEL=info                     # Nivel de log (trace/debug/info/warn/error)

# ---- Conexion al engine ----
ENGINE_URL=http://localhost:3000       # URL base del motor Gameng
GAME_INSTANCE_ID=instance_001          # gameInstanceId fijo para esta instancia del BFF

# ---- Auth ----
BFF_JWT_SECRET=cambiar-en-produccion   # Secreto para firmar JWTs (OBLIGATORIO)
BFF_JWT_EXPIRY=1h                      # Duracion del JWT (default: 1 hora)
BFF_BCRYPT_ROUNDS=12                   # Rounds de bcrypt (default: 12)

# ---- Admin ----
BFF_ADMIN_API_KEY=mi-clave-admin       # ADMIN_API_KEY del engine (OBLIGATORIO)
BFF_INTERNAL_ADMIN_SECRET=mi-secret    # Token para rutas /admin/* del BFF

# ---- Base de datos ----
BFF_DB_PATH=bff/data/bff.sqlite        # Ruta al fichero SQLite

# ---- Rate limiting ----
BFF_RATE_LIMIT_MAX=100                 # Max requests por ventana (default: 100)
BFF_RATE_LIMIT_WINDOW_MS=60000         # Ventana en ms (default: 60s)
```

### Validacion al arrancar

El BFF debe fallar rapido si faltan variables obligatorias:

```typescript
if (!config.jwtSecret) {
  throw new Error("BFF_JWT_SECRET is required.");
}
if (!config.adminApiKey) {
  throw new Error("BFF_ADMIN_API_KEY is required.");
}
```

---

## 14. Testing

### Estrategia

| Nivel | Herramienta | Que prueba | Engine? |
|-------|------------|-----------|---------|
| **Unit** | Vitest | Logica de auth (hash, JWT, middleware), user-store (SQLite in-memory), proxy helper | Mock (nock/msw) |
| **Integracion** | Vitest + `app.inject()` | Rutas completas del BFF (register → login → gameplay) | Mock |
| **E2E** | Vitest | BFF + Engine reales. Flujo completo. | Real (spawn) |

### Tests unitarios y de integracion (con engine mock)

Para los tests del BFF, el engine se mockea con `nock` o `msw` (interceptar HTTP). Esto permite:
- Testear que el BFF construye las TX correctamente.
- Testear que el BFF maneja errores del engine (502, rejected, etc.).
- No depender de que el engine este compilado o corriendo.

```typescript
// Ejemplo con nock:
nock("http://localhost:3000")
  .post("/instance_001/tx")
  .reply(200, { txId: "abc", accepted: true, stateVersion: 1 });
```

### Tests E2E

Reutilizar el patron de `tests/e2e/process.ts`:
1. Build del engine (`npm run build`).
2. Spawn del engine en un puerto libre.
3. Build + spawn del BFF apuntando al engine.
4. Ejecutar tests contra el BFF.

```typescript
// tests/e2e/bff.test.ts
const engine = await startEngine({ port: 4100, adminApiKey: "test-admin" });
const bff = await startBff({ port: 5100, engineUrl: "http://localhost:4100", adminApiKey: "test-admin" });

// Registro
const reg = await fetch("http://localhost:5100/auth/register", { ... });
const { token } = await reg.json();

// Gameplay via BFF
const equip = await fetch("http://localhost:5100/game/equip", {
  headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify({ characterId: "hero_1", gearId: "sword_1" }),
});
```

### Estimacion de tests

| Area | Tests estimados |
|------|----------------|
| Auth (register, login, refresh, middleware) | 15-20 |
| Game routes (cada tx type + errores) | 20-25 |
| Admin routes | 8-10 |
| Proxy (errores engine, timeouts) | 5-8 |
| Rate limiting | 3-5 |
| E2E (flujo completo) | 8-12 |
| **Total** | **~60-80** |

---

## 15. Documentacion a actualizar

| Documento | Cambios |
|-----------|---------|
| `docs/CLIENT_TUTORIAL.md` | Añadir seccion 13: "Usando el BFF" con la API simplificada, flujo de registro/login, y diferencias con la API directa del engine. |
| `docs/QUICKSTART.md` | Añadir seccion "BFF" con instrucciones de arranque: `npm run bff`, variables de entorno, flujo minimo. |
| `docs/SEMANTICS.md` | Añadir decision #21: "BFF — Capa de autenticacion de usuarios" con las decisiones arquitecturales (JWT, SQLite, 1:1 user→actor). |
| `docs/ERROR_CODES.md` | Sin cambios (los error codes del engine no cambian). Opcionalmente, documentar los errores propios del BFF (`INVALID_CREDENTIALS`, `CONFLICT`, `ENGINE_ERROR`). |
| `openapi/openapi.yaml` | Sin cambios. El contrato del engine es el mismo. Opcionalmente, crear `bff/openapi/bff-openapi.yaml` con la API publica del BFF. |
| `README.md` (si existe) | Mencionar el BFF como componente. |
| `bff/README.md` | Crear con instrucciones especificas del BFF. |
| `.gitignore` | Añadir `bff/data/` (SQLite + ficheros runtime). |
| `.prettierignore` | Añadir `bff/` (misma politica que `sandbox/`). |
| `eslint.config.js` | Añadir ignore para `bff/` (mismo patron que sandbox). |

---

## 16. Lo que NO cambia

| Area | Cambios | Detalle |
|------|---------|---------|
| `src/` | Cero | El motor no se toca. |
| `schemas/` | Cero | Los contratos JSON Schema no cambian. |
| `openapi/openapi.yaml` | Cero | La especificacion del engine no cambia. |
| `examples/` | Cero | Los ejemplos de config y tx no cambian. |
| `tests/` (engine) | Cero | Los 296 unit tests y 51 E2E tests no cambian. |
| `sandbox/` | Cero | El sandbox sigue funcionando como herramienta de dev. |
| `scripts/` | Cero | Scripts de validacion/sync no cambian. |

### Cambios en root

| Fichero | Cambio |
|---------|--------|
| `package.json` | Añadir scripts `bff`, `bff:build`, `bff:test`. |
| `.gitignore` | Añadir `bff/data/**`. |
| `.prettierignore` | Añadir `bff/`. |

---

## 17. Riesgos y decisiones pendientes

### Decisiones a tomar antes de implementar

| Decision | Opciones | Recomendacion | Impacto |
|----------|----------|---------------|---------|
| **Proveedor de auth externo?** | A) Auth propio (email+bcrypt+JWT). B) Firebase Auth / Auth0 / Supabase Auth. | **A** para MVP. B si se necesita OAuth social (Google, Steam, Apple). | B elimina Slice 1 (passwords, DB de users) pero añade dependencia externa. |
| **1 player por usuario o N?** | A) 1:1 (register crea actor+player automaticamente). B) N:1 (usuario crea players on-demand). | **A** para MVP. Simplifica el modelo. | B requiere rutas adicionales y logica de seleccion de player. |
| **gameInstanceId fijo o dinamico?** | A) Un solo gameInstanceId fijo en env var. B) Multi-instancia (el usuario elige). | **A** para MVP. Un juego = una instancia. | B requiere logica de discovery/routing. |
| **Transformar respuestas?** | A) Passthrough (el cliente recibe el formato del engine). B) Transformar a formato simplificado. | **A** para MVP. Menos codigo, cliente puede reusar tipos del engine. | B es mejor UX pero mas mantenimiento. |
| **Idempotencia cliente?** | A) No (BFF genera txId). B) `X-Request-Id` header. | **A** para MVP. | B es mas seguro contra retries pero requiere cache en BFF. |
| **HTTPS en el BFF?** | A) TLS en el BFF directamente. B) Reverse proxy (nginx/cloudflare) delante. | **B** para produccion. **A** no necesario en dev. | B es estandar para produccion. El BFF escucha HTTP, el reverse proxy añade TLS. |

### Riesgos

| Riesgo | Mitigacion |
|--------|-----------|
| **Rollback parcial en registro** | CreateActor tiene exito pero CreatePlayer falla → actor huerfano en Gameng. Mitigacion: reintentar CreatePlayer. Si falla definitivamente, loggear y no crear el user en DB. El actor huerfano no causa daño (no tiene players). |
| **Latencia añadida** | Cada request pasa por BFF → engine (1 hop extra). Mitigacion: BFF y engine en la misma red/maquina. Latencia esperada: <5ms extra. |
| **Single point of failure** | Si el BFF cae, ningun cliente puede jugar. Mitigacion: misma que cualquier servicio web (healthchecks, restart automatico, multiples replicas si es necesario). |
| **SQLite concurrencia** | SQLite no soporta escrituras concurrentes de multiples procesos. Mitigacion: una sola instancia del BFF. Si se necesitan multiples instancias, migrar a Postgres (las queries SQL son compatibles). |
| **JWT robado** | Si un JWT es interceptado, da acceso durante su TTL. Mitigacion: TTL corto (1h), HTTPS obligatorio en produccion, no almacenar en localStorage en produccion (usar cookie httpOnly). |

---

## 18. Resumen de entregables por slice

| Slice | Nombre | Ficheros nuevos | Tests | Deps nuevas | Prerequisito |
|-------|--------|----------------|-------|-------------|-------------|
| **0** | Skeleton + proxy | 5 (`server.ts`, `config.ts`, `proxy.ts`, `game-routes.ts`, configs) | 5-8 | `fastify`, `@fastify/cors` | Engine funcionando |
| **1** | Auth | 6 (`db.ts`, `user-store.ts`, `jwt.ts`, `passwords.ts`, `middleware.ts`, `auth-routes.ts`) + migration SQL | 15-20 | `@fastify/jwt`, `better-sqlite3`, `bcrypt` | Slice 0 |
| **2** | Proxy autenticado | Modificar `proxy.ts` y `game-routes.ts` | 8-10 | — | Slice 1 |
| **3** | Rutas tipadas | Reescribir `game-routes.ts` + `types.ts` | 20-25 | — | Slice 2 |
| **4** | Admin API | `admin-routes.ts` | 8-10 | — | Slice 2 |
| **5** | Rate limiting + hardening | Modificar `server.ts`, schemas en rutas | 5-8 | `@fastify/rate-limit`, `@fastify/helmet` | Slice 3 |
| **6** | Observabilidad | Modificar `server.ts`, health check | 3-5 | — | Slice 5 |

### Estimacion total

| Metrica | Valor |
|---------|-------|
| Ficheros nuevos | ~15-20 |
| Tests nuevos | ~60-80 |
| Dependencias nuevas | 6 (fastify, cors, jwt, sqlite, bcrypt, rate-limit) |
| Cambios en engine | **0** |
| Cambios en sandbox | **0** |
| Cambios en schemas/openapi | **0** |

### Orden recomendado

```
Slice 0 (1 dia) → Slice 1 (2-3 dias) → Slice 2 (1 dia) → Slice 3 (1-2 dias)
                                                          → Slice 4 (1 dia, paralelo a 3)
→ Slice 5 (medio dia) → Slice 6 (medio dia)
```

**Total estimado: 5-8 dias de trabajo enfocado.**
