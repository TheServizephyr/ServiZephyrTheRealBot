/**
 * BUSINESS SERVICE
 * 
 * Abstracts business type handling to eliminate scattered ternaries.
 * 
 * Replaces 30+ instances of:
 *   businessType === 'street-vendor' ? 'street_vendors' : (businessType === 'shop' ? 'shops' : 'restaurants')
 * 
 * With single source of truth.
 * 
 * Phase 5 Step 2.2
 */

import { getFirestore } from '@/lib/firebase-admin';

/**
 * Business type to Firestore collection mapping
 */
const BUSINESS_TYPE_MAP = {
    'restaurant': 'restaurants',
    'shop': 'shops',
    'street-vendor': 'street_vendors',
    'street_vendor': 'street_vendors', // Handle both formats
};

/**
 * Get Firestore collection name for a business type
 * 
 * @param {string} businessType - Business type from request
 * @returns {string} Firestore collection name
 */
export function getBusinessCollection(businessType) {
    const collection = BUSINESS_TYPE_MAP[businessType];

    if (!collection) {
        console.warn(`[BusinessService] Unknown business type: ${businessType}, defaulting to 'restaurants'`);
        return 'restaurants';
    }

    return collection;
}

/**
 * Find business by ID across all business collections
 * 
 * @param {Firestore} firestore - Firestore instance
 * @param {string} businessId - Business document ID
 * @returns {Promise<Object|null>} Business data with metadata
 */
export async function findBusinessById(firestore, businessId) {
    const collections = ['restaurants', 'shops', 'street_vendors'];

    for (const collectionName of collections) {
        try {
            const docRef = firestore.collection(collectionName).doc(businessId);
            const docSnap = await docRef.get();

            if (docSnap.exists) {
                console.log(`[BusinessService] Found business ${businessId} in collection: ${collectionName}`);
                return {
                    id: businessId,
                    ref: docRef,
                    data: docSnap.data(),
                    collection: collectionName,
                    type: getBusinessTypeFromCollection(collectionName)
                };
            }
        } catch (error) {
            console.error(`[BusinessService] Error checking ${collectionName}:`, error);
        }
    }

    console.error(`[BusinessService] Business ${businessId} not found in any collection`);
    return null;
}

/**
 * Get business type from collection name (reverse mapping)
 * 
 * @param {string} collectionName - Firestore collection name
 * @returns {string} Business type
 */
function getBusinessTypeFromCollection(collectionName) {
    const reverseMap = {
        'restaurants': 'restaurant',
        'shops': 'shop',
        'street_vendors': 'street-vendor'
    };

    return reverseMap[collectionName] || 'restaurant';
}

/**
 * Get business by ID with known type
 * 
 * @param {Firestore} firestore - Firestore instance
 * @param {string} businessId - Business document ID
 * @param {string} businessType - Known business type
 * @returns {Promise<Object|null>} Business data
 */
export async function getBusinessById(firestore, businessId, businessType) {
    const collectionName = getBusinessCollection(businessType);
    const docRef = firestore.collection(collectionName).doc(businessId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
        console.error(`[BusinessService] Business ${businessId} not found in ${collectionName}`);
        return null;
    }

    return {
        id: businessId,
        ref: docRef,
        data: docSnap.data(),
        collection: collectionName,
        type: businessType
    };
}
