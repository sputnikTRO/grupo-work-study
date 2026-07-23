/**
 * seed-oxford-faq.js
 *
 * Populates the 'FAQ Oxford' tab in Google Sheets with the canonical FAQ data
 * from docs/oxford/faq-productos.md.
 *
 * Schema: Programa | Categoría | Pregunta | Respuesta | Orden
 *
 * Usage:
 *   node scripts/seed-oxford-faq.js [--dry-run]
 *
 * Flags:
 *   --dry-run   Print rows that would be written without touching Sheets.
 *
 * NOTE: W&S Q6 about €3,600 is intentionally excluded.
 *       See docs/oxford/faq-productos.md for the marked entry.
 *       Confirm with the client before adding it.
 */

import dotenv from 'dotenv';
dotenv.config();

import { google } from 'googleapis';

// ── FAQ data ─────────────────────────────────────────────────────────────────
// Columns: [Programa, Categoría, Pregunta, Respuesta, Orden]

const FAQ_ROWS = [
  // ── Oxford TCC ──────────────────────────────────────────────────────────
  ['oxford_tcc', 'FAQ', '¿Para qué edad es adecuada esta certificación?', 'La certificación Oxford TCC se recomienda para estudiantes mayores de 12 años, sin límite de edad máxima. Para niños de 7 a 12 años se ofrece la versión Oxford TCC Kids.', 1],
  ['oxford_tcc', 'FAQ', '¿Qué niveles de inglés evalúa?', 'Evalúa los niveles A1 a C2 según el Marco Común Europeo de Referencia para las Lenguas (MCER), cubriendo todo el espectro de dominio del idioma.', 2],
  ['oxford_tcc', 'FAQ', '¿En qué consiste el proceso de certificación?', 'Tiene 3 etapas totalmente en línea: Diagnóstico (60-240 min) para detectar el nivel de dominio, Mock (110-265 min): examen simulado realista, y Certificación (110-265 min): evaluación definitiva con las 5 habilidades.', 3],
  ['oxford_tcc', 'FAQ', '¿El certificado tiene reconocimiento internacional?', 'Sí, es internacional y comparable con otras certificaciones. Oxford Education es miembro de la Association of Language Testers in Europe (ALTE), garantizando estándares de calidad internacionales.', 4],
  ['oxford_tcc', 'FAQ', '¿Cuánto tiempo toma obtener el certificado físico?', 'Los resultados se consultan 5 días hábiles después de cada etapa, y el certificado físico se entrega 3 semanas después de concluir todo el proceso.', 5],
  ['oxford_tcc', 'FAQ', '¿Cuánto tiempo de vigencia tiene el certificado?', 'El OTCC es una certificación vitalicia. Es la institución que la requiere quien define los términos de validez.', 6],
  ['oxford_tcc', 'FAQ', '¿Esta certificación tiene validez para el CENNI de la SEP?', 'Si lo requieres puedes solicitarlo previo a tu evaluación; en ese caso la vigencia cambia: A1 - Constancia por 1 año, A2 hasta C1 - Certificado por 5 años, C2 - Diploma por 10 años.', 7],
  ['oxford_tcc', 'FAQ', '¿Cómo se evalúa la expresión oral?', 'La prueba oral es realizada por hablantes nativos o expertos (en línea o presencial), evaluando: fluidez, coherencia, interacción, variedad lingüística, pronunciación, entonación y gestión de la comunicación.', 8],

  // ── Oxford TCC Kids ──────────────────────────────────────────────────────
  ['oxford_tcc_kids', 'FAQ', '¿Qué es Oxford TCC Kids?', 'Es una certificación de inglés para niños de 7 a 12 años que evalúa habilidades lingüísticas de manera integral en una plataforma digital.', 1],
  ['oxford_tcc_kids', 'FAQ', '¿Para qué edades está diseñado?', 'Está diseñado para niños de 7 a 12 años.', 2],
  ['oxford_tcc_kids', 'FAQ', '¿Qué niveles certifica?', 'Evalúa niveles desde Pre A1 hasta B1.', 3],
  ['oxford_tcc_kids', 'FAQ', '¿Cómo está estructurado el proceso?', 'El proceso tiene tres etapas: diagnóstico, mock y certificación.', 4],
  ['oxford_tcc_kids', 'FAQ', '¿Cuánto dura la evaluación?', 'Depende del nivel y la etapa. El diagnóstico dura de 20 a 50 minutos, el mock de 50 a 90 minutos o más, y la certificación de 60 minutos en adelante.', 5],
  ['oxford_tcc_kids', 'FAQ', '¿Qué beneficios ofrece al estudiante?', 'Permite reconocer su progreso real, recibir retroalimentación y obtener una certificación internacionalmente reconocida.', 6],
  ['oxford_tcc_kids', 'FAQ', '¿Qué beneficios ofrece a la escuela?', 'Ayuda a monitorear el progreso de los alumnos, ofrece reportes por habilidad y brinda soporte técnico y pedagógico.', 7],
  ['oxford_tcc_kids', 'FAQ', '¿Cómo se verifica la identidad del estudiante?', 'Mediante grabación de video y revisión de identificación oficial al inicio de la evaluación.', 8],
  ['oxford_tcc_kids', 'FAQ', '¿Qué controles de seguridad tiene la evaluación?', 'Incluye barrido de cámara en 360°, uso de audífonos con cable, cámara encendida y control del entorno durante toda la sesión.', 9],

  // ── English Teaching Certificate ─────────────────────────────────────────
  ['english_teaching_certificate', 'Certificación', '¿Qué es el Oxford ETC?', 'Es una certificación internacional para docentes de inglés que fortalece sus competencias pedagógicas y metodológicas.', 1],
  ['english_teaching_certificate', 'Certificación', '¿Quién puede tomar el ETC?', 'Cualquier docente de inglés o profesional interesado en mejorar sus habilidades para enseñar el idioma.', 2],
  ['english_teaching_certificate', 'Certificación', '¿Necesito tener experiencia docente?', 'Sí, está diseñado principalmente para personas que ya imparten clases o desean profesionalizar su práctica docente.', 3],
  ['english_teaching_certificate', 'Certificación', '¿Cuánto dura el programa?', 'La certificación contempla aproximadamente 130 horas de formación y evaluación.', 4],
  ['english_teaching_certificate', 'Certificación', '¿Qué calificación necesito para aprobar?', 'El desempeño se reporta por niveles: Experto, Competente, Aceptable y En Desarrollo.', 5],
  ['english_teaching_certificate', 'Certificación', '¿Recibo un certificado?', 'Sí. Al concluir satisfactoriamente obtienes tu Oxford English Teaching Certificate.', 6],
  ['english_teaching_certificate', 'Certificación', '¿El certificado tiene vigencia?', 'No. El certificado es vitalicio.', 7],
  ['english_teaching_certificate', 'Certificación', '¿El curso de preparación está incluido?', 'Si lo deseas, el programa puede incluir un curso de preparación con sesiones estructuradas.', 8],
  ['english_teaching_certificate', 'Certificación', '¿La certificación tiene reconocimiento internacional?', 'Sí, es una certificación respaldada por Oxford Education.', 9],
  ['english_teaching_certificate', 'Training Course', '¿Quiénes pueden inscribirse en ETC?', 'Pueden inscribirse docentes o académicos interesados en fortalecer su práctica pedagógica del inglés: maestros de inglés como actualización, o profesionales que quieren enriquecer su metodología.', 10],
  ['english_teaching_certificate', 'Training Course', '¿Se necesita un nivel mínimo de inglés?', 'El requisito mínimo de entrada es tener un nivel igual o superior a B2 (MCER).', 11],
  ['english_teaching_certificate', 'Training Course', '¿El Training Course es obligatorio para certificarse?', 'No. El Training Course es opcional: sirve como preparación y guía (recomendado para mejorar resultados), pero la certificación ETC puede realizarse sin haberlo tomado.', 12],
  ['english_teaching_certificate', 'Training Course', '¿Cuánto dura el Training Course y cuántas horas implica?', 'Se completa en promedio en 12 semanas, con una carga total de 90 a 130 horas. Módulo 1: 30-40 h, Módulo 2: 40-60 h, Módulo 3: 15-30 h, Módulo 4 opcional (primaria): 90-120 h.', 13],
  ['english_teaching_certificate', 'Training Course', '¿Cómo está estructurada la certificación y cuántos exámenes hay?', 'La certificación es digital y consta de 3 o 4 exámenes. Cada examen tiene entre 80 y 160 preguntas; los tres primeros duran ~90 minutos cada uno, el cuarto ~120-150 minutos.', 14],
  ['english_teaching_certificate', 'Training Course', '¿Cuál es la escala de calificaciones?', 'A (Experto) 91-100, B (Competente) 81-90, C (Aceptable) 70-80, D (En Desarrollo) 0-69.', 15],
  ['english_teaching_certificate', 'Training Course', '¿Qué sucede si obtengo menos de 70 puntos?', 'Recibes un certificado de participación que indica los módulos certificados, el porcentaje obtenido y el nivel "En Desarrollo".', 16],
  ['english_teaching_certificate', 'Training Course', '¿Cuándo recibiré mi certificado?', 'El certificado se entrega cuatro semanas después de finalizar los exámenes. En certificaciones grupales, la emisión puede esperar hasta que concluya el último candidato del grupo.', 17],
  ['english_teaching_certificate', 'Training Course', '¿Qué materiales incluye el Training Course?', 'El paquete incluye 4 libros digitales, material multimedia de autogestión (videos, recursos didácticos), exámenes MOCK de 60 reactivos al finalizar cada módulo, y apoyo del equipo de educadores.', 18],
  ['english_teaching_certificate', 'Training Course', '¿En qué modalidades se ofrece?', 'La plataforma principal es asíncrona y autogestiva. Existe también una versión síncrona con foros y discusiones en línea.', 19],
  ['english_teaching_certificate', 'Training Course', '¿Qué diferencia tiene el Módulo 4?', 'Está diseñado para la enseñanza en la infancia (6-12 años): aborda desarrollo cognitivo, lectoescritura, planeación de clase y aprendizaje socioemocional. Es opcional, para docentes de educación primaria.', 20],

  // ── Alphable ─────────────────────────────────────────────────────────────
  ['alphable', 'FAQ', '¿A quién está dirigido Alphable?', 'Es ideal para niños (a partir de 10 años), jóvenes, universitarios, profesionistas y empresas. Para personas que desean aprender un idioma para viajar, trabajar o estudiar.', 1],
  ['alphable', 'FAQ', '¿Qué niveles ofrece?', 'Cursos alineados con el MCER, desde Pre A1 hasta C2.', 2],
  ['alphable', 'FAQ', '¿Cómo funcionan las clases?', 'Las clases son en línea y se desarrollan mediante actividades comunicativas con profesores expertos.', 3],
  ['alphable', 'FAQ', '¿Qué idiomas ofrecen?', 'Alphable ofrece diversos idiomas. Puedes consultar la disponibilidad del idioma de tu interés.', 4],
  ['alphable', 'FAQ', '¿Necesito hacer un examen para comenzar?', 'Sí. Se realiza un examen diagnóstico gratuito para conocer tu nivel.', 5],
  ['alphable', 'FAQ', '¿Las clases son individuales o grupales?', 'Puedes elegir entre clases individuales, grupos pequeños o Conversation Clubs.', 6],
  ['alphable', 'FAQ', '¿Cuánto duran las clases?', 'Las clases tienen una duración de 50 minutos.', 7],
  ['alphable', 'FAQ', '¿Cuántas clases incluye la suscripción mensual?', 'La suscripción mensual incluye 7 clases por mes.', 8],
  ['alphable', 'FAQ', '¿Puedo elegir mis horarios?', 'Sí, dependiendo de la modalidad contratada.', 9],
  ['alphable', 'FAQ', '¿Qué son los Conversation Clubs?', 'Son sesiones enfocadas únicamente en practicar conversación con profesores expertos.', 10],
  ['alphable', 'FAQ', '¿Recibo algún certificado al finalizar?', 'Sí. Al finalizar recibirás una constancia de estudios.', 11],
  ['alphable', 'FAQ', '¿Puedo certificar mi nivel de inglés?', 'Sí. Los estudiantes de inglés pueden presentar la certificación Oxford TCC.', 12],

  // ── Oxford LIFE ──────────────────────────────────────────────────────────
  ['oxford_life', 'FAQ', '¿Qué es Oxford LIFE?', 'Es una plataforma digital que ayuda a practicar inglés todos los días mediante actividades interactivas y gamificadas.', 1],
  ['oxford_life', 'FAQ', '¿Quién puede utilizar Oxford LIFE?', 'Está dirigido principalmente a estudiantes desde los 11 años y a instituciones educativas.', 2],
  ['oxford_life', 'FAQ', '¿Oxford LIFE sustituye las clases?', 'No. Es una herramienta complementaria que fortalece el aprendizaje fuera del aula.', 3],
  ['oxford_life', 'FAQ', '¿El estudiante recibe retroalimentación?', 'Sí. La plataforma proporciona retroalimentación inmediata después de cada actividad.', 4],
  ['oxford_life', 'FAQ', '¿Se puede usar fuera del horario escolar?', 'Sí. Está diseñada para practicar desde cualquier lugar y en cualquier momento.', 5],
  ['oxford_life', 'FAQ', '¿Los docentes pueden monitorear el avance?', 'Sí. Oxford LIFE cuenta con un sistema de seguimiento individual por estudiante.', 6],
  ['oxford_life', 'FAQ', '¿Cómo mantiene motivados a los estudiantes?', 'Mediante elementos de gamificación, retos y actividades dinámicas.', 7],
  ['oxford_life', 'FAQ', '¿Oxford LIFE ayuda a preparar certificaciones?', 'Sí. Refuerza las habilidades lingüísticas necesarias para certificaciones internacionales de inglés.', 8],

  // ── Work & Study Spain ───────────────────────────────────────────────────
  ['work_study_spain', 'FAQ', '¿Puedo trabajar en España con este programa?', 'Sí. La autorización permite trabajar hasta 30 horas por semana mientras realizas tus estudios.', 1],
  ['work_study_spain', 'FAQ', '¿El programa me consigue trabajo?', 'No. El programa no garantiza empleo; te brinda la autorización legal para trabajar mientras estudias.', 2],
  ['work_study_spain', 'FAQ', '¿Cuánto dura el programa?', 'Tiene una duración de 6 meses.', 3],
  ['work_study_spain', 'FAQ', '¿Qué necesito para aplicar?', 'Debes ser mayor de 18 años, tener pasaporte vigente, no contar con antecedentes penales, demostrar solvencia económica, contratar un seguro médico e inscribirte en uno de los programas académicos.', 4],
  ['work_study_spain', 'FAQ', '¿Hay límite de edad?', 'No existe una edad máxima; únicamente debes ser mayor de 18 años.', 5],
  ['work_study_spain', 'Requisitos', '¿Tengo que demostrar recursos económicos?', 'Sí. Actualmente se solicita acreditar aproximadamente 3,600 € para cubrir tu estancia de seis meses.', 6],
  ['work_study_spain', 'FAQ', '¿Puedo viajar por Europa?', 'Sí. Una vez aprobada tu estancia por estudios, podrás viajar dentro del Espacio Schengen conforme a la normativa vigente.', 7],
  ['work_study_spain', 'FAQ', '¿Puedo llevar a mi familia?', 'Sí. Tu cónyuge e hijos pueden solicitar un visado de acompañante o participar en el programa, según corresponda.', 8],
  ['work_study_spain', 'FAQ', '¿Qué incluye el costo del programa?', 'Incluye la matrícula al curso superior, la gestión inicial de la visa o estancia, asesoría legal, curso de inglés y acompañamiento académico y de viaje. No incluye el trámite para cambiar posteriormente a una residencia por trabajo.', 9],
  ['work_study_spain', 'FAQ', '¿Qué pasa después de los seis meses?', 'Si consigues una oferta laboral y cumples con los requisitos de la legislación española, podrás solicitar el cambio a una residencia o permiso de trabajo.', 10],
  ['work_study_spain', 'FAQ', '¿Puedo aplicar si ya estoy en España?', 'Sí, siempre que te encuentres en situación legal y cumplas con las condiciones para solicitar la estancia por estudios.', 11],
  ['work_study_spain', 'FAQ', '¿Cuánto tarda el proceso?', 'Una vez presentada toda la documentación, el tiempo de resolución varía según la provincia, normalmente de 1 a 3 meses.', 12],

  // ── Smile and Learn ──────────────────────────────────────────────────────
  ['smile_and_learn', 'FAQ', '¿Qué es Smile and Learn?', 'Es una plataforma educativa con más de 14,000 recursos interactivos para niños de 3 a 12 años.', 1],
  ['smile_and_learn', 'FAQ', '¿Para qué edades está diseñada?', 'Para niñas y niños entre 3 y 12 años.', 2],
  ['smile_and_learn', 'FAQ', '¿Qué tipo de contenido incluye?', 'Juegos, videos, cuentos, actividades educativas y recursos de apoyo.', 3],
  ['smile_and_learn', 'FAQ', '¿Cuántos recursos tiene?', 'Más de 14,000 recursos educativos.', 4],
  ['smile_and_learn', 'FAQ', '¿Puede usarse en tablet o celular?', 'Sí. Es una plataforma multiplataforma y funciona en diferentes dispositivos.', 5],
  ['smile_and_learn', 'FAQ', '¿Necesito internet para utilizarla?', 'No siempre. Smile and Learn cuenta con función offline para acceder a ciertos contenidos sin conexión.', 6],
  ['smile_and_learn', 'FAQ', '¿La plataforma es segura para los niños?', 'Sí. Está diseñada específicamente para estudiantes de kínder y primaria, ofreciendo un entorno seguro.', 7],
  ['smile_and_learn', 'FAQ', '¿Se adapta al nivel de cada estudiante?', 'Sí. Permite personalizar la experiencia de aprendizaje por estudiante y por institución.', 8],
  ['smile_and_learn', 'FAQ', '¿Es útil para estudiantes con necesidades educativas especiales?', 'Sí. La plataforma cuenta con características inclusivas para atender diferentes necesidades educativas.', 9],
  ['smile_and_learn', 'FAQ', '¿Los docentes pueden dar seguimiento al progreso?', 'Sí. Incluye analíticas, gestión de grupos y herramientas de seguimiento para docentes.', 10],
  ['smile_and_learn', 'FAQ', '¿En cuántos idiomas está disponible?', 'Está disponible en 6 idiomas, lo que favorece programas bilingües y multilingües.', 11],
  ['smile_and_learn', 'FAQ', '¿Qué hace diferente a Smile and Learn?', 'Combina miles de recursos educativos, aprendizaje personalizado, analíticas para docentes, contenido inclusivo y acceso desde múltiples dispositivos en una sola plataforma.', 12],
];

const HEADER = ['Programa', 'Categoría', 'Pregunta', 'Respuesta', 'Orden'];
const SHEET_NAME = 'FAQ Oxford';

// ── Auth ──────────────────────────────────────────────────────────────────────

async function buildSheetsClient() {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets'],
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const spreadsheetId = process.env.OXED_SHEETS_ID || process.env.GOOGLE_SHEETS_ID;

  if (!spreadsheetId) {
    console.error('GOOGLE_SHEETS_ID (or OXED_SHEETS_ID) is not set');
    process.exit(1);
  }

  const allRows = [HEADER, ...FAQ_ROWS];

  console.log(`Target sheet: "${SHEET_NAME}" in spreadsheet ${spreadsheetId}`);
  console.log(`Rows to write: ${FAQ_ROWS.length} data rows + 1 header`);

  if (dryRun) {
    console.log('\n[DRY RUN] Would write:');
    allRows.forEach((r, i) => console.log(`  ${i}: ${JSON.stringify(r)}`));
    console.log(`\nTotal: ${allRows.length} rows (1 header + ${FAQ_ROWS.length} data rows)`);
    return;
  }

  const sheets = await buildSheetsClient();

  // Create the sheet if it doesn't exist yet — safe to call repeatedly.
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some(s => s.properties.title === SHEET_NAME);
  if (!exists) {
    console.log(`Sheet "${SHEET_NAME}" not found — creating it...`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    console.log(`Sheet "${SHEET_NAME}" created.`);
  } else {
    console.log(`Sheet "${SHEET_NAME}" already exists — will overwrite content.`);
  }

  // Clear existing content then write fresh (idempotent).
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${SHEET_NAME}!A:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: allRows },
  });

  console.log(`\nDone. ${FAQ_ROWS.length} FAQ rows written to "${SHEET_NAME}".`);
  console.log(`Includes W&S-Q6 (recursos económicos / 3,600 €) — confirmed by client.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
