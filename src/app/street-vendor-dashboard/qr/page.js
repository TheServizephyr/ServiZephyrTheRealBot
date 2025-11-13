'use client';

import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import QRCode from 'qrcode.react';
import { useReactToPrint } from 'react-to-print';

export default function StreetVendorQrPage() {
  // In a real app, this value would come from the vendor's data
  const qrValue = "https://servizephyr.com/pre-order/vendor-123";
  const printRef = useRef();

  const handlePrint = useReactToPrint({
      content: () => printRef.current,
      documentTitle: "ServiZephyr_QR_Code",
  });
  
  const handleDownload = () => {
      const canvas = printRef.current.querySelector('canvas');
      if (canvas) {
          const pngUrl = canvas
              .toDataURL("image/png")
              .replace("image/png", "image/octet-stream");
          let downloadLink = document.createElement("a");
          downloadLink.href = pngUrl;
          downloadLink.download = "ServiZephyr-QR.png";
          document.body.appendChild(downloadLink);
          downloadLink.click();
          document.body.removeChild(downloadLink);
      }
  };


  return (
    <div className="min-h-screen bg-slate-900 text-white font-body p-4 flex flex-col">
        <header className="flex justify-between items-center mb-6">
            <Link href="/street-vendor-dashboard" passHref>
                <Button variant="ghost" className="text-slate-400 hover:text-white">
                    <ArrowLeft size={28} />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold font-headline">My QR Code</h1>
            <div className="w-12"></div> {/* Spacer */}
        </header>

        <main className="flex-grow flex flex-col items-center justify-center text-center">
            <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
                className="bg-white p-8 rounded-2xl shadow-2xl shadow-primary/20"
                ref={printRef}
            >
                <QRCode
                    value={qrValue}
                    size={256}
                    level={"H"}
                    includeMargin={true}
                    imageSettings={{
                        src: "/logo-icon.png",
                        x: undefined,
                        y: undefined,
                        height: 48,
                        width: 48,
                        excavate: true,
                    }}
                />
                 <h2 className="text-2xl font-bold text-black mt-6 font-headline">Scan to Pre-Order</h2>
                 <p className="text-slate-600">Powered by ServiZephyr</p>
            </motion.div>
            
            <p className="mt-8 text-slate-400 max-w-md">
                Print this QR code and display it at your stall. Customers can scan it to see your menu and place pre-paid orders.
            </p>

            <div className="mt-8 flex gap-4">
                <Button onClick={handleDownload} variant="outline" className="text-lg h-14 px-8 border-2 border-primary text-primary hover:bg-primary/10 hover:text-primary">
                    <Download className="mr-2"/> Download
                </Button>
                 <Button onClick={handlePrint} className="text-lg h-14 px-8 bg-primary hover:bg-primary/90 text-primary-foreground">
                    <Printer className="mr-2"/> Print
                </Button>
            </div>
        </main>
    </div>
  );
}
