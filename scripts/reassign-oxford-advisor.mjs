/**
 * reassign-oxford-advisor.mjs — utilidad MANUAL (NO se importa en la app).
 *
 * Pasa los leads de Oxford ABIERTOS de una asesora que salió a quien la reemplaza.
 * `assignedAdvisor` guarda el NOMBRE, y PENDIENTES/ATIENDO/LISTO filtran por nombre:
 * sin esto, los tickets de la asesora anterior quedan huérfanos aunque el número
 * de WhatsApp sea el mismo.
 *
 * Solo toca leads en curso con la asesora ('derivado_asesor' y 'en_atencion', los que
 * ven PENDIENTES/ATIENDO/LISTO). No notifica a nadie ni toca al prospecto. Dry-run por default.
 *
 * Uso:
 *   node scripts/reassign-oxford-advisor.mjs "Diana Castillo" "Danna Paola"           # dry-run
 *   node scripts/reassign-oxford-advisor.mjs "Diana Castillo" "Danna Paola" --confirm  # aplica
 */
import prisma from '../src/core/database/client.js';
import { ADVISORS } from '../src/units/oxford-education/advisor-zones.js';

const [from, to] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const confirm = process.argv.includes('--confirm');

if (!from || !to) {
  console.error('Uso: node scripts/reassign-oxford-advisor.mjs "<nombre anterior>" "<nombre nuevo>" [--confirm]');
  process.exit(1);
}
if (!Object.values(ADVISORS).some((a) => a.nombre === to)) {
  console.error(`"${to}" no está en advisor-zones.ADVISORS — revisa el nombre exacto.`);
  process.exit(1);
}

const OPEN = ['derivado_asesor', 'en_atencion'];
const where = { assignedAdvisor: from, status: { in: OPEN } };

try {
  const leads = await prisma.oxfordLead.findMany({
    where,
    select: { ticketNumber: true, status: true, confirmedAt: true },
    orderBy: { ticketNumber: 'asc' },
  });
  console.log(`${leads.length} lead(s) abiertos de "${from}":`);
  for (const l of leads) console.log(`  #${l.ticketNumber}  ${l.status}${l.confirmedAt ? '  (confirmado)' : ''}`);

  if (!confirm) {
    console.log(`\nDry-run. Agrega --confirm para pasarlos a "${to}".`);
  } else if (leads.length) {
    const { count } = await prisma.oxfordLead.updateMany({ where, data: { assignedAdvisor: to } });
    console.log(`\n✔ ${count} lead(s) reasignados a "${to}".`);
  }
} finally {
  await prisma.$disconnect();
}
