
'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Archive, MessageSquare, Send, Paperclip, Loader2, ArrowLeft, Image as ImageIcon, X, Tag, Star, AlertTriangle, ThumbsUp, LogOut, Check, CheckCheck, Mic, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { useSearchParams } from 'next/navigation';
import InfoDialog from '@/components/InfoDialog';
import { format, isToday, isYesterday } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import CustomAudioPlayer from '@/components/CustomAudioPlayer';

export const dynamic = 'force-dynamic';

const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (isToday(date)) return format(date, 'p');
    if (isYesterday(date)) return 'Yesterday';
    return format(date, 'dd/MM/yyyy');
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
        if (type === 'image') return <ImageIcon size={14} />;
        if (type === 'video') return <span className="text-xs">🎥</span>;
        if (type === 'document') return <span className="text-xs">📄</span>;
        if (type === 'audio') return <span className="text-xs">🎵</span>;
        return null;
    };

    return (
        <div
            onClick={() => onClick(conversation)}
            className={cn(
                'flex items-center p-3 cursor-pointer rounded-lg transition-colors',
                active ? 'bg-primary/10' : 'hover:bg-muted/50'
            )}
        >
            <div className="relative w-12 h-12 rounded-full mr-3 flex-shrink-0">
                <Image src={`https://picsum.photos/seed/${conversation.customerPhone}/100`} alt={conversation.customerName} layout="fill" className="rounded-full" />
                {conversation.unreadCount > 0 && <span className="absolute bottom-0 right-0 bg-primary text-primary-foreground text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">{conversation.unreadCount}</span>}
            </div>
            <div className="flex-grow overflow-hidden">
                <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-foreground truncate">{conversation.customerName}</h3>
                    <p className="text-xs text-muted-foreground flex-shrink-0 ml-2">{formatTimestamp(conversation.lastMessageTimestamp)}</p>
                </div>
                <div className="flex justify-between items-center">
                    <p className="text-sm text-muted-foreground truncate flex items-center gap-1">
                        {getMessageIcon(conversation.lastMessageType)}
                        {conversation.lastMessage}
                    </p>
                    {conversation.tag && TagIcon && (
                        <TagIcon size={14} className={cn('flex-shrink-0', tagConfig[conversation.tag].color)} />
                    )}
                </div>
            </div>
        </div>
    );
};



const MessageBubble = React.memo(({ message }) => {
    const timestamp = message.timestamp?.seconds ? new Date(message.timestamp.seconds * 1000) : new Date(message.timestamp);
    const isOwner = message.sender === 'owner';

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
                <div className="p-2">
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
                <div className="p-2">
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
                        className={isOwner ? "bg-black/5 text-primary-foreground" : "bg-white/90 text-foreground shadow-sm"}
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
        return <p className="px-3">{message.text}</p>;
    };

    return (
        <div className={`flex ${isOwner ? 'justify-end' : 'justify-start'} mb-3`}>
            <div className={`max-w-xs lg:max-w-md px-1 py-2 rounded-2xl ${isOwner ? 'bg-primary text-primary-foreground rounded-br-none' : 'bg-muted rounded-bl-none'}`}>
                {renderContent()}
                <div className={`text-xs mt-1 px-3 flex items-center justify-end gap-1 ${isOwner ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                    <span>{format(timestamp, 'p')}</span>
                    {isOwner && (
                        <span>
                            {message.status === 'read' ? (
                                <CheckCheck size={14} className="text-blue-300" />
                            ) : message.status === 'delivered' ? (
                                <CheckCheck size={14} className="opacity-70" />
                            ) : (
                                <Check size={14} className="opacity-70" />
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

    // Audio Recording State
    const [isRecording, setIsRecording] = useState(false);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);
    const timerRef = useRef(null);

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
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Priority: WebM/Opus (Chrome Native) -> MP4 (Fallback)
            // WhatsApp accepts Opus audio if we send it as .ogg (even if container is webm)
            let mimeType = 'audio/webm';

            if (MediaRecorder.isTypeSupported('audio/webm; codecs=opus')) {
                mimeType = 'audio/webm; codecs=opus';
            } else if (MediaRecorder.isTypeSupported('audio/webm')) {
                mimeType = 'audio/webm';
            } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                // Keep MP4 as fallback, but prefer WebM/Opus for the OGG hack
                mimeType = 'audio/mp4';
            }
            console.log("Using MIME type for recording:", mimeType);

            const mediaRecorder = new MediaRecorder(stream, { mimeType });

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
            setInfoDialog({ isOpen: true, title: "Microphone Access Denied", message: "Please allow microphone access to record audio." });
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

                    console.log(`[Recording] Finalizing. RealMime: ${mimeType} -> SendingAs: ${finalMime}, Ext: ${ext}, Blob: ${audioBlob.size}`);

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

            const { presignedUrl, publicUrl, fileName, finalMimeType } = await handleApiCall('/api/owner/whatsapp-direct/upload-url', 'POST', {
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
                fileName: fileName || file.name
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


    const ConversationList = (
        <aside className="w-full md:w-1/3 border-r border-border flex flex-col h-full">
            <header className="p-4 border-b border-border space-y-3">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                    <input type="text" placeholder="Search chats..." className="w-full pl-10 pr-4 py-2 h-10 rounded-md bg-input border border-border" />
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {Object.keys(tagConfig).map(tag => {
                        const TagIcon = tagConfig[tag].icon;
                        return (
                            <Button
                                key={tag}
                                variant={activeFilter === tag ? 'default' : 'outline'}
                                size="sm"
                                className="flex items-center gap-2 flex-shrink-0"
                                onClick={() => setActiveFilter(prev => prev === tag ? 'All' : tag)}
                            >
                                <TagIcon size={14} /> {tag}
                            </Button>
                        )
                    })}
                    {activeFilter !== 'All' && <Button variant="ghost" size="sm" onClick={() => setActiveFilter('All')}>Clear</Button>}
                </div>
            </header>
            <div className="flex-grow overflow-y-auto p-2 space-y-1">
                {loadingConversations ? (
                    <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-primary" /></div>
                ) : filteredConversations.length > 0 ? (
                    filteredConversations.map(convo => (
                        <ConversationItem
                            key={convo.id}
                            conversation={convo}
                            active={activeConversation?.id === convo.id}
                            onClick={handleConversationClick}
                        />
                    ))
                ) : (
                    <div className="text-center text-muted-foreground p-8">No conversations found for this filter.</div>
                )}
            </div>
        </aside>
    );

    const ChatWindow = (
        <main className="flex-1 flex flex-col bg-background h-full min-w-0 overflow-hidden">
            {activeConversation ? (
                <>
                    <header className="p-4 border-b border-border flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <button className="md:hidden" onClick={() => setActiveConversation(null)}>
                                <ArrowLeft size={20} />
                            </button>
                            <div className="relative w-10 h-10 rounded-full">
                                <Image src={`https://picsum.photos/seed/${activeConversation.customerPhone}/100`} alt={activeConversation.customerName} layout="fill" className="rounded-full" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-foreground">{activeConversation.customerName}</h3>
                                <p className="text-xs text-muted-foreground">+{activeConversation.customerPhone}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" className="flex items-center gap-2">
                                        <Tag size={14} />
                                        {activeConversation.tag || 'Tag Chat'}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    {Object.entries(tagConfig).map(([tag, { icon: TagIcon, color }]) => (
                                        <DropdownMenuItem key={tag} onClick={() => handleTagChange(tag)}>
                                            <TagIcon className={cn("mr-2 h-4 w-4", color)} /> {tag}
                                        </DropdownMenuItem>
                                    ))}
                                    {activeConversation.tag && (
                                        <>
                                            <div className="h-px bg-border my-1 mx-[-4px]"></div>
                                            <DropdownMenuItem onClick={() => handleTagChange(null)} className="text-red-500">
                                                <X size={14} className="mr-2" /> Clear Tag
                                            </DropdownMenuItem>
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Button variant="destructive" size="sm" onClick={() => setConfirmEndChatOpen(true)}>
                                <LogOut size={14} className="mr-2" /> End Chat
                            </Button>
                        </div>
                    </header>
                    <div className="flex-grow p-4 overflow-y-auto">
                        {loadingMessages ? (
                            <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-primary" /></div>
                        ) : (
                            messages.map(msg => <MessageBubble key={msg.id} message={msg} />)
                        )}
                        {uploadingFile && (
                            <div className="flex justify-end mb-3">
                                <div className="max-w-xs lg:max-w-md px-4 py-3 rounded-2xl bg-primary text-primary-foreground rounded-br-none">
                                    <div className="flex items-center gap-3">
                                        <Loader2 className="animate-spin" />
                                        <div>
                                            <p className="text-sm font-semibold">Sending image...</p>
                                            <p className="text-xs truncate max-w-xs text-primary-foreground/80">{uploadingFile}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                    <footer className="p-4 border-t border-border bg-card">
                        <div className="flex gap-2 overflow-x-auto mb-3 pb-2">
                            {quickReplies.map((reply, i) => (
                                <Button key={i} variant="outline" size="sm" className="flex-shrink-0" onClick={() => setNewMessage(reply)}>
                                    {reply}
                                </Button>
                            ))}
                        </div>
                        <form onSubmit={handleSendMessage} className="flex items-center gap-3">
                            {isRecording ? (
                                <div className="flex-grow flex items-center gap-3 bg-red-50 p-2 rounded-md animate-in fade-in duration-200">
                                    <div className="flex items-center gap-2 text-red-600 font-mono text-sm px-2 animate-pulse">
                                        <div className="w-3 h-3 bg-red-600 rounded-full"></div>
                                        {formatDuration(recordingDuration)}
                                    </div>
                                    <div className="flex-grow text-xs text-muted-foreground">Recording Audio...</div>
                                    <Button type="button" variant="ghost" size="icon" onClick={cancelRecording} className="text-muted-foreground hover:text-destructive">
                                        <Trash2 size={20} />
                                    </Button>
                                    <Button type="button" variant="destructive" size="icon" onClick={() => stopRecording(true)} className="rounded-full animate-bounce">
                                        <Send size={18} />
                                    </Button>
                                </div>
                            ) : (
                                <>
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={handleFileChange}
                                        className="hidden"
                                        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
                                    />
                                    <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} className="flex-shrink-0">
                                        <Paperclip />
                                    </Button>
                                    <input
                                        type="text"
                                        placeholder="Type your message..."
                                        value={newMessage}
                                        onChange={(e) => setNewMessage(e.target.value)}
                                        className="flex-grow p-2 h-10 rounded-md bg-input border border-border"
                                    />
                                    {newMessage.trim() ? (
                                        <button type="submit" disabled={isSending} className="h-10 w-10 bg-primary text-primary-foreground rounded-md flex items-center justify-center disabled:opacity-50">
                                            {isSending ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
                                        </button>
                                    ) : (
                                        <Button type="button" variant="secondary" size="icon" onClick={startRecording} className="h-10 w-10 rounded-full">
                                            <Mic size={20} />
                                        </Button>
                                    )}
                                </>
                            )}
                        </form>
                    </footer>
                </>
            ) : (
                <div className="flex-grow flex flex-col items-center justify-center text-center p-8">
                    <div className="bg-primary/10 p-6 rounded-full">
                        <MessageSquare size={48} className="text-primary" />
                    </div>
                    <h2 className="mt-6 text-2xl font-bold text-foreground">WhatsApp Direct</h2>
                    <p className="mt-2 max-w-sm text-muted-foreground">
                        Select a conversation to start chatting. Your replies will be sent directly from your connected business WhatsApp number.
                    </p>
                </div>
            )}
        </main>
    );


    return (
        <>
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />
            <ConfirmationModal
                isOpen={isConfirmEndChatOpen}
                onClose={() => setConfirmEndChatOpen(false)}
                onConfirm={confirmEndChat}
                title="End This Chat?"
                description="Are you sure you want to end this chat? The customer will be asked for feedback."
            />
            <div className="h-[calc(100vh-100px)] md:h-[calc(100vh-65px)] flex bg-card border border-border rounded-xl overflow-hidden">
                <div className="md:hidden w-full h-full">
                    <AnimatePresence mode="wait">
                        {activeConversation ? (
                            <motion.div
                                key="chat"
                                className="w-full h-full"
                                initial={{ x: '100%' }}
                                animate={{ x: 0 }}
                                exit={{ x: '100%' }}
                                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                            >
                                {ChatWindow}
                            </motion.div>
                        ) : (
                            <motion.div
                                key="list"
                                className="w-full h-full"
                                initial={{ x: 0 }}
                                exit={{ x: '-100%' }}
                                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                            >
                                {ConversationList}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <div className="hidden md:flex w-full h-full">
                    {ConversationList}
                    {ChatWindow}
                </div>
            </div>
        </>
    );
}


export default function WhatsAppDirectPage() {
    return (
        <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
            <WhatsAppDirectPageContent />
        </Suspense>
    )
}
