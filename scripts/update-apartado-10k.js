/**
 * Script to update Apartado to $10,000 in all prices
 */

import { readSheet, updateRange } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';

const SPREADSHEET_ID = env.GOOGLE_SHEETS_ID;

async function updateApartado() {
  try {
    console.log('💰 Actualizando apartado a $10,000 en Precios...\n');

    // Read current prices
    const precios = await readSheet(SPREADSHEET_ID, 'Precios');
    console.log(`   Filas encontradas: ${precios.length}`);

    // Update all rows to have Apartado = 10000
    const updates = [];
    precios.forEach((row, index) => {
      // Skip header
      if (index === 0) return;

      const rowData = [
        row['Colegio'],
        row['Destino'],
        row['Modalidad'],
        row['Código Viaje'],
        row['Precio Programa'],
        row['Precio Vuelo'],
        '10000', // APARTADO siempre $10,000
        row['Periodo Pago'],
        row['Notas']
      ];

      updates.push(rowData);
    });

    // Update from row 2 onwards (skip header)
    const range = `Precios!A2:I${updates.length + 1}`;
    await updateRange(SPREADSHEET_ID, range, updates);

    console.log('✅ Apartado actualizado a $10,000 para todas las filas');
    console.log(`   Total filas actualizadas: ${updates.length}\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

updateApartado();
