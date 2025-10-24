
import { NextResponse } from 'next/server';

const MAPPLS_API_KEY = process.env.MAPPLS_API_KEY;

export async function GET(req) {
    if (!MAPPLS_API_KEY) {
        console.error("[API geocode] Mappls API Key is not configured.");
        return NextResponse.json({ message: "Geocoding service is not configured on the server." }, { status: 500 });
    }

    console.log("[API geocode] Request received for Reverse Geocoding via Mappls.");
    const { searchParams } = new URL(req.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');

    if (!lat || !lng) {
        return NextResponse.json({ message: "Latitude and longitude are required." }, { status: 400 });
    }

    const url = `https://apis.mappls.com/v1/rev_geocode?lat=${lat}&lng=${lng}`;
    console.log(`[API geocode] Calling Mappls API: ${url}`);

    try {
        const response = await fetch(url, {
            method: 'POST', // Mappls reverse geocode uses POST
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${MAPPLS_API_KEY}`
            },
        });
        
        console.log(`[API geocode] Mappls response status: ${response.status}`);
        
        const data = await response.json();

        if (response.ok && data.results && data.results.length > 0) {
            const addr = data.results[0];
            const result = {
                house_number: addr.houseNumber || '',
                road: addr.street || '',
                neighbourhood: addr.subLocality || '',
                suburb: addr.locality || '',
                city: addr.city || addr.district || '',
                state: addr.state || '',
                pincode: addr.pincode || '',
                country: 'India',
                formatted_address: addr.formatted_address || 'Address not found'
            };
            console.log("[API geocode] Mappls response successful:", result.formatted_address);
            return NextResponse.json(result, { status: 200 });
        } else {
            const errorMessage = data?.error || `Mappls returned status ${response.status}`;
            console.warn(`[API geocode] Mappls API returned an error:`, errorMessage);
            return NextResponse.json({ message: errorMessage }, { status: response.status });
        }
    } catch (error) {
        console.error(`[API geocode] CRITICAL Error calling Mappls API:`, error);
        return NextResponse.json({ message: "Failed to fetch address from geocoding service.", error: error.message }, { status: 500 });
    }
}
