// Copia de las constantes de src/units/oxford-education/ws/cases-sheet.js para que
// el script de siembra no importe el cliente de Sheets de la app (que lee env.js).
export const CASES_SHEET_NAME = 'Casos W&S';
export const CASES_HEADERS = [
  'Caso', 'Fecha', 'Nombre', 'Correo', 'Etapa', 'Descripción', 'Capturas',
  'Responsable', 'Estado', 'Asignado', 'Confirmado', 'Reasignaciones', 'Actualizado',
];
