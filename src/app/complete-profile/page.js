

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { User, Store, Shield, ShoppingCart, Phone, Key, ArrowRight, MapPin, HelpCircle } from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, serverTimestamp } from 'firebase/firestore';


const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

const getUserRoleFromFirestore = async (uid) => {
    if (!uid) return null;
    const userRef = doc(db, "users", uid);
    try {
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            return userSnap.data(); // Return full user data
        }
    } catch (e) {
        console.warn("Could not read user role, likely due to security rules for new user.");
    }
    return null;
};


export default function CompleteProfile() {
  const router = useRouter();
  const [role, setRole] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [address, setAddress] = useState({
      street: '',
      city: 'Ghaziabad',
      state: 'Uttar Pradesh',
      postalCode: '201206',
      country: 'IN'
  });
  const [phone, setPhone] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          const userData = await getUserRoleFromFirestore(user.uid);
          const userRole = userData?.role;
          const businessType = userData?.businessType;

          if (userRole && userRole !== 'none') {
            localStorage.setItem('role', userRole);
            if (userRole === 'owner' || userRole === 'restaurant-owner' || userRole === 'shop-owner') {
              // Ensure businessType is also stored for owner roles
              localStorage.setItem('businessType', businessType || 'restaurant');
              router.push('/owner-dashboard');
            } else if (userRole === 'admin') {
              router.push('/admin-dashboard');
            } else {
              router.push('/customer-dashboard');
            }
          } else {
            const urlParams = new URLSearchParams(window.location.search);
            const phoneFromUrl = urlParams.get('phone');
            setPhone(user.phoneNumber || phoneFromUrl || '');
            setLoading(false);
          }
        } catch (error) {
          setError("Could not verify user status. Please try again.");
          setLoading(false);
        }
      } else {
        router.push('/');
      }
    });

    return () => unsubscribe();
  }, [router]);
  
  const validatePhoneNumber = (number) => {
    const phoneRegex = /^\d{10}$/;
    return phoneRegex.test(number);
  }

  const handleAddressChange = (field, value) => {
      setAddress(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!role) {
      setError('Please select a role.');
      setLoading(false);
      return;
    }
    
    const normalizedPhone = phone.slice(-10);

    if (!validatePhoneNumber(normalizedPhone)) {
        setError('Please enter a valid 10-digit mobile number.');
        setLoading(false);
        return;
    }
    
    if (role === 'admin' && secretKey !== "servizephyr_admin_key") {
        setError('Invalid Admin Secret Key.');
        setLoading(false);
        return;
    }

    try {
        const user = auth.currentUser;
        if (!user) {
          throw new Error("User not authenticated. Please login again.");
        }
        
        const isBusinessOwner = role === 'restaurant-owner' || role === 'shop-owner';
        const businessType = isBusinessOwner ? (role === 'restaurant-owner' ? 'restaurant' : 'shop') : null;

        const finalUserData = {
            uid: user.uid,
            email: user.email,
            name: user.displayName || 'New User',
            phone: normalizedPhone,
            role: role,
            businessType: businessType,
            profilePictureUrl: user.photoURL || `https://picsum.photos/seed/${user.uid}/200/200`,
            notifications: {
                newOrders: true,
                dailySummary: false,
                marketing: true,
            },
        };

        let businessData = null;
        if (isBusinessOwner) {
             if (!businessName || !address.street || !address.city || !address.state || !address.postalCode) {
                throw new Error("Business name and full address are required for owners.");
             }
             businessData = {
                name: businessName,
                address: address,
                ownerId: user.uid,
                ownerPhone: normalizedPhone,
                approvalStatus: 'pending',
                botPhoneNumberId: `REPLACE_WITH_BOT_ID_${businessName.replace(/\s+/g, '-').toLowerCase()}`,
                businessType: finalUserData.businessType,
             };
        }
        
        const idToken = await user.getIdToken();
        const res = await fetch('/api/auth/complete-profile', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({
                finalUserData,
                businessData,
                businessType: finalUserData.businessType
            })
        });

        const result = await res.json();
        if (!res.ok) {
            throw new Error(result.message || 'An error occurred during profile setup.');
        }

        // --- THE FIX ---
        // Save role AND businessType to localStorage before redirecting
        localStorage.setItem('role', role);
        if (isBusinessOwner) {
          localStorage.setItem('businessType', businessType);
          router.push('/owner-dashboard');
        } else if (role === 'admin') {
          router.push('/admin-dashboard');
        } else {
          router.push('/customer-dashboard');
        }

    } catch (err) {
      console.error("Profile completion error:", err);
      setError(err.message);
      setLoading(false);
    }
  };

  const renderRoleFields = () => {
    const isBusinessOwner = role === 'restaurant-owner' || role === 'shop-owner';
    const businessLabel = role === 'restaurant-owner' ? 'Restaurant Name' : 'Shop Name';

    if (isBusinessOwner) {
       return (
          <motion.div variants={cardVariants} initial="hidden" animate="visible" className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">{businessLabel}</label>
              <div className="relative">
                <Store className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border focus:ring-primary focus:border-primary" />
              </div>
            </div>
            
            <div className="space-y-2 p-4 border border-dashed border-border rounded-lg">
                <h4 className="font-semibold flex items-center gap-2"><MapPin size={16}/> Business Address</h4>
                <input type="text" value={address.street} onChange={(e) => handleAddressChange('street', e.target.value)} placeholder="Street Address" required className="w-full p-2 rounded-md bg-input border border-border" />
                <div className="grid grid-cols-2 gap-2">
                    <input type="text" value={address.city} onChange={(e) => handleAddressChange('city', e.target.value)} placeholder="City" required className="w-full p-2 rounded-md bg-input border border-border" />
                    <input type="text" value={address.postalCode} onChange={(e) => handleAddressChange('postalCode', e.target.value)} placeholder="Postal Code" required className="w-full p-2 rounded-md bg-input border border-border" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <input type="text" value={address.state} onChange={(e) => handleAddressChange('state', e.target.value)} placeholder="State" required className="w-full p-2 rounded-md bg-input border border-border" />
                    <input type="text" value={address.country} onChange={(e) => handleAddressChange('country', e.target.value)} placeholder="Country" required className="w-full p-2 rounded-md bg-input border border-border" />
                </div>
            </div>

             <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Your Mobile Number (10 digits)</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border focus:ring-primary focus:border-primary" />
              </div>
            </div>
          </motion.div>
        );
    }
    
    switch (role) {
      case 'customer':
        return (
           <motion.div variants={cardVariants} initial="hidden" animate="visible" className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Mobile Number (10 digits)</label>
                 <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border focus:ring-primary focus:border-primary" />
                </div>
            </div>
           </motion.div>
        );
      case 'admin':
        return (
          <motion.div variants={cardVariants} initial="hidden" animate="visible" className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Mobile Number (10 digits)</label>
                 <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border focus:ring-primary focus:border-primary" />
                </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Secret Key</label>
               <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <input type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} required className="w-full pl-10 pr-4 py-2 rounded-md bg-input border border-border focus:ring-primary focus:border-primary" />
              </div>
            </div>
          </motion.div>
        );
      default:
        return null;
    }
  };

  if (loading && !error) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-background">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div>
        </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div
        className="w-full max-w-lg p-8 space-y-6 bg-card rounded-xl shadow-2xl shadow-primary/10 border border-border"
        variants={cardVariants}
        initial="hidden"
        animate="visible"
      >
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground">One Last Step!</h1>
          <p className="text-muted-foreground mt-2">Tell us a bit about yourself to get started.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">I am a...</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                {id: 'customer', label: 'Customer', icon: User},
                {id: 'restaurant-owner', label: 'Restaurant Owner', icon: Store},
                {id: 'shop-owner', label: 'Shop Owner', icon: ShoppingCart},
                {id: 'admin', label: 'Admin', icon: Shield}
              ].map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRole(r.id)}
                  className={`flex flex-col items-center justify-center p-4 rounded-md border-2 transition-all duration-200 ${
                    role === r.id ? 'border-primary bg-primary/10 shadow-lg' : 'border-border hover:border-primary/50'
                  }`}
                >
                  <r.icon className={`h-8 w-8 mb-2 ${role === r.id ? 'text-primary' : ''}`} />
                  <span className="font-semibold text-sm text-center">{r.label}</span>
                </button>
              ))}
            </div>
          </div>

          {renderRoleFields()}
          
          {error && <p className="text-red-500 text-sm text-center bg-red-500/10 p-3 rounded-md border border-red-500/20">{error}</p>}

          <div className="flex flex-col sm:flex-row items-center gap-4">
            <button
                type="submit"
                disabled={loading || !role}
                className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-transform"
            >
                {loading ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                ) : (
                    <>
                    Complete Profile <ArrowRight className="ml-2 h-5 w-5" />
                    </>
                )}
            </button>
            <button 
                type="button" 
                onClick={() => router.push('/contact')}
                className="w-full sm:w-auto flex justify-center items-center py-3 px-4 border rounded-md shadow-sm text-sm font-medium text-muted-foreground bg-muted hover:bg-muted/80 transition-colors"
            >
                <HelpCircle className="mr-2 h-5 w-5"/> Need Help?
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

    
