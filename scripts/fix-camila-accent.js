/**
 * Normaliza el nombre de Camila Serafín en travel_leads
 * Cambia 'Camila Serafin' → 'Camila Serafín' (agrega tilde)
 *
 * Uso: node scripts/fix-camila-accent.js
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Ver cuántos registros están afectados
  const affected = await prisma.travelLead.count({
    where: { assignedAdvisor: 'Camila Serafin' },
  });

  if (affected === 0) {
    console.log('No hay registros con "Camila Serafin" sin tilde. Nada que actualizar.');
    return;
  }

  console.log(`Encontrados ${affected} registros con "Camila Serafin" sin tilde.`);

  // Ejecutar el UPDATE
  const result = await prisma.travelLead.updateMany({
    where: { assignedAdvisor: 'Camila Serafin' },
    data: { assignedAdvisor: 'Camila Serafín' },
  });

  console.log(`✅ ${result.count} registros actualizados → "Camila Serafín"`);
}

main()
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
