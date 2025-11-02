
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

const DeliverySettingsPageContent = () => {
    const router = useRouter();
    const [isAccepting, setIsAccepting] = useState(true);
    const [deliveryRadius, setDeliveryRadius] = useState([5]);
    const [feeType, setFeeType] = useState('fixed');
    const [fixedFee, setFixedFee] = useState(30);
    const [perKmFee, setPerKmFee] = useState(5);
    const [freeDeliveryThreshold, setFreeDeliveryThreshold] = useState(500);
    const [isSaving, setIsSaving] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    // In a real app, you would fetch these settings from your backend
    // useEffect(() => { ... fetch settings ... }, []);

    const handleSave = async () => {
        setIsSaving(true);
        // Here you would make an API call to save the settings
        console.log({
            isAccepting,
            deliveryRadius: deliveryRadius[0],
            feeType,
            fixedFee,
            perKmFee,
            freeDeliveryThreshold,
        });
        await new Promise(res => setTimeout(res, 1000)); // Simulate API call
        setIsSaving(false);
        setInfoDialog({ isOpen: true, title: 'Success', message: 'Delivery settings saved successfully!' });
    };
    
    return (
        <div className="p-4 md:p-6 space-y-6">
            <InfoDialog isOpen={infoDialog.isOpen} onClose={() => setInfoDialog({isOpen: false, title: '', message: ''})} title={infoDialog.title} message={infoDialog.message} />
            <header className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.back()}><ArrowLeft/></Button>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Delivery Settings</h1>
                    <p className="text-muted-foreground mt-1">Control every aspect of your delivery service.</p>
                </div>
            </header>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><ToggleRight/> Order Acceptance</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                            <Label htmlFor="accepting-orders" className="flex flex-col">
                                <span className="font-bold text-lg">Accepting Delivery Orders</span>
                                <span className="text-sm text-muted-foreground">Turn this off to temporarily stop all new delivery orders.</span>
                            </Label>
                            <Switch id="accepting-orders" checked={isAccepting} onCheckedChange={setIsAccepting} className="data-[state=checked]:bg-green-500"/>
                        </div>
                    </CardContent>
                </Card>
            </motion.div>
            
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><MapIcon/> Service Area</CardTitle>
                        <CardDescription>Set the maximum distance you are willing to deliver to.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6">
                        <Label htmlFor="delivery-radius">Delivery Radius: <span className="font-bold text-primary text-lg">{deliveryRadius[0]} km</span></Label>
                        <Slider
                            id="delivery-radius"
                            value={deliveryRadius}
                            onValueChange={setDeliveryRadius}
                            max={20}
                            step={1}
                            className="mt-4"
                        />
                    </CardContent>
                </Card>
            </motion.div>

             <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2"><IndianRupee/> Delivery Charges</CardTitle>
                        <CardDescription>Choose your delivery fee structure.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <RadioGroup value={feeType} onValueChange={setFeeType} className="space-y-4">
                            <div className="p-4 rounded-lg border has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="fixed" className="font-semibold flex items-center gap-3 cursor-pointer">
                                        <RadioGroupItem value="fixed" id="fixed" />
                                        Fixed Fee
                                    </Label>
                                    <div className="flex items-center gap-2 w-32">
                                        <span>₹</span>
                                        <Input type="number" value={fixedFee} onChange={e => setFixedFee(Number(e.target.value))} disabled={feeType !== 'fixed'}/>
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
                                        <Input type="number" value={perKmFee} onChange={e => setPerKmFee(Number(e.target.value))} disabled={feeType !== 'per-km'}/>
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
                                        <Input type="number" value={freeDeliveryThreshold} onChange={e => setFreeDeliveryThreshold(Number(e.target.value))} disabled={feeType !== 'free-over'}/>
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
