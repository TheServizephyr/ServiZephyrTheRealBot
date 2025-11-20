'use client';

import React from 'react';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const BillToPrint = ({ order, restaurant, billDetails, items, customerDetails }) => {
    if (!order || !restaurant) return null;
    
    const finalItems = items || order.items || [];
    const finalBillDetails = billDetails || {
        subtotal: order.subtotal,
        discount: order.discount,
        deliveryCharge: order.deliveryCharge,
        cgst: order.cgst,
        sgst: order.sgst,
        grandTotal: order.totalAmount,
    };
    const finalCustomerDetails = customerDetails || {
        name: order.customerName,
        phone: order.customerPhone,
        address: order.customerAddress,
    };

    const getItemPrice = (item) => {
        // This function handles different ways the price might be stored
        if (typeof item.price === 'number') return item.price;
        if (typeof item.totalPrice === 'number') return item.totalPrice;
        if (item.portion && typeof item.portion.price === 'number') return item.portion.price;
        return 0; // Fallback
    };
    
    const getItemTotal = (item) => {
        const price = getItemPrice(item);
        const qty = item.quantity || item.qty || 1;
        return price * qty;
    };


    return (
        <div id="bill-print-root">
            <div className="text-center mb-4 border-b-2 border-dashed border-black pb-2">
                <h1 className="text-xl font-bold uppercase">{restaurant.name}</h1>
                <p className="text-xs">{restaurant.address?.street}, {restaurant.address?.city}</p>
                {restaurant.gstin && <p className="text-xs mt-1">GSTIN: {restaurant.gstin}</p>}
            </div>
            <div className="mb-2 text-xs">
                <p><strong>Bill To:</strong> {finalCustomerDetails.name}</p>
                {finalCustomerDetails.phone && <p><strong>Phone:</strong> {finalCustomerDetails.phone}</p>}
                {finalCustomerDetails.address && <p><strong>Address:</strong> {finalCustomerDetails.address}</p>}
                <p><strong>Date:</strong> {new Date().toLocaleDateString('en-IN')} - {new Date().toLocaleTimeString('en-IN')}</p>
                {order.id && <p><strong>Order ID:</strong> #{order.id.substring(0, 8)}</p>}
            </div>

            <table className="w-full text-xs mb-2">
                <thead className="border-y-2 border-dashed border-black">
                    <tr>
                        <th className="text-left font-bold py-1">ITEM</th>
                        <th className="text-center font-bold py-1">QTY</th>
                        <th className="text-right font-bold py-1">PRICE</th>
                        <th className="text-right font-bold py-1">TOTAL</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-dotted divide-black">
                    {finalItems.map((item, index) => {
                        const pricePerUnit = getItemPrice(item);
                        const totalItemPrice = getItemTotal(item);
                        const quantity = item.quantity || item.qty || 1;
                        
                        return (
                            <tr key={index}>
                                <td className="py-1">{item.name}</td>
                                <td className="text-center py-1">{quantity}</td>
                                <td className="text-right py-1">{formatCurrency(pricePerUnit)}</td>
                                <td className="text-right py-1">{formatCurrency(totalItemPrice)}</td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
            
            <div className="text-xs border-t-2 border-dashed border-black pt-2 mt-2">
                 <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{formatCurrency(finalBillDetails.subtotal)}</span>
                </div>
                {finalBillDetails.discount > 0 && (
                    <div className="flex justify-between">
                        <span>Discount</span>
                        <span>- {formatCurrency(finalBillDetails.discount)}</span>
                    </div>
                )}
                 <div className="flex justify-between">
                    <span>CGST (2.5%)</span>
                    <span>+ {formatCurrency(finalBillDetails.cgst)}</span>
                </div>
                 <div className="flex justify-between">
                    <span>SGST (2.5%)</span>
                    <span>+ {formatCurrency(finalBillDetails.sgst)}</span>
                </div>
                {finalBillDetails.deliveryCharge > 0 && (
                     <div className="flex justify-between">
                        <span>Delivery Charge</span>
                        <span>+ {formatCurrency(finalBillDetails.deliveryCharge)}</span>
                    </div>
                )}
            </div>
            
            <div className="flex justify-between font-bold text-lg pt-1 mt-1 border-t-2 border-black">
                <span>GRAND TOTAL</span>
                <span className="text-green-600">{formatCurrency(finalBillDetails.grandTotal)}</span>
            </div>

            <div className="text-center mt-4 pt-2 border-t border-dashed border-black">
                <p className="text-xs italic">Thank you for your order!</p>
                <p className="text-xs font-bold mt-1">Powered by ServiZephyr</p>
                 <p className="text-xs italic mt-1">For exclusive offers and faster ordering, visit the ServiZephyr Customer Hub!</p>
            </div>
        </div>
    );
};

export default BillToPrint;
