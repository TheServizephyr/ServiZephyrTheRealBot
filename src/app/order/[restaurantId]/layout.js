import { preload } from 'react-dom';

export default function OrderLayout({ children, params }) {
    const { restaurantId } = params;

    // 🚀 BROWSER-LEVEL PREFETCHING FOR MAXIMUM UX SPEED
    // These preload instructions tell Next.js to inject <link rel="preload"> tags into the HTML <head>.
    // The browser will start downloading the APIs concurrently with HTML parsing,
    // dramatically lowering LCP (Largest Contentful Paint).
    preload(`/api/public/menu/${restaurantId}`, { as: 'fetch', crossOrigin: 'anonymous' });
    preload(`/api/public/settings/${restaurantId}`, { as: 'fetch', crossOrigin: 'anonymous' });

    return <>{children}</>;
}
