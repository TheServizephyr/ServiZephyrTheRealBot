'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Bot, PlusCircle, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/firebase';

const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { staggerChildren: 0.1, duration: 0.5 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1 },
};

const ConnectionCard = ({ restaurantName, whatsAppNumber, status }) => (
  <motion.div
    variants={itemVariants}
    className="bg-card border border-border rounded-xl p-6 flex items-center justify-between"
  >
    <div>
      <h3 className="text-lg font-bold text-foreground">{restaurantName}</h3>
      <p className="text-sm text-muted-foreground mt-1">{whatsAppNumber}</p>
    </div>
    <div className="flex items-center gap-2">
      {status === 'Connected' ? (
        <CheckCircle className="text-green-500" />
      ) : (
        <AlertCircle className="text-yellow-500" />
      )}
      <span className={`font-semibold ${status === 'Connected' ? 'text-green-500' : 'text-yellow-500'}`}>
        {status}
      </span>
    </div>
  </motion.div>
);

export default function ConnectionsPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [connections, setConnections] = useState([]); // This will be fetched from backend later

  useEffect(() => {
    // Load the Facebook SDK script
    (function(d, s, id){
       var js, fjs = d.getElementsByTagName(s)[0];
       if (d.getElementById(id)) {return;}
       js = d.createElement(s); js.id = id;
       js.src = "https://connect.facebook.net/en_US/sdk.js";
       fjs.parentNode.insertBefore(js, fjs);
     }(document, 'script', 'facebook-jssdk'));

    // Initialize the SDK after it loads
    window.fbAsyncInit = function() {
      // **FIX:** Directly use the environment variable. It's safe because it starts with NEXT_PUBLIC_.
      const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
      if (!appId) {
        console.error("CRITICAL: NEXT_PUBLIC_FACEBOOK_APP_ID is not defined!");
        setError("Facebook App ID is not configured. Please contact support.");
        return;
      }
      window.FB.init({
        appId            : appId,
        xfbml            : true,
        version          : 'v19.0'
      });
      window.FB.AppEvents.logPageView();
    };

    setConnections([]);
  }, []);

  const sendCodeToBackend = async (authCode) => {
    setError('');
    setLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("You must be logged in to connect a bot.");
      
      const idToken = await user.getIdToken();
      
      const response = await fetch('/api/owner/whatsapp-onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ code: authCode }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to connect WhatsApp bot.");
      }

      alert("WhatsApp bot connected successfully! Refreshing connections...");
      window.location.reload(); 

    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFacebookLogin = () => {
    if (loading) return;

    if (!window.FB) {
      setError("Facebook SDK not loaded. Please refresh the page.");
      return;
    }
    
    if (!process.env.NEXT_PUBLIC_FACEBOOK_APP_ID) {
      setError("Facebook App ID is not configured. Please contact support.");
      return;
    }

    const config_id = "808539835091857";
    const scopes = 'whatsapp_business_management,business_management';

    window.FB.login(function(response) {
      if (response.authResponse && response.authResponse.code) {
        const authCode = response.authResponse.code;
        console.log("Received auth code from Facebook:", authCode);
        sendCodeToBackend(authCode);
      } else {
        console.log('User cancelled login or did not fully authorize.');
        setError('Login cancelled or not fully authorized.');
      }
    }, {
      config_id: config_id, 
      response_type: 'code',
      override_default_response_type: true,
      scope: scopes
    });
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="p-4 md:p-6 text-foreground min-h-screen bg-background space-y-6"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your WhatsApp Bot Connections</h1>
          <p className="text-muted-foreground mt-1">Manage your restaurant's WhatsApp bots here.</p>
        </div>
        <Button onClick={handleFacebookLogin} disabled={loading} className="bg-primary hover:bg-primary/90 text-primary-foreground">
          <PlusCircle size={20} className="mr-2" />
          {loading ? 'Connecting...' : 'Connect a New WhatsApp Bot'}
        </Button>
      </div>

      {error && (
        <div className="p-4 bg-destructive/10 text-destructive-foreground border border-destructive/30 rounded-lg">
          <p><strong>Error:</strong> {error}</p>
        </div>
      )}

      <div className="space-y-4">
        {connections.length > 0 ? (
          connections.map(conn => (
            <ConnectionCard key={conn.id} {...conn} />
          ))
        ) : (
          <div className="text-center py-16 text-muted-foreground border-2 border-dashed border-border rounded-xl">
            <Bot size={48} className="mx-auto" />
            <p className="mt-4 text-lg font-semibold">No WhatsApp Bots Connected</p>
            <p>Click the button above to connect your first bot and start receiving orders.</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
