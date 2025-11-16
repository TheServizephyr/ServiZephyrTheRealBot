

import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { nanoid } from 'nanoid';
import { getFirestore, FieldValue } from '@/lib/firebase-admin';

export async function POST(req) {
    console.log("[DEBUG] /api/payment/create-order: POST request received.");
    try {
        const body = await req.json();
        console.log("[DEBUG] /api/payment/create-order: Full request body:", JSON.stringify(body, null, 2));
        
        const { grandTotal, totalAmount, subtotal, splitCount, baseOrderId, restaurantId } = body;
        
        console.log(`[DEBUG] /api/payment/create-order: Destructured values - grandTotal: ${grandTotal}, totalAmount: ${totalAmount}, splitCount: ${splitCount}`);

        const finalAmount = grandTotal ?? totalAmount;
        console.log(`[DEBUG] /api/payment/create-order: Final amount calculated for payment: ${finalAmount}`);

        if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            console.error("CRITICAL: Razorpay credentials are not configured.");
            return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
        }
        
        const razorpay = new Razorpay({
            key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });

        // If it's a split bill request
        if (splitCount && baseOrderId && restaurantId && finalAmount) {
            console.log(`[DEBUG] /api/payment/create-order: Initiating SPLIT BILL flow.`);
            const firestore = await getFirestore();
            const amountPerShare = Math.round((finalAmount / splitCount) * 100); // Amount in paise
            console.log(`[DEBUG] /api/payment/create-order: Amount per share calculated: ${amountPerShare} paise.`);
            
            const splitId = `split_${baseOrderId}`;
            const splitRef = firestore.collection('split_payments').doc(splitId);
            console.log(`[DEBUG] /api/payment/create-order: Firestore split session ID: ${splitId}`);

            const shares = [];
            for (let i = 0; i < splitCount; i++) {
                const shareReceipt = `share_${splitId}_${i}`;
                console.log(`[DEBUG] /api/payment/create-order: Creating Razorpay order for share ${i+1}...`);
                const rzpOrder = await razorpay.orders.create({
                    amount: amountPerShare,
                    currency: "INR",
                    receipt: shareReceipt
                });
                console.log(`[DEBUG] /api/payment/create-order: Razorpay order created for share ${i+1}: ${rzpOrder.id}`);
                shares.push({
                    shareId: i,
                    razorpay_order_id: rzpOrder.id,
                    amount: amountPerShare / 100,
                    status: 'pending',
                });
            }

            const firestorePayload = {
                id: splitId,
                baseOrderId,
                restaurantId,
                totalAmount: finalAmount,
                splitCount,
                shares,
                status: 'pending',
                createdAt: FieldValue.serverTimestamp(),
                isPublic: true // Ensure public readability via security rules
            };
            console.log("[DEBUG] /api/payment/create-order: Writing to Firestore:", JSON.stringify(firestorePayload, null, 2));
            await splitRef.set(firestorePayload);
            console.log("[DEBUG] /api/payment/create-order: Split session created successfully in Firestore.");

            return NextResponse.json({ message: 'Split session created', splitId }, { status: 200 });
        }

        // --- Fallback for simple order creation (as it was before) ---
        console.log(`[DEBUG] /api/payment/create-order: Initiating SIMPLE order flow.`);
        
        const amountForSimpleOrder = subtotal !== undefined ? subtotal : finalAmount;

        if (!amountForSimpleOrder || amountForSimpleOrder < 1) {
            console.error("[DEBUG] /api/payment/create-order: Simple order failed - amount is missing or invalid.");
            return NextResponse.json({ message: 'A valid amount is required for a simple order.' }, { status: 400 });
        }
        const options = {
            amount: Math.round(amountForSimpleOrder * 100),
            currency: "INR",
            receipt: `receipt_${nanoid(10)}`,
        };
        console.log("[DEBUG] /api/payment/create-order: Creating simple Razorpay order...");
        const order = await razorpay.orders.create(options);
        console.log("[DEBUG] /api/payment/create-order: Simple order created successfully.");
        return NextResponse.json(order, { status: 200 });


    } catch (error) {
        console.error("[DEBUG] /api/payment/create-order: CRITICAL ERROR in POST handler:", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}
