import { NextResponse } from 'next/server';
import axios from 'axios';

const MAPPLS_API_KEY = process.env.NEXT_PUBLIC_MAPPLS_API_KEY;

export async function GET(req) {
    console.log("[API geocode] Request received.");
    const { searchParams } = new URL(req.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');

    if (!MAPPLS_API_KEY) {
        console.error("[API geocode] Mappls API Key is not configured.");
        return NextResponse.json({ message: "Server configuration error." }, { status: 500 });
    }

    if (!lat || !lng) {
        return NextResponse.json({ message: "Latitude and longitude are required." }, { status: 400 });
    }

    const url = `https://apis.mappls.com/advancedmaps/v1/${MAPPLS_API_KEY}/rev_geocode?lat=${lat}&lng=${lng}`;

    try {
        console.log(`[API geocode] Calling Mappls Reverse Geocode API: ${url}`);
        const response = await axios.get(url);
        
        if (response.data && response.data.results && response.data.results.length > 0) {
            const result = response.data.results[0];
            console.log("[API geocode] Mappls response successful:", result);
            return NextResponse.json(result, { status: 200 });
        } else {
            console.warn("[API geocode] Mappls API returned no results.");
            return NextResponse.json({ message: "No address found for this location." }, { status: 404 });
        }
    } catch (error) {
        console.error("[API geocode] Error calling Mappls API:", error.response ? error.response.data : error.message);
        return NextResponse.json({ message: "Failed to fetch address from Mappls." }, { status: 500 });
    }
}
