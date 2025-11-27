'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, Send, Loader2 } from 'lucide-react';
import { useUser } from '@/firebase/provider';
import { usePathname } from 'next/navigation';

export default function ReportIssueDialog({ isOpen, onClose }) {
    const [description, setDescription] = useState('');
    const [sending, setSending] = useState(false);
    const { user } = useUser();
    const pathname = usePathname();

    const captureErrorContext = () => {
        // Capture exact timestamp with timezone
        const now = new Date();
        const timestamp = now.toISOString(); // 2025-11-27T15:42:29.123Z
        const localTime = now.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3
        });

        // Get browser and device info
        const userAgent = navigator.userAgent;
        const browserInfo = {
            userAgent,
            language: navigator.language,
            platform: navigator.platform,
            vendor: navigator.vendor,
            cookieEnabled: navigator.cookieEnabled,
        };

        // Get screen info
        const screenInfo = {
            width: window.screen.width,
            height: window.screen.height,
            availWidth: window.screen.availWidth,
            availHeight: window.screen.availHeight,
            colorDepth: window.screen.colorDepth,
            pixelDepth: window.screen.pixelDepth,
        };

        // Get window info
        const windowInfo = {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            outerWidth: window.outerWidth,
            outerHeight: window.outerHeight,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
        };

        // Get connection info (if available)
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        const connectionInfo = connection ? {
            effectiveType: connection.effectiveType,
            downlink: connection.downlink,
            rtt: connection.rtt,
            saveData: connection.saveData,
        } : null;

        return {
            timestamp,
            localTime,
            page: {
                url: window.location.href,
                pathname,
                referrer: document.referrer,
                title: document.title,
            },
            user: user ? {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                phoneNumber: user.phoneNumber,
            } : { type: 'Guest' },
            browser: browserInfo,
            screen: screenInfo,
            window: windowInfo,
            connection: connectionInfo,
        };
    };

    const handleSendReport = async () => {
        setSending(true);
        try {
            const context = captureErrorContext();

            const reportData = {
                errorTitle: description || 'User reported an issue',
                errorMessage: description || 'No description provided',
                description: description || '',
                pathname,
                user: context.user,
                context,
                timestamp: context.timestamp,
                localTime: context.localTime,
            };

            const res = await fetch('/api/admin/mailbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reportData),
            });

            if (!res.ok) {
                throw new Error('Failed to send report');
            }

            // Success!
            setDescription('');
            onClose();
            alert('Report sent to admin successfully! ✅');
        } catch (error) {
            console.error('Error sending report:', error);
            alert('Failed to send report. Please try again.');
        } finally {
            setSending(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-orange-500" />
                        Report Issue to Admin
                    </DialogTitle>
                    <DialogDescription>
                        Click "Send" to report this issue. Adding a description is optional but helpful.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div>
                        <label className="text-sm font-medium mb-2 block">
                            What happened? (Optional)
                        </label>
                        <Textarea
                            placeholder="Describe the issue... (optional)"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={4}
                            className="resize-none"
                        />
                    </div>

                    <div className="text-xs text-muted-foreground bg-muted p-3 rounded-md">
                        <p className="font-semibold mb-1">Auto-captured info:</p>
                        <ul className="space-y-0.5">
                            <li>• Current page & URL</li>
                            <li>• Exact timestamp (for Vercel logs)</li>
                            <li>• Browser & device details</li>
                            <li>• Your account info</li>
                        </ul>
                    </div>

                    <div className="flex gap-2">
                        <Button
                            onClick={onClose}
                            variant="outline"
                            className="flex-1"
                            disabled={sending}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSendReport}
                            className="flex-1"
                            disabled={sending}
                        >
                            {sending ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Sending...
                                </>
                            ) : (
                                <>
                                    <Send className="mr-2 h-4 w-4" />
                                    Send to Admin
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
