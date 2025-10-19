
import { NextResponse } from 'next/server';

const MAPPLS_API_KEY = process.env.MAPPLS_API_KEY; // Correct variable for backend

export async function GET(req) {
    console.log("[API search] Request received.");
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('query');

    if (!MAPPLS_API_KEY) {
        console.error("[API search] Mappls API Key (MAPPLS_API_KEY) is not configured.");
        return NextResponse.json({ message: "Server configuration error: Mappls API Key is missing." }, { status: 500 });
    }

    if (!query) {
        return NextResponse.json({ message: "Search query is required." }, { status: 400 });
    }

    // URL without access_token query parameter
    const url = `https://atlas.mappls.com/api/places/search/json?query=${encodeURIComponent(query)}`; // Use atlas.mappls.com and correct endpoint

    try {
        console.log(`[API search] Calling Mappls AutoSuggest API...`);
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                 // Key sent in Authorization header
                'Authorization': `bearer ${MAPPLS_API_KEY}`
            }
        });
        const data = await response.json();

        if (!response.ok) {
             // Updated error handling for Mappls REST API structure
            const errorMessage = data?.error || data?.errorMessage || 'An unknown error occurred with Mappls API.';
            console.error(`[API search] Mappls API error: ${response.status}`, errorMessage);
            throw new Error(errorMessage);
        }

        console.log("[API search] Mappls response successful.");
        // The autosuggest API seems to return 'suggestedLocations'
        return NextResponse.json({ suggestedLocations: data.suggestedLocations || data.copResults || [] }, { status: 200 });

    } catch (error) {
        console.error("[API search] Error calling Mappls API:", error.message);
        return NextResponse.json({ message: "Failed to fetch search results from Mappls.", error: error.message }, { status: 500 });
    }
}
