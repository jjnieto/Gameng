# Workflow

Este documento define cómo se trabaja en este repositorio para mantener coherencia entre especificación, contratos (schemas/OpenAPI), ejemplos (golden) y tests.

## 1) Fuente de verdad y prioridad

Antes de empezar cualquier cambio, leer en este orden:

1. `docs/SOURCE_OF_TRUTH.md`
2. `docs/specs/SPEC.md`
3. `docs/specs/DELIVERABLES.md`
4. `docs/specs/PLAN.md`

En caso de conflicto entre documentos, aplicar el orden indicado en `docs/SOURCE_OF_TRUTH.md`.

## 2) Principios de trabajo

- **Cambios pequeños y verificables:** un cambio debe dejar el repo en estado “verde” (tests/lint/validaciones).
- **Contratos primero:** antes de implementar lógica, asegurar que existen y están alineados:
  - `schemas/` (JSON Schema)
  - `openapi/` (OpenAPI)
  - `examples/` (golden files)
  - `tests/` (sequence/smoke)
- **Servidor autoritativo:** el cliente no persiste estado; solo envía transacciones y realiza consultas.
- **Data-driven:** el contenido del juego y reglas configurables se describen en JSON.
- **No adelantarse al slice:** no se implementan features fuera del slice/entregable actual.

## 3) Orden recomendado para aplicar cambios

Para cualquier tarea/slice, seguir este orden:

1. **Docs de semántica** (`docs/SEMANTICS.md`, `docs/INVARIANTS.md`)  
   Si se cierra una decisión o se aclara una regla.
2. **Schemas** (`schemas/*.schema.json`)  
   Si cambia el modelo de config/estado/tx/result.
3. **OpenAPI** (`openapi/openapi.yaml`)  
   Mantener endpoints/modelos alineados con schemas.
4. **Examples** (`examples/`)  
   Actualizar/crear fixtures y golden files.
5. **Código** (`src/`)  
   Implementación del comportamiento.
6. **Tests** (`tests/`)  
   Unit/integration + sequence tests; actualizar expected results.

> Regla: si tocas schemas, normalmente debes tocar OpenAPI y examples/tests.

## 4) Qué se considera “terminado” (Definition of Done)

Un cambio está terminado cuando:

- `npm test` pasa.
- `npm run lint` pasa.
- `npm run format` no deja cambios pendientes (o `npm run format:check` pasa si existe).
- `npm run validate` pasa (schemas y OpenAPI).
- Los artefactos de contrato están actualizados:
  - schemas coherentes
  - OpenAPI coherente
  - ejemplos/golden coherentes
- Si se ha cerrado una decisión del dominio, está reflejada en:
  - `docs/SEMANTICS.md` y/o `docs/specs/SPEC.md` (según corresponda)
  - tests que la protejan (golden o invariantes)

## 5) Política de cambios de especificación

- Las decisiones nuevas (por ejemplo, “gear de 2 slots cuenta como 1 pieza”) se registran en `docs/SEMANTICS.md`.
- Si una decisión afecta al modelo de datos, actualizar también:
  - schemas (y versión si aplica)
  - ejemplos y tests
  - OpenAPI

## 6) Estilo y convenciones

- Usar IDs estables en config/estado: `statId`, `slotId`, `classId`, `gearDefId`, `setId`, `algorithmId` y en estado `playerId`, `characterId`, `gearId`, `txId`.
- Nombres en inglés con `_` para IDs (según SPEC).
- Mantener el código modular: separar “cálculo puro” (StatsCalculator) de “mutación de estado” (TxProcessor).

## 7) Estrategia de pruebas (mínimo exigible)

- **Smoke tests**: servidor arranca y responde `/health`.
- **Golden tests**: el cálculo de stats y reglas produce resultados exactos para configs y estados de ejemplo.
- **Atomicidad**: cualquier transacción inválida no cambia el estado.
- **Invariantes**: ownership, unicidad de gear, consistencia slot↔equipamiento.

## 8) Mensajes de commit (opcional)

Convención sugerida:
- `chore:` tooling, lint, CI
- `docs:` cambios en documentación
- `schema:` cambios en JSON Schema
- `api:` cambios en OpenAPI
- `feat:` nueva funcionalidad dentro del slice
- `test:` tests/golden
- `fix:` correcciones

## 9) Slice actual y foco

Antes de empezar un slice, declarar explícitamente:
- qué slice se está implementando (ver `docs/specs/DELIVERABLES.md`)
- qué archivos se crearán/modificarán
- qué tests validarán el resultado

No continuar al siguiente slice hasta cumplir Definition of Done.
