
'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Users, Phone, User, CheckCircle2, Loader2, AlertCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export default function PublicWaitlistPage({ params }) {
    const { restaurantId } = params;
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [paxCount, setPaxCount] = useState('2');
    const [loading, setLoading] = useState(false);
    const [isFetchingStatus, setIsFetchingStatus] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [restaurantData, setRestaurantData] = useState(null);

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const res = await fetch(`/api/public/restaurant-overview/${restaurantId}`);
                if (res.ok) {
                    const data = await res.json();
                    setRestaurantData(data.restaurant);
                }
            } catch (err) {
                console.error("Failed to fetch restaurant status:", err);
            } finally {
                setIsFetchingStatus(false);
            }
        };
        fetchStatus();
    }, [restaurantId]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/public/waitlist/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    restaurantId,
                    name,
                    phone,
                    paxCount: parseInt(paxCount)
                })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.message || 'Failed to join waitlist');
            }

            setSuccess(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (isFetchingStatus) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
        );
    }

    const isOpen = restaurantData?.isOpen !== false;
    const isWaitlistEnabled = restaurantData?.services?.waitlist !== false;
    const restaurantName = restaurantData?.name || 'Restaurant';

    if (success) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="w-full max-w-md"
                >
                    <Card className="text-center p-6 border-2 border-primary/20 bg-card shadow-2xl">
                        <div className="mb-6 flex justify-center">
                            <div className="h-20 w-20 bg-primary/10 rounded-full flex items-center justify-center">
                                <CheckCircle2 className="h-12 w-12 text-primary animate-pulse" />
                            </div>
                        </div>
                        <CardTitle className="text-3xl font-black mb-2 tracking-tight">You&apos;re on the list!</CardTitle>
                        <CardDescription className="text-lg mb-6 text-center">
                            We&apos;ll call or text you as soon as your table at <strong className="text-primary">{restaurantName}</strong> for <strong>{paxCount}</strong> is ready.
                        </CardDescription>
                        <div className="bg-muted p-4 rounded-xl mb-6 text-left">
                            <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-1">Notice</p>
                            <p className="text-sm">Please stay nearby so you don&apos;t miss your turn.</p>
                        </div>
                        <Button className="w-full h-12 text-lg font-bold" onClick={() => window.location.reload()}>
                            Close
                        </Button>
                    </Card>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background flex flex-col p-4 md:justify-center md:items-center">
            <header className="mb-8 md:text-center pt-8 md:pt-0">
                <h1 className="text-4xl font-black tracking-tight mb-2 uppercase italic text-primary">{restaurantName}</h1>
                <p className="text-muted-foreground font-medium underline underline-offset-4 decoration-primary/30">Join Our Waitlist</p>
            </header>

            <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="w-full max-w-md"
            >
                <Card className={cn("border-border shadow-2xl bg-card overflow-hidden transition-all duration-500", (!isOpen || !isWaitlistEnabled) && "opacity-90 grayscale-[0.5]")}>
                    <CardHeader className="space-y-1 bg-muted/30 border-b border-border/50">
                        <CardTitle className="text-2xl font-black uppercase tracking-tight">Guest Details</CardTitle>
                        <CardDescription className="font-medium">Secure your spot in the queue.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        {(!isOpen || !isWaitlistEnabled) ? (
                            <div className="py-8 text-center space-y-4">
                                <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-2">
                                    <AlertCircle size={32} />
                                </div>
                                <h3 className="text-xl font-bold uppercase tracking-tight">
                                    {!isOpen ? 'Restaurant is Closed' : 'Waitlist is Full/Disabled'}
                                </h3>
                                <p className="text-muted-foreground text-sm px-4">
                                    {!isOpen
                                        ? "Sorry, we aren't accepting waitlist entries right now because the restaurant is closed. Please check back during business hours."
                                        : "We are currently not accepting new waitlist entries. Please check with the host at the restaurant."}
                                </p>
                            </div>
                        ) : (
                            <form id="waitlist-form" onSubmit={handleSubmit} className="space-y-5">
                                <div className="space-y-2">
                                    <Label htmlFor="name" className="text-xs font-black uppercase tracking-widest text-primary">Your Name</Label>
                                    <div className="relative group">
                                        <User className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                        <Input
                                            id="name"
                                            placeholder="Ex: Rahul Kumar"
                                            className="pl-10 h-12 bg-muted/30 focus:bg-background border-border font-bold text-lg"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="phone" className="text-xs font-black uppercase tracking-widest text-primary">Phone Number</Label>
                                    <div className="relative group">
                                        <Phone className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                        <Input
                                            id="phone"
                                            type="tel"
                                            placeholder="9876543210"
                                            className="pl-10 h-12 bg-muted/30 focus:bg-background border-border font-bold text-lg"
                                            value={phone}
                                            onChange={(e) => setPhone(e.target.value)}
                                            pattern="\d{10}"
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="paxCount" className="text-xs font-black uppercase tracking-widest text-primary">Number of Guests</Label>
                                    <div className="relative group">
                                        <Users className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                        <select
                                            id="paxCount"
                                            className="w-full h-12 pl-10 pr-4 rounded-md border border-border bg-muted/30 focus:bg-background focus:ring-2 focus:ring-primary outline-none transition-all appearance-none font-bold text-lg cursor-pointer"
                                            value={paxCount}
                                            onChange={(e) => setPaxCount(e.target.value)}
                                            required
                                        >
                                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                                                <option key={n} value={n}>{n} {n === 1 ? 'Guest' : 'Guests'}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {error && (
                                    <motion.div
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        className="bg-destructive/10 border border-destructive/20 text-destructive p-3 rounded-lg flex items-start gap-2 text-sm font-bold"
                                    >
                                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                                        {error}
                                    </motion.div>
                                )}
                            </form>
                        )}
                    </CardContent>
                    <CardFooter className="bg-muted/30 border-t border-border/50 pt-6">
                        <Button
                            form="waitlist-form"
                            className="w-full h-14 text-xl font-black uppercase tracking-tight shadow-lg shadow-primary/20"
                            size="lg"
                            disabled={loading || !isOpen || !isWaitlistEnabled}
                        >
                            {loading ? (
                                <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                            ) : (
                                <>Join Queue <ArrowRight className="ml-2 h-6 w-6" /></>
                            )}
                        </Button>
                    </CardFooter>
                </Card>
            </motion.div>

            <footer className="mt-auto py-8 text-center text-xs text-muted-foreground font-black uppercase tracking-[0.2em]">
                Powered by <span className="text-primary">ServiZephyr</span>
            </footer>
        </div>
    );
}
