import dotenv from 'dotenv';
import * as sheetsCache from '../src/core/sheets/cache.js';

dotenv.config();

async function main() {
  console.log('🔍 DEBUGGING CACHE\n');

  // 1. Obtener viajes activos
  console.log('📅 VIAJES ACTIVOS:');
  const trips = await sheetsCache.getActiveTrips();
  console.log('Cantidad:', trips.length);
  console.log('Datos:', JSON.stringify(trips, null, 2));

  // 2. Obtener precio para WC
  console.log('\n💰 PRECIO PARA WC:');
  const priceWC = await sheetsCache.getPrice('LON2026', 'WC');
  console.log(JSON.stringify(priceWC, null, 2));

  // 3. Obtener precio fallback
  console.log('\n💰 PRECIO FALLBACK (TODOS):');
  const priceTodos = await sheetsCache.getPrice('LON2026', null);
  console.log(JSON.stringify(priceTodos, null, 2));

  // 4. Obtener materiales
  console.log('\n📄 MATERIALES:');
  const materials = await sheetsCache.getMaterials('LON2026', 'WC');
  console.log('Cantidad:', materials.length);
  materials.forEach(m => {
    console.log(`  - ${m['ID']}: ${m['Nombre']} (${m['Tipo']})`);
    console.log(`    URL: ${m['URL']}`);
  });

  // 5. Obtener info general
  console.log('\n📚 INFO GENERAL (FAQ):');
  const faq = await sheetsCache.getFAQ();
  console.log('FAQs:', faq.length);

  // 6. Obtener asesor
  console.log('\n👤 ASESOR PARA WC:');
  const advisor = await sheetsCache.getAdvisor('WC');
  console.log(JSON.stringify(advisor, null, 2));

  // 7. Estado del cache
  console.log('\n📊 ESTADO DEL CACHE:');
  const status = await sheetsCache.getCacheStatus();
  console.log(JSON.stringify(status, null, 2));

  process.exit(0);
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
