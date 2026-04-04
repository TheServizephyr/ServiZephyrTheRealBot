import { redirect } from 'next/navigation';

const appendSearchParams = (basePath, searchParams = {}) => {
    const params = new URLSearchParams();

    Object.entries(searchParams || {}).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            value.forEach((entry) => {
                if (entry !== undefined && entry !== null && entry !== '') {
                    params.append(key, String(entry));
                }
            });
            return;
        }

        if (value !== undefined && value !== null && value !== '') {
            params.set(key, String(value));
        }
    });

    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
};

export default function OwnerDashboardPage({ searchParams }) {
    redirect(appendSearchParams('/owner-dashboard/live-orders', searchParams));
}
