'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, PlusCircle, Trash2, IndianRupee, Loader2, Camera, FileJson, Edit, Upload, X, Plus, Image as ImageIcon, Utensils } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useUser, useCollection, useMemoFirebase } from '@/firebase';
import { db } from '@/lib/firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, deleteDoc, setDoc, getDocs } from 'firebase/firestore';
import { FirestorePermissionError } from '@/firebase/errors';
import { errorEmitter } from '@/firebase/error-emitter';
import InfoDialog from '@/components/InfoDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import Image from 'next/image';

const MenuItem = ({ item, onEdit, onDelete, onToggle }) => (
  <motion.div
    layout
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    className="bg-slate-800 rounded-lg p-4 flex justify-between items-center"
  >
     <div className="flex items-center gap-4">
        <div className="relative w-16 h-16 rounded-md overflow-hidden bg-slate-700 flex-shrink-0">
            {item.imageUrl ? (
                <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" />
            ) : (
                <ImageIcon size={32} className="text-slate-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            )}
        </div>
        <div>
            <p className={`font-bold text-lg ${!item.available ? 'text-slate-500 line-through' : 'text-white'}`}>{item.name}</p>
            <p className="text-slate-400">₹{item.portions?.[0]?.price || 'N/A'}</p>
        </div>
    </div>
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <Switch id={`switch-${item.id}`} checked={item.available} onCheckedChange={(checked) => onToggle(item.id, checked)} />
      </div>
      <Button onClick={() => onEdit(item)} size="icon" variant="ghost" className="text-slate-400 hover:bg-slate-700 hover:text-white">
        <Edit />
      </Button>
      <Button onClick={() => onDelete(item.id)} size="icon" variant="ghost" className="text-red-500 hover:bg-red-500/10">
        <Trash2 />
      </Button>
    </div>
  </motion.div>
);

const AddItemModal = ({ isOpen, setIsOpen, onSave, editingItem, allCategories, showInfoDialog }) => {
    const [item, setItem] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [newCategory, setNewCategory] = useState('');
    const [showNewCategory, setShowNewCategory] = useState(false);
    const fileInputRef = useRef(null);
    const [pricingType, setPricingType] = useState('portions');

    const sortedCategories = useMemo(() => Object.entries(allCategories)
        .map(([id, config]) => ({ id, title: config?.title || id }))
        .sort((a, b) => a.title.localeCompare(b.title)), [allCategories]);

    useEffect(() => {
        if (isOpen) {
            setIsSaving(false);
            setNewCategory('');
            setShowNewCategory(false);
            if (editingItem) {
                const hasMultiplePortions = editingItem.portions && editingItem.portions.length > 1;
                const hasDifferentPortionName = editingItem.portions && editingItem.portions.length === 1 && editingItem.portions[0].name.toLowerCase() !== 'full';
                
                if (hasMultiplePortions || hasDifferentPortionName) {
                    setPricingType('portions');
                } else {
                    setPricingType('single');
                }
                
                setItem({
                    ...editingItem,
                    tags: Array.isArray(editingItem.tags) ? editingItem.tags.join(', ') : '',
                    addOnGroups: editingItem.addOnGroups || [],
                    // --- FIX: Ensure portions is always an array ---
                    portions: Array.isArray(editingItem.portions) && editingItem.portions.length > 0 ? editingItem.portions : [{ name: 'Full', price: '' }],
                });
            } else {
                setPricingType('portions');
                setItem({
                    name: "",
                    description: "",
                    portions: [{ name: 'Full', price: '' }],
                    categoryId: "Snacks", isVeg: true, isAvailable: true,
                    imageUrl: "", tags: ""
                });
            }
        } else {
            setItem(null);
        }
    }, [editingItem, isOpen, sortedCategories]);

    const handleCategoryChange = (e) => {
        const value = e.target.value;
        if (value === 'add_new') {
            setShowNewCategory(true);
            handleChange('categoryId', value);
        } else {
            setShowNewCategory(false);
            setNewCategory('');
            handleChange('categoryId', value);
        }
    };

    const handleChange = (field, value) => setItem(prev => ({ ...prev, [field]: value }));
    const handlePortionChange = (index, field, value) => {
        const newPortions = [...item.portions];
        newPortions[index][field] = value;
        setItem(prev => ({ ...prev, portions: newPortions }));
    };
    const addPortion = () => setItem(prev => ({ ...prev, portions: [...prev.portions, { name: '', price: '' }] }));
    const removePortion = (index) => {
        if (item.portions.length > 1) {
            setItem(prev => ({ ...prev, portions: prev.portions.filter((_, i) => i !== index) }));
        }
    };
    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => handleChange('imageUrl', reader.result);
            reader.readAsDataURL(file);
        }
    };
    
    const handleBasePriceChange = (value) => {
        setItem(prev => ({ ...prev, portions: [{ name: 'Full', price: value }] }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!item || isSaving) return;
        const finalCategoryId = showNewCategory ? newCategory.trim().toLowerCase().replace(/\s+/g, '-') : item.categoryId;
        const finalNewCategoryName = showNewCategory ? newCategory.trim() : '';

        if (showNewCategory && !finalNewCategoryName) {
            showInfoDialog({ isOpen: true, title: 'Input Error', message: "Please enter a name for the new category."});
            return;
        }

        setIsSaving(true);
        try {
            const tagsArray = item.tags ? item.tags.split(',').map(tag => tag.trim()).filter(Boolean) : [];
            
            let finalPortions;
            if (pricingType === 'single') {
                const basePrice = item.portions?.[0]?.price;
                if (!basePrice || isNaN(parseFloat(basePrice))) {
                    showInfoDialog({ isOpen: true, title: 'Input Error', message: "Please enter a valid base price."});
                    setIsSaving(false);
                    return;
                }
                finalPortions = [{ name: 'Full', price: parseFloat(basePrice) }];
            } else {
                 finalPortions = item.portions
                  .filter(p => p.name.trim() && p.price && !isNaN(parseFloat(p.price)))
                  .map(p => ({ name: p.name.trim(), price: parseFloat(p.price) }));
            }

            if (finalPortions.length === 0) {
                showInfoDialog({ isOpen: true, title: 'Input Error', message: "Please add at least one valid portion with a name and price."});
                setIsSaving(false);
                return;
            }

            const newItemData = {
                id: editingItem ? item.id : undefined,
                name: item.name,
                description: item.description,
                portions: finalPortions,
                isVeg: item.isVeg,
                isAvailable: item.isAvailable,
                imageUrl: item.imageUrl || `https://picsum.photos/seed/${item.name.replace(/\s/g, '')}/100/100`,
                tags: tagsArray,
            };
            

            if (!newItemData.name) {
                showInfoDialog({ isOpen: true, title: 'Input Error', message: "Please provide an item name."});
                setIsSaving(false);
                return;
            }
            
            await onSave(newItemData, finalCategoryId, finalNewCategoryName, !!editingItem);
            setIsOpen(false);
        } catch (error) {
             // Error alert is handled in the parent `handleSaveItem`
        } finally {
            setIsSaving(false);
        }
    };
    
    if (!item) return null;

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-3xl bg-slate-900 border-slate-700 text-white">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{editingItem ? 'Edit Item' : 'Add New Item'}</DialogTitle>
                    </DialogHeader>
                    <div className="grid md:grid-cols-2 gap-x-8 gap-y-4 py-4 max-h-[70vh] overflow-y-auto pr-4">
                        <div className="space-y-4">
                             <div><Label>Name</Label><input value={item.name} onChange={e => handleChange('name', e.target.value)} required className="w-full p-2 bg-slate-800 border border-slate-700 rounded-md" /></div>
                             <div><Label>Description</Label><input value={item.description} onChange={e => handleChange('description', e.target.value)} className="w-full p-2 bg-slate-800 border border-slate-700 rounded-md" /></div>
                             <div>
                                <Label>Category</Label>
                                <select value={item.categoryId} onChange={handleCategoryChange} className="w-full p-2 bg-slate-800 border border-slate-700 rounded-md">
                                    {sortedCategories.map(({id, title}) => <option key={id} value={id}>{title}</option>)}
                                    <option value="add_new">+ Add New Category...</option>
                                </select>
                            </div>
                            {showNewCategory && (<div><Label>New Category Name</Label><input value={newCategory} onChange={e => setNewCategory(e.target.value)} className="w-full p-2 bg-slate-800 border border-slate-700 rounded-md" /></div>)}
                             <div><Label>Tags (comma-separated)</Label><input value={item.tags} onChange={e => handleChange('tags', e.target.value)} className="w-full p-2 bg-slate-800 border border-slate-700 rounded-md" /></div>
                             <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2"><Switch id="is-veg" checked={item.isVeg} onCheckedChange={checked => handleChange('isVeg', checked)} /><Label htmlFor="is-veg">Vegetarian</Label></div>
                                <div className="flex items-center gap-2"><Switch id="is-available" checked={item.isAvailable} onCheckedChange={checked => handleChange('isAvailable', checked)} /><Label htmlFor="is-available">Available</Label></div>
                            </div>
                        </div>
                        <div className="space-y-4">
                             <div>
                                <Label>Image</Label>
                                <div className="mt-2 flex items-center gap-4">
                                    <div className="relative w-20 h-20 rounded-md border-2 border-dashed border-slate-600 flex items-center justify-center bg-slate-800 overflow-hidden">
                                        {item.imageUrl ? <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" /> : <ImageIcon size={24} className="text-slate-500" />}
                                    </div>
                                    <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
                                    <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="text-white border-slate-700 hover:bg-slate-800">
                                        <Upload size={16} className="mr-2"/>Upload
                                    </Button>
                                </div>
                            </div>
                            <div>
                                <Label>Pricing</Label>
                                <div className="mt-2 space-y-3">
                                    {item.portions.map((portion, index) => (
                                        <div key={index} className="flex items-center gap-2">
                                            <input value={portion.name} onChange={(e) => handlePortionChange(index, 'name', e.target.value)} placeholder="e.g., Half" className="flex-1 p-2 bg-slate-800 border border-slate-700 rounded-md" required/>
                                            <IndianRupee className="text-slate-400" size={16}/>
                                            <input type="number" value={portion.price} onChange={(e) => handlePortionChange(index, 'price', e.target.value)} placeholder="Price" className="w-24 p-2 bg-slate-800 border border-slate-700 rounded-md" required/>
                                            <Button type="button" variant="ghost" size="icon" className="text-red-500" onClick={() => removePortion(index)} disabled={item.portions.length <= 1}><Trash2 size={16}/></Button>
                                        </div>
                                    ))}
                                    <Button type="button" variant="outline" size="sm" onClick={addPortion} className="text-white border-slate-700 hover:bg-slate-800"><PlusCircle size={16} className="mr-2"/> Add Portion</Button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button type="button" variant="ghost" disabled={isSaving}>Cancel</Button></DialogClose>
                        <Button type="submit" disabled={isSaving} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                             {isSaving ? <Loader2 className="animate-spin mr-2"/> : null} {editingItem ? 'Save Changes' : 'Save Item'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const AiScanModal = ({ isOpen, onClose, onScan }) => {
    const [selectedFile, setSelectedFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [isScanning, setIsScanning] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
        if (!isOpen) {
            setSelectedFile(null);
            setPreviewUrl(null);
            setIsScanning(false);
        }
    }, [isOpen]);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setSelectedFile(file);
            setPreviewUrl(URL.createObjectURL(file));
        }
    };

    const handleScan = async () => {
        if (selectedFile) {
            setIsScanning(true);
            await onScan(selectedFile);
            setIsScanning(false);
            onClose();
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-700 text-white">
                <DialogHeader>
                    <DialogTitle>Scan Menu with AI</DialogTitle>
                    <DialogDescription>Upload an image of your menu, and our AI will automatically add the items for you.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <input type="file" ref={inputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
                    <div
                        onClick={() => inputRef.current?.click()}
                        className="w-full h-48 border-2 border-dashed border-slate-600 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-slate-800/50 transition-colors"
                    >
                        {previewUrl ? (
                            <Image src={previewUrl} alt="Menu preview" layout="fill" objectFit="contain" className="p-2"/>
                        ) : (
                            <>
                                <Camera size={48} className="text-slate-500" />
                                <p className="mt-2 text-slate-400">Click to Upload Image</p>
                            </>
                        )}
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} disabled={isScanning}>Cancel</Button>
                    <Button onClick={handleScan} disabled={!selectedFile || isScanning} className="bg-primary hover:bg-primary/80 text-primary-foreground">
                        {isScanning ? <Loader2 className="animate-spin mr-2"/> : null}
                        {isScanning ? 'Scanning...' : 'Start AI Scan'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const BulkAddModal = ({ isOpen, setIsOpen, onSave, businessType, showInfoDialog }) => {
    const [jsonText, setJsonText] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [copySuccess, setCopySuccess] = useState('');

    const contextType = 'restaurant menu';
    const itemName = 'Dish name';
    const placeholderText = '[PASTE YOUR MENU TEXT HERE]';
    const instructionsText = 'your menu text';
    const categoryExample = "'main-course'";
    const defaultCategory = "main-course";

    const aiPrompt = `You are an expert data extractor. Convert the following ${contextType} text into a structured JSON array. Each object in the array must strictly follow this format:
{
  "name": "string (${itemName})",
  "description": "string (Optional item description)",
  "categoryId": "string (Lowercase, dash-separated, e.g., ${categoryExample})",
  "isVeg": "boolean (true for vegetarian, false for non-vegetarian, default to true if unsure)",
  "portions": [
    { "name": "string (e.g., 'Full', 'Half', 'Regular')", "price": "number" }
  ],
  "tags": ["string", "... (Optional array of tags like 'Bestseller', 'Spicy')"]
}

Important Rules:
- The 'imageUrl' and 'addOnGroups' fields MUST NOT be part of your response.
- If an item has only one price, create a single entry in the 'portions' array with the name "Full".
- If a category is not obvious, use a sensible default like '${defaultCategory}'.
- The final output must be ONLY the JSON array, with no extra text or explanations.

Here is the text:
---
${placeholderText}
---`;

    const handleCopy = () => {
        navigator.clipboard.writeText(aiPrompt).then(() => {
            setCopySuccess('Prompt Copied!');
            setTimeout(() => setCopySuccess(''), 2000);
        }, () => {
            setCopySuccess('Failed to copy!');
            setTimeout(() => setCopySuccess(''), 2000);
        });
    };
    
    const handleSubmit = async () => {
        let items;
        try {
            items = JSON.parse(jsonText);
            if (!Array.isArray(items)) throw new Error("JSON data must be an array.");
        } catch (error) {
            showInfoDialog({isOpen: true, title: 'Input Error', message: `Invalid JSON format: ${error.message}`});
            return;
        }

        setIsSaving(true);
        try {
            await onSave(items);
            setJsonText('');
            setIsOpen(false);
        } catch (error) {
            // alert is handled by the parent
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-4xl bg-slate-900 border-slate-700 text-white">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-2xl"><FileJson /> Bulk Add Items via JSON</DialogTitle>
                    <DialogDescription>Quickly add multiple items by pasting a structured JSON array.</DialogDescription>
                </DialogHeader>
                <div className="grid md:grid-cols-2 gap-x-8 max-h-[70vh] overflow-y-auto pr-4">
                    <div className="space-y-4 py-4">
                        <h3 className="font-semibold text-lg">How to use:</h3>
                        <ol className="list-decimal list-inside space-y-2 text-sm text-slate-400">
                            <li>Copy the AI prompt provided.</li>
                            <li>Go to an AI tool like ChatGPT or Gemini.</li>
                            <li>Paste the prompt, and then paste ${instructionsText} where it says \`${placeholderText}\`.</li>
                            <li>The AI will generate a JSON array. Copy the entire JSON code.</li>
                            <li>Paste the copied JSON code into the text area on this page.</li>
                            <li>Click "Upload & Save Items".</li>
                        </ol>
                        <div className="p-4 bg-slate-800 rounded-lg">
                            <div className="flex justify-between items-center mb-2">
                                <Label className="font-semibold">AI Prompt for JSON Generation</Label>
                                <Button size="sm" variant="ghost" onClick={handleCopy}>
                                    {copySuccess || 'Copy'}
                                </Button>
                            </div>
                            <p className="text-xs bg-slate-900 p-3 rounded-md font-mono whitespace-pre-wrap overflow-auto">{aiPrompt}</p>
                        </div>
                    </div>
                    <div className="py-4">
                        <Label htmlFor="json-input" className="font-semibold text-lg">Paste JSON Here</Label>
                        <textarea
                            id="json-input"
                            value={jsonText}
                            onChange={(e) => setJsonText(e.target.value)}
                            placeholder='[ ... ]'
                            className="w-full h-96 mt-2 p-3 font-mono text-sm border rounded-md bg-slate-800 border-slate-700 focus:ring-primary focus:border-primary"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button type="button" variant="ghost" disabled={isSaving}>Cancel</Button></DialogClose>
                    <Button onClick={handleSubmit} disabled={isSaving || !jsonText} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                        {isSaving ? 'Uploading...' : 'Upload & Save Items'}
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
    const [isAiModalOpen, setIsAiModalOpen] = useState(false);
    const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
    const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });
    const [isScanning, setIsScanning] = useState(false);

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
        if (!vendorId) return;
        const itemRef = doc(db, 'street_vendors', vendorId, 'menu', itemId);
        try {
            await updateDoc(itemRef, { available: newAvailability });
        } catch(error) {
            errorEmitter.emit('permission-error', new FirestorePermissionError({ path: itemRef.path, operation: 'update', requestResourceData: { available: newAvailability } }));
            setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not update item status: ' + error.message });
        };
    };

    const handleDeleteItem = async (itemId) => {
        if (!vendorId) return;
        if (!window.confirm("Are you sure you want to delete this item?")) return;
        const itemRef = doc(db, 'street_vendors', vendorId, 'menu', itemId);
        try {
            await deleteDoc(itemRef);
        } catch(error) {
            errorEmitter.emit('permission-error', new FirestorePermissionError({ path: itemRef.path, operation: 'delete' }));
             setInfoDialog({ isOpen: true, title: 'Error', message: 'Could not delete item: ' + error.message });
        }
    };
    
    const handleSaveItem = useCallback(async (itemData, categoryId, newCategory, isEditing) => {
        const handleApiCall = async (endpoint, method, body) => {
            const idToken = await user.getIdToken();
            const response = await fetch(endpoint, {
                method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify(body)
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.message || 'API call failed');
            }
            return await response.json();
        };

        try {
            const data = await handleApiCall('/api/owner/menu', 'POST', { item: itemData, categoryId, newCategory, isEditing });
            setInfoDialog({ isOpen: true, title: 'Success', message: data.message });
            fetchMenu();
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Error', message: `Could not save item: ${error.message}` });
            throw error;
        }
    }, [user, fetchMenu]);


    const handleAiScan = async (file) => {
        setIsScanning(true);
        try {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            await new Promise((resolve, reject) => {
                reader.onload = async () => {
                    try {
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
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                };
                reader.onerror = (error) => reject(error);
            });
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'AI Scan Failed', message: error.message });
            throw error;
        } finally {
            setIsScanning(false);
        }
    };
    
    const handleBulkSave = async (items) => {
         try {
            const user = await auth.currentUser;
            if(!user) throw new Error("User not authenticated");
            const idToken = await user.getIdToken();
            const response = await fetch('/api/owner/menu-bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
                body: JSON.stringify({ items }),
            });
            if (!response.ok) throw new Error((await response.json()).message);
            const data = await response.json();
            setInfoDialog({ isOpen: true, title: 'Success!', message: data.message });
            fetchMenu();
        } catch (error) {
            setInfoDialog({ isOpen: true, title: 'Bulk Add Failed', message: error.message });
            throw error;
        }
    };
    
    const handleEditItem = (item) => {
        setEditingItem(item);
        setIsAddItemModalOpen(true);
    };

    const groupedMenu = menuItems.reduce((acc, item) => {
        const category = item.categoryId || 'General';
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
        <BulkAddModal isOpen={isBulkModalOpen} setIsOpen={setIsBulkModalOpen} onSave={handleBulkSave} businessType="street-vendor" showInfoDialog={setInfoDialog} />
        <AddItemModal isOpen={isAddItemModalOpen} setIsOpen={setIsAddItemModalOpen} onSave={handleSaveItem} editingItem={editingItem} allCategories={{}} showInfoDialog={setInfoDialog} />

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
                <Button onClick={() => setIsBulkModalOpen(true)} variant="ghost" className="text-primary hover:text-primary">
                    <FileJson size={28} />
                </Button>
                <Button onClick={() => { setEditingItem(null); setIsAddItemModalOpen(true); }} variant="ghost" className="text-primary hover:text-primary">
                    <PlusCircle size={28} />
                </Button>
            </div>
        </header>

        <AnimatePresence>
            {isScanning && (
                 <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="bg-primary/10 text-primary font-semibold p-3 rounded-lg flex items-center justify-center gap-3 mb-4 text-center"
                >
                    <Loader2 className="animate-spin" />
                    AI is scanning your menu... Your new items will appear here shortly.
                </motion.div>
            )}
        </AnimatePresence>

        <main>
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
                                    <MenuItem key={item.id} item={item} onToggle={handleToggleAvailability} onDelete={handleDeleteItem} onEdit={handleEditItem} />
                                ))}
                            </div>
                        </div>
                    ))}
                     {Object.keys(groupedMenu).length === 0 && !isScanning && (
                        <div className="text-center py-20 text-slate-500">
                            <p>Your menu is empty.</p>
                            <p>Click <PlusCircle className="inline" size={16}/> to add an item, or use <Camera className="inline" size={16}/> to scan your menu with AI.</p>
                        </div>
                    )}
                </div>
            )}
        </main>
    </div>
  );
}
