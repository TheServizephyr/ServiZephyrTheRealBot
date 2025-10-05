
'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';

const BillPage = () => {
  const params = useParams();
  const orderId = params.orderId;
  const [order, setOrder] = useState(null);
  const [restaurant, setRestaurant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (orderId) {
      const fetchBillData = async () => {
        setLoading(true);
        setError('');
        try {
            const user = auth.currentUser;
            if (!user) {
              throw new Error("Authentication required.");
            }
            const idToken = await user.getIdToken();
            const res = await fetch(`/api/owner/orders?id=${orderId}`, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || "Failed to fetch bill data.");
            }
            const data = await res.json();

            const fetchedOrder = data.order;
            const subtotal = fetchedOrder.items.reduce((acc, item) => acc + item.qty * item.price, 0);

            setOrder({ ...fetchedOrder, subtotal });
            setRestaurant(data.restaurant);

        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
      };
      
      const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchBillData();
            else {
                setError("Please log in to view the bill.");
                setLoading(false);
            }
        });
        return () => unsubscribe();
    }
  }, [orderId]);

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center font-mono">
        <p>Loading Bill...</p>
      </div>
    );
  }

  if (error) {
     return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center font-mono">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  if (!order || !restaurant) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center font-mono">
        <p className="text-red-500">Order not found.</p>
      </div>
    );
  }
  
  const taxRate = 0.05; // 5%
  const cgst = order.subtotal * taxRate;
  const sgst = order.subtotal * taxRate;
  const deliveryCharge = 30; // Can be made dynamic later
  const grandTotal = order.subtotal + cgst + sgst + deliveryCharge;


  return (
    <div className="min-h-screen bg-gray-300 flex justify-center p-4 print:p-0 print:bg-white font-mono text-black">
      <style jsx global>{`
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
           @page { size: 80mm auto; margin: 0; }
           .bill-container { box-shadow: none !important; border: none !important; }
        }
      `}</style>

      <div className="w-full max-w-sm bg-white shadow-lg p-6 bill-container">
        {/* Header */}
        <div className="text-center mb-6 border-b-2 border-dashed border-black pb-4">
            <h1 className="text-2xl font-bold uppercase">{restaurant.name}</h1>
            <p className="text-xs">{restaurant.address}</p>
            {restaurant.gstin && <p className="text-xs mt-1">GSTIN: {restaurant.gstin}</p>}
            {restaurant.fssai && <p className="text-xs">FSSAI: {restaurant.fssai}</p>}
        </div>

        {/* Customer Details */}
        <div className="mb-4 text-xs">
            <p><strong>Bill To:</strong> {order.customerName}</p>
            <p>{order.customerAddress}</p>
            <p><strong>Mobile:</strong> {order.customerPhone}</p>
        </div>


        {/* Items Table */}
        <table className="w-full text-xs mb-4">
            <thead className="border-y-2 border-dashed border-black">
                <tr>
                    <th className="text-left font-bold py-2">ITEM</th>
                    <th className="text-center font-bold py-2">QTY</th>
                    <th className="text-right font-bold py-2">RATE</th>
                    <th className="text-right font-bold py-2">AMOUNT</th>
                </tr>
            </thead>
            <tbody>
                {order.items.map((item, index) => (
                    <tr key={index} className="border-b border-dotted border-black">
                        <td className="py-2">{item.name}</td>
                        <td className="text-center py-2">{item.qty}</td>
                        <td className="text-right py-2">{item.price.toFixed(2)}</td>
                        <td className="text-right py-2">{(item.qty * item.price).toFixed(2)}</td>
                    </tr>
                ))}
            </tbody>
        </table>

        {/* Totals Section */}
        <div className="space-y-1 text-xs">
            <div className="flex justify-between">
                <span className="font-semibold">SUB TOTAL</span>
                <span>{order.subtotal.toFixed(2)}</span>
            </div>
             <div className="flex justify-between">
                <span className="font-semibold">CGST ({taxRate*100}%)</span>
                <span>{cgst.toFixed(2)}</span>
            </div>
             <div className="flex justify-between">
                <span className="font-semibold">SGST ({taxRate*100}%)</span>
                <span>{sgst.toFixed(2)}</span>
            </div>
             <div className="flex justify-between">
                <span className="font-semibold">Delivery Charge</span>
                <span>{deliveryCharge.toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg pt-2 border-t-2 border-dashed border-black">
                <span>GRAND TOTAL</span>
                <span>₹{grandTotal.toFixed(2)}</span>
            </div>
        </div>
        
        {/* Transaction Details */}
        <div className="mt-4 pt-4 border-t-2 border-dashed border-black text-xs">
            <p><strong>Transaction ID:</strong> {order.id}</p>
            <p><strong>Order Date:</strong> {new Date(order.orderDate.seconds * 1000).toLocaleDateString('en-IN')}</p>
            <p><strong>Order Time:</strong> {new Date(order.orderDate.seconds * 1000).toLocaleTimeString('en-IN')}</p>
        </div>


        {/* Footer */}
        <div className="text-center mt-6 pt-4 border-t border-dashed border-black">
            <p className="text-xs italic">Thank you for your order!</p>
            <p className="text-xs font-bold mt-1">Powered by ServiZephyr</p>
        </div>
      </div>

       <div className="fixed bottom-5 right-5 no-print">
            <Button onClick={handlePrint} size="lg" className="bg-indigo-600 hover:bg-indigo-700 shadow-xl">
                <Printer className="mr-2 h-5 w-5" /> Print Bill
            </Button>
        </div>
    </div>
  );
};

export default BillPage;
