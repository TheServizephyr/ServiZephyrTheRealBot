import { NextResponse } from 'next/server';
import axios from 'axios';
import getConfig from 'next/config';

// Use serverRuntimeConfig to get the API key on the server
const { serverRuntimeConfig } = getConfig();
const MAPPLS_API_KEY = serverRuntimeConfig.mapplsApiKey;

export async function GET(req) {
    console.log("[API search] Request received.");
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('query');

    if (!MAPPLS_API_KEY) {
        console.error("[API search] Mappls API Key is not configured in next.config.js serverRuntimeConfig.");
        return NextResponse.json({ message: "Server configuration error." }, { status: 500 });
    }

    if (!query) {
        return NextResponse.json({ message: "Search query is required." }, { status: 400 });
    }
    
    // Using Auto-Suggest API for better search-as-you-type experience
    const url = `https://apis.mappls.com/advancedmaps/v1/${MAPPLS_API_KEY}/autosuggest?q=${encodeURIComponent(query)}`;

    try {
        console.log(`[API search] Calling Mappls AutoSuggest API.`);
        const response = await axios.get(url);
        
        console.log("[API search] Mappls response successful.");
        return NextResponse.json(response.data, { status: 200 });
    } catch (error) {
        console.error("[API search] Error calling Mappls API:", error.response ? error.response.data : error.message);
        return NextResponse.json({ message: "Failed to fetch search results from Mappls." }, { status: 500 });
    }
}
