
'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Archive, MessageSquare, Send, Paperclip, Loader2, ArrowLeft } from 'lucide-react';
import Image from 'next/image';
import { auth } from '@/lib/firebase';
import { useSearchParams } from 'next/navigation';
import InfoDialog from '@/components/InfoDialog';
import { format, isToday, isYesterday } from 'date-fns';
import { cn } from '@/lib/utils';

const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (isToday(date)) return format(date, 'p');
    if (isYesterday(date)) return 'Yesterday';
    return format(date, 'dd/MM/yyyy');
};

const ConversationItem = ({ conversation, active, onClick }) => (
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
            <p className="text-sm text-muted-foreground truncate">{conversation.lastMessage}</p>
        </div>
    </div>
);

const MessageBubble = ({ message }) => {
    const isOwner = message.sender === 'owner';
    const timestamp = message.timestamp?.seconds ? new Date(message.timestamp.seconds * 1000) : new Date(message.timestamp);

    return (
        <div className={`flex ${isOwner ? 'justify-end' : 'justify-start'} mb-3`}>
            <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl ${isOwner ? 'bg-primary text-primary-foreground rounded-br-none' : 'bg-muted rounded-bl-none'}`}>
                <p>{message.text}</p>
                <p className={`text-xs mt-1 ${isOwner ? 'text-primary-foreground/70' : 'text-muted-foreground'} text-right`}>
                    {format(timestamp, 'p')}
                </p>
            </div>
        </div>
    );
};


export default function WhatsAppDirectPage() {
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
    
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    useEffect(scrollToBottom, [messages]);
    
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
        if (conversations.length === 0 && !isBackgroundRefresh) {
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
            }, 30000); // Poll every 30 seconds for messages of the active chat
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
        const tempMessageId = 'temp-' + Date.now();
        const optimisticMessage = {
            id: tempMessageId,
            text: newMessage,
            sender: 'owner',
            timestamp: new Date().toISOString()
        };
        setMessages(prev => [...prev, optimisticMessage]);
        const messageToSend = newMessage;
        setNewMessage('');
        
        try {
            await handleApiCall('/api/owner/whatsapp-direct/messages', 'POST', {
                conversationId: activeConversation.id,
                text: messageToSend
            });
            // Immediately fetch the latest messages to get the real one from DB
            const data = await handleApiCall('/api/owner/whatsapp-direct/messages', 'GET', { conversationId: activeConversation.id });
            setMessages(data.messages || []);
        } catch(error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Failed to send message: ' + error.message });
            // On failure, remove the optimistic message
            setMessages(prev => prev.filter(m => m.id !== tempMessageId));
        } finally {
            setIsSending(false);
        }
    }


    const ConversationList = (
         <aside className="w-full md:w-1/3 border-r border-border flex flex-col h-full">
            <header className="p-4 border-b border-border">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                    <input type="text" placeholder="Search chats..." className="w-full pl-10 pr-4 py-2 h-10 rounded-md bg-input border border-border" />
                </div>
            </header>
            <div className="flex-grow overflow-y-auto p-2 space-y-1">
                {loadingConversations ? (
                    <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-primary"/></div>
                ) : conversations.length > 0 ? (
                   conversations.map(convo => (
                       <ConversationItem 
                         key={convo.id} 
                         conversation={convo} 
                         active={activeConversation?.id === convo.id}
                         onClick={handleConversationClick}
                       />
                   ))
                ) : (
                     <div className="text-center text-muted-foreground p-8">No conversations yet.</div>
                )}
            </div>
        </aside>
    );

    const ChatWindow = (
        <main className="w-full flex-grow flex flex-col bg-background h-full">
            {activeConversation ? (
                 <>
                    <header className="p-4 border-b border-border flex items-center gap-3">
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
                    </header>
                    <div className="flex-grow p-4 overflow-y-auto">
                       {loadingMessages ? (
                           <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-primary"/></div>
                       ) : (
                           messages.map(msg => <MessageBubble key={msg.id} message={msg} />)
                       )}
                       <div ref={messagesEndRef} />
                    </div>
                    <footer className="p-4 border-t border-border bg-card">
                        <form onSubmit={handleSendMessage} className="flex items-center gap-3">
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
            <div className="h-[calc(100vh-100px)] md:h-[calc(100vh-65px)] flex bg-card border border-border rounded-xl overflow-hidden">
                {/* Mobile View */}
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

                {/* Desktop View */}
                <div className="hidden md:flex w-full h-full">
                    {ConversationList}
                    {ChatWindow}
                </div>
            </div>
        </>
    );
}
