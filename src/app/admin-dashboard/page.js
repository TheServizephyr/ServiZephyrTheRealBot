
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { LogOut, Shield } from 'lucide-react';

export default function AdminDashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        router.push('/');
      }
      setLoading(false);
    });

    // Also check role from localStorage for quick feedback
    const role = localStorage.getItem('role');
    if (role && role !== 'admin') {
        // Redirect if role is not admin
        router.push('/');
    }


    return () => unsubscribe();
  }, [router]);

  const handleLogout = async () => {
    await auth.signOut();
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
        <Shield className="w-24 h-24 text-primary mb-4"/>
        <h1 className="text-4xl font-bold text-foreground">Welcome, Administrator!</h1>
        <p className="mt-4 text-lg text-muted-foreground">
            This is the Admin dashboard. You can manage system settings here.
        </p>
        <p className="mt-2 text-muted-foreground">Logged in as: {user?.email}</p>
        <button 
            onClick={handleLogout} 
            className="mt-8 flex items-center gap-2 px-6 py-3 rounded-md bg-card border border-border text-lg font-medium hover:bg-muted"
        >
            <LogOut className="w-5 h-5" /> Logout
        </button>
    </div>
  );
}
