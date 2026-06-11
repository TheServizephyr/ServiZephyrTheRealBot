import SearchClient from './SearchClient';

export const metadata = {
    title: 'Discover Food & Compare Prices | ServiZephyr',
    description: 'Find the cheapest and nearest dishes from local food outlets and order directly on WhatsApp.',
};

export default async function SearchPage({ searchParams }) {
    const params = await searchParams;
    const q = params?.q || '';
    const lat = params?.lat || '';
    const lng = params?.lng || '';
    const filter = params?.filter || 'nearest';

    return (
        <SearchClient
            initialQuery={q}
            initialLat={lat}
            initialLng={lng}
            initialFilter={filter}
        />
    );
}
