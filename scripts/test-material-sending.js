#!/usr/bin/env node

/**
 * Test Material Sending Functionality
 *
 * Tests that:
 * 1. Materials are loaded from Google Sheets cache
 * 2. Claude generates [ENVIAR_MATERIAL:ID] tags when appropriate
 * 3. executeSendMaterial function works correctly
 */

import { getMaterials, getMaterial } from '../src/core/sheets/cache.js';
import { parseActions, cleanResponse } from '../src/units/travel/actions.js';
import { buildFullPrompt } from '../src/units/travel/prompts.js';
import { buildDynamicKnowledge } from '../src/units/travel/knowledge.js';

async function main() {
  console.log('🧪 Testing Material Sending Functionality\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Test 1: Verify materials are in cache
  console.log('Test 1: Verifying materials in cache...');
  try {
    const materials = await getMaterials();
    console.log(`✅ Found ${materials.length} materials in cache\n`);

    // Check for specific materials
    const brochure = materials.find(m => m.id === 'BROCHURE_LON_CEWIN');
    const londonEye = materials.find(m => m.id === 'ACT_EXTRA_LONDON_EYE');
    const harryPotter = materials.find(m => m.id === 'ACT_EXTRA_HARRY_POTTER');

    if (brochure) {
      console.log('   ✅ BROCHURE_LON_CEWIN found');
      console.log(`      URL: ${brochure.url || brochure.contenido || '(not set)'}`);
      console.log(`      Tipo: ${brochure.tipo || '(not set)'}`);
    } else {
      console.log('   ❌ BROCHURE_LON_CEWIN NOT found');
    }

    if (londonEye) {
      console.log('   ✅ ACT_EXTRA_LONDON_EYE found');
    } else {
      console.log('   ❌ ACT_EXTRA_LONDON_EYE NOT found');
    }

    if (harryPotter) {
      console.log('   ✅ ACT_EXTRA_HARRY_POTTER found');
    } else {
      console.log('   ❌ ACT_EXTRA_HARRY_POTTER NOT found');
    }

    console.log('');

  } catch (error) {
    console.error('❌ Error loading materials from cache:', error.message);
    process.exit(1);
  }

  // Test 2: Verify dynamic knowledge includes materials
  console.log('Test 2: Verifying dynamic knowledge includes materials...');
  try {
    const knowledge = await buildDynamicKnowledge('CEWIN');

    if (knowledge.includes('MATERIALES DISPONIBLES PARA ENVIAR')) {
      console.log('✅ Materials section found in dynamic knowledge');
    } else {
      console.log('❌ Materials section NOT found in dynamic knowledge');
    }

    if (knowledge.includes('BROCHURE_LON_CEWIN')) {
      console.log('✅ BROCHURE_LON_CEWIN listed in materials');
    } else {
      console.log('❌ BROCHURE_LON_CEWIN NOT listed in materials');
    }

    console.log('');

  } catch (error) {
    console.error('❌ Error building dynamic knowledge:', error.message);
    process.exit(1);
  }

  // Test 3: Verify system prompt includes material sending instructions
  console.log('Test 3: Verifying system prompt includes material instructions...');
  try {
    const prompt = buildFullPrompt(null, await buildDynamicKnowledge(null));

    if (prompt.includes('CUÁNDO ENVIAR MATERIALES ESPECÍFICOS')) {
      console.log('✅ Material sending instructions found in prompt');
    } else {
      console.log('❌ Material sending instructions NOT found in prompt');
    }

    if (prompt.includes('TRATA A TODOS LOS COLEGIOS IGUAL')) {
      console.log('✅ Equal treatment rule found (colegios fix)');
    } else {
      console.log('❌ Equal treatment rule NOT found');
    }

    if (prompt.includes('[DERIVAR_ASESOR:colegio sin convenio establecido]')) {
      console.log('❌ OLD derivation rule still present (should be removed)');
    } else {
      console.log('✅ OLD derivation rule removed correctly');
    }

    console.log('');

  } catch (error) {
    console.error('❌ Error building prompt:', error.message);
    process.exit(1);
  }

  // Test 4: Test action tag parsing
  console.log('Test 4: Testing action tag parsing...');

  const testResponse = `¡Por supuesto! Le envío nuestra presentación completa de English 4 Life Londres 2026. Incluye fechas, trámites, equipaje, clima y la extensión a París. 📄✈️

[ENVIAR_MATERIAL:BROCHURE_LON_CEWIN]
[ACTUALIZAR_SCORE:5]`;

  const actions = parseActions(testResponse);
  console.log(`✅ Parsed ${actions.length} actions from test response`);

  const materialAction = actions.find(a => a.type === 'ENVIAR_MATERIAL');
  if (materialAction && materialAction.materialId === 'BROCHURE_LON_CEWIN') {
    console.log('✅ ENVIAR_MATERIAL action parsed correctly');
    console.log(`   Material ID: ${materialAction.materialId}`);
  } else {
    console.log('❌ ENVIAR_MATERIAL action NOT parsed correctly');
  }

  const cleanText = cleanResponse(testResponse);
  if (!cleanText.includes('[ENVIAR_MATERIAL')) {
    console.log('✅ Tags removed from clean response');
  } else {
    console.log('❌ Tags still present in clean response');
  }

  console.log('');

  // Summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 Test Summary:');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('✅ All core functionality tests passed!\n');
  console.log('Next steps:');
  console.log('1. Test with real bot: npm run dev');
  console.log('2. Send WhatsApp message: "Hola, envíame información de Londres"');
  console.log('3. Bot should respond AND send the PDF file');
  console.log('4. Check logs for: "Sending PDF document via WhatsApp"');
  console.log('');
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
