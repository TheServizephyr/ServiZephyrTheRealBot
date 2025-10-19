
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
        console.warn("[API search] Search query is missing.");
        return NextResponse.json({ message: "Search query is required." }, { status: 400 });
    }

    const url = `https://atlas.mappls.com/api/places/search/json?query=${encodeURIComponent(query)}`;
    console.log("[API search] Calling Mappls AutoSuggest API:", url);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `bearer ${MAPPLS_API_KEY}`
            }
        });
        
        console.log(`[API search] Mappls response status: ${response.status}`);
        const data = await response.json();

        if (!response.ok) {
            const errorMessage = data?.error || data?.errorMessage || 'An unknown error occurred with Mappls API.';
            console.error(`[API search] Mappls API error: ${response.status}`, errorMessage);
            throw new Error(errorMessage);
        }

        console.log("[API search] Mappls response successful.");
        return NextResponse.json(data, { status: 200 });

    } catch (error) {
        console.error("[API search] CRITICAL Error calling Mappls API:", error.message);
        return NextResponse.json({ message: "Failed to fetch search results from Mappls.", error: error.message }, { status: 500 });
    }
}
