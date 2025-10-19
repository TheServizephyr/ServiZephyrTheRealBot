import { NextResponse } from 'next/server';

// This API now uses a server-side-only environment variable for security.
const MAPPLS_API_KEY = process.env.MAPPLS_API_KEY;

export async function GET(req) {
    console.log("[API geocode] Request received.");
    const { searchParams } = new URL(req.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');

    if (!MAPPLS_API_KEY) {
        console.error("[API geocode] Mappls API Key is not configured for the backend. Check MAPPLS_API_KEY in your environment variables.");
        return NextResponse.json({ message: "Server configuration error: Mappls API Key is missing." }, { status: 500 });
    }

    if (!lat || !lng) {
        return NextResponse.json({ message: "Latitude and longitude are required." }, { status: 400 });
    }

    // CORRECTED URL based on official Mappls documentation for Reverse Geocoding.
    const url = `https://apis.mappls.com/advancedmaps/v1/${MAPPLS_API_KEY}/rev_geocode?lat=${lat}&lng=${lng}`;

    try {
        console.log(`[API geocode] Calling Mappls Reverse Geocode API at: ${url}`);
        const response = await fetch(url);
        const data = await response.json();
        
        if (response.ok && data && data.results && data.results.length > 0) {
            const result = data.results[0];
            console.log("[API geocode] Mappls response successful:", result.formatted_address);
            return NextResponse.json(result, { status: 200 });
        } else {
            const errorMessage = data?.error?.message || data?.message || "No address found for this location.";
            console.warn("[API geocode] Mappls API returned no results or an error:", errorMessage);
            return NextResponse.json({ message: errorMessage }, { status: response.status === 200 ? 404 : response.status });
        }
    } catch (error) {
        const errorData = { message: error.message };
        console.error("[API geocode] Error calling Mappls API:", errorData);
        return NextResponse.json({ message: "Failed to fetch address from Mappls.", error: errorData }, { status: 500 });
    }
}
