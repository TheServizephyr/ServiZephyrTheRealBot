"use client";

import styles from "./OwnerDashboard.module.css";
import { motion } from "framer-motion";
import { ListChecks, Undo2 } from "lucide-react";

const statusFlow = ["Pending", "Confirmed", "Preparing", "Out for Delivery", "Delivered"];

const getStatusClass = (currentStatus) => {
  switch (currentStatus) {
    case "Delivered":
      return styles.statusDelivered;
    case "Confirmed":
      return styles.statusConfirmed;
    case "Preparing":
      return styles.statusPreparing;
    case "Out for Delivery":
      return styles.statusOutOfDelivery;
    case "Pending":
    default:
      return styles.statusPending;
  }
};

const OrderStatusAction = ({ status, onStatusChange }) => {
  const currentIndex = statusFlow.indexOf(status);
  const isCompleted = currentIndex === statusFlow.length - 1;
  const isFirstStep = currentIndex === 0;

  const getNextActionText = () => {
    if (isCompleted) return "Completed";
    switch (status) {
      case "Pending":
        return "Confirm Order";
      case "Confirmed":
        return "Start Preparing";
      case "Preparing":
        return "Dispatch Order";
      case "Out for Delivery":
        return "Mark Delivered";
      default:
        return "";
    }
  };

  const handleNextAction = () => {
    if (!isCompleted) {
      onStatusChange(statusFlow[currentIndex + 1]);
    }
  };
  
  const handleRevertAction = () => {
    if (!isFirstStep) {
      onStatusChange(statusFlow[currentIndex - 1]);
    }
  };

  return (
    <div className={styles.actionCell}>
      {!isFirstStep && (
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={handleRevertAction}
          className={`${styles.revertButton}`}
          title="Revert to previous status"
        >
          <Undo2 size={14} />
        </motion.button>
      )}
      <button
        onClick={handleNextAction}
        disabled={isCompleted}
        className={`${styles.actionButton} ${getStatusClass(status)}`}
      >
        {getNextActionText()}
      </button>
    </div>
  );
};


export default function Table({ data = [], onStatusChange }) {
  const isOrdersPage = data.length > 4; // Simple check to differentiate dashboard table

  return (
    <motion.div
      className={styles.tableContainer}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.5 }}
      style={{ height: isOrdersPage ? 'auto' : '400px', minHeight: '400px' }}
    >
      {!isOrdersPage && (
        <div className={styles.tableHeader}>
          <ListChecks size={18} />
          <h3 className="font-semibold text-lg">Recent Orders</h3>
        </div>
      )}
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Customer</th>
              <th style={{width: "25%"}}>Order Items</th>
              <th>Address</th>
              <th>Amount</th>
              <th>Status</th>
              <th style={{ width: '220px' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan="7" className="text-center p-4 text-gray-500">
                  No recent orders
                </td>
              </tr>
            ) : (
              data.map((order, idx) => (
                <motion.tr
                  key={order.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3, delay: idx * 0.05 }}
                  whileHover={{ 
                    scale: 1.01, 
                    y: -2,
                    backgroundColor: 'rgba(251, 191, 36, 0.05)',
                    boxShadow: '0 4px 12px rgba(251, 191, 36, 0.2)',
                    zIndex: 10
                  }}
                  style={{ transformOrigin: 'center', position: 'relative' }}
                >
                  <td className="font-mono text-sm">{order.id}</td>
                  <td>{order.customer}</td>
                  <td>
                    <ul className="text-sm text-gray-700 list-disc list-inside">
                        {order.items.slice(0, 2).map(item => (
                            <li key={item.name}>{item.name} x {item.qty}</li>
                        ))}
                    </ul>
                    {order.items.length > 2 && (
                        <a href="#" className="text-xs text-blue-600 hover:underline mt-1 inline-block">
                           + {order.items.length - 2} more
                        </a>
                    )}
                  </td>
                  <td className="text-gray-600">{order.address}</td>
                  <td className="font-medium">₹{order.amount.toLocaleString()}</td>
                  <td>
                    <span className={`${styles.statusBadge} ${getStatusClass(order.status)}`}>
                        {order.status}
                    </span>
                  </td>
                  <td>
                    <OrderStatusAction
                      status={order.status}
                      onStatusChange={(newStatus) => onStatusChange(order.id, newStatus)}
                    />
                  </td>
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
