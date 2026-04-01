"use client";

import React, { useState, useEffect, Suspense, useCallback } from 'react';
import Table from "@/components/OwnerDashboard/Table";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import styles from "@/components/OwnerDashboard/OwnerDashboard.module.css";
import { auth } from '@/lib/firebase';
import { useSearchParams } from "next/navigation";
import InfoDialog from "@/components/InfoDialog";
import OfflineDesktopStatus from '@/components/OfflineDesktopStatus';
import { isDesktopApp } from '@/lib/desktop/runtime';
import { getOfflineNamespace, setOfflineNamespace } from '@/lib/desktop/offlineStore';

export const dynamic = 'force-dynamic';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

function OrdersPageContent() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
  const searchParams = useSearchParams();
  const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
  const ordersCacheKey = React.useMemo(() => `owner_orders::${impersonatedOwnerId || 'owner_self'}`, [impersonatedOwnerId]);

  const loadData = useCallback(async (isManualRefresh = false) => {
    if (!isManualRefresh) {
      setLoading(true);
    }

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Authentication required.");
      const idToken = await user.getIdToken();

      let url = new URL('/api/owner/orders', window.location.origin);
      if (impersonatedOwnerId) {
        url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
      }

      const res = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Failed to fetch orders');
      }
      const data = await res.json();
      const nextOrders = data.orders || [];
      setOrders(nextOrders);
      const cachePayload = { ts: Date.now(), data: { orders: nextOrders } };
      try {
        localStorage.setItem(ordersCacheKey, JSON.stringify(cachePayload));
      } catch {
        // Ignore local cache failures.
      }
      if (isDesktopApp()) {
        await setOfflineNamespace('owner_orders', ordersCacheKey, cachePayload);
      }
    } catch (error) {
      console.error("Error fetching orders:", error);
      let cached = null;
      try {
        const raw = localStorage.getItem(ordersCacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.data) cached = parsed.data;
        }
      } catch {
        // Ignore malformed cache.
      }
      if (!cached && isDesktopApp()) {
        const desktopPayload = await getOfflineNamespace('owner_orders', ordersCacheKey, null);
        cached = desktopPayload?.data || null;
      }

      if (cached?.orders) {
        setOrders(Array.isArray(cached.orders) ? cached.orders : []);
        setInfoDialog({ isOpen: true, title: "Offline Cache Active", message: "Could not load live orders, so cached desktop data is being shown." });
      } else {
        setInfoDialog({ isOpen: true, title: "Error", message: `Could not load orders: ${error.message}` });
      }
    } finally {
      setLoading(false);
    }
  }, [impersonatedOwnerId, ordersCacheKey]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (user) loadData();
      else setLoading(false);
    });
    return () => unsubscribe();
  }, [loadData]);

  const handleStatusChange = async (orderId, newStatus) => {
    // Optimistic Update
    setOrders(currentOrders =>
      currentOrders.map(order =>
        order.id === orderId ? { ...order, status: newStatus } : order
      )
    );

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Auth required");
      const idToken = await user.getIdToken();

      const res = await fetch('/api/owner/orders', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ orderId, newStatus })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to update status");
      }
    } catch (err) {
      console.error("Failed to update status on server:", err);
      setInfoDialog({ isOpen: true, title: "Update Failed", message: err.message });
      // Refresh to revert UI state
      loadData(true);
    }
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8 p-4 md:p-6 bg-background text-foreground min-h-screen"
    >
      <InfoDialog
        isOpen={infoDialog.isOpen}
        onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
        title={infoDialog.title}
        message={infoDialog.message}
      />
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            All Orders
          </h1>
          <div className="mt-2">
            <OfflineDesktopStatus />
          </div>
        </div>
        <motion.button
          whileTap={{ scale: 0.95, rotate: -15 }}
          whileHover={{ scale: 1.05 }}
          className="flex items-center bg-card text-foreground border border-border p-2 rounded-lg font-medium text-sm disabled:opacity-50"
          onClick={() => loadData(true)}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          <span className="ml-2">{loading ? "Refreshing..." : "Refresh Orders"}</span>
        </motion.button>
      </div>

      <div className="grid grid-cols-1 gap-8">
        <Table data={orders} onStatusChange={handleStatusChange} loading={loading} />
      </div>
    </motion.div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <OrdersPageContent />
    </Suspense>
  )
}
