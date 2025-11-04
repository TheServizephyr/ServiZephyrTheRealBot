
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2, Printer } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const BillPage = () => {
    const { orderId } = useParams();
    const router = useRouter();
    const [billData, setBillData] = useState(null);
    const [loading, setLoading] = useState(true);
    const printRef = useRef();

    useEffect(() => {
        if (!orderId) {
            setLoading(false);
            return;
        }

        let data;
        // Check if it's a custom bill from localStorage
        if (orderId.startsWith('custom-bill-')) {
            data = localStorage.getItem(orderId);
        }

        if (data) {
            setBillData(JSON.parse(data));
            setLoading(false);
        } else {
            // Fetch order data from API for regular orders
            const fetchOrder = async () => {
                try {
                    const res = await fetch(`/api/owner/orders?id=${orderId}`);
                    if (!res.ok) throw new Error('Failed to fetch order details');
                    const data = await res.json();
                    
                    const formattedBillData = {
                        restaurant: data.restaurant,
                        customerDetails: {
                            name: data.order.customerName,
                            phone: data.order.customerPhone,
                            address: data.order.customerAddress,
                        },
                        cart: data.order.items.map(item => ({
                           ...item,
                           portion: { name: item.portion?.name || 'Full', price: item.price / item.quantity },
                        })),
                        subtotal: data.order.subtotal,
                        tax: (data.order.cgst || 0) + (data.order.sgst || 0),
                        grandTotal: data.order.totalAmount,
                        isCod: data.order.paymentDetails?.method === 'cod',
                        orderDate: new Date(data.order.orderDate.seconds ? data.order.orderDate.seconds * 1000 : data.order.orderDate),
                        orderId: data.order.id,
                    };
                    setBillData(formattedBillData);
                } catch (error) {
                    console.error(error);
                } finally {
                    setLoading(false);
                }
            };
            fetchOrder();
        }

    }, [orderId]);

    const handlePrint = useReactToPrint({
        content: () => printRef.current,
        documentTitle: `Bill-${billData?.orderId || billData?.customerDetails?.name || 'bill'}`,
    });

    if (loading) {
        return <div className="h-screen w-screen bg-white flex items-center justify-center"><Loader2 className="animate-spin text-black h-12 w-12" /></div>;
    }

    if (!billData) {
        return <div className="h-screen w-screen bg-white flex items-center justify-center text-red-500">Could not load bill data.</div>;
    }

    return (
        <div className="bg-gray-200 flex flex-col items-center justify-center min-h-screen p-4">
             <div className="w-full max-w-sm flex justify-between mb-4 no-print">
                <Button variant="secondary" onClick={() => router.back()}>Back</Button>
                <Button onClick={handlePrint}><Printer className="mr-2 h-4 w-4"/> Print</Button>
            </div>
            <div id="bill-content" ref={printRef} className="w-[80mm] bg-white p-4 shadow-lg font-mono text-black">
                {billData.restaurant && (
                    <div className="text-center mb-4 border-b-2 border-dashed border-black pb-2">
                        <h3 className="text-xl font-bold uppercase">{billData.restaurant.name}</h3>
                        <p className="text-xs">{billData.restaurant.address?.full || `${billData.restaurant.address?.street}, ${billData.restaurant.address?.city}`}</p>
                        {billData.restaurant.gstin && <p className="text-xs mt-1">GSTIN: {billData.restaurant.gstin}</p>}
                    </div>
                )}
                <div className="mb-4 text-xs">
                    <p><strong>To:</strong> {billData.customerDetails?.name || 'Walk-in Customer'}</p>
                    {billData.customerDetails?.phone && <p><strong>Ph:</strong> {billData.customerDetails.phone}</p>}
                    {billData.customerDetails?.address && <p><strong>Add:</strong> {billData.customerDetails.address}</p>}
                    {billData.orderDate && <p><strong>Date:</strong> {billData.orderDate.toLocaleString('en-IN')}</p>}
                    {billData.orderId && <p><strong>ID:</strong> {billData.orderId.substring(0,12)}...</p>}
                </div>
                <table className="w-full text-xs mb-4">
                    <thead className="border-y-2 border-dashed border-black">
                        <tr>
                            <th className="text-left font-bold py-1">ITEM</th>
                            <th className="text-center font-bold py-1">QTY</th>
                            <th className="text-right font-bold py-1">PRICE</th>
                            <th className="text-right font-bold py-1">AMOUNT</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(billData.cart || []).map((item, index) => (
                            <tr key={index} className="border-b border-dotted border-black">
                                <td className="py-1">{item.name} {item.portion?.name !== 'Full' ? `(${item.portion?.name})` : ''}</td>
                                <td className="text-center py-1">{item.quantity}</td>
                                <td className="text-right py-1">{item.portion?.price.toFixed(2)}</td>
                                <td className="text-right py-1">{(item.portion?.price * item.quantity).toFixed(2)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className="text-xs space-y-1 pt-2 border-t border-dashed">
                    <div className="flex justify-between font-semibold"><span>SUBTOTAL</span><span>{billData.subtotal.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>TAX</span><span>{billData.tax.toFixed(2)}</span></div>
                    <div className="flex justify-between font-bold text-lg mt-2 pt-2 border-t-2 border-dashed border-black">
                        <span>GRAND TOTAL</span>
                        <span>{formatCurrency(billData.grandTotal)}</span>
                    </div>
                </div>
                 {billData.isCod && (
                    <div className="text-center mt-4 pt-4 border-t-2 border-dashed border-black text-lg font-bold text-red-600">
                        CASH ON DELIVERY
                    </div>
                )}
                <div className="text-center mt-4 pt-2 border-t border-dashed border-black">
                    <p className="text-xs italic">For exclusive offers and faster ordering, visit the ServiZephyr Customer Hub!</p>
                    <p className="text-xs font-bold mt-1">Powered by ServiZephyr</p>
                </div>
            </div>
        </div>
    );
};

export default BillPage;
