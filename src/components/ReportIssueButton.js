'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';
import ReportIssueDialog from './ReportIssueDialog';

export default function ReportIssueButton() {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <Button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-6 right-6 z-50 shadow-lg hover:shadow-xl transition-shadow"
                size="lg"
                variant="destructive"
            >
                <AlertCircle className="mr-2 h-5 w-5" />
                Report Issue
            </Button>

            <ReportIssueDialog isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </>
    );
}
