/**
 * ORDER PRICING SERVICE
 * 
 * SECURITY CRITICAL: Backend price validation
 * 
 * This service recalculates order totals from Firestore menu data
 * to prevent client-side price manipulation attacks.
 * 
 * Attack Prevention:
 * - Client sends: { item: 'burger', price: 1 } (manipulated from ₹200)
 * - Server recalculates from menu: ₹200 (correct price)
 * - Validation fails → Order rejected
 * 
 * Phase 5 Step 2.1
 */

import { getFirestore } from '@/lib/firebase-admin';

/**
 * Custom error for pricing mismatches
 */
export class PricingError extends Error {
    constructor(message, code = 'PRICE_MISMATCH') {
        super(message);
        this.name = 'PricingError';
        this.code = code;
    }
}

/**
 * Get business collection name from type
 */
function getBusinessCollection(businessType) {
    const map = {
        'restaurant': 'restaurants',
        'shop': 'shops',
        'street-vendor': 'street_vendors',
        'street_vendor': 'street_vendors',
    };
    return map[businessType] || 'restaurants';
}

/**
 * Calculate server-side total from Firestore menu data
 * 
 * @param {Object} params
 * @param {string} params.restaurantId - Business ID
 * @param {Array} params.items - Cart items from client
 * @param {string} params.businessType - Business type
 * @returns {Promise<Object>} Server-calculated pricing
 */
export async function calculateServerTotal({ restaurantId, items, businessType = 'restaurant' }) {
    console.log(`[OrderPricing] Calculating server total for ${restaurantId}`);

    const firestore = await getFirestore();
    const collectionName = getBusinessCollection(businessType);
    const menuRef = firestore.collection(collectionName).doc(restaurantId).collection('menu');

    let serverSubtotal = 0;
    const validatedItems = [];

    // ✅ FIX: Fetch individual item documents and group by categoryId
    // Database structure: menu/{itemId} with categoryId field
    // NOT: menu/{categoryId}/items array
    const itemsSnapshot = await menuRef.get();
    const categoriesMap = new Map();

    itemsSnapshot.forEach(doc => {
        const itemData = doc.data();
        const rawCategoryId = itemData.categoryId; // Keep raw for reference if needed

        if (!rawCategoryId) {
            console.warn(`[OrderPricing] Item ${doc.id} has no categoryId, skipping`);
            return;
        }

        // ✅ FIX: Normalize category ID to lowercase for case-insensitive grouping
        const normalizedCategoryId = rawCategoryId.toLowerCase().trim();

        // Group items by categoryId
        if (!categoriesMap.has(normalizedCategoryId)) {
            categoriesMap.set(normalizedCategoryId, {
                id: rawCategoryId, // Store original ID
                items: []
            });
        }

        categoriesMap.get(normalizedCategoryId).items.push({
            ...itemData,
            id: doc.id
        });
    });

    console.log(`[OrderPricing] Grouped ${itemsSnapshot.size} items into ${categoriesMap.size} categories`);
    categoriesMap.forEach((cat, id) => {
        console.log(`  - ${id}: ${cat.items.length} items`);
    });

    for (const item of items) {
        try {
            const itemPrice = await validateAndCalculateItemPrice(item, categoriesMap);
            const itemQuantity = item.quantity || 1;
            const itemTotal = itemPrice * itemQuantity;

            serverSubtotal += itemTotal;

            validatedItems.push({
                ...item,
                serverVerifiedPrice: itemPrice,
                serverVerifiedTotal: itemTotal,
                quantity: itemQuantity
            });

            console.log(`[OrderPricing] Item ${item.id}: ₹${itemPrice} x ${itemQuantity} = ₹${itemTotal} (Client expected price: ₹${item.price || item.totalPrice / itemQuantity || 'unknown'})`);

        } catch (error) {
            console.error(`[OrderPricing] Validation failed for item ${item.id}:`, error.message);
            throw new PricingError(
                `Item "${item.name || item.id}" validation failed: ${error.message}`
            );
        }
    }

    console.log(`[OrderPricing] Server subtotal: ₹${serverSubtotal}`);

    return {
        serverSubtotal,
        validatedItems,
        itemCount: items.length
    };
}

/**
 * Validate single item and calculate its price
 * 
 * @param {Object} item - Cart item
 * @param {Map} categoriesMap - Menu categories map
 * @returns {Promise<number>} Validated item price
 */
async function validateAndCalculateItemPrice(item, categoriesMap) {
    // Find category (Case-Insensitive)
    const normalizedReqCategoryId = item.categoryId?.toLowerCase().trim();
    const category = categoriesMap.get(normalizedReqCategoryId);

    if (!category) {
        // Debug: Log available keys
        const availableCategories = Array.from(categoriesMap.keys()).join(', ');
        console.warn(`[OrderPricing] Category mismatch. Looking for '${normalizedReqCategoryId}', Available: [${availableCategories}]`);
        throw new PricingError(`Category "${item.categoryId}" not found in menu`);
    }

    // Find menu item
    const menuItem = category.items?.find(i => i.id === item.id);

    if (!menuItem) {
        throw new PricingError(`Item "${item.id}" not found in category "${item.categoryId}"`);
    }

    let basePrice = 0;

    // Validate portion price (if applicable)
    if (item.portion && menuItem.portions && menuItem.portions.length > 0) {
        const portion = menuItem.portions.find(p => p.name === item.portion.name);

        if (!portion) {
            throw new PricingError(
                `Portion "${item.portion.name}" not available for "${menuItem.name}"`
            );
        }

        basePrice = portion.price || 0;
        console.log(`[OrderPricing] Portion "${portion.name}": ₹${basePrice}`);

    } else {
        // Use base item price
        basePrice = menuItem.price || 0;
        console.log(`[OrderPricing] Base price: ₹${basePrice}`);
    }

    // Validate and add addon prices
    if (item.selectedAddOns && Array.isArray(item.selectedAddOns)) {
        for (const selectedAddon of item.selectedAddOns) {
            // ✅ FIX: Support both flat addons array AND addOnGroups structure
            let addon = null;

            // Try flat addons array (legacy)
            if (menuItem.addons && Array.isArray(menuItem.addons)) {
                addon = menuItem.addons.find(a => a.name === selectedAddon.name);
            }

            // Try addOnGroups structure (new format)
            if (!addon && menuItem.addOnGroups && Array.isArray(menuItem.addOnGroups)) {
                for (const group of menuItem.addOnGroups) {
                    if (group.options && Array.isArray(group.options)) {
                        addon = group.options.find(opt => opt.name === selectedAddon.name);
                        if (addon) break; // Found it!
                    }
                }
            }

            if (!addon) {
                throw new PricingError(
                    `Addon "${selectedAddon.name}" not available for "${menuItem.name}"`
                );
            }

            const addonPrice = addon.price || 0;
            const addonQty = selectedAddon.quantity || 1;
            basePrice += addonPrice * addonQty;

            console.log(`[OrderPricing] Addon "${addon.name}": ₹${addonPrice} x ${addonQty}`);
        }
    }

    return basePrice;
}

/**
 * Validate client subtotal against server calculation
 * 
 * @param {number} clientSubtotal - Subtotal from client
 * @param {number} serverSubtotal - Server-calculated subtotal
 * @param {number} tolerance - Allowed difference (for rounding)
 * @returns {boolean} True if valid
 */
export function validatePriceMatch(clientSubtotal, serverSubtotal, tolerance = 1) {
    const difference = Math.abs(clientSubtotal - serverSubtotal);

    console.log(`[OrderPricing] Price validation:`);
    console.log(`  Client: ₹${clientSubtotal}`);
    console.log(`  Server: ₹${serverSubtotal}`);
    console.log(`  Difference: ₹${difference}`);
    console.log(`  Tolerance: ₹${tolerance}`);

    if (difference > tolerance) {
        console.error(`[OrderPricing] Price mismatch detail:`);
        console.error(`  Client Subtotal: ₹${clientSubtotal}`);
        console.error(`  Server Subtotal: ₹${serverSubtotal}`);
        console.error(`  Difference: ₹${difference}`);

        throw new PricingError(
            `Price mismatch detected. Menu prices may have changed. Please refresh and try again. (Client: ₹${clientSubtotal}, Server: ₹${serverSubtotal}, Diff: ₹${difference.toFixed(2)})`
        );
    }

    return true;
}

/**
 * Calculate taxes based on business settings
 * 
 * @param {number} subtotal - Subtotal amount
 * @param {Object} businessData - Business document data
 * @returns {Object} Tax calculation
 */
export function calculateTaxes(subtotal, businessData) {
    const gstEnabled = businessData.gstEnabled || false;
    const gstRate = businessData.gstPercentage !== undefined ? businessData.gstPercentage : (businessData.gstRate || 5);

    if (!gstEnabled) {
        return {
            cgst: 0,
            sgst: 0,
            totalTax: 0
        };
    }

    const halfRate = gstRate / 2;
    const cgst = Math.round((subtotal * halfRate) / 100);
    const sgst = Math.round((subtotal * halfRate) / 100);

    return {
        cgst,
        sgst,
        totalTax: cgst + sgst
    };
}
