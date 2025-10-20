
'use client';

import { useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { motion } from 'framer-motion';
import { X, CameraOff } from 'lucide-react';

const QrScanner = ({ onClose, onScanSuccess }) => {
    const scannerRef = useRef(null);

    useEffect(() => {
        if (!scannerRef.current.innerHTML) {
            const scanner = new Html5QrcodeScanner(
                'qr-scanner',
                { fps: 10, qrbox: { width: 250, height: 250 } },
                false // verbose
            );

            const handleSuccess = (decodedText, decodedResult) => {
                scanner.clear();
                onScanSuccess(decodedText);
            };

            const handleError = (error) => {
                // You can add more sophisticated error handling here if needed
                // console.warn(`QR error = ${error}`);
            };
            
            scanner.render(handleSuccess, handleError);

            return () => {
                if (scanner) {
                    // It's important to clear the scanner on component unmount
                    // to stop the camera stream.
                    scanner.clear().catch(error => {
                        console.error("Failed to clear html5-qrcode-scanner.", error);
                    });
                }
            };
        }
    }, [onScanSuccess]);

    return (
        <motion.div
            className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <div className="relative w-full max-w-md bg-background rounded-2xl p-6 shadow-2xl">
                <button 
                    onClick={onClose}
                    className="absolute -top-4 -right-4 bg-destructive text-destructive-foreground rounded-full p-2 z-10"
                >
                    <X size={24} />
                </button>
                 <h2 className="text-2xl font-bold text-center mb-4">Scan Table QR Code</h2>
                <div id="qr-scanner" ref={scannerRef}></div>
            </div>
        </motion.div>
    );
};

export default QrScanner;
