'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Store, Phone, MapPin, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function PreOrderHomePage() {
    const [formData, setFormData] = useState({
        name: '',
        businessName: '',
        phone: '',
        address: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        if (!formData.name || !formData.businessName || !formData.phone || !formData.address) {
            setError('Please fill all required fields.');
            setLoading(false);
            return;
        }

        if (!/^\d{10}$/.test(formData.phone)) {
            setError('Please enter a valid 10-digit mobile number.');
            setLoading(false);
            return;
        }

        try {
            // Using the existing waitlist API for now to capture leads
            const response = await fetch('/api/waitlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.message || 'Something went wrong.');
            }

            setSuccess(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };
    
    const Feature = ({ icon, title, description }) => (
        <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-full bg-primary/10 text-primary">
                {icon}
            </div>
            <div>
                <h4 className="font-bold text-foreground">{title}</h4>
                <p className="text-muted-foreground text-sm">{description}</p>
            </div>
        </div>
    );

    if (success) {
        return (
            <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
                <motion.div
                    className="w-full max-w-lg p-8 text-center bg-slate-800 rounded-xl shadow-2xl shadow-primary/20 border border-slate-700"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                >
                    <CheckCircle className="mx-auto h-20 w-20 text-green-500 mb-6" />
                    <h1 className="text-3xl font-bold">Registration Received!</h1>
                    <p className="text-slate-400 mt-4">Thank you for your interest! We have received your details and will get back to you shortly to set up your pre-ordering page.</p>
                    <Link href="/">
                        <button className="mt-8 bg-primary text-primary-foreground font-bold py-3 px-8 rounded-lg text-lg hover:bg-primary/90 transition-transform transform hover:scale-105">
                            Back to Home
                        </button>
                    </Link>
                </motion.div>
            </div>
        );
    }


    return (
        <div className="min-h-screen bg-slate-900 text-white flex flex-col justify-center items-center p-4">
             <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                {/* Left Side: Information */}
                <motion.div
                    initial={{ x: -50, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ duration: 0.7, ease: 'easeOut' }}
                    className="space-y-8"
                >
                    <div className="text-center lg:text-left">
                        <span className="inline-block px-3 py-1 text-sm font-semibold text-primary bg-primary/10 rounded-full mb-4">FOR STREET VENDORS</span>
                        <h1 className="text-4xl lg:text-5xl font-bold tracking-tight">Thele Se Seedha Customer Ke WhatsApp Par!</h1>
                        <p className="text-slate-400 mt-4 text-lg">Bheed se pareshan? Ab customer ghar se order karega aur aapka kaam fast hoga. ServiZephyr laaya hai street vendors ke liye pre-order system.</p>
                    </div>
                    <div className="space-y-6">
                        <Feature icon={<User size={24}/>} title="Aapka Personal Order Page" description="Aapko ek personal webpage milega jahan aapka menu hoga."/>
                        <Feature icon={<Phone size={24}/>} title="Direct WhatsApp Notifications" description="Har naye order ka alert seedhe aapke WhatsApp number par aayega."/>
                        <Feature icon={<MapPin size={24}/>} title="Pay at Stall Option" description="Customer aakar payment karega, online payment ka jhanjhat nahi."/>
                    </div>
                </motion.div>

                {/* Right Side: Form */}
                 <motion.div
                    className="w-full p-8 space-y-6 bg-slate-800 rounded-xl shadow-2xl shadow-primary/10 border border-slate-700"
                    initial={{ y: 50, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: 0.7, ease: 'easeOut' }}
                >
                    <h2 className="text-2xl font-bold text-center">Join Today & Go Digital!</h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1" htmlFor="name">Aapka Naam</label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
                                <input type="text" name="name" id="name" value={formData.name} onChange={handleChange} required className="w-full pl-10 pr-4 py-2 rounded-md bg-slate-700 border border-slate-600 focus:ring-primary focus:border-primary" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1" htmlFor="businessName">Thele/Stall Ka Naam</label>
                            <div className="relative">
                                <Store className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
                                <input type="text" name="businessName" id="businessName" value={formData.businessName} onChange={handleChange} required className="w-full pl-10 pr-4 py-2 rounded-md bg-slate-700 border border-slate-600 focus:ring-primary focus:border-primary" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1" htmlFor="phone">WhatsApp Mobile Number</label>
                            <div className="relative">
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-500" />
                                <input type="tel" name="phone" id="phone" value={formData.phone} onChange={handleChange} required placeholder="10-digit number" className="w-full pl-10 pr-4 py-2 rounded-md bg-slate-700 border border-slate-600 focus:ring-primary focus:border-primary" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1" htmlFor="address">Stall Ka Address</label>
                            <div className="relative">
                                <MapPin className="absolute left-3 top-3 h-5 w-5 text-slate-500" />
                                <textarea name="address" id="address" value={formData.address} onChange={handleChange} required rows={2} placeholder="Aap apna thela kahan lagate hain?" className="w-full pl-10 pr-4 py-2 rounded-md bg-slate-700 border border-slate-600 focus:ring-primary focus:border-primary" />
                            </div>
                        </div>
                        {error && (
                            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 p-3 rounded-md">
                                <AlertTriangle size={16} /> {error}
                            </div>
                        )}
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-lg font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? <Loader2 className="animate-spin" /> : 'Register Now for Free'}
                        </button>
                    </form>
                </motion.div>
            </div>
        </div>
    );
}
