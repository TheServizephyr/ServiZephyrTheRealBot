/**
 * cleanup-dos-attack.js
 *
 * Emergency cleanup script — Pizzeria Vatika Cafe DoS attack (Sep 25-26, 2026)
 *
 * What this script does:
 *   1. Cancels all bookings created on/after ATTACK_START  (marks as cancelled_attack)
 *   2. Deletes all waitlist entries with source='booking_late'  (cascade from fake bookings)
 *   3. Deletes all waitlist entries created on/after ATTACK_START  (direct fake public joins)
 *   4. Deletes all waitlist_active_phone phone-lock docs  (safe to nuke, re-created on next join)
 *   5. Deletes all waitlist_booking_bridge records
 *   6. Resets waitlistTokenCounter to 0
 *
 * What this PRESERVES:
 *   - All waitlist entries created BEFORE Sep 25 12:40 UTC  ← real customers
 *   - All bookings created BEFORE the attack window
 *   - Everything else (menu, orders, customers, config) — untouched
 *
 * Pagination strategy: cursor-based (startAfter last doc), so we never
 * re-fetch the same docs after deleting them — avoids infinite loops.
 *
 * Usage:
 *   node scripts/cleanup-dos-attack.js           # DRY RUN (default, safe — just counts)
 *   node scripts/cleanup-dos-attack.js --run     # LIVE DELETE (destructive!)
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const dotenv = require('dotenv');

// ─── CONFIG ────────────────────────────────────────────────────────────────
const RESTAURANT_ID = 'pizzeria-vatika-cafe';
const ATTACK_START  = new Date('2026-09-25T12:40:00Z'); // first malicious booking timestamp
const BATCH_SIZE    = 400; // Firestore batch write limit is 500 — stay under it
const DRY_RUN       = !process.argv.includes('--run');
// ────────────────────────────────────────────────────────────────────────────

if (DRY_RUN) {
  console.log('\n⚠️  DRY RUN MODE — no data will be deleted.');
  console.log('   Pass --run to actually delete.\n');
} else {
  console.log('\n🔴 LIVE DELETE MODE — data WILL be permanently deleted!\n');
}

// ── Load env ────────────────────────────────────────────────────────────────
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

// ── Init Firebase Admin ─────────────────────────────────────────────────────
const admin = require('firebase-admin');
let serviceAccount = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
  );
} else {
  console.error('❌ No Firebase credentials found.');
  process.exit(1);
}
if (typeof serviceAccount.private_key === 'string' && serviceAccount.private_key.includes('\\n')) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// ─── HELPERS ───────────────────────────────────────────────────────────────

let totalProcessed = 0;

/**
 * Cursor-based batch delete.
 * Fetches BATCH_SIZE docs, deletes them, advances cursor to last doc.
 * Terminates when fewer than BATCH_SIZE docs are returned (last page).
 */
async function deleteInBatches(baseQuery, label) {
  let deleted = 0;
  let page    = 0;
  let lastDoc = null;

  while (true) {
    const q    = lastDoc ? baseQuery.limit(BATCH_SIZE).startAfter(lastDoc) : baseQuery.limit(BATCH_SIZE);
    const snap = await q.get();
    if (snap.empty) break;

    page++;
    lastDoc = snap.docs[snap.docs.length - 1];

    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    deleted        += snap.size;
    totalProcessed += snap.size;
    process.stdout.write(`\r  [${label}] page ${page} — ${deleted} deleted...   `);

    if (snap.size < BATCH_SIZE) break;
  }

  console.log(`\r  [${label}] ✅ Deleted ${deleted} docs.                          `);
  return deleted;
}

/**
 * Cursor-based batch cancel (soft delete for bookings — keeps audit trail).
 */
async function cancelInBatches(baseQuery, label) {
  let processed = 0;
  let page      = 0;
  let lastDoc   = null;

  while (true) {
    const q    = lastDoc ? baseQuery.limit(BATCH_SIZE).startAfter(lastDoc) : baseQuery.limit(BATCH_SIZE);
    const snap = await q.get();
    if (snap.empty) break;

    page++;
    lastDoc = snap.docs[snap.docs.length - 1];

    const batch = db.batch();
    snap.docs.forEach(doc =>
      batch.update(doc.ref, {
        status:           'cancelled_attack',
        cancelledReason:  'dos_attack_cleanup_sep25_2026',
        updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
      })
    );
    await batch.commit();

    processed      += snap.size;
    totalProcessed += snap.size;
    process.stdout.write(`\r  [${label}] page ${page} — ${processed} cancelled...   `);

    if (snap.size < BATCH_SIZE) break;
  }

  console.log(`\r  [${label}] ✅ Cancelled ${processed} docs.                        `);
  return processed;
}

// ─── MAIN ──────────────────────────────────────────────────────────────────

async function main() {
  const bizRef = db.collection('restaurants').doc(RESTAURANT_ID);

  console.log('='.repeat(60));
  console.log('  CLEANUP — Pizzeria Vatika Cafe DoS Attack (Sep 25-26)');
  console.log('='.repeat(60));
  console.log(`  Restaurant : ${RESTAURANT_ID}`);
  console.log(`  Attack from: ${ATTACK_START.toISOString()}`);
  console.log(`  Mode       : ${DRY_RUN ? 'DRY RUN' : '🔴 LIVE DELETE'}`);
  console.log('='.repeat(60) + '\n');

  // ── Pre-flight counts ──────────────────────────────────────────────────
  console.log('📊 Counting before cleanup...');
  const [
    totalWL, totalBook,
    fakeBook, bookingLateWL, fakeWL, phoneLocks, bridges, legitWL,
  ] = await Promise.all([
    bizRef.collection('waitlist').count().get(),
    bizRef.collection('bookings').count().get(),
    bizRef.collection('bookings').where('createdAt', '>=', ATTACK_START).count().get(),
    bizRef.collection('waitlist').where('source', '==', 'booking_late').count().get(),
    bizRef.collection('waitlist').where('createdAt', '>=', ATTACK_START).count().get(),
    bizRef.collection('waitlist_active_phone').count().get(),
    bizRef.collection('waitlist_booking_bridge').count().get(),
    bizRef.collection('waitlist').where('createdAt', '<', ATTACK_START).count().get(),
  ]);

  const nFakeBook  = fakeBook.data().count;
  const nBridgedWL = bookingLateWL.data().count;
  const nFakeWL    = fakeWL.data().count;
  const nLocks     = phoneLocks.data().count;
  const nBridges   = bridges.data().count;
  const nLegit     = legitWL.data().count;

  console.log('\n  BEFORE:');
  console.log(`  Total waitlist           : ${totalWL.data().count}`);
  console.log(`  Total bookings           : ${totalBook.data().count}`);
  console.log(`  ├─ Fake bookings (atk)   : ${nFakeBook}   ← cancel`);
  console.log(`  ├─ booking_late waitlist : ${nBridgedWL}   ← delete`);
  console.log(`  ├─ Fake waitlist (atk)   : ${nFakeWL}   ← delete`);
  console.log(`  ├─ Phone locks           : ${nLocks}   ← delete`);
  console.log(`  └─ Booking bridges       : ${nBridges}   ← delete`);
  console.log(`  ✅ LEGIT waitlist (safe) : ${nLegit}   ← PRESERVED`);
  console.log('');

  if (DRY_RUN) {
    const total = nFakeBook + nBridgedWL + nFakeWL + nLocks + nBridges;
    console.log(`📋 DRY RUN: Would process ${total} documents total.`);
    console.log('\n  Run with --run to execute:');
    console.log('  node scripts/cleanup-dos-attack.js --run\n');
    console.log('='.repeat(60) + '\n');
    return;
  }

  // ── Live delete ────────────────────────────────────────────────────────
  console.log('⏳ Starting in 3 seconds... Ctrl+C to abort.\n');
  await new Promise(r => setTimeout(r, 3000));

  console.log('🗑  Step 1/5 — Cancelling fake bookings...');
  await cancelInBatches(
    bizRef.collection('bookings').where('createdAt', '>=', ATTACK_START).orderBy('createdAt'),
    'fake-bookings'
  );

  console.log('🗑  Step 2/5 — Deleting booking_late waitlist entries...');
  await deleteInBatches(
    bizRef.collection('waitlist').where('source', '==', 'booking_late'),
    'booking_late-wl'
  );

  console.log('🗑  Step 3/5 — Deleting fake walk_in waitlist entries (post-attack joins)...');
  await deleteInBatches(
    bizRef.collection('waitlist').where('createdAt', '>=', ATTACK_START).orderBy('createdAt'),
    'fake-walkin-wl'
  );

  console.log('🗑  Step 4/5 — Deleting all phone locks (waitlist_active_phone)...');
  await deleteInBatches(
    bizRef.collection('waitlist_active_phone'),
    'phone-locks'
  );

  console.log('🗑  Step 5/5 — Deleting waitlist_booking_bridge records...');
  await deleteInBatches(
    bizRef.collection('waitlist_booking_bridge'),
    'booking-bridge'
  );

  console.log('\n🔢  Resetting waitlistTokenCounter to 0...');
  await bizRef.set({
    waitlistTokenCounter:    0,
    waitlistTokenCounterDate: '',
    updatedAt:               admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log('  ✅ Counter reset.\n');

  // ── Post-flight counts ─────────────────────────────────────────────────
  console.log('📊 Counting after cleanup...');
  const [wlA, bookA, locksA, bridgesA, legitA] = await Promise.all([
    bizRef.collection('waitlist').count().get(),
    bizRef.collection('bookings').count().get(),
    bizRef.collection('waitlist_active_phone').count().get(),
    bizRef.collection('waitlist_booking_bridge').count().get(),
    bizRef.collection('waitlist').where('createdAt', '<', ATTACK_START).count().get(),
  ]);

  console.log('\n  AFTER:');
  console.log(`  Total waitlist           : ${wlA.data().count}`);
  console.log(`  Total bookings           : ${bookA.data().count}`);
  console.log(`  Phone locks              : ${locksA.data().count}`);
  console.log(`  Booking bridges          : ${bridgesA.data().count}`);
  console.log(`  Legit waitlist (pre-atk) : ${legitA.data().count}`);

  console.log('\n' + '='.repeat(60));
  console.log(`  ✅ Done! Processed ${totalProcessed} documents total.`);
  console.log('\n  NEXT STEPS:');
  console.log('  1. Ask owner to refresh dashboard and confirm it loads fast');
  console.log('  2. Confirm pre-attack entries (Deepshika etc.) still visible');
  console.log('  3. Monitor Firebase console for any new suspicious spikes');
  console.log('='.repeat(60) + '\n');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('\n❌ CLEANUP FAILED:', err.message || err);
  process.exit(1);
});
