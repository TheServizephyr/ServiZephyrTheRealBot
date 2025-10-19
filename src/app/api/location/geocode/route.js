
import { NextResponse } from 'next/server';

const MAPPLS_API_KEY = process.env.MAPPLS_API_KEY; // Correct variable for backend

export async function GET(req) {
    console.log("[API geocode] Request received for Reverse Geocoding.");
    const { searchParams } = new URL(req.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');

    if (!MAPPLS_API_KEY) {
        console.error("[API geocode] Mappls API Key (MAPPLS_API_KEY) is not configured.");
        return NextResponse.json({ message: "Server configuration error: Mappls API Key is missing." }, { status: 500 });
    }

    if (!lat || !lng) {
        return NextResponse.json({ message: "Latitude and longitude are required." }, { status: 400 });
    }

    // CORRECTED: Use the apis.mappls.com domain for this specific REST endpoint
    const url = `https://apis.mappls.com/apis/O/rev_geocode?lat=${lat}&lng=${lng}`;

    try {
        console.log(`[API geocode] Calling Mappls Reverse Geocode API: ${url}`);
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                // CORRECTED: Send API key via Authorization header for REST APIs
                'Authorization': `bearer ${MAPPLS_API_KEY}`
            }
        });
        
        console.log(`[API geocode] Mappls response status: ${response.status}`);
        
        const responseText = await response.text();
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (e) {
            console.error(`[API geocode] CRITICAL Error parsing Mappls JSON response. Raw text: ${responseText}`);
            throw new Error(`Mappls returned non-JSON response: ${responseText.substring(0, 100)}...`);
        }

        if (response.ok && data && data.results && data.results.length > 0) {
            const result = data.results[0];
            console.log("[API geocode] Mappls response successful:", result.formatted_address);
            return NextResponse.json(result, { status: 200 });
        } else {
            const errorMessage = data?.error || `Mappls returned status ${response.status}`;
            console.warn(`[API geocode] Mappls API returned an error:`, errorMessage);
            return NextResponse.json({ message: errorMessage }, { status: response.status === 200 ? 404 : response.status });
        }
    } catch (error) {
        console.error(`[API geocode] CRITICAL Error calling Mappls API:`, error);
        return NextResponse.json({ message: "Failed to fetch address from Mappls.", error: error.message }, { status: 500 });
    }
}
