'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, Bell, Trash2, KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { useState } from 'react';

const SectionCard = ({ title, description, children, footer }) => (
    <motion.div 
        className="bg-card border border-border rounded-xl"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
    >
        <div className="p-6 border-b border-border">
            <h2 className="text-xl font-bold text-foreground">{title}</h2>
            {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        <div className="p-6">
            {children}
        </div>
        {footer && <div className="p-6 bg-muted/30 border-t border-border rounded-b-xl">{footer}</div>}
    </motion.div>
);

export default function CustomerSettingsPage() {
    const router = useRouter();
    const [notifications, setNotifications] = useState({
        orderUpdates: true,
        promotions: true,
        communityAlerts: false,
    });

    const handleNotificationChange = (key) => {
        setNotifications(prev => ({...prev, [key]: !prev[key]}));
    }

    return (
        <div className="p-4 md:p-6 space-y-6">
            <header className="flex items-center gap-4">
                 <Button variant="ghost" size="icon" onClick={() => router.push('/customer-dashboard/profile')}><ArrowLeft/></Button>
                 <div>
                    <h1 className="text-3xl font-bold tracking-tight">Account Settings</h1>
                    <p className="text-muted-foreground mt-1">Manage your notification preferences and account security.</p>
                 </div>
            </header>

            <SectionCard
                title="Notification Settings"
                description="Choose how you want to be notified."
                footer={
                    <div className="flex justify-end">
                        <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">Save Changes</Button>
                    </div>
                }
            >
                 <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <Label htmlFor="orderUpdates" className="flex flex-col">
                            <span>Order Status Updates</span>
                            <span className="text-xs text-muted-foreground">Real-time alerts for your orders.</span>
                        </Label>
                        <Switch id="orderUpdates" checked={notifications.orderUpdates} onCheckedChange={() => handleNotificationChange('orderUpdates')} />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                         <Label htmlFor="promotions" className="flex flex-col">
                            <span>Promotions & Offers</span>
                            <span className="text-xs text-muted-foreground">Receive special deals from restaurants.</span>
                        </Label>
                        <Switch id="promotions" checked={notifications.promotions} onCheckedChange={() => handleNotificationChange('promotions')} />
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                         <Label htmlFor="communityAlerts" className="flex flex-col">
                            <span>Community Alerts</span>
                            <span className="text-xs text-muted-foreground">Get notified about relevant community posts.</span>
                        </Label>
                        <Switch id="communityAlerts" checked={notifications.communityAlerts} onCheckedChange={() => handleNotificationChange('communityAlerts')} />
                    </div>
                </div>
            </SectionCard>
            
             <SectionCard
                title="Account Security"
                description="Manage your password and other security settings."
            >
                <div className="space-y-4">
                    <Button variant="outline" className="w-full justify-start text-left">
                        <KeyRound className="mr-4 h-5 w-5"/>
                        Change Password
                    </Button>
                </div>
            </SectionCard>
            
             <SectionCard
                title="Danger Zone"
                description="Irreversible account actions."
            >
                 <div className="flex justify-between items-center bg-destructive/10 p-4 rounded-lg border border-destructive/30">
                    <div>
                        <h3 className="font-bold text-destructive-foreground">Delete Account</h3>
                        <p className="text-sm text-destructive-foreground/80">Permanently delete your account and all associated data.</p>
                    </div>
                    <Button variant="destructive">
                        <Trash2 className="mr-2 h-4 w-4"/> Delete
                    </Button>
                </div>
            </SectionCard>
        </div>
    );
}
