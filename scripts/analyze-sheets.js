/**
 * Script to analyze current Google Sheets content
 * Shows all sheets and their data structure
 */

import { getSpreadsheetMetadata, readSheet } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';
import logger from '../src/utils/logger.js';

const SHEET_NAMES = [
  'Viajes',
  'Precios',
  'Colegios',
  'Actividades Extra',
  'Info General',
  'Materiales',
  'Leads',
];

async function analyzeSheets() {
  try {
    console.log('📊 Analyzing Google Sheets...\n');
    console.log('Spreadsheet ID:', env.GOOGLE_SHEETS_ID);
    console.log('Service Account:', env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
    console.log('─'.repeat(80));

    // Get spreadsheet metadata
    const metadata = await getSpreadsheetMetadata(env.GOOGLE_SHEETS_ID);
    console.log('\n📋 Spreadsheet Info:');
    console.log('  Title:', metadata.title);
    console.log('  Locale:', metadata.locale);
    console.log('  Time Zone:', metadata.timeZone);
    console.log('  Total Sheets:', metadata.sheets.length);
    console.log('\n📑 Available Sheets:');
    metadata.sheets.forEach(sheet => {
      console.log(`  - ${sheet.title} (${sheet.rowCount} rows x ${sheet.columnCount} cols)`);
    });

    console.log('\n' + '─'.repeat(80));
    console.log('\n📖 Reading Sheet Contents:\n');

    // Read each sheet
    for (const sheetName of SHEET_NAMES) {
      try {
        console.log(`\n🔍 ${sheetName}`);
        console.log('─'.repeat(80));

        const data = await readSheet(env.GOOGLE_SHEETS_ID, sheetName);

        if (data.length === 0) {
          console.log('  ⚠️  Sheet is empty\n');
          continue;
        }

        // Show columns
        const columns = Object.keys(data[0]);
        console.log(`  Columns (${columns.length}):`);
        columns.forEach((col, idx) => {
          console.log(`    ${idx + 1}. ${col}`);
        });

        // Show row count
        console.log(`\n  Rows: ${data.length}`);

        // Show first 3 rows as sample
        console.log('\n  Sample Data (first 3 rows):');
        data.slice(0, 3).forEach((row, idx) => {
          console.log(`\n  Row ${idx + 1}:`);
          Object.entries(row).forEach(([key, value]) => {
            const displayValue = value || '(empty)';
            const truncated = displayValue.length > 60
              ? displayValue.substring(0, 57) + '...'
              : displayValue;
            console.log(`    ${key}: ${truncated}`);
          });
        });

        console.log('\n');

      } catch (error) {
        console.error(`  ❌ Error reading sheet "${sheetName}":`, error.message);
      }
    }

    console.log('─'.repeat(80));
    console.log('\n✅ Analysis complete!\n');

  } catch (error) {
    console.error('❌ Error analyzing sheets:', error);
    process.exit(1);
  }
}

// Run analysis
analyzeSheets();
