
'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Users, Phone, User, CheckCircle2, Loader2, AlertCircle, ArrowRight, CalendarClock, ArrowLeft, PartyPopper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import QRCode from 'qrcode.react';

const getWaitlistStorageKey = (restaurantId) => `servizephyr_waitlist_token_${restaurantId}`;

export default function PublicWaitlistPage({ params }) {
    const { restaurantId } = params;
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [paxCount, setPaxCount] = useState('2');
    const [mode, setMode] = useState('waitlist'); // waitlist | booking
    const [bookingDate, setBookingDate] = useState('');
    const [bookingTime, setBookingTime] = useState('19:00');
    const [bookingOccasion, setBookingOccasion] = useState('');
    const [loading, setLoading] = useState(false);
    const [isFetchingStatus, setIsFetchingStatus] = useState(true);
    const [error, setError] = useState('');
    const [statusError, setStatusError] = useState('');
    const [success, setSuccess] = useState(false);
    const [waitlistToken, setWaitlistToken] = useState('');
    const [arrivalCode, setArrivalCode] = useState('');
    const [entryId, setEntryId] = useState('');
    const [queueStatus, setQueueStatus] = useState('pending');
    const [isCoinFlipped, setIsCoinFlipped] = useState(false);
    const [restaurantData, setRestaurantData] = useState(null);

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const res = await fetch(`/api/public/restaurant-overview/${restaurantId}`);
                if (res.ok) {
                    const data = await res.json();
                    setRestaurantData(data.restaurant);
                    setStatusError('');
                } else {
                    setRestaurantData(null);
                    setStatusError('Could not verify restaurant status right now. Please try again in a moment.');
                }
            } catch (err) {
                console.error("Failed to fetch restaurant status:", err);
                setRestaurantData(null);
                setStatusError('Network issue while checking restaurant status. Please retry.');
            } finally {
                setIsFetchingStatus(false);
            }
        };
        fetchStatus();
    }, [restaurantId]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const storageKey = getWaitlistStorageKey(restaurantId);
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return;

        try {
            const saved = JSON.parse(raw);
            if (!saved?.entryId || !saved?.waitlistToken || !saved?.arrivalCode) return;
            setMode('waitlist');
            if (saved.name) setName(saved.name);
            if (saved.phone) setPhone(saved.phone);
            if (saved.paxCount) setPaxCount(String(saved.paxCount));
            setWaitlistToken(saved.waitlistToken);
            setArrivalCode(saved.arrivalCode);
            setEntryId(saved.entryId);
            setQueueStatus(saved.queueStatus || 'pending');
            setSuccess(true);
        } catch (parseErr) {
            console.warn('[waitlist] Failed to restore saved token:', parseErr);
        }
    }, [restaurantId]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const storageKey = getWaitlistStorageKey(restaurantId);
        if (!(mode === 'waitlist' && success && entryId && waitlistToken && arrivalCode)) {
            return;
        }

        window.localStorage.setItem(storageKey, JSON.stringify({
            restaurantId,
            mode: 'waitlist',
            name,
            phone,
            paxCount: Number.parseInt(String(paxCount || 1), 10) || 1,
            entryId,
            waitlistToken,
            arrivalCode,
            queueStatus,
            savedAt: new Date().toISOString(),
        }));
    }, [restaurantId, mode, success, name, phone, paxCount, entryId, waitlistToken, arrivalCode, queueStatus]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        if (!(mode === 'waitlist' && success && entryId && arrivalCode)) return undefined;

        let isCancelled = false;

        const pollWaitlistStatus = async () => {
            try {
                const params = new URLSearchParams({
                    restaurantId,
                    entryId,
                    arrivalCode,
                });
                if (document.visibilityState === 'hidden') return;
                const res = await fetch(`/api/public/waitlist/status?${params.toString()}`, { cache: 'no-store' });
                const data = await res.json();
                if (!res.ok || isCancelled) return;

                const nextStatus = String(data?.status || 'pending').toLowerCase();
                setQueueStatus(nextStatus);

                if (nextStatus === 'seated') {
                    setSuccess(true);
                    return;
                }

                if (['cancelled', 'no_show'].includes(nextStatus)) {
                    setSuccess(false);
                    setError(nextStatus === 'no_show'
                        ? 'Your waitlist token expired due to late arrival. Please join again.'
                        : 'Your waitlist entry was cancelled. Please join again if needed.');
                    window.localStorage.removeItem(getWaitlistStorageKey(restaurantId));
                }
            } catch (pollErr) {
                console.warn('[waitlist] status poll error:', pollErr);
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void pollWaitlistStatus();
            }
        };

        void pollWaitlistStatus();
        const interval = window.setInterval(pollWaitlistStatus, 12000);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            isCancelled = true;
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [restaurantId, mode, success, entryId, arrivalCode]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const trimmedName = String(name || '').trim();
            const normalizedPhone = String(phone || '').replace(/\D/g, '').slice(-10);
            const normalizedPaxCount = Number.parseInt(String(paxCount || ''), 10);
            if (!trimmedName) {
                throw new Error('Please enter your name.');
            }
            if (!/^\d{10}$/.test(normalizedPhone)) {
                throw new Error('Please enter a valid 10-digit phone number.');
            }
            if (!Number.isInteger(normalizedPaxCount) || normalizedPaxCount < 1 || normalizedPaxCount > 20) {
                throw new Error('Please enter guests between 1 and 20.');
            }

            const isBookingMode = mode === 'booking';
            let endpoint = '/api/public/waitlist/join';
            let payload = {
                restaurantId,
                name: trimmedName,
                phone: normalizedPhone,
                paxCount: normalizedPaxCount
            };

            if (isBookingMode) {
                if (!bookingDate || !bookingTime) {
                    throw new Error('Please choose booking date and time.');
                }
                const bookingDateTime = new Date(`${bookingDate}T${bookingTime}`);
                if (Number.isNaN(bookingDateTime.getTime())) {
                    throw new Error('Invalid booking date/time.');
                }
                if (bookingDateTime.getTime() <= Date.now()) {
                    throw new Error('Booking time must be in the future.');
                }
                endpoint = '/api/owner/bookings';
                payload = {
                    restaurantId,
                    name: trimmedName,
                    phone: normalizedPhone,
                    guests: normalizedPaxCount,
                    bookingDateTime: bookingDateTime.toISOString(),
                    occasion: String(bookingOccasion || '').trim(),
                };
            }

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.message || `Failed to ${isBookingMode ? 'book table' : 'join waitlist'}`);
            }

            setWaitlistToken(data?.waitlistToken || '');
            setArrivalCode(data?.arrivalCode || '');
            setEntryId(data?.entryId || '');
            setQueueStatus('pending');
            if (isBookingMode && typeof window !== 'undefined') {
                window.localStorage.removeItem(getWaitlistStorageKey(restaurantId));
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

    const statusUnavailable = !restaurantData || Boolean(statusError);
    const isOpen = !statusUnavailable && restaurantData?.isOpen !== false;
    const isWaitlistEnabled = !statusUnavailable && restaurantData?.services?.waitlist === true;
    const restaurantName = restaurantData?.name || 'Restaurant';
    const noShowTimeoutMinutes = Math.max(1, Number(restaurantData?.waitlistNoShowTimeoutMinutes || 10));
    const arrivalUrl = (mode !== 'booking' && entryId && arrivalCode && typeof window !== 'undefined')
        ? `${window.location.origin}/public/waitlist-arrive?rid=${encodeURIComponent(restaurantId)}&eid=${encodeURIComponent(entryId)}&c=${encodeURIComponent(arrivalCode)}`
        : '';
    const tokenWithoutHash = String(waitlistToken || '').replace(/^#/, '');
    const tokenParts = tokenWithoutHash.match(/^(\d+)([A-Z]{2})$/);
    const tokenNumberPart = tokenParts?.[1] || tokenWithoutHash;
    const tokenAlphaPart = tokenParts?.[2] || '';
    const coinTokenNumberPart = (() => {
        const numeric = Number.parseInt(String(tokenNumberPart || ''), 10);
        return Number.isFinite(numeric) ? String(numeric) : String(tokenNumberPart || '');
    })();
    const isSeated = queueStatus === 'seated';
    const queueStatusLabelMap = {
        pending: 'Waiting',
        ready_to_notify: 'Ready to Notify',
        notified: 'Notified',
        arrived: 'Arrived',
        seated: 'Seated',
        cancelled: 'Cancelled',
        no_show: 'No Show',
    };
    const queueStatusChipClassMap = {
        pending: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
        ready_to_notify: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
        notified: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
        arrived: 'bg-purple-500/10 text-purple-600 border-purple-500/30',
        seated: 'bg-green-500/10 text-green-600 border-green-500/30',
        cancelled: 'bg-red-500/10 text-red-600 border-red-500/30',
        no_show: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
    };
    const queueStatusLabel = queueStatusLabelMap[queueStatus] || 'Waiting';

    if (success) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="w-full max-w-md"
                >
                    <Card className={cn("text-center p-6 border-2 bg-card shadow-2xl overflow-hidden relative", isSeated ? "border-green-500/30" : "border-primary/20")}>
                        {isSeated && (
                            <>
                                <div className="seated-confetti confetti-a" />
                                <div className="seated-confetti confetti-b" />
                                <div className="seated-confetti confetti-c" />
                                <div className="seated-confetti confetti-d" />
                                <style jsx global>{`
                                    @keyframes pop-burst {
                                        0% { transform: translateY(0) scale(0.8); opacity: 0; }
                                        20% { opacity: 1; }
                                        100% { transform: translateY(-110px) scale(1.2); opacity: 0; }
                                    }
                                    .seated-confetti {
                                        position: absolute;
                                        width: 10px;
                                        height: 10px;
                                        border-radius: 9999px;
                                        bottom: 30px;
                                        opacity: 0;
                                        z-index: 2;
                                        animation: pop-burst 1.4s ease-out infinite;
                                    }
                                    .confetti-a { left: 18%; background: #facc15; animation-delay: 0s; }
                                    .confetti-b { left: 36%; background: #22c55e; animation-delay: 0.2s; }
                                    .confetti-c { right: 30%; background: #38bdf8; animation-delay: 0.4s; }
                                    .confetti-d { right: 12%; background: #fb7185; animation-delay: 0.6s; }
                                `}</style>
                            </>
                        )}
                        <div className="mb-6 flex justify-center">
                            <div className={cn("h-20 w-20 rounded-full flex items-center justify-center", isSeated ? "bg-green-500/15" : "bg-primary/10")}>
                                {isSeated ? (
                                    <PartyPopper className="h-11 w-11 text-green-600 animate-pulse" />
                                ) : (
                                    <CheckCircle2 className="h-12 w-12 text-primary animate-pulse" />
                                )}
                            </div>
                        </div>
                        <CardTitle className="text-3xl font-black mb-2 tracking-tight">
                            {isSeated
                                ? `Welcome to ${restaurantName}!`
                                : (mode === 'booking' ? 'Booking Requested!' : "You're on the list!")}
                        </CardTitle>
                        <CardDescription className="text-lg mb-6 text-center">
                            {isSeated
                                ? <>Now you are seated. Enjoy your day and have a great time.</>
                                : mode === 'booking'
                                ? <>We&apos;ve received your booking request at <strong className="text-primary">{restaurantName}</strong> for <strong>{paxCount}</strong> guests.</>
                                : <>We will call and WhatsApp you as soon as your table at <strong className="text-primary">{restaurantName}</strong> for <strong>{paxCount}</strong> guests is ready.</>}
                        </CardDescription>
                        {mode !== 'booking' && (
                            <div className="mb-4 flex justify-center">
                                <span className={cn(
                                    "inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide",
                                    queueStatusChipClassMap[queueStatus] || 'bg-muted text-muted-foreground border-border'
                                )}>
                                    Status: {queueStatusLabel}
                                </span>
                            </div>
                        )}
                        {!isSeated && mode !== 'booking' && waitlistToken && (
                            <div className="mb-4 space-y-4">
                                <div className="flex flex-col items-center gap-3">
                                    <div className="scene">
                                        <div className="anim-wrapper animate-float">
                                            <div className={cn("coin gold-theme", isCoinFlipped && 'flipped')} onClick={() => setIsCoinFlipped((prev) => !prev)}>
                                                <div className="coin-face coin-front">
                                                    <div className="texture-overlay"></div>
                                                    <div className="sheen"></div>
                                                    <svg className="rotating-text-svg" viewBox="0 0 200 200">
                                                        <path id="waitlistCoinCurve" d="M 25,100 a 75,75 0 1,1 150,0 a 75,75 0 1,1 -150,0" fill="none" />
                                                        <text>
                                                            <textPath href="#waitlistCoinCurve" startOffset="50%" textAnchor="middle">
                                                                {`${String(restaurantName || 'RESTAURANT').toUpperCase()} LIVE WAITLIST`}
                                                            </textPath>
                                                        </text>
                                                    </svg>
                                                    <div className="token-label">TOKEN</div>
                                                    <div className="token-number">
                                                        <span className="token-number-main">{coinTokenNumberPart}</span>
                                                        <span className="token-number-sub">{tokenAlphaPart}</span>
                                                    </div>
                                                </div>
                                                <div className="coin-face coin-back">
                                                    <div className="texture-overlay"></div>
                                                    <div className="sheen"></div>
                                                    <div className="qr-box">
                                                        <QRCode value={arrivalUrl || waitlistToken} size={120} level="H" bgColor="transparent" fgColor="#3e2800" />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-xs text-muted-foreground">Tap coin to flip. Show token at counter.</div>
                                </div>
                            </div>
                        )}
                        {!isSeated && (
                            <div className="bg-muted p-4 rounded-xl mb-6 text-left">
                                <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-1">Notice</p>
                                <p className="text-sm">Please stay nearby. You will be considered late after {noShowTimeoutMinutes} minutes of notification.</p>
                            </div>
                        )}
                        {isSeated ? (
                            <Button
                                className="w-full h-12 text-lg font-bold"
                                onClick={() => {
                                    if (typeof window !== 'undefined') {
                                        window.localStorage.removeItem(getWaitlistStorageKey(restaurantId));
                                        window.history.back();
                                    }
                                }}
                            >
                                <ArrowLeft className="h-5 w-5 mr-2" /> Back
                            </Button>
                        ) : (
                            <Button className="w-full h-12 text-lg font-bold" onClick={() => window.location.reload()}>
                                Close
                            </Button>
                        )}
                    </Card>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background flex flex-col p-4 md:justify-center md:items-center">
            <header className="mb-8 md:text-center pt-8 md:pt-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 mb-3">
                    <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                    <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Live Queue</span>
                </div>
                <h1 className="text-4xl font-black tracking-tight mb-2 uppercase italic text-primary">{restaurantName}</h1>
                <p className="text-muted-foreground font-medium underline underline-offset-4 decoration-primary/30">Join Our Waitlist</p>
            </header>

            <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="w-full max-w-md"
            >
                <Card className={cn("border-border shadow-2xl bg-card overflow-hidden transition-all duration-500", (statusUnavailable || !isOpen || !isWaitlistEnabled) && "opacity-90 grayscale-[0.5]")}>
                    <CardHeader className="space-y-1 bg-muted/30 border-b border-border/50">
                        <CardTitle className="text-2xl font-black uppercase tracking-tight">Guest Details</CardTitle>
                        <CardDescription className="font-medium">Secure your spot in the queue.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        {(statusUnavailable || !isOpen || !isWaitlistEnabled) ? (
                            <div className="py-8 text-center space-y-4">
                                <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-2">
                                    <AlertCircle size={32} />
                                </div>
                                <h3 className="text-xl font-bold uppercase tracking-tight">
                                    {statusUnavailable ? 'Status Unavailable' : (!isOpen ? 'Restaurant is Closed' : 'Waitlist is Full/Disabled')}
                                </h3>
                                <p className="text-muted-foreground text-sm px-4">
                                    {statusUnavailable
                                        ? statusError
                                        : !isOpen
                                        ? "Sorry, we aren't accepting waitlist entries right now because the restaurant is closed. Please check back during business hours."
                                        : "We are currently not accepting new waitlist entries. Please check with the host at the restaurant."}
                                </p>
                            </div>
                        ) : (
                            <form id="waitlist-form" onSubmit={handleSubmit} className="space-y-5">
                                <div className="grid grid-cols-2 gap-2">
                                    <Button
                                        type="button"
                                        variant={mode === 'waitlist' ? 'default' : 'outline'}
                                        className="h-10"
                                        onClick={() => setMode('waitlist')}
                                        disabled={loading}
                                    >
                                        Join Now
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={mode === 'booking' ? 'default' : 'outline'}
                                        className="h-10"
                                        onClick={() => setMode('booking')}
                                        disabled={loading}
                                    >
                                        Book for Later
                                    </Button>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="name" className="text-xs font-black uppercase tracking-widest text-primary">Your Name</Label>
                                    <div className="relative group">
                                        <User className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                        <Input
                                            id="name"
                                            name="name"
                                            autoComplete="name"
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
                                            name="tel"
                                            type="tel"
                                            placeholder="9876543210"
                                            className="pl-10 h-12 bg-muted/30 focus:bg-background border-border font-bold text-lg"
                                            value={phone}
                                            inputMode="numeric"
                                            autoComplete="tel-national"
                                            maxLength={10}
                                            onChange={(e) => {
                                                const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                                                setPhone(digits);
                                            }}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="paxCount" className="text-xs font-black uppercase tracking-widest text-primary">Number of Guests</Label>
                                    <div className="relative group">
                                        <Users className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                        <Input
                                            id="paxCount"
                                            type="number"
                                            min={1}
                                            max={20}
                                            inputMode="numeric"
                                            placeholder="Enter guest count (1-20)"
                                            className="pl-10 h-12 bg-muted/30 focus:bg-background border-border font-bold text-lg"
                                            value={paxCount}
                                            onChange={(e) => {
                                                const next = e.target.value.replace(/[^\d]/g, '');
                                                if (!next) {
                                                    setPaxCount('');
                                                    return;
                                                }
                                                const parsed = Number.parseInt(next, 10);
                                                setPaxCount(String(Math.min(20, Math.max(1, parsed))));
                                            }}
                                            required
                                        />
                                    </div>
                                </div>

                                {mode === 'booking' && (
                                    <div className="space-y-2">
                                        <Label className="text-xs font-black uppercase tracking-widest text-primary">Booking Slot</Label>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <div className="relative group">
                                                <CalendarClock className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                                <Input
                                                    type="date"
                                                    className="pl-10 h-12 bg-muted/30 focus:bg-background border-border font-bold text-base"
                                                    value={bookingDate}
                                                    onChange={(e) => setBookingDate(e.target.value)}
                                                    min={new Date().toISOString().slice(0, 10)}
                                                    required={mode === 'booking'}
                                                />
                                            </div>
                                            <Input
                                                type="time"
                                                className="h-12 bg-muted/30 focus:bg-background border-border font-bold text-base"
                                                value={bookingTime}
                                                onChange={(e) => setBookingTime(e.target.value)}
                                                required={mode === 'booking'}
                                            />
                                        </div>
                                        <Input
                                            type="text"
                                            placeholder="Occasion (optional): Birthday, Anniversary, etc."
                                            className="h-12 bg-muted/30 focus:bg-background border-border font-bold text-base"
                                            value={bookingOccasion}
                                            onChange={(e) => setBookingOccasion(e.target.value)}
                                            maxLength={60}
                                        />
                                    </div>
                                )}

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
                            disabled={loading || statusUnavailable || !isOpen || !isWaitlistEnabled}
                        >
                            {loading ? (
                                <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                            ) : (
                                <>{mode === 'booking' ? 'Request Booking' : 'Join Queue'} <ArrowRight className="ml-2 h-6 w-6" /></>
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
