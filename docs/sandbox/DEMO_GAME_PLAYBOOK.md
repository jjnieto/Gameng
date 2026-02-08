# Demo Game Playbook

Guia paso a paso para ejecutar la demo completa del sandbox de Gameng. Cubre desde el arranque hasta la inspeccion de stats, pasando por escenarios automatizados y flujos manuales.

> Para referencia tecnica rapida (endpoints, env vars, estructura de archivos), ver [`../QUICKSTART.md`](../QUICKSTART.md).

---

## 1. Requisitos e instalacion

### Requisitos

- **Node.js** >= 20
- **npm** >= 9

```bash
node -v    # v20.x o superior
npm -v     # 9.x o superior
```

### Instalacion (una sola vez)

```bash
git clone <repo-url> gameng
cd gameng
npm ci
npm run build
npm install --prefix sandbox/apps/launcher
npm install --prefix sandbox/apps/web
```

> `npm run build` compila el motor a `dist/`. El launcher arranca `node dist/server.js`, asi que este paso es obligatorio antes de usar el sandbox.

---

## 2. Arranque del sandbox

### Configurar la Admin API Key

El motor requiere una admin key para las operaciones `CreateActor` y `GrantResources`. Sin ella, estas operaciones devuelven 401.

**PowerShell:**

```powershell
$env:SANDBOX_ADMIN_API_KEY="mi-clave-admin"
npm run sandbox
```

**CMD:**

```cmd
set SANDBOX_ADMIN_API_KEY=mi-clave-admin
npm run sandbox
```

**Linux / macOS / Git Bash:**

```bash
SANDBOX_ADMIN_API_KEY=mi-clave-admin npm run sandbox
```

Este comando:
1. Sincroniza schemas y presets al front (`sandbox:sync`).
2. Arranca el launcher (puerto **4010**).
3. Arranca la web SPA (puerto **5173** por defecto; si esta ocupado, Vite usa el siguiente disponible — mira el terminal para el puerto real).

### Verificar que funciona

1. Abre la URL que aparece en el terminal (normalmente `http://localhost:5173`).
2. La sidebar muestra 6 paginas: **Server**, **Config**, **Admin**, **Player**, **GM**, **Scenarios**.
3. Ve a **Server** (`/server`).
4. El indicador de estado dice **Stopped** — el motor aun no esta arrancado.
5. Pulsa **Start**.
6. Espera unos segundos. El indicador cambia a **Running** con un circulo verde.
7. Verifica: **PID**, **Port** (4000) y **Uptime** aparecen en el panel **Engine Status**.
8. El panel **Logs** empieza a mostrar lineas del motor.

### Puertos por defecto

| Servicio | Puerto | Cambiar con |
|---|---|---|
| Web SPA | 5173 (auto-incrementa si ocupado) | `vite.config.ts` → `server.port` |
| Launcher | 4010 | `SANDBOX_LAUNCHER_PORT` |
| Motor (engine) | 4000 | `SANDBOX_ENGINE_PORT` |

### Proxy mode

Por defecto, la SPA enruta todas las llamadas al motor a traves del launcher (`/engine/*`). Esto evita problemas de CORS y simplifica la configuracion.

En **Server** (`/server`), la seccion **Settings** tiene el checkbox **Proxy through launcher** activado. Dejalo activado salvo que necesites acceder al motor directamente.

---

## 3. Flujo A: Demo rapida con Scenario Runner

Este flujo usa el **Scenario Runner** (`/scenarios`) para ejecutar un flujo completo en un click.

### Paso 1: Abrir Scenario Runner

1. Ve a **Scenarios** (`/scenarios`) en la sidebar.
2. Pulsa **Load Demo Scenario** en la parte inferior de la sidebar izquierda.
3. Aparece el scenario "Demo: Full Flow" con 7 steps.

### Paso 2: Configurar variables

El demo usa variables para credenciales. Necesitas configurar dos valores:

1. **Admin API Key**: ve a **Admin** (`/admin`) > seccion **Connection** > campo **Admin API Key** e introduce la misma clave que usaste al arrancar (e.g. `mi-clave-admin`). El valor se guarda automaticamente en los settings globales.

2. Vuelve a **Scenarios** (`/scenarios`). En la barra superior del scenario, introduce la clave del actor en el campo **Actor key:** (e.g. `demo-secret-key` — esta sera la clave que el paso `CreateActor` asigna al actor).

Ahora las variables se resuelven asi:
- `${ADMIN_API_KEY}` = `mi-clave-admin` (desde Settings)
- `${ACTOR_API_KEY}` = `demo-secret-key` (desde el campo Actor key)
- `${GAME_INSTANCE_ID}` = `instance_001` (desde el campo Instance)

### Paso 3: Aplicar config y ejecutar

1. El scenario tiene **Config: sets** seleccionado. Pulsa **Apply Config + Restart**.
2. Espera al mensaje verde: "Config applied + engine restarting..."
3. Pulsa **Run All**.
4. Los 7 pasos se ejecutan secuencialmente:

| # | Tipo | Que hace |
|---|---|---|
| 1 | CreateActor | Crea actor `actor_demo` con apiKey `demo-secret-key` |
| 2 | CreatePlayer | Crea player `player_demo` |
| 3 | GrantResources | Da 500 xp + 200 gold al player |
| 4 | CreateCharacter | Crea character `hero_1` clase `warrior` |
| 5 | CreateGear | Crea gear `sword_1` (def: `sword_basic`) |
| 6 | EquipGear | Equipa `sword_1` en `hero_1` |
| 7 | LevelUpCharacter | Sube `hero_1` 2 niveles (consume recursos) |

5. La tabla **Results** muestra: **accepted** en verde, duracion en ms, stateVersion y delta (+1 por paso).

> Si un paso falla, la ejecucion se detiene (salvo que **Continue on fail** este activado). El **Error** columna muestra el errorCode.

### Paso 4: Ver el Runtime Context

Bajo los botones de accion aparece la tabla **Runtime Context** con los IDs capturados:

- `${LAST_PLAYER_ID}` = `player_demo`
- `${LAST_CHARACTER_ID}` = `hero_1`
- `${LAST_GEAR_ID}` = `sword_1`
- `${LAST_ACTOR_ID}` = `actor_demo`

Estos valores se usan automaticamente en los pasos 3-7 del demo (que referencian `${LAST_PLAYER_ID}`, etc.).

### Paso 5: Enviar IDs a Player y GM

1. Pulsa **Push to Player** — escribe playerId, characterId y gearId en la localStorage de `/player`.
2. Si quieres incluir la API key del actor, pulsa **+ with API key** debajo.
3. Pulsa **Open Player** — navega directamente a `/player` con los IDs ya cargados.
4. Pulsa **Push to GM** y luego **Open GM** — navega a `/gm` con el player seleccionado.

### Paso 6: Verificar en Player

1. En `/player`, el campo **Player ID** ya dice `player_demo`.
2. Pulsa **Refresh State** — se carga el estado del player.
3. En la columna **Characters**, click en `hero_1` — ves el slot grid y los stats.
4. En la columna **Gear**, click en `sword_1` — ves que esta equipado en `hero_1`.
5. El panel **Resources** muestra el saldo restante de xp y gold (tras el level up).

### Paso 7: Verificar en GM

1. En `/gm`, el player `player_demo` aparece en **Known Players**.
2. Click en `player_demo` — se carga el estado automaticamente.
3. El panel derecho muestra: **Resources** (tabla), contadores, y la lista de characters.
4. Click en `hero_1` — muestra level 3, class warrior, slots equipados y **Final Stats**.

---

## 4. Flujo B: Demo manual (sin Scenario Runner)

Este flujo recorre cada pagina individualmente, dando control total sobre cada paso.

### 4.1 Cargar config

1. Ve a **Config** (`/config`).
2. Pulsa el preset **sets** (en la seccion **Load Preset**).
3. El editor se llena con el JSON de `config_sets.json`.
4. Pulsa **Validate** — debe mostrar: "Valid GameConfig" en verde.
5. Pulsa **Save + Restart engine** — guarda la config y reinicia el motor.
6. Espera al mensaje verde: "Saved to ... Restart requested."

> Puedes tambien usar el tab **Visual** para editar clases, gear definitions y algoritmos graficamente. Los cambios se sincronizan con el tab **JSON** bidireccionalmente.

### 4.2 Crear actor y player (Admin)

1. Ve a **Admin** (`/admin`).
2. En el campo **Admin API Key**, introduce la misma clave de arranque (e.g. `mi-clave-admin`).

**Opcion rapida — Seed Demo:**

3. En la seccion **Seed Demo**, verifica los valores por defecto:
   - Actor ID: `actor_1`
   - Actor API Key: `my-player-key`
   - Player ID: `player_1`
4. Pulsa **Seed Demo**.
5. Los 3 pasos se ejecutan: CreateActor, CreatePlayer, GrantResources.
6. Al terminar: "All 3 steps OK. PlayerView inputs updated."
7. Los inputs de `/player` se actualizan automaticamente.

**Opcion manual:**

3. En la seccion **CreateActor**:
   - Actor ID: `actor_1`
   - Actor API Key: `my-player-key`
   - Pulsa **CreateActor**.
4. El panel **Result** muestra `accepted: true`.
5. En la seccion **GrantResources**:
   - Player ID: `player_1` (aun no existe, primero crea el player en `/player`)

> Para crear el player manualmente, ve a `/player` primero (seccion 4.3).

### 4.3 Player: crear characters, gear, equipar, stats, level up

1. Ve a **Player** (`/player`).
2. Si hiciste **Seed Demo**, los campos **Player ID** y **API Key** ya estan rellenos. Si no, introduce:
   - Player ID: `player_1`
   - API Key: `my-player-key` (la API key del actor que creo el player)

**Crear player (si no hiciste Seed):**

3. Pulsa **CreatePlayer** — crea el player `player_1`.
4. Pulsa **Refresh State** — carga el estado (vacio).
5. Pulsa **Reload Config** — carga las clases y gear definitions del motor para los dropdowns.

**Crear un character:**

6. En la columna **Characters**, seccion **Create Character**:
   - Selecciona una **Class** del dropdown (e.g. `warrior`).
   - Opcionalmente escribe un **Character ID** (si lo dejas vacio, se genera automaticamente).
   - Pulsa **Create**.
7. El character aparece en la lista. Click en el para seleccionarlo.
8. El **slot grid** muestra los slots del character (todos vacios, marcados "empty").
9. El panel **Stats** muestra los stats base de la clase warrior.

**Crear gear:**

10. En la columna **Gear**, seccion **Create Gear**:
    - Selecciona un **Gear Definition** del dropdown (e.g. `sword_basic`).
    - Opcionalmente escribe un **Gear ID**.
    - Pulsa **Create**.
11. El gear aparece en la lista.

**Equipar gear (modo strict):**

12. Click en el gear creado para seleccionarlo.
13. En la seccion **Equip / Unequip**:
    - El campo **Gear:** muestra el ID, **Def:** muestra la definition.
    - Si el gear tiene multiples patterns, selecciona uno en **Slot Pattern**.
    - Asegurate de que **Swap mode** esta **desactivado** (por defecto).
    - Pulsa **Equip**.
14. El slot grid se actualiza: el slot ocupado ahora muestra el nombre del gear.
15. Los stats se recalculan automaticamente (base clase + gear).

**Equipar con swap:**

16. Crea un segundo gear con el mismo slot (e.g. otro `sword_basic`).
17. Intenta equiparlo con **Swap mode** desactivado — recibiras error `SLOT_OCCUPIED` en el **Activity** feed.
18. Activa **Swap mode** (checkbox "(auto-unequip conflicting gear)").
19. Pulsa **Equip** de nuevo — el gear anterior se desequipa automaticamente y el nuevo queda equipado.

**Desequipar:**

20. Selecciona un gear equipado.
21. Pulsa **Unequip** — el gear se desequipa y el slot vuelve a "empty".

**Consultar stats:**

22. Con un character seleccionado, el panel **Stats** muestra `finalStats`.
23. Pulsa **Refresh Stats** para actualizar.
24. Los stats reflejan: base de clase (con growth por nivel) + stats de gear equipado + set bonuses (si aplica).

**Subir de nivel (level up):**

25. Selecciona un character. En la seccion **Progression**:
    - Muestra el nivel actual y "(MAX)" si ya esta al maximo.
    - Pulsa **Level Up Char** — sube 1 nivel.
26. Si la config tiene `levelCostCharacter` con algoritmo `linear_cost`, el level up consume recursos.
27. Si no hay recursos suficientes, el **Activity** feed muestra `INSUFFICIENT_RESOURCES`.
28. Para obtener recursos: ve a **Admin** > **GrantResources**, introduce el Player ID y un JSON de recursos (e.g. `{"xp": 500, "gold": 200}`), pulsa **GrantResources**.
29. Vuelve a `/player` — el panel **Resources** se actualiza automaticamente (auto-refresh detecta el cambio de stateVersion).
30. Intenta **Level Up Char** de nuevo — ahora funciona.

**Subir nivel de gear:**

31. Selecciona un gear y pulsa **Level Up Gear** — sube el nivel del gear.
32. Si el gear esta equipado, los stats del character se recalculan.

### 4.4 GM: inspeccionar

1. Ve a **GM** (`/gm`).
2. Pulsa **Import from /player** — importa el playerId y API key de la pagina `/player`.
3. El player aparece en **Known Players**. Click en el.
4. El panel derecho se carga automaticamente:
   - **Resources**: tabla con xp, gold, etc.
   - Contadores: **Characters** y **Gear** con totales.
   - Lista de characters con level y class.
5. Click en un character — muestra:
   - Level, Class.
   - Slots equipados (grid).
   - **Final Stats** calculados.
   - Pulsa **Refresh Stats** para actualizar.
6. Pulsa **JSON** para ver el estado crudo del player (raw JSON). Pulsa **Summary** para volver.
7. Con **Auto-refresh** activado (default ON), cualquier cambio desde `/player` o `/admin` se refleja en ~1.5 segundos.

**Tx Builder (operaciones desde GM):**

8. En la seccion **Tx Builder**, escribe un JSON de transaccion:

```json
{
  "type": "GrantResources",
  "playerId": "player_1",
  "resources": { "gold": 100 }
}
```

9. Pulsa **Send Tx** — los campos `txId` y `gameInstanceId` se auto-rellenan.
10. El resultado aparece debajo. El panel del player se refresca automaticamente.

---

## 5. Conceptos rapidos

### Actor vs Player vs Character vs Gear

| Concepto | Que es | Creado por |
|---|---|---|
| **Actor** | Identidad de autenticacion. Tiene un `actorId` y un `apiKey`. | `CreateActor` (requiere admin key) |
| **Player** | Propietario de characters y gear. Tiene un `playerId`. Pertenece a un actor. | `CreatePlayer` (requiere actor auth) |
| **Character** | Personaje jugable. Tiene clase, nivel, slots de equipamiento. | `CreateCharacter` |
| **Gear** | Pieza de equipo. Tiene una definition (`gearDefId`), nivel, y puede estar equipada en un character. | `CreateGear` |

Flujo de propiedad: Actor → Player → Characters + Gear.

### Equip: Strict vs Swap

- **Strict** (default, `swap: false`): si el slot ya esta ocupado, la operacion falla con `SLOT_OCCUPIED`.
- **Swap** (`swap: true`): desequipa automaticamente el gear conflictivo antes de equipar el nuevo. Si el gear desplazado ocupa multiples slots, todos se liberan.

### stateVersion y Auto-refresh

- Cada transaccion aceptada incrementa el `stateVersion` del game instance.
- Las paginas `/player` y `/gm` hacen polling de `stateVersion` cada 1-1.5 segundos.
- Si la version cambia (e.g. por un `GrantResources` desde `/admin`), la UI refresca automaticamente el estado.
- Si el motor no responde, el intervalo hace backoff a 3s y aparece el indicador **Disconnected**.

---

## 6. Troubleshooting

### 503 ENGINE_NOT_RUNNING

**Causa**: la SPA intenta llamar al motor via el proxy del launcher, pero el motor no esta arrancado.

**Solucion**:
1. Ve a **Server** (`/server`).
2. Verifica que el indicador dice **Stopped**.
3. Pulsa **Start**.
4. Espera a que cambie a **Running**.

### 502 ENGINE_UNREACHABLE

**Causa**: el launcher intenta contactar al motor pero no responde (crasheo, timeout de 10s).

**Solucion**:
1. Ve a **Server** > revisa los **Logs** para ver errores del motor.
2. Si el motor crasheo, pulsa **Restart**.
3. Si hay errores de config, ve a **Config**, corrige y pulsa **Save + Restart engine**.

### 401 Unauthorized (admin operations)

**Causa**: la admin key no esta configurada o no coincide.

**Solucion**:
1. Verifica que arrancaste el sandbox con `SANDBOX_ADMIN_API_KEY=...`.
2. En **Admin** (`/admin`) > seccion **Connection**, verifica que el campo **Admin API Key** contiene la misma clave que usaste al arrancar.
3. Si no configuraste la variable de entorno, para el sandbox, configurala, y arranca de nuevo.

### Config validation errors

**Causa**: el JSON de la config no cumple el schema de GameConfig.

**Solucion**:
1. En **Config** (`/config`), pulsa **Validate**.
2. La seccion **Validation** muestra los errores especificos con path y mensaje.
3. Corrige el JSON (o usa el tab **Visual** para editar graficamente).
4. Valida de nuevo hasta que diga "Valid GameConfig".

### SLOT_OCCUPIED al equipar

**Causa**: intentas equipar gear en un slot que ya tiene otro gear, con modo strict.

**Solucion**:
- Desequipa el gear existente primero (**Unequip**), o
- Activa **Swap mode** y vuelve a equipar.

### INSUFFICIENT_RESOURCES al subir de nivel

**Causa**: el player no tiene suficientes recursos para el coste de level up.

**Solucion**:
1. Ve a **Admin** (`/admin`).
2. En **GrantResources**, introduce el Player ID y los recursos necesarios (e.g. `{"xp": 500}`).
3. Pulsa **GrantResources**.
4. Vuelve a `/player` — los recursos se actualizan (auto-refresh).
5. Intenta el level up de nuevo.

### RESTRICTION_FAILED al equipar

**Causa**: el gear tiene restricciones de clase o nivel que no se cumplen.

**Solucion**:
- Verifica las restricciones del gear en la seccion **Restrictions** de `/player` (al seleccionar el gear).
- El character debe cumplir: clase en `allowedClasses` (o no en `blockedClasses`), nivel >= `requiredCharacterLevel`, y delta de nivel dentro de `maxLevelDelta`.

---

## 7. Reset del sandbox

Para limpiar todos los datos (configs, snapshots, logs) y empezar de cero:

```bash
npm run sandbox:reset
```

Esto borra el contenido de `sandbox/data/` (configs, snapshots, logs).

> Los datos de localStorage del navegador (scenarios, player inputs, GM registry) no se borran con este comando. Para limpiarlos, usa las DevTools del navegador (Application > Local Storage > Clear).

Despues del reset, vuelve a arrancar con `npm run sandbox`.

---

## Referencia rapida de transacciones

| Tipo | Admin | Campos clave |
|---|---|---|
| `CreateActor` | Si | `actorId`, `apiKey` |
| `GrantResources` | Si | `playerId`, `resources` |
| `CreatePlayer` | No | `playerId` |
| `CreateCharacter` | No | `playerId`, `characterId`, `classId` |
| `CreateGear` | No | `playerId`, `gearId`, `gearDefId` |
| `EquipGear` | No | `playerId`, `characterId`, `gearId`, `slotPattern?`, `swap?` |
| `UnequipGear` | No | `playerId`, `characterId`, `gearId` |
| `LevelUpCharacter` | No | `playerId`, `characterId`, `levels?` |
| `LevelUpGear` | No | `playerId`, `gearId`, `levels?` |

"Admin" = requiere `ADMIN_API_KEY` como Bearer token. El resto requiere la API key del actor propietario.

Todos los TX requieren `txId` (unico) y `gameInstanceId`. La UI los auto-rellena si estan vacios.
