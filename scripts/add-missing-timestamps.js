#!/usr/bin/env node

/**
 * Migration Script: Add Missing Timestamps
 * 
 * This script adds `createdAt` timestamps to business documents that are missing them.
 * Run with: node scripts/add-missing-timestamps.js
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
if (!serviceAccount.project_id) {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT_JSON environment variable is not set or invalid.');
    process.exit(1);
}

initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();

const COLLECTIONS = ['restaurants', 'shops', 'street_vendors'];
const TIMESTAMP_FIELDS = ['createdAt', 'created_at', 'registeredAt', 'timestamp', 'createdDate'];

async function addMissingTimestamps() {
    console.log('🚀 Starting timestamp migration...\n');

    let totalProcessed = 0;
    let totalUpdated = 0;

    for (const collectionName of COLLECTIONS) {
        console.log(`📁 Processing collection: ${collectionName}`);

        const snapshot = await db.collection(collectionName).get();
        console.log(`   Found ${snapshot.size} documents`);

        for (const doc of snapshot.docs) {
            totalProcessed++;
            const data = doc.data();

            // Check if any timestamp field exists
            let hasTimestamp = false;
            for (const field of TIMESTAMP_FIELDS) {
                if (data[field]) {
                    hasTimestamp = true;
                    break;
                }
            }

            if (!hasTimestamp) {
                // Add createdAt with a default timestamp (beginning of 2024)
                const defaultTimestamp = Timestamp.fromDate(new Date('2024-01-01T00:00:00Z'));

                try {
                    await doc.ref.update({
                        createdAt: defaultTimestamp
                    });

                    console.log(`   ✅ Added timestamp to: ${doc.id}`);
                    totalUpdated++;
                } catch (error) {
                    console.error(`   ❌ Failed to update ${doc.id}:`, error.message);
                }
            }
        }
    }

    console.log(`\n📊 Migration Summary:`);
    console.log(`   Total documents processed: ${totalProcessed}`);
    console.log(`   Documents updated: ${totalUpdated}`);
    console.log(`   Documents skipped (already had timestamp): ${totalProcessed - totalUpdated}`);
    console.log('\n✅ Migration complete!\n');
}

// Run migration
addMissingTimestamps()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    });
