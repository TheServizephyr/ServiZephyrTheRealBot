import { NextResponse } from 'next/server';
import axios from 'axios';

// Load environment variables from .env.local for local development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: './.env.local' });
}

const MAPPLS_API_KEY = process.env.NEXT_PUBLIC_MAPPLS_API_KEY;

export async function GET(req) {
    console.log("[API geocode] Request received.");
    const { searchParams } = new URL(req.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');

    if (!MAPPLS_API_KEY) {
        console.error("[API geocode] Mappls API Key is not configured. Check NEXT_PUBLIC_MAPPLS_API_KEY in your environment variables.");
        return NextResponse.json({ message: "Server configuration error: Mappls API Key is missing." }, { status: 500 });
    }

    if (!lat || !lng) {
        return NextResponse.json({ message: "Latitude and longitude are required." }, { status: 400 });
    }

    const url = `https://apis.mappls.com/advancedmaps/v1/${MAPPLS_API_KEY}/rev_geocode?lat=${lat}&lng=${lng}`;

    try {
        console.log(`[API geocode] Calling Mappls Reverse Geocode API.`);
        const response = await axios.get(url);
        
        if (response.data && response.data.results && response.data.results.length > 0) {
            const result = response.data.results[0];
            console.log("[API geocode] Mappls response successful:", result.formatted_address);
            return NextResponse.json(result, { status: 200 });
        } else {
            console.warn("[API geocode] Mappls API returned no results.");
            return NextResponse.json({ message: "No address found for this location." }, { status: 404 });
        }
    } catch (error) {
        const errorData = error.response ? error.response.data : { message: error.message };
        console.error("[API geocode] Error calling Mappls API:", errorData);
        return NextResponse.json({ message: "Failed to fetch address from Mappls.", error: errorData }, { status: error.response?.status || 500 });
    }
}
