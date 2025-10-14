

'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';

const BillPage = () => {
  const params = useParams();
  const orderId = params.orderId;
  const searchParams = useSearchParams();
  const impersonatedOwnerId = searchParams.get('impersonate_owner_id');

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

            let url = new URL(`/api/owner/orders`, window.location.origin);
            url.searchParams.append('id', orderId);
            if (impersonatedOwnerId) {
                url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
            }
            
            const res = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || "Failed to fetch bill data.");
            }
            const data = await res.json();

            setOrder(data.order);
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
  }, [orderId, impersonatedOwnerId]);

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
  
  const subtotal = order.subtotal || order.items.reduce((acc, item) => acc + item.qty * item.price, 0);
  const couponDiscount = order.coupon?.discount || 0;
  const loyaltyDiscount = order.loyaltyDiscount || 0;
  const totalDiscount = couponDiscount + loyaltyDiscount;

  const cgst = order.cgst || 0;
  const sgst = order.sgst || 0;
  const deliveryCharge = order.deliveryCharge || 0;
  const grandTotal = order.totalAmount;
  
  const orderDate = new Date(order.orderDate);


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
            <p><strong>Add:</strong> {order.customerAddress}</p>
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
                <span>{subtotal.toFixed(2)}</span>
            </div>
            {totalDiscount > 0 && (
                 <div className="flex justify-between">
                    <span className="font-semibold">DISCOUNT ({order.coupon?.code || 'Loyalty'})</span>
                    <span>- {totalDiscount.toFixed(2)}</span>
                 </div>
            )}
             <div className="flex justify-between">
                <span className="font-semibold">CGST (5%)</span>
                <span>{cgst.toFixed(2)}</span>
            </div>
             <div className="flex justify-between">
                <span className="font-semibold">SGST (5%)</span>
                <span>{sgst.toFixed(2)}</span>
            </div>
             <div className="flex justify-between">
                <span className="font-semibold">Delivery Charge</span>
                <span>{deliveryCharge.toFixed(2)}</span>
            </div>
        </div>

        {/* Payment Status */}
        <div className="mt-4 pt-4 border-t-2 border-dashed border-black text-center">
            {order.paymentDetails?.method === 'cod' ? (
                <div className="text-lg font-bold text-red-600">
                    <p>PAYMENT DUE</p>
                    <p>CASH ON DELIVERY</p>
                </div>
            ) : (
                 <div className="text-lg font-bold text-green-600">
                    <p>PAYMENT RECEIVED</p>
                    <p>PAID ONLINE</p>
                </div>
            )}
        </div>

        <div className="flex justify-between font-bold text-lg pt-2 mt-2 border-t-2 border-dashed border-black">
            <span>GRAND TOTAL</span>
            <span>₹{grandTotal.toFixed(2)}</span>
        </div>
        
        {/* Transaction Details */}
        <div className="mt-4 pt-4 border-t-2 border-dashed border-black text-xs">
            <p><strong>Transaction ID:</strong> {order.id}</p>
            <p><strong>Order Date:</strong> {orderDate.toLocaleDateString('en-IN')}</p>
            <p><strong>Order Time:</strong> {orderDate.toLocaleTimeString('en-IN')}</p>
        </div>


        {/* Footer */}
        <div className="text-center mt-6 pt-4 border-t border-dashed border-black">
            <p className="text-xs italic">Thank you for your order!</p>
            <p className="text-xs font-bold mt-1">Powered by ServiZephyr</p>
        </div>
      </div>

       <div className="fixed bottom-5 right-5 no-print">
            <Button onClick={handlePrint} size="lg" className="bg-primary hover:bg-primary/90 shadow-xl">
                <Printer className="mr-2 h-5 w-5" /> Print Bill
            </Button>
        </div>
    </div>
  );
};

export default BillPage;
