/**
 * Oxford Education → Travel: handoff CRUZADO de unidad.
 *
 * El menú de Ori ofrece cuatro experiencias internacionales (English Life,
 * Rising STARS, Global Insights, Wish and Go) que NO las atiende el equipo de
 * Oxford sino el de viajes. Hasta ahora esos leads se derivaban a la asesora de
 * zona de Oxford, que no lleva viajes y tenía que reenviarlos a mano.
 *
 * POR QUÉ ES UN MÓDULO APARTE Y NO UNA LLAMADA AL HANDOFF DE MIRI:
 * las dos unidades mandan WhatsApp con credenciales distintas. Miri usa
 * core/whatsapp/client.js con el phone_number_id de Travel; Ori usa su propio
 * whatsapp.js con los OXED_*. Si Ori llamara a executeHandoffToAdvisor de
 * travel tal cual, el "te conecto con…" le llegaría al prospecto DESDE EL
 * NÚMERO DE MIRI, en un chat que él abrió con Ori. Por eso los dos envíos van
 * separados:
 *   - al prospecto se le responde por ORI (su chat, su número);
 *   - a la asesora de viajes se le notifica por TRAVEL, para que reciba el
 *     ticket desde el número que conoce y con la plantilla aprobada de esa WABA.
 *
 * OJO — esto cruza a propósito el aislamiento entre unidades que documenta
 * CLAUDE.md: crea filas en travel_leads desde Oxford y reutiliza el catálogo de
 * asesoras y el formato de ticket de Miri. Es deliberado y está acotado a este
 * archivo; la tabla Contact ya era compartida, así que el contacto es el mismo.
 */

import { pickAdvisor } from '../travel/advisors.js';
import { sendAdvisorNotification } from '../travel/actions.js';
import * as travelLeadService from '../../services/lead.service.js';
import * as oxfordLeadService from './lead.service.js';
import { sendTextMessage } from './whatsapp.js';
import * as messageService from '../../services/message.service.js';
import * as store from './store.js';
import { env } from '../../config/env.js';

/**
 * Producto del menú de Ori → track del carrusel de Miri.
 *
 * Se casa contra la ETIQUETA (no el id del nodo) para que siga funcionando si
 * el cliente renumera los nodos en "Flujo Ori". English Life depende del tipo
 * de lead: un colegio va con las asesoras de institución, una familia con la
 * de familias.
 */
const TRAVEL_TRACKS = [
  [/rising/, () => 'rising_stars'],
  [/english life/, (lead) => (lead?.leadType === 'b2b_institutional' ? 'colegio' : 'familia')],
  [/global insights/, () => 'colegio'],
  [/wish and go/, () => 'colegio'],
];

/** @returns {'colegio'|'familia'|'rising_stars'|null} null = no es de viajes */
export function travelTrackFor(productLabel, lead) {
  const n = String(productLabel || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!n) return null;
  return TRAVEL_TRACKS.find(([re]) => re.test(n))?.[1](lead) || null;
}

/** ¿Este producto lo atiende el equipo de viajes? */
export function isTravelProduct(productLabel) {
  return travelTrackFor(productLabel, null) !== null;
}

/**
 * Deriva al equipo de viajes: crea/actualiza el TravelLead, asigna asesora del
 * carrusel de Miri, la notifica por Travel y le responde al prospecto por Ori.
 *
 * @returns {Promise<{handedOff: boolean, advisor?: Object, track?: string}>}
 *   handedOff:false si el producto no es de viajes, si ya estaba derivado
 *   (guard anti-redisparo) o si algo falló — en todos esos casos el llamador
 *   sigue con su camino normal y Ori nunca se queda muda.
 */
export async function handoffToTravel({ lead, conv, contact, productLabel, reason, log }) {
  const track = travelTrackFor(productLabel, lead);
  if (!track) return { handedOff: false };

  try {
    const travelLead = await travelLeadService.findOrCreateTravelLead(contact.id);

    // Guard anti-redisparo: si ya hay asesora de viajes, no se duplica ticket.
    if (travelLead.status === 'derivado_asesor' && travelLead.assignedAdvisor) {
      log.info({ assignedAdvisor: travelLead.assignedAdvisor }, 'Lead de viajes ya derivado — no se re-notifica');
      return { handedOff: false, yaDerivado: true, advisor: { nombre: travelLead.assignedAdvisor } };
    }

    // Lo que Ori ya capturó se copia al lead de viajes: el prospecto no debería
    // tener que repetir sus datos porque cambió de equipo interno.
    const datos = {
      parentName: lead.fullName || travelLead.parentName,
      schoolCode: lead.institutionName || travelLead.schoolCode,
      programInterest: productLabel,
      leadType: lead.leadType === 'b2b_institutional' ? 'institucion' : 'familia',
      notes: [travelLead.notes, `[Vía Ori] ${reason || `Interés en ${productLabel}`}`].filter(Boolean).join('\n'),
    };
    await travelLeadService.updateTravelLead(travelLead.id, datos);
    Object.assign(travelLead, datos);

    const advisor = await pickAdvisor(track, log);
    if (!advisor) {
      log.warn({ track }, 'Sin asesora de viajes disponible — se cede al camino normal de Oxford');
      return { handedOff: false };
    }

    await travelLeadService.updateTravelLead(travelLead.id, { assignedAdvisor: advisor.nombre });
    await travelLeadService.updateTravelLeadStatus(travelLead.id, 'derivado_asesor');
    Object.assign(travelLead, { assignedAdvisor: advisor.nombre, status: 'derivado_asesor' });

    // El motivo lleva el origen: la asesora de viajes ve de dónde vino el lead.
    const motivo = `Vía Ori (Oxford Education) — ${reason || `interés en ${productLabel}`}`;
    await sendAdvisorNotification(
      advisor, travelLead, conv, contact.phone, motivo,
      env.WA_PHONE_NUMBER_ID_TRAVEL, log, track, undefined,
    );

    // Al prospecto le responde ORI, en SU chat. Se le avisa explícitamente que
    // el mensaje llegará desde OTRO número: si no, lo lee como spam o cree que
    // nadie lo contactó.
    const aviso =
      `¡Perfecto! 😊 ${productLabel} lo lleva nuestro equipo de viajes educativos. ` +
      `Te conecto con ${advisor.nombre}, que te escribe en breve por WhatsApp desde otro número ` +
      `para ver fechas, detalles y los siguientes pasos.\n\n` +
      `Mientras tanto, aquí sigo para cualquier duda de certificaciones o plataformas. 🌎`;
    await sendTextMessage(contact.phone, aviso);
    await messageService.createOutbound(conv.id, aviso);
    await store.addMessage(conv.id, 'assistant', aviso);

    // El lead de Oxford NO se deriva a una asesora de Oxford: notificar a dos
    // equipos por el mismo prospecto es peor que no notificar a ninguno. Se deja
    // marcado y trazable, sin arrancar el SLA de Oxford.
    const marca = {
      tags: Array.from(new Set([...(lead.tags || []), 'derivado_travel'])),
      notes: [lead.notes, `[TRAVEL] Derivado a ${advisor.nombre} (${track}) — ticket de viajes #${travelLead.ticketNumber ?? '?'}`]
        .filter(Boolean).join('\n'),
    };
    await oxfordLeadService.updateOxfordLead(lead.id, marca);
    Object.assign(lead, marca);

    log.info({ advisor: advisor.nombre, track, travelTicket: travelLead.ticketNumber, productLabel },
      'Handoff cruzado a Travel completado (Ori sigue activa)');
    return { handedOff: true, advisor, track };
  } catch (error) {
    // Nunca dejar al prospecto sin respuesta: si esto falla, el llamador sigue
    // con el handoff normal de Oxford.
    log.error({ err: error, productLabel }, 'Error en el handoff cruzado a Travel — se cede al camino de Oxford');
    return { handedOff: false };
  }
}
