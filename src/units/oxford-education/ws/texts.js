/**
 * W&S OTCC — textos fijos (respaldo). Los nodos con el mismo id en la pestaña
 * "Flujo Ori" ganan sobre estos: el cliente los puede editar ahí. Estos solo
 * salen si el Sheet no tiene el nodo o no cargó.
 */
export const WS_NODE_IDS = {
  FILTRO: 'ws_filtro',
  FILTRO_PROGRAMA: 'ws_filtro_programa',
  NO_SEGURO: 'ws_no_seguro',
  TEMA: 'ws_tema',
  MODO: 'ws_otcc',      // en el modo: cada turno lo contesta el LLM con la base W&S
  DATOS: 'ws_datos',    // capturando los datos del caso
};

export const WS_TEXTS = {
  ws_filtro: '¿Formas parte de algún programa, como Work and Study?\n1.- Sí, estoy en Work and Study\n2.- No / otro programa\n3.- No estoy seguro',
  ws_filtro_programa: '¿Tu programa es Work and Study?\n1.- Sí, Work and Study\n2.- No, es otro programa\n3.- No estoy seguro',
  ws_no_seguro: 'Si recibiste información de tu certificación a través del grupo de WhatsApp de W&S o del equipo de Work and Study, formas parte del programa. ¿Es tu caso?\n1.- Sí\n2.- No\n3.- Sigo sin estar seguro',
  ws_tema: '¿Tu duda es sobre tu certificación Oxford TCC (OTCC)?\n1.- Sí, sobre mi certificación OTCC\n2.- Es sobre otro tema',
  ws_otcc: 'Perfecto 😊 Cuéntame tu duda sobre tu certificación OTCC y te ayudo.',
  reintento: 'Para orientarte bien, respóndeme con el número de la opción 😊',
  pedir_datos: 'Para canalizar tu caso, compárteme por favor: tu nombre completo, el correo electrónico con el que te registraste, la etapa de evaluación y una breve descripción de lo que sucede. Si aparece un error en pantalla, adjunta una captura.',
  captura_recibida: 'Recibí tu captura 👍',
};

/** Nombre legible de cada dato del caso, para pedir lo que falta. */
export const CASE_FIELD_LABELS = {
  fullName: 'tu nombre completo',
  email: 'el correo electrónico con el que te registraste',
  stage: 'la etapa de evaluación (Diagnóstico, Mock, Certificación o Speaking)',
  description: 'una breve descripción de lo que sucede',
};
