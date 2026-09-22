import { getOxfordFAQ } from '../../core/sheets/cache.js';
import { loadFlowGraph, isMenuNode, rawMenuLabels, productLabelFor } from './flow-content.js';
import logger from '../../utils/logger.js';

const PROGRAM_LABELS = {
  oxford_tcc: 'Oxford TCC',
  oxford_tcc_kids: 'Oxford TCC Kids',
  english_teaching_certificate: 'Oxford English Teaching Certificate (ETC)',
  alphable: 'Alphable',
  oxford_life: 'Oxford LIFE',
  rising_stars: 'Rising Stars',
  work_study_spain: 'Work & Study Spain',
  smile_and_learn: 'Smile and Learn',
  // La etiqueta lleva TODOS los nombres con que el prospecto puede preguntar:
  // es lo único que le dice al LLM a qué producto pertenece cada ficha.
  oxford_data_analytics: 'The Oxford Data Analytics (examen diagnóstico multinivel y Oxford Checkpoint)',
  ainara: 'AINARA',
  visual_camp: 'Visual Camp (READ by Visual Camp)',
  // Filas de política general: el bucket al que caen las que no declaran
  // Programa. La etiqueta dice a qué aplican, porque un "### TODOS" suelto no
  // le dice al LLM que la política cubre también al Oxford TCC.
  TODOS: 'Aplica a TODAS las certificaciones (Oxford TCC, TCC Kids, ETC, Checkpoint)',
};

/**
 * Formats an array of FAQ sheet rows into a Markdown-style knowledge block
 * for injection into the system prompt.
 *
 * @param {Array<Object>} rows - Rows from 'FAQ Oxford' sheet
 * @returns {string}
 */
function formatFAQBlock(rows) {
  const grouped = new Map();

  for (const row of rows) {
    const prog = row['Programa'] || 'TODOS';
    if (!grouped.has(prog)) grouped.set(prog, []);
    grouped.get(prog).push(row);
  }

  const lines = [
    '### Detalle por programa',
    '',
  ];

  for (const [prog, items] of grouped) {
    const label = PROGRAM_LABELS[prog] || prog;
    lines.push(`### ${label}`);
    for (const item of items) {
      const q = (item['Pregunta'] || '').trim();
      const r = (item['Respuesta'] || '').trim();
      if (q && r) {
        lines.push(`P: ${q}`);
        lines.push(`R: ${r}`);
        lines.push('');
      }
    }
  }

  return lines.join('\n').trimEnd();
}

/**
 * Builds the dynamic knowledge block for Ori's system prompt.
 *
 * Triple fallback (handled transparently by cache.js):
 *   1. Redis cache hit → rows from cache
 *   2. Redis miss → lastSuccessfulCache in-memory backup
 *   3. Both fail → empty array
 *
 * Returns:
 *   string  — Sheets data is available; handler injects it, skips hardcoded programs.
 *   null    — All caches empty; handler falls back to OXFORD_BASE_PROMPT unchanged.
 *
 * @param {Object|null} lead - OxfordLead (used for future per-program filtering)
 * @returns {Promise<string|null>}
 */
export async function buildOxfordKnowledge(lead) {
  const log = logger.child({ unit: 'oxford_education', fn: 'buildOxfordKnowledge' });

  try {
    const rows = await getOxfordFAQ();

    if (!rows || rows.length === 0) {
      log.warn('FAQ Oxford cache empty — falling back to hardcoded prompt');
      return null;
    }

    log.info({ rowCount: rows.length }, 'Oxford FAQ loaded from cache');
    return formatFAQBlock(rows);
  } catch (error) {
    log.error({ err: error }, 'Error building Oxford knowledge — falling back to hardcoded prompt');
    return null;
  }
}

// ── Conocimiento del menú ("Flujo Ori") ──────────────────────────────────────
//
// El flujo determinístico ya envía estos textos VERBATIM cuando el prospecto
// navega el menú. Esta sección los pone además a disposición del LLM, para que
// pueda contestar de la misma forma cuando la pregunta llega en texto libre
// ("¿qué es AINARA?") en vez de por número de opción.
//
// Es aditivo: no cambia el grafo, ni la navegación, ni el orden de los nodos.
// Lee del MISMO cache que el motor de flujo (loadFlowGraph → getOxfordFlowRows),
// así el prompt nunca queda más viejo que el menú que el prospecto está viendo.

/**
 * Para cada nodo, quién lo ofrece y con qué etiqueta:
 *   { n_3_4: { parentId: 'cat_3', label: 'AINARA' }, cat_3: { parentId: 'menu_principal', label: 'Plataformas para el aula' } }
 * Encadenando dos saltos se obtiene la categoría de cada producto sin
 * hardcodear ninguna: sale del propio menú.
 */
function indexParents(graph) {
  const parentOf = {};
  for (const node of Object.values(graph)) {
    if (!isMenuNode(node)) continue;
    const labels = rawMenuLabels(node.texto);
    for (const [opt, destId] of Object.entries(node.opciones)) {
      if (!parentOf[destId]) parentOf[destId] = { parentId: node.id, label: labels[opt] || '' };
    }
  }
  return parentOf;
}

/**
 * Bloque de conocimiento con las descripciones de producto del menú, agrupadas
 * por la categoría bajo la que el propio menú las ofrece.
 *
 * Fallback seguro (igual que buildOxfordKnowledge): cualquier problema devuelve
 * null y el prompt sale sin esta sección — nunca rompe el turno.
 *
 * @returns {Promise<string|null>}
 */
export async function buildFlowKnowledge() {
  const log = logger.child({ unit: 'oxford_education', fn: 'buildFlowKnowledge' });

  try {
    const graph = await loadFlowGraph();
    if (!graph) {
      log.warn('Flujo Ori no disponible — el prompt sale sin la sección de productos del menú');
      return null;
    }

    const parentOf = indexParents(graph);
    const grupos = new Map(); // categoría → [{ label, texto }], en el orden del Sheet

    for (const node of Object.values(graph)) {
      const label = productLabelFor(graph, node.id);
      if (!label) continue; // menú, saludo, paso de captura o salida de navegación

      const padre = parentOf[node.id];
      const categoria = parentOf[padre.parentId]?.label || padre.parentId;
      if (!grupos.has(categoria)) grupos.set(categoria, []);
      grupos.get(categoria).push({ label, texto: node.texto });
    }

    const total = [...grupos.values()].reduce((n, items) => n + items.length, 0);
    if (total === 0) {
      log.warn('Flujo Ori sin nodos de contenido — el prompt sale sin la sección de productos del menú');
      return null;
    }

    const lines = [];
    for (const [categoria, items] of grupos) {
      lines.push(`### ${categoria}`);
      for (const { label, texto } of items) lines.push(`- **${label}**: ${texto}`);
      lines.push('');
    }

    log.info({ productos: total, categorias: grupos.size }, 'Conocimiento del menú (Flujo Ori) cargado');
    return lines.join('\n').trimEnd();
  } catch (error) {
    log.error({ err: error }, 'Error construyendo el conocimiento del menú — el prompt sale sin esa sección');
    return null;
  }
}
