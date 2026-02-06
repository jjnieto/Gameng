# Quickstart — Gameng Engine

Guía práctica para arrancar el motor y realizar las operaciones básicas vía `curl`.

---

## 1. Instalar y arrancar

```bash
# Instalar dependencias
npm install

# Modo desarrollo (hot-reload con tsx)
npm run dev

# Modo producción
npm run build && npm start
```

Por defecto el servidor escucha en `http://0.0.0.0:3000` con la config `examples/config_minimal.json`.

### Con configuración personalizada

```bash
# Usar otra config
CONFIG_PATH=examples/config_sets.json npm run dev

# Con snapshots activados
SNAPSHOT_DIR=./data SNAPSHOT_INTERVAL_MS=30000 npm run dev

# Con ADMIN_API_KEY (protege CreateActor)
ADMIN_API_KEY=mi-clave-admin npm run dev

# Todo junto
CONFIG_PATH=examples/config_sets.json \
  SNAPSHOT_DIR=./data \
  SNAPSHOT_INTERVAL_MS=30000 \
  ADMIN_API_KEY=mi-clave-admin \
  PORT=8080 \
  npm run dev
```

---

## 2. Verificar que el servidor funciona

```bash
curl http://localhost:3000/health
```

```json
{ "status": "ok", "timestamp": "2025-01-15T10:30:00.000Z", "uptime": 1.23 }
```

---

## 3. Crear un actor (auth bootstrap)

Si `ADMIN_API_KEY` está configurada, se necesita el Bearer token de admin:

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

Si `ADMIN_API_KEY` no está configurada, se omite el header `Authorization`.

```json
{ "txId": "tx_001", "accepted": true, "stateVersion": 1 }
```

> A partir de aquí, todas las operaciones usan `Bearer mi-token-secreto`.

---

## 4. Crear un player

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

```json
{ "txId": "tx_002", "accepted": true, "stateVersion": 2 }
```

El player queda automáticamente asociado al actor que lo creó.

---

## 5. Crear un personaje

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

```json
{ "txId": "tx_003", "accepted": true, "stateVersion": 3 }
```

---

## 6. Crear gear

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

```json
{ "txId": "tx_004", "accepted": true, "stateVersion": 4 }
```

---

## 7. Equipar gear

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

```json
{ "txId": "tx_005", "accepted": true, "stateVersion": 5 }
```

Si el gear tiene múltiples `equipPatterns` (ej: `versatile_sword` puede ir en `right_hand` o `off_hand`), hay que especificar el slot:

```bash
curl -X POST http://localhost:3000/instance_001/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mi-token-secreto" \
  -d '{
    "txId": "tx_006",
    "type": "EquipGear",
    "gameInstanceId": "instance_001",
    "playerId": "player_1",
    "characterId": "guerrero_1",
    "gearId": "versatil_1",
    "slotPattern": ["off_hand"]
  }'
```

---

## 8. Ver stats del personaje

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

Fórmula: `baseStats(warrior) + gearStats(sword_basic) = {str:5, hp:20} + {str:3} = {str:8, hp:20}`.

---

## 9. Ver estado del player

```bash
curl http://localhost:3000/instance_001/state/player/player_1 \
  -H "Authorization: Bearer mi-token-secreto"
```

```json
{
  "characters": {
    "guerrero_1": {
      "classId": "warrior",
      "level": 1,
      "equipped": { "right_hand": "espada_1" }
    }
  },
  "gear": {
    "espada_1": { "gearDefId": "sword_basic", "level": 1, "equippedBy": "guerrero_1" }
  }
}
```

---

## 10. Level up

```bash
# Subir 2 niveles al personaje
curl -X POST http://localhost:3000/instance_001/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mi-token-secreto" \
  -d '{
    "txId": "tx_007",
    "type": "LevelUpCharacter",
    "gameInstanceId": "instance_001",
    "playerId": "player_1",
    "characterId": "guerrero_1",
    "levels": 2
  }'
```

```json
{ "txId": "tx_007", "accepted": true, "stateVersion": 6 }
```

---

## 11. Desequipar gear

```bash
curl -X POST http://localhost:3000/instance_001/tx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mi-token-secreto" \
  -d '{
    "txId": "tx_008",
    "type": "UnequipGear",
    "gameInstanceId": "instance_001",
    "playerId": "player_1",
    "gearId": "espada_1"
  }'
```

```json
{ "txId": "tx_008", "accepted": true, "stateVersion": 7 }
```

---

## 12. Cambiar de config

Para cambiar la configuración del juego (ej: añadir sets, nuevos slots, etc.):

1. Detener el servidor.
2. Reiniciar con la nueva config:

```bash
CONFIG_PATH=examples/config_sets.json SNAPSHOT_DIR=./data npm run dev
```

Si hay snapshots previos, el motor ejecutará **migración best-effort** automáticamente:
- Gear con `gearDefId` inexistente → se desequipa (permanece en inventario).
- Slots que ya no existen → se limpian de los personajes.
- Personajes con `classId` inexistente → se preservan (stats base = 0).

Ver [`docs/IMPLEMENTATION_GUIDE.md` § H](IMPLEMENTATION_GUIDE.md#h-migración-best-effort) para detalles.

---

## Referencia rápida

| Operación | Endpoint | Método |
|---|---|---|
| Health check | `/health` | GET |
| Crear actor | `/:id/tx` | POST (CreateActor) |
| Crear player | `/:id/tx` | POST (CreatePlayer) |
| Crear character | `/:id/tx` | POST (CreateCharacter) |
| Crear gear | `/:id/tx` | POST (CreateGear) |
| Equipar | `/:id/tx` | POST (EquipGear) |
| Desequipar | `/:id/tx` | POST (UnequipGear) |
| Level up char | `/:id/tx` | POST (LevelUpCharacter) |
| Level up gear | `/:id/tx` | POST (LevelUpGear) |
| Ver player | `/:id/state/player/:pid` | GET |
| Ver stats | `/:id/character/:cid/stats` | GET |

Todos los endpoints de transacción van a `POST /:gameInstanceId/tx` con distinto `type`.

---

## Documentación adicional

| Documento | Contenido |
|---|---|
| [`IMPLEMENTATION_GUIDE.md`](IMPLEMENTATION_GUIDE.md) | Guía técnica exhaustiva (arquitectura, modelo, stats, persistencia, migración) |
| [`ERROR_CODES.md`](ERROR_CODES.md) | Catálogo completo de error codes |
| [`SEMANTICS.md`](SEMANTICS.md) | Decisiones de diseño y semántica del dominio |
| [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md) | Prioridad de documentos normativos |
| `openapi/openapi.yaml` | Especificación OpenAPI 3.1.0 completa |
| `schemas/*.schema.json` | Contratos JSON Schema draft-07 |
