
"use client";

import { useState, useEffect } from "react";
import Table from "@/components/OwnerDashboard/Table";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import styles from "@/components/OwnerDashboard/OwnerDashboard.module.css";
import { auth } from '@/lib/firebase';
import { useSearchParams } from "next/navigation";


const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();
  const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

  const loadData = async (isManualRefresh = false) => {
    if (!isManualRefresh) {
      setLoading(true);
    }
    
    try {
        const user = auth.currentUser;
        if(!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();

        let url = '/api/owner/orders';
        if (impersonatedOwnerId) {
            url += `?impersonate_owner_id=${impersonatedOwnerId}`;
        }
        
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        if(!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.message || 'Failed to fetch orders');
        }
        const data = await res.json();
        setOrders(data.orders || []);
    } catch (error) {
        console.error("Error fetching orders:", error);
        alert(`Could not load orders: ${error.message}`);
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
      if (user) loadData();
      else setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleStatusChange = (orderId, newStatus) => {
    setOrders(currentOrders =>
      currentOrders.map(order =>
        order.id === orderId ? { ...order, status: newStatus } : order
      )
    );
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8 p-4 md:p-6 bg-gray-900 text-white min-h-screen"
    >
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">
          All Orders
        </h1>
        <motion.button
          whileTap={{ scale: 0.95, rotate: -15 }}
          whileHover={{ scale: 1.05 }}
          className="flex items-center bg-gray-800 text-white border border-gray-700 p-2 rounded-lg font-medium text-sm disabled:opacity-50"
          onClick={() => loadData(true)}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          <span className="ml-2">{loading ? "Refreshing..." : "Refresh Orders"}</span>
        </motion.button>
      </div>
      
      <div className="grid grid-cols-1 gap-8">
        <Table data={orders} onStatusChange={handleStatusChange} loading={loading}/>
      </div>
    </motion.div>
  );
}
