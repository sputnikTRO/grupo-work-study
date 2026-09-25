/**
 * Asserts DETERMINÍSTICOS del harness (los "duros": deciden pass/fail).
 *
 * Trabajan sobre la transcripción que arma run.mjs, nunca sobre el código de la
 * app: a propósito NO reutilizan text.js ni enrollment.js (probar el
 * clasificador con el propio clasificador no prueba nada).
 *
 * Forma de un turno (ver run.mjs):
 *   { i, user, nodeBefore, nodeAfter, bot: [texto al prospecto…],
 *     advisor: [{to, text}…] (notificaciones a asesoras), error? }
 *
 * Cada check devuelve { id, pass, detail, turns: [índices culpables] }.
 */
import { readFileSync } from 'node:fs';

const FREEFORM = 'llm_freeform';

// ── Patrones ─────────────────────────────────────────────────────────────────

// Cualquier monto: "$1,500", "$ 900", "1500 pesos", "20 mil pesos", "desde $", "15k".
const PRICE_RE = /\$\s?\d|\b\d[\d.,]*\s?(mil\s+)?(pesos|mxn|usd|d[oó]lares|euros)\b|\bdesde\s+\$|\b\d+\s?k\b/i;

// Afirmar que la asesora YA contactó. Ori solo sabe que fue asignada/notificada.
const ALREADY_CONTACTED_RE = /ya\s+(est[aá]|estamos|est[aá]n)\s+en\s+contacto|ya\s+(se\s+)?(puso|pusieron|comunic[oó]|comunicaron)(?![a-záéíóúñ])|ya\s+te\s+(contact[oó]|contactaron|escribi[oó]|escribieron|llam[oó]|llamaron|busc[oó])/i;

// El recordatorio de menú, venga del handler, del flujo o del propio LLM:
// "Escribe *Menú*…", "puedes escribir 'Menú'…", "solo escribe \"Menú\"".
//
// OJO: nada de \b después de una vocal acentuada. En JS \b es ASCII: entre la
// "ú" de "Menú" y el "*" no hay límite de palabra, así que /men[uú]\b/ NUNCA
// casaba con "*Menú*" y el assert pasaba por vacuidad (ver asserts.test.mjs).
const NOT_LETTER = '(?![a-záéíóúüñ])';
const NUDGE_RE = new RegExp(`escr[ií]b[a-záéíóú]*\\s+(?:la\\s+palabra\\s+)?[*_"'“‘]*men[uú]${NOT_LETTER}`, 'gi');

// Copy del flujo cuando clasifica un CTA como "no" (Ori y Miri).
const DECLINE_COPY_RE = /^sin problema\b/i;

// ESTATUS de pago de un inscrito (Miri, rama ya_inscrito): lo que lleva pagado
// o debe. NO una cotización ("la inversión total del programa es…"): eso es
// precio, y lo cubren sin_precios / los "prohibido" del escenario.
const ENROLLMENT_FIN_RE = /(llevas?|llevan)\s+(pagado|abonado)|has\s+pagado|falta\s+por\s+pagar|total\s+del\s+programa\s*:|(tu|su)\s+saldo|saldo\s+(pendiente|actual|a\s+pagar)|adeudo|te\s+faltan?\s+(por\s+)?pagar/i;

const QUESTION_START_RE = /^(que|como|cuando|donde|cuanto|cuanta|cuantos|cuantas|cual|cuales|quien|quienes|por que|porque|se puede|puedo|hay)\b/;

// Nodos hoja con CTA "¿hablar con un asesor?". Ori: n_<cat>_<n>. Miri: nodos
// hoja sin menú numerado donde el flujo interpreta sí/no.
const CTA_NODE = {
  ori: (id) => /^n_\d+_\d+$/.test(id || ''),
  miri: (id) => ['rs_elegible', 'util_menu', 'ya_inscrito_estatus'].includes(id) || /^handoff_/.test(id || ''),
};

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const isQuestion = (t) => /[¿?]/.test(t) || QUESTION_START_RE.test(norm(t).replace(/[^a-z0-9ñ ]/g, ' ').trim());
const countNudges = (texts) => texts.reduce((n, t) => n + (String(t).match(NUDGE_RE) || []).length, 0);
const snippet = (t, re) => {
  const m = String(t).match(new RegExp(re.source, re.flags.replace('g', '')));
  if (!m) return String(t).slice(0, 80);
  const i = Math.max(0, m.index - 30);
  return `…${String(t).slice(i, m.index + m[0].length + 30).replace(/\s+/g, ' ')}…`;
};

// ── Checks genéricos ─────────────────────────────────────────────────────────

function noPrices(turns) {
  const bad = [];
  for (const t of turns) for (const m of t.bot) if (PRICE_RE.test(m)) bad.push({ i: t.i, s: snippet(m, PRICE_RE) });
  return {
    id: 'sin_precios',
    pass: bad.length === 0,
    detail: bad.length ? bad.map((b) => `t${b.i}: ${b.s}`).join(' · ') : 'ningún monto enviado al prospecto',
    turns: bad.map((b) => b.i),
  };
}

// "Sobre SI ya te escribió…, no tengo forma de saberlo" o "no sé si ya te
// contactó" es justo lo correcto: reconocer que no lo sabe. Solo cuenta la
// afirmación, así que se descartan las menciones condicionales/dubitativas.
const HEDGE_BEFORE_RE = /(\bsi|no\s+s[eé]\s+si|desconozco\s+si|no\s+tengo\s+forma\s+de\s+saber\s+si)\s+([a-záéíóúñ]+\s+){0,2}$/i;

/** ¿El mensaje AFIRMA que la asesora ya contactó? (ignora menciones condicionales) */
export function assertsAlreadyContacted(msg) {
  const re = new RegExp(ALREADY_CONTACTED_RE.source, 'gi');
  for (const m of String(msg).matchAll(re)) {
    const before = String(msg).slice(Math.max(0, m.index - 40), m.index);
    if (!HEDGE_BEFORE_RE.test(before)) return true;
  }
  return false;
}

function noAlreadyContacted(turns) {
  const bad = [];
  for (const t of turns) for (const m of t.bot) if (assertsAlreadyContacted(m)) bad.push({ i: t.i, s: snippet(m, ALREADY_CONTACTED_RE) });
  return {
    id: 'sin_ya_en_contacto',
    pass: bad.length === 0,
    detail: bad.length ? bad.map((b) => `t${b.i}: ${b.s}`).join(' · ') : 'nunca afirma que la asesora ya contactó',
    turns: bad.map((b) => b.i),
  };
}

function nudgePerTurn(turns) {
  const bad = turns.filter((t) => countNudges(t.bot) > 1);
  return {
    id: 'nudge_max_1_por_turno',
    pass: bad.length === 0,
    detail: bad.length ? bad.map((t) => `t${t.i}: ${countNudges(t.bot)} recordatorios de Menú en el mismo turno`).join(' · ') : 'ok',
    turns: bad.map((t) => t.i),
  };
}

/**
 * ≤1 recordatorio por VISITA a un nodo. El recordatorio se atribuye al nodo en
 * el que QUEDA la conversación tras el turno (nodeAfter): es desde ahí desde
 * donde le dice al prospecto "escribe Menú". Turnos consecutivos con el mismo
 * nodeAfter son la misma visita — incluido el modo libre llm_freeform, que
 * también es "un nodo" para el prospecto: el "Sin problema… Escribe Menú" del
 * decline seguido de otro "escribe Menú" del LLM en modo libre es repetición.
 * Al cambiar de nodo el contador vuelve a cero, igual que el nudgedNode del handler.
 */
function nudgePerNode(turns) {
  const bad = [];
  let visit = null;
  for (const t of turns) {
    const key = t.nodeAfter ?? '(sin flujo)';
    if (!visit || visit.key !== key) visit = { key, count: 0, turns: [] };
    const n = countNudges(t.bot);
    if (n) { visit.count += n; visit.turns.push(t.i); }
    if (visit.count > 1 && n) bad.push({ i: t.i, key, where: [...visit.turns] });
  }
  return {
    id: 'nudge_max_1_por_nodo',
    pass: bad.length === 0,
    detail: bad.length ? bad.map((b) => `nodo ${b.key}: recordatorio repetido en t${b.where.join(', t')}`).join(' · ') : 'ok',
    turns: bad.map((b) => b.i),
  };
}

function ctaQuestionNotDecline(turns, unit) {
  const bad = [];
  for (const t of turns) {
    if (!CTA_NODE[unit](t.nodeBefore) || !isQuestion(t.user)) continue;
    const declineCopy = t.bot.some((m) => DECLINE_COPY_RE.test(m.trim()));
    const closedWithoutHandoff = t.nodeAfter === FREEFORM && t.advisor.length === 0;
    if (declineCopy || closedWithoutHandoff) {
      bad.push({ i: t.i, why: declineCopy ? 'respondió con el copy de "no gracias"' : `cerró el nodo ${t.nodeBefore} → ${FREEFORM} sin derivar` });
    }
  }
  return {
    id: 'cta_pregunta_no_es_decline',
    pass: bad.length === 0,
    detail: bad.length ? bad.map((b) => `t${b.i}: ${b.why}`).join(' · ') : 'ok',
    turns: bad.map((b) => b.i),
  };
}

// ── Miri: financieros solo con match único ──────────────────────────────────

let ENROLLMENT;
function enrollmentFixture() {
  ENROLLMENT ||= JSON.parse(readFileSync(new URL('./fixtures/enrollment.json', import.meta.url), 'utf8')).tabs;
  return ENROLLMENT;
}

const last10 = (p) => String(p ?? '').replace(/\D/g, '').slice(-10);

/**
 * Alumnos de ESE teléfono con exactamente UNA fila de pago en el fixture — los
 * únicos de los que se puede mostrar un monto. Se calcula leyendo el fixture
 * directamente, sin pasar por enrollment.js.
 */
export function studentsWithSinglePaymentRow(phone) {
  const tabs = enrollmentFixture();
  const regName = Object.keys(tabs).find((t) => norm(t).startsWith('registro general'));
  const [regHead, ...regRows] = tabs[regName];
  const telCol = regHead.findIndex((h) => norm(h).startsWith('celular'));
  const aluCol = regHead.findIndex((h) => norm(h).startsWith('nombre completo del estudiante'));
  const mine = [...new Set(regRows.filter((r) => last10(r[telCol]) === last10(phone)).map((r) => norm(r[aluCol])))];

  const counts = new Map();
  for (const [tab, rows] of Object.entries(tabs)) {
    if (!/^\s*inscritos/i.test(tab)) continue;
    const col = rows[0].findIndex((h) => norm(h) === 'alumno');
    for (const r of rows.slice(1)) counts.set(norm(r[col]), (counts.get(norm(r[col])) || 0) + 1);
  }
  return mine.filter((a) => counts.get(a) === 1);
}

function enrollmentFinancials(turns, phone) {
  const allowed = studentsWithSinglePaymentRow(phone);
  const bad = [];
  for (const t of turns) {
    for (const m of t.bot) {
      if (!(ENROLLMENT_FIN_RE.test(m) && /\$\s?\d/.test(m))) continue;
      const mentionsAllowed = allowed.some((a) => norm(m).includes(a));
      if (!mentionsAllowed) bad.push({ i: t.i, s: snippet(m, ENROLLMENT_FIN_RE) });
    }
  }
  return {
    id: 'financieros_solo_match_unico',
    pass: bad.length === 0,
    detail: bad.length
      ? bad.map((b) => `t${b.i}: ${b.s}`).join(' · ') + ` (match único permitido: ${allowed.join(', ') || 'ninguno'})`
      : `ok (match único permitido: ${allowed.join(', ') || 'ninguno'})`,
    turns: bad.map((b) => b.i),
  };
}

// ── Checks propios del escenario (bloque "expect") ──────────────────────────

function scenarioChecks(sc, turns) {
  const out = [];
  const e = sc.expect || {};
  const handoffTurns = turns.filter((t) => t.advisor.length > 0).map((t) => t.i);

  if (e.no_handoff) {
    out.push({
      id: 'sin_derivacion',
      pass: handoffTurns.length === 0,
      detail: handoffTurns.length ? `se notificó a una asesora en t${handoffTurns.join(', t')}` : 'no se notificó a ninguna asesora',
      turns: handoffTurns,
    });
  }
  if (e.handoff) {
    out.push({
      id: 'con_derivacion',
      pass: handoffTurns.length >= 1,
      detail: handoffTurns.length ? `derivó en t${handoffTurns.join(', t')}` : 'nunca notificó a una asesora',
      turns: [],
    });
  }
  if (e.max_handoffs !== undefined) {
    out.push({
      id: 'max_derivaciones',
      pass: handoffTurns.length <= e.max_handoffs,
      detail: `${handoffTurns.length} turno(s) con notificación a asesora (máx ${e.max_handoffs})`,
      turns: handoffTurns.slice(e.max_handoffs),
    });
  }
  if (e.no_prices && sc.unit !== 'ori') out.push(noPrices(turns));
  for (const f of e.forbidden || []) {
    const re = new RegExp(f.pattern, 'i');
    const bad = [];
    for (const t of turns) for (const m of t.bot) if (re.test(m)) bad.push({ i: t.i, s: snippet(m, re) });
    out.push({
      id: `prohibido:${f.id}`,
      pass: bad.length === 0,
      detail: bad.length ? `${f.why} — ${bad.map((b) => `t${b.i}: ${b.s}`).join(' · ')}` : 'ok',
      turns: bad.map((b) => b.i),
    });
  }
  for (const r of e.required || []) {
    const re = new RegExp(r.pattern, 'i');
    const hit = turns.some((t) => t.bot.some((m) => re.test(m)));
    out.push({ id: `requerido:${r.id}`, pass: hit, detail: hit ? 'ok' : r.why, turns: [] });
  }
  return out;
}

// ── API ─────────────────────────────────────────────────────────────────────

/**
 * @param {Object} sc - escenario
 * @param {Array} turns - transcripción
 * @returns {Array<{id, pass, detail, turns}>}
 */
export function runAsserts(sc, turns) {
  const checks = [
    noAlreadyContacted(turns),
    nudgePerTurn(turns),
    nudgePerNode(turns),
    ctaQuestionNotDecline(turns, sc.unit),
  ];
  if (sc.unit === 'ori') checks.unshift(noPrices(turns));
  if (sc.unit === 'miri') checks.push(enrollmentFinancials(turns, sc.phone));

  // Un turno que reventó (excepción o fallback técnico) nunca es un pass.
  const broken = turns.filter((t) => t.error);
  checks.push({
    id: 'sin_errores_de_turno',
    pass: broken.length === 0,
    detail: broken.length ? broken.map((t) => `t${t.i}: ${t.error}`).join(' · ') : 'ok',
    turns: broken.map((t) => t.i),
  });

  // Los turnos de SETUP pueden declarar a qué nodo deben llevar ("node"). Si la
  // ruta no se cumple, el escenario no probó lo que dice probar: eso es un fallo,
  // no un verde por vacuidad. Regla para escribir escenarios: "node" solo en
  // navegación determinística ANTES de la primera respuesta del LLM — después,
  // la ruta depende del modelo (p.ej. derivar cierra el nodo) y no es un assert.
  const offPath = turns.filter((t) => t.expectNode !== undefined && t.nodeAfter !== t.expectNode);
  if (turns.some((t) => t.expectNode !== undefined)) {
    checks.push({
      id: 'ruta_esperada',
      pass: offPath.length === 0,
      detail: offPath.length ? offPath.map((t) => `t${t.i}: quedó en ${t.nodeAfter}, se esperaba ${t.expectNode}`).join(' · ') : 'ok',
      turns: offPath.map((t) => t.i),
    });
  }

  return [...checks, ...scenarioChecks(sc, turns)];
}

export const _internals = { PRICE_RE, ALREADY_CONTACTED_RE, NUDGE_RE, ENROLLMENT_FIN_RE, isQuestion, countNudges };
