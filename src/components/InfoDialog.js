
'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle, AlertTriangle, Send } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { auth } from '@/lib/firebase';

const InfoDialog = ({ isOpen, onClose, title, message }) => {
  const [isSending, setIsSending] = useState(false);
  const [reportSent, setReportSent] = useState(false);
  const isError = title.toLowerCase().includes('error');
  const pathname = usePathname();

  const handleSendReport = async () => {
    setIsSending(true);
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error("User not authenticated to send report.");
      }
      const idToken = await user.getIdToken();

      const reportPayload = {
        errorTitle: title,
        errorMessage: message,
        pathname: pathname,
        user: {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
        },
        timestamp: new Date().toISOString(),
      };

      const response = await fetch('/api/admin/mailbox', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify(reportPayload),
      });

      if (!response.ok) {
        throw new Error("Failed to send report.");
      }
      
      setReportSent(true);
      setTimeout(() => {
        onClose();
        setTimeout(() => setReportSent(false), 500);
      }, 2000);

    } catch (error) {
      console.error("Failed to send report:", error);
      // We don't show another dialog for a failed report to avoid loops
    } finally {
      setIsSending(false);
    }
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogPortal>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader className="flex flex-col items-center text-center">
              {isError ? (
                  <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
              ) : (
                  <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
              )}
            <DialogTitle className="text-xl">{title}</DialogTitle>
            {message && <DialogDescription className="pt-2">{message}</DialogDescription>}
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row sm:justify-center gap-2">
            <Button onClick={onClose} className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground">OK</Button>
            {isError && (
              <Button onClick={handleSendReport} variant="secondary" className="w-full sm:w-auto" disabled={isSending || reportSent}>
                  {isSending ? (
                      'Sending...'
                  ) : reportSent ? (
                      <>
                      <CheckCircle className="mr-2 h-4 w-4 text-green-500"/> Report Sent!
                      </>
                  ) : (
                      <>
                      <Send className="mr-2 h-4 w-4"/> Send Report to Admin
                      </>
                  )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
};

export default InfoDialog;
