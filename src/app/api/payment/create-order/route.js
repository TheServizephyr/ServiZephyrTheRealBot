
import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { nanoid } from 'nanoid';

export async function POST(req) {
    try {
        const { amount } = await req.json();

        if (!amount || amount < 1) {
            return NextResponse.json({ message: 'A valid amount is required.' }, { status: 400 });
        }

        if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            console.error("CRITICAL: Razorpay credentials are not configured.");
            return NextResponse.json({ message: 'Payment gateway is not configured on the server.' }, { status: 500 });
        }
        
        const razorpay = new Razorpay({
            key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });

        const options = {
            amount: Math.round(amount * 100), // amount in the smallest currency unit
            currency: "INR",
            receipt: `receipt_split_${nanoid(10)}`,
        };

        const order = await razorpay.orders.create(options);
        
        return NextResponse.json(order, { status: 200 });

    } catch (error) {
        console.error("RAZORPAY CREATE ORDER ERROR (for split):", error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}

    