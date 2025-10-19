import { NextResponse } from 'next/server';

const MAPPLS_API_KEY = process.env.MAPPLS_API_KEY;

export async function GET(req) {
    console.log("[API search] Request received.");
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('query');

    if (!MAPPLS_API_KEY) {
        console.error("[API search] Mappls API Key is not configured for the backend. Check MAPPLS_API_KEY in your environment variables.");
        return NextResponse.json({ message: "Server configuration error: Mappls API Key is missing." }, { status: 500 });
    }

    if (!query) {
        return NextResponse.json({ message: "Search query is required." }, { status: 400 });
    }
    
    // CORRECTED URL and parameters as per Autosuggest API documentation
    const url = `https://search.mappls.com/search/places/autosuggest?query=${query}&access_token=${MAPPLS_API_KEY}`;

    try {
        console.log(`[API search] Calling Mappls AutoSuggest API...`);
        const response = await fetch(url);
        const data = await response.json();
        
        if (!response.ok) {
            const errorData = data.error || { message: 'An unknown error occurred with Mappls API.' };
            throw new Error(errorData.message);
        }
        
        console.log("[API search] Mappls response successful.");
        // The API response for autosuggest has a different structure.
        // It returns an object with a `suggestedLocations` array.
        return NextResponse.json(data, { status: 200 });

    } catch (error) {
        console.error("[API search] Error calling Mappls API:", error.message);
        return NextResponse.json({ message: "Failed to fetch search results from Mappls.", error: error.message }, { status: 500 });
    }
}
