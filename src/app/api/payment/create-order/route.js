
import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { nanoid } from 'nanoid';

export async function POST(req) {
    try {
        const { amount } = await req.json();

        if (!amount || amount <= 0) {
            return NextResponse.json({ message: 'Valid amount is required.' }, { status: 400 });
        }
        
        if (!process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            console.error("Razorpay keys are not configured in environment variables.");
            return NextResponse.json({ message: 'Payment gateway is not configured.' }, { status: 500 });
        }

        const razorpay = new Razorpay({
            key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });

        const options = {
            amount: Math.round(amount * 100), // Amount in the smallest currency unit (paisa for INR)
            currency: 'INR',
            receipt: `receipt_order_${nanoid()}`,
            payment_capture: 1 // Auto-capture payment
        };
        
        const order = await razorpay.orders.create(options);
        
        console.log("[Create Order API] Razorpay Order created:", order);
        return NextResponse.json(order, { status: 200 });

    } catch (error) {
        console.error('RAZORPAY ORDER CREATION ERROR:', error);
        return NextResponse.json({ message: `Backend Error: ${error.message}` }, { status: 500 });
    }
}

    