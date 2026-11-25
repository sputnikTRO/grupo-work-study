/**
 * W&S OTCC — configuración (todo por env, ver src/config/env.js).
 * Los contactos del equipo SOLO viven aquí: nunca se pasan a un prompt.
 */
import { env } from '../../../config/env.js';
import { normalizePhone } from '../../../utils/phone.js';

/** "Nombre|tel; Nombre|tel" → [{ key, nombre, apodo, phone }] en orden de escalamiento. */
export function parseSupportContacts(spec) {
  return String(spec || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry, i) => {
      const [nombre, tel] = entry.split('|').map((x) => (x || '').trim());
      if (!nombre || !tel) return null;
      const phone = normalizePhone(tel).replace('+', '');
      return { key: `ws${i + 1}`, orden: i + 1, nombre, apodo: nombre.split(/\s+/)[0], phone };
    })
    .filter(Boolean);
}

export function wsConfig() {
  return {
    enabled: Boolean(env.OXED_WS_ENABLED),
    contacts: parseSupportContacts(env.OXED_WS_SUPPORT_CONTACTS),
    slaMinutes: Number.isFinite(env.OXED_WS_SLA_MINUTES) ? env.OXED_WS_SLA_MINUTES : 30,
    slaHours: env.OXED_WS_SLA_HOURS || '1-5 08:00-16:00',
    template: env.OXED_WS_TEMPLATE || '',
    templateImg: env.OXED_WS_TEMPLATE_IMG || '',
    templateLang: env.OXED_WS_TEMPLATE_LANG || 'es_MX',
  };
}

export function isWsEnabled() {
  return wsConfig().enabled;
}

const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);

/** Contacto del equipo W&S por teléfono (compara últimos 10 dígitos), o null. */
export function supportContactByPhone(phone, contacts = wsConfig().contacts) {
  const tail = last10(phone);
  if (!tail) return null;
  return contacts.find((c) => last10(c.phone) === tail) || null;
}
