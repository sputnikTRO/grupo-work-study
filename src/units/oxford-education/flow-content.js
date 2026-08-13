import { getOxfordFlowRows } from '../../core/sheets/cache.js';
import logger from '../../utils/logger.js';

/**
 * Oxford Education — Grafo del "Flujo Ori" (contenido)
 *
 * Convierte las filas crudas de la pestaña "Flujo Ori" (sembradas por
 * scripts/seed-ori-flow.js) en un grafo en memoria: id → { id, texto, opciones }.
 *
 * Schema de la fila (ver scripts/seed-ori-flow.js):
 *   ID | Estado | Texto | Destino opción 1..5 | Notas | Orden
 *
 * Cachea/TTL ya lo resuelve src/core/sheets/cache.js (Redis con
 * SHEETS_CACHE_TTL_SECONDS + backup en memoria). Este módulo NO añade una capa de
 * cache propia: reconstruir el grafo desde las filas ya cacheadas es barato
 * (30 filas) y así el grafo nunca queda más “viejo” que el cache de Sheets.
 *
 * FALLBACK SEGURO: si la hoja no cargó (fila vacía) o le faltan nodos críticos
 * ('bienvenida' o 'filtro_previo'), loadFlowGraph() devuelve null. El motor de
 * flujo (flow-engine.js) trata null como "flujo no disponible" y cede el turno
 * completo al camino LLM existente — el bot NUNCA se cae por esto.
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
 * Parsea una fila cruda del Sheet a un nodo del grafo.
 * @param {Object} row - Fila con headers como llaves (ver OPTION_COLUMNS)
 * @returns {{id: string, texto: string, opciones: Object<string,string>}|null}
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

  return { id, texto, opciones };
}

/**
 * Carga y parsea el grafo completo del flujo desde el cache de Sheets.
 *
 * @returns {Promise<Object|null>} Map { [nodeId]: node } o null si la hoja no
 *   cargó o le faltan nodos requeridos (fallback seguro al camino LLM).
 */
export async function loadFlowGraph() {
  const log = logger.child({ unit: 'oxford_education', fn: 'flow-content.loadFlowGraph' });

  try {
    const rows = await getOxfordFlowRows();

    if (!rows || rows.length === 0) {
      log.warn('Flujo Ori cache vacío — flujo determinístico deshabilitado este turno (fallback a LLM)');
      return null;
    }

    const graph = {};
    for (const row of rows) {
      const node = parseNode(row);
      if (node) graph[node.id] = node;
    }

    const missing = REQUIRED_NODE_IDS.filter((id) => !graph[id]);
    if (missing.length > 0) {
      log.error({ missing }, 'Flujo Ori sin nodos requeridos — flujo determinístico deshabilitado (fallback a LLM)');
      return null;
    }

    return graph;
  } catch (error) {
    log.error({ err: error }, 'Error cargando Flujo Ori — flujo determinístico deshabilitado (fallback a LLM)');
    return null;
  }
}

/**
 * @param {Object} graph - Grafo de loadFlowGraph()
 * @param {string} nodeId
 * @returns {{id: string, texto: string, opciones: Object}|null}
 */
export function getNode(graph, nodeId) {
  if (!graph || !nodeId) return null;
  return graph[nodeId] || null;
}

/**
 * ¿Este nodo tiene menú numerado (opciones)? Si no, es un nodo hoja (CTA de
 * producto, o uno de los pasos especiales solicitud_datos/ya_inscrito_stub).
 * @param {{opciones: Object}} node
 * @returns {boolean}
 */
export function isMenuNode(node) {
  return Boolean(node && node.opciones && Object.keys(node.opciones).length > 0);
}
