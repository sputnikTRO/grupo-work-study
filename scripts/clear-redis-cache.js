import dotenv from 'dotenv';
dotenv.config();

import redis from '../src/core/database/redis.js';

/**
 * Clear Redis cache for WhatsApp media IDs
 * This forces re-upload of all media files
 */

async function clearRedisCache() {
  console.log('\n🗑️  Clearing Redis Cache\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    const client = redis.getClient();

    // Find all WhatsApp media keys
    console.log('Step 1: Finding all WhatsApp media keys...');
    const keys = await client.keys('whatsapp:media:*');

    console.log(`  ✅ Found ${keys.length} cached media items\n`);

    if (keys.length === 0) {
      console.log('  ℹ️  No cached media to clear\n');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('✅ Cache is already empty!\n');
      process.exit(0);
    }

    // Show what will be deleted
    console.log('Media items to be deleted:');
    for (const key of keys) {
      const mediaId = await client.get(key);
      console.log(`  - ${key} → media_id: ${mediaId}`);
    }
    console.log('');

    // Delete all keys
    console.log('Step 2: Deleting cached media...');
    const result = await client.del(...keys);
    console.log(`  ✅ Deleted ${result} keys\n`);

    // Verify deletion
    console.log('Step 3: Verifying deletion...');
    const remaining = await client.keys('whatsapp:media:*');
    console.log(`  ✅ Remaining keys: ${remaining.length}\n`);

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ Redis cache cleared successfully!\n');
    console.log('Next time materials are sent, they will be re-uploaded to WhatsApp.\n');

    process.exit(0);

  } catch (error) {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('❌ Failed to clear cache!\n');
    console.error('Error:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  }
}

clearRedisCache();
