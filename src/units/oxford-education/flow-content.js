import { getOxfordFlowRows } from '../../core/sheets/cache.js';
import { normalize } from '../../core/flow/text.js';
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

/**
 * Etiquetas de un menú numerado CONSERVANDO el texto original:
 *   "1.- Smile and Learn" → { '1': 'Smile and Learn' }
 *
 * Deliberadamente NO reusa parseMenuLabels() de core/flow/text.js: aquella
 * normaliza (minúsculas, sin acentos ni puntuación) porque su trabajo es
 * comparar lo que escribió el usuario. Aquí el texto se muestra tal cual.
 */
export function rawMenuLabels(texto) {
  const out = {};
  for (const line of String(texto ?? '').split('\n')) {
    const m = line.match(/^\s*(\d{1,2})\s*[.\-)]*\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * Cómo se llama un nodo en el menú que lo ofrece: "n_3_4" → "AINARA".
 *
 * El nodo hoja NO sabe su propio nombre (su texto es la descripción), así que
 * se busca en el menú padre. Sirve para decirle a la asesora QUÉ producto
 * estaba viendo el prospecto en vez del id del nodo.
 *
 * @returns {string|null} la etiqueta, o null si ningún menú apunta a ese nodo
 */
export function menuLabelFor(graph, nodeId) {
  for (const node of Object.values(graph || {})) {
    if (!isMenuNode(node)) continue;
    const labels = rawMenuLabels(node.texto);
    for (const [opt, dest] of Object.entries(node.opciones)) {
      if (dest === nodeId && labels[opt]) return labels[opt];
    }
  }
  return null;
}

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
 * La etiqueta del menú SI el nodo es un producto de verdad; null si no lo es.
 *
 * Definición ÚNICA de "producto del menú", usada por dos cosas que no pueden
 * discrepar: el bloque de conocimiento que lee el LLM (knowledge.js) y el
 * producto que se estampa en el ticket de la asesora (flow-engine.js). Si esto
 * se equivoca, la asesora recibe "Producto: Quiero información".
 *
 * Quedan fuera: los menús (su texto es una lista), el saludo, los pasos de
 * captura, los nodos util_* y las salidas de navegación ("No estoy seguro").
 */
export function productLabelFor(graph, nodeId) {
  const node = (graph || {})[nodeId];
  if (!node || isMenuNode(node)) return null;
  if (NON_CONTENT_NODE_IDS.has(node.id) || NON_CONTENT_PREFIX.test(node.id)) return null;

  const label = menuLabelFor(graph, nodeId);
  if (!label || NON_PRODUCT_LABELS.has(normalize(label))) return null;
  return label;
}
