import * as sheetsCache from '../../core/sheets/cache.js';
import logger from '../../utils/logger.js';

/**
 * Travel Knowledge Builder
 *
 * Builds dynamic knowledge from Google Sheets to inject into Claude's system prompt
 *
 * NUEVA ESTRUCTURA SIMPLIFICADA (Mayo 2026):
 * - Headers en español
 * - Precios por colegio con fallback a "TODOS"
 * - Materiales por colegio con fallback a "TODOS"
 * - Info General unifica FAQ + Info_Viajes
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
    // Only include prices if the school is registered (found in Sheets).
    // For unregistered schools, prices are omitted so Claude cannot share them.
    const trips = await sheetsCache.getActiveTrips();
    sections.push(await buildTripsSection(trips, schoolCode, !!school));

    // Get activities
    if (trips.length > 0) {
      for (const trip of trips) {
        if (trip['Código']) {
          const activities = await sheetsCache.getActivities(trip['Código']);
          if (activities.length > 0) {
            sections.push(buildActivitiesSection(trip['Código'], activities));
          }
        }
      }
    }

    // Get materials
    const materials = await sheetsCache.getMaterials(
      trips.length > 0 ? trips[0]['Código'] : null,
      schoolCode
    );
    if (materials.length > 0) {
      sections.push(buildMaterialsSection(materials));
    }

    // Get Info General (includes trip details + FAQ)
    if (trips.length > 0) {
      for (const trip of trips) {
        if (trip['Código']) {
          const infoGeneral = await sheetsCache.getInfoGeneral(trip['Código']);
          if (infoGeneral.length > 0) {
            sections.push(buildInfoGeneralSection(trip['Código'], infoGeneral));
          }
        }
      }
    }

    // Get FAQ (general info with Código Viaje = TODOS)
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
 * New structure: Código, Nombre Colegio, Asesora, WhatsApp Asesora, Email Asesora, Zona
 */
function buildSchoolSection(school) {
  return `## INFORMACIÓN DEL COLEGIO

Código: ${school['Código']}
Nombre: ${school['Nombre Colegio']}
${school['Zona'] ? `Zona: ${school['Zona']}` : ''}`;
}

/**
 * Builds trips information section with PRICES PER SCHOOL
 * New structure: Código, Destino, Descripción, Fecha Salida, Fecha Regreso, Estado
 * Prices come from separate "Precios" sheet with fallback to "TODOS"
 */
async function buildTripsSection(trips, schoolCode, schoolIsRegistered = false) {
  if (trips.length === 0) {
    return '## VIAJES DISPONIBLES\n\nNo hay viajes activos en este momento.';
  }

  const tripTexts = [];

  for (const trip of trips) {
    let text = `**${trip['Código'] || 'Viaje'}**\n`;

    if (trip['Destino']) {
      text += `- Destino: ${trip['Destino']}\n`;
    }

    if (trip['Descripción']) {
      text += `- Descripción: ${trip['Descripción']}\n`;
    }

    if (trip['Fecha Salida']) {
      text += `- Fecha de salida: ${trip['Fecha Salida']}\n`;
    }

    if (trip['Fecha Regreso']) {
      text += `- Fecha de regreso: ${trip['Fecha Regreso']}\n`;
    }

    // Only include prices for registered schools.
    // For unregistered schools, prices are intentionally omitted so Claude
    // cannot quote them — the human advisor handles pricing for those schools.
    if (trip['Código'] && schoolIsRegistered) {
      const price = await sheetsCache.getPrice(trip['Código'], schoolCode);
      if (price) {
        text += `\n**INFORMACIÓN DE PRECIOS:**\n`;
        if (price['Precio Total']) {
          text += `- Precio total: $${price['Precio Total']} MXN\n`;
        }
        if (price['Apartado']) {
          text += `- Apartado: $${price['Apartado']} MXN\n`;
        }
        if (price['Mensualidades'] && price['Meses']) {
          text += `- Mensualidades: ${price['Mensualidades']} pagos de ${price['Meses']} meses\n`;
        }
        if (price['Fecha Límite Pago']) {
          text += `- Fecha límite de pago: ${price['Fecha Límite Pago']}\n`;
        }
        if (price['Notas']) {
          text += `- Notas: ${price['Notas']}\n`;
        }
      }
    }

    tripTexts.push(text);
  }

  return `## VIAJES DISPONIBLES\n\n${tripTexts.join('\n')}`;
}

/**
 * Builds activities section for a specific trip
 * New structure: Código Viaje, Nombre, Precio, Descripción, Incluido, Fecha Límite
 */
function buildActivitiesSection(tripCode, activities) {
  const activityTexts = activities.map(activity => {
    let text = `**${activity['Nombre']}**\n`;

    if (activity['Precio']) {
      const precio = parseFloat(activity['Precio']);
      if (precio > 0) {
        text += `- Precio: $${activity['Precio']} MXN\n`;
      } else {
        text += `- Incluido en el precio base\n`;
      }
    }

    if (activity['Descripción']) {
      text += `- Descripción: ${activity['Descripción']}\n`;
    }

    if (activity['Incluido']) {
      text += `- Incluido: ${activity['Incluido']}\n`;
    }

    if (activity['Fecha Límite']) {
      text += `- Fecha límite para elegir: ${activity['Fecha Límite']}\n`;
    }

    return text;
  }).join('\n');

  return `## ACTIVIDADES EXTRAS DISPONIBLES - ${tripCode}\n\n${activityTexts}\n\n**Importante:** El grupo completo debe escoger la misma opción de actividades.`;
}

/**
 * Builds materials catalog section
 * New structure: ID, Nombre, Tipo, URL, Código Viaje, Código Colegio, Descripción
 */
function buildMaterialsSection(materials) {
  const materialTexts = materials.map(material => {
    let text = `- ${material['ID']}: ${material['Nombre']} (${material['Tipo'] || 'documento'})`;

    if (material['Descripción']) {
      text += ` - ${material['Descripción']}`;
    }

    // Indicate if it's school-specific or general
    if (material['Código Colegio'] && material['Código Colegio'] !== 'TODOS') {
      text += ` [Específico para este colegio]`;
    }

    return text;
  }).join('\n');

  return `## MATERIALES DISPONIBLES PARA ENVIAR\n\n${materialTexts}\n\nPara enviar un material, usa el tag: [ENVIAR_MATERIAL:ID]`;
}

/**
 * Builds FAQ section
 * New structure: Info General with Código Viaje = "TODOS" and Categoría = "FAQ"
 * Columns: Código Viaje, Categoría, Título, Contenido, Orden
 */
function buildFAQSection(faq) {
  const faqTexts = faq.map((item, index) => {
    return `${index + 1}. **P: ${item['Título']}**\n   R: ${item['Contenido']}`;
  }).join('\n\n');

  return `## PREGUNTAS FRECUENTES\n\n${faqTexts}`;
}

/**
 * Builds advisor information section
 * New structure: Asesora info is now in Colegios sheet
 */
function buildAdvisorSection(advisor) {
  return `## ASESORA ASIGNADA\n\nNombre: ${advisor.nombre}\n${advisor.whatsapp ? `WhatsApp: ${advisor.whatsapp}` : ''}\n\nCuando derives a esta asesora, menciona su nombre en el mensaje de despedida.`;
}

/**
 * Builds general information section for a trip
 * New structure: Info General replaces Info_Viajes
 * Columns: Código Viaje, Categoría, Título, Contenido, Orden
 *
 * Categories: Trámites, Clima, Equipaje, Conectividad, etc.
 *
 * @param {string} tripCode - Trip code (e.g., 'LON2026')
 * @param {Array} infoGeneral - Array of info objects for this trip
 * @returns {string} Formatted info section
 */
function buildInfoGeneralSection(tripCode, infoGeneral) {
  if (infoGeneral.length === 0) {
    return '';
  }

  // Filter out FAQ (already shown in separate section)
  const nonFaq = infoGeneral.filter(info =>
    info['Categoría']?.toLowerCase() !== 'faq'
  );

  if (nonFaq.length === 0) {
    return '';
  }

  // Group information by category
  const categoriesMap = {};
  nonFaq.forEach(info => {
    const categoria = info['Categoría'] || 'General';
    if (!categoriesMap[categoria]) {
      categoriesMap[categoria] = [];
    }
    categoriesMap[categoria].push(info);
  });

  // Build section for each category
  const categoryTexts = Object.entries(categoriesMap).map(([categoria, items]) => {
    const itemTexts = items.map(item => {
      let text = '';
      if (item['Título']) {
        text += `**${item['Título']}**\n`;
      }
      if (item['Contenido']) {
        text += `${item['Contenido']}\n`;
      }
      return text;
    }).join('\n');

    return `### ${categoria}\n\n${itemTexts}`;
  }).join('\n');

  return `## INFORMACIÓN DETALLADA DE ${tripCode}\n\n${categoryTexts}`;
}
