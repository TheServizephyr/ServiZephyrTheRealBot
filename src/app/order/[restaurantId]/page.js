import { headers } from 'next/headers';

import OrderPageClient from './OrderPageClient';

export const dynamic = 'force-dynamic';

function buildRequestOrigin(headerStore) {
  const forwardedProto = headerStore.get('x-forwarded-proto');
  const forwardedHost = headerStore.get('x-forwarded-host');
  const host = forwardedHost || headerStore.get('host');
  const proto = forwardedProto || (host?.includes('localhost') ? 'http' : 'https');
  return host ? `${proto}://${host}` : null;
}

async function fetchInitialOrderBootstrap({ restaurantId, searchParams }) {
  const headerStore = headers();
  const origin = buildRequestOrigin(headerStore);
  if (!origin || !restaurantId) return null;

  const query = new URLSearchParams({ src: 'order_page_ssr' });
  const phone = String(searchParams?.phone || '').trim();
  const token = String(searchParams?.token || '').trim();
  const ref = String(searchParams?.ref || '').trim();

  if (phone) query.set('phone', phone);
  if (token) query.set('token', token);
  if (ref) query.set('ref', ref);

  try {
    const res = await fetch(`${origin}/api/public/bootstrap/${encodeURIComponent(String(restaurantId))}?${query.toString()}`, {
      cache: 'no-store',
      headers: {
        cookie: headerStore.get('cookie') || '',
        'x-forwarded-for': headerStore.get('x-forwarded-for') || '',
        'x-real-ip': headerStore.get('x-real-ip') || '',
        'user-agent': headerStore.get('user-agent') || '',
      },
    });

    if (!res.ok) return null;
    const payload = await res.json();
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

export default async function OrderPage({ params, searchParams }) {
  const { restaurantId } = params || {};
  const normalizedSearchParams = Object.fromEntries(
    Object.entries(searchParams || {}).map(([key, value]) => [
      key,
      Array.isArray(value) ? (value[0] ?? '') : (value ?? ''),
    ])
  );
  const initialBootstrap = await fetchInitialOrderBootstrap({
    restaurantId,
    searchParams: normalizedSearchParams,
  });

  return <OrderPageClient initialBootstrap={initialBootstrap} initialSearchParams={normalizedSearchParams} />;
}
