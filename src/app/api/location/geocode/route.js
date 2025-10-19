
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

    // URL without access_token query parameter
    const url = `https://apis.mappls.com/apis/O/rev_geocode?lat=${lat}&lng=${lng}`; // Use apis.mappls.com and correct endpoint

    try {
        console.log(`[API geocode] Calling Mappls Reverse Geocode API.`);
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                // Key sent in Authorization header
                'Authorization': `bearer ${MAPPLS_API_KEY}`
            }
        });
        const data = await response.json();

        if (response.ok && data && data.results && data.results.length > 0) {
            const result = data.results[0];
            console.log("[API geocode] Mappls response successful:", result.formatted_address);
            return NextResponse.json(result, { status: 200 });
        } else {
            // Updated error handling for Mappls REST API structure
            const errorMessage = data?.error || data?.errorMessage || "No address found or API error.";
            console.warn(`[API geocode] Mappls API returned status ${response.status} with message:`, errorMessage);
            return NextResponse.json({ message: errorMessage }, { status: response.status === 200 ? 404 : response.status });
        }
    } catch (error) {
        const errorData = { message: error.message };
        console.error("[API geocode] CRITICAL Error calling Mappls API:", error);
        return NextResponse.json({ message: "Failed to fetch address from Mappls.", error: errorData }, { status: 500 });
    }
}
