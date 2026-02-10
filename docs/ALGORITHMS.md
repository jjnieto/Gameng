# Algorithm Catalog

Gameng uses a **parametrizable catalog** pattern for stat scaling (growth) and level-up costs. Each algorithm is a pure function registered under a string `algorithmId`, selected from the game config JSON.

## How It Works

The `algorithms` section in `GameConfig` references algorithms by ID:

```json
{
  "algorithms": {
    "growth": { "algorithmId": "linear", "params": { "perLevelMultiplier": 0.1 } },
    "levelCostCharacter": { "algorithmId": "flat", "params": {} },
    "levelCostGear": { "algorithmId": "linear_cost", "params": { "resourceId": "gold", "base": 100, "perLevel": 50 } }
  }
}
```

At startup, `loadGameConfig()` validates that every `algorithmId` exists in its respective registry. If not, it throws with the list of available IDs.

## Function Signatures

### Growth

```typescript
type GrowthFn = (baseStats: StatMap, level: number, params: Record<string, unknown>) => StatMap;
```

Called for class base stats and gear base stats independently. Returns the scaled stat map for the given level.

### Level Cost

```typescript
type LevelCostFn = (targetLevel: number, params: Record<string, unknown>) => ResourceMap;
```

Returns the resource cost to reach `targetLevel` from `targetLevel - 1`.

## Built-in Algorithms

### Growth Algorithms

| algorithmId   | Description | Params |
|---------------|-------------|--------|
| `flat`        | Returns base stats as-is (floor). No scaling. | (none) |
| `linear`      | `base * (1 + perLevelMultiplier * (level-1)) + additivePerLevel * (level-1)` | `perLevelMultiplier: number`, `additivePerLevel?: Record<string, number>` |
| `exponential` | `base * exponent^(level-1)` | `exponent: number` |

### Level Cost Algorithms

| algorithmId        | Description | Params |
|--------------------|-------------|--------|
| `flat`             | Always returns empty cost (free). | (none) |
| `free`             | Alias for `flat`. | (none) |
| `linear_cost`      | `cost = base + perLevel * (targetLevel - 2)`. Single resource. | `resourceId: string`, `base: number`, `perLevel: number` |
| `mixed_linear_cost`| Multi-resource with scoped keys (`player.*`/`character.*`). | `costs: Array<{ scope, resourceId, base, perLevel }>` |

## Startup Validation

When the engine loads a config file, after JSON Schema validation it checks every `algorithmId` against its registry. An unknown ID produces:

```
Error: Unknown growth algorithmId: 'bogus'. Available: flat, linear, exponential
```

This catches typos and missing algorithms before any request is served.

## Discovery Endpoint

```
GET /:gameInstanceId/algorithms
```

Returns the full catalog with descriptions and expected params for each algorithm. No authentication required.

Example response:

```json
{
  "growth": {
    "flat": { "description": "Returns base stats as-is (floor)...", "params": {} },
    "linear": { "description": "Scales stats linearly...", "params": { "perLevelMultiplier": "number..." } },
    "exponential": { "description": "Scales stats exponentially...", "params": { "exponent": "number..." } }
  },
  "levelCost": {
    "flat": { "description": "Always returns empty cost...", "params": {} },
    "free": { "description": "Alias for flat...", "params": {} },
    "linear_cost": { "description": "cost = base + perLevel...", "params": { "resourceId": "string...", "base": "number...", "perLevel": "number..." } },
    "mixed_linear_cost": { "description": "Multi-resource linear cost...", "params": { "costs": "Array<...>" } }
  }
}
```

## Adding a Custom Algorithm

1. Write the function matching `GrowthFn` or `LevelCostFn` signature.
2. Add it to the registry object in `src/algorithms/growth.ts` or `src/algorithms/level-cost.ts`.
3. Add metadata to the corresponding catalog object (`growthCatalog` or `levelCostCatalog`).
4. The algorithm is now available by `algorithmId` in game configs and visible in the discovery endpoint.
