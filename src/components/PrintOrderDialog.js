"use client";

import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Printer, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useReactToPrint } from 'react-to-print';
import BillToPrint from '@/components/BillToPrint';
import { EscPosEncoder } from '@/services/printer/escpos';
import { connectPrinter, printData } from '@/services/printer/webUsbPrinter';
import { formatSafeDate } from '@/lib/safeDateFormat';

// Reusable Print Dialog
export default function PrintOrderDialog({ isOpen, onClose, order, restaurant }) {
    const billRef = useRef();
    const [usbDevice, setUsbDevice] = useState(null);
    const [status, setStatus] = useState('');

    const handleStandardPrint = useReactToPrint({
        content: () => billRef.current,
        onAfterPrint: () => setStatus('Standard print sent'),
    });

    const handleDirectPrint = async () => {
        try {
            setStatus('Connecting to printer...');
            let device = usbDevice;
            if (!device || !device.opened) {
                try {
                    device = await connectPrinter();
                    setUsbDevice(device);
                } catch (err) {
                    setStatus('Connection cancelled');
                    return;
                }
            }

            setStatus('Printing...');
            const encoder = new EscPosEncoder();

            // Header
            encoder.initialize().align('center')
                .bold(true).text(restaurant?.name || 'Restaurant').newline()
                .bold(false).text(restaurant?.address?.street || restaurant?.address || '').newline()
                .text('--------------------------------').newline()
                .align('left').bold(true)
                .text(`Cust. Order ID: ${order.customerOrderId || order.id.substring(0, 8)}`).newline()
                .bold(false)
                .text(`Date: ${formatSafeDate(order.orderDate || order.createdAt)}`)
                .newline()
                .text('--------------------------------').newline();

            // Items
            (order.items || []).forEach(item => {
                const qty = item.quantity || 1;
                const price = item.price || 0;
                const total = (qty * price).toFixed(0);
                encoder.text(item.name).newline();
                encoder.text(`  ${qty} x ${price}`).align('right').text(total).align('left').newline();
            });

            // Totals
            encoder.text('--------------------------------').newline()
                .align('right');

            const subtotal = (order.items || []).reduce((sum, i) => sum + (i.price * i.quantity), 0);
            const tax = order.tax || 0;
            const cgst = tax / 2;
            const sgst = tax / 2;
            const packing = order.packagingCharge || 0;
            const delivery = order.deliveryCharge || 0;
            const platform = order.platformFee || 0;
            const convenience = order.convenienceFee || 0;
            const service = order.serviceFee || 0;
            const tip = order.tip || 0;
            const discount = order.discount || 0;
            const grandTotal = order.totalAmount || (subtotal + tax + packing + delivery + platform + convenience + service + tip - discount);

            encoder.text(`Subtotal: ${subtotal}`).newline();

            if (discount > 0) encoder.text(`Discount: -${discount}`).newline();
            if (packing > 0) encoder.text(`Packing: ${packing}`).newline();
            if (platform > 0) encoder.text(`Platform Fee: ${platform}`).newline();
            if (convenience > 0) encoder.text(`Conv. Fee: ${convenience}`).newline();
            if (service > 0) encoder.text(`Service Fee: ${service}`).newline();
            if (delivery > 0) encoder.text(`Delivery: ${delivery}`).newline();
            if (tip > 0) encoder.text(`Tip: ${tip}`).newline();

            if (cgst > 0) encoder.text(`CGST (2.5%): ${cgst}`).newline();
            if (sgst > 0) encoder.text(`SGST (2.5%): ${sgst}`).newline();

            encoder.bold(true).size('large')
                .text(`TOTAL: ${grandTotal}`).newline()
                .size('normal').bold(false).align('center')
                .newline()
                .text('Powered by ServiZephyr').newline()
                .newline().newline().newline()
                .cut();

            await printData(device, encoder.encode());
            setStatus('Sent to Thermal Printer ✅');
        } catch (error) {
            console.error(error);
            setStatus(`Error: ${error.message}`);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-md p-0 overflow-hidden">
                <DialogHeader className="p-4 border-b">
                    <DialogTitle className="flex justify-between items-center">
                        Print Bill
                        <span className="text-sm font-normal text-muted-foreground">{status}</span>
                    </DialogTitle>
                </DialogHeader>

                <div className="max-h-[60vh] overflow-y-auto bg-gray-100 p-4 flex justify-center">
                    <div className="w-[78mm] mx-auto bg-white shadow-md min-h-[100px]">
                        {/* Preview for ref */}
                        <div ref={billRef}>
                            <BillToPrint
                                order={order}
                                restaurant={restaurant}
                                // Adapter for BillToPrint props if needed
                                items={order.items || []}
                                customerDetails={{
                                    name: order.customer || order.customerName || order.name || 'Walk-in Customer',
                                    phone: order.customerPhone,
                                    address: order.customerAddress
                                }}
                                billDetails={{
                                    subtotal: (order.items || []).reduce((sum, i) => sum + (i.price * i.quantity), 0),
                                    grandTotal: order.totalAmount,
                                    cgst: (order.tax || 0) / 2,
                                    sgst: (order.tax || 0) / 2,
                                    packagingCharge: order.packagingCharge || 0,
                                    deliveryCharge: order.deliveryCharge || 0,
                                    platformFee: order.platformFee || 0,
                                    convenienceFee: order.convenienceFee || 0,
                                    serviceFee: order.serviceFee || 0,
                                    tip: order.tip || 0,
                                    discount: order.discount || 0
                                }}
                            />
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-muted border-t flex flex-col sm:flex-row gap-3 justify-end no-print">
                    <Button onClick={handleDirectPrint} variant="secondary" className="bg-slate-800 text-white hover:bg-slate-700">
                        ⚡ Thermal Print (USB)
                    </Button>
                    <Button onClick={handleStandardPrint} className="bg-primary hover:bg-primary/90">
                        <Printer className="mr-2 h-4 w-4" /> Standard Print
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
