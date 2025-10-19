import { NextResponse } from 'next/server';
import axios from 'axios';

const MAPPLS_API_KEY = process.env.NEXT_PUBLIC_MAPPLS_API_KEY;

export async function GET(req) {
    console.log("[API search] Request received.");
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('query');

    if (!MAPPLS_API_KEY) {
        console.error("[API search] Mappls API Key is not configured. Check NEXT_PUBLIC_MAPPLS_API_KEY in your environment variables.");
        return NextResponse.json({ message: "Server configuration error: Mappls API Key is missing." }, { status: 500 });
    }

    if (!query) {
        return NextResponse.json({ message: "Search query is required." }, { status: 400 });
    }
    
    const url = `https://apis.mappls.com/advancedmaps/v1/${MAPPLS_API_KEY}/autosuggest?q=${encodeURIComponent(query)}`;

    try {
        console.log(`[API search] Calling Mappls AutoSuggest API.`);
        const response = await axios.get(url);
        
        console.log("[API search] Mappls response successful.");
        return NextResponse.json(response.data, { status: 200 });
    } catch (error) {
        const errorData = error.response ? error.response.data : { message: error.message };
        console.error("[API search] Error calling Mappls API:", errorData);
        return NextResponse.json({ message: "Failed to fetch search results from Mappls.", error: errorData }, { status: error.response?.status || 500 });
    }
}
