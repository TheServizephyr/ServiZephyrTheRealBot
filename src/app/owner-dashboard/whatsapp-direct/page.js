'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Archive, MessageSquare, Send, Paperclip, Loader2, ArrowLeft, Image as ImageIcon, X, Tag, Star, AlertTriangle, ThumbsUp, LogOut, Check, CheckCheck, Mic, Trash2, Edit2, Save, User, Calendar as CalendarIcon, DollarSign, ShoppingBag, MoreVertical, Gift, Ticket, Wand2 } from 'lucide-react';
import Image from 'next/image';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { useSearchParams } from 'next/navigation';
import InfoDialog from '@/components/InfoDialog';
import { format, isToday, isYesterday } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from "@/components/ui/calendar";
import CustomAudioPlayer from '@/components/CustomAudioPlayer';
import { useToast } from "@/components/ui/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export const dynamic = 'force-dynamic';

const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (isToday(date)) return format(date, 'p');
    if (isYesterday(date)) return 'Yesterday';
    return format(date, 'dd/MM/yyyy');
};

const getInitials = (name) => {
    return name
        ?.split(' ')
        .map(n => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase() || '?';
};

const tagConfig = {
    'Urgent': { icon: AlertTriangle, color: 'text-red-500' },
    'Feedback': { icon: Star, color: 'text-yellow-500' },
    'Complaint': { icon: AlertTriangle, color: 'text-orange-500' },
    'Resolved': { icon: ThumbsUp, color: 'text-green-500' },
};

const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};


const ConversationItem = ({ conversation, active, onClick }) => {
    const TagIcon = tagConfig[conversation.tag]?.icon;

    // Get appropriate icon based on last message type
    const getMessageIcon = (type) => {
        if (type === 'image') return <ImageIcon size={14} className="inline mr-1" />;
        if (type === 'video') return <span className="text-xs mr-1">🎥</span>;
        if (type === 'document') return <span className="text-xs mr-1">📄</span>;
        if (type === 'audio') return <span className="text-xs mr-1">🎵</span>;
        return null;
    };

    return (
        <div
            onClick={() => onClick(conversation)}
            className={cn(
                'flex items-center p-3 cursor-pointer transition-colors border-b border-border/40 hover:bg-muted/50',
                active ? 'bg-muted' : ''
            )}
        >
            <div className="relative mr-3 flex-shrink-0">
                <Avatar className="h-12 w-12 border border-border/10">
                    <AvatarImage src="" alt={conversation.customerName} />
                    <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
                        {getInitials(conversation.customerName)}
                    </AvatarFallback>
                </Avatar>
                {conversation.unreadCount > 0 && <span className="absolute bottom-0 right-0 bg-green-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold z-10">{conversation.unreadCount}</span>}
            </div>
            <div className="flex-grow overflow-hidden">
                <div className="flex justify-between items-center mb-1">
                    <h3 className="font-medium text-foreground truncate text-base">{conversation.customerName}</h3>
                    <p className="text-[11px] text-muted-foreground flex-shrink-0 ml-2">{formatTimestamp(conversation.lastMessageTimestamp)}</p>
                </div>
                <div className="flex justify-between items-center">
                    <p className="text-sm text-muted-foreground truncate flex items-center h-5">
                        {getMessageIcon(conversation.lastMessageType)}
                        <span className="truncate">{conversation.lastMessage}</span>
                    </p>
                    {conversation.tag && TagIcon && (
                        <TagIcon size={14} className={cn('flex-shrink-0 ml-1', tagConfig[conversation.tag].color)} />
                    )}
                </div>
            </div>
        </div>
    );
};



const MessageBubble = React.memo(({ message }) => {
    const timestamp = message.timestamp?.seconds ? new Date(message.timestamp.seconds * 1000) : new Date(message.timestamp);
    const isOwner = message.sender === 'owner';
    const isSystem = message.sender === 'system';

    if (isSystem) {
        return (
            <div className="flex justify-end mb-1">
                <div className="max-w-xs lg:max-w-md px-1 py-1 shadow-sm rounded-lg bg-[#fff5c4] dark:bg-yellow-900/20 text-black dark:text-yellow-200 rounded-tr-none border border-yellow-200/50">
                    <p className="px-2 pt-1 pb-1 text-sm flex items-start gap-2">
                        <span className="opacity-70 mt-0.5">ℹ️</span> <span>{message.text}</span>
                    </p>
                    <div className="text-[10px] px-2 pb-1 flex items-center justify-end gap-1 text-black/60 dark:text-yellow-200/60">
                        <span>{format(timestamp, 'p')}</span>
                        <span>
                            <CheckCheck size={14} className="text-[#53bdeb]" />
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    const renderContent = () => {
        // Image
        if (message.type === 'image' && message.mediaUrl) {
            // eslint-disable-next-line react-hooks/rules-of-hooks
            const [imageError, setImageError] = useState(false);

            if (imageError) {
                return (
                    <div className="p-4 bg-muted/50 rounded-lg flex flex-col items-center justify-center min-w-[200px] text-muted-foreground">
                        <AlertTriangle size={24} className="mb-2 opacity-50" />
                        <span className="text-xs font-medium">Image Expired</span>
                    </div>
                );
            }

            return (
                <div className="p-1">
                    <a href={message.mediaUrl} target="_blank" rel="noopener noreferrer">
                        <Image
                            src={message.mediaUrl}
                            alt="Chat image"
                            width={250}
                            height={250}
                            className="rounded-lg cursor-pointer"
                            unoptimized={true}
                            onError={() => setImageError(true)}
                        />
                    </a>
                </div>
            );
        }

        // Video
        if (message.type === 'video' && message.mediaUrl) {
            return (
                <div className="p-1">
                    <video controls className="rounded-lg max-w-full" style={{ maxHeight: '300px' }}>
                        <source src={message.mediaUrl} type="video/mp4" />
                        Your browser does not support video playback.
                    </video>
                    {message.fileName && <p className="text-xs mt-1 opacity-70">{message.fileName}</p>}
                </div>
            );
        }

        // Audio
        if (message.type === 'audio' && message.mediaUrl) {
            return (
                <div className="p-2 w-full max-w-xs">
                    <CustomAudioPlayer
                        src={message.mediaUrl}
                        fileName="Voice Message"
                        className={isOwner ? "bg-transparent text-primary-foreground" : "bg-transparent text-foreground"}
                    />
                </div>
            );
        }

        // Document
        if (message.type === 'document' && message.mediaUrl) {
            const fileExt = message.fileName?.split('.').pop()?.toLowerCase() || 'file';
            let icon = '📄';
            if (fileExt === 'pdf') icon = '📕';
            else if (['doc', 'docx'].includes(fileExt)) icon = '📘';
            else if (['xls', 'xlsx'].includes(fileExt)) icon = '📊';

            return (
                <div className="p-3">
                    <a
                        href={message.mediaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                    >
                        <span className="text-3xl">{icon}</span>
                        <div>
                            <p className="font-medium text-sm">{message.fileName || 'Document'}</p>
                            <p className="text-xs opacity-70">Click to open</p>
                        </div>
                    </a>
                </div>
            );
        }

        // Text (default)
        return <p className="px-2 pt-1 pb-1 text-sm">{message.text}</p>;
    };

    return (
        <div className={`flex ${isOwner ? 'justify-end' : 'justify-start'} mb-1`}>
            <div className={`max-w-xs lg:max-w-md px-1 py-1 shadow-sm rounded-lg ${isOwner ? 'bg-[#d9fdd3] text-black rounded-tr-none' : 'bg-white text-black rounded-tl-none'}`}>
                {renderContent()}
                <div className={`text-[10px] px-2 pb-1 flex items-center justify-end gap-1 ${isOwner ? 'text-black/60' : 'text-gray-500'}`}>
                    <span>{format(timestamp, 'p')}</span>
                    {isOwner && (
                        <span>
                            {message.status === 'read' ? (
                                <CheckCheck size={14} className="text-[#53bdeb]" />
                            ) : message.status === 'delivered' ? (
                                <CheckCheck size={14} className="text-gray-400" />
                            ) : (
                                <Check size={14} className="text-gray-400" />
                            )}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
});


const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, description }) => (
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="bg-card border-border text-foreground">
            <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button variant="destructive" onClick={onConfirm}>Confirm End Chat</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
);


const CouponModal = ({ isOpen, setIsOpen, onSave, customer }) => {
    const [coupon, setCoupon] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [modalError, setModalError] = useState('');

    useEffect(() => {
        if (isOpen && customer) {
            setModalError('');
            setCoupon({
                code: '',
                description: `Special reward for ${customer.name}`,
                type: 'flat',
                value: '',
                minOrder: '',
                startDate: new Date(),
                expiryDate: new Date(new Date().setDate(new Date().getDate() + 30)),
                status: 'Active',
                customerId: customer.id, // Associate coupon with customer
            });
        }
    }, [isOpen, customer]);

    if (!coupon) return null;

    const handleChange = (field, value) => {
        setCoupon(prev => (prev ? { ...prev, [field]: value } : null));
    };

    const generateRandomCode = () => {
        const code = `VIP-${customer.name.split(' ')[0].toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        handleChange('code', code);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setModalError('');
        if (!coupon.code || !coupon.value || !coupon.minOrder) {
            setModalError("Please fill all fields to create a reward.");
            return;
        }

        setIsSaving(true);
        try {
            await onSave(coupon);
            setIsOpen(false);
        } catch (error) {
            setModalError("Failed to save reward: " + error.message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-lg bg-card border-border text-foreground">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-xl">
                            <Ticket /> Create a Reward
                        </DialogTitle>
                        <DialogDescription>Sending a special reward to {customer.name}.</DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-y-4 py-6">
                        <div>
                            <Label htmlFor="code">Coupon Code</Label>
                            <div className="flex items-center gap-2 mt-1">
                                <input id="code" value={coupon.code} onChange={e => handleChange('code', e.target.value.toUpperCase())} placeholder="e.g., SAVE20" className="p-2 border rounded-md bg-input border-border w-full" />
                                <Button type="button" variant="outline" onClick={generateRandomCode}><Wand2 size={16} className="mr-2" /> Generate</Button>
                            </div>
                        </div>
                        <div>
                            <Label htmlFor="description">Description</Label>
                            <textarea id="description" value={coupon.description} onChange={e => handleChange('description', e.target.value)} rows={2} placeholder="e.g., A special thanks for being a loyal customer." className="mt-1 p-2 border rounded-md bg-input border-border w-full" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="value">Discount Value (₹ or %)</Label>
                                <input id="value" type="number" value={coupon.value} onChange={e => handleChange('value', e.target.value)} placeholder="e.g., 100 or 20" className="mt-1 p-2 border rounded-md bg-input border-border w-full" />
                            </div>
                            <div>
                                <Label htmlFor="minOrder">Minimum Order (₹)</Label>
                                <input id="minOrder" type="number" value={coupon.minOrder} onChange={e => handleChange('minOrder', e.target.value)} placeholder="e.g., 500" className="mt-1 p-2 border rounded-md bg-input border-border w-full" />
                            </div>
                        </div>
                        <div>
                            <Label>Expiry Date</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal mt-1", !coupon.expiryDate && "text-muted-foreground")}>
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {coupon.expiryDate ? format(coupon.expiryDate, 'dd MMM yyyy') : <span>Pick a date</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={coupon.expiryDate} onSelect={(date) => handleChange('expiryDate', date)} initialFocus /></PopoverContent>
                            </Popover>
                        </div>
                    </div>
                    {modalError && <p className="text-destructive text-sm text-center">{modalError}</p>}
                    <DialogFooter className="pt-4">
                        <DialogClose asChild><Button type="button" variant="secondary" disabled={isSaving}>Cancel</Button></DialogClose>
                        <Button type="submit" className="bg-primary hover:bg-primary/90" disabled={isSaving}>
                            {isSaving ? 'Sending...' : 'Send Reward'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};


function WhatsAppDirectPageContent() {
    const [conversations, setConversations] = useState([]);
    const [messages, setMessages] = useState([]);
    const [activeConversation, setActiveConversation] = useState(null);
    const [loadingConversations, setLoadingConversations] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [newMessage, setNewMessage] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const searchParams = useSearchParams();
    const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
    const employeeOfOwnerId = searchParams.get('employee_of');
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadingFile, setUploadingFile] = useState(null);
    const [activeFilter, setActiveFilter] = useState('All');
    const [isConfirmEndChatOpen, setConfirmEndChatOpen] = useState(false);
    const [isCouponModalOpen, setCouponModalOpen] = useState(false);
    const { toast } = useToast();

    const handleSaveReward = async (couponData) => {
        const payload = {
            ...couponData,
            startDate: couponData.startDate.toISOString(),
            expiryDate: couponData.expiryDate.toISOString(),
        };
        await handleApiCall('/api/owner/coupons', 'POST', { coupon: payload });
        setInfoDialog({ isOpen: true, title: "Success!", message: `Reward coupon "${couponData.code}" created for ${activeConversation.customerName}!` });
    };

    // Profile Sidebar States
    const [showProfileInfo, setShowProfileInfo] = useState(false);
    const [customerDetails, setCustomerDetails] = useState(null);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState('');
    const [notes, setNotes] = useState('');
    const [isSavingNotes, setIsSavingNotes] = useState(false);

    const [isRecording, setIsRecording] = useState(false);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const timerRef = useRef(null);

    // NEW: Audio Engine State
    const [workerBlobUrl, setWorkerBlobUrl] = useState(null);
    const [loadingAudioEngine, setLoadingAudioEngine] = useState(true);

    const [restaurantProfile, setRestaurantProfile] = useState(null); // Store fetched profile

    // Calculate total unread count
    const totalUnreadCount = useMemo(() => {
        return conversations.reduce((acc, curr) => acc + (curr.unreadCount || 0), 0);
    }, [conversations]);

    // Pre-load Opus Worker Blob to allow synchronous Worker creation (Required by library)
    useEffect(() => {
        const loadWorker = async () => {
            try {
                // Use UMD build to avoid 'require is not defined' errors
                const res = await fetch('https://cdn.jsdelivr.net/npm/opus-media-recorder@latest/encoderWorker.umd.js');
                if (!res.ok) throw new Error(`Failed to load worker: ${res.status}`);
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                setWorkerBlobUrl(url);
                setLoadingAudioEngine(false);
                console.log("Audio Engine Loaded Successfully 🎧");
            } catch (error) {
                console.error("Failed to load Audio Engine Worker:", error);
                setLoadingAudioEngine(false);
            }
        };
        loadWorker();

        return () => {
            // Cleanup blob url on unmount
            if (workerBlobUrl) URL.revokeObjectURL(workerBlobUrl);
        };
    }, []);



    const scrollToBottom = () => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }

    // Auto-scroll when messages update or conversation changes
    useEffect(() => {
        // Immediate scroll for new messages or conversation switch
        scrollToBottom();

        // Safety timeout for image loading/layout shifts
        const timeoutId = setTimeout(scrollToBottom, 300);
        return () => clearTimeout(timeoutId);
    }, [messages, activeConversation?.id, loadingMessages]);

    const startRecording = async () => {
        // Prevent recording if engine is not ready
        if (loadingAudioEngine) {
            setInfoDialog({ isOpen: true, title: "Please Wait", message: "Audio engine is loading..." });
            return;
        }
        if (!workerBlobUrl) {
            setInfoDialog({ isOpen: true, title: "Error", message: "Audio engine failed to load. Please refresh the page." });
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Use OpusMediaRecorder Polyfill to force OGG/Opus (WhatsApp Compatible)
            // Dynamic import to avoid SSR issues
            const OpusMediaRecorder = (await import('opus-media-recorder')).default;

            const workerOptions = {
                encoderWorkerFactory: () => {
                    // SYNC RETURN: Use the pre-loaded blob URL to create the worker synchronously
                    return new Worker(workerBlobUrl);
                },
                OggOpusEncoderWasmPath: 'https://cdn.jsdelivr.net/npm/opus-media-recorder@latest/OggOpusEncoder.wasm',
                WebMOpusEncoderWasmPath: 'https://cdn.jsdelivr.net/npm/opus-media-recorder@latest/WebMOpusEncoder.wasm'
            };

            const mediaRecorder = new OpusMediaRecorder(stream, { mimeType: 'audio/ogg' }, workerOptions);
            const mimeType = 'audio/ogg';

            console.log("Initialized OpusMediaRecorder with Valid OGG/Opus (Sync Factory)");

            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    // console.log(`[Recording] Chunk received: ${event.data.size} bytes`);
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.start();
            setIsRecording(true);
            setRecordingDuration(0);

            timerRef.current = setInterval(() => {
                setRecordingDuration(prev => prev + 1);
            }, 1000);

        } catch (error) {
            console.error("Error accessing microphone:", error);

            let errorMessage = "Could not access microphone.";
            let errorTitle = "Microphone Error";

            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                errorTitle = "Permission Denied";
                errorMessage = (
                    <div className="text-left text-sm space-y-2">
                        <p><strong>Microphone access is blocked.</strong></p>
                        <p>Since this is a Web App (PWA), permissions are controlled by your browser, not Android Settings.</p>
                        <p className="font-semibold text-primary mt-2">How to Fix:</p>
                        <ol className="list-decimal pl-5 space-y-1">
                            <li>Open <strong>Chrome Browser</strong></li>
                            <li>Tap Top-Right Menu (⋮) &gt; <strong>Settings</strong></li>
                            <li>Go to <strong>Site Settings</strong> &gt; <strong>Microphone</strong></li>
                            <li>Find this app/site and tap <strong>Allow</strong></li>
                            <li>Come back here and try again.</li>
                        </ol>
                    </div>
                );
            }

            setInfoDialog({ isOpen: true, title: errorTitle, message: errorMessage });
        }
    };

    const stopRecording = (shouldSend = true) => {
        if (mediaRecorderRef.current && isRecording) {
            const mimeType = mediaRecorderRef.current.mimeType; // Get actual used mime type
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current.onstop = () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

                // Stop all tracks
                mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());

                if (shouldSend) {
                    // FORCE OGG STRATEGY:
                    // Chrome records WebM/Opus. WhatsApp wants OGG/Opus.
                    // Renaming .webm -> .ogg acts as a container masquerade that works for WhatsApp Voice Notes.

                    let ext = 'ogg';
                    let finalMime = 'audio/ogg';

                    // Only use other formats if explicitly not webm/opus
                    if (mimeType.includes('mp4') && !mimeType.includes('opus')) {
                        ext = 'mp4';
                        finalMime = mimeType;
                    } else if (mimeType.includes('wav')) {
                        ext = 'wav';
                        finalMime = mimeType;
                    }

                    const audioFile = new File([audioBlob], `voice_note_${Date.now()}.${ext}`, { type: finalMime });
                    handleFileUpload(audioFile);
                }

                // Cleanup
                setIsRecording(false);
                setRecordingDuration(0);
                clearInterval(timerRef.current);
            };
        }
    };

    const cancelRecording = () => {
        stopRecording(false);
    };

    const handleApiCall = useCallback(async (endpoint, method = 'GET', body = null) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();

        let url = new URL(endpoint, window.location.origin);
        if (impersonatedOwnerId) {
            url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        } else if (employeeOfOwnerId) {
            url.searchParams.append('employee_of', employeeOfOwnerId);
        }
        if (method === 'GET' && body) {
            Object.keys(body).forEach(key => url.searchParams.append(key, body[key]));
        }

        const res = await fetch(url.toString(), {
            method,
            headers: {
                'Authorization': `Bearer ${idToken}`,
                ...(method !== 'GET' && { 'Content-Type': 'application/json' }),
            },
            body: method !== 'GET' ? JSON.stringify(body) : undefined,
        });

        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            console.error(`[API Error] Non-JSON response from ${endpoint}:`, text.slice(0, 500));
            throw new Error(`API Error (${res.status}): Server returned invalid response.`);
        }

        if (!res.ok) throw new Error(data.message || 'API call failed');
        return data;
    }, [impersonatedOwnerId, employeeOfOwnerId]); // Stable reference

    // Fetch Restaurant Profile (Logo, Name)
    useEffect(() => {
        const fetchProfile = async () => {
            try {
                const data = await handleApiCall('/api/owner/settings');
                setRestaurantProfile(data);
            } catch (error) {
                console.error("Failed to load restaurant profile:", error);
            }
        };
        if (auth.currentUser) {
            fetchProfile();
        }
    }, [handleApiCall]);

    const fetchConversations = useCallback(async (isBackgroundRefresh = false) => {
        if (!isBackgroundRefresh) {
            setLoadingConversations(true);
        }
        try {
            const data = await handleApiCall('/api/owner/whatsapp-direct/conversations');
            setConversations(data.conversations || []);
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not load conversations: ' + error.message });
        } finally {
            if (!isBackgroundRefresh) setLoadingConversations(false);
        }
    }, [handleApiCall]); // Stable reference with handleApiCall dependency

    const fetchMessages = useCallback(async (conversationId) => {
        try {
            const data = await handleApiCall('/api/owner/whatsapp-direct/messages', 'GET', { conversationId });
            setMessages(data.messages || []);
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not load messages: ' + error.message });
        } finally {
            setLoadingMessages(false);
        }
    }, [handleApiCall]); // Stable reference with handleApiCall dependency

    // Real-time listener for conversations
    useEffect(() => {
        const user = auth.currentUser;
        if (!user) {
            setLoadingConversations(false);
            return;
        }

        // ALWAYS USE API - Cost optimization (no direct Firestore reads)
        // Real-time listeners consume massive quota, API polling is cheaper
        console.log('[WhatsApp] Using API polling for all users (cost optimization)');
        fetchConversations();
        const interval = setInterval(() => fetchConversations(true), 30000); // Poll every 30s
        return () => {
            console.log('[WhatsApp] Cleaning up polling interval');
            clearInterval(interval);
        };
    }, [fetchConversations]);

    // Real-time listener for messages in active conversation
    useEffect(() => {
        if (!activeConversation) {
            setMessages([]);
            return;
        }

        console.log('[WhatsApp] Subscribing to real-time messages for:', activeConversation.id);
        setLoadingMessages(true);

        const fetchAndMarkRead = async () => {
            try {
                const data = await handleApiCall('/api/owner/whatsapp-direct/messages', 'GET', { conversationId: activeConversation.id });
                const msgs = data.messages || [];
                setMessages(msgs);

                // Identify unread customer messages
                const unreadMessageIds = msgs
                    .filter(m => m.sender === 'customer' && m.status !== 'read')
                    .map(m => m.id);

                if (unreadMessageIds.length > 0) {
                    console.log('[WhatsApp] Marking messages as read:', unreadMessageIds);
                    // Fire and forget - don't await to avoid blocking UI
                    handleApiCall('/api/owner/whatsapp-direct/messages', 'PATCH', {
                        conversationId: activeConversation.id,
                        messageIds: unreadMessageIds
                    }).catch(err => console.error("Failed to mark messages as read:", err));
                }

            } catch (error) {
                console.error("Error fetching messages:", error);
            } finally {
                setLoadingMessages(false);
            }
        };

        fetchAndMarkRead();
        const interval = setInterval(fetchAndMarkRead, 3000); // Poll every 3s

        return () => {
            console.log('[WhatsApp] Cleaning up messages polling interval');
            clearInterval(interval);
        };
    }, [activeConversation, handleApiCall]);

    const handleConversationClick = async (conversation) => {
        setActiveConversation(conversation);
        setLoadingMessages(true);
        setMessages([]);
        await fetchMessages(conversation.id);
    };

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || !activeConversation) return;

        setIsSending(true);
        const optimisticMessage = { id: 'temp-' + Date.now(), text: newMessage, sender: 'owner', timestamp: new Date().toISOString() };
        setMessages(prev => [...prev, optimisticMessage]);
        const messageToSend = newMessage;
        setNewMessage('');

        try {
            await handleApiCall('/api/owner/whatsapp-direct/messages', 'POST', {
                conversationId: activeConversation.id,
                text: messageToSend
            });
            await fetchMessages(activeConversation.id);
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Failed to send message: ' + error.message });
            setMessages(prev => prev.filter(m => m.id !== optimisticMessage.id));
        } finally {
            setIsSending(false);
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file && activeConversation) {
            // Validate file size on frontend (25MB)
            const MAX_SIZE = 25 * 1024 * 1024;
            if (file.size > MAX_SIZE) {
                setInfoDialog({ isOpen: true, title: 'File Too Large', message: `File size exceeds 25MB limit. Please select a smaller file.` });
                if (fileInputRef.current) fileInputRef.current.value = '';
                return;
            }
            handleFileUpload(file);
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleFileUpload = async (file) => {
        if (!activeConversation) return;
        setUploadingFile(file.name);
        setUploadProgress(0);

        try {
            // Get media type from MIME type
            const mimeType = file.type;
            let mediaType = 'file';
            if (mimeType.startsWith('image/')) mediaType = 'image';
            else if (mimeType.startsWith('video/')) mediaType = 'video';
            else if (mimeType.startsWith('audio/')) mediaType = 'audio';
            else if (mimeType === 'application/pdf' || mimeType.includes('document') || mimeType.includes('sheet')) mediaType = 'document';

            const { presignedUrl, publicUrl, fileName, finalMimeType, storagePath } = await handleApiCall('/api/owner/whatsapp-direct/upload-url', 'POST', {
                fileName: file.name,
                fileType: file.type,
                fileSize: file.size
            });

            const uploadResponse = await fetch(presignedUrl, {
                method: 'PUT',
                body: file,
                headers: {
                    'Content-Type': finalMimeType || file.type, // ✅ Use strict MIME type from server
                },
            });

            if (!uploadResponse.ok) {
                const errorText = await uploadResponse.text();
                console.error("Firebase upload failed:", errorText);
                throw new Error('Failed to upload file to storage.');
            }

            // Send message with appropriate media URL
            const messagePayload = {
                conversationId: activeConversation.id,
                fileName: fileName || file.name,
                storagePath: storagePath
            };

            if (mediaType === 'image') messagePayload.imageUrl = publicUrl;
            else if (mediaType === 'video') messagePayload.videoUrl = publicUrl;
            else if (mediaType === 'document') messagePayload.documentUrl = publicUrl;
            else if (mediaType === 'audio') messagePayload.audioUrl = publicUrl;
            else messagePayload.documentUrl = publicUrl; // Fallback


            await handleApiCall('/api/owner/whatsapp-direct/messages', 'POST', messagePayload);

            await fetchMessages(activeConversation.id);

        } catch (error) {
            setInfoDialog({ isOpen: true, title: "Upload Failed", message: "Could not send file: " + error.message });
        } finally {
            setUploadingFile(null);
            setUploadProgress(0);
        }
    };

    const handleTagChange = async (tag) => {
        if (!activeConversation) return;
        const conversationId = activeConversation.id;

        const originalTag = activeConversation.tag;
        const newTag = originalTag === tag ? null : tag;

        setActiveConversation(prev => ({ ...prev, tag: newTag }));
        setConversations(prev => prev.map(c => c.id === conversationId ? { ...c, tag: newTag } : c));

        try {
            await handleApiCall('/api/owner/whatsapp-direct/conversations', 'PATCH', { conversationId, tag: newTag });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Failed to update tag: ' + error.message });
            setActiveConversation(prev => ({ ...prev, tag: originalTag }));
            setConversations(prev => prev.map(c => c.id === conversationId ? { ...c, tag: originalTag } : c));
        }
    };

    const confirmEndChat = async () => {
        if (!activeConversation) return;
        setConfirmEndChatOpen(false);

        try {
            await handleApiCall('/api/owner/whatsapp-direct/conversations', 'PATCH', {
                conversationId: activeConversation.id,
                action: 'end_chat'
            });
            setInfoDialog({ isOpen: true, title: 'Chat Ended', message: 'The chat has been ended. The customer has been asked for feedback.' });
            setActiveConversation(null);
            fetchConversations();
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not end chat: ' + error.message });
        }
    };

    // --- Customer Details Logic ---
    const fetchCustomerDetails = useCallback(async (phoneNumber) => {
        setLoadingDetails(true);
        try {
            const data = await handleApiCall(`/api/owner/whatsapp-direct/customer-details?phoneNumber=${phoneNumber}`, 'GET');
            if (data.exists) {
                setCustomerDetails(data.details);
                setNotes(data.details.notes || '');
                setEditedName(data.details.customName || activeConversation?.customerName || '');
            } else {
                setCustomerDetails(null);
                setNotes('');
                setEditedName(activeConversation?.customerName || '');
            }
        } catch (error) {
            console.error("Failed to fetch customer details:", error);
        } finally {
            setLoadingDetails(false);
        }
    }, [handleApiCall, activeConversation]);

    const handleSaveDetails = async () => {
        if (!activeConversation) return;
        setIsSavingNotes(true);
        try {
            await handleApiCall('/api/owner/whatsapp-direct/customer-details', 'PATCH', {
                phoneNumber: activeConversation.customerPhone,
                customName: editedName,
                notes: notes
            });

            // Update local state if name changed
            if (editedName !== activeConversation.customerName) {
                const updatedConvo = { ...activeConversation, customerName: editedName };
                setActiveConversation(updatedConvo);
                setConversations(prev => prev.map(c => c.id === updatedConvo.id ? { ...c, customerName: editedName } : c));
            }

            // Refresh details
            fetchCustomerDetails(activeConversation.customerPhone);
            setIsEditingName(false);

            toast({
                title: "Saved",
                description: "Customer details updated successfully.",
                duration: 3000,
                className: "bg-green-500 text-white border-none",
            });

        } catch (error) {
            toast({
                title: "Error",
                description: 'Failed to save details: ' + error.message,
                variant: "destructive",
            });
        } finally {
            setIsSavingNotes(false);
        }
    };

    useEffect(() => {
        if (activeConversation && showProfileInfo) {
            fetchCustomerDetails(activeConversation.customerPhone);
        }
    }, [activeConversation, showProfileInfo, fetchCustomerDetails]);


    // --- Profile Sidebar Component ---
    const ProfileSidebar = activeConversation ? (
        <aside className="w-[350px] bg-background border-l border-border h-full flex flex-col overflow-y-auto animate-in slide-in-from-right duration-300 shadow-xl z-30">
            <header className="p-4 flex items-center gap-4 bg-muted/40 backdrop-blur-sm sticky top-0 z-10 border-b border-border/50">
                <button onClick={() => setShowProfileInfo(false)} className="hover:bg-muted p-2 rounded-full transition-colors"><X size={20} /></button>
                <h3 className="font-medium text-lg">Contact Info</h3>
            </header>

            <div className="flex flex-col items-center p-8 border-b border-border/50 bg-card">
                <div className="relative w-32 h-32 rounded-full mb-4 shadow-md ring-4 ring-background">
                    <Image src={`https://picsum.photos/seed/${activeConversation.customerPhone}/200`} alt={activeConversation.customerName} layout="fill" className="rounded-full object-cover" />
                </div>

                <div className="text-center w-full">
                    {isEditingName ? (
                        <div className="flex items-center gap-2 justify-center mb-2">
                            <Input
                                value={editedName}
                                onChange={(e) => setEditedName(e.target.value)}
                                className="h-9 text-center font-medium max-w-[200px]"
                            />
                            <Button size="icon" variant="ghost" className="h-9 w-9 text-green-600 hover:text-green-700 hover:bg-green-50" onClick={handleSaveDetails}>
                                <Check size={18} />
                            </Button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center gap-2 group mb-1">
                            <h2 className="text-2xl font-semibold">{activeConversation.customerName}</h2>
                            <button onClick={() => { setEditedName(activeConversation.customerName); setIsEditingName(true); }} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary p-1">
                                <Edit2 size={16} />
                            </button>
                        </div>
                    )}
                    <p className="text-muted-foreground font-mono text-lg tracking-wide">+{activeConversation.customerPhone}</p>
                </div>
            </div>

            <div className="p-6 space-y-8 bg-[#f0f2f5] dark:bg-black/20 min-h-full">
                {/* Stats Grid */}
                <div className="bg-card rounded-xl p-4 shadow-sm border border-border/50">
                    <h4 className="text-xs font-semibold text-muted-foreground mb-4 uppercase tracking-wider flex items-center gap-2">
                        <ShoppingBag size={12} /> Customer Stats
                    </h4>
                    {loadingDetails ? <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div> : (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-muted/30 p-4 rounded-xl border border-border/50 transition-colors hover:bg-muted/50">
                                <div className="flex items-center gap-2 text-muted-foreground mb-2 text-sm">Orders</div>
                                <div className="text-2xl font-bold">{customerDetails?.totalOrders || 0}</div>
                            </div>
                            <div className="bg-muted/30 p-4 rounded-xl border border-border/50 transition-colors hover:bg-muted/50">
                                <div className="flex items-center gap-2 text-muted-foreground mb-2 text-sm">Total Spent</div>
                                <div className="text-2xl font-bold text-green-600">₹{customerDetails?.totalSpent?.toLocaleString() || 0}</div>
                            </div>
                            <div className="col-span-2 bg-muted/30 p-3 rounded-xl border border-border/50 flex justify-between items-center text-sm">
                                <div className="flex items-center gap-2 text-muted-foreground"><CalendarIcon size={14} /> Member Since</div>
                                <div className="font-medium">{customerDetails?.createdAt ? new Date(customerDetails.createdAt).toLocaleDateString() : 'N/A'}</div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Notes Section */}
                <div className="bg-card rounded-xl p-4 shadow-sm border border-border/50">
                    <h4 className="text-xs font-semibold text-muted-foreground mb-4 uppercase tracking-wider flex items-center gap-2">
                        <User size={12} /> Private Notes
                    </h4>
                    <div className="space-y-3">
                        <Textarea
                            placeholder="Add notes about this customer (e.g. 'Allergic to nuts', 'VIP')..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="bg-muted/20 min-h-[120px] resize-none focus-visible:ring-1 border-border/50"
                        />
                        <Button onClick={handleSaveDetails} disabled={isSavingNotes || loadingDetails} className="w-full" size="sm" variant="outline">
                            {isSavingNotes ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
                            {isSavingNotes ? "Saving..." : "Save Notes"}
                        </Button>
                    </div>
                </div>

                {/* Send Reward Button */}
                <div className="bg-card rounded-xl p-4 shadow-sm border border-border/50">
                    <h4 className="text-xs font-semibold text-muted-foreground mb-4 uppercase tracking-wider flex items-center gap-2">
                        <Gift size={12} /> Send Reward
                    </h4>
                    <Button onClick={() => setCouponModalOpen(true)} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white" size="sm">
                        <Gift className="mr-2 h-4 w-4" /> Send Special Reward
                    </Button>
                </div>

                <div className="pt-2">
                    <Button variant="ghost" className="w-full text-red-500 hover:text-red-600 hover:bg-red-50 h-12 text-base font-medium" onClick={() => setConfirmEndChatOpen(true)}>
                        <LogOut className="mr-2 h-5 w-5" /> End Chat & Archive
                    </Button>
                </div>
            </div>

        </aside>
    ) : null;

    const quickReplies = [
        "Namaste! Hum aapki kaise madad kar sakte hain?",
        "Aapka order taiyaar ho raha hai aur jald hi niklega.",
        "Dhanyavaad, humein aapka feedback mil gaya hai.",
        "Kripya thoda intezaar karein, hum abhi check kar rahe hain.",
    ];

    const filteredConversations = useMemo(() => {
        if (activeFilter === 'All') return conversations;
        return conversations.filter(c => c.tag === activeFilter);
    }, [conversations, activeFilter]);


    // --- Main Render ---
    return (
        <div className="flex bg-background h-[calc(100vh-6rem)] overflow-hidden font-sans border rounded-xl shadow-sm my-2 mr-2">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            {activeConversation && <CouponModal isOpen={isCouponModalOpen} setIsOpen={setCouponModalOpen} customer={{ ...activeConversation, name: activeConversation.customerName, id: activeConversation.customerPhone }} onSave={handleSaveReward} />}
            <ConfirmationModal
                isOpen={isConfirmEndChatOpen}
                onClose={() => setConfirmEndChatOpen(false)}
                onConfirm={confirmEndChat}
                title="End This Chat?"
                description="Are you sure you want to end this chat? The customer will be asked for feedback."
            />

            {/* Left Sidebar - Chat List */}
            <aside className={cn(
                "w-full md:w-[400px] border-r border-border flex flex-col h-full bg-background z-20 shrink-0 transition-all duration-300",
                activeConversation ? "hidden md:flex" : "flex"
            )}>
                <header className="px-4 py-3 bg-[#f0f2f5] dark:bg-zinc-900 border-b border-border flex items-center justify-between sticky top-0 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="relative shrink-0">
                            <Avatar className="h-10 w-10 border border-border/10">
                                <AvatarImage src={restaurantProfile?.logoUrl} alt="Restaurant Logo" className="object-cover" />
                                <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
                                    {getInitials(restaurantProfile?.restaurantName || 'Owner')}
                                </AvatarFallback>
                            </Avatar>
                        </div>
                        <div className="flex gap-2 items-center">
                            <h2 className="font-bold text-xl tracking-tight">Chats</h2>
                        </div>
                    </div>
                    <div className="flex gap-1 text-muted-foreground">
                        <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground"><MessageSquare size={20} /></Button>
                        <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground"><MoreVertical size={20} /></Button>
                    </div>
                </header>

                <div className="p-3 border-b border-border/60 bg-background shrink-0 space-y-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
                        <input type="text" placeholder="Search or start new chat" className="w-full pl-10 pr-4 py-2 h-9 rounded-lg bg-[#f0f2f5] dark:bg-zinc-800 border-none text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/70" />
                    </div>
                    <div className="flex gap-2 overflow-x-auto pt-1 pb-1 no-scrollbar mask-gradient-r">
                        {Object.keys(tagConfig).map(tag => {
                            const TagIcon = tagConfig[tag].icon;
                            return (
                                <button
                                    key={tag}
                                    onClick={() => setActiveFilter(prev => prev === tag ? 'All' : tag)}
                                    className={cn(
                                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border shadow-sm",
                                        activeFilter === tag
                                            ? "bg-[#e7fce3] text-[#111b21] border-[#d9fdd3] dark:bg-[#00a884] dark:text-white dark:border-[#00a884]"
                                            : "bg-background text-muted-foreground border-border/60 hover:bg-muted hover:border-border"
                                    )}
                                >
                                    {tag !== 'All' && <TagIcon size={12} />}
                                    {tag}
                                </button>
                            )
                        })}
                    </div>
                </div>

                <div className="flex-grow overflow-y-auto custom-scrollbar">
                    {loadingConversations ? (
                        <div className="flex justify-center p-8"><Loader2 className="animate-spin text-primary w-8 h-8" /></div>
                    ) : filteredConversations.length > 0 ? (
                        filteredConversations.map(convo => (
                            <ConversationItem key={convo.id} conversation={convo} active={activeConversation?.id === convo.id} onClick={handleConversationClick} />
                        ))
                    ) : (
                        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground p-8 text-sm text-center">
                            <MessageSquare className="w-12 h-12 mb-3 opacity-20" />
                            <p>No chats found</p>
                        </div>
                    )}
                </div>
            </aside>

            {/* Middle Container - Chat Window */}
            <main className={cn(
                "flex-1 flex flex-col h-full relative min-w-0 bg-[#efeae2] dark:bg-[#0b141a] transition-all duration-300",
                !activeConversation ? "hidden md:flex" : "flex"
            )}>
                {/* Chat Background Pattern Overlay */}
                <div className="absolute inset-0 opacity-[0.4] dark:opacity-[0.06] pointer-events-none bg-repeat" style={{ backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')", backgroundSize: "400px" }}></div>

                {activeConversation ? (
                    <>
                        {/* Chat Header */}
                        <header className="p-2.5 px-4 bg-[#f0f2f5] dark:bg-zinc-900 border-b border-border/60 flex items-center justify-between z-10 shadow-sm cursor-pointer shrink-0" onClick={() => setShowProfileInfo(!showProfileInfo)}>
                            <div className="flex items-center gap-3 overflow-hidden">
                                <Button variant="ghost" size="icon" className="md:hidden -ml-2 shrink-0" onClick={(e) => { e.stopPropagation(); setActiveConversation(null); }}>
                                    <ArrowLeft size={20} />
                                </Button>
                                <div className="relative shrink-0">
                                    <Avatar className="h-10 w-10 border border-border/10 cursor-pointer shadow-sm">
                                        <AvatarImage src="" alt={activeConversation.customerName} />
                                        <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs border border-primary/20">
                                            {getInitials(activeConversation.customerName)}
                                        </AvatarFallback>
                                    </Avatar>
                                </div>
                                <div className="cursor-pointer overflow-hidden">
                                    <h3 className="font-semibold text-foreground text-sm md:text-base truncate">{activeConversation.customerName}</h3>
                                    {notes ? (
                                        <div className="w-full overflow-hidden">
                                            <div className="animate-marquee whitespace-nowrap">
                                                <p className="text-xs text-yellow-600 dark:text-yellow-400 font-medium inline-block pr-8">
                                                    📝 {notes}
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-muted-foreground truncate">click for info</p>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                                {/* Header Actions (Tag, etc) */}
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:bg-muted">
                                            <Tag size={20} />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        {Object.entries(tagConfig).map(([tag, { icon: TagIcon, color }]) => (
                                            <DropdownMenuItem key={tag} onClick={() => handleTagChange(tag)}>
                                                <TagIcon className={cn("mr-2 h-4 w-4", color)} /> {tag}
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                                <Button variant="ghost" size="icon" className={cn("h-9 w-9 text-muted-foreground hover:bg-muted", showProfileInfo && "bg-muted text-primary")} onClick={() => setShowProfileInfo(!showProfileInfo)}>
                                    <MoreVertical size={20} />
                                </Button>
                            </div>
                        </header>

                        {/* Messages Area */}
                        <div className="flex-grow p-4 md:p-8 overflow-y-auto z-10 scrollbar-thin scrollbar-thumb-gray-300/50 hover:scrollbar-thumb-gray-400">
                            {loadingMessages ? (
                                <div className="flex justify-center p-4"><Loader2 className="animate-spin text-primary" /></div>
                            ) : (
                                messages.map(msg => <MessageBubble key={msg.id} message={msg} />)
                            )}
                            {uploadingFile && (
                                <div className={`flex justify-end mb-3`}>
                                    <div className="max-w-xs px-4 py-3 rounded-xl bg-white dark:bg-zinc-800 shadow-md">
                                        <div className="flex items-center gap-3">
                                            <Loader2 className="animate-spin text-primary" size={20} />
                                            <div>
                                                <p className="text-sm font-medium">Sending {uploadingFile}...</p>
                                                <Progress value={uploadProgress} className="h-1 mt-1" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input Area */}
                        <footer className="p-3 bg-[#f0f2f5] dark:bg-zinc-900 z-10 flex items-end gap-2 shrink-0" onKeyDown={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-2 pb-2">
                                <Button variant="ghost" size="icon" className="text-muted-foreground h-10 w-10 rounded-full hover:bg-muted transition-colors" onClick={() => fileInputRef.current?.click()}>
                                    <Paperclip size={22} />
                                </Button>
                                <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
                            </div>

                            <div className="flex-grow bg-white dark:bg-zinc-800 rounded-2xl flex items-center px-4 py-2 shadow-sm border border-transparent focus-within:border-primary/30 transition-all">
                                <textarea
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    placeholder="Type a message"
                                    className="w-full bg-transparent border-none focus:outline-none resize-none max-h-32 min-h-[24px] py-1 text-base scrollbar-thin placeholder:text-muted-foreground/60"
                                    rows={1}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSendMessage(e);
                                        }
                                    }}
                                />
                            </div>

                            <div className="pb-1">
                                {newMessage.trim() ? (
                                    <Button onClick={handleSendMessage} disabled={isSending} size="icon" className="h-10 w-10 rounded-full bg-[#00a884] hover:bg-[#008f6f] text-white shadow-md transition-all hover:scale-105 active:scale-95">
                                        <Send size={18} className={isSending ? 'opacity-0' : 'ml-0.5'} />
                                    </Button>
                                ) : (
                                    <Button
                                        onClick={isRecording ? stopRecording : startRecording}
                                        size="icon"
                                        className={cn(
                                            "h-10 w-10 rounded-full shadow-md transition-all hover:scale-105 active:scale-95",
                                            isRecording ? "bg-red-500 hover:bg-red-600 animate-pulse text-white shadow-red-500/20" : "bg-muted text-muted-foreground hover:bg-muted/80"
                                        )}
                                    >
                                        <Mic size={20} />
                                    </Button>
                                )}
                            </div>
                        </footer>

                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center bg-[#f0f2f5] dark:bg-[#222e35] text-center border-b-[6px] border-[#25d366] h-full z-10 transition-all">
                        <div className="mb-6 relative w-28 h-28 rounded-full overflow-hidden shadow-lg bg-white border-4 border-white/80 animate-in zoom-in-75 duration-300 flex items-center justify-center">
                            {restaurantProfile?.logoUrl ? (
                                <Image src={restaurantProfile.logoUrl} layout="fill" alt="Restaurant Logo" className="object-cover" />
                            ) : (
                                <span className="text-3xl font-bold text-gray-300">
                                    {getInitials(restaurantProfile?.restaurantName || 'Welcome')}
                                </span>
                            )}
                        </div>
                        <h2 className="text-2xl font-light text-gray-700 dark:text-gray-200 mb-2">Welcome to WhatsApp Direct</h2>
                        <p className="text-gray-500 max-w-sm text-sm">Select a conversation from the left to start chatting with your customers.</p>

                        <div className="mt-8 flex items-center gap-2 text-xs text-gray-400 font-medium opacity-60">
                            <div className="w-2 h-2 bg-[#25d366] rounded-full"></div> End-to-end encrypted
                        </div>
                    </div>
                )}
            </main>

            {/* Right Sidebar - Profile Info */}
            {activeConversation && showProfileInfo && ProfileSidebar}
        </div>
    );
}

export default WhatsAppDirectPageContent;
