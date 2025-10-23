
import { NextResponse } from 'next/server';

// This API now uses the free Nominatim service from OpenStreetMap
export async function GET(req) {
    console.log("[API search] Request received for location search via Nominatim.");
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('query');

    if (!query) {
        return NextResponse.json({ message: "Search query is required." }, { status: 400 });
    }
    
    // Add "India" to the query for better results in the region
    const biasedQuery = `${query}, India`;

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(biasedQuery)}&addressdetails=1&limit=5`;
    console.log(`[API search] Calling Nominatim API: ${url}`);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'ServiZephyr/1.0 (ashwanibaghel@servizephyr.com)' // Nominatim requires a user-agent
            }
        });
        
        console.log(`[API search] Nominatim response status: ${response.status}`);
        const data = await response.json();

        if (!response.ok) {
            const errorMessage = data?.error || `Nominatim returned status ${response.status}`;
            console.error(`[API search] Nominatim API error:`, errorMessage);
            return NextResponse.json({ message: errorMessage }, { status: response.status });
        }

        // Transform Nominatim data to match the expected `suggestedLocations` format
        const suggestedLocations = data.map(item => ({
            placeName: item.display_name.split(',')[0],
            placeAddress: item.display_name,
            latitude: parseFloat(item.lat),
            longitude: parseFloat(item.lon),
            eLoc: item.place_id // Use place_id as a unique key
        }));
        
        console.log("[API search] Nominatim response successful, transformed to expected format.");
        return NextResponse.json(suggestedLocations, { status: 200 });

    } catch (error) {
        console.error(`[API search] CRITICAL Error calling Nominatim API: ${error.message}`);
        return NextResponse.json({ message: "Failed to fetch search results from geocoding service.", error: error.message }, { status: 500 });
    }
}
