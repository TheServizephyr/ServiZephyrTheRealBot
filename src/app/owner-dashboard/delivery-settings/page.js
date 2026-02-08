
'use client';

import { useState, useEffect, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Truck, Map as MapIcon, IndianRupee, ToggleRight, Settings, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import InfoDialog from '@/components/InfoDialog';
import { auth } from '@/lib/firebase';

export const dynamic = 'force-dynamic';

function DeliverySettingsPageContent() {
    const router = useRouter();
    const [settings, setSettings] = useState({
        deliveryEnabled: true,
        deliveryRadius: [5],
        deliveryFeeType: 'fixed',
        deliveryFixedFee: 30,
        deliveryPerKmFee: 5,
        deliveryFreeThreshold: 500,
        // NEW: Road factor & free zone
        roadDistanceFactor: 1.0,
        freeDeliveryRadius: 0,
        freeDeliveryMinOrder: 0,
    });
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    useEffect(() => {
        const fetchSettings = async () => {
            setLoading(true);
            try {
                const user = auth.currentUser;
                if (!user) {
                    router.push('/');
                    return;
                }
                const idToken = await user.getIdToken();
                const res = await fetch('/api/owner/delivery-settings', {
                    headers: { 'Authorization': `Bearer ${idToken}` }
                });
                if (!res.ok) throw new Error("Failed to load settings.");
                const data = await res.json();
                setSettings({
                    deliveryEnabled: data.deliveryEnabled,
                    deliveryRadius: [data.deliveryRadius],
                    deliveryFeeType: data.deliveryFeeType,
                    deliveryFixedFee: data.deliveryFixedFee,
                    deliveryPerKmFee: data.deliveryPerKmFee,
                    deliveryFreeThreshold: data.deliveryFreeThreshold,
                    // NEW: Road factor & free zone
                    roadDistanceFactor: data.roadDistanceFactor || 1.0,
                    freeDeliveryRadius: data.freeDeliveryRadius || 0,
                    freeDeliveryMinOrder: data.freeDeliveryMinOrder || 0,
                });
            } catch (error) {
                setInfoDialog({ isOpen: true, title: 'Error', message: `Could not load settings: ${error.message}` });
            } finally {
                setLoading(false);
            }
        };

        const unsubscribe = auth.onAuthStateChanged(user => {
            if (user) fetchSettings();
            else setLoading(false);
        });

        return () => unsubscribe();
    }, [router]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Not authenticated.");
            const idToken = await user.getIdToken();

            const payload = {
                deliveryEnabled: settings.deliveryEnabled,
                deliveryRadius: settings.deliveryRadius[0],
                deliveryFeeType: settings.deliveryFeeType,
                deliveryFixedFee: Number(settings.deliveryFixedFee),
                deliveryPerKmFee: Number(settings.deliveryPerKmFee),
                deliveryFreeThreshold: Number(settings.deliveryFreeThreshold),
                // NEW: Road factor & free zone
                roadDistanceFactor: Number(settings.roadDistanceFactor),
                freeDeliveryRadius: Number(settings.freeDeliveryRadius),
                freeDeliveryMinOrder: Number(settings.freeDeliveryMinOrder),
            };

            const response = await fetch('/api/owner/delivery-settings', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to save settings');
            }

            setInfoDialog({ isOpen: true, title: 'Success', message: 'Delivery settings saved successfully!' });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: `Could not save settings: ${error.message}` });
        } finally {
            setIsSaving(false);
        }
    };

    const handleSettingChange = (key, value) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    }

    if (loading) {
        return (
            <div className="flex h-screen w-full items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
        )
    }

    return (
        <div className="p-4 md:p-6 space-y-6">
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })} title={infoDialog.title} message={infoDialog.message} />
            <header className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.back()}><ArrowLeft /></Button>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Delivery Settings</h1>
                    <p className="text-muted-foreground mt-1">Control every aspect of your delivery service.</p>
                </div>
            </header>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><ToggleRight /> Order Acceptance</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                            <Label htmlFor="accepting-orders" className="flex flex-col">
                                <span className="font-bold text-lg">Accepting Delivery Orders</span>
                                <span className="text-sm text-muted-foreground">Turn this off to temporarily stop all new delivery orders.</span>
                            </Label>
                            <Switch id="accepting-orders" checked={settings.deliveryEnabled} onCheckedChange={(val) => handleSettingChange('deliveryEnabled', val)} className="data-[state=checked]:bg-green-500" />
                        </div>
                    </CardContent>
                </Card>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><MapIcon /> Service Area</CardTitle>
                        <CardDescription>Set the maximum distance you are willing to deliver to.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6">
                        <Label htmlFor="delivery-radius">Delivery Radius: <span className="font-bold text-primary text-lg">{settings.deliveryRadius[0]} km</span></Label>
                        <Slider
                            id="delivery-radius"
                            value={settings.deliveryRadius}
                            onValueChange={(val) => handleSettingChange('deliveryRadius', val)}
                            max={20}
                            step={1}
                            className="mt-4"
                        />
                    </CardContent>
                </Card>
            </motion.div>

            {/* NEW: Road Distance Factor (Optional) */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15 }}>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Settings /> Road Distance Factor (Optional)</CardTitle>
                        <CardDescription>Adjust aerial distance to estimate real road distance based on your area's road network.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                            <p className="text-sm text-muted-foreground">
                                <strong>What is this?</strong> Aerial distance is shorter than actual road distance. Set a multiplier to account for detours:
                            </p>
                            <ul className="text-xs text-muted-foreground space-y-1 pl-4">
                                <li>• <strong>1.0</strong> = Use aerial distance only (no adjustment)</li>
                                <li>• <strong>1.2-1.4</strong> = Normal city with straight roads</li>
                                <li>• <strong>1.5-1.7</strong> = Dense area with many turns</li>
                                <li>• <strong>1.8-2.0</strong> = Very complex road network</li>
                            </ul>
                        </div>
                        <div className="space-y-3">
                            <Label htmlFor="road-factor">
                                Multiplier: <span className="font-bold text-primary text-lg">{settings.roadDistanceFactor.toFixed(1)}x</span>
                                {settings.roadDistanceFactor === 1.0 && <span className="text-xs text-muted-foreground ml-2">(Disabled - using aerial distance)</span>}
                            </Label>
                            <Slider
                                id="road-factor"
                                value={[settings.roadDistanceFactor]}
                                onValueChange={(val) => handleSettingChange('roadDistanceFactor', val[0])}
                                min={1.0}
                                max={2.0}
                                step={0.1}
                                className="mt-2"
                            />
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>1.0x (Off)</span>
                                <span>2.0x (Max)</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </motion.div>

            {/* NEW: Free Delivery Zone */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.17 }}>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><Truck /> Free Delivery Zone (Optional)</CardTitle>
                        <CardDescription>Offer free delivery within a specific radius for orders above a minimum amount.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-3">
                            <Label htmlFor="free-zone-radius">
                                Free Zone Radius: <span className="font-bold text-primary text-lg">{settings.freeDeliveryRadius} km</span>
                                {settings.freeDeliveryRadius === 0 && <span className="text-xs text-muted-foreground ml-2">(Disabled)</span>}
                            </Label>
                            <Slider
                                id="free-zone-radius"
                                value={[settings.freeDeliveryRadius]}
                                onValueChange={(val) => handleSettingChange('freeDeliveryRadius', val[0])}
                                min={0}
                                max={settings.deliveryRadius[0]}
                                step={0.5}
                                className="mt-2"
                            />
                            <p className="text-xs text-muted-foreground">
                                Customers within this radius get free delivery (if they meet minimum order)
                            </p>
                        </div>

                        <div className="space-y-3">
                            <Label htmlFor="free-zone-min">
                                Minimum Order for Free Delivery: <span className="font-bold text-primary text-lg">₹{settings.freeDeliveryMinOrder}</span>
                            </Label>
                            <Input
                                id="free-zone-min"
                                type="number"
                                value={settings.freeDeliveryMinOrder}
                                onChange={(e) => handleSettingChange('freeDeliveryMinOrder', Number(e.target.value))}
                                placeholder="e.g., 199"
                                min="0"
                            />
                            <p className="text-xs text-muted-foreground">
                                Orders ≥ this amount within free zone get zero delivery charge
                            </p>
                        </div>

                        {settings.freeDeliveryRadius > 0 && settings.freeDeliveryMinOrder > 0 && (
                            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                                <p className="text-sm text-green-600 dark:text-green-400">
                                    ✓ Free delivery active: Within <strong>{settings.freeDeliveryRadius}km</strong> for orders ≥<strong>₹{settings.freeDeliveryMinOrder}</strong>
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><IndianRupee /> Delivery Charges</CardTitle>
                        <CardDescription>Choose your delivery fee structure.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <RadioGroup value={settings.deliveryFeeType} onValueChange={(val) => handleSettingChange('deliveryFeeType', val)} className="space-y-4">
                            <div className="p-4 rounded-lg border has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="fixed" className="font-semibold flex items-center gap-3 cursor-pointer">
                                        <RadioGroupItem value="fixed" id="fixed" />
                                        Fixed Fee
                                    </Label>
                                    <div className="flex items-center gap-2 w-32">
                                        <span>₹</span>
                                        <Input type="number" value={settings.deliveryFixedFee} onChange={e => handleSettingChange('deliveryFixedFee', e.target.value)} disabled={settings.deliveryFeeType !== 'fixed'} />
                                    </div>
                                </div>
                                <p className="text-xs text-muted-foreground mt-2 pl-8">Charge a single, flat rate for all deliveries.</p>
                            </div>

                            <div className="p-4 rounded-lg border has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="per-km" className="font-semibold flex items-center gap-3 cursor-pointer">
                                        <RadioGroupItem value="per-km" id="per-km" />
                                        Per-Kilometer Fee
                                    </Label>
                                    <div className="flex items-center gap-2 w-32">
                                        <span>₹</span>
                                        <Input type="number" value={settings.deliveryPerKmFee} onChange={e => handleSettingChange('deliveryPerKmFee', e.target.value)} disabled={settings.deliveryFeeType !== 'per-km'} />
                                        <span className="text-muted-foreground text-sm">/km</span>
                                    </div>
                                </div>
                                <p className="text-xs text-muted-foreground mt-2 pl-8">Charge based on the delivery distance.</p>
                            </div>

                            <div className="p-4 rounded-lg border has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="free-over" className="font-semibold flex items-center gap-3 cursor-pointer">
                                        <RadioGroupItem value="free-over" id="free-over" />
                                        Free Delivery Over
                                    </Label>
                                    <div className="flex items-center gap-2 w-32">
                                        <span>₹</span>
                                        <Input type="number" value={settings.deliveryFreeThreshold} onChange={e => handleSettingChange('deliveryFreeThreshold', e.target.value)} disabled={settings.deliveryFeeType !== 'free-over'} />
                                    </div>
                                </div>
                                <p className="text-xs text-muted-foreground mt-2 pl-8">Offer free delivery for orders above a certain value.</p>
                            </div>
                        </RadioGroup>
                    </CardContent>
                    <CardFooter className="border-t pt-6">
                        <Button onClick={handleSave} disabled={isSaving} className="w-full md:w-auto ml-auto bg-primary hover:bg-primary/90">
                            <Save className="mr-2 h-4 w-4" /> {isSaving ? 'Saving...' : 'Save Settings'}
                        </Button>
                    </CardFooter>
                </Card>
            </motion.div>
        </div>
    );
};

export default function DeliverySettingsPage() {
    return (
        <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
            <DeliverySettingsPageContent />
        </Suspense>
    )
}
