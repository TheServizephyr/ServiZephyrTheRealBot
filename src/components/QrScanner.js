'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { motion } from 'framer-motion';
import { X, CameraOff } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const QrScanner = ({ onClose, onScanSuccess }) => {
    const scannerRef = useRef(null);
    const html5QrRef = useRef(null);
    const permissionProbeStreamRef = useRef(null);
    const [cameraError, setCameraError] = useState(null);
    const [isPermissionDenied, setIsPermissionDenied] = useState(false);
    const [retryNonce, setRetryNonce] = useState(0);

    const stopScanner = useCallback(async () => {
        if (permissionProbeStreamRef.current) {
            permissionProbeStreamRef.current.getTracks().forEach((track) => track.stop());
            permissionProbeStreamRef.current = null;
        }

        const scanner = html5QrRef.current;
        if (!scanner) return;

        try {
            await scanner.stop();
        } catch {
            // Scanner may already be stopped.
        }

        try {
            await scanner.clear();
        } catch {
            // Scanner UI may already be cleared.
        }
    }, []);

    useEffect(() => {
        if (!scannerRef.current) return;

        const html5QrCode = new Html5Qrcode(scannerRef.current.id);
        html5QrRef.current = html5QrCode;
        let currentCameraId;

        const startScanner = (cameras) => {
            if (cameras && cameras.length > 0) {
                const camera = cameras.find(c => c.label.toLowerCase().includes('back')) || cameras[0];
                currentCameraId = camera.id;

                html5QrCode.start(
                    currentCameraId,
                    {
                        fps: 10,
                        qrbox: (viewfinderWidth, viewfinderHeight) => {
                            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                            const qrboxSize = Math.floor(minEdge * 0.9);
                            return {
                                width: qrboxSize,
                                height: qrboxSize,
                            };
                        },
                    },
                    (decodedText) => {
                        void stopScanner();
                        onScanSuccess(decodedText);
                    },
                    () => {
                        // ignore non-critical frame scan errors
                    }
                ).catch((err) => {
                    console.error(`Unable to start scanning, error: ${err}`);
                    setCameraError("Could not start camera. Please ensure permissions are granted and no other app is using it.");
                });
            } else {
                setCameraError("No cameras found on this device.");
            }
        };

        const initScanner = async () => {
            try {
                setCameraError(null);
                setIsPermissionDenied(false);

                if (!navigator?.mediaDevices?.getUserMedia) {
                    setCameraError("Camera API not available in this browser.");
                    return;
                }

                // Force browser permission prompt for camera access first.
                const permissionProbeStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: 'environment' } }
                });
                permissionProbeStreamRef.current = permissionProbeStream;

                // Only probing permission; scanner will start its own stream.
                permissionProbeStream.getTracks().forEach((track) => track.stop());
                permissionProbeStreamRef.current = null;

                const cameras = await Html5Qrcode.getCameras();
                startScanner(cameras);
            } catch (err) {
                console.error("Failed to initialize scanner", err);
                const errName = String(err?.name || '').toLowerCase();
                if (errName.includes('notallowed') || errName.includes('permission')) {
                    let permissionState = 'unknown';
                    try {
                        if (navigator.permissions?.query) {
                            const permissionStatus = await navigator.permissions.query({ name: 'camera' });
                            permissionState = permissionStatus?.state || 'unknown';
                        }
                    } catch {
                        permissionState = 'unknown';
                    }

                    // If browser says permission is granted, this is usually camera-in-use,
                    // OS privacy lock, or another stream conflict.
                    if (permissionState === 'granted') {
                        setIsPermissionDenied(false);
                        setCameraError("Camera access is allowed, but the camera is currently unavailable. Close other tabs/apps using camera and retry.");
                    } else {
                        setIsPermissionDenied(true);
                        setCameraError("Camera permission denied.");
                    }
                } else if (errName.includes('notreadable') || errName.includes('trackstart') || errName.includes('abort')) {
                    setCameraError("Camera is busy or unavailable. Close other camera apps/tabs and retry.");
                } else if (errName.includes('notfound') || errName.includes('overconstrained')) {
                    setCameraError("No usable camera device found.");
                } else {
                    setCameraError("Could not access camera. Please check your browser permissions.");
                }
            }
        };

        void initScanner();

        return () => {
            void stopScanner();
            if (html5QrRef.current === html5QrCode) {
                html5QrRef.current = null;
            }
        };
    }, [onScanSuccess, retryNonce, stopScanner]);

    return (
        <motion.div
            className="fixed inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <div className="relative w-full max-w-md bg-background rounded-2xl p-4 shadow-2xl">
                <button
                    onClick={async () => {
                        await stopScanner();
                        onClose();
                    }}
                    className="absolute -top-3 -right-3 bg-destructive text-destructive-foreground rounded-full p-2 z-10 shadow-lg"
                >
                    <X size={24} />
                </button>
                <h2 className="text-xl font-bold text-center mb-4">Scan QR Code</h2>

                {cameraError ? (
                    <div className="space-y-3">
                        <Alert variant="destructive">
                            <CameraOff className="h-4 w-4" />
                            <AlertTitle>Camera Error</AlertTitle>
                            <AlertDescription>
                                {cameraError} Please check your browser settings to allow camera access.
                            </AlertDescription>
                        </Alert>
                        {isPermissionDenied && (
                            <p className="text-xs text-muted-foreground">
                                Browser permission blocked hai. Address bar ke left lock icon pe click karo, camera permission Allow karo, phir retry karo.
                            </p>
                        )}
                        <Button type="button" variant="outline" className="w-full" onClick={() => setRetryNonce((v) => v + 1)}>
                            Retry Camera Access
                        </Button>
                    </div>
                ) : (
                    <div id="qr-scanner-container" ref={scannerRef} className="rounded-lg overflow-hidden border-2 border-primary"></div>
                )}
            </div>
        </motion.div>
    );
};

export default QrScanner;
