'use client';

import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Archive, MessageSquare, Send, Paperclip, Loader2, ArrowLeft, Image as ImageIcon, X, Tag, Star, AlertTriangle, ThumbsUp, LogOut } from 'lucide-react';
import Image from 'next/image';
import { auth } from '@/lib/firebase';
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


const ConversationItem = ({ conversation, active, onClick }) => {
    const TagIcon = tagConfig[conversation.tag]?.icon;

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
                        {conversation.lastMessageType === 'image' && <ImageIcon size={14} />}
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


const MessageBubble = ({ message }) => {
    const timestamp = message.timestamp?.seconds ? new Date(message.timestamp.seconds * 1000) : new Date(message.timestamp);
    const isOwner = message.sender === 'owner';

    return (
        <div className={`flex ${isOwner ? 'justify-end' : 'justify-start'} mb-3`}>
            <div className={`max-w-xs lg:max-w-md px-1 py-2 rounded-2xl ${isOwner ? 'bg-primary text-primary-foreground rounded-br-none' : 'bg-muted rounded-bl-none'}`}>
                {message.type === 'image' && message.mediaUrl ? (
                    <div className="p-2">
                        <a href={message.mediaUrl} target="_blank" rel="noopener noreferrer">
                           <Image src={message.mediaUrl} alt="Chat image" width={250} height={250} className="rounded-lg cursor-pointer" />
                        </a>
                    </div>
                ) : (
                    <p className="px-3">{message.text}</p>
                )}
                <p className={`text-xs mt-1 px-3 ${isOwner ? 'text-primary-foreground/70' : 'text-muted-foreground'} text-right`}>
                    {format(timestamp, 'p')}
                </p>
            </div>
        </div>
    );
};

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
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadingFile, setUploadingFile] = useState(null);
    const [activeFilter, setActiveFilter] = useState('All');
    const [isConfirmEndChatOpen, setConfirmEndChatOpen] = useState(false);
    
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    useEffect(scrollToBottom, [messages, uploadingFile]);
    
    const handleApiCall = async (endpoint, method = 'GET', body = null) => {
        const user = auth.currentUser;
        if (!user) throw new Error("Authentication required.");
        const idToken = await user.getIdToken();
        
        let url = new URL(endpoint, window.location.origin);
        if (impersonatedOwnerId) {
            url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
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

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'API call failed');
        return data;
    }
    
    const fetchConversations = async (isBackgroundRefresh = false) => {
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
    };

    const fetchMessages = async (conversationId) => {
        try {
            const data = await handleApiCall('/api/owner/whatsapp-direct/messages', 'GET', { conversationId });
            setMessages(data.messages || []);
        } catch(error) {
             setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not load messages: ' + error.message });
        } finally {
            setLoadingMessages(false);
        }
    };

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchConversations();
            else setLoadingConversations(false);
        });
        
        const interval = setInterval(() => fetchConversations(true), 30000); 

        return () => {
            unsubscribe();
            clearInterval(interval);
        };
    }, [impersonatedOwnerId]);

    useEffect(() => {
        let interval;
        if (activeConversation) {
            interval = setInterval(() => {
                fetchMessages(activeConversation.id);
            }, 30000);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [activeConversation]);
    
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
        } catch(error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Failed to send message: ' + error.message });
            setMessages(prev => prev.filter(m => m.id !== optimisticMessage.id));
        } finally {
            setIsSending(false);
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file && activeConversation) {
            handleImageUpload(file);
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleImageUpload = async (file) => {
        if (!activeConversation) return;
        setUploadingFile(file.name);
        setUploadProgress(0);
        
        try {
            const { presignedUrl, publicUrl } = await handleApiCall('/api/owner/whatsapp-direct/upload-url', 'POST', {
                fileName: file.name,
                fileType: file.type,
                conversationId: activeConversation.id
            });
            
            const uploadResponse = await fetch(presignedUrl, {
                method: 'PUT',
                body: file,
                headers: {
                    'Content-Type': file.type,
                },
            });
    
            if (!uploadResponse.ok) {
                 const errorText = await uploadResponse.text();
                 console.error("Firebase upload failed:", errorText);
                 throw new Error('Failed to upload image to storage.');
            }
            
            await handleApiCall('/api/owner/whatsapp-direct/messages', 'POST', {
                conversationId: activeConversation.id,
                imageUrl: publicUrl
            });
    
            await fetchMessages(activeConversation.id);
    
        } catch (error) {
            setInfoDialog({isOpen: true, title: "Upload Failed", message: "Could not send image: " + error.message});
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
                    <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-primary"/></div>
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
        <main className="w-full flex-grow flex flex-col bg-background h-full">
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
                                    {Object.entries(tagConfig).map(([tag, {icon: TagIcon, color}]) => (
                                        <DropdownMenuItem key={tag} onClick={() => handleTagChange(tag)}>
                                            <TagIcon className={cn("mr-2 h-4 w-4", color)} /> {tag}
                                        </DropdownMenuItem>
                                    ))}
                                    {activeConversation.tag && (
                                        <>
                                        <div className="h-px bg-border my-1 mx-[-4px]"></div>
                                        <DropdownMenuItem onClick={() => handleTagChange(null)} className="text-red-500">
                                            <X size={14} className="mr-2"/> Clear Tag
                                        </DropdownMenuItem>
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                             <Button variant="destructive" size="sm" onClick={()={() => setConfirmEndChatOpen(true)}>
                                <LogOut size={14} className="mr-2"/> End Chat
                            </Button>
                        </div>
                    </header>
                    <div className="flex-grow p-4 overflow-y-auto">
                       {loadingMessages ? (
                           <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-primary"/></div>
                       ) : (
                           messages.map(msg => <MessageBubble key={msg.id} message={msg} />)
                       )}
                       {uploadingFile && (
                          <div className="flex justify-end mb-3">
                            <div className="max-w-xs lg:max-w-md px-4 py-3 rounded-2xl bg-primary text-primary-foreground rounded-br-none">
                               <div className="flex items-center gap-3">
                                <Loader2 className="animate-spin"/>
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
                             <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/png, image/jpeg" />
                             <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} className="flex-shrink-0">
                                <Paperclip/>
                             </Button>
                            <input 
                                type="text" 
                                placeholder="Type your message..." 
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                className="flex-grow p-2 h-10 rounded-md bg-input border border-border"
                            />
                            <button type="submit" disabled={isSending || !newMessage.trim()} className="h-10 w-10 bg-primary text-primary-foreground rounded-md flex items-center justify-center disabled:opacity-50">
                               {isSending ? <Loader2 className="animate-spin" size={20}/> : <Send size={20} />}
                            </button>
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