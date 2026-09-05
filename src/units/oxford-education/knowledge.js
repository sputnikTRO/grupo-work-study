import { getOxfordFAQ } from '../../core/sheets/cache.js';
import { loadFlowGraph, isMenuNode } from './flow-content.js';
import { normalize } from '../../core/flow/text.js';
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

// Nodos de "Flujo Ori" que NO son conocimiento de producto. Los nodos con
// opciones numeradas (menu_principal, filtro_previo, cat_*) se descartan solos
// vía isMenuNode: su texto es una lista de opciones, no una descripción. Aquí
// solo quedan las hojas que tampoco describen nada.
const NON_CONTENT_NODE_IDS = new Set([
  'bienvenida',       // saludo + horario
  'solicitud_datos',  // paso de captura de datos (lo consume flow-engine)
  'ya_inscrito_stub', // paso de captura de datos (lo consume flow-engine)
]);
const NON_CONTENT_PREFIX = /^util_/; // util_menu / util_llamada / util_cierre

// Etiquetas que son una SALIDA DE NAVEGACIÓN ("no sé cuál elegir"), no un
// producto: su nodo existe para orientar a quien duda, no para describir algo
// que vendemos. Sin este filtro, cat_1 metía "No estoy seguro" en la lista y el
// LLM lo leía como un producto más del catálogo — justo el tipo de confusión
// que esta sección viene a evitar. Se compara la etiqueta, no el ID, para que
// también aplique si el cliente agrega la misma salida a otra categoría.
const NON_PRODUCT_LABELS = new Set([
  'no estoy seguro', 'no estoy segura', 'no lo se', 'no se', 'aun no se',
  'otro', 'otra', 'ninguno', 'ninguna',
]);

/**
 * Etiquetas de un menú numerado CONSERVANDO el texto original:
 *   "1.- Smile and Learn" → { '1': 'Smile and Learn' }
 *
 * Deliberadamente NO reusa parseMenuLabels() de core/flow/text.js: aquella
 * normaliza (minúsculas, sin acentos ni puntuación) porque su trabajo es
 * comparar lo que escribió el usuario. Aquí el texto se le muestra al LLM, así
 * que "KNOW BY STEAM TREKS" debe llegar tal cual.
 */
function rawMenuLabels(texto) {
  const out = {};
  for (const line of String(texto ?? '').split('\n')) {
    const m = line.match(/^\s*(\d{1,2})\s*[.\-)]*\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

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
      if (isMenuNode(node)) continue;
      if (NON_CONTENT_NODE_IDS.has(node.id) || NON_CONTENT_PREFIX.test(node.id)) continue;

      const padre = parentOf[node.id];
      if (!padre) continue; // hoja a la que ningún menú apunta: no se le ofrece a nadie
      if (NON_PRODUCT_LABELS.has(normalize(padre.label))) continue;

      const categoria = parentOf[padre.parentId]?.label || padre.parentId;
      if (!grupos.has(categoria)) grupos.set(categoria, []);
      grupos.get(categoria).push({ label: padre.label || node.id, texto: node.texto });
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
