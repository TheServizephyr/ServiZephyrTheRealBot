'use client';

import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Download, Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import QRCode from 'qrcode.react';
import { useReactToPrint } from 'react-to-print';

export default function StreetVendorQrPage() {
  // In a real app, this value would come from the vendor's data
  const [qrId, setQrId] = useState("vendor-123-initial");
  const qrValue = `https://servizephyr.com/pre-order/${qrId}`;
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
          downloadLink.download = `ServiZephyr-QR-${qrId}.png`;
          document.body.appendChild(downloadLink);
          downloadLink.click();
          document.body.removeChild(downloadLink);
      }
  };
  
  const handleGenerateNew = () => {
      // This creates a new unique ID, making the old QR code invalid.
      setQrId(`vendor-123-${Date.now()}`);
  }


  return (
    <>
    <style jsx global>{`
        @keyframes gradient-animation {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }
        .animated-gradient {
            background: linear-gradient(-45deg, hsl(var(--primary)), #ffffff, hsl(var(--primary)));
            background-size: 400% 400%;
            animation: gradient-animation 10s ease infinite;
        }
    `}</style>
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
                className="animated-gradient p-8 rounded-3xl shadow-2xl shadow-primary/20"
            >
                <div ref={printRef} className="bg-white p-4 rounded-xl">
                    <QRCode
                        value={qrValue}
                        size={256}
                        level={"H"} // High error correction for logo
                        includeMargin={true}
                        imageSettings={{
                            src: "/logo.png",
                            x: undefined,
                            y: undefined,
                            height: 48,
                            width: 48,
                            excavate: true,
                        }}
                    />
                     <h2 className="text-2xl font-bold text-black mt-6 font-headline">Scan to Pre-Order</h2>
                     <p className="text-slate-600">Powered by ServiZephyr</p>
                </div>
            </motion.div>
            
            <p className="mt-8 text-slate-400 max-w-md">
                Print this QR code and display it at your stall. Customers can scan it to see your menu and place pre-paid orders.
            </p>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-lg">
                <Button onClick={handleDownload} variant="outline" className="text-lg h-14 px-8 border-2 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
                    <Download className="mr-2"/> Download
                </Button>
                 <Button onClick={handlePrint} className="text-lg h-14 px-8 bg-primary hover:bg-primary/90 text-primary-foreground">
                    <Printer className="mr-2"/> Print
                </Button>
                 <Button onClick={handleGenerateNew} variant="destructive" className="text-lg h-14 px-8">
                    <RefreshCw className="mr-2"/> Generate New
                </Button>
            </div>
        </main>
    </div>
    </>
  );
}
