
'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Banknote, User, Mail, Phone, Landmark, Hash, Save, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';

export default function PayoutSettingsPage() {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        account_number: '',
        ifsc_code: '',
        bank_name: 'ServiZephyr Default Bank' // This can be static or fetched
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [accountId, setAccountId] = useState('');
    const router = useRouter();

    useEffect(() => {
        const fetchUserData = async () => {
             setLoading(true);
             const user = auth.currentUser;
             if (user) {
                 setFormData(prev => ({
                     ...prev,
                     name: user.displayName || '',
                     email: user.email || '',
                     phone: user.phoneNumber || ''
                 }));

                 // Fetch existing account ID if it's there
                 const idToken = await user.getIdToken();
                 const res = await fetch('/api/owner/settings', { headers: { 'Authorization': `Bearer ${idToken}` }});
                 if (res.ok) {
                     const data = await res.json();
                     if (data.razorpayAccountId) {
                         setAccountId(data.razorpayAccountId);
                     }
                 }
             }
             setLoading(false);
        };

        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) {
                fetchUserData();
            } else {
                router.push('/');
            }
        });
        
        return () => unsubscribe();
    }, [router]);


    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.id]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setSuccess('');
        
        const { name, email, phone, account_number, ifsc_code, bank_name } = formData;
        if (!name || !email || !phone || !account_number || !ifsc_code) {
            setError("All fields are required.");
            setLoading(false);
            return;
        }

        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Authentication failed.");
            
            const idToken = await user.getIdToken();

            const response = await fetch('/api/owner/create-linked-account', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify(formData),
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || "Failed to link bank account.");
            }
            
            setSuccess(result.message);
            setAccountId(result.accountId);

        } catch (err) {
            console.error("Payout Settings Error:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };
    
    if (loading) {
         return (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Loader2 className="h-16 w-16 text-primary animate-spin" />
                <p className="mt-4 text-muted-foreground">Checking your account status...</p>
            </div>
        )
    }


    if(accountId) {
        return (
             <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center h-full text-center p-8 bg-card border border-border rounded-xl"
            >
                <CheckCircle className="h-20 w-20 text-green-500" />
                <h2 className="mt-6 text-2xl font-bold">Bank Account Linked Successfully!</h2>
                <p className="mt-2 max-w-md text-muted-foreground">Your Razorpay Contact ID for routing is:</p>
                <p className="mt-2 text-lg font-mono p-3 bg-muted rounded-md border border-border text-foreground">{accountId}</p>
                <p className="mt-4 text-sm text-muted-foreground">You are all set to receive payouts. No further action is needed.</p>
            </motion.div>
        )
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 md:p-6 text-foreground min-h-screen bg-background"
        >
            <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold tracking-tight">Payout Settings</h1>
                    <p className="text-muted-foreground mt-1">Link your bank account to receive payments from online orders.</p>
                </div>

                <div className="bg-card border border-border rounded-xl">
                    <form onSubmit={handleSubmit}>
                        <div className="p-6 space-y-6">
                            <h3 className="text-xl font-semibold flex items-center gap-3"><Banknote/> Bank Account Details</h3>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <Label htmlFor="name" className="flex items-center gap-2 mb-1"><User size={14}/> Account Holder Name</Label>
                                    <input id="name" type="text" value={formData.name} onChange={handleChange} required className="w-full p-2 border rounded-md bg-input border-border" />
                                </div>
                                 <div>
                                    <Label htmlFor="account_number" className="flex items-center gap-2 mb-1"><Hash size={14}/> Account Number</Label>
                                    <input id="account_number" type="text" value={formData.account_number} onChange={handleChange} required className="w-full p-2 border rounded-md bg-input border-border" />
                                </div>
                            </div>
                           
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <Label htmlFor="ifsc_code" className="flex items-center gap-2 mb-1"><Landmark size={14}/> IFSC Code</Label>
                                    <input id="ifsc_code" type="text" value={formData.ifsc_code} onChange={handleChange} required className="w-full p-2 border rounded-md bg-input border-border" />
                                </div>
                                <div>
                                    <Label htmlFor="email" className="flex items-center gap-2 mb-1"><Mail size={14}/> Contact Email</Label>
                                    <input id="email" type="email" value={formData.email} onChange={handleChange} required className="w-full p-2 border rounded-md bg-input border-border" />
                                </div>
                            </div>

                             <div>
                                <Label htmlFor="phone" className="flex items-center gap-2 mb-1"><Phone size={14}/> Contact Phone</Label>
                                <input id="phone" type="tel" value={formData.phone} onChange={handleChange} required className="w-full p-2 border rounded-md bg-input border-border" />
                            </div>
                        </div>
                        <div className="px-6 py-4 bg-muted/50 border-t border-border flex flex-col sm:flex-row justify-between items-center gap-4">
                            {error && <div className="flex items-center gap-2 text-sm text-destructive"><AlertTriangle size={16}/> {error}</div>}
                            {success && <div className="flex items-center gap-2 text-sm text-green-400"><CheckCircle size={16}/> {success}</div>}
                            <Button type="submit" className="w-full sm:w-auto bg-primary hover:bg-primary/90" disabled={loading}>
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                                {loading ? 'Linking Account...' : 'Save & Link Account'}
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </motion.div>
    );
}
