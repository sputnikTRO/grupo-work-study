import { getTravelFlowRows } from '../../core/sheets/cache.js';
import logger from '../../utils/logger.js';

/**
 * Travel (Miri) — Grafo del "Flujo Miri" (contenido)
 *
 * Gemelo de units/oxford-education/flow-content.js: convierte las filas de la
 * pestaña "Flujo Miri" (sembradas por scripts/seed-miri-flow.js) en un grafo en
 * memoria: id → { id, texto, opciones, material }.
 *
 * Schema de la fila:
 *   ID | Estado | Texto | Destino opción 1..5 | Notas | Orden | Material
 *
 * `Material` es la única columna que Miri agrega sobre el schema de Ori: el ID
 * del material a enviar en los nodos de material (columna aditiva al final, así
 * que no mueve Notas ni Orden). Vacía en e4l_material porque ahí el material se
 * resuelve por destino del colegio.
 *
 * Cache/TTL lo resuelve src/core/sheets/cache.js (Redis + backup en memoria);
 * este módulo NO añade una capa propia — reconstruir el grafo desde filas ya
 * cacheadas es barato (21 filas) y así nunca queda más viejo que el cache.
 *
 * FALLBACK SEGURO: si la hoja no cargó o le faltan nodos críticos ('bienvenida'
 * o 'filtro_previo'), loadFlowGraph() devuelve null y flow-engine.js cede el
 * turno completo al camino LLM existente — el bot NUNCA se cae por esto.
 */

const OPTION_COLUMNS = [
  'Destino opción 1',
  'Destino opción 2',
  'Destino opción 3',
  'Destino opción 4',
  'Destino opción 5',
];

// Nodos sin los que el flujo determinístico no puede arrancar de forma segura.
const REQUIRED_NODE_IDS = ['bienvenida', 'filtro_previo'];

/**
 * @param {Object} row - Fila con headers como llaves
 * @returns {{id: string, texto: string, opciones: Object<string,string>, material: string}|null}
 */
function parseNode(row) {
  const id = (row['ID'] || '').trim();
  const texto = row['Texto'];
  if (!id || !texto) return null;

  const opciones = {};
  OPTION_COLUMNS.forEach((col, i) => {
    const dest = (row[col] || '').trim();
    if (dest) opciones[String(i + 1)] = dest;
  });

  return { id, texto, opciones, material: (row['Material'] || '').trim() };
}

/**
 * Carga y parsea el grafo completo del flujo desde el cache de Sheets.
 * @returns {Promise<Object|null>} Map { [nodeId]: node } o null (fallback al LLM)
 */
export async function loadFlowGraph() {
  const log = logger.child({ unit: 'travel', fn: 'flow-content.loadFlowGraph' });

  try {
    const rows = await getTravelFlowRows();

    if (!rows || rows.length === 0) {
      log.warn('Flujo Miri cache vacío — flujo determinístico deshabilitado este turno (fallback a LLM)');
      return null;
    }

    const graph = {};
    for (const row of rows) {
      const node = parseNode(row);
      if (node) graph[node.id] = node;
    }

    const missing = REQUIRED_NODE_IDS.filter((id) => !graph[id]);
    if (missing.length > 0) {
      log.error({ missing }, 'Flujo Miri sin nodos requeridos — flujo determinístico deshabilitado (fallback a LLM)');
      return null;
    }

    return graph;
  } catch (error) {
    log.error({ err: error }, 'Error cargando Flujo Miri — flujo determinístico deshabilitado (fallback a LLM)');
    return null;
  }
}

/**
 * @param {Object} graph - Grafo de loadFlowGraph()
 * @param {string} nodeId
 * @returns {Object|null}
 */
export function getNode(graph, nodeId) {
  if (!graph || !nodeId) return null;
  return graph[nodeId] || null;
}

/** ¿Este nodo tiene menú numerado? Si no, es hoja (CTA, captura o utilitario). */
export function isMenuNode(node) {
  return Boolean(node && node.opciones && Object.keys(node.opciones).length > 0);
}
