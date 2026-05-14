/**
 * Read Excel file and convert to JSON
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const excelPath = path.join(__dirname, '..', 'downloads', 'travel-docs', 'Colegios inscritos precios.xlsx');

try {
  console.log('📊 Reading Excel file...\n');
  console.log('File:', excelPath);
  console.log('─'.repeat(80));

  // Read the workbook
  const workbook = XLSX.readFile(excelPath);

  console.log('\n📑 Sheets found:', workbook.SheetNames.join(', '));
  console.log('\n' + '─'.repeat(80));

  // Process each sheet
  for (const sheetName of workbook.SheetNames) {
    console.log(`\n\n📄 Sheet: ${sheetName}`);
    console.log('─'.repeat(80));

    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON
    const data = XLSX.utils.sheet_to_json(worksheet, { defval: null });

    console.log(`Rows: ${data.length}\n`);

    if (data.length === 0) {
      console.log('⚠️  Sheet is empty\n');
      continue;
    }

    // Show columns
    const columns = Object.keys(data[0]);
    console.log(`Columns (${columns.length}):`);
    columns.forEach((col, idx) => {
      console.log(`  ${idx + 1}. ${col}`);
    });

    // Show all data
    console.log('\n📋 Data:\n');
    data.forEach((row, idx) => {
      console.log(`Row ${idx + 1}:`);
      Object.entries(row).forEach(([key, value]) => {
        const displayValue = value !== null && value !== undefined ? value : '(empty)';
        console.log(`  ${key}: ${displayValue}`);
      });
      console.log('');
    });
  }

  console.log('─'.repeat(80));
  console.log('\n✅ Excel read complete!\n');

} catch (error) {
  console.error('❌ Error reading Excel:', error.message);
  process.exit(1);
}
