
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, PlusCircle, Trash2, IndianRupee, Loader2, Camera, FileJson } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useUser, useCollection, useMemoFirebase } from '@/firebase';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';
import InfoDialog from '@/components/InfoDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';

const MenuItem = ({ item, onToggle, onDelete }) => (
  <motion.div
    layout
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    className="bg-slate-800 rounded-lg p-4 flex justify-between items-center"
  >
    <div>
      <p className={`font-bold text-lg ${!item.available ? 'text-slate-500 line-through' : 'text-white'}`}>{item.name}</p>
      <p className="text-slate-400">₹{item.price || item.portions?.[0]?.price || 'N/A'}</p>
    </div>
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <label htmlFor={`switch-${item.id}`} className={`text-sm font-semibold ${item.available ? 'text-green-400' : 'text-slate-500'}`}>
          {item.available ? 'Available' : 'Out of Stock'}
        </label>
        <button
            onClick={() => onToggle(item.id, !item.available)}
            className={`w-14 h-8 rounded-full p-1 transition-colors ${item.available ? 'bg-green-600' : 'bg-slate-700'}`}
        >
            <motion.div
                layout
                className="w-6 h-6 bg-white rounded-full"
                animate={{ x: item.available ? 24 : 0 }}
                transition={{ type: 'spring', stiffness: 700, damping: 30 }}
            ></motion.div>
        </button>
      </div>
      <Button onClick={() => onDelete(item.id)} size="icon" variant="ghost" className="text-red-500 hover:bg-red-500/10">
        <Trash2 />
      </Button>
    </div>
  </motion.div>
);

const AddItemForm = ({ onAddItem, onCancel, vendorId }) => {
    const [name, setName] = useState('');
    const [price, setPrice] = useState('');
    const [category, setCategory] = useState('Snacks');
    const [isSaving, setIsSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if(!name || !price || isSaving) return;
        setIsSaving(true);
        try {
            await onAddItem({ name, price: parseFloat(price), category }, vendorId);
            onCancel(); 
        } catch (error) {
            // Error is handled by the parent
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={handleSubmit}
            className="bg-slate-800 rounded-lg p-6 space-y-4 mb-4 overflow-hidden"
        >
            <h3 className="text-xl font-bold">Add New Item</h3>
             <div>
                <label className="text-slate-400 block mb-1">Item Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} required className="w-full p-2 bg-slate-700 border border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
             <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="text-slate-400 block mb-1">Price (₹)</label>
                    <input type="number" value={price} onChange={e => setPrice(e.target.value)} required className="w-full p-2 bg-slate-700 border border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div>
                    <label className="text-slate-400 block mb-1">Category</label>
                    <input type="text" value={category} onChange={e => setCategory(e.target.value)} required className="w-full p-2 bg-slate-700 border border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
            </div>
            <div className="flex justify-end gap-4">
                <Button type="button" variant="ghost" onClick={onCancel} disabled={isSaving}>Cancel</Button>
                <Button type="submit" className="bg-primary hover:bg-primary/90 text-primary-foreground" disabled={isSaving}>
                    {isSaving ? <Loader2 className="animate-spin mr-2" /> : null}
                    {isSaving ? 'Saving...' : 'Save Item'}
                </Button>
            </div>
        </motion.form>
    )
}

const AiScanModal = ({ isOpen, onClose, onScan }) => {
    const [file, setFile] = useState(null);
    const [isScanning, setIsScanning] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef(null);

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            setFile(selectedFile);
            setError('');
        }
    };

    const handleScan = async () => {
        if (!file) {
            setError('Please select an image file first.');
            return;
        }
        setIsScanning(true);
        setError('');

        try {
            await onScan(file);
            onClose();
        } catch (err) {
            setError(err.message || "An unknown error occurred.");
        } finally {
            setIsScanning(false);
        }
    };
    
    useEffect(() => {
        if (!isOpen) {
            setFile(null);
            setError('');
            setIsScanning(false);
        }
    }, [isOpen]);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-slate-800 border-slate-700 text-white">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-3 text-2xl"><Camera className="text-primary"/> Scan Menu with AI</DialogTitle>
                    <DialogDescription>Upload an image of your menu, and our AI will automatically add the items for you.</DialogDescription>
                </DialogHeader>
                <div className="py-6 text-center">
                    <input type="file" accept="image/*" ref={inputRef} onChange={handleFileChange} className="hidden" />
                    <Button onClick={() => inputRef.current?.click()} variant="outline" className="w-full h-32 border-dashed border-2 border-slate-600 hover:border-primary hover:bg-slate-700/50 flex flex-col items-center justify-center">
                        <Camera size={32} className="mb-2"/>
                        {file ? 'Change Image' : 'Click to Upload Image'}
                    </Button>
                    {file && <p className="text-sm text-slate-400 mt-2">Selected: {file.name}</p>}
                    {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
                </div>
                 {isScanning && (
                    <div className="space-y-2">
                        <p className="text-sm text-center text-primary">AI is reading your menu... this may take a moment.</p>
                        <Progress value={50} className="w-full animate-pulse" />
                    </div>
                )}
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} disabled={isScanning}>Cancel</Button>
                    <Button onClick={handleScan} className="bg-primary hover:bg-primary/90 text-primary-foreground" disabled={!file || isScanning}>
                        {isScanning ? <Loader2 className="animate-spin mr-2"/> : null}
                        {isScanning ? 'Scanning...' : 'Start AI Scan'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


export default function StreetVendorMenuPage() {
    const { user, isUserLoading } = useUser();
    const [menuItems, setMenuItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddItem, setShowAddItem] = useState(false);
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const vendorQuery = useMemoFirebase(() => {
        if (!user) return null;
        return query(collection(db, 'street_vendors'), where('ownerId', '==', user.uid));
    }, [user]);

    const { data: vendorData, isLoading: isVendorLoading, error: vendorError } = useCollection(vendorQuery);
    
    const vendorId = useMemo(() => vendorData?.[0]?.id, [vendorData]);

    useEffect(() => {
        if (vendorError) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not load your vendor profile. ' + vendorError.message });
        }
    }, [vendorError]);
    
    const fetchMenu = useCallback(() => {
        if (!user || !vendorId) {
            setLoading(false);
            return () => {};
        }

        const menuCollectionRef = collection(db, 'street_vendors', vendorId, 'menu');
        const q = query(menuCollectionRef);

        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const items = [];
            querySnapshot.forEach((doc) => {
                items.push({ id: doc.id, ...doc.data() });
            });
            setMenuItems(items);
            setLoading(false);
        }, (err) => {
            const contextualError = new FirestorePermissionError({ path: menuCollectionRef.path, operation: 'list' });
            errorEmitter.emit('permission-error', contextualError);
            console.error("Firestore Error:", err);
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not load menu items. ' + err.message });
            setLoading(false);
        });

        return unsubscribe;
    }, [user, vendorId]);


    useEffect(() => {
        if (isUserLoading || isVendorLoading) return;
        const unsubscribe = fetchMenu();
        return () => unsubscribe && unsubscribe();
    }, [user, isUserLoading, vendorId, isVendorLoading, fetchMenu]);

    const handleToggleAvailability = async (itemId, newAvailability) => {
        if (!vendorId) {
             setInfoDialog({ isOpen: true, title: 'Error', message: 'Vendor ID not loaded yet. Please wait a moment.' });
             return;
        }
        const itemRef = doc(db, 'street_vendors', vendorId, 'menu', itemId);
        const updateData = { available: newAvailability };
        try {
            await updateDoc(itemRef, updateData)
        } catch(error) {
            errorEmitter.emit('permission-error', new FirestorePermissionError({
                path: itemRef.path,
                operation: 'update',
                requestResourceData: updateData
            }));
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not update item status: ' + error.message });
        };
    };

    const handleDeleteItem = async (itemId) => {
        if (!vendorId) {
             setInfoDialog({ isOpen: true, title: 'Error', message: 'Vendor ID not loaded yet. Please wait a moment.' });
             return;
        }
        if (!window.confirm("Are you sure you want to delete this item?")) return;
        const itemRef = doc(db, 'street_vendors', vendorId, 'menu', itemId);
        try {
            await deleteDoc(itemRef);
        } catch(error) {
            errorEmitter.emit('permission-error', new FirestorePermissionError({
                path: itemRef.path,
                operation: 'delete'
            }));
             setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not delete item: ' + error.message });
        }
    };
    
    const handleAddItem = useCallback(async (newItem, currentVendorId) => {
        if (!currentVendorId || !user) {
             setInfoDialog({ isOpen: true, title: 'Error', message: 'Vendor or user information not available yet. Please try again.' });
             throw new Error('Vendor or user information not available.');
        }
        
        const menuCollectionRef = collection(db, 'street_vendors', currentVendorId, 'menu');
        const newItemRef = doc(menuCollectionRef);
        const itemData = { 
            name: newItem.name,
            price: newItem.price,
            category: newItem.category,
            portions: [{ name: 'Full', price: newItem.price }],
            id: newItemRef.id,
            ownerId: user.uid,
            available: true 
        };

        try {
            await setDoc(newItemRef, itemData);
            setInfoDialog({ isOpen: true, title: 'Success', message: 'Item saved successfully!' });
        } catch (err) {
             errorEmitter.emit('permission-error', new FirestorePermissionError({
                path: newItemRef.path,
                operation: 'create',
                requestResourceData: itemData
            }));
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not save item: ' + err.message });
            throw err;
        }
    }, [user]);

    const handleAiScan = async (file) => {
        try {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = async () => {
                const imageDataUri = reader.result;
                const response = await fetch('/api/ai/scan-menu', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await user.getIdToken()}` },
                    body: JSON.stringify({ imageDataUri }),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message);
                setInfoDialog({ isOpen: true, title: 'Success!', message: result.message });
                fetchMenu();
            };
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'AI Scan Failed', message: error.message });
            throw error;
        }
    };

    const groupedMenu = menuItems.reduce((acc, item) => {
        const category = item.category || 'General';
        (acc[category] = acc[category] || []).push(item);
        return acc;
    }, {});

  return (
    <div className="min-h-screen bg-slate-900 text-white font-body p-4">
        <InfoDialog 
            isOpen={infoDialog.isOpen} 
            onClose={() => setInfoDialog({isOpen: false, title: '', message: ''})} 
            title={infoDialog.title} 
            message={infoDialog.message}
        />
        <AiScanModal isOpen={isAiModalOpen} onClose={() => setIsAiModalOpen(false)} onScan={handleAiScan} />

        <header className="flex justify-between items-center mb-6">
            <Link href="/street-vendor-dashboard" passHref>
                <Button variant="ghost" className="text-slate-400 hover:text-white">
                    <ArrowLeft size={28} />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold font-headline">My Menu</h1>
            <div className="flex gap-2">
                <Button onClick={() => setIsAiModalOpen(true)} variant="ghost" className="text-primary hover:text-primary">
                    <Camera size={28} />
                </Button>
                <Button onClick={() => setShowAddItem(true)} variant="ghost" className="text-primary hover:text-primary">
                    <PlusCircle size={28} />
                </Button>
            </div>
        </header>

        <main>
            <AnimatePresence>
                {showAddItem && <AddItemForm onAddItem={(newItem) => handleAddItem(newItem, vendorId)} onCancel={() => setShowAddItem(false)} vendorId={vendorId} />}
            </AnimatePresence>
            
            {(loading || isUserLoading || isVendorLoading) ? (
                 <div className="text-center py-20 text-slate-500">
                    <Loader2 className="mx-auto animate-spin" size={48} />
                    <p className="mt-4">Loading your menu...</p>
                 </div>
            ) : (
                <div className="space-y-6">
                    {Object.entries(groupedMenu).map(([category, items]) => (
                        <div key={category}>
                            <h2 className="text-xl font-bold text-primary mb-2">{category}</h2>
                            <div className="space-y-3">
                                {items.map(item => (
                                    <MenuItem key={item.id} item={item} onToggle={handleToggleAvailability} onDelete={handleDeleteItem} />
                                ))}
                            </div>
                        </div>
                    ))}
                     {Object.keys(groupedMenu).length === 0 && !showAddItem && (
                        <div className="text-center py-20 text-slate-500">
                            <p>Your menu is empty.</p>
                            <p>Click the <PlusCircle className="inline" size={16}/> button to add an item, or use the <Camera className="inline" size={16}/> to scan your menu with AI.</p>
                        </div>
                    )}
                </div>
            )}
        </main>
    </div>
  );
}
