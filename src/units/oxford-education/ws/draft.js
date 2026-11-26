/**
 * W&S OTCC — borrador de los datos del caso (módulo PURO: sin base ni red).
 */

const EMAIL_RE = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/;

export const CASE_FIELDS = [
  { key: 'fullName', label: 'nombre completo del participante (nombre y apellido)' },
  { key: 'email', label: 'correo electrónico' },
  { key: 'stage', label: 'etapa de evaluación: Diagnóstico, Mock, Certificación o Speaking' },
  { key: 'description', label: 'descripción breve del problema o consulta, en palabras del participante (no el nombre ni el correo)' },
];

export function normalizeStage(v) {
  const n = String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/diagn/.test(n)) return 'Diagnóstico';
  if (/mock|practica/.test(n)) return 'Mock';
  if (/speaking|oral|entrevista/.test(n)) return 'Speaking';
  if (/certifica|final/.test(n)) return 'Certificación';
  return null;
}

/** Mezcla lo extraído en el borrador validando cada campo. */
export function mergeDraft(draft, extracted) {
  const out = { ...draft };
  if (extracted.fullName && extracted.fullName.trim().split(/\s+/).length >= 2) out.fullName = extracted.fullName.trim();
  if (extracted.email && EMAIL_RE.test(extracted.email.trim().toLowerCase())) out.email = extracted.email.trim().toLowerCase();
  const stage = normalizeStage(extracted.stage);
  if (stage) out.stage = stage;
  // La descripción NUNCA se reemplaza: la primera es la pregunta con la que se
  // canalizó (lo que la responsable necesita leer). Lo que el participante
  // agregue después se suma. Antes, "ya hice todo" junto al nombre y el correo
  // pisaba "¿cuándo me entregan mi certificado?" en el aviso a Karen.
  const extra = (extracted.description || '').trim();
  if (extra.length >= 8) {
    const prev = (out.description || '').trim();
    const norm = (x) => x.toLowerCase().replace(/\s+/g, ' ');
    if (!prev) out.description = extra;
    else if (!norm(prev).includes(norm(extra))) out.description = `${prev} — ${extra}`.slice(0, 600);
  }
  return out;
}

export function missingFields(draft) {
  return CASE_FIELDS.map((f) => f.key).filter((k) => !draft[k]);
}
