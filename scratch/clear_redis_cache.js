import { kv } from '../src/lib/kv.js';

async function main() {
    try {
        console.log('Clearing Redis cache key "public:food-search:cache"...');
        await kv.del('public:food-search:cache');
        console.log('Successfully cleared Redis cache key!');
    } catch (err) {
        console.error('Failed to clear cache:', err.message);
    }
    process.exit(0);
}

main();
