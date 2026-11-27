import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageOx, stageEd } from '../../src/panel/stages.js';
import { buildRow, filterRows, presentRow, paginate, computeIndicators, startOfDayCdmx, formatPhone, maskPhone, isExcludedPhone } from '../../src/panel/rows.js';

const at = (iso) => new Date(`${iso}-06:00`);
const ox = (o = {}) => ({ id: 'o1', ticketNumber: 47, status: 'nuevo', createdAt: at('2026-11-26T10:00'), updatedAt: at('2026-11-26T10:05'), contact: { phone: '+5215512344821', name: null }, ...o });
const ed = (o = {}) => ({ id: 'e1', ticketNumber: 12, status: 'nuevo', createdAt: at('2026-11-26T11:00'), updatedAt: at('2026-11-26T11:00'), contact: { phone: '+5215598761234', name: null }, ...o });

test('etapas de Ox', () => {
  assert.equal(stageOx(ox()), 'solo_saludo');
  assert.equal(stageOx(ox({ status: 'primer_contacto', state: 'Jalisco' })), 'dio_datos');
  assert.equal(stageOx(ox({ status: 'en_calificacion' })), 'dio_datos');
  assert.equal(stageOx(ox({ status: 'derivado_asesor' })), 'derivado');
  assert.equal(stageOx(ox({ status: 'en_atencion' })), 'atendido');
  assert.equal(stageOx(ox({ status: 'sin_confirmar' })), 'sin_confirmar');
  for (const s of ['atendido_asesor', 'cerrado_ganado', 'no_interesado', 'archivado']) assert.equal(stageOx(ox({ status: s })), 'cerrado', s);
});

test('etapas de Ed: sin ATIENDO no hay "atendido" ni "sin confirmar"', () => {
  assert.equal(stageEd(ed()), 'solo_saludo');
  assert.equal(stageEd(ed({ status: 'contactado', schoolCode: 'WC' })), 'dio_datos');
  assert.equal(stageEd(ed({ status: 'materiales_enviados' })), 'dio_datos');
  assert.equal(stageEd(ed({ status: 'derivado_asesor' })), 'derivado');
  for (const s of ['atendido_asesor', 'cerrado_por_asesor', 'inscrito', 'en_proceso_pago']) assert.equal(stageEd(ed({ status: s })), 'cerrado', s);
});

test('teléfono: formato, máscara y el bug del "1" doble', () => {
  assert.equal(formatPhone('+5215512344821'), '55 1234 4821');
  assert.equal(formatPhone('+52115535305000'), '55 3530 5000');
  assert.equal(maskPhone('+5215512344821'), '55 •••• 4821');
  assert.ok(isExcludedPhone('+52115535305000', ['5535305000']), 'el número de pruebas se excluye aunque esté guardado con +5211');
  assert.ok(!isExcludedPhone('+5215512344821', ['5535305000']));
});

test('fila de Ox: asesora original y actual, desde cuándo, aviso', () => {
  const r = buildRow('ox', ox({
    status: 'derivado_asesor', fullName: 'Laura Méndez', municipality: 'Toluca', state: 'Estado de México', zoneKey: 'CENTRO',
    primaryProductLabel: 'Oxford TCC', assignedAdvisor: 'Danna Paola', assignedAt: at('2026-11-26T10:40'),
    advisorAttempts: [{ advisor: 'Rosaura Pinto' }, { advisor: 'Danna Paola' }],
  }), { notifications: [{ advisorName: 'Rosaura Pinto', status: 'read', createdAt: at('2026-11-26T10:10') }, { advisorName: 'Danna Paola', status: 'delivered', createdAt: at('2026-11-26T10:40'), deliveredAt: at('2026-11-26T10:40') }], now: at('2026-11-26T11:20') });
  assert.equal(r.name, 'Laura Méndez');
  assert.equal(r.zone, 'Toluca, Estado de México (CENTRO)');
  assert.equal(r.advisorOriginal, 'Rosaura Pinto');
  assert.equal(r.advisorCurrent, 'Danna Paola');
  assert.equal(r.stage, 'derivado');
  assert.equal(new Date(r.sinceAt).toISOString(), at('2026-11-26T10:40').toISOString(), 'derivado cuenta desde la asignación actual');
  assert.equal(r.overdue, true, '40 min sin ATIENDO');
  assert.equal(r.delivery.status, 'delivered');
});

test('fila de Ed: asesora original desde el primer aviso', () => {
  const r = buildRow('ed', ed({ status: 'derivado_asesor', parentName: 'Ana', schoolCode: 'WC', programInterest: 'English 4 Life', destination: 'Londres', assignedAdvisor: 'Alma Sotelo' }),
    { notifications: [{ advisorName: 'Alma Sotelo', status: 'delivered', createdAt: at('2026-11-26T11:05') }], schoolName: 'Westhill', now: at('2026-11-26T11:10') });
  assert.equal(r.advisorOriginal, 'Alma Sotelo');
  assert.equal(r.zone, 'Westhill');
  assert.equal(r.product, 'English 4 Life · Londres');
  assert.equal(r.overdue, false);
});

const rows = [
  buildRow('ox', ox({ id: 'a', ticketNumber: 1, fullName: 'Laura Méndez', assignedAdvisor: 'Rosaura Pinto', status: 'derivado_asesor' })),
  buildRow('ox', ox({ id: 'b', ticketNumber: 2, fullName: 'Prueba', contact: { phone: '+52115535305000' } })),
  buildRow('ed', ed({ id: 'c', ticketNumber: 3, parentName: 'Carlos Ruiz', assignedAdvisor: 'Alma Sotelo', status: 'derivado_asesor' })),
];
const EX = ['5535305000'];

test('filtros: pruebas excluidas por default, bot, asesora, etapa, buscador', () => {
  assert.deepEqual(filterRows(rows, { excludePhones: EX }).map((r) => r.ticket), [1, 3]);
  assert.deepEqual(filterRows(rows, { excludePhones: EX, includeTest: true }).map((r) => r.ticket), [1, 2, 3]);
  assert.deepEqual(filterRows(rows, { excludePhones: EX, bot: 'ed' }).map((r) => r.ticket), [3]);
  assert.deepEqual(filterRows(rows, { excludePhones: EX, advisor: 'Rosaura Pinto' }).map((r) => r.ticket), [1]);
  assert.deepEqual(filterRows(rows, { excludePhones: EX, stage: 'derivado' }).map((r) => r.ticket), [1, 3]);
  assert.deepEqual(filterRows(rows, { excludePhones: EX, q: 'mendez' }).map((r) => r.ticket), [1], 'sin acentos');
  assert.deepEqual(filterRows(rows, { excludePhones: EX, q: '4821' }).map((r) => r.ticket), [1], 'por dígitos del teléfono');
  assert.deepEqual(filterRows(rows, { excludePhones: EX, q: '#3' }).map((r) => r.ticket), [3], 'por ticket');
});

test('rol asesora: solo sus leads y teléfono enmascarado', () => {
  const user = { role: 'asesora', advisorName: 'Alma Sotelo' };
  const mine = filterRows(rows, { excludePhones: EX, user });
  assert.deepEqual(mine.map((r) => r.ticket), [3]);
  const shown = presentRow(mine[0], user);
  assert.equal(shown.phone, '55 •••• 1234');
  assert.equal(shown.phoneLast10, undefined, 'el teléfono completo no sale');
  assert.equal(presentRow(mine[0], { role: 'admin' }).phone, '55 9876 1234');
});

test('paginación', () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ key: i }));
  const p = paginate(many, 3, 50);
  assert.equal(p.rows.length, 20); assert.equal(p.pages, 3); assert.equal(p.total, 120);
  assert.equal(paginate(many, 99, 50).page, 3, 'una página fuera de rango cae en la última');
});

test('"hoy" empieza a las 00:00 de CDMX (un lead de las 23:30 es de su día)', () => {
  assert.equal(startOfDayCdmx(at('2026-11-26T23:30')).toISOString(), at('2026-11-26T00:00').toISOString());
  assert.equal(startOfDayCdmx(new Date('2026-11-27T04:00:00Z')).toISOString(), at('2026-11-26T00:00').toISOString());
});

test('indicadores: nuevos, sin atender, vencidos, mediana y casos W&S', () => {
  const now = at('2026-11-26T12:00');
  const r = [
    buildRow('ox', ox({ id: 'x1', ticketNumber: 10, createdAt: at('2026-11-26T09:00'), status: 'derivado_asesor', assignedAt: at('2026-11-26T09:05') }), { now }),
    buildRow('ox', ox({ id: 'x2', ticketNumber: 11, createdAt: at('2026-11-22T09:00'), status: 'sin_confirmar' }), { now }),
    buildRow('ed', ed({ id: 'y1', ticketNumber: 20, createdAt: at('2026-11-26T08:00') }), { now }),
  ];
  const d = {
    rows: r,
    oxResponseSeconds: [{ confirmedAt: at('2026-11-26T10:00'), responseSeconds: 600 }, { confirmedAt: at('2026-11-24T10:00'), responseSeconds: 1800 }],
    edListoSeconds: [{ at: at('2026-11-25T10:00'), seconds: 7200 }],
    wsCases: [{ status: 'asignado' }, { status: 'asignado' }, { status: 'resuelto' }],
  };
  const hoy = computeIndicators(d, { from: startOfDayCdmx(now) });
  assert.equal(hoy.ox.nuevos, 1); assert.equal(hoy.ed.nuevos, 1);
  assert.equal(hoy.ox.sinAtender, 1); assert.equal(hoy.ox.sinAtenderVencidos, 1);
  assert.equal(hoy.ox.sinConfirmar, 1, 'el estado actual cuenta aunque el lead sea viejo');
  assert.equal(hoy.ox.respuesta.mediana, 600);
  assert.equal(hoy.ed.respuesta.n, 0);
  assert.deepEqual(hoy.ws, { abiertos: 2, porEstado: { asignado: 2 } });
  const semana = computeIndicators(d, { from: at('2026-11-20T00:00') });
  assert.equal(semana.ox.nuevos, 2);
  assert.equal(semana.ox.respuesta.mediana, 1200);
  assert.equal(semana.ed.respuesta.mediana, 7200);
  assert.equal(semana.ed.sinConfirmar, null, 'Ed no tiene "sin confirmar"');
});
