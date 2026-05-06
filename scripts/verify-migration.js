import dotenv from 'dotenv';
import Redis from 'ioredis';
import * as sheetsCache from '../src/core/sheets/cache.js';

dotenv.config();

/**
 * Script de verificación post-migración
 *
 * 1. Limpia el cache de Redis
 * 2. Carga la nueva estructura
 * 3. Verifica que todo funcione correctamente
 */

async function main() {
  console.log('🔍 VERIFICACIÓN POST-MIGRACIÓN\n');

  // 1. Conectar a Redis
  console.log('📡 Conectando a Redis...');
  const redis = new Redis(process.env.REDIS_URL);
  console.log('✅ Conectado a Redis\n');

  // 2. Limpiar cache
  console.log('🧹 Limpiando cache de Google Sheets...');
  const keys = await redis.keys('sheets:*');
  if (keys.length > 0) {
    await redis.del(...keys);
    console.log(`✅ Eliminadas ${keys.length} claves de cache\n`);
  } else {
    console.log('✅ Cache ya estaba vacío\n');
  }

  // 3. Cargar nueva estructura
  console.log('📥 Cargando nueva estructura desde Google Sheets...');
  const success = await sheetsCache.loadCache();

  if (!success) {
    console.error('❌ Error cargando cache');
    await redis.disconnect();
    process.exit(1);
  }

  console.log('✅ Cache cargado exitosamente\n');

  // 4. Verificar cada hoja
  console.log('✅ VERIFICACIÓN DE HOJAS:\n');

  // Verificar Viajes
  const trips = await sheetsCache.getActiveTrips();
  console.log(`   ✓ Viajes: ${trips.length} viajes activos`);
  if (trips.length > 0) {
    console.log(`     - Ejemplo: ${trips[0]['Código']} - ${trips[0]['Destino']}`);
  }

  // Verificar Colegios
  const schools = await sheetsCache.getAllSchools();
  console.log(`   ✓ Colegios: ${schools.length} colegios`);
  if (schools.length > 0) {
    const school = schools[0];
    console.log(`     - Ejemplo: ${school['Código']} - ${school['Nombre Colegio']}`);
    console.log(`     - Asesora: ${school['Asesora'] || 'No asignada'}`);
  }

  // Verificar Precios
  const price = await sheetsCache.getPrice('LON2026', 'WC');
  if (price) {
    console.log(`   ✓ Precios: Funcional`);
    console.log(`     - Precio WC: $${price['Precio Total']}`);
  }

  const priceTodos = await sheetsCache.getPrice('LON2026', null);
  if (priceTodos) {
    console.log(`     - Precio TODOS (fallback): $${priceTodos['Precio Total']}`);
  }

  // Verificar Actividades Extra
  const activities = await sheetsCache.getActivities('LON2026');
  console.log(`   ✓ Actividades Extra: ${activities.length} actividades`);

  // Verificar Info General
  const faq = await sheetsCache.getFAQ();
  console.log(`   ✓ Info General (FAQ): ${faq.length} preguntas`);

  const infoGeneral = await sheetsCache.getInfoGeneral('LON2026');
  console.log(`   ✓ Info General (viaje): ${infoGeneral.length} items`);

  // Verificar Materiales
  const materials = await sheetsCache.getMaterials('LON2026', 'WC');
  console.log(`   ✓ Materiales: ${materials.length} materiales disponibles`);

  // Verificar Advisor
  if (schools.length > 0) {
    const advisor = await sheetsCache.getAdvisor(schools[0]['Código']);
    if (advisor) {
      console.log(`   ✓ Asesoras: Funcional`);
      console.log(`     - ${advisor.nombre} - ${advisor.whatsapp}`);
    }
  }

  // 5. Status del cache
  console.log('\n📊 STATUS DEL CACHE:\n');
  const status = await sheetsCache.getCacheStatus();
  for (const [sheetName, sheetStatus] of Object.entries(status.sheets)) {
    console.log(`   ${sheetStatus.cached ? '✅' : '❌'} ${sheetName}: ${sheetStatus.rowCount} filas`);
  }

  console.log('\n✅ VERIFICACIÓN COMPLETADA\n');
  console.log('🎉 El bot está listo para usar la nueva estructura!\n');

  await redis.quit();
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
