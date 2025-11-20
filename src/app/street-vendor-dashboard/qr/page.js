
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Download, Printer, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import QRCode from 'qrcode.react';
import { useReactToPrint } from 'react-to-print';
import { useUser } from '@/firebase';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';
import { toPng } from 'html-to-image';
import GoldenCoinSpinner from '@/components/GoldenCoinSpinner';


export default function StreetVendorQrPage() {
  const { user, isUserLoading } = useUser();
  const [vendorId, setVendorId] = useState(null);
  const [loading, setLoading] = useState(true);
  const printRef = useRef();

  const handlePrint = useReactToPrint({
      content: () => printRef.current,
      documentTitle: "ServiZephyr_QR_Code",
  });
  
  const handleDownload = useCallback(() => {
    if (!printRef.current) return;

    toPng(printRef.current, { cacheBust: true, pixelRatio: 2 })
      .then((dataUrl) => {
        const link = document.createElement('a');
        link.download = `ServiZephyr-QR-${vendorId}.png`;
        link.href = dataUrl;
        link.click();
      })
      .catch((err) => {
        console.error('oops, something went wrong!', err);
      });
  }, [vendorId]);


  useEffect(() => {
    if (isUserLoading) return;
    if (!user) {
        setLoading(false);
        return;
    };

    const fetchVendorData = async () => {
        try {
            const vendorsRef = collection(db, 'street_vendors');
            const q = query(vendorsRef, where("ownerId", "==", user.uid));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                 throw new Error("No street vendor profile found for this user.");
            }
            
            const vendorDoc = querySnapshot.docs[0];
            setVendorId(vendorDoc.id);

        } catch(err) {
            const contextualError = new FirestorePermissionError({ path: `street_vendors`, operation: 'list' });
            errorEmitter.emit('permission-error', contextualError);
            console.error("Error fetching vendor data:", err);
        } finally {
            setLoading(false);
        }
    }
    fetchVendorData();
  }, [user, isUserLoading]);
  
  const qrValue = vendorId ? `${window.location.origin}/order/${vendorId}` : '';

  return (
    <>
    <style jsx global>{`
        @keyframes gradient-animation {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }
        .animated-gradient {
            background: linear-gradient(-45deg, hsl(var(--primary)), #ffffff);
            background-size: 400% 400%;
            animation: gradient-animation 10s ease infinite;
        }
    `}</style>
    <div className="min-h-screen bg-background text-foreground font-body p-4 flex flex-col">
        <header className="flex justify-between items-center mb-6">
            <Link href="/street-vendor-dashboard" passHref>
                <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
                    <ArrowLeft size={28} />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold font-headline">My QR Code</h1>
            <div className="w-12"> {/* Spacer */}</div>
        </header>

        <main className="flex-grow flex flex-col items-center justify-center text-center">
            {loading ? (
                 <GoldenCoinSpinner />
            ) : vendorId ? (
                <>
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 20 }}
                    className="w-full max-w-xs sm:max-w-sm"
                >
                    <div ref={printRef} className="animated-gradient p-6 sm:p-8 rounded-3xl shadow-2xl shadow-primary/20">
                        <div className="bg-white p-4 rounded-xl">
                            <QRCode
                                value={qrValue}
                                style={{ width: '100%', height: '100%' }}
                                level={"H"}
                                includeMargin={true}
                                imageSettings={{
                                    src: "/logo.png",
                                    x: undefined,
                                    y: undefined,
                                    height: 32,
                                    width: 32,
                                    excavate: true,
                                }}
                            />
                             <h2 className="text-xl sm:text-2xl font-bold text-black mt-6 font-headline">Scan to Pre-Order</h2>
                             <p className="text-slate-600 text-sm">Powered by ServiZephyr</p>
                        </div>
                    </div>
                </motion.div>
                
                <p className="mt-8 text-muted-foreground max-w-md">
                    Print this QR code and display it at your stall. Customers can scan it to see your menu and place pre-paid orders.
                </p>

                <div className="mt-8 grid grid-cols-1 gap-4 w-full max-w-lg">
                    <Button onClick={handleDownload} variant="outline" className="text-lg h-14 px-8 border-2 border-border text-foreground hover:bg-muted">
                        <Download className="mr-2"/> Download PNG
                    </Button>
                </div>
                </>
            ) : (
                <p>Could not load vendor QR code. Please make sure your profile is set up.</p>
            )}
        </main>
    </div>
    </>
  );
}
