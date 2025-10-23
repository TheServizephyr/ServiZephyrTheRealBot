
import { NextResponse } from 'next/server';

// This API now uses the free Nominatim service from OpenStreetMap
export async function GET(req) {
    console.log("[API geocode] Request received for Reverse Geocoding via Nominatim.");
    const { searchParams } = new URL(req.url);
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');

    if (!lat || !lng) {
        return NextResponse.json({ message: "Latitude and longitude are required." }, { status: 400 });
    }

    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
    console.log(`[API geocode] Calling Nominatim API: ${url}`);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'ServiZephyr/1.0 (ashwanibaghel@servizephyr.com)' // Nominatim requires a user-agent
            }
        });
        
        console.log(`[API geocode] Nominatim response status: ${response.status}`);
        
        const data = await response.json();

        if (response.ok && data.address) {
            const addr = data.address;
            const result = {
                house_number: addr.house_number || '',
                road: addr.road || '',
                neighbourhood: addr.neighbourhood || '',
                suburb: addr.suburb || '',
                city: addr.city || addr.town || addr.village || '',
                state: addr.state || '',
                pincode: addr.postcode || '',
                country: addr.country || '',
                formatted_address: data.display_name || 'Address not found'
            };
            console.log("[API geocode] Nominatim response successful:", result.formatted_address);
            return NextResponse.json(result, { status: 200 });
        } else {
            const errorMessage = data?.error || `Nominatim returned status ${response.status}`;
            console.warn(`[API geocode] Nominatim API returned an error:`, errorMessage);
            return NextResponse.json({ message: errorMessage }, { status: response.status });
        }
    } catch (error) {
        console.error(`[API geocode] CRITICAL Error calling Nominatim API:`, error);
        return NextResponse.json({ message: "Failed to fetch address from geocoding service.", error: error.message }, { status: 500 });
    }
}
