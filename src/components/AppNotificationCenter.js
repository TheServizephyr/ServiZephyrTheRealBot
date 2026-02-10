'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellRing, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APP_NOTIFICATION_EVENT } from '@/lib/appNotifications';
import { cn } from '@/lib/utils';

const MAX_KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_RING_MS = 2 * 60 * 1000;
const LONG_VIBRATION_PATTERN = [700, 220, 700, 220, 1200];

function now() {
    return Date.now();
}

function storageKey(scope) {
    return `servizephyr_app_notifications_${scope}`;
}

function pruneNotifications(items = []) {
    const cutoff = now() - MAX_KEEP_MS;
    return items.filter((n) => Number(n.createdAt || 0) >= cutoff);
}

export default function AppNotificationCenter({ scope = 'owner' }) {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [isAlarmPlaying, setIsAlarmPlaying] = useState(false);
    const audioRef = useRef(null);
    const stopTimerRef = useRef(null);
    const audioUnlockedRef = useRef(false);
    const beepIntervalRef = useRef(null);
    const vibrationIntervalRef = useRef(null);
    const fallbackAudioRef = useRef(null);

    const triggerVibration = () => {
        if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
        try {
            navigator.vibrate(LONG_VIBRATION_PATTERN);
        } catch (_) {
            // Ignore vibration errors
        }
    };

    const startFallbackBeep = () => {
        if (beepIntervalRef.current) return;
        const playBeep = () => {
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                const ctx = new AudioCtx();
                const oscillator = ctx.createOscillator();
                const gain = ctx.createGain();
                oscillator.type = 'sine';
                oscillator.frequency.value = 880;
                gain.gain.value = 0.25;
                oscillator.connect(gain);
                gain.connect(ctx.destination);
                oscillator.start();
                setTimeout(() => {
                    oscillator.stop();
                    ctx.close();
                }, 250);
            } catch (_) {
                // Ignore beep errors
            }
        };
        playBeep();
        beepIntervalRef.current = setInterval(playBeep, 1200);
    };

    const startVibrationLoop = () => {
        if (vibrationIntervalRef.current) return;
        triggerVibration();
        vibrationIntervalRef.current = setInterval(() => {
            triggerVibration();
        }, 5000);
    };

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const raw = localStorage.getItem(storageKey(scope));
            const parsed = raw ? JSON.parse(raw) : [];
            const cleaned = pruneNotifications(Array.isArray(parsed) ? parsed : []);
            setNotifications(cleaned);
            localStorage.setItem(storageKey(scope), JSON.stringify(cleaned));
        } catch (_) {
            setNotifications([]);
        }
    }, [scope]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(storageKey(scope), JSON.stringify(pruneNotifications(notifications)));
        } catch (_) {
            // Ignore storage errors
        }
    }, [notifications, scope]);

    useEffect(() => {
        const unlockAudio = () => {
            if (audioUnlockedRef.current || !audioRef.current) return;
            audioRef.current.volume = 0;
            audioRef.current.play()
                .then(() => {
                    audioRef.current.pause();
                    audioRef.current.currentTime = 0;
                    audioRef.current.volume = 1;
                    audioUnlockedRef.current = true;
                })
                .catch(() => { });
        };
        window.addEventListener('pointerdown', unlockAudio, { once: true });
        return () => window.removeEventListener('pointerdown', unlockAudio);
    }, []);

    const stopAlarm = () => {
        if (stopTimerRef.current) {
            clearTimeout(stopTimerRef.current);
            stopTimerRef.current = null;
        }
        if (beepIntervalRef.current) {
            clearInterval(beepIntervalRef.current);
            beepIntervalRef.current = null;
        }
        if (vibrationIntervalRef.current) {
            clearInterval(vibrationIntervalRef.current);
            vibrationIntervalRef.current = null;
        }
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
        if (fallbackAudioRef.current) {
            fallbackAudioRef.current.pause();
            fallbackAudioRef.current.currentTime = 0;
            fallbackAudioRef.current = null;
        }
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate(0);
        }
        setIsAlarmPlaying(false);
    };

    const markAllRead = () => {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    };

    const handleBellClick = () => {
        setIsOpen((prev) => !prev);
        markAllRead();
        stopAlarm();
    };

    useEffect(() => {
        const handleIncoming = (event) => {
            const payload = event?.detail || {};
            if ((payload.scope || 'owner') !== scope) return;

            const createdAt = now();
            const dedupeKey = payload.dedupeKey || null;
            const id = `${createdAt}_${Math.random().toString(36).slice(2, 8)}`;

            setNotifications((prev) => {
                const cleaned = pruneNotifications(prev);
                if (dedupeKey) {
                    const duplicate = cleaned.find(
                        (n) => !n.read && n.dedupeKey === dedupeKey
                    );
                    if (duplicate) return cleaned;
                }
                return [
                    {
                        id,
                        title: payload.title || 'New Notification',
                        message: payload.message || '',
                        sound: payload.sound || '',
                        dedupeKey,
                        read: false,
                        createdAt
                    },
                    ...cleaned
                ].slice(0, 200);
            });

            const soundPath = payload.sound;
            startVibrationLoop();

            // If app is in background, also raise OS-level local notification (requires permission).
            if (typeof document !== 'undefined' && document.hidden && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                const title = payload.title || 'New Notification';
                const body = payload.message || '';
                const tag = payload.dedupeKey || `servizephyr_${scope}`;
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.getRegistration().then((reg) => {
                        if (reg) {
                            reg.showNotification(title, {
                                body,
                                tag,
                                renotify: true,
                                requireInteraction: true,
                                vibrate: LONG_VIBRATION_PATTERN
                            });
                        } else {
                            // Fallback if service worker not available
                            new Notification(title, { body, tag });
                        }
                    }).catch(() => { });
                } else {
                    new Notification(title, { body, tag });
                }
            }

            if (!soundPath || !audioRef.current) return;

            try {
                stopAlarm();
                startVibrationLoop();
                audioRef.current.src = soundPath;
                audioRef.current.load();
                audioRef.current.muted = false;
                audioRef.current.volume = 1;
                audioRef.current.loop = true;
                audioRef.current.play().then(() => {
                    setIsAlarmPlaying(true);
                    stopTimerRef.current = setTimeout(() => {
                        stopAlarm();
                    }, MAX_RING_MS);
                }).catch(() => {
                    try {
                        // Second attempt with fresh Audio() instance for stricter autoplay/decode paths.
                        const fallbackAudio = new Audio(soundPath);
                        fallbackAudio.loop = true;
                        fallbackAudio.volume = 1;
                        fallbackAudioRef.current = fallbackAudio;
                        fallbackAudio.play().then(() => {
                            setIsAlarmPlaying(true);
                            stopTimerRef.current = setTimeout(() => {
                                stopAlarm();
                            }, MAX_RING_MS);
                        }).catch(() => {
                            // Browser blocked autoplay / decode issue -> fallback alarm
                            startFallbackBeep();
                            setIsAlarmPlaying(true);
                            stopTimerRef.current = setTimeout(() => {
                                stopAlarm();
                            }, MAX_RING_MS);
                        });
                    } catch (_) {
                        startFallbackBeep();
                        setIsAlarmPlaying(true);
                        stopTimerRef.current = setTimeout(() => {
                            stopAlarm();
                        }, MAX_RING_MS);
                    }
                });
            } catch (_) {
                startFallbackBeep();
                setIsAlarmPlaying(true);
                stopTimerRef.current = setTimeout(() => {
                    stopAlarm();
                }, MAX_RING_MS);
            }
        };

        window.addEventListener(APP_NOTIFICATION_EVENT, handleIncoming);
        return () => {
            window.removeEventListener(APP_NOTIFICATION_EVENT, handleIncoming);
            stopAlarm();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope]);

    useEffect(() => {
        if (typeof window === 'undefined' || !('Notification' in window)) return;
        const requestPermission = () => {
            if (Notification.permission === 'default') {
                Notification.requestPermission().catch(() => { });
            }
        };
        window.addEventListener('pointerdown', requestPermission, { once: true });
        return () => window.removeEventListener('pointerdown', requestPermission);
    }, []);

    const unreadCount = useMemo(
        () => notifications.filter((n) => !n.read).length,
        [notifications]
    );

    return (
        <div className="relative flex items-center gap-2">
            <audio ref={audioRef} preload="auto" className="hidden" />

            <Button
                variant="ghost"
                size="icon"
                className={cn(
                    'relative',
                    unreadCount > 0 && 'animate-pulse'
                )}
                onClick={handleBellClick}
                title="Notifications"
            >
                {unreadCount > 0 ? <BellRing size={20} /> : <Bell size={20} />}
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </Button>

            <Button
                variant={isAlarmPlaying ? 'destructive' : 'outline'}
                size="icon"
                onClick={stopAlarm}
                title={isAlarmPlaying ? 'Stop Alarm' : 'Alarm Stopped'}
            >
                {isAlarmPlaying ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </Button>

            {isOpen && (
                <div className="absolute right-0 top-12 z-[120] w-80 max-h-96 overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                        <p className="text-sm font-semibold">Notifications</p>
                        <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)}><X size={16} /></Button>
                    </div>
                    <div className="p-2 space-y-2">
                        {notifications.length === 0 && (
                            <p className="text-xs text-muted-foreground p-2">No notifications in last 24 hours.</p>
                        )}
                        {notifications.map((n) => (
                            <div key={n.id} className={cn('rounded-lg border p-2', n.read ? 'border-border' : 'border-primary/40 bg-primary/5')}>
                                <p className="text-xs font-semibold">{n.title}</p>
                                {n.message && <p className="text-xs text-muted-foreground mt-1">{n.message}</p>}
                                <p className="text-[10px] text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
