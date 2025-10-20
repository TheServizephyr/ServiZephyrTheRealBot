
'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle, AlertTriangle } from 'lucide-react';

const InfoDialog = ({ isOpen, onClose, title, message }) => {
  const isError = title.toLowerCase().includes('error');
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
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
        <DialogFooter className="sm:justify-center">
          <Button onClick={onClose} className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground">OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InfoDialog;
