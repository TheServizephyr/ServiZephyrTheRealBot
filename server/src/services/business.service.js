const { getCache, setCache } = require('../lib/cache');
const { HttpError } = require('../utils/httpError');

const CANDIDATE_COLLECTIONS = ['restaurants', 'street_vendors', 'shops'];
const COLLECTION_CACHE_TTL_SEC = 60 * 60; // 1 hour

function normalizeBusinessType(value, fallbackCollectionName = null) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'shop' || normalized === 'store') return 'store';
  if (normalized === 'street-vendor' || normalized === 'street_vendor') return 'street-vendor';
  if (normalized === 'restaurant') return 'restaurant';
  if (fallbackCollectionName === 'shops') return 'store';
  if (fallbackCollectionName === 'street_vendors') return 'street-vendor';
  return 'restaurant';
}

async function tryBusinessDoc(firestore, collectionName, businessId) {
  const docRef = firestore.collection(collectionName).doc(businessId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) return null;
  const data = docSnap.data() || {};
  return {
    collectionName,
    ref: docRef,
    id: docSnap.id,
    data,
    menuVersion: Number(data.menuVersion || 1),
    businessType: normalizeBusinessType(data.businessType, collectionName),
  };
}

async function findBusinessById({ firestore, businessId }) {
  const safeBusinessId = String(businessId || '').trim();
  if (!safeBusinessId) throw new HttpError(400, 'Business ID is required');

  const collectionCacheKey = `business_collection:${safeBusinessId}`;
  const collectionHit = await getCache(collectionCacheKey);
  if (collectionHit.hit && collectionHit.value) {
    const cachedCollection = String(collectionHit.value);
    const cached = await tryBusinessDoc(firestore, cachedCollection, safeBusinessId);
    if (cached) return cached;
  }

  const found = (
    await Promise.all(
      CANDIDATE_COLLECTIONS.map((collectionName) =>
        tryBusinessDoc(firestore, collectionName, safeBusinessId)
      )
    )
  ).filter(Boolean);

  if (found.length === 0) {
    throw new HttpError(404, 'Business not found');
  }

  found.sort((a, b) => b.menuVersion - a.menuVersion);
  const winner = found[0];
  await setCache(collectionCacheKey, winner.collectionName, COLLECTION_CACHE_TTL_SEC);
  return winner;
}

module.exports = {
  findBusinessById,
  normalizeBusinessType,
};
