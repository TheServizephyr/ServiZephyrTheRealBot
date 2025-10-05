
"use client";

import { useState, useEffect } from "react";
import Table from "@/components/OwnerDashboard/Table";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import styles from "@/components/OwnerDashboard/OwnerDashboard.module.css";

// More detailed mock data for the orders page
const initialOrders = [
    { id: 'ORD-101', customer: 'Rohan Sharma', amount: 1250, status: 'Confirmed', address: '123, ABC Society, Pune', items: [{name: 'Paneer Butter Masala', qty: 2}, {name: 'Garlic Naan', qty: 4}] },
    { id: 'ORD-102', customer: 'Priya Singh', amount: 850, status: 'Preparing', address: '456, XYZ Apartments, Mumbai', items: [{name: 'Chicken Biryani', qty: 1}, {name: 'Coke', qty: 2}] },
    { id: 'ORD-103', customer: 'Amit Patel', amount: 2100, status: 'Pending', address: '789, PQR Heights, Delhi', items: [{name: 'Full Tandoori Chicken', qty: 1}, {name: 'Veg Hakka Noodles', qty: 2}] },
    { id: 'ORD-104', customer: 'Sneha Verma', amount: 450, status: 'Out for Delivery', address: '101, LMN Towers, Bangalore', items: [{name: 'Masala Dosa', qty: 3}] },
    { id: 'ORD-105', customer: 'Vikas Kumar', amount: 1800, status: 'Delivered', address: '212, DEF Colony, Chennai', items: [{name: 'Dal Makhani', qty: 2}, {name: 'Jeera Rice', qty: 2}, {name: 'Butter Roti', qty: 5}] },
    { id: 'ORD-106', customer: 'Anjali Gupta', amount: 950, status: 'Preparing', address: '333, GHI Estates, Hyderabad', items: [{name: 'Chilli Paneer', qty: 1}, {name: 'Fried Rice', qty: 1}] },
    { id: 'ORD-107', customer: 'Manish Das', amount: 300, status: 'Pending', address: '444, JKL Complex, Kolkata', items: [{name: 'Samosa', qty: 4}] },
    { id: 'ORD-108', customer: 'Sunita Rao', amount: 2500, status: 'Confirmed', address: '555, MNO Garden, Pune', items: [{name: 'Chicken Tikka Masala', qty: 3}, {name: 'Laccha Paratha', qty: 6}] },
];

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
  const [loading, setLoading] = useState(false);

  const loadData = async (isManualRefresh = false) => {
    if (isManualRefresh) {
        setLoading(true);
    }
    await new Promise((resolve) => setTimeout(resolve, 800)); // Simulate API delay
    // In a real app, you'd fetch this data from an API
    setOrders([...initialOrders].sort(() => 0.5 - Math.random())); // Shuffle for refresh effect
    if (isManualRefresh) {
        setLoading(false);
    }
  };

  useEffect(() => {
    // Load data on initial render
    loadData(true);
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
      className="space-y-8"
    >
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
          All Orders
        </h1>
        <motion.button
          whileTap={{ scale: 0.95, rotate: -15 }}
          whileHover={{ scale: 1.05 }}
          className={styles.refreshBtn}
          onClick={() => loadData(true)}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          <span className="ml-2">{loading ? "Refreshing..." : "Refresh Orders"}</span>
        </motion.button>
      </div>

      {/* We will add filtering options here later */}
      
      <div className="grid grid-cols-1 gap-8">
        <Table data={orders} onStatusChange={handleStatusChange} />
      </div>
    </motion.div>
  );
}
