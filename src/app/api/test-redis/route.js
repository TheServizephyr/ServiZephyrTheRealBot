import { NextResponse } from 'next/server';

export async function GET() {
    try {
        // Test 1: Check if @vercel/kv is available
        let kvAvailable = false;
        let kvError = null;

        try {
            const { kv } = await import('@vercel/kv');
            kvAvailable = true;

            // Test 2: Try to set and get a value
            await kv.set('test-key', 'test-value', { ex: 60 });
            const value = await kv.get('test-key');

            return NextResponse.json({
                success: true,
                kvAvailable: true,
                testValue: value,
                message: 'Redis is working perfectly!'
            });

        } catch (error) {
            kvError = error.message;
            kvAvailable = false;
        }

        // Test 3: Check environment variables
        const envVars = {
            KV_URL: process.env.KV_URL ? 'SET' : 'NOT SET',
            KV_REST_API_URL: process.env.KV_REST_API_URL ? 'SET' : 'NOT SET',
            KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN ? 'SET' : 'NOT SET',
            KV_REST_API_READ_ONLY_TOKEN: process.env.KV_REST_API_READ_ONLY_TOKEN ? 'SET' : 'NOT SET',
        };

        return NextResponse.json({
            success: false,
            kvAvailable,
            kvError,
            envVars,
            message: 'Redis connection failed - check details above'
        });

    } catch (error) {
        return NextResponse.json({
            success: false,
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
}
