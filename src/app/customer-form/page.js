'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { User, Home, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

function CustomerForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const restaurantId = searchParams.get('restaurantId');
  const phone = searchParams.get('phone');

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!name.trim() || !address.trim()) {
      setError('Please fill in your name and address.');
      return;
    }
    
    if (!restaurantId || !phone) {
        setError('Invalid or incomplete link. Please go back to WhatsApp and click the link again.');
        return;
    }

    setLoading(true);

    try {
        const res = await fetch('/api/customer/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                address,
                phone, // Send the phone number from the URL
                restaurantId
            })
        });

        const data = await res.json();
        
        if(!res.ok) {
            throw new Error(data.message || 'Something went wrong!');
        }

        setSuccess('Details saved! You can now close this window and return to WhatsApp.');
        // No longer redirecting, user should go back to WhatsApp.
        // The form will be disabled.

    } catch (err) {
        setError(err.message);
    } finally {
      // Keep loading true on success to disable form
      if (error) {
        setLoading(false);
      }
    }
  };

  return (
    <motion.div
      className="w-full max-w-md p-8 space-y-6 bg-gray-800 rounded-xl shadow-2xl shadow-indigo-500/10 border border-gray-700"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="text-center">
        <h1 className="text-3xl font-bold text-white">Almost there!</h1>
        <p className="text-gray-400 mt-2">Just a few details to get you started.</p>
      </div>

      {success ? (
          <motion.div 
              className="p-4 text-center bg-green-500/20 text-green-300 border border-green-500/30 rounded-lg"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
          >
              <p>{success}</p>
          </motion.div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Full Name</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input 
                  type="text" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  required 
                  className="w-full pl-10 pr-4 py-2 rounded-md bg-gray-700 border border-gray-600 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" 
                  placeholder="Enter your full name"
              />
            </div>
          </div>
           <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Delivery Address</label>
            <div className="relative">
              <Home className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
              <textarea 
                  value={address} 
                  onChange={(e) => setAddress(e.target.value)} 
                  required 
                  rows={3}
                  className="w-full pl-10 pr-4 py-2 rounded-md bg-gray-700 border border-gray-600 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Enter your full delivery address"
              />
            </div>
          </div>
          
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          <Button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-transform hover:scale-105"
          >
            {loading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            ) : (
                <>
                Save & Continue in WhatsApp <ArrowRight className="ml-2 h-5 w-5" />
                </>
            )}
          </Button>
        </form>
      )}
    </motion.div>
  );
}


export default function CustomerFormPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white p-4">
      <Suspense fallback={<div className="animate-spin rounded-full h-16 w-16 border-b-2 border-indigo-500"></div>}>
        <CustomerForm />
      </Suspense>
    </div>
  );
}
