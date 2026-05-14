/**
 * Script to add Rising Stars 2027 program to Google Sheets
 */

import { readSheet, appendRows } from '../src/core/sheets/client.js';
import { env } from '../src/config/env.js';

const SPREADSHEET_ID = env.GOOGLE_SHEETS_ID;

async function addRisingStars() {
  try {
    console.log('⭐ Adding Rising Stars 2027 to Google Sheets...\n');
    console.log('Spreadsheet ID:', SPREADSHEET_ID);
    console.log('─'.repeat(80));

    // ========================================
    // 1. ADD RISING STARS TO VIAJES SHEET
    // ========================================
    console.log('\n🌍 Adding Rising Stars to Viajes sheet...');

    // First, read current Viajes to see what's there
    const currentViajes = await readSheet(SPREADSHEET_ID, 'Viajes');
    console.log(`   Current trips: ${currentViajes.length - 1}`); // -1 for header

    // Add Rising Stars trips
    const newTrips = [
      ['WIN2027-PS', 'Windsor 2027 - Primaria/Secundaria', 'Rising Stars - Programa especial con beca 50% para estudiantes destacados Oxford TCC', '21 enero 2027', '30 enero 2027', 'activo'],
      ['WIN2027-PH', 'Windsor 2027 - Preparatoria/Higher Education', 'Rising Stars - Programa especial con beca 50% para estudiantes destacados Oxford TCC', '29 enero 2027', '07 febrero 2027', 'activo'],
    ];

    await appendRows(SPREADSHEET_ID, 'Viajes', newTrips);
    console.log('✅ Rising Stars trips added:');
    console.log('   • WIN2027-PS: 21 enero - 30 enero (Primaria/Secundaria)');
    console.log('   • WIN2027-PH: 29 enero - 07 febrero (Preparatoria/Higher Education)');

    // ========================================
    // 2. ADD RISING STARS TO PRECIOS SHEET
    // ========================================
    console.log('\n💰 Adding Rising Stars to Precios sheet...');

    const newPrices = [
      ['TODOS', 'WIN2027-PS', 'Por definir', 'Por definir', 'Por definir', 'Por definir', 'Por definir', 'Rising Stars Primaria/Secundaria - Precio con beca 50%'],
      ['TODOS', 'WIN2027-PH', 'Por definir', 'Por definir', 'Por definir', 'Por definir', 'Por definir', 'Rising Stars Preparatoria/Higher Ed - Precio con beca 50%'],
    ];

    await appendRows(SPREADSHEET_ID, 'Precios', newPrices);
    console.log('✅ Rising Stars pricing added (pending data):');
    console.log('   • WIN2027-PS: Placeholder created');
    console.log('   • WIN2027-PH: Placeholder created');

    // ========================================
    // 3. ADD RISING STARS FAQs TO INFO GENERAL
    // ========================================
    console.log('\n❓ Adding Rising Stars FAQs to Info General...');

    const risingStarsFAQs = [
      ['WIN2027-PS', 'FAQ', '¿Qué es Rising Stars?', 'Rising Stars es un programa especial con beca del 50% para estudiantes destacados que participaron en Oxford TCC (The Complete Competence) y ocuparon primeros lugares en su grupo.', '100'],
      ['WIN2027-PH', 'FAQ', '¿Qué es Rising Stars?', 'Rising Stars es un programa especial con beca del 50% para estudiantes destacados que participaron en Oxford TCC (The Complete Competence) y ocuparon primeros lugares en su grupo.', '100'],
      ['WIN2027-PS', 'FAQ', '¿Dónde se lleva a cabo Rising Stars?', 'Rising Stars se realiza en Windsor, UK. El hospedaje es en Legoland Resort Hotel.', '101'],
      ['WIN2027-PH', 'FAQ', '¿Dónde se lleva a cabo Rising Stars?', 'Rising Stars se realiza en Windsor, UK. El hospedaje es en Legoland Resort Hotel.', '101'],
      ['WIN2027-PS', 'FAQ', '¿Qué incluye el programa Rising Stars?', 'El programa incluye: 4 Workshops, 4 Challenges, 1 Masterclass sobre Public Speaking, 1 Final Challenge. Temas: Leadership Legacy, Creative Thinking, Persuasion, Improvisation. Incluye hospedaje en Legoland Resort Hotel, seguro médico, traslados, recorrido por Oxford, 2 visitas a Londres, todas las comidas y staff 24/7.', '102'],
      ['WIN2027-PH', 'FAQ', '¿Qué incluye el programa Rising Stars?', 'El programa incluye: 4 Workshops, 4 Challenges, 1 Masterclass sobre Public Speaking, 1 Final Challenge. Temas: Leadership Legacy, Creative Thinking, Persuasion, Improvisation. Incluye hospedaje en Legoland Resort Hotel, seguro médico, traslados, recorrido por Oxford, 2 visitas a Londres, todas las comidas y staff 24/7.', '102'],
      ['WIN2027-PS', 'FAQ', '¿Quién puede participar en Rising Stars?', 'Rising Stars es exclusivo para estudiantes que: 1) Participaron en Oxford TCC (The Complete Competence), 2) Obtuvieron primeros lugares en su grupo, 3) Cuentan con beca del 50%.', '103'],
      ['WIN2027-PH', 'FAQ', '¿Quién puede participar en Rising Stars?', 'Rising Stars es exclusivo para estudiantes que: 1) Participaron en Oxford TCC (The Complete Competence), 2) Obtuvieron primeros lugares en su grupo, 3) Cuentan con beca del 50%.', '103'],
      ['WIN2027-PS', 'FAQ', '¿Cuándo es el programa Rising Stars para Primaria/Secundaria?', 'El programa para Primaria y Secundaria es del 21 al 30 de enero de 2027 (10 días, 9 días/8 noches en UK).', '104'],
      ['WIN2027-PH', 'FAQ', '¿Cuándo es el programa Rising Stars para Preparatoria?', 'El programa para Preparatoria y Higher Education es del 29 de enero al 07 de febrero de 2027 (10 días, 9 días/8 noches en UK).', '104'],
      ['WIN2027-PS', 'Trámites', '¿Se necesita visa para Rising Stars?', 'No es necesario tramitar visa. Se requiere tramitar la ETA (Electronic Travel Authorisation) con anticipación, igual que para Londres. El costo es de 16 libras en https://www.gov.uk/eta', '105'],
      ['WIN2027-PH', 'Trámites', '¿Se necesita visa para Rising Stars?', 'No es necesario tramitar visa. Se requiere tramitar la ETA (Electronic Travel Authorisation) con anticipación, igual que para Londres. El costo es de 16 libras en https://www.gov.uk/eta', '105'],
    ];

    await appendRows(SPREADSHEET_ID, 'Info General', risingStarsFAQs);
    console.log('✅ Rising Stars FAQs added: 12 questions');

    console.log('\n' + '─'.repeat(80));
    console.log('\n✅ Rising Stars added successfully!\n');
    console.log('📊 Summary:');
    console.log('  • Viajes: 2 Rising Stars trips added (Primaria/Secundaria, Preparatoria)');
    console.log('  • Precios: 2 pricing placeholders created');
    console.log('  • Info General: 12 FAQs added');
    console.log('\n🎯 Next steps:');
    console.log('  1. Update Precios sheet with actual pricing data');
    console.log('  2. Add Rising Stars materials (brochures, PDFs) to Materiales sheet');
    console.log('  3. Test Miri with Rising Stars information\n');

  } catch (error) {
    console.error('❌ Error adding Rising Stars:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run script
addRisingStars();
