# Client Tutorial — Implementing a Gameng HTTP Client

Tutorial paso a paso para implementar un cliente HTTP que interactue con el motor Gameng. Orientado a desarrolladores que construyen un cliente web (JS/TS), Unity (C#), CLI, o cualquier plataforma con soporte HTTP.

> **Source of truth:** Este tutorial esta basado en `openapi/openapi.yaml`, el codigo fuente (`src/routes/*`, `src/auth.ts`), y los tests E2E. Cada campo, endpoint y error code corresponde a lo implementado en el runtime actual.

---

## Tabla de contenidos

1. [Conceptos clave](#1-conceptos-clave)
2. [Preparacion del cliente](#2-preparacion-del-cliente)
3. [Flujo 0 — Verificar conectividad](#3-flujo-0--verificar-conectividad)
4. [Flujo 1 — Alta de cuenta (CreateActor)](#4-flujo-1--alta-de-cuenta-createactor)
5. [Flujo 2 — "Login" del player (API key)](#5-flujo-2--login-del-player-api-key)
6. [Flujo 3 — Crear Player](#6-flujo-3--crear-player)
7. [Flujo 4 — Crear Character(s)](#7-flujo-4--crear-characters)
8. [Flujo 5 — Crear Gear y gestionarlo](#8-flujo-5--crear-gear-y-gestionarlo)
9. [Flujo 6 — Gameplay: equipar / desequipar](#9-flujo-6--gameplay-equipar--desequipar)
10. [Flujo 7 — Gameplay: leer stats](#10-flujo-7--gameplay-leer-stats)
11. [Flujo 8 — Manejo de errores y UX cliente](#11-flujo-8--manejo-de-errores-y-ux-cliente)
12. [Checklist final](#12-checklist-final)

---

## 1. Conceptos clave

### 1.1. Game Instance (`gameInstanceId`)

Toda la API se organiza en torno a **instancias de juego**. El `gameInstanceId` aparece en la URL de todos los endpoints excepto `/health`:

```
POST /{gameInstanceId}/tx
GET  /{gameInstanceId}/state/player/{playerId}
GET  /{gameInstanceId}/character/{characterId}/stats
GET  /{gameInstanceId}/stateVersion
GET  /{gameInstanceId}/config
```

La instancia se crea implicitamente la primera vez que se envia una transaccion a un `gameInstanceId` nuevo. No existe un endpoint "CreateInstance" — el motor crea el estado vacio automaticamente.

### 1.2. Actor vs Player

El modelo de autenticacion separa dos conceptos:

| Concepto | Descripcion | Identificador |
|----------|-------------|---------------|
| **Actor** | Entidad que se autentica con una `apiKey`. Representa una sesion/cuenta. | `actorId` |
| **Player** | Entidad de juego que posee personajes, gear y recursos. | `playerId` |

Un Actor **posee** uno o mas Players. La relacion se crea al ejecutar `CreatePlayer` con el Bearer token del actor. Despues, todas las operaciones sobre ese player requieren el token del actor propietario.

```
Actor (apiKey) --owns--> Player --has--> Characters, Gear, Resources
```

### 1.3. Transaccion atomica

Todas las mutaciones de estado se hacen via `POST /:gameInstanceId/tx`. Cada transaccion es **atomica**: si falla alguna validacion, no se produce ninguna mutacion. No hay transacciones parciales.

La respuesta siempre es un `TransactionResult`:

```json
{
  "txId": "tx_001",
  "accepted": true,
  "stateVersion": 5
}
```

O cuando es rechazada:

```json
{
  "txId": "tx_002",
  "accepted": false,
  "stateVersion": 4,
  "errorCode": "PLAYER_NOT_FOUND",
  "errorMessage": "Player 'player_99' not found."
}
```

Puntos criticos:
- **`accepted: true`** = la mutacion se aplico. `stateVersion` incremento.
- **`accepted: false`** = rechazo de dominio. `stateVersion` no cambio. El HTTP status sigue siendo `200`.
- `stateVersion` es un contador monotonico creciente. Cada mutacion exitosa lo incrementa en 1.

### 1.4. stateVersion

`stateVersion` es un entero que el motor incrementa con cada transaccion aceptada. Sirve para:

1. **Polling ligero**: `GET /:gameInstanceId/stateVersion` devuelve solo `{ gameInstanceId, stateVersion }`. El cliente puede hacer polling a este endpoint y solo refrescar datos completos cuando el numero cambie.
2. **Validacion post-tx**: tras enviar una transaccion aceptada, el `stateVersion` en la respuesta confirma que el estado se actualizo.

### 1.5. ErrorResponse vs TransactionResult.errorCode

El motor usa dos formas de reportar errores:

| Tipo | HTTP Status | Cuerpo | Cuando |
|------|-------------|--------|--------|
| **ErrorResponse** | 400, 401, 403, 404, 500 | `{ errorCode, errorMessage }` | Errores de infraestructura (auth, request malformado, instancia no encontrada) |
| **TransactionResult** | 200 | `{ txId, accepted: false, stateVersion, errorCode, errorMessage }` | Rechazos de dominio (player no existe, slot ocupado, recursos insuficientes, etc.) |

**Regla para el cliente:** si `status !== 200`, parsea como `ErrorResponse`. Si `status === 200`, parsea como `TransactionResult` y chequea `accepted`.

---

## 2. Preparacion del cliente

### 2.1. Base URL

```
http://localhost:3000    # desarrollo local
http://host:PORT         # produccion (configurado via env PORT)
```

El motor no tiene prefijo (`/api/v1/...`). Todos los endpoints estan en la raiz.

### 2.2. Timeouts y retries

| Situacion | Timeout sugerido | Reintentar? |
|-----------|-----------------|-------------|
| Transacciones (`POST /tx`) | 10-30s | **Solo si** usas idempotencia (mismo `txId`). Ver seccion 2.3. |
| Lecturas (`GET /state/...`) | 5-10s | Si, con backoff exponencial. |
| Health check | 3-5s | Si, rapido (es no-op). |

**Cuando NO reintentar transacciones:**
- Si la respuesta es `accepted: false` (el motor proceso correctamente, la logica de dominio rechazo).
- Si el status es `400 INSTANCE_MISMATCH` (body malformado, no va a cambiar).
- Si el status es `401 UNAUTHORIZED` (credenciales incorrectas).

**Cuando SI reintentar:**
- Timeout de red (no llego respuesta).
- Error 5xx (error de servidor transitorio).
- **Siempre con el mismo `txId`** para que la idempotencia proteja contra duplicados.

### 2.3. Idempotencia (`txId`)

Cada transaccion lleva un campo `txId` (string no-vacio, formato libre). El motor mantiene un cache FIFO por instancia (default 1000 entradas, configurable via `GAMENG_MAX_IDEMPOTENCY_ENTRIES`).

**Comportamiento:**
- Si envias un `txId` que ya fue procesado, el motor devuelve **exactamente la misma respuesta** (mismo HTTP status y body) sin re-ejecutar la mutacion.
- Esto incluye **todos** los status: 200, 401, 500, etc.
- Si el `txId` fue eviccionado del cache FIFO (porque se procesaron >1000 txs nuevas), se re-procesa como nueva.
- Un mismo `txId` en instancias diferentes son independientes.
- **Excepciones:** las respuestas `404 INSTANCE_NOT_FOUND` y `400 INSTANCE_MISMATCH` **no se cachean** porque ocurren antes del checkpoint de idempotencia (la instancia debe existir para tener cache, y el body debe ser parseable). Un retry que corrija estos errores se procesara normalmente.

**Recomendacion de generacion de txId:**

```javascript
// JS — UUID v4
const txId = crypto.randomUUID();

// JS — Prefijo + timestamp (mas legible para debug)
const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
```

```csharp
// C# — GUID
string txId = Guid.NewGuid().ToString();
```

**Patron de retry seguro:**

```javascript
async function safeTx(baseUrl, apiKey, payload, maxRetries = 3) {
  // txId se genera UNA vez — los retries reusan el mismo
  const txId = payload.txId || crypto.randomUUID();
  payload.txId = txId;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/${payload.gameInstanceId}/tx`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      return await res.json();
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}
```

### 2.4. Headers

Todas las requests deben incluir:

```
Content-Type: application/json
```

Las requests autenticadas ademas incluyen:

```
Authorization: Bearer <apiKey>
```

Donde `<apiKey>` es:
- La **ADMIN_API_KEY** del servidor para operaciones admin (`CreateActor`, `GrantResources`, `GrantCharacterResources`).
- La **apiKey del actor** (obtenida via `CreateActor`) para todas las demas operaciones.

### 2.5. Almacenamiento seguro de la apiKey

#### Web (browser)

| Metodo | Pros | Contras |
|--------|------|---------|
| `localStorage` | Simple, persiste | Accesible via XSS |
| Variable en memoria | No persiste en pestanas | Se pierde al recargar |
| `sessionStorage` | Se borra al cerrar pestana | No comparte entre pestanas |
| Cookie `httpOnly` + `Secure` | Inaccesible via JS | Requiere backend intermedio |

**Recomendacion para prototipos:** `sessionStorage` (equilibrio entre persistencia y seguridad). Para produccion con datos sensibles: cookie `httpOnly` via un BFF (Backend For Frontend).

#### Unity (C#)

```csharp
// NO usar PlayerPrefs en claro para secretos.
// Opcion 1: Almacenar cifrado con DataProtectionScope.CurrentUser
byte[] encrypted = ProtectedData.Protect(
    Encoding.UTF8.GetBytes(apiKey),
    null, DataProtectionScope.CurrentUser);
File.WriteAllBytes(keyPath, encrypted);

// Opcion 2: Solo mantener en memoria durante la sesion
private string _apiKey; // se pierde al cerrar el juego
```

#### CLI

```bash
# Variable de entorno (no se loggea en historial de comandos)
export GAMENG_API_KEY="mi-token-secreto"

# O fichero .env (excluido de git via .gitignore)
echo "GAMENG_API_KEY=mi-token-secreto" > .env
```

**Regla universal:** nunca loggear, imprimir ni serializar la apiKey en logs de produccion.

---

## 3. Flujo 0 — Verificar conectividad

**Endpoint:** `GET /health` (sin autenticacion, sin gameInstanceId)

### curl

```bash
curl http://localhost:3000/health
```

### Respuesta (200 OK)

```json
{
  "status": "ok",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "uptime": 42.5
}
```

### JS

```javascript
async function checkHealth(baseUrl) {
  const res = await fetch(`${baseUrl}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  const data = await res.json();
  console.log(`Server OK — uptime: ${data.uptime}s`);
  return data;
}
```

### Unity (C#)

```csharp
IEnumerator CheckHealth(string baseUrl) {
    using var req = UnityWebRequest.Get($"{baseUrl}/health");
    yield return req.SendWebRequest();
    if (req.result == UnityWebRequest.Result.Success) {
        var json = JsonUtility.FromJson<HealthResponse>(req.downloadHandler.text);
        Debug.Log($"Server OK — uptime: {json.uptime}s");
    } else {
        Debug.LogError($"Health check failed: {req.error}");
    }
}

[System.Serializable]
public class HealthResponse {
    public string status;
    public string timestamp;
    public float uptime;
}
```

### Que puede salir mal

| Problema | Causa probable | Accion |
|----------|---------------|--------|
| Timeout / connection refused | Servidor no arrancado | Verificar que el proceso esta corriendo |
| `ERR_CONNECTION_REFUSED` en browser | CORS si el cliente esta en otro origin | Usar el proxy del launcher o configurar CORS |

---

## 4. Flujo 1 — Alta de cuenta (CreateActor)

`CreateActor` registra un actor en el sistema de autenticacion y le asigna una `apiKey`. Esta apiKey sera el Bearer token para todas las operaciones posteriores del actor.

**Endpoint:** `POST /:gameInstanceId/tx`
**Autenticacion:** Bearer token con la **ADMIN_API_KEY del servidor**.

> `ADMIN_API_KEY` **siempre es obligatoria**. Si el servidor no tiene configurada una ADMIN_API_KEY (variable de entorno `ADMIN_API_KEY`), CreateActor devuelve 401. No hay modo anonimo.

### 4.1. Campos requeridos

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `txId` | string | Identificador unico de la transaccion |
| `type` | `"CreateActor"` | Tipo de transaccion |
| `gameInstanceId` | string | Debe coincidir con el path |
| `actorId` | string | Identificador unico del actor |
| `apiKey` | string | Token que el actor usara para autenticarse en futuras operaciones |

> **Atencion:** el campo `apiKey` en el body es la clave que se **asigna** al nuevo actor. NO es la credencial de autenticacion de esta request. La autenticacion de CreateActor va en el header `Authorization`.

### 4.2. curl

```bash
curl -X POST http://localhost:3000/instance_001/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer MI-ADMIN-KEY" \
  -d '{
    "txId": "tx_actor_001",
    "type": "CreateActor",
    "gameInstanceId": "instance_001",
    "actorId": "actor_1",
    "apiKey": "mi-token-secreto"
  }'
```

### 4.3. JS

```javascript
async function createActor(baseUrl, adminKey, gameInstanceId, actorId, actorApiKey) {
  const res = await fetch(`${baseUrl}/${gameInstanceId}/tx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${adminKey}`,
    },
    body: JSON.stringify({
      txId: crypto.randomUUID(),
      type: "CreateActor",
      gameInstanceId,
      actorId,
      apiKey: actorApiKey,
    }),
  });

  if (res.status === 401) {
    throw new Error("Admin API key invalida o no configurada en el servidor.");
  }

  const result = await res.json();

  if (!result.accepted) {
    // ALREADY_EXISTS o DUPLICATE_API_KEY
    throw new Error(`CreateActor rechazado: ${result.errorCode} — ${result.errorMessage}`);
  }

  return result; // { txId, accepted: true, stateVersion }
}
```

### 4.4. Unity (C#)

```csharp
IEnumerator CreateActor(string baseUrl, string adminKey, string gameInstanceId,
                         string actorId, string actorApiKey) {
    var body = JsonUtility.ToJson(new CreateActorPayload {
        txId   = System.Guid.NewGuid().ToString(),
        type   = "CreateActor",
        gameInstanceId = gameInstanceId,
        actorId = actorId,
        apiKey  = actorApiKey,
    });

    using var req = new UnityWebRequest($"{baseUrl}/{gameInstanceId}/tx", "POST");
    req.uploadHandler   = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
    req.downloadHandler = new DownloadHandlerBuffer();
    req.SetRequestHeader("Content-Type", "application/json");
    req.SetRequestHeader("Authorization", $"Bearer {adminKey}");

    yield return req.SendWebRequest();

    if (req.responseCode == 401) {
        Debug.LogError("Admin key invalida.");
        yield break;
    }

    var result = JsonUtility.FromJson<TxResult>(req.downloadHandler.text);
    if (result.accepted) {
        Debug.Log($"Actor creado. stateVersion={result.stateVersion}");
        // Guardar actorApiKey para uso posterior
    } else {
        Debug.LogWarning($"Rechazado: {result.errorCode}");
    }
}
```

### 4.5. Respuestas posibles

| HTTP | accepted | errorCode | Causa |
|------|----------|-----------|-------|
| 200 | `true` | — | Actor creado correctamente |
| 200 | `false` | `ALREADY_EXISTS` | Ya existe un actor con ese `actorId` |
| 200 | `false` | `DUPLICATE_API_KEY` | Otro actor ya usa esa `apiKey` |
| 401 | — | `UNAUTHORIZED` | ADMIN_API_KEY falta, invalida, o no configurada en el servidor |
| 400 | — | `INSTANCE_MISMATCH` | El `gameInstanceId` del body no coincide con la URL |

### 4.6. Que puede salir mal

- **401 sin haber configurado ADMIN_API_KEY en el servidor**: el motor requiere que la variable de entorno `ADMIN_API_KEY` este configurada. Sin ella, toda operacion admin falla.
- **DUPLICATE_API_KEY**: cada actor debe tener una apiKey unica. Si generas las keys en el cliente, usa UUIDs para evitar colisiones.

---

## 5. Flujo 2 — "Login" del player (API key)

### 5.1. Que significa "login" aqui

Gameng **no tiene sesiones**. No hay endpoint de login/logout. El "login" consiste en que el cliente ya posee una `apiKey` (obtenida via CreateActor) y la envia como Bearer token en cada request.

```
Authorization: Bearer mi-token-secreto
```

Esto es equivalente a una API key estatica. Mientras el token sea valido (exista un actor con esa apiKey en el estado de la instancia), el cliente esta "loggeado".

### 5.2. Validar que la key funciona

No existe un endpoint dedicado tipo `GET /me` o `GET /whoami`. Para verificar que la apiKey es valida sin causar efectos secundarios, usa una de estas opciones:

**Opcion A — GET stateVersion (no requiere auth):**

```bash
curl http://localhost:3000/instance_001/stateVersion
```

Esto confirma que el servidor responde y la instancia existe, pero **no valida la apiKey**. Util como health check de la instancia.

**Opcion B — GET player state (requiere auth + ownership):**

Si ya conoces tu `playerId`:

```bash
curl http://localhost:3000/instance_001/state/player/player_1 \
  -H "Authorization: Bearer mi-token-secreto"
```

- `200` = key valida + ownership correcto + player existe.
- `401` = key invalida o faltante.
- `403 OWNERSHIP_VIOLATION` = key valida pero no posees ese player.
- `404 PLAYER_NOT_FOUND` = player no existe (solo si el actor es su propietario).

> **Nota de implementacion:** el motor valida ownership **antes** de existencia del player. Si intentas leer un player que no existe y que ademas no esta en tu lista de ownership, recibes `403` (no `404`). Esto es una consecuencia del modelo de seguridad: un `404` filtraria informacion sobre la existencia de players ajenos.

**Recomendacion:** en el cliente, tras obtener la apiKey, haz un `GET /state/player/{myPlayerId}` como "login check". Si devuelve 200, muestra la pantalla de juego. Si 401, pide re-autenticacion.

### 5.3. Buenas practicas

- **No loggear el token**: filtrar `Authorization` de cualquier log de debug.
- **Rotacion**: no hay rotacion automatica. Para rotar, el admin crea un nuevo actor (con nueva apiKey) y migra la asociacion de players manualmente. En la version actual no hay endpoint para cambiar la apiKey de un actor existente.
- **Manejo de 401**: si una request autenticada devuelve 401, limpiar la apiKey almacenada y redirigir al usuario a pantalla de re-autenticacion. No reintentar automaticamente.

---

## 6. Flujo 3 — Crear Player

`CreatePlayer` crea un player vacio y lo asocia al actor autenticado. A partir de este momento, solo ese actor puede operar sobre este player.

**Endpoint:** `POST /:gameInstanceId/tx`
**Autenticacion:** Bearer token del **actor** (no del admin).

### 6.1. Campos requeridos

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `txId` | string | Identificador unico de la transaccion |
| `type` | `"CreatePlayer"` | Tipo de transaccion |
| `gameInstanceId` | string | Debe coincidir con el path |
| `playerId` | string | Identificador unico del player |

### 6.2. curl

```bash
curl -X POST http://localhost:3000/instance_001/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mi-token-secreto" \
  -d '{
    "txId": "tx_player_001",
    "type": "CreatePlayer",
    "gameInstanceId": "instance_001",
    "playerId": "player_1"
  }'
```

### 6.3. JS

```javascript
async function createPlayer(baseUrl, apiKey, gameInstanceId, playerId) {
  const res = await fetch(`${baseUrl}/${gameInstanceId}/tx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      txId: crypto.randomUUID(),
      type: "CreatePlayer",
      gameInstanceId,
      playerId,
    }),
  });

  if (res.status === 401) throw new Error("Token invalido.");

  const result = await res.json();
  if (!result.accepted) {
    throw new Error(`CreatePlayer rechazado: ${result.errorCode}`);
  }
  return result;
}
```

### 6.4. Ownership

- `CreatePlayer` requiere auth pero **no** chequea ownership (el player aun no existe).
- El actor que ejecuta `CreatePlayer` queda como propietario permanente de ese player.
- Un actor puede poseer multiples players.
- No existe endpoint para transferir ownership.

### 6.5. Estado inicial del player

Tras CreatePlayer, el estado del player es:

```json
{
  "characters": {},
  "gear": {},
  "resources": {}
}
```

### 6.6. Respuestas posibles

| HTTP | accepted | errorCode | Causa |
|------|----------|-----------|-------|
| 200 | `true` | — | Player creado |
| 200 | `false` | `ALREADY_EXISTS` | Ya existe un player con ese `playerId` |
| 401 | — | `UNAUTHORIZED` | Token invalido o faltante |

---

## 7. Flujo 4 — Crear Character(s)

`CreateCharacter` crea un personaje nivel 1 de la clase indicada, dentro de un player existente.

**Endpoint:** `POST /:gameInstanceId/tx`
**Autenticacion:** Bearer token del actor propietario del player.

### 7.1. Campos requeridos

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `txId` | string | Identificador unico de la transaccion |
| `type` | `"CreateCharacter"` | Tipo de transaccion |
| `gameInstanceId` | string | Debe coincidir con el path |
| `playerId` | string | Player propietario |
| `characterId` | string | Identificador unico del personaje |
| `classId` | string | Clase del personaje (debe existir en la config) |

### 7.2. Descubrir classIds validos

Usa `GET /:gameInstanceId/config` para leer la config activa. El campo `classes` contiene un mapa de `classId` a definicion:

```bash
curl http://localhost:3000/instance_001/config
```

```json
{
  "classes": {
    "warrior": { "baseStats": { "strength": 5, "hp": 20 } }
  },
  ...
}
```

En el cliente, extrae las keys de `config.classes`:

```javascript
const config = await (await fetch(`${baseUrl}/${instanceId}/config`)).json();
const validClasses = Object.keys(config.classes);
// ["warrior"]
```

> `GET /config` no requiere autenticacion.

### 7.3. curl

```bash
curl -X POST http://localhost:3000/instance_001/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mi-token-secreto" \
  -d '{
    "txId": "tx_char_001",
    "type": "CreateCharacter",
    "gameInstanceId": "instance_001",
    "playerId": "player_1",
    "characterId": "warrior_1",
    "classId": "warrior"
  }'
```

### 7.4. JS

```javascript
async function createCharacter(baseUrl, apiKey, gameInstanceId, playerId, characterId, classId) {
  const res = await fetch(`${baseUrl}/${gameInstanceId}/tx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      txId: crypto.randomUUID(),
      type: "CreateCharacter",
      gameInstanceId,
      playerId,
      characterId,
      classId,
    }),
  });
  return await res.json();
}
```

### 7.5. Verificar con GET player state

```bash
curl http://localhost:3000/instance_001/state/player/player_1 \
  -H "Authorization: Bearer mi-token-secreto"
```

```json
{
  "characters": {
    "warrior_1": {
      "classId": "warrior",
      "level": 1,
      "equipped": {},
      "resources": {}
    }
  },
  "gear": {},
  "resources": {}
}
```

### 7.6. Respuestas posibles

| HTTP | accepted | errorCode | Causa |
|------|----------|-----------|-------|
| 200 | `true` | — | Personaje creado |
| 200 | `false` | `ALREADY_EXISTS` | Ya existe un personaje con ese `characterId` |
| 200 | `false` | `PLAYER_NOT_FOUND` | El `playerId` no existe |
| 200 | `false` | `INVALID_CONFIG_REFERENCE` | El `classId` no existe en la config |
| 200 | `false` | `OWNERSHIP_VIOLATION` | El actor no posee ese player |
| 401 | — | `UNAUTHORIZED` | Token invalido |

---

## 8. Flujo 5 — Crear Gear y gestionarlo

### 8.1. CreateGear

Crea una instancia de gear nivel 1 en el inventario del player. El gear queda sin equipar (`equippedBy: null`).

**Campos requeridos:**

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `txId` | string | Identificador unico |
| `type` | `"CreateGear"` | Tipo de transaccion |
| `gameInstanceId` | string | Debe coincidir con el path |
| `playerId` | string | Player propietario |
| `gearId` | string | Identificador unico de esta instancia de gear |
| `gearDefId` | string | Referencia al gearDef en la config |

### 8.2. Descubrir gearDefIds validos

Igual que con las clases, usa `GET /:gameInstanceId/config`:

```javascript
const config = await (await fetch(`${baseUrl}/${instanceId}/config`)).json();
const gearDefs = Object.keys(config.gearDefs);
// ["sword_basic", "greatsword", "versatile_sword", "elite_sword", ...]

// Para ver los slots de cada gear:
for (const [id, def] of Object.entries(config.gearDefs)) {
  console.log(`${id}: patterns=${JSON.stringify(def.equipPatterns)}`);
}
```

### 8.3. curl

```bash
curl -X POST http://localhost:3000/instance_001/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mi-token-secreto" \
  -d '{
    "txId": "tx_gear_001",
    "type": "CreateGear",
    "gameInstanceId": "instance_001",
    "playerId": "player_1",
    "gearId": "sword_1",
    "gearDefId": "sword_basic"
  }'
```

### 8.4. Inventario: como se ve en GET player state

Tras crear gear, aparece en `player.gear`:

```json
{
  "characters": { ... },
  "gear": {
    "sword_1": {
      "gearDefId": "sword_basic",
      "level": 1
    }
  },
  "resources": {}
}
```

Cuando un gear esta equipado, tiene el campo `equippedBy`:

```json
{
  "sword_1": {
    "gearDefId": "sword_basic",
    "level": 1,
    "equippedBy": "warrior_1"
  }
}
```

### 8.5. Respuestas posibles (CreateGear)

| HTTP | accepted | errorCode | Causa |
|------|----------|-----------|-------|
| 200 | `true` | — | Gear creado |
| 200 | `false` | `ALREADY_EXISTS` | Ya existe gear con ese `gearId` |
| 200 | `false` | `PLAYER_NOT_FOUND` | El player no existe |
| 200 | `false` | `INVALID_CONFIG_REFERENCE` | El `gearDefId` no existe en la config |
| 200 | `false` | `OWNERSHIP_VIOLATION` | El actor no posee ese player |
| 401 | — | `UNAUTHORIZED` | Token invalido |

---

## 9. Flujo 6 — Gameplay: equipar / desequipar

### 9.1. EquipGear

Equipa un gear en un personaje. El motor valida restricciones de clase, nivel, slots y patron.

**Campos:**

| Campo | Tipo | Requerido | Descripcion |
|-------|------|-----------|-------------|
| `txId` | string | Si | Identificador unico |
| `type` | `"EquipGear"` | Si | Tipo |
| `gameInstanceId` | string | Si | Debe coincidir con path |
| `playerId` | string | Si | Player propietario |
| `characterId` | string | Si | Personaje destino |
| `gearId` | string | Si | Gear a equipar |
| `slotPattern` | string[] | No | Patron de slots a usar |
| `swap` | boolean | No | Si `true`, modo swap (auto-desequipa conflictos) |

### 9.2. Resolucion de slotPattern

Cada gearDef tiene uno o mas `equipPatterns` (arrays de slotIds):

```json
// sword_basic: un solo patron, 1 slot -> auto-resolucion
"equipPatterns": [["right_hand"]]

// greatsword: un solo patron, 2 slots -> auto-resolucion
"equipPatterns": [["right_hand", "off_hand"]]

// versatile_sword: DOS patrones -> requiere slotPattern explicito
"equipPatterns": [["right_hand"], ["off_hand"]]
```

**Reglas:**
- Si el gearDef tiene **exactamente 1** equipPattern: se auto-selecciona (no necesitas enviar `slotPattern`).
- Si el gearDef tiene **0** equipPatterns: error `SLOT_INCOMPATIBLE`.
- Si el gearDef tiene **2+** equipPatterns: debes enviar `slotPattern` para desambiguar. Si no lo envias: error `SLOT_INCOMPATIBLE` con mensaje "provide slotPattern to disambiguate".

### 9.3. Ejemplo: equip 1-slot (auto-resolucion)

```bash
curl -X POST http://localhost:3000/instance_001/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mi-token-secreto" \
  -d '{
    "txId": "tx_equip_001",
    "type": "EquipGear",
    "gameInstanceId": "instance_001",
    "playerId": "player_1",
    "characterId": "warrior_1",
    "gearId": "sword_1"
  }'
```

El motor auto-resuelve `["right_hand"]` porque `sword_basic` tiene un unico patron.

### 9.4. Ejemplo: equip con multiples patrones (requiere slotPattern)

```bash
curl -X POST http://localhost:3000/instance_001/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mi-token-secreto" \
  -d '{
    "txId": "tx_equip_002",
    "type": "EquipGear",
    "gameInstanceId": "instance_001",
    "playerId": "player_1",
    "characterId": "warrior_1",
    "gearId": "versatile_1",
    "slotPattern": ["off_hand"]
  }'
```

### 9.5. Ejemplo: equip multi-slot (2 slots)

```bash
curl -X POST http://localhost:3000/instance_001/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mi-token-secreto" \
  -d '{
    "txId": "tx_equip_003",
    "type": "EquipGear",
    "gameInstanceId": "instance_001",
    "playerId": "player_1",
    "characterId": "warrior_1",
    "gearId": "greatsword_1",
    "slotPattern": ["right_hand", "off_hand"]
  }'
```

Ambos slots se ocupan atomicamente. Los stats del gear se cuentan una sola vez (no se duplican por ocupar 2 slots).

### 9.6. Modo swap (`swap: true`)

En modo strict (default), si un slot ya esta ocupado, la tx falla con `SLOT_OCCUPIED`. Con `swap: true`, el gear que ocupa el slot conflictivo se desequipa automaticamente antes de equipar el nuevo:

```json
{
  "txId": "tx_equip_swap",
  "type": "EquipGear",
  "gameInstanceId": "instance_001",
  "playerId": "player_1",
  "characterId": "warrior_1",
  "gearId": "axe_1",
  "swap": true
}
```

Si el gear desplazado ocupaba multiples slots (ej: greatsword en `right_hand` + `off_hand`), **todos** sus slots se liberan (no solo el conflictivo).

### 9.7. Restricciones de equipo

El motor valida restricciones definidas en `gearDef.restrictions` **antes** de resolver slots. El orden es:

1. `allowedClasses` — si presente, el `classId` del personaje debe estar en la lista.
2. `blockedClasses` — si presente, el `classId` del personaje NO debe estar en la lista.
3. `requiredCharacterLevel` — el nivel del personaje debe ser >= al valor.
4. `maxLevelDelta` — el nivel del gear debe ser <= nivel del personaje + delta.

Todas fallan con `RESTRICTION_FAILED` y un `errorMessage` descriptivo.

### 9.8. UnequipGear

**Campos:**

| Campo | Tipo | Requerido | Descripcion |
|-------|------|-----------|-------------|
| `txId` | string | Si | Identificador unico |
| `type` | `"UnequipGear"` | Si | Tipo |
| `gameInstanceId` | string | Si | Debe coincidir con path |
| `playerId` | string | Si | Player propietario |
| `gearId` | string | Si | Gear a desequipar |
| `characterId` | string | No | Hint opcional (el motor lo valida si se envia) |

```bash
curl -X POST http://localhost:3000/instance_001/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mi-token-secreto" \
  -d '{
    "txId": "tx_unequip_001",
    "type": "UnequipGear",
    "gameInstanceId": "instance_001",
    "playerId": "player_1",
    "gearId": "sword_1"
  }'
```

Si el gear ocupa multiples slots, todos se liberan.

### 9.9. Errores de equipo — referencia rapida

| errorCode | Trigger | Accion del cliente |
|-----------|---------|-------------------|
| `GEAR_ALREADY_EQUIPPED` | El gear ya esta en un personaje | Desequipar primero o usar otro gear |
| `GEAR_NOT_EQUIPPED` | Intentar desequipar un gear que no esta equipado | Refrescar estado |
| `SLOT_OCCUPIED` | Slot ocupado (modo strict) | Desequipar gear previo o usar `swap: true` |
| `SLOT_INCOMPATIBLE` | Patron no coincide con gearDef / multiples patrones sin `slotPattern` | Enviar `slotPattern` correcto |
| `INVALID_SLOT` | El slotId no existe en la config | Verificar `config.slots` |
| `RESTRICTION_FAILED` | Clase no permitida, nivel insuficiente, o level delta excedido | Mostrar al usuario que no cumple los requisitos |
| `CHARACTER_MISMATCH` | `characterId` en UnequipGear no coincide con `equippedBy` | Omitir `characterId` o corregirlo |

> Referencia completa: [`docs/ERROR_CODES.md`](ERROR_CODES.md)

---

## 10. Flujo 7 — Gameplay: leer stats

### 10.1. Endpoint

```
GET /:gameInstanceId/character/:characterId/stats
Authorization: Bearer <apiKey>
```

> Requiere autenticacion y ownership del player que posee el personaje.

### 10.2. curl

```bash
curl http://localhost:3000/instance_001/character/warrior_1/stats \
  -H "Authorization: Bearer mi-token-secreto"
```

### 10.3. Respuesta

```json
{
  "characterId": "warrior_1",
  "classId": "warrior",
  "level": 1,
  "finalStats": {
    "strength": 8,
    "hp": 20
  }
}
```

### 10.4. Formula de calculo de finalStats

El motor calcula los stats en 5 pasos (fuente: `src/routes/stats.ts`):

```
Paso 1-2: classScaled = growth(classBaseStats, characterLevel)
Paso 3:   gearStats   = SUM(growth(gearDef.baseStats, gearLevel))  // por gear equipado, dedup multi-slot
Paso 4:   setBonus    = SUM(bonusStats donde piecesEquipped >= threshold)  // flat, no scaled
Paso 5:   clamp(stat, min, max)  // si config.statClamps define limites

finalStats = classScaled + gearStats + setBonus, luego clamp
```

**Detalle de cada paso:**

**Paso 1-2 — Stats base de clase escalados por nivel:**
- Se leen los `baseStats` de la clase del personaje.
- Se aplica el algoritmo de growth configurado en `config.algorithms.growth`.
- Algoritmos disponibles:
  - `flat`: `floor(base)` — sin escalado.
  - `linear`: `floor(base * (1 + perLevelMultiplier * (level-1)) + additivePerLevel[stat] * (level-1))`.
  - `exponential`: `floor(base * exponent^(level-1))`.
- A nivel 1, todos los algoritmos retornan exactamente `baseStats`.

**Paso 3 — Stats de gear escalados por nivel de gear:**
- Para cada gear equipado en el personaje, se leen `gearDef.baseStats` y se aplica el mismo algoritmo de growth con el `gearLevel`.
- Gear multi-slot se cuenta **una sola vez** (deduplicacion por gearId).

**Paso 4 — Bonuses de set:**
- Se cuentan las piezas equipadas de cada set (usando `gearDef.setPieceCount`, default 1).
- Para cada set, se activan **todos** los bonuses cuyo umbral (`pieces`) sea <= al numero de piezas equipadas.
- Los bonuses de set se aplican **flat** (sin growth scaling).

**Paso 5 — Clamps:**
- Si `config.statClamps` define min/max para un stat, se aplica como ultimo paso.
- Ejemplo: `"statClamps": { "hp": { "min": 0 }, "crit_chance": { "max": 1.0 } }`.

### 10.5. Ejemplo antes/despues de equipar

**Sin gear equipado** (config_minimal, level 1, warrior):
```json
{ "strength": 5, "hp": 20 }
```

**Con `sword_basic` equipado** (baseStats: `{ strength: 3 }`):
```json
{ "strength": 8, "hp": 20 }
```

**Con `sword_basic` + growth lineal a nivel 3** (`perLevelMultiplier: 0.1`, `additivePerLevel: { hp: 1 }`):
```
classScaled.strength = floor(5 * (1 + 0.1 * 2)) = floor(6) = 6
classScaled.hp       = floor(20 * (1 + 0.1 * 2) + 1 * 2) = floor(26) = 26
gearScaled.strength  = floor(3 * (1 + 0.1 * 0)) = 3  // gear level 1
finalStats = { strength: 6 + 3 = 9, hp: 26 + 0 = 26 }
```

### 10.6. Cache en el cliente

Los stats son **read-time computed** (no almacenados en state). Cada GET los recalcula. Recomendaciones:

- **Cache local**: cachear `finalStats` indexado por `(characterId, stateVersion)`. Invalidar cuando `stateVersion` cambie.
- **Polling**: usar `GET /stateVersion` (sin auth, ligero) para detectar cambios. Solo refrescar stats cuando el version increment.
- **Post-tx**: tras un EquipGear, UnequipGear, o LevelUp exitoso, refrescar stats inmediatamente (el `stateVersion` en la respuesta confirma que cambio).

### 10.7. Respuestas posibles

| HTTP | errorCode | Causa |
|------|-----------|-------|
| 200 | — | Stats calculados correctamente |
| 401 | `UNAUTHORIZED` | Token invalido |
| 403 | `OWNERSHIP_VIOLATION` | El actor no posee el player de este personaje |
| 404 | `CHARACTER_NOT_FOUND` | El personaje no existe |
| 404 | `INSTANCE_NOT_FOUND` | La instancia no existe |
| 500 | `INVALID_CONFIG_REFERENCE` | Algoritmo de growth desconocido o params malformados |

---

## 11. Flujo 8 — Manejo de errores y UX cliente

### 11.1. Distinguir errores HTTP vs rechazos de dominio

```javascript
async function handleTxResponse(res) {
  const body = await res.json();

  if (res.status !== 200) {
    // Error de infraestructura — body es { errorCode, errorMessage }
    switch (res.status) {
      case 401:
        // Credenciales invalidas — redirigir a login
        return { type: "auth_error", ...body };
      case 403:
        // Ownership violation — no eres dueño de este player
        return { type: "forbidden", ...body };
      case 404:
        // Instancia o player no encontrado
        return { type: "not_found", ...body };
      case 400:
        // Request malformado (body invalido, instance mismatch)
        return { type: "bad_request", ...body };
      default:
        return { type: "server_error", ...body };
    }
  }

  // HTTP 200 — la tx fue procesada. Chequear accepted.
  if (body.accepted) {
    return { type: "success", ...body };
  } else {
    // Rechazo de dominio — body es { txId, accepted, stateVersion, errorCode, errorMessage }
    return { type: "domain_rejection", ...body };
  }
}
```

### 11.2. Tabla: errorCode -> accion recomendada en cliente

#### Errores HTTP (no reintentar automaticamente)

| errorCode | HTTP | Reintentar? | Accion en cliente |
|-----------|------|-------------|-------------------|
| `UNAUTHORIZED` | 401 | No | Limpiar apiKey, redirigir a pantalla de auth |
| `OWNERSHIP_VIOLATION` | 403 | No | Mostrar "No tienes acceso a este player" |
| `INSTANCE_NOT_FOUND` | 404 | No | Verificar gameInstanceId. Puede requerir enviar una tx primero para crear la instancia |
| `PLAYER_NOT_FOUND` | 404 | No | El player no existe (en GET). Crear primero |
| `CHARACTER_NOT_FOUND` | 404 | No | El personaje no existe (en GET stats) |
| `INSTANCE_MISMATCH` | 400 | No | Bug del cliente: gameInstanceId en body no coincide con URL. Corregir |
| `CONFIG_NOT_FOUND` | 500 | No | Error del servidor. Reportar al admin |
| `INVALID_CONFIG_REFERENCE` | 500 | No | Config corrupta. Reportar al admin |

#### Rechazos de dominio (HTTP 200, accepted: false)

| errorCode | Reintentar? | Accion en cliente |
|-----------|-------------|-------------------|
| `ALREADY_EXISTS` | No | Entidad ya existe. Informar o continuar |
| `PLAYER_NOT_FOUND` | No | Crear el player primero |
| `CHARACTER_NOT_FOUND` | No | Crear el personaje primero |
| `GEAR_NOT_FOUND` | No | Crear el gear primero |
| `INVALID_CONFIG_REFERENCE` | No | classId o gearDefId no existe. Refrescar config y mostrar opciones validas |
| `OWNERSHIP_VIOLATION` | No | Actor no posee el player. Bug o intento de acceso no autorizado |
| `DUPLICATE_API_KEY` | No | Usar otra apiKey para el nuevo actor |
| `MAX_LEVEL_REACHED` | No | Deshabilitar boton de level-up. Mostrar "Nivel maximo alcanzado" |
| `INSUFFICIENT_RESOURCES` | No | Mostrar recursos requeridos (del `errorMessage`). Deshabilitar boton hasta que tenga suficientes |
| `GEAR_ALREADY_EQUIPPED` | No | Desequipar primero, o equipar otro gear |
| `GEAR_NOT_EQUIPPED` | No | Refrescar estado — el gear ya no esta equipado |
| `SLOT_OCCUPIED` | Depende | Ofrecer opcion de swap (`swap: true`) o mostrar que el slot esta ocupado |
| `SLOT_INCOMPATIBLE` | No | Necesita `slotPattern`. Mostrar patrones validos del gearDef |
| `INVALID_SLOT` | No | Bug del cliente o config desactualizada. Refrescar config |
| `RESTRICTION_FAILED` | No | Mostrar razon: clase no permitida, nivel insuficiente, etc. (leer `errorMessage`) |
| `CHARACTER_MISMATCH` | No | Bug del cliente. Omitir `characterId` en UnequipGear |
| `UNSUPPORTED_TX_TYPE` | No | Bug del cliente. Verificar el campo `type` |
| `INVALID_COST_RESOURCE_KEY` | No | Config corrupta (cost algorithm usa keys sin prefijo). Reportar al admin |
| `CHARACTER_REQUIRED` | No | LevelUpGear con costes de personaje requiere `characterId` en el body |

### 11.3. Mensajes al usuario

**Regla general:** mostrar `errorMessage` del servidor como texto de ayuda. No exponer `errorCode` directamente al usuario final — usarlo internamente para logica del cliente.

```javascript
function userFriendlyMessage(errorCode, errorMessage) {
  switch (errorCode) {
    case "INSUFFICIENT_RESOURCES":
      // errorMessage contiene "Required: {player.gold: 50, character.xp: 100}"
      return `No tienes suficientes recursos. ${errorMessage.split("Required:")[1] ?? ""}`;
    case "RESTRICTION_FAILED":
      return `No cumples los requisitos para este equipo. ${errorMessage}`;
    case "MAX_LEVEL_REACHED":
      return "Ya has alcanzado el nivel maximo.";
    case "SLOT_OCCUPIED":
      return "El slot ya esta ocupado. Desequipa el item actual o usa modo swap.";
    default:
      return errorMessage;
  }
}
```

**Nunca mostrar al usuario:**
- La `apiKey` o `ADMIN_API_KEY`.
- Detalles internos de `CONFIG_NOT_FOUND` o `INVALID_CONFIG_REFERENCE` (son errores de servidor, no del usuario).

---

## 12. Checklist final

### Mi cliente funciona si...

- [ ] `GET /health` retorna `200` con `{ status: "ok" }`.
- [ ] `CreateActor` con `Authorization: Bearer <ADMIN_KEY>` retorna `accepted: true`.
- [ ] `CreatePlayer` con `Authorization: Bearer <actorApiKey>` retorna `accepted: true`.
- [ ] `GET /state/player/{playerId}` retorna `200` con `characters: {}, gear: {}, resources: {}`.
- [ ] `CreateCharacter` con un `classId` de `GET /config → classes` retorna `accepted: true`.
- [ ] `CreateGear` con un `gearDefId` de `GET /config → gearDefs` retorna `accepted: true`.
- [ ] `EquipGear` con `gearId` + `characterId` retorna `accepted: true`.
- [ ] `GET /character/{characterId}/stats` retorna `200` con `finalStats` que incluyen los stats del gear equipado.
- [ ] `UnequipGear` retorna `accepted: true` y `GET stats` ya no incluye los stats del gear.
- [ ] Repetir una tx con el mismo `txId` retorna exactamente la misma respuesta (idempotencia).
- [ ] Enviar una tx con token invalido retorna `401`.
- [ ] Enviar una tx sobre un player ajeno retorna `OWNERSHIP_VIOLATION`.

### Flujo completo minimo en curl

```bash
# Variables — ajustar a tu entorno
BASE=http://localhost:3000
INST=instance_001
ADMIN_KEY=mi-clave-admin
ACTOR_KEY=mi-token-secreto

# 0. Health check
curl $BASE/health

# 1. Crear actor
curl -X POST $BASE/$INST/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -d "{
    \"txId\": \"t1\", \"type\": \"CreateActor\",
    \"gameInstanceId\": \"$INST\",
    \"actorId\": \"actor_1\", \"apiKey\": \"$ACTOR_KEY\"
  }"

# 2. Crear player
curl -X POST $BASE/$INST/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACTOR_KEY" \
  -d "{
    \"txId\": \"t2\", \"type\": \"CreatePlayer\",
    \"gameInstanceId\": \"$INST\",
    \"playerId\": \"player_1\"
  }"

# 3. Leer config para descubrir clases y gearDefs
curl $BASE/$INST/config

# 4. Crear character
curl -X POST $BASE/$INST/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACTOR_KEY" \
  -d "{
    \"txId\": \"t3\", \"type\": \"CreateCharacter\",
    \"gameInstanceId\": \"$INST\",
    \"playerId\": \"player_1\",
    \"characterId\": \"hero_1\", \"classId\": \"warrior\"
  }"

# 5. Crear gear
curl -X POST $BASE/$INST/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACTOR_KEY" \
  -d "{
    \"txId\": \"t4\", \"type\": \"CreateGear\",
    \"gameInstanceId\": \"$INST\",
    \"playerId\": \"player_1\",
    \"gearId\": \"sword_1\", \"gearDefId\": \"sword_basic\"
  }"

# 6. Equipar gear
curl -X POST $BASE/$INST/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACTOR_KEY" \
  -d "{
    \"txId\": \"t5\", \"type\": \"EquipGear\",
    \"gameInstanceId\": \"$INST\",
    \"playerId\": \"player_1\",
    \"characterId\": \"hero_1\", \"gearId\": \"sword_1\"
  }"

# 7. Leer stats
curl $BASE/$INST/character/hero_1/stats \
  -H "Authorization: Bearer $ACTOR_KEY"

# 8. Leer estado completo del player
curl $BASE/$INST/state/player/player_1 \
  -H "Authorization: Bearer $ACTOR_KEY"

# 9. Polling ligero de version
curl $BASE/$INST/stateVersion

# 10. Verificar idempotencia (repetir tx t5)
curl -X POST $BASE/$INST/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACTOR_KEY" \
  -d "{
    \"txId\": \"t5\", \"type\": \"EquipGear\",
    \"gameInstanceId\": \"$INST\",
    \"playerId\": \"player_1\",
    \"characterId\": \"hero_1\", \"gearId\": \"sword_1\"
  }"
# Debe retornar exactamente la misma respuesta que la primera vez
```

---

## Apendice A — Resumen de endpoints

| Endpoint | Metodo | Auth | Descripcion |
|----------|--------|------|-------------|
| `/health` | GET | No | Health check |
| `/:id/config` | GET | No | Config activa (clases, gearDefs, sets, algoritmos) |
| `/:id/stateVersion` | GET | No | Version del estado (polling ligero) |
| `/:id/tx` | POST | Si | Enviar transaccion (mutacion de estado) |
| `/:id/state/player/:pid` | GET | Si | Estado completo de un player |
| `/:id/character/:cid/stats` | GET | Si | Stats calculados de un personaje |

## Apendice B — Tipos de transaccion

| type | Auth | Campos requeridos adicionales |
|------|------|------------------------------|
| `CreateActor` | ADMIN_API_KEY | `actorId`, `apiKey` |
| `CreatePlayer` | Actor | `playerId` |
| `CreateCharacter` | Actor | `playerId`, `characterId`, `classId` |
| `CreateGear` | Actor | `playerId`, `gearId`, `gearDefId` |
| `EquipGear` | Actor | `playerId`, `characterId`, `gearId` (+opcional: `slotPattern`, `swap`) |
| `UnequipGear` | Actor | `playerId`, `gearId` (+opcional: `characterId`) |
| `LevelUpCharacter` | Actor | `playerId`, `characterId` (+opcional: `levels`) |
| `LevelUpGear` | Actor | `playerId`, `gearId` (+opcional: `levels`, `characterId`) |
| `GrantResources` | ADMIN_API_KEY | `playerId`, `resources` |
| `GrantCharacterResources` | ADMIN_API_KEY | `playerId`, `characterId`, `resources` |

## Apendice C — Recursos (wallets)

El motor tiene dos niveles de wallet:

| Wallet | Ubicacion en state | Llenado via | Consumido por |
|--------|-------------------|-------------|---------------|
| **Player resources** | `player.resources` | `GrantResources` (admin) | `LevelUpCharacter` / `LevelUpGear` (costs con prefijo `player.`) |
| **Character resources** | `character.resources` | `GrantCharacterResources` (admin) | `LevelUpCharacter` / `LevelUpGear` (costs con prefijo `character.`) |

Los costes de level-up estan definidos en la config (`algorithms.levelCostCharacter`, `algorithms.levelCostGear`). Si el algoritmo produce claves con prefijo `player.` (ej: `player.gold`), se descuenta del wallet del player. Si produce `character.` (ej: `character.xp`), del wallet del personaje.

Ejemplo de config con costes mixtos:

```json
{
  "algorithms": {
    "levelCostCharacter": {
      "algorithmId": "linear_cost",
      "params": { "resourceId": "character.xp", "base": 100, "perLevel": 50 }
    },
    "levelCostGear": {
      "algorithmId": "linear_cost",
      "params": { "resourceId": "player.gold", "base": 50, "perLevel": 25 }
    }
  }
}
```

Con esta config:
- `LevelUpCharacter` consume `xp` del wallet del **personaje**.
- `LevelUpGear` consume `gold` del wallet del **player**.

> Si `LevelUpGear` tiene costes con prefijo `character.`, el body de la tx **debe** incluir `characterId`. Sin el, el motor retorna `CHARACTER_REQUIRED`.
