/**
 * CLEAN TABLE API
 * 
 * Closes a dine-in tab after verifying all payments
 * Includes integrity check before closing
 * Makes table available for new customers
 */

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';
import { verifyTabIntegrity, areAllOrdersPaid, validateTabToken } from '@/lib/dinein-utils';

export async function POST(req) {
    try {
        const { tabId, token } = await req.json();

        if (!tabId || !token) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        // Verify token
        const isValid = await validateTabToken(tabId, token);
        if (!isValid) {
            return NextResponse.json(
                { error: 'Invalid token' },
                { status: 401 }
            );
        }

        // Step 1: Verify integrity BEFORE closing
        const { isValid: integrityValid, mismatch } = await verifyTabIntegrity(tabId);

        if (!integrityValid) {
            console.warn(`[Clean Table] Tab ${tabId} had mismatch of ₹${mismatch}, auto-corrected`);
        }

        const firestore = await getFirestore();

        const result = await firestore.runTransaction(async (transaction) => {
            const tabRef = firestore.collection('dine_in_tabs').doc(tabId);
            const tabSnap = await transaction.get(tabRef);

            if (!tabSnap.exists) {
                throw new Error('Tab not found');
            }

            const tabData = tabSnap.data();

            // Step 2: Check pending amount (after recalculation)
            if (tabData.pendingAmount > 0.01) {
                throw new Error(`Pending amount: ₹${tabData.pendingAmount.toFixed(2)}`);
            }

            // Close tab
            transaction.update(tabRef, {
                status: 'completed',
                closedAt: FieldValue.serverTimestamp(),
                finalTotalAmount: tabData.totalAmount,
                finalPaidAmount: tabData.paidAmount
            });

            return {
                totalCollected: tabData.paidAmount,
                integrityVerified: integrityValid
            };
        });

        // Step 3: Double-check all orders are paid
        const allPaid = await areAllOrdersPaid(tabId);

        if (!allPaid) {
            console.error(`[Clean Table] Some orders not paid for tab ${tabId}`);
            // Revert tab status
            await firestore.collection('dine_in_tabs').doc(tabId).update({
                status: 'active',
                closedAt: null
            });

            return NextResponse.json(
                { error: 'Some orders are not paid' },
                { status: 400 }
            );
        }

        return NextResponse.json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error('[Clean Table Error]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to clean table' },
            { status: 500 }
        );
    }
}
