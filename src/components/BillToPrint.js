
'use client';

import React from 'react';
import QRCode from 'qrcode.react';
import { formatSafeDate } from '@/lib/safeDateFormat';
import { getItemVariantLabel } from '@/lib/itemVariantDisplay';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const safeRender = (val, fallback = 'N/A') => {
    if (!val) return fallback;
    if (typeof val === 'string' || typeof val === 'number') return val;
    if (typeof val === 'object') {
        return val.name || val.firstName || val.title || val.full || fallback;
    }
    return String(val);
};

const getRawVariantName = (item = {}) =>
    String(
        item?.portion?.name ||
        item?.selectedPortion?.name ||
        item?.variant ||
        item?.portionName ||
        item?.size ||
        ''
    ).trim();

const getBillVariantLabel = (item = {}, allItems = []) => {
    const defaultLabel = getItemVariantLabel(item);
    if (defaultLabel) return defaultLabel;

    const rawVariant = getRawVariantName(item);
    if (!rawVariant || rawVariant.toLowerCase() !== 'full') return '';

    const itemName = String(item?.name || item?.itemName || '').trim().toLowerCase();
    if (!itemName) return '';

    const hasSiblingVariant = allItems.some((candidate) => {
        const candidateName = String(candidate?.name || candidate?.itemName || '').trim().toLowerCase();
        const candidateVariant = getRawVariantName(candidate).toLowerCase();
        return candidate !== item && candidateName === itemName && candidateVariant && candidateVariant !== 'full';
    });

    return hasSiblingVariant ? ' (Full)' : '';
};

const getOrderTypeLabel = (order = {}) => {
    const rawType = String(
        order?.orderType ||
        order?.deliveryType ||
        order?.diningPreference ||
        ''
    ).trim().toLowerCase();

    if (rawType === 'dine_in' || rawType === 'dine-in') return 'Dine In';
    if (rawType === 'pickup' || rawType === 'takeaway') return 'Pickup';
    if (rawType === 'delivery') return 'Delivery';
    return '';
};

const getPaymentModeLabel = (value) => {
    const rawValue = String(value || '').trim().toLowerCase();
    if (!rawValue) return '';
    if (rawValue === 'upi') return 'UPI';
    if (rawValue === 'cod' || rawValue === 'cash') return 'Cash';
    if (rawValue === 'card') return 'Card';
    return rawValue.charAt(0).toUpperCase() + rawValue.slice(1);
};

const getOrderNoteText = (order = {}, billDetails = {}, customerDetails = {}) =>
    String(
        order?.notes ||
        order?.specialInstructions ||
        order?.customerNote ||
        order?.instructions ||
        billDetails?.notes ||
        customerDetails?.notes ||
        ''
    ).trim();

const getAddonUnitPrice = (addon = {}) => {
    if (typeof addon?.price === 'number') return addon.price;
    const parsedPrice = Number(addon?.price || 0);
    return Number.isFinite(parsedPrice) ? parsedPrice : 0;
};

const getAddonQuantity = (addon = {}) => {
    const parsedQuantity = Number(addon?.quantity || addon?.qty || 1);
    return Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1;
};

const getItemUnitPrice = (item = {}) => {
    if (typeof item.price === 'number') return item.price;
    if (item.portion && typeof item.portion.price === 'number') return item.portion.price;
    if (item.totalPrice && item.quantity) return item.totalPrice / item.quantity;
    return 0;
};

const buildPrintRows = (items = []) =>
    items.flatMap((item) => {
        const quantity = Number(item.quantity || item.qty || 1) || 1;
        const addons = item.addons || item.selectedAddOns || [];
        const addOnTotalPerParentUnit = addons.reduce(
            (sum, addon) => sum + (getAddonUnitPrice(addon) * getAddonQuantity(addon)),
            0
        );
        const itemUnitPrice = getItemUnitPrice(item);
        const baseItemUnitPrice = Math.max(0, itemUnitPrice - addOnTotalPerParentUnit);
        const rows = [{
            name: `${safeRender(item.name || item.itemName)}${getBillVariantLabel(item, items)}`,
            quantity,
            unitPrice: baseItemUnitPrice,
        }];

        addons.forEach((addon) => {
            rows.push({
                name: safeRender(addon.name || addon.itemName),
                quantity: quantity * getAddonQuantity(addon),
                unitPrice: getAddonUnitPrice(addon),
            });
        });

        return rows.map((row) => ({
            ...row,
            totalPrice: row.unitPrice * row.quantity,
        }));
    });

const resolveBotDisplayNumber = (restaurant = {}) =>
    String(
        restaurant?.botDisplayNumber ||
        restaurant?.whatsappDisplayNumber ||
        restaurant?.whatsappNumber ||
        restaurant?.botPhone ||
        ''
    ).trim();

const BillToPrint = ({ order, restaurant, billDetails, items, customerDetails }) => {
    if (!order) return null;

    const finalItems = items || order.items || [];
    const finalBillDetails = billDetails || {
        subtotal: order.subtotal,
        discount: order.discount,
        deliveryCharge: order.deliveryCharge,
        serviceFee: order.serviceFee,
        serviceFeeLabel: order.serviceFeeLabel,
        cgst: order.cgst,
        sgst: order.sgst,
        grandTotal: order.totalAmount,
    };
    const finalCustomerDetails = customerDetails || {
        name: order.customerName,
        phone: order.customerPhone,
        address: order.customerAddress,
    };
    const orderTypeLabel = getOrderTypeLabel(order);
    const orderNote = getOrderNoteText(order, finalBillDetails, finalCustomerDetails);
    const printRows = buildPrintRows(finalItems);
    const botDisplayNumber = resolveBotDisplayNumber(restaurant);
    const botDisplayDigits = botDisplayNumber.replace(/\D/g, '');
    const promoQrValue = botDisplayDigits ? `https://wa.me/${botDisplayDigits}?text=hi` : '';
    const customerNameFallback = String(order?.orderType || order?.deliveryType || '').trim().toLowerCase() === 'delivery'
        ? 'Guest'
        : 'Walk-in Customer';
    const displayOrderId = String(order?.customerOrderId || order?.id || '').trim();

    return (
        <div id="bill-print-root" className="bg-white text-black p-2 max-w-[80mm] mx-auto text-[16px] leading-tight" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
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
                    /* Root receipt styling */
                    #bill-print-root {
                        width: 100%;
                        max-width: 79mm; /* Force receipt width even on A4 */
                        margin: 0 auto; /* Center it for A4 readability */
                        padding: 2mm; 
                        font-family: Arial, Helvetica, sans-serif;
                        font-size: 16px;
                        color: #000000 !important;
                        line-height: 1.2;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                        -webkit-font-smoothing: antialiased;
                        text-rendering: optimizeLegibility;
                    }

                    /* Force all text to pure black while keeping hierarchy readable */
                    #bill-print-root, #bill-print-root * {
                        color: #000000 !important;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                        font-weight: 400 !important;
                        text-shadow: none !important;
                    }

                    /* Keep headings and totals emphasized */
                    #bill-print-root h1,
                    #bill-print-root strong,
                    #bill-print-root table th,
                    #bill-print-root .grand-total-amount {
                        color: #000000 !important;
                        font-weight: 700 !important;
                    }

                    #bill-print-root table th,
                    #bill-print-root table td {
                        border-color: #000000 !important;
                    }

                    /* Increase contrast for totals and ensure grand total prints very dark */
                    #bill-print-root .text-green-600,
                    #bill-print-root .text-green-700,
                    #bill-print-root .grand-total-amount {
                        color: #000000 !important;
                        font-weight: 800 !important;
                    }
                }
            `}</style>
            <div className="text-center mb-4 pb-2" style={{ borderBottom: '2px solid #000000' }}>
                <h1 className="text-[16px] font-bold uppercase">{safeRender(restaurant?.name, 'Restaurant')}</h1>
                <p className="text-[16px] font-bold">{restaurant?.address?.street || (typeof restaurant?.address === 'string' ? restaurant.address : '')}</p>
                {restaurant?.gstin && <p className="text-[16px] mt-1 font-bold">GSTIN: {restaurant.gstin}</p>}
                {restaurant?.fssai && <p className="text-[16px] font-bold">FSSAI: {restaurant.fssai}</p>}
            </div>
            <div className="mb-2 text-[16px] font-bold">
                <p><strong>Bill To:</strong> {safeRender(finalCustomerDetails.name, customerNameFallback)}</p>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <p><strong>Date:</strong> {formatSafeDate(order.orderDate || order.createdAt)}</p>
                    {orderTypeLabel && <p><strong>{orderTypeLabel}</strong></p>}
                </div>
                {displayOrderId && <p><strong>Order ID:</strong> {displayOrderId}</p>}
            </div>

            {orderNote && (
                <div className="mb-3 p-2 text-[16px] font-bold" style={{ border: '2px solid #000000' }}>
                    <span>NOTE:</span>{' '}
                    <span style={{ fontWeight: 400 }}>&quot;{orderNote}&quot;</span>
                </div>
            )}

            <table className="w-full text-[16px] mb-2">
                <thead style={{ borderTop: '2px solid #000000', borderBottom: '2px solid #000000' }}>
                    <tr>
                        <th className="text-left font-bold py-1">ITEM</th>
                        <th className="text-center font-bold py-1">QTY</th>
                        <th className="text-right font-bold py-1">PRICE</th>
                        <th className="text-right font-bold py-1">TOTAL</th>
                    </tr>
                </thead>
                <tbody>
                    {printRows.map((row, index) => {
                        return (
                            <tr key={index}>
                                <td className="py-1.5 align-top pr-1">
                                    <div className="text-[16px] leading-snug font-normal">{row.name}</div>
                                </td>
                                <td className="text-center py-1.5 align-top">{row.quantity}</td>
                                <td className="text-right py-1.5 align-top">{formatCurrency(row.unitPrice)}</td>
                                <td className="text-right py-1.5 align-top">{formatCurrency(row.totalPrice)}</td>
                            </tr>
                        )
                    })}                </tbody>
            </table>

            <div className="text-[16px] pt-2 mt-2" style={{ borderTop: '2px solid #000000' }}>
                <div className="font-semibold" style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <span>Subtotal</span>
                    <span>{formatCurrency(finalBillDetails.subtotal)}</span>
                </div>
                {finalBillDetails.discount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                        <span>Discount</span>
                        <span>- {formatCurrency(finalBillDetails.discount)}</span>
                    </div>
                )}

                {/* NEW: Extra Charges */}
                {finalBillDetails.packagingCharge > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                        <span>Packaging Charge</span>
                        <span>+ {formatCurrency(finalBillDetails.packagingCharge)}</span>
                    </div>
                )}
                {finalBillDetails.platformFee > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                        <span>Platform Fee</span>
                        <span>+ {formatCurrency(finalBillDetails.platformFee)}</span>
                    </div>
                )}
                {finalBillDetails.convenienceFee > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                        <span>Convenience Fee</span>
                        <span>+ {formatCurrency(finalBillDetails.convenienceFee)}</span>
                    </div>
                )}
                {finalBillDetails.serviceFee > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                        <span>{String(finalBillDetails.serviceFeeLabel || 'Additional Charge').trim() || 'Additional Charge'}</span>
                        <span>+ {formatCurrency(finalBillDetails.serviceFee)}</span>
                    </div>
                )}
                {finalBillDetails.deliveryCharge > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                        <span>Delivery Charge</span>
                        <span>+ {formatCurrency(finalBillDetails.deliveryCharge)}</span>
                    </div>
                )}
                {finalBillDetails.tip > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
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
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                                    <span>CGST ({halfRate}%)</span>
                                    <span>+ {formatCurrency(finalBillDetails.cgst)}</span>
                                </div>
                            )}
                            {finalBillDetails.sgst > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                                    <span>SGST ({halfRate}%)</span>
                                    <span>+ {formatCurrency(finalBillDetails.sgst)}</span>
                                </div>
                            )}
                        </>
                    );
                })()}
            </div>

            <div className="font-bold text-[16px] pt-1 mt-1" style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', borderTop: '2px solid #000000' }}>
                <span>GRAND TOTAL</span>
                <span className="grand-total-amount">{formatCurrency(finalBillDetails.grandTotal)}</span>
            </div>

            <div className="text-center mt-3 pt-1" style={{ borderTop: '1px solid #000000' }}>
                <p className="text-[16px] italic">Thank you for your order!</p>
            </div>

            {promoQrValue && (
                <div className="mt-2">
                    <div className="flex items-center justify-between gap-2">
                        <div className="text-[12px] leading-tight uppercase text-center">
                            <div>Scan to</div>
                            <div><strong>Order Online</strong> at</div>
                            <div><strong>No Extra Charges</strong></div>
                        </div>
                        <div className="shrink-0 bg-white" style={{ width: 60, height: 60 }}>
                            <QRCode
                                value={promoQrValue}
                                size={4096}
                                level="H"
                                includeMargin={false}
                                renderAs="svg"
                                fgColor="#000000"
                                bgColor="#FFFFFF"
                                style={{
                                    display: 'block',
                                    width: '60px',
                                    height: '60px',
                                    shapeRendering: 'crispEdges',
                                    imageRendering: 'pixelated',
                                }}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BillToPrint;
