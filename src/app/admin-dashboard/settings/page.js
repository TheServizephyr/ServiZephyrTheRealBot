'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { motion } from 'framer-motion';
import { Save, Bot, Building2, MapPin, ShieldCheck, Mail, Phone } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import InfoDialog from '@/components/InfoDialog';

const defaultConfig = {
    platformName: 'ServiZephyr',
    legalBusinessName: 'ServiZephyr',
    address: {
        street: '',
        city: '',
        state: '',
        postalCode: '',
        country: 'IN',
    },
    businessWhatsappNumber: '',
    botPhoneNumberId: '',
    botDisplayNumber: '',
    gstin: '',
    supportEmail: '',
    supportPhone: '',
    adminUserIds: [],
    mailboxCollectionName: 'error_reports',
    reportsCollectionName: 'error_reports',
    conversationsCollectionName: 'admin_conversations',
    notes: '',
};

export default function AdminSettingsPage() {
    const [config, setConfig] = useState(defaultConfig);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const adminIdsText = useMemo(() => (config.adminUserIds || []).join('\n'), [config.adminUserIds]);

    useEffect(() => {
        const fetchConfig = async () => {
            setLoading(true);
            try {
                const currentUser = auth.currentUser;
                if (!currentUser) throw new Error('Authentication required.');
                const idToken = await currentUser.getIdToken();
                const response = await fetch('/api/admin/settings', {
                    headers: { Authorization: `Bearer ${idToken}` },
                });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.message || 'Failed to load admin settings.');
                }
                const data = await response.json();
                setConfig({
                    ...defaultConfig,
                    ...data,
                    address: { ...defaultConfig.address, ...(data.address || {}) },
                });
            } catch (error) {
                setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
            } finally {
                setLoading(false);
            }
        };

        fetchConfig();
    }, []);

    const setAddressField = (field, value) => {
        setConfig((prev) => ({
            ...prev,
            address: {
                ...prev.address,
                [field]: value,
            },
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const currentUser = auth.currentUser;
            if (!currentUser) throw new Error('Authentication required.');
            const idToken = await currentUser.getIdToken();

            const payload = {
                ...config,
                adminUserIds: adminIdsText
                    .split(/\r?\n|,/)
                    .map((value) => value.trim())
                    .filter(Boolean),
            };

            const response = await fetch('/api/admin/settings', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to save admin settings.');
            }

            const data = await response.json();
            setConfig({
                ...defaultConfig,
                ...data,
                address: { ...defaultConfig.address, ...(data.address || {}) },
            });
            setInfoDialog({ isOpen: true, title: 'Saved', message: 'Admin system settings updated successfully.' });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-[60vh]">
                <div className="animate-spin rounded-full h-14 w-14 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <InfoDialog
                isOpen={infoDialog.isOpen}
                onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
                title={infoDialog.title}
                message={infoDialog.message}
            />

            <h1 className="text-3xl font-bold tracking-tight">Platform Settings</h1>

            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Building2 className="h-5 w-5" />
                            ServiZephyr Admin Business Profile
                        </CardTitle>
                        <CardDescription>
                            This document is the shared source of truth for the ServiZephyr admin business identity, global bot config, admin roster, mailbox bindings, and future system-wide OTP / cancellation messaging.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-4">
                            <div>
                                <Label htmlFor="platformName">Platform Name</Label>
                                <Input id="platformName" value={config.platformName} onChange={(e) => setConfig((prev) => ({ ...prev, platformName: e.target.value }))} />
                            </div>
                            <div>
                                <Label htmlFor="legalBusinessName">Legal Business Name</Label>
                                <Input id="legalBusinessName" value={config.legalBusinessName} onChange={(e) => setConfig((prev) => ({ ...prev, legalBusinessName: e.target.value }))} />
                            </div>
                            <div>
                                <Label htmlFor="gstin">GST Number</Label>
                                <Input id="gstin" value={config.gstin} onChange={(e) => setConfig((prev) => ({ ...prev, gstin: e.target.value }))} placeholder="e.g. 27ABCDE1234F1Z5" />
                            </div>
                            <div>
                                <Label htmlFor="street" className="flex items-center gap-2">
                                    <MapPin className="h-4 w-4" />
                                    Street Address
                                </Label>
                                <Input id="street" value={config.address.street} onChange={(e) => setAddressField('street', e.target.value)} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor="city">City</Label>
                                    <Input id="city" value={config.address.city} onChange={(e) => setAddressField('city', e.target.value)} />
                                </div>
                                <div>
                                    <Label htmlFor="state">State</Label>
                                    <Input id="state" value={config.address.state} onChange={(e) => setAddressField('state', e.target.value)} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor="postalCode">Postal Code</Label>
                                    <Input id="postalCode" value={config.address.postalCode} onChange={(e) => setAddressField('postalCode', e.target.value)} />
                                </div>
                                <div>
                                    <Label htmlFor="country">Country</Label>
                                    <Input id="country" value={config.address.country} onChange={(e) => setAddressField('country', e.target.value)} />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <Label htmlFor="businessWhatsappNumber" className="flex items-center gap-2">
                                    <Phone className="h-4 w-4" />
                                    Business WhatsApp Number
                                </Label>
                                <Input id="businessWhatsappNumber" value={config.businessWhatsappNumber} onChange={(e) => setConfig((prev) => ({ ...prev, businessWhatsappNumber: e.target.value }))} placeholder="e.g. 919876543210" />
                            </div>
                            <div>
                                <Label htmlFor="botPhoneNumberId" className="flex items-center gap-2">
                                    <Bot className="h-4 w-4" />
                                    Common Admin Bot Phone Number ID
                                </Label>
                                <Input id="botPhoneNumberId" value={config.botPhoneNumberId} onChange={(e) => setConfig((prev) => ({ ...prev, botPhoneNumberId: e.target.value }))} />
                            </div>
                            <div>
                                <Label htmlFor="botDisplayNumber">Bot Display Number</Label>
                                <Input id="botDisplayNumber" value={config.botDisplayNumber} onChange={(e) => setConfig((prev) => ({ ...prev, botDisplayNumber: e.target.value }))} />
                            </div>
                            <div>
                                <Label htmlFor="supportEmail" className="flex items-center gap-2">
                                    <Mail className="h-4 w-4" />
                                    Support Email
                                </Label>
                                <Input id="supportEmail" value={config.supportEmail} onChange={(e) => setConfig((prev) => ({ ...prev, supportEmail: e.target.value }))} />
                            </div>
                            <div>
                                <Label htmlFor="supportPhone">Support Phone</Label>
                                <Input id="supportPhone" value={config.supportPhone} onChange={(e) => setConfig((prev) => ({ ...prev, supportPhone: e.target.value }))} />
                            </div>
                            <div>
                                <Label htmlFor="adminUserIds" className="flex items-center gap-2">
                                    <ShieldCheck className="h-4 w-4" />
                                    Registered Admin User IDs
                                </Label>
                                <Textarea
                                    id="adminUserIds"
                                    value={adminIdsText}
                                    onChange={(e) => setConfig((prev) => ({
                                        ...prev,
                                        adminUserIds: e.target.value.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean),
                                    }))}
                                    rows={5}
                                    placeholder="One admin UID per line"
                                />
                            </div>
                        </div>
                    </CardContent>
                    <CardContent className="grid gap-4 md:grid-cols-3">
                        <div>
                            <Label htmlFor="mailboxCollectionName">Mailbox Collection</Label>
                            <Input id="mailboxCollectionName" value={config.mailboxCollectionName} onChange={(e) => setConfig((prev) => ({ ...prev, mailboxCollectionName: e.target.value }))} />
                        </div>
                        <div>
                            <Label htmlFor="reportsCollectionName">Reports Collection</Label>
                            <Input id="reportsCollectionName" value={config.reportsCollectionName} onChange={(e) => setConfig((prev) => ({ ...prev, reportsCollectionName: e.target.value }))} />
                        </div>
                        <div>
                            <Label htmlFor="conversationsCollectionName">Admin WhatsApp Conversations Collection</Label>
                            <Input id="conversationsCollectionName" value={config.conversationsCollectionName} onChange={(e) => setConfig((prev) => ({ ...prev, conversationsCollectionName: e.target.value }))} />
                        </div>
                    </CardContent>
                    <CardContent>
                        <div>
                            <Label htmlFor="notes">System Notes</Label>
                            <Textarea
                                id="notes"
                                value={config.notes}
                                onChange={(e) => setConfig((prev) => ({ ...prev, notes: e.target.value }))}
                                rows={4}
                                placeholder="Document platform bot rules, migration notes, or ops instructions."
                            />
                        </div>
                    </CardContent>
                    <CardFooter className="border-t px-6 py-4">
                        <Button onClick={handleSave} disabled={saving}>
                            <Save className="mr-2 h-4 w-4" />
                            {saving ? 'Saving...' : 'Save Platform Settings'}
                        </Button>
                    </CardFooter>
                </Card>
            </motion.div>
        </div>
    );
}
