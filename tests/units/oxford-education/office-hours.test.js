/**
 * office-hours.test.js — Oxford Education isWithinOfficeHours (America/Mexico_City)
 *
 * Puro (sin mocks, sin I/O): feed explicit Date instants and assert the boundary
 * math directly, independent of the wall-clock time the suite happens to run at.
 * The handler-level flow test (scripts/test-oxford-flow-handler.mjs) mocks this
 * module so the CTA/handoff scenarios stay deterministic regardless of this logic.
 *
 * Run: node --test tests/units/oxford-education/office-hours.test.js
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { isWithinOfficeHours, OUT_OF_HOURS_NOTICE } from '../../../src/units/oxford-education/office-hours.js';

/**
 * Builds a UTC instant that corresponds to a given CDMX wall-clock hour.
 * CDMX is UTC-6 year-round (no DST since 2022). Uses Date math (not string
 * concatenation) so hours that roll past midnight UTC (e.g. 23:00 CDMX → 05:00
 * UTC the NEXT day) resolve correctly instead of producing an invalid "29:00".
 */
function cdmxInstant(isoDateNoTime, hourCdmx) {
  const utcMidnight = new Date(`${isoDateNoTime}T00:00:00Z`);
  return new Date(utcMidnight.getTime() + (hourCdmx + 6) * 3600000);
}

describe('isWithinOfficeHours — lunes a viernes 9:00–18:00 CDMX', () => {
  it('lunes 9:00 CDMX → dentro de horario (borde inferior inclusive)', () => {
    assert.equal(isWithinOfficeHours(cdmxInstant('2026-08-17', 9)), true); // 2026-08-17 es lunes
  });

  it('lunes 17:59 CDMX → dentro de horario', () => {
    const d = new Date(cdmxInstant('2026-08-17', 17).getTime() + 59 * 60000);
    assert.equal(isWithinOfficeHours(d), true);
  });

  it('lunes 18:00 CDMX → FUERA de horario (borde superior exclusivo)', () => {
    assert.equal(isWithinOfficeHours(cdmxInstant('2026-08-17', 18)), false);
  });

  it('lunes 8:59 CDMX → fuera de horario (antes de abrir)', () => {
    const d = new Date(cdmxInstant('2026-08-17', 8).getTime() + 59 * 60000);
    assert.equal(isWithinOfficeHours(d), false);
  });

  it('lunes 23:00 CDMX → fuera de horario', () => {
    assert.equal(isWithinOfficeHours(cdmxInstant('2026-08-17', 23)), false);
  });

  it('sábado 12:00 CDMX → fuera de horario (fin de semana)', () => {
    assert.equal(isWithinOfficeHours(cdmxInstant('2026-08-22', 12)), false); // 2026-08-22 es sábado
  });

  it('domingo 12:00 CDMX → fuera de horario (fin de semana)', () => {
    assert.equal(isWithinOfficeHours(cdmxInstant('2026-08-23', 12)), false); // 2026-08-23 es domingo
  });

  it('viernes 17:00 CDMX → dentro de horario (último día hábil)', () => {
    assert.equal(isWithinOfficeHours(cdmxInstant('2026-08-21', 17)), true); // 2026-08-21 es viernes
  });

  it('sin argumento usa la hora actual sin lanzar', () => {
    assert.doesNotThrow(() => isWithinOfficeHours());
  });
});

describe('OUT_OF_HOURS_NOTICE — texto exacto del spec', () => {
  it('coincide con el texto pedido para el aviso de horario', () => {
    assert.equal(
      OUT_OF_HOURS_NOTICE,
      'las asesoras atienden de lunes a viernes de 9:00 a 18:00 (CDMX) y te contactarán en ese horario',
    );
  });
});
