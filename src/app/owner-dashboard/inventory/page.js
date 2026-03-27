'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, AlertTriangle } from 'lucide-react';
import InventoryManagerPage from '@/components/inventory/InventoryManagerPage';
import { Card, CardContent } from '@/components/ui/card';

const normalizeBusinessType = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'shop' || normalized === 'store') return 'store';
    if (normalized === 'street-vendor' || normalized === 'street_vendor') return 'street-vendor';
    return 'restaurant';
};

function InventoryPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [businessType, setBusinessType] = useState(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        setBusinessType(normalizeBusinessType(localStorage.getItem('businessType')));
    }, []);

    useEffect(() => {
        if (!businessType || businessType === 'store') return;

        const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
        const employeeOfOwnerId = searchParams.get('employee_of');
        const nextParams = new URLSearchParams();

        if (impersonatedOwnerId) {
            nextParams.set('impersonate_owner_id', impersonatedOwnerId);
        } else if (employeeOfOwnerId) {
            nextParams.set('employee_of', employeeOfOwnerId);
        }

        const query = nextParams.toString();
        router.replace(query ? `/owner-dashboard/menu?${query}` : '/owner-dashboard/menu');
    }, [businessType, router, searchParams]);

    if (!businessType) {
        return (
            <div className="flex min-h-[50vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (businessType !== 'store') {
        return (
            <div className="p-4 md:p-6">
                <Card className="border-amber-500/30 bg-amber-500/5">
                    <CardContent className="flex items-start gap-4 p-6 md:p-8">
                        <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-500" />
                        <div className="space-y-2">
                            <h1 className="text-xl font-bold tracking-tight">Inventory</h1>
                            <p className="text-sm text-muted-foreground">
                                Dedicated inventory management is currently enabled for store businesses. Other outlet types can continue using menu availability controls.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <InventoryManagerPage
            title="Inventory"
            subtitle="Track stock, identify low-stock products, and update sellable quantity quickly."
        />
    );
}

export default function OwnerInventoryPage() {
    return (
        <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
            <InventoryPageContent />
        </Suspense>
    );
}
