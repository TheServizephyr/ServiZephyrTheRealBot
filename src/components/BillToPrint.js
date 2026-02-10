
'use client';

import React from 'react';
import { formatSafeDate } from '@/lib/safeDateFormat';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const safeRender = (val, fallback = 'N/A') => {
    if (!val) return fallback;
    if (typeof val === 'string' || typeof val === 'number') return val;
    if (typeof val === 'object') {
        return val.name || val.firstName || val.title || val.full || fallback;
    }
    return String(val);
};


const BillToPrint = ({ order, restaurant, billDetails, items, customerDetails }) => {
    if (!order) return null;

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
        if (typeof item.price === 'number') return item.price;
        if (item.portion && typeof item.portion.price === 'number') return item.portion.price;
        if (item.totalPrice && item.quantity) return item.totalPrice / item.quantity;
        return 0; // Fallback
    };

    const getItemTotal = (item) => {
        const price = getItemPrice(item);
        const qty = item.quantity || item.qty || 1;
        return price * qty;
    };


    return (
        <div id="bill-print-root" className="bg-white text-black p-2 max-w-[80mm] mx-auto font-mono text-[12px] leading-tight">
            <style jsx global>{`
                @media print {
                    @page {
                        margin: 0;
                        size: 80mm auto; 
                    }
                    body {
                        margin: 0;
                        padding: 0;
                        background: white;
                    }
                    #bill-print-root {
                        width: 100%;
                        max-width: 79mm; /* Force receipt width even on A4 */
                        margin: 0 auto; /* Center it for A4 readability */
                        padding: 2mm; 
                        font-family: 'Courier New', monospace;
                        font-size: 13px; /* Slightly larger for clarity */
                        color: black;
                        line-height: 1.2;
                    }
                }
            `}</style>
            <div className="text-center mb-4 border-b-2 border-dashed border-black pb-2">
                <h1 className="text-xl font-bold uppercase">{safeRender(restaurant?.name, 'Restaurant')}</h1>
                <p className="text-xs">{restaurant?.address?.street || (typeof restaurant?.address === 'string' ? restaurant.address : '')}</p>
                {restaurant?.gstin && <p className="text-xs mt-1">GSTIN: {restaurant.gstin}</p>}
                {restaurant?.fssai && <p className="text-xs">FSSAI: {restaurant.fssai}</p>}
            </div>
            <div className="mb-2 text-xs">
                <p><strong>Bill To:</strong> {safeRender(finalCustomerDetails.name, 'Walk-in Customer')}</p>
                {finalCustomerDetails.phone && <p><strong>Phone:</strong> {finalCustomerDetails.phone}</p>}
                {finalCustomerDetails.address && (
                    <p>
                        <strong>Address:</strong> {
                            typeof finalCustomerDetails.address === 'string'
                                ? finalCustomerDetails.address
                                : (finalCustomerDetails.address.street || finalCustomerDetails.address.formattedAddress || 'N/A')
                        }
                    </p>
                )}
                <p><strong>Date:</strong> {formatSafeDate(order.orderDate || order.createdAt)}</p>
                {order.id && <p><strong>Customer Order ID:</strong> #{order.customerOrderId || order.id.substring(0, 8)}</p>}
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
                                <td className="py-1">{safeRender(item.name || item.itemName)}</td>
                                <td className="text-center py-1">{quantity}</td>
                                <td className="text-right py-1">{formatCurrency(pricePerUnit)}</td>
                                <td className="text-right py-1">{formatCurrency(totalItemPrice)}</td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>

            <div className="text-xs border-t-2 border-dashed border-black pt-2 mt-2">
                <div className="flex justify-between font-semibold">
                    <span>Subtotal</span>
                    <span>{formatCurrency(finalBillDetails.subtotal)}</span>
                </div>
                {finalBillDetails.discount > 0 && (
                    <div className="flex justify-between text-green-700">
                        <span>Discount</span>
                        <span>- {formatCurrency(finalBillDetails.discount)}</span>
                    </div>
                )}

                {/* NEW: Extra Charges */}
                {finalBillDetails.packagingCharge > 0 && (
                    <div className="flex justify-between">
                        <span>Packaging Charge</span>
                        <span>+ {formatCurrency(finalBillDetails.packagingCharge)}</span>
                    </div>
                )}
                {finalBillDetails.platformFee > 0 && (
                    <div className="flex justify-between">
                        <span>Platform Fee</span>
                        <span>+ {formatCurrency(finalBillDetails.platformFee)}</span>
                    </div>
                )}
                {finalBillDetails.convenienceFee > 0 && (
                    <div className="flex justify-between">
                        <span>Convenience Fee</span>
                        <span>+ {formatCurrency(finalBillDetails.convenienceFee)}</span>
                    </div>
                )}
                {finalBillDetails.serviceFee > 0 && (
                    <div className="flex justify-between">
                        <span>Service Fee</span>
                        <span>+ {formatCurrency(finalBillDetails.serviceFee)}</span>
                    </div>
                )}
                {finalBillDetails.deliveryCharge > 0 && (
                    <div className="flex justify-between">
                        <span>Delivery Charge</span>
                        <span>+ {formatCurrency(finalBillDetails.deliveryCharge)}</span>
                    </div>
                )}
                {finalBillDetails.tip > 0 && (
                    <div className="flex justify-between">
                        <span>Tip</span>
                        <span>+ {formatCurrency(finalBillDetails.tip)}</span>
                    </div>
                )}

                {/* Taxes - Only show if > 0 */}
                {(() => {
                    const gstRate = order?.gstPercentage || restaurant?.gstPercentage || 5;
                    const halfRate = (gstRate / 2).toFixed(1).replace(/\.0$/, '');

                    return (
                        <>
                            {finalBillDetails.cgst > 0 && (
                                <div className="flex justify-between">
                                    <span>CGST ({halfRate}%)</span>
                                    <span>+ {formatCurrency(finalBillDetails.cgst)}</span>
                                </div>
                            )}
                            {finalBillDetails.sgst > 0 && (
                                <div className="flex justify-between">
                                    <span>SGST ({halfRate}%)</span>
                                    <span>+ {formatCurrency(finalBillDetails.sgst)}</span>
                                </div>
                            )}
                        </>
                    );
                })()}
            </div>

            <div className="flex justify-between font-bold text-lg pt-1 mt-1 border-t-2 border-black">
                <span>GRAND TOTAL</span>
                <span className="text-green-600">{formatCurrency(finalBillDetails.grandTotal)}</span>
            </div>

            <div className="text-center mt-4 pt-2 border-t border-dashed border-black">
                <p className="text-xs italic">Thank you for your order!</p>
                <p className="text-xs font-bold mt-1">Powered by ServiZephyr</p>
            </div>
        </div>
    );
};

export default BillToPrint;
