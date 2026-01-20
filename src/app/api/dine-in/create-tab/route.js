/**
 * CREATE DINE-IN TAB API
 * 
 * Creates a new dine-in tab with transaction-based atomicity
 * Prevents concurrent tab creation for same table
 * Supports group sizes > 1
 */

import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    try {
        const {
            restaurantId,
            tableId,
            capacity,
            groupSize = 1,
            customerName
        } = await req.json();

        // Validate inputs
        if (!restaurantId || !tableId || !capacity) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Validate group size
        if (groupSize > capacity) {
            return NextResponse.json(
                { error: 'Group size exceeds table capacity' },
                { status: 400 }
            );
        }

        const firestore = await getFirestore();

        // Transaction for atomicity
        const result = await firestore.runTransaction(async (transaction) => {
            // Check for existing active tabs on this table
            const tabsRef = firestore.collection('dine_in_tabs');
            const existingQuery = tabsRef
                .where('tableId', '==', tableId)
                .where('restaurantId', '==', restaurantId)
                .where('status', '==', 'active')
                .limit(1);

            const existingSnap = await transaction.get(existingQuery);

            if (!existingSnap.empty) {
                const existingTab = existingSnap.docs[0];
                const existingData = existingTab.data();

                // Return existing tab info instead of error
                return {
                    exists: true,
                    tabId: existingTab.id,
                    token: existingData.token,
                    occupiedSeats: existingData.occupiedSeats,
                    availableSeats: existingData.availableSeats,
                    capacity: existingData.capacity
                };
            }

            // Create new tab
            const tabId = `tab_${nanoid(12)}`;
            const token = nanoid(32);

            const tabData = {
                restaurantId,
                tableId,
                capacity,
                occupiedSeats: groupSize,
                availableSeats: capacity - groupSize,
                status: 'active',
                token,

                // Amounts (cached - derived from orders)
                totalAmount: 0,
                paidAmount: 0,
                pendingAmount: 0,

                // Timestamps
                createdAt: FieldValue.serverTimestamp(),
                createdBy: customerName || 'Guest',
                lastRecalculatedAt: FieldValue.serverTimestamp(),
                lastModifiedAt: FieldValue.serverTimestamp()
            };

            transaction.set(tabsRef.doc(tabId), tabData);

            return {
                exists: false,
                tabId,
                token,
                occupiedSeats: groupSize,
                availableSeats: capacity - groupSize,
                capacity
            };
        });

        return NextResponse.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error('[Create Tab Error]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to create tab' },
            { status: 500 }
        );
    }
}
