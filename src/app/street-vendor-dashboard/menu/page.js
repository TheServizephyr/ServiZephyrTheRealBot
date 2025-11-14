'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, PlusCircle, Trash2, IndianRupee, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useUser, useDoc, useMemoFirebase } from '@/firebase';
import { db } from '@/lib/firebase';
import { collection, query, onSnapshot, doc, updateDoc, deleteDoc, setDoc } from 'firebase/firestore';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';
import InfoDialog from '@/components/InfoDialog';


const MenuItem = ({ item, onToggle, onDelete }) => (
  <motion.div
    layout
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    className="bg-slate-800 rounded-lg p-4 flex justify-between items-center"
  >
    <div>
      <p className={`font-bold text-lg ${!item.available ? 'text-slate-500 line-through' : 'text-white'}`}>{item.name}</p>
      <p className="text-slate-400">₹{item.price}</p>
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

const AddItemForm = ({ onAddItem, onCancel }) => {
    const [name, setName] = useState('');
    const [price, setPrice] = useState('');
    const [category, setCategory] = useState('Snacks');
    const [isSaving, setIsSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if(!name || !price || isSaving) return;
        setIsSaving(true);
        try {
            await onAddItem({ name, price: parseFloat(price), category });
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

export default function StreetVendorMenuPage() {
    const { user, isUserLoading } = useUser();
    const [menuItems, setMenuItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddItem, setShowAddItem] = useState(false);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

    const vendorDocRef = useMemoFirebase(() => {
        if (!user) return null;
        return doc(db, 'street_vendors', user.uid);
    }, [user]);

    const { data: vendorData, isLoading: isVendorLoading, error: vendorError } = useDoc(vendorDocRef);

    useEffect(() => {
        if (vendorError) {
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not load your vendor profile. ' + vendorError.message });
        }
    }, [vendorError]);
    
    useEffect(() => {
        if (isUserLoading || isVendorLoading) return;
        if (!user || !vendorData) {
            setLoading(false);
            return;
        }

        const menuCollectionRef = collection(db, 'street_vendors', vendorData.id, 'menu');
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

        return () => unsubscribe();
    }, [user, isUserLoading, vendorData, isVendorLoading]);

    const handleToggleAvailability = async (itemId, newAvailability) => {
        if (!vendorData?.id) {
             setInfoDialog({ isOpen: true, title: 'Error', message: 'Vendor ID not loaded yet. Please wait a moment.' });
             return;
        }
        const itemRef = doc(db, 'street_vendors', vendorData.id, 'menu', itemId);
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
        if (!vendorData?.id) {
             setInfoDialog({ isOpen: true, title: 'Error', message: 'Vendor ID not loaded yet. Please wait a moment.' });
             return;
        }
        if (!window.confirm("Are you sure you want to delete this item?")) return;
        const itemRef = doc(db, 'street_vendors', vendorData.id, 'menu', itemId);
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
    
    const handleAddItem = useCallback(async (newItem) => {
        if (!vendorData?.id || !user) {
             setInfoDialog({ isOpen: true, title: 'Error', message: 'Vendor or user information not available yet. Please try again.' });
             throw new Error('Vendor or user information not available.');
        }
        
        const menuCollectionRef = collection(db, 'street_vendors', vendorData.id, 'menu');
        const newItemRef = doc(menuCollectionRef);
        const itemData = { 
            ...newItem, 
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
    }, [user, vendorData]);

    const groupedMenu = menuItems.reduce((acc, item) => {
        (acc[item.category] = acc[item.category] || []).push(item);
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
        <header className="flex justify-between items-center mb-6">
            <Link href="/street-vendor-dashboard" passHref>
                <Button variant="ghost" className="text-slate-400 hover:text-white">
                    <ArrowLeft size={28} />
                </Button>
            </Link>
            <h1 className="text-2xl font-bold font-headline">My Menu</h1>
            <Button onClick={() => setShowAddItem(true)} variant="ghost" className="text-primary hover:text-primary">
                <PlusCircle size={28} />
            </Button>
        </header>

        <main>
            <AnimatePresence>
                {showAddItem && <AddItemForm onAddItem={handleAddItem} onCancel={() => setShowAddItem(false)} />}
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
                            <p>Your menu is empty. Click the '+' button to add your first item!</p>
                        </div>
                    )}
                </div>
            )}
        </main>
    </div>
  );
}
