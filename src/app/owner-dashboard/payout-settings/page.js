'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Banknote, User, Hash, Landmark, Save, Loader2, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { getAuth } from 'firebase/auth';

const SectionCard = ({ title, description, children, footer }) => (
    <motion.div 
        className="bg-card border border-border rounded-xl"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
    >
        <div className="p-6 border-b border-border">
            <h2 className="text-xl font-bold text-foreground">{title}</h2>
            {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        <div className="p-6">
            {children}
        </div>
        {footer && <div className="p-6 bg-muted/30 border-t border-border rounded-b-xl">{footer}</div>}
    </motion.div>
);

export default function PayoutSettingsPage() {
    const [accountDetails, setAccountDetails] = useState({
        name: '',
        account_number: '',
        ifsc: ''
    });
    const [razorpayAccountId, setRazorpayAccountId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const fetchSettings = async () => {
        setLoading(true);
        setError('');
        try {
            const auth = getAuth();
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication required.");
            const idToken = await user.getIdToken();
            
            const res = await fetch('/api/owner/settings', {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || "Failed to fetch settings.");
            }
            const data = await res.json();
            setRazorpayAccountId(data.razorpayAccountId);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSettings();
    }, []);

    const handleChange = (e) => {
        const { id, value } = e.target;
        setAccountDetails(prev => ({ ...prev, [id]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        setError('');
        setSuccess('');

        if(!accountDetails.name || !accountDetails.account_number || !accountDetails.ifsc) {
            setError("All fields are mandatory.");
            setIsSaving(false);
            return;
        }

        try {
            const auth = getAuth();
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication session expired. Please log in again.");
            const idToken = await user.getIdToken();

            const res = await fetch('/api/owner/create-linked-account', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}` 
                },
                body: JSON.stringify(accountDetails)
            });

            const result = await res.json();
            if (!res.ok) throw new Error(result.message || "Failed to create linked account.");
            
            setSuccess(`Account linked successfully! Your new Account ID is: ${result.accountId}`);
            setRazorpayAccountId(result.accountId); // Update state to show the connected view

        } catch (err) {
            setError(err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const renderContent = () => {
        if (loading) {
            return (
                <div className="flex justify-center items-center h-48">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            );
        }

        return (
            <form onSubmit={handleSubmit} className="space-y-6">
                {razorpayAccountId && (
                     <div className="text-center p-4 bg-muted rounded-lg border border-border">
                        <p className="text-sm text-muted-foreground">Currently Linked Account ID:</p>
                        <p className="font-mono text-lg text-foreground">{razorpayAccountId}</p>
                        {razorpayAccountId.startsWith('cust_') && (
                            <p className="text-xs text-yellow-400 mt-1">This ID seems incorrect. Please re-link your account to enable payouts.</p>
                        )}
                    </div>
                )}
                <div>
                    <Label htmlFor="name" className="flex items-center gap-2 mb-1"><User size={14}/> Account Holder Name</Label>
                    <Input id="name" value={accountDetails.name} onChange={handleChange} placeholder="e.g., Rohan Sharma" required />
                </div>
                <div>
                    <Label htmlFor="account_number" className="flex items-center gap-2 mb-1"><Hash size={14}/> Account Number</Label>
                    <Input id="account_number" value={accountDetails.account_number} onChange={handleChange} placeholder="Enter your bank account number" required />
                </div>
                <div>
                    <Label htmlFor="ifsc" className="flex items-center gap-2 mb-1"><Landmark size={14}/> IFSC Code</Label>
                    <Input id="ifsc" value={accountDetails.ifsc} onChange={handleChange} placeholder="e.g., SBIN0001234" required />
                </div>
            </form>
        );
    };

    return (
        <div className="p-4 md:p-6 text-foreground min-h-screen bg-background space-y-8">
            <h1 className="text-3xl font-bold tracking-tight">Payout Settings</h1>

            <SectionCard
                title="Razorpay Payout Connection"
                description="Link your bank account with Razorpay to receive payments from your customers. You can update your details anytime."
                footer={
                    <div className="flex justify-end">
                        <Button onClick={handleSubmit} disabled={isSaving || loading} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            {isSaving ? "Connecting..." : (razorpayAccountId ? "Update / Re-link Bank Account" : "Connect Bank Account")}
                        </Button>
                    </div>
                }
            >
                {renderContent()}
                {error && <p className="mt-4 text-center text-sm text-red-500 bg-red-500/10 p-3 rounded-md"><AlertTriangle className="inline-block mr-2"/>{error}</p>}
                {success && <p className="mt-4 text-center text-sm text-green-500 bg-green-500/10 p-3 rounded-md"><CheckCircle className="inline-block mr-2"/>{success}</p>}
            </SectionCard>

            <div className="bg-muted/50 p-4 rounded-lg text-sm text-muted-foreground">
                <h4 className="font-semibold text-foreground mb-2">How do payouts work?</h4>
                <ol className="list-decimal list-inside space-y-1">
                    <li>When a customer pays, the money first comes to ServiZephyr's main Razorpay account.</li>
                    <li>Our system automatically triggers a transfer to your linked bank account via Razorpay Route.</li>
                    <li>This entire process is secure and managed by Razorpay to ensure timely payouts.</li>
                </ol>
            </div>
        </div>
    );
}
