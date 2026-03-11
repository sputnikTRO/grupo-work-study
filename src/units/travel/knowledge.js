import * as sheetsCache from '../../core/sheets/cache.js';
import logger from '../../utils/logger.js';

/**
 * Travel Knowledge Builder
 *
 * Builds dynamic knowledge from Google Sheets to inject into Claude's system prompt
 */

/**
 * Builds complete dynamic knowledge for a specific school
 * If no schoolCode provided, builds general knowledge
 *
 * @param {string|null} schoolCode - School code (e.g., 'WC', 'TH')
 * @returns {Promise<string>} Formatted knowledge text for system prompt
 */
export async function buildDynamicKnowledge(schoolCode = null) {
  const knowledgeLogger = logger.child({ schoolCode, function: 'knowledge.build' });

  try {
    const sections = [];

    // Get school info if provided
    let school = null;
    if (schoolCode) {
      school = await sheetsCache.getSchool(schoolCode);
      if (school) {
        sections.push(buildSchoolSection(school));
      }
    }

    // Get active trips
    const trips = await sheetsCache.getActiveTrips();
    sections.push(buildTripsSection(trips, schoolCode));

    // Get activities
    const activities = await sheetsCache.getActivities();
    if (activities.length > 0) {
      sections.push(buildActivitiesSection(activities));
    }

    // Get payment scheme if school is known
    if (schoolCode && trips.length > 0) {
      const paymentScheme = await sheetsCache.getPaymentScheme(trips[0].id, schoolCode);
      if (paymentScheme) {
        sections.push(buildPaymentSection(paymentScheme));
      }
    }

    // Get materials
    const materials = await sheetsCache.getMaterials(null, schoolCode);
    if (materials.length > 0) {
      sections.push(buildMaterialsSection(materials));
    }

    // Get FAQ
    const faq = await sheetsCache.getFAQ();
    if (faq.length > 0) {
      sections.push(buildFAQSection(faq));
    }

    // Get advisor if school is known
    if (schoolCode) {
      const advisor = await sheetsCache.getAdvisor(schoolCode);
      if (advisor) {
        sections.push(buildAdvisorSection(advisor));
      }
    }

    const knowledge = sections.join('\n\n');

    knowledgeLogger.debug({ sectionCount: sections.length, length: knowledge.length }, 'Dynamic knowledge built');

    return knowledge;

  } catch (error) {
    knowledgeLogger.error({ err: error }, 'Error building dynamic knowledge');
    return '## INFORMACIÓN DINÁMICA\n\nError cargando información de Google Sheets. Responde de forma general.';
  }
}

/**
 * Builds school information section
 */
function buildSchoolSection(school) {
  return `## INFORMACIÓN DEL COLEGIO

Código: ${school.codigo}
Nombre: ${school.nombre}
${school.contacto_profesor ? `Contacto profesor: ${school.contacto_profesor}` : ''}
${school.notas ? `Notas: ${school.notas}` : ''}`;
}

/**
 * Builds trips information section
 */
function buildTripsSection(trips, schoolCode) {
  if (trips.length === 0) {
    return '## VIAJES DISPONIBLES\n\nNo hay viajes activos en este momento.';
  }

  const tripTexts = trips.map(trip => {
    let text = `**${trip.nombre || 'Viaje'}**\n`;
    text += `- Destino: ${trip.destino || 'Londres'}\n`;
    text += `- Fecha de salida: ${trip.fecha_salida || 'Por confirmar'}\n`;
    text += `- Fecha de regreso: ${trip.fecha_regreso || 'Por confirmar'}\n`;
    text += `- Duración: ${trip.duracion || '9 días / 10 noches'}\n`;
    if (trip.precio_base) {
      text += `- Precio de referencia: $${trip.precio_base} MXN (varía por colegio y promoción)\n`;
    }
    if (trip.incluye) {
      text += `- Incluye: ${trip.incluye}\n`;
    }
    return text;
  }).join('\n');

  return `## VIAJES DISPONIBLES\n\n${tripTexts}`;
}

/**
 * Builds activities section
 */
function buildActivitiesSection(activities) {
  const activityTexts = activities.map(activity => {
    let text = `**${activity.nombre}**\n`;
    text += `- Precio: $${activity.precio} MXN\n`;
    if (activity.descripcion) {
      text += `- Descripción: ${activity.descripcion}\n`;
    }
    if (activity.incluye) {
      text += `- Incluye: ${activity.incluye}\n`;
    }
    return text;
  }).join('\n');

  return `## ACTIVIDADES EXTRAS DISPONIBLES\n\n${activityTexts}\n\n**Importante:** El grupo completo debe escoger la misma opción de actividades.`;
}

/**
 * Builds payment scheme section
 */
function buildPaymentSection(scheme) {
  let text = `## ESQUEMA DE PAGOS\n\n`;
  text += `- Apartado: $${scheme.apartado} MXN\n`;
  if (scheme.pago_con_beca) {
    text += `- Pago con promoción: $${scheme.pago_con_beca} MXN (fecha límite: ${scheme.fecha_limite_beca || 'ver con asesora'})\n`;
  }
  if (scheme.mensualidades) {
    text += `- Mensualidades: ${scheme.mensualidades}\n`;
  }
  if (scheme.seguro) {
    text += `- Seguro: $${scheme.seguro} MXN\n`;
  }
  if (scheme.notas) {
    text += `\nNotas importantes: ${scheme.notas}`;
  }

  return text;
}

/**
 * Builds materials catalog section
 */
function buildMaterialsSection(materials) {
  const materialTexts = materials.map(material => {
    return `- ${material.id}: ${material.nombre} (${material.tipo || 'documento'})${material.descripcion ? ' - ' + material.descripcion : ''}`;
  }).join('\n');

  return `## MATERIALES DISPONIBLES PARA ENVIAR\n\n${materialTexts}\n\nPara enviar un material, usa el tag: [ENVIAR_MATERIAL:ID]`;
}

/**
 * Builds FAQ section
 */
function buildFAQSection(faq) {
  const faqTexts = faq.map((item, index) => {
    return `${index + 1}. **P: ${item.pregunta}**\n   R: ${item.respuesta}`;
  }).join('\n\n');

  return `## PREGUNTAS FRECUENTES\n\n${faqTexts}`;
}

/**
 * Builds advisor information section
 */
function buildAdvisorSection(advisor) {
  return `## ASESORA ASIGNADA\n\nNombre: ${advisor.nombre}\n${advisor.whatsapp ? `WhatsApp: ${advisor.whatsapp}` : ''}\n\nCuando derives a esta asesora, menciona su nombre en el mensaje de despedida.`;
}
