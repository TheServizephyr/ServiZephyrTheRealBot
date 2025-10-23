'use client';

import { motion } from 'framer-motion';
import { Search, Archive, MessageSquare } from 'lucide-react';
import Image from 'next/image';

const ConversationItem = ({ name, message, time, unread, active }) => (
    <div className={`flex items-center p-3 cursor-pointer rounded-lg ${active ? 'bg-primary/10' : 'hover:bg-muted/50'}`}>
        <div className="relative w-12 h-12 rounded-full mr-3">
            <Image src={`https://picsum.photos/seed/${name}/100`} alt={name} layout="fill" className="rounded-full" />
            {unread > 0 && <span className="absolute bottom-0 right-0 bg-primary text-primary-foreground text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">{unread}</span>}
        </div>
        <div className="flex-grow">
            <div className="flex justify-between items-center">
                <h3 className="font-semibold text-foreground">{name}</h3>
                <p className="text-xs text-muted-foreground">{time}</p>
            </div>
            <p className="text-sm text-muted-foreground truncate">{message}</p>
        </div>
    </div>
);


export default function WhatsAppDirectPage() {
    return (
        <div className="h-[calc(100vh-65px)] flex bg-card border border-border rounded-xl overflow-hidden">
            {/* Sidebar with conversations */}
            <aside className="w-full md:w-1/3 border-r border-border flex flex-col">
                <header className="p-4 border-b border-border">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                        <input type="text" placeholder="Search or start new chat" className="w-full pl-10 pr-4 py-2 h-10 rounded-md bg-input border border-border" />
                    </div>
                </header>
                <div className="flex-grow overflow-y-auto p-2 space-y-1">
                    <ConversationItem name="Utkarsh Patel" message="Hi, is the paneer tikka available tonight?" time="10:42 AM" unread={2} active={true} />
                    <ConversationItem name="Riya Sharma" message="Okay, thank you for the quick reply!" time="Yesterday" unread={0} active={false} />
                    <ConversationItem name="Amit Kumar" message="Can I book a table for 4?" time="Friday" unread={0} active={false} />
                </div>
                <footer className="p-3 border-t border-border text-center">
                    <button className="flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground w-full">
                        <Archive size={16} /> Archived Chats
                    </button>
                </footer>
            </aside>

            {/* Main chat window */}
            <main className="hidden md:flex flex-grow flex-col items-center justify-center text-center p-8 bg-background">
                <div className="bg-primary/10 p-6 rounded-full">
                    <MessageSquare size={48} className="text-primary" />
                </div>
                <h2 className="mt-6 text-2xl font-bold text-foreground">WhatsApp Direct</h2>
                <p className="mt-2 max-w-sm text-muted-foreground">
                    Select a conversation to start chatting. Your replies will be sent directly from your connected business WhatsApp number.
                </p>
            </main>
        </div>
    );
}
