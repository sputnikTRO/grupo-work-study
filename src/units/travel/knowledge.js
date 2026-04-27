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

    // Get payment scheme if we have active trips
    // Note: Using 'codigo' field from trips (matches 'viaje_codigo' in payment schemes)
    if (trips.length > 0 && trips[0].codigo) {
      const paymentScheme = await sheetsCache.getPaymentScheme(trips[0].codigo, schoolCode);
      if (paymentScheme) {
        sections.push(buildPaymentSection(paymentScheme));
      }
    }

    // Get materials
    const materials = await sheetsCache.getMaterials(null, schoolCode);
    if (materials.length > 0) {
      sections.push(buildMaterialsSection(materials));
    }

    // Get Info_Viajes for each active trip
    if (trips.length > 0) {
      for (const trip of trips) {
        if (trip.codigo) {
          const infoViajes = await sheetsCache.getInfoViajes(trip.codigo);
          if (infoViajes.length > 0) {
            sections.push(buildInfoViajesSection(trip.codigo, infoViajes));
          }
        }
      }
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
 * Uses actual Google Sheets column names: codigo, destino, fechas_salida, precio, descripcion
 */
function buildTripsSection(trips, schoolCode) {
  if (trips.length === 0) {
    return '## VIAJES DISPONIBLES\n\nNo hay viajes activos en este momento.';
  }

  const tripTexts = trips.map(trip => {
    // Use 'codigo' as the name since 'nombre' doesn't exist in Sheets
    let text = `**${trip.codigo || 'Viaje'}**\n`;

    if (trip.destino) {
      text += `- Destino: ${trip.destino}\n`;
    }

    if (trip.fechas_salida) {
      text += `- Fechas: ${trip.fechas_salida}\n`;
    }

    // Use 'precio' field from Sheets (not 'precio_base')
    if (trip.precio) {
      text += `- Precio de referencia: $${trip.precio} MXN\n`;
    }

    if (trip.descripcion) {
      text += `- Descripción: ${trip.descripcion}\n`;
    }

    return text;
  }).join('\n');

  return `## VIAJES DISPONIBLES\n\n${tripTexts}`;
}

/**
 * Builds activities section
 * Uses actual Google Sheets column names: nombre, costo, descripcion, incluido
 */
function buildActivitiesSection(activities) {
  const activityTexts = activities.map(activity => {
    let text = `**${activity.nombre}**\n`;

    // Use 'costo' field from Sheets (not 'precio')
    if (activity.costo) {
      // Only show price if it's not 0 or "0"
      const costo = parseFloat(activity.costo);
      if (costo > 0) {
        text += `- Costo: $${activity.costo} MXN\n`;
      } else {
        text += `- Incluido en el precio base\n`;
      }
    }

    if (activity.descripcion) {
      text += `- Descripción: ${activity.descripcion}\n`;
    }

    // Use 'incluido' field from Sheets (not 'incluye')
    if (activity.incluido) {
      text += `- Incluido: ${activity.incluido}\n`;
    }

    return text;
  }).join('\n');

  return `## ACTIVIDADES EXTRAS DISPONIBLES\n\n${activityTexts}\n\n**Importante:** El grupo completo debe escoger la misma opción de actividades.`;
}

/**
 * Builds payment scheme section
 * Uses actual Google Sheets column names: viaje_codigo, modalidad, detalles, monto_inicial
 */
function buildPaymentSection(scheme) {
  let text = `## ESQUEMA DE PAGOS\n\n`;

  if (scheme.modalidad) {
    text += `**Modalidad:** ${scheme.modalidad}\n\n`;
  }

  if (scheme.monto_inicial) {
    text += `- Monto inicial: $${scheme.monto_inicial} MXN\n`;
  }

  if (scheme.detalles) {
    text += `- Detalles: ${scheme.detalles}\n`;
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

/**
 * Builds travel information section from Info_Viajes sheet
 * Organizes information by categories: Trámites, Clima, Equipaje, Conectividad, etc.
 * Uses actual Google Sheets column names: viaje_codigo, categoria, titulo, contenido
 *
 * @param {string} tripCode - Trip code (e.g., 'LON2026')
 * @param {Array} infoViajes - Array of info objects for this trip
 * @returns {string} Formatted info section
 */
function buildInfoViajesSection(tripCode, infoViajes) {
  if (infoViajes.length === 0) {
    return '';
  }

  // Group information by category
  const categoriesMap = {};
  infoViajes.forEach(info => {
    const categoria = info.categoria || 'General';
    if (!categoriesMap[categoria]) {
      categoriesMap[categoria] = [];
    }
    categoriesMap[categoria].push(info);
  });

  // Build section for each category
  const categoryTexts = Object.entries(categoriesMap).map(([categoria, items]) => {
    const itemTexts = items.map(item => {
      let text = '';
      if (item.titulo) {
        text += `**${item.titulo}**\n`;
      }
      if (item.contenido) {
        text += `${item.contenido}\n`;
      }
      return text;
    }).join('\n');

    return `### ${categoria}\n\n${itemTexts}`;
  }).join('\n');

  return `## INFORMACIÓN DETALLADA DE ${tripCode}\n\n${categoryTexts}`;
}
