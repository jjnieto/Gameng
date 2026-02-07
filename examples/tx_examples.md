# Transaction Examples

Ejemplos de JSON para cada tipo de transaccion. Todos se envian a `POST /:gameInstanceId/tx`.

Archivos de config de referencia: `examples/config_minimal.json`, `examples/config_sets.json`.

---

## 1. CreateActor

Crea un actor en el sistema de auth. **Requiere `ADMIN_API_KEY` como Bearer token.**

```json
{
  "txId": "tx_actor_001",
  "type": "CreateActor",
  "gameInstanceId": "instance_001",
  "actorId": "actor_1",
  "apiKey": "my-secret-key"
}
```

Header: `Authorization: Bearer <ADMIN_API_KEY>`

Respuesta exitosa:
```json
{ "txId": "tx_actor_001", "accepted": true, "stateVersion": 1 }
```

---

## 2. CreatePlayer

Crea un player vacio y lo asocia al actor autenticado.

```json
{
  "txId": "tx_player_001",
  "type": "CreatePlayer",
  "gameInstanceId": "instance_001",
  "playerId": "player_1"
}
```

Header: `Authorization: Bearer my-secret-key`

---

## 3. CreateCharacter

Crea un personaje nivel 1 de la clase indicada.

```json
{
  "txId": "tx_char_001",
  "type": "CreateCharacter",
  "gameInstanceId": "instance_001",
  "playerId": "player_1",
  "characterId": "warrior_1",
  "classId": "warrior"
}
```

---

## 4. CreateGear

Crea una instancia de gear nivel 1 en el inventario del player.

```json
{
  "txId": "tx_gear_001",
  "type": "CreateGear",
  "gameInstanceId": "instance_001",
  "playerId": "player_1",
  "gearId": "sword_1",
  "gearDefId": "sword_basic"
}
```

---

## 5. EquipGear (modo strict)

Equipa gear en un personaje. Si el slot esta ocupado, falla con `SLOT_OCCUPIED`.

```json
{
  "txId": "tx_equip_001",
  "type": "EquipGear",
  "gameInstanceId": "instance_001",
  "playerId": "player_1",
  "characterId": "warrior_1",
  "gearId": "sword_1"
}
```

Con `slotPattern` explicito (para gearDefs con multiples equipPatterns):

```json
{
  "txId": "tx_equip_002",
  "type": "EquipGear",
  "gameInstanceId": "instance_001",
  "playerId": "player_1",
  "characterId": "warrior_1",
  "gearId": "versatile_1",
  "slotPattern": ["off_hand"]
}
```

### EquipGear (modo swap)

Con `swap: true`, auto-desequipa gear previo de los slots conflictivos antes de equipar.

```json
{
  "txId": "tx_equip_003",
  "type": "EquipGear",
  "gameInstanceId": "instance_001",
  "playerId": "player_1",
  "characterId": "warrior_1",
  "gearId": "axe_1",
  "swap": true
}
```

---

## 6. LevelUpCharacter

Sube niveles al personaje. Consume recursos segun el algoritmo de costes configurado.

```json
{
  "txId": "tx_lvl_001",
  "type": "LevelUpCharacter",
  "gameInstanceId": "instance_001",
  "playerId": "player_1",
  "characterId": "warrior_1",
  "levels": 2
}
```

Si `levels` se omite, sube 1 nivel. Falla con `MAX_LEVEL_REACHED` si excede `config.maxLevel`, o con `INSUFFICIENT_RESOURCES` si el player no tiene recursos suficientes.

---

## 7. GrantResources (admin)

Suma recursos al wallet del player. **Requiere `ADMIN_API_KEY` como Bearer token** (igual que CreateActor).

```json
{
  "txId": "tx_grant_001",
  "type": "GrantResources",
  "gameInstanceId": "instance_001",
  "playerId": "player_1",
  "resources": { "xp": 500, "gold": 200 }
}
```

Header: `Authorization: Bearer <ADMIN_API_KEY>`

---

## 8. Idempotencia por txId

Cada transaccion lleva un `txId` unico. Si se reenvia el mismo `txId`, el servidor devuelve **exactamente la misma respuesta** (mismo statusCode y body) sin re-ejecutar la mutacion ni incrementar `stateVersion`.

Ejemplo: enviar dos veces la misma tx:

```json
{
  "txId": "tx_duplicada",
  "type": "CreatePlayer",
  "gameInstanceId": "instance_001",
  "playerId": "player_2"
}
```

- Primera vez: `{ "txId": "tx_duplicada", "accepted": true, "stateVersion": 5 }`
- Segunda vez (replay): misma respuesta exacta, sin mutacion.

El cache de idempotencia es FIFO con tamaño configurable (`GAMENG_MAX_IDEMPOTENCY_ENTRIES`, default 1000). Las entradas mas antiguas se eviccionan cuando se alcanza el limite.
