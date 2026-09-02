/**
 * Oxford Education — Horario de atención (re-export)
 *
 * La implementación se movió a src/core/flow/office-hours.js para compartirla con
 * el motor de flujo de Travel (Miri). Este archivo se conserva como re-export para
 * que Ori NO cambie de comportamiento: flow-engine.js sigue importando desde esta
 * ruta y los mocks de los tests de Ori (que interceptan este path) siguen sirviendo.
 */

export { isWithinOfficeHours, OUT_OF_HOURS_NOTICE } from '../../core/flow/office-hours.js';
