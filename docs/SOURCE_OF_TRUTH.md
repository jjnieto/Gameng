# Source of Truth

Este repositorio define un motor RPG server-side data-driven. Para evitar ambigüedades, esta página indica qué documentos son normativos y el orden de prioridad.

## Documentos normativos (prioridad)

1) `docs/specs/SPEC.md`  
   Especificación funcional del motor (conceptos, reglas, cálculo de stats, persistencia y compatibilidad).

2) `docs/specs/DELIVERABLES.md`  
   Checklist de entregables por fase y slice (qué artefactos deben existir para dar un hito por completado).

3) `docs/specs/PLAN.md`  
   Plan de ejecución por fases/slices (orden recomendado, estrategia de pruebas y riesgos).

## Orden de prioridad en caso de conflicto

Si hay contradicción entre documentos:
1) manda `docs/specs/SPEC.md`,
2) luego `docs/specs/DELIVERABLES.md`,
3) luego `docs/specs/PLAN.md`,
4) luego el resto de `docs/` (WORKFLOW/SEMANTICS/INVARIANTS/ARCHITECTURE/TESTING),
5) y por último cualquier nota externa.

## Filosofía arquitectónica

Este motor **no es un blockchain**, ni un sistema tipo ledger, ni usa event sourcing. No existe replay ni log histórico de transacciones.

El modelo es un **servidor autoritativo** con estado completo en memoria por `gameInstanceId`, persistido periódicamente por **snapshots**. La idempotencia por `txId` usa un **cache acotado FIFO** para detección de duplicados — no es un log ni tiene semántica de replay.

Al restaurar un snapshot, se aplica **migración best-effort** para adaptar el estado a la config actual.

## Convenciones de trabajo

- Cualquier decisión nueva o aclaración de semántica debe añadirse en `docs/SEMANTICS.md` (y si afecta a contratos, también en `schemas/`, `openapi/` y `examples/`).
- Ningún cambio se considera completo si no actualiza sus artefactos asociados (docs + schemas/OpenAPI/examples + tests).
- El objetivo actual del motor es el **cálculo de stats** (personaje + gear + sets), no combate ni economía completa.

## Ubicación de fuentes originales (opcional)

Si existen PDFs originales, se guardan en `docs/specs/pdf/` como referencia humana. La fuente normativa operativa son los `.md`.
