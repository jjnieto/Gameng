# Sandbox Visual MVP — Plan de Delivery (Opción 1: Launcher Node + Front React/Tailwind)

## Objetivo
Construir un entorno **muy visual** para probar el motor (Gameng) con:
- **Edición/validación de config** de forma usable (visual + JSON).
- **Arranque/parada/restart del server** con esa config (sin hot reload).
- Vistas por rol: **Admin**, **GM**, **Player** (en una sola SPA).
- Mantenerlo local-first: todo corre en `localhost`.

## Principios
- **Un solo front** (SPA) con rutas/roles, no múltiples apps.
- **Launcher local** en Node: el navegador no puede arrancar procesos. El launcher:
  - Escribe la config a disco
  - Arranca el server con `CONFIG_PATH`
  - Expone logs/estado a la SPA
- Iteración en **mini-slices** con aceptación clara y tests básicos.
- Sin cambios de comportamiento en el motor salvo endpoints/DX estrictamente necesarios (idealmente ninguno).

---

## Estructura propuesta del repo
Añadir un workspace `sandbox/` sin tocar el core salvo lo imprescindible.

```
/ (repo root)
  /src                  # motor existente
  /docs
  /schemas
  /openapi
  /examples
  /tests

  /sandbox
    /apps
      /launcher         # Node/TS (Fastify o Express) controla procesos + filesystem
      /web              # React + Vite + Tailwind (SPA)
    /packages
      /shared           # tipos compartidos, cliente API, utilidades (opcional)
    /data               # generado en runtime (gitignored)
      /configs          # configs activas/presets (json)
      /snapshots        # SNAPSHOT_DIR para server arrancado por launcher
      /logs             # logs persistidos si se decide
    /docs               # notas específicas del sandbox (opcional)
```

### Convenciones
- `sandbox/data/**` en `.gitignore`.
- El launcher arranca el motor como **child process** apuntando a `sandbox/data/configs/active.json` y `sandbox/data/snapshots/`.
- La SPA se conecta al launcher (p.ej. `http://localhost:4010`) y al motor (p.ej. `http://localhost:4000`).

---

## Scripts npm (propuesta)
En root `package.json`:

- `npm run sandbox:launcher` → arranca launcher
- `npm run sandbox:web` → arranca SPA
- `npm run sandbox` → arranca ambos en paralelo (con `concurrently`)
- `npm run sandbox:reset` → limpia `sandbox/data/*` (con confirmación o safe delete)

En `sandbox/apps/web`:
- `npm run dev` (Vite)

En `sandbox/apps/launcher`:
- `npm run dev` (ts-node/tsx) o build+start.

---

## Variables de entorno (launcher)
- `SANDBOX_ENGINE_PORT` (default 4000)
- `SANDBOX_LAUNCHER_PORT` (default 4010)
- `SANDBOX_CONFIG_PATH` (default `sandbox/data/configs/active.json`)
- `SANDBOX_SNAPSHOT_DIR` (default `sandbox/data/snapshots`)
- `SANDBOX_ENGINE_LOG_LEVEL` (default `warn`)
- `SANDBOX_ADMIN_API_KEY` (opcional; se pasa al motor como `ADMIN_API_KEY`)

La SPA guarda en localStorage:
- `baseUrlEngine`
- `baseUrlLauncher`
- `gameInstanceId`
- `adminApiKey` (solo local)

---

# Fases y slices

## Fase 0 — Infraestructura base
### Slice 0.1 — Crear skeleton sandbox + scripts
**Alcance**
- Añadir `sandbox/` con `apps/launcher` y `apps/web`.
- Añadir scripts root para arrancar ambos.
- `.gitignore` para `sandbox/data/**`.

**Aceptación**
- `npm run sandbox` levanta launcher + web.
- No rompe `npm run check` del core.

---

## Fase 1 — Launcher (control del motor)
### Slice 1.1 — Launcher API mínima
**Launcher endpoints**
- `GET /status` → `{ engine: { running, pid?, port }, config: { path }, snapshotDir }`
- `GET /logs` → últimos N líneas (ring buffer)
- `POST /engine/start` → arranca motor si no está corriendo
- `POST /engine/stop` → detiene motor si corre
- `POST /engine/restart` → stop+start
- `POST /config` → guarda `active.json` (body = JSON config) y opcionalmente `restart=true`

**Detalles técnicos**
- Usa `child_process.spawn` para arrancar el server del motor.
- Pasa env vars: `CONFIG_PATH`, `SNAPSHOT_DIR`, `ADMIN_API_KEY`, `LOG_LEVEL`.
- Captura stdout/stderr en memoria (ring buffer) y expón por `/logs`.

**Aceptación**
- Desde curl/Postman se puede:
  - subir config
  - start/restart motor
  - leer logs
- Restart refleja cambios de config.

### Slice 1.2 — Salud del motor y auto-detección
**Alcance**
- Launcher hace polling a `GET /health` del motor.
- `GET /status` incluye health actual.
- Manejo robusto de puertos ocupados/errores de arranque (mensajes claros).

**Aceptación**
- Si el motor cae, `/status` lo refleja.
- Logs muestran error de arranque.

---

## Fase 2 — Web UI base + Server Control
### Slice 2.1 — UI “Server Control” (pantalla inicial)
**Alcance**
- Página con:
  - base URL launcher/engine (editable)
  - botón Start/Stop/Restart
  - indicador Running/Health
  - visor de logs (tail)
  - selector `gameInstanceId` (string) persistente

**Aceptación**
- Se arranca y reinicia el motor desde UI.
- Se ven logs del motor.
- Se puede llamar a `/health` y mostrar OK/FAIL.

### Slice 2.2 — Cliente API TS (engine + launcher)
**Alcance**
- Paquete `sandbox/packages/shared` o dentro de web:
  - `launcherClient` y `engineClient`
  - helpers para `tx`, `config`, `stateVersion`, `player state`, `stats`

**Aceptación**
- El front no hace fetch “a mano” repetido: usa cliente centralizado.
- Manejo uniforme de errores.

---

## Fase 3 — Config Studio (edición/validación)
### Slice 3.1 — Editor JSON + validación schema (MVP)
**Alcance**
- Vista “Config Studio” con:
  - textarea/monaco opcional (puede ser simple al principio)
  - botones: Load preset (minimal/sets), Validate, Save to Launcher, Restart Engine
  - panel de errores (paths + mensajes)
- Validación con Ajv usando `schemas` del repo (copiados o importados vía build step).

**Aceptación**
- Config inválida: muestra errores claros.
- Config válida: permite guardarla y reiniciar motor con ella.
- Tras restart, `GET /:id/config` devuelve esa config.

### Slice 3.2 — Visual editor incremental (por secciones)
**Alcance**
- UI visual mínima para 2–3 secciones:
  - `classes` (alta/edición simple)
  - `gearDefs` (slots + stats)
  - `algorithms` (growth, levelCost, statClamps)
- Sin buscar perfección: formularios simples + tabla.

**Aceptación**
- Cambios visuales se reflejan en JSON final y pasan validate.

---

## Fase 4 — Admin Console (ADMIN_API_KEY)
### Slice 4.1 — Admin: CreateActor + GrantResources
**Alcance**
- Vista “Admin Console”:
  - input admin key (localStorage)
  - CreateActor form
  - GrantResources form
  - historial de tx enviadas (tabla)

**Aceptación**
- Sin key: 401 visible con mensaje.
- Con key: CreateActor y GrantResources funcionan.

---

## Fase 5 — Player Client (loop jugable mínimo)
### Slice 5.1 — Player: crear y ver estado
**Alcance**
- Vista “Player”:
  - input `playerId`
  - CreatePlayer
  - ver `GET state/player/:playerId`

**Aceptación**
- Se crea player y se muestra estado.

### Slice 5.2 — Player: characters + gear + equip
**Alcance**
- CreateCharacter, CreateGear
- EquipGear (strict + swap toggle)
- Vista de gear/slots del character (visual)

**Aceptación**
- Equip strict falla si slot ocupado.
- Equip con swap funciona y UI refleja el swap.

### Slice 5.3 — Player: stats y stateVersion polling
**Alcance**
- Vista de stats por character usando `GET /character/:id/stats`.
- Polling eficiente por `GET /:id/stateVersion`:
  - si cambia: refresh de estado/stats.
- LevelUpCharacter/Gear (mostrando coste y recursos antes/después).

**Aceptación**
- Stats cambian con equip/level up.
- Polling no spamea: solo refetch cuando stateVersion cambia.

---

## Fase 6 — GM Dashboard (observabilidad mínima)
### Slice 6.1 — GM: inspector de IDs conocidos
**Alcance**
- Lista local de players/characters creados en la sesión (guardada en localStorage).
- Inspector:
  - player state
  - stats por character
  - sets activos (si aparece en stats o se puede derivar)

**Aceptación**
- GM puede “mirar” sin mutar estado.
- Utilidad real para depurar.

---

# Decisiones pendientes (definir antes de implementar slices 0–1)
1) **Puertos por defecto**: engine 4000, launcher 4010 (o los que prefieras).
2) **Cómo importar schemas al front**:
   - copiarlos a `sandbox/apps/web/src/schemas` en build step
   - o exponer endpoint launcher `GET /schemas/*` para servirlos
3) **Monaco editor** o textarea simple para MVP.
4) **Gestión de presets**: cargar `examples/config_minimal.json` y `examples/config_sets.json` desde repo.
5) **Estrategia CORS**: el motor debe permitir llamadas desde la SPA; preferible que el launcher haga de proxy (opcional) para evitar CORS.

---

# Entregables mínimos (para “probarlo visualmente”)
- `sandbox/apps/launcher` con start/stop/restart + config upload + logs
- `sandbox/apps/web` con:
  - Server Control
  - Config Studio (JSON + validate)
  - Admin Console (CreateActor/GrantResources)
  - Player (crear PJ/gear, equip, stats)
- Docs: `docs/QUICKSTART.md` ampliado con “Sandbox” (comandos Windows/Linux).

---

# Definición de “done” del MVP
- Desde la SPA:
  1) Editar config → Validate → Restart engine
  2) Crear actor/admin y dar recursos
  3) Crear player → character → gear
  4) Equip strict/swap
  5) Ver stats y clamps
  6) Level up con coste y recursos
- Sin tocar manualmente ficheros ni consola (salvo arrancar `npm run sandbox`).
