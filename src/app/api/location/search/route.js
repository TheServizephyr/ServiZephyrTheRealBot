
import { NextResponse } from 'next/server';

const MAPPLS_API_KEY = process.env.MAPPLS_API_KEY;

export async function GET(req) {
     if (!MAPPLS_API_KEY) {
        console.error("[API search] Mappls API Key is not configured.");
        return NextResponse.json({ message: "Search service is not configured on the server." }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    const query = searchParams.get('query');

    if (!query) {
        return NextResponse.json({ message: "Search query is required." }, { status: 400 });
    }

    // THE FIX: Mappls autosuggest requires a GET request with the API key in the URL.
    const url = `https://apis.mappls.com/v1/autosuggest?query=${encodeURIComponent(query)}&filter=country:IND`;
    
    console.log(`[API search] Calling Mappls Autosuggest API (GET): ${url}`);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                 'Authorization': `Bearer ${MAPPLS_API_KEY}`
            },
        });
        
        console.log(`[API search] Mappls response status: ${response.status}`);
        const data = await response.json();

        if (!response.ok) {
            const errorMessage = data?.error || `Mappls returned status ${response.status}`;
            console.error(`[API search] Mappls API error:`, errorMessage);
            return NextResponse.json({ message: errorMessage }, { status: response.status });
        }

        const suggestedLocations = (data.suggestedLocations || []).map(item => ({
            placeName: item.placeName,
            placeAddress: item.placeAddress,
            latitude: item.latitude,
            longitude: item.longitude,
            eLoc: item.eLoc 
        }));
        
        console.log("[API search] Mappls response successful, transformed to expected format.");
        return NextResponse.json(suggestedLocations, { status: 200 });

    } catch (error) {
        console.error(`[API search] CRITICAL Error calling Mappls API: ${error.message}`);
        return NextResponse.json({ message: "Failed to fetch search results from geocoding service.", error: error.message }, { status: 500 });
    }
}
