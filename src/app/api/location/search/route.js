import { NextResponse } from 'next/server';
import axios from 'axios';

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
    const url = `https://atlas.mappls.com/api/places/search/json`;

    try {
        console.log(`[API search] Calling Mappls AutoSuggest API at: ${url}`);
        const response = await axios.get(url, {
            params: {
                query: query,
                access_token: MAPPLS_API_KEY
            }
        });
        
        console.log("[API search] Mappls response successful.");
        // The API response for autosuggest has a different structure.
        // It returns an object with a `suggestedLocations` array.
        return NextResponse.json(response.data, { status: 200 });

    } catch (error) {
        const errorData = error.response ? error.response.data : { message: error.message };
        console.error("[API search] Error calling Mappls API:", errorData);
        return NextResponse.json({ message: "Failed to fetch search results from Mappls.", error: errorData }, { status: error.response?.status || 500 });
    }
}
