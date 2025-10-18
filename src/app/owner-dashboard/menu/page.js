

"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PlusCircle, GripVertical, Trash2, Edit, Image as ImageIcon, Search, X, Utensils, Pizza, Soup, Drumstick, Salad, CakeSlice, GlassWater, ChevronDown, IndianRupee, Upload, Copy, FileJson, XCircle, ShoppingBag, Laptop, BookOpen, ToyBrick } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { auth } from '@/lib/firebase';
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { useSearchParams } from "next/navigation";


const restaurantCategoryConfig = {
  "starters": { title: "Starters", icon: Salad },
  "main-course": { title: "Main Course", icon: Pizza },
  "beverages": { title: "Beverages", icon: GlassWater },
  "desserts": { title: "Desserts", icon: CakeSlice },
  "soup": { title: "Soup", icon: Soup },
  "tandoori-item": { title: "Tandoori Items", icon: Drumstick },
  "momos": { title: "Momos", icon: Drumstick },
  "burgers": { title: "Burgers", icon: Pizza },
  "rolls": { title: "Rolls", icon: Utensils },
  "tandoori-khajana": { title: "Tandoori Khajana", icon: Drumstick },
  "rice": { title: "Rice", icon: Utensils },
  "noodles": { title: "Noodles", icon: Utensils },
  "pasta": { title: "Pasta", icon: Utensils },
  "raita": { title: "Raita", icon: Utensils },
};

const shopCategoryConfig = {
  "electronics": { title: "Electronics", icon: Laptop },
  "groceries": { title: "Groceries", icon: ShoppingBag },
  "clothing": { title: "Clothing", icon: Utensils }, // Placeholder, can be changed
  "books": { title: "Books", icon: BookOpen },
  "home-appliances": { title: "Home Appliances", icon: Utensils },
  "toys-games": { title: "Toys & Games", icon: ToyBrick },
  "beauty-personal-care": { title: "Beauty & Personal Care", icon: Utensils },
  "sports-outdoors": { title: "Sports & Outdoors", icon: Utensils },
};


// --- COMPONENTS (Single File) ---

const MenuItem = ({ item, index, onDelete, onEdit, onToggleAvailability, onSelectItem, isSelected }) => {
    // Determine the price to display. Find the 'Full' price, or the first price if 'Full' doesn't exist.
    const displayPortion = (item.portions && item.portions.length > 0)
        ? item.portions.find(p => p.name.toLowerCase() === 'full') || item.portions[0]
        : null;

    return (
        <Draggable draggableId={item.id} index={index}>
            {(provided, snapshot) => (
                <motion.div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    className={`flex flex-col md:grid md:grid-cols-12 md:items-center p-3 rounded-lg gap-3 bg-card m-2 border ${isSelected ? "border-primary bg-primary/10" : "border-border"} ${snapshot.isDragging ? 'bg-primary/10 shadow-lg ring-2 ring-primary' : ''}`}
                    whileHover={{ 
                        backgroundColor: "hsl(var(--primary) / 0.1)"
                    }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                >
                     <div className="flex items-center md:col-span-1 text-center md:text-left">
                        <div {...provided.dragHandleProps} className="p-2 cursor-grab text-muted-foreground hover:text-white">
                            <GripVertical size={20} />
                        </div>
                    </div>
                    <div className="flex md:col-span-4 items-center gap-4">
                        <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => onSelectItem(item.id)}
                            aria-label={`Select ${item.name}`}
                            className="mr-2"
                        />
                        <div className="relative w-16 h-16 rounded-md overflow-hidden bg-muted flex-shrink-0">
                            {item.imageUrl ? (
                                <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-muted-foreground"><ImageIcon/></div>
                            )}
                        </div>
                        <div className="flex-grow text-left">
                            <p className="font-semibold text-foreground">{item.name}</p>
                            {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                        </div>
                    </div>
                    <div className="md:col-span-2 font-medium flex justify-around items-center text-foreground">
                        <span className="text-center">
                            {displayPortion ? `₹${displayPortion.price}` : 'N/A'}
                            {item.portions && item.portions.length > 1 && <span className="text-xs text-muted-foreground"> ({item.portions.length} sizes)</span>}
                        </span>
                    </div>
                    <div className="md:col-span-2 flex justify-center items-center">
                        <div className="flex items-center justify-between w-full md:w-auto md:justify-center py-2 md:py-0">
                            <span className="text-xs text-muted-foreground md:hidden mr-2">Available</span>
                            <Switch checked={item.isAvailable} onCheckedChange={() => onToggleAvailability(item.id, !item.isAvailable)} aria-label="Toggle Availability" />
                        </div>
                    </div>
                    <div className="md:col-span-2 flex justify-center gap-2 pt-2 border-t border-border md:border-t-0 md:pt-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => onEdit(item)}>
                            <Edit size={16} />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive h-8 w-8 hover:bg-destructive/10 hover:text-destructive" onClick={() => onDelete(item.id)}>
                            <Trash2 size={16} />
                        </Button>
                    </div>
                </motion.div>
            )}
        </Draggable>
    );
};



const MenuCategory = ({ categoryId, title, icon, items, onDeleteItem, onEditItem, onToggleAvailability, setMenu, open, setOpen, selectedItems, setSelectedItems }) => {
    const Icon = icon;
    const isExpanded = open === categoryId;

    const handleSelectAll = (checked) => {
        const itemIdsInCategory = items.map(item => item.id);
        if (checked) {
            setSelectedItems(prev => [...new Set([...prev, ...itemIdsInCategory])]);
        } else {
            setSelectedItems(prev => prev.filter(id => !itemIdsInCategory.includes(id)));
        }
    };

    const isAllSelected = items.length > 0 && items.every(item => selectedItems.includes(item.id));
    const isPartiallySelected = items.some(item => selectedItems.includes(item.id)) && !isAllSelected;

    const handleDragEnd = (result) => {
        const { source, destination } = result;
        if (!destination || source.droppableId !== destination.droppableId) return;
        
        const newItems = Array.from(items);
        const [movedItem] = newItems.splice(source.index, 1);
        newItems.splice(destination.index, 0, movedItem);

        // Here you would ideally make an API call to save the new order
        console.log("New order for", categoryId, newItems.map(i => i.id));

        setMenu(prevMenu => ({
            ...prevMenu,
            [categoryId]: newItems
        }));
    };
    
    return (
        <motion.div 
            layout 
            className="bg-card border border-border rounded-xl overflow-hidden"
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
            <button className="flex items-center justify-between w-full p-4 hover:bg-muted/50 transition-colors" onClick={() => setOpen(isExpanded ? null : categoryId)}>
                <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-3 rounded-full">
                        <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground">{title}</h3>
                    <span className="text-sm text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded-md">({items.length})</span>
                </div>
                <motion.div animate={{ rotate: isExpanded ? 180 : 0 }}>
                    <ChevronDown size={24} className="text-foreground"/>
                </motion.div>
            </button>
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className="overflow-hidden"
                    >
                        <div className="hidden md:grid grid-cols-12 items-center px-3 py-2 text-sm font-semibold text-muted-foreground bg-background">
                            <div className="col-span-1"></div>
                            <div className="col-span-4 flex items-center">
                                <Checkbox
                                    checked={isAllSelected}
                                    onCheckedChange={handleSelectAll}
                                    data-state={isPartiallySelected ? "indeterminate" : (isAllSelected ? "checked" : "unchecked")}
                                    aria-label="Select all items in this category"
                                    className="mr-4"
                                />
                                Item
                            </div>
                            <div className="col-span-2 text-center">Base Price</div>
                            <div className="col-span-2 text-center">Available</div>
                            <div className="col-span-2 text-center pr-4">Actions</div>
                        </div>
                        <DragDropContext onDragEnd={handleDragEnd}>
                            <Droppable droppableId={categoryId}>
                            {(provided, snapshot) => (
                                <div
                                ref={provided.innerRef}
                                {...provided.droppableProps}
                                className={`min-h-[60px] max-h-[calc(100vh-280px)] overflow-y-auto transition-colors ${snapshot.isDraggingOver ? 'bg-primary/5' : ''}`}
                                >
                                {items.map((item, index) => (
                                    <MenuItem 
                                        key={item.id} 
                                        item={item} 
                                        index={index}
                                        onDelete={() => onDeleteItem(item.id)}
                                        onEdit={onEditItem}
                                        onToggleAvailability={onToggleAvailability}
                                        onSelectItem={() => setSelectedItems(prev => prev.includes(item.id) ? prev.filter(id => id !== item.id) : [...prev, item.id])}
                                        isSelected={selectedItems.includes(item.id)}
                                    />
                                ))}
                                {provided.placeholder}
                                </div>
                            )}
                            </Droppable>
                        </DragDropContext>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};



const AddItemModal = ({ isOpen, setIsOpen, onSave, editingItem, allCategories }) => {
    const [item, setItem] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [newCategory, setNewCategory] = useState('');
    const [showNewCategory, setShowNewCategory] = useState(false);
    const fileInputRef = useRef(null);
    const [pricingType, setPricingType] = useState('portions');

    const sortedCategories = Object.entries(allCategories)
        .map(([id, config]) => ({ id, title: config?.title }))
        .sort((a, b) => {
            if (!a.title) return 1;
            if (!b.title) return -1;
            return a.title.localeCompare(b.title);
        });

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
                });
            } else {
                setPricingType('portions');
                setItem({
                    name: "",
                    description: "",
                    portions: [{ name: 'Full', price: '' }],
                    categoryId: sortedCategories[0]?.id || "starters",
                    isVeg: true,
                    isAvailable: true,
                    imageUrl: "",
                    tags: "",
                    addOnGroups: [],
                });
            }
        } else {
            setItem(null);
        }
    }, [editingItem, isOpen]);

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

    const handleChange = (field, value) => {
        setItem(prev => ({ ...prev, [field]: value }));
    };
    
    const handlePortionChange = (index, field, value) => {
        const newPortions = [...item.portions];
        newPortions[index][field] = value;
        setItem(prev => ({ ...prev, portions: newPortions }));
    };
    
    const handleBasePriceChange = (value) => {
        setItem(prev => ({ ...prev, portions: [{ name: 'Full', price: value }] }));
    };


    const addPortion = () => {
        setItem(prev => ({ ...prev, portions: [...prev.portions, { name: '', price: '' }] }));
    };

    const removePortion = (index) => {
        if (item.portions.length > 1) {
            const newPortions = item.portions.filter((_, i) => i !== index);
            setItem(prev => ({ ...prev, portions: newPortions }));
        }
    };
    
    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                handleChange('imageUrl', reader.result);
            };
            reader.readAsDataURL(file);
        }
    };
    // --- Add-on Group Handlers ---
    const addAddOnGroup = () => {
        setItem(prev => ({ ...prev, addOnGroups: [...prev.addOnGroups, { title: '', type: 'radio', required: false, options: [{name: '', price: ''}] }] }));
    };

    const removeAddOnGroup = (groupIndex) => {
        setItem(prev => ({ ...prev, addOnGroups: prev.addOnGroups.filter((_, i) => i !== groupIndex) }));
    };

    const handleAddOnGroupChange = (groupIndex, field, value) => {
        const newGroups = [...item.addOnGroups];
        newGroups[groupIndex][field] = value;
        setItem(prev => ({ ...prev, addOnGroups: newGroups }));
    };
    
    const addAddOnOption = (groupIndex) => {
        const newGroups = [...item.addOnGroups];
        newGroups[groupIndex].options.push({ name: '', price: '' });
        setItem(prev => ({ ...prev, addOnGroups: newGroups }));
    };
    
    const removeAddOnOption = (groupIndex, optionIndex) => {
        const newGroups = [...item.addOnGroups];
        if (newGroups[groupIndex].options.length > 1) {
            newGroups[groupIndex].options = newGroups[groupIndex].options.filter((_, i) => i !== optionIndex);
            setItem(prev => ({ ...prev, addOnGroups: newGroups }));
        }
    };
    
    const handleAddOnOptionChange = (groupIndex, optionIndex, field, value) => {
        const newGroups = [...item.addOnGroups];
        newGroups[groupIndex].options[optionIndex][field] = value;
        setItem(prev => ({ ...prev, addOnGroups: newGroups }));
    };


    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!item || isSaving) return;
        
        const finalCategoryId = showNewCategory ? newCategory.trim().toLowerCase().replace(/\s+/g, '-') : item.categoryId;
        const finalNewCategoryName = showNewCategory ? newCategory.trim() : '';

        if (showNewCategory && !finalNewCategoryName) {
            alert("Please enter a name for the new category.");
            return;
        }

        setIsSaving(true);
        try {
            const tagsArray = item.tags ? item.tags.split(',').map(tag => tag.trim()).filter(Boolean) : [];
            
            let finalPortions;
            if (pricingType === 'single') {
                const basePrice = item.portions?.[0]?.price;
                if (!basePrice || isNaN(parseFloat(basePrice))) {
                    alert("Please enter a valid base price.");
                    setIsSaving(false);
                    return;
                }
                finalPortions = [{ name: 'Full', price: parseFloat(basePrice) }];
            } else {
                 finalPortions = item.portions
                  .filter(p => p.name.trim() && p.price && !isNaN(parseFloat(p.price)))
                  .map(p => ({ name: p.name.trim(), price: parseFloat(p.price) }));
            }
            
            const finalAddOnGroups = item.addOnGroups
                .filter(g => g.title.trim() && g.options.some(opt => opt.name.trim() && opt.price))
                .map(g => ({
                    ...g,
                    options: g.options
                        .filter(opt => opt.name.trim() && opt.price)
                        .map(opt => ({ name: opt.name.trim(), price: parseFloat(opt.price) }))
                }));

            if (finalPortions.length === 0) {
                alert("Please add at least one valid portion with a name and price.");
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
                addOnGroups: finalAddOnGroups,
            };
            

            if (!newItemData.name) {
                alert("Please provide an item name.");
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
            <DialogContent className="sm:max-w-4xl bg-card border-border text-foreground">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{editingItem ? 'Edit Item' : 'Add New Item'}</DialogTitle>
                        <DialogDescription>
                            {editingItem ? 'Update the details for this item.' : "Fill in the details for the new item. Click save when you're done."}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid md:grid-cols-2 gap-x-8 gap-y-4 py-4 max-h-[70vh] overflow-y-auto pr-4">
                        {/* Left Column: Basic Details */}
                        <div className="space-y-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="name" className="text-right">Name</Label>
                                <input id="name" value={item.name} onChange={e => handleChange('name', e.target.value)} required placeholder="e.g., Veg Pulao" className="col-span-3 p-2 border rounded-md bg-input border-border ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="description" className="text-right">Description</Label>
                                <input id="description" value={item.description} onChange={e => handleChange('description', e.target.value)} placeholder="e.g., 10 Pcs." className="col-span-3 p-2 border rounded-md bg-input border-border ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="category" className="text-right">Category</Label>
                                <select id="category" value={item.categoryId} onChange={handleCategoryChange} className="col-span-3 p-2 border rounded-md bg-input border-border ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-70">
                                    {sortedCategories.map(({id, title}) => (
                                        <option key={id} value={id}>{title}</option>
                                    ))}
                                    <option value="add_new" className="font-bold text-primary">+ Add New Category...</option>
                                </select>
                            </div>
                            {showNewCategory && (
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="newCategory" className="text-right">New Category</Label>
                                    <input id="newCategory" value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="e.g., Biryani Special" className="col-span-3 p-2 border rounded-md bg-input border-border" />
                                </div>
                            )}
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="tags" className="text-right">Tags</Label>
                                <input id="tags" value={item.tags} onChange={e => handleChange('tags', e.target.value)} placeholder="e.g., Spicy, Chef's Special" className="col-span-3 p-2 border rounded-md bg-input border-border ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                            </div>
                             <div className="grid grid-cols-4 items-center gap-4">
                                <Label className="text-right">Image</Label>
                                <div className="col-span-3 flex items-center gap-4">
                                    <div className="relative w-20 h-20 rounded-md border-2 border-dashed border-border flex items-center justify-center bg-muted overflow-hidden">
                                        {item.imageUrl ? (
                                            <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" />
                                        ) : (
                                            <ImageIcon size={24} className="text-muted-foreground" />
                                        )}
                                    </div>
                                    <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
                                    <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                                        <Upload size={16} className="mr-2"/>Upload
                                    </Button>
                                </div>
                            </div>
                             <div className="flex items-center justify-end gap-4 pt-4">
                                <div className="flex items-center space-x-2">
                                   <Switch id="is-veg" checked={item.isVeg} onCheckedChange={checked => handleChange('isVeg', checked)} />
                                   <Label htmlFor="is-veg">Vegetarian</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                   <Switch id="is-available" checked={item.isAvailable} onCheckedChange={checked => handleChange('isAvailable', checked)} />
                                   <Label htmlFor="is-available">Available</Label>
                                </div>
                            </div>
                        </div>

                        {/* Right Column: Portions & Add-ons */}
                        <div className="space-y-4">
                           <div>
                                <Label>Pricing</Label>
                                <div className="flex items-center gap-2 mt-2 bg-muted p-1 rounded-lg">
                                    <Button type="button" onClick={() => setPricingType('single')} variant={pricingType === 'single' ? 'default' : 'ghost'} className={cn("flex-1", pricingType === 'single' && 'bg-background text-foreground shadow-sm')}>Single Price</Button>
                                    <Button type="button" onClick={() => setPricingType('portions')} variant={pricingType === 'portions' ? 'default' : 'ghost'} className={cn("flex-1", pricingType === 'portions' && 'bg-background text-foreground shadow-sm')}>Variable Portions</Button>
                                </div>
                                <div className="mt-3 space-y-3">
                                    {pricingType === 'single' ? (
                                        <div className="flex items-center gap-2">
                                            <Label className="w-24">Base Price</Label>
                                            <IndianRupee className="text-muted-foreground" size={16}/>
                                            <input type="number" value={item.portions?.[0]?.price || ''} onChange={(e) => handleBasePriceChange(e.target.value)} placeholder="e.g., 150" className="flex-1 p-2 border rounded-md bg-input border-border" required/>
                                        </div>
                                    ) : (
                                        <>
                                            {item.portions.map((portion, index) => (
                                                <div key={index} className="flex items-center gap-2">
                                                    <input value={portion.name} onChange={(e) => handlePortionChange(index, 'name', e.target.value)} placeholder="e.g., Half" className="flex-1 p-2 border rounded-md bg-input border-border" required/>
                                                    <IndianRupee className="text-muted-foreground" size={16}/>
                                                    <input type="number" value={portion.price} onChange={(e) => handlePortionChange(index, 'price', e.target.value)} placeholder="Price" className="w-24 p-2 border rounded-md bg-input border-border" required/>
                                                    <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removePortion(index)} disabled={item.portions.length <= 1}>
                                                        <Trash2 size={16}/>
                                                    </Button>
                                                </div>
                                            ))}
                                            <Button type="button" variant="outline" size="sm" onClick={addPortion}>
                                                <PlusCircle size={16} className="mr-2"/> Add Portion
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                            <div className="border-t border-border pt-4">
                                <Label>Add-on Groups (Optional)</Label>
                                <div className="mt-2 space-y-4">
                                    {item.addOnGroups.map((group, groupIndex) => (
                                        <div key={groupIndex} className="p-3 bg-muted/50 border border-border rounded-lg space-y-3">
                                            <div className="flex items-center gap-2">
                                                <input value={group.title} onChange={(e) => handleAddOnGroupChange(groupIndex, 'title', e.target.value)} placeholder="Group Title (e.g., Breads)" className="flex-1 p-2 border rounded-md bg-input border-border text-foreground font-semibold" />
                                                <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removeAddOnGroup(groupIndex)}><Trash2 size={16}/></Button>
                                            </div>
                                            {group.options.map((opt, optIndex) => (
                                                 <div key={optIndex} className="flex items-center gap-2">
                                                    <input value={opt.name} onChange={(e) => handleAddOnOptionChange(groupIndex, optIndex, 'name', e.target.value)} placeholder="Option name" className="flex-1 p-2 border rounded-md bg-input border-border"/>
                                                    <input type="number" value={opt.price} onChange={(e) => handleAddOnOptionChange(groupIndex, optIndex, 'price', e.target.value)} placeholder="Price" className="w-24 p-2 border rounded-md bg-input border-border"/>
                                                    <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removeAddOnOption(groupIndex, optIndex)} disabled={group.options.length <= 1}><Trash2 size={16}/></Button>
                                                 </div>
                                            ))}
                                            <Button type="button" variant="outline" size="sm" onClick={() => addAddOnOption(groupIndex)}>
                                                <PlusCircle size={16} className="mr-2"/> Add Option
                                            </Button>
                                        </div>
                                    ))}
                                    <Button type="button" variant="outline" onClick={addAddOnGroup}>
                                       <PlusCircle size={16} className="mr-2"/> Add Add-on Group
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild>
                           <Button type="button" variant="secondary" disabled={isSaving}>Cancel</Button>
                        </DialogClose>
                        <Button type="submit" disabled={isSaving} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                            {isSaving ? (
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                            ) : (
                                editingItem ? 'Save Changes' : 'Save Item'
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const BulkAddModal = ({ isOpen, setIsOpen, onSave, businessType }) => {
    const [jsonText, setJsonText] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [copySuccess, setCopySuccess] = useState('');

    const isShop = businessType === 'shop';
    const contextType = isShop ? 'product catalog' : 'restaurant menu';
    const itemName = isShop ? 'Product name' : 'Dish name';
    const placeholderText = isShop ? '[PASTE YOUR PRODUCT LIST HERE]' : '[PASTE YOUR MENU TEXT HERE]';
    const instructionsText = isShop ? 'your product list' : 'your menu text';
    const categoryExample = isShop ? "'electronics'" : "'main-course'";
    const defaultCategory = isShop ? "general" : "main-course";

    const aiPrompt = `You are an expert data extractor. Convert the following ${contextType} text into a structured JSON array. Each object in the array must strictly follow this format:
{
  "name": "string (${itemName})",
  "description": "string (Optional item description)",
  "imageUrl": "string (Optional URL to the item image)",
  "categoryId": "string (Lowercase, dash-separated, e.g., ${categoryExample})",
  "isVeg": "boolean (true for vegetarian, false for non-vegetarian, default to true if unsure)",
  "portions": [
    { "name": "string (e.g., 'Full', 'Half', 'Regular', '500g')", "price": "number" }
  ],
  "tags": ["string", "... (Optional array of tags like 'Bestseller', 'Spicy')"],
  "addOnGroups": [
    { 
      "title": "string (e.g., 'Choose your bread')", 
      "options": [
        { "name": "string (e.g., 'Tandoori Roti')", "price": "number" },
        ...
      ]
    },
    ...
  ]
}

Important Rules:
- If an item has only one price, create a single entry in the 'portions' array with the name "Full".
- If a category is not obvious, use a sensible default like '${defaultCategory}'.
- The 'isVeg' flag is more for restaurants; for shops, you can default it to true.
- The 'imageUrl' is optional. If not present, the system will use a placeholder.
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
            alert(`Invalid JSON format: ${error.message}`);
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
            <DialogContent className="sm:max-w-4xl bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-2xl"><FileJson /> Bulk Add Items via JSON</DialogTitle>
                    <DialogDescription>Quickly add multiple items by pasting a structured JSON array.</DialogDescription>
                </DialogHeader>
                <div className="grid md:grid-cols-2 gap-x-8 max-h-[70vh] overflow-y-auto pr-4">
                    <div className="space-y-4 py-4">
                        <h3 className="font-semibold text-lg">How to use:</h3>
                        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                            <li>Copy the AI prompt provided.</li>
                            <li>Go to an AI tool like ChatGPT or Gemini.</li>
                            <li>Paste the prompt, and then paste ${instructionsText} where it says \`${placeholderText}\`.</li>
                            <li>The AI will generate a JSON array. Copy the entire JSON code.</li>
                            <li>Paste the copied JSON code into the text area on this page.</li>
                            <li>Click "Upload & Save Items".</li>
                        </ol>
                        <div className="p-4 bg-muted rounded-lg">
                            <div className="flex justify-between items-center mb-2">
                                <Label className="font-semibold">AI Prompt for JSON Generation</Label>
                                <Button size="sm" variant="ghost" onClick={handleCopy}>
                                    <Copy size={14} className="mr-2"/> {copySuccess || 'Copy'}
                                </Button>
                            </div>
                            <p className="text-xs bg-background p-3 rounded-md font-mono whitespace-pre-wrap">{aiPrompt}</p>
                        </div>
                    </div>
                    <div className="py-4">
                        <Label htmlFor="json-input" className="font-semibold text-lg">Paste JSON Here</Label>
                        <textarea
                            id="json-input"
                            value={jsonText}
                            onChange={(e) => setJsonText(e.target.value)}
                            placeholder='[&#10;  {&#10;    "name": "Paneer Butter Masala",&#10;    "categoryId": "main-course",&#10;    ...&#10;  },&#10;  ...&#10;]'
                            className="w-full h-96 mt-2 p-3 font-mono text-sm border rounded-md bg-input border-border focus:ring-primary focus:border-primary"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button type="button" variant="secondary" disabled={isSaving}>Cancel</Button></DialogClose>
                    <Button onClick={handleSubmit} disabled={isSaving || !jsonText} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                        {isSaving ? 'Uploading...' : 'Upload & Save Items'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


const MotionButton = motion(Button);

// --- Main Page Component ---
export default function MenuPage() {
  const [menu, setMenu] = useState({});
  const [customCategories, setCustomCategories] = useState([]);
  const [businessType, setBusinessType] = useState('restaurant');
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [openCategory, setOpenCategory] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const searchParams = useSearchParams();
  const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
  
  const handleApiCall = async (endpoint, method, body) => {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated.");
    const idToken = await user.getIdToken();
    
    let url = new URL(endpoint, window.location.origin);
    if (impersonatedOwnerId) {
        url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
    }

    const res = await fetch(url.toString(), {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `API call failed: ${method} ${endpoint}`);
    return data;
  }

  const fetchMenu = async () => {
    setLoading(true);
    try {
        const user = auth.currentUser;
        if (!user) { setLoading(false); return; }
        const data = await handleApiCall('/api/owner/menu', 'GET');
        setMenu(data.menu || {});
        setCustomCategories(data.customCategories || []);
        setBusinessType(data.businessType || 'restaurant');
        if (data.menu && Object.keys(data.menu).length > 0) {
            setOpenCategory(Object.keys(data.menu)[0]);
        }
    } catch (error) {
        console.error("Error fetching menu:", error);
        alert("Could not fetch menu. " + error.message);
    } finally {
        setLoading(false);
    }
  };
  
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(user => {
        if (user) fetchMenu();
        else setLoading(false);
    });
    return () => unsubscribe();
  }, [impersonatedOwnerId]);
  
  const allCategories = { ...(businessType === 'restaurant' ? restaurantCategoryConfig : shopCategoryConfig) };
  customCategories.forEach(cat => {
    if (!allCategories[cat.id]) {
      allCategories[cat.id] = { title: cat.title, icon: Utensils };
    }
  });


  const handleSaveItem = async (itemData, categoryId, newCategory, isEditing) => {
    try {
        const data = await handleApiCall('/api/owner/menu', 'POST', { item: itemData, categoryId, newCategory, isEditing });
        alert(data.message);
        await fetchMenu();
    } catch (error) {
        console.error("Error saving item:", error);
        alert("Could not save item. " + error.message);
        throw error; // Re-throw to keep modal open
    }
  };

  const handleBulkSave = async (items) => {
    try {
        const data = await handleApiCall('/api/owner/menu-bulk', 'POST', { items });
        alert(data.message);
        await fetchMenu();
    } catch (error) {
        console.error("Error saving bulk items:", error);
        alert(`Could not save bulk items: ${error.message}`);
        throw error;
    }
  };

  const handleEditItem = (item) => {
    const categoryId = Object.keys(menu).find(key => 
        (menu[key] || []).some(i => i.id === item.id)
    );
    setEditingItem({ ...item, categoryId: categoryId || Object.keys(allCategories)[0] });
    setIsModalOpen(true);
  };
  
  const handleAddNewItem = () => {
      setEditingItem(null);
      setIsModalOpen(true);
  };

  const handleDeleteItem = async (itemId) => {
    if (window.confirm(`Are you sure you want to delete this item?`)) {
       try {
            await handleApiCall('/api/owner/menu', 'DELETE', { itemId });
            alert('Item deleted successfully!');
            await fetchMenu();
       } catch (error) {
           console.error("Error deleting item:", error);
           alert("Could not delete item. " + error.message);
       }
    }
  };
  
  const handleToggleAvailability = async (itemId, newAvailability) => {
     try {
        await handleApiCall('/api/owner/menu', 'PATCH', { updates: { id: itemId, isAvailable: newAvailability }});
        // Optimistic update
        setMenu(prevMenu => {
            const newMenuState = { ...prevMenu };
            for (const category in newMenuState) {
                newMenuState[category] = newMenuState[category].map(item => 
                    item.id === itemId ? { ...item, isAvailable: newAvailability } : item
                );
            }
            return newMenuState;
        });
     } catch (error) {
        console.error("Error toggling availability:", error);
        alert("Could not update item availability. " + error.message);
        fetchMenu(); // Re-sync with server on error
     }
  };

  const handleBulkDelete = async () => {
    if (window.confirm(`Are you sure you want to delete ${selectedItems.length} items? This action cannot be undone.`)) {
        try {
            await handleApiCall('/api/owner/menu', 'PATCH', { itemIds: selectedItems, action: 'delete' });
            alert(`${selectedItems.length} items deleted successfully!`);
            setSelectedItems([]);
            await fetchMenu();
        } catch (error) {
            console.error("Error bulk deleting items:", error);
            alert("Could not delete items. " + error.message);
        }
    }
  };

  const handleBulkOutOfStock = async () => {
     if (window.confirm(`Are you sure you want to mark ${selectedItems.length} items as out of stock?`)) {
        try {
            await handleApiCall('/api/owner/menu', 'PATCH', { itemIds: selectedItems, action: 'outOfStock' });
            alert(`${selectedItems.length} items marked as out of stock!`);
            setSelectedItems([]);
            await fetchMenu();
        } catch (error) {
            console.error("Error marking items out of stock:", error);
            alert("Could not update items. " + error.message);
        }
    }
  };
  
  const pageTitle = businessType === 'shop' ? 'Item Catalog' : 'Menu Management';
  const pageDescription = businessType === 'shop' ? 'Organize categories, manage products, and control availability.' : 'Organize categories, reorder items, and manage availability.';
  const searchPlaceholder = businessType === 'shop' ? 'Search for a product...' : 'Search for a dish...';
  const addNewText = businessType === 'shop' ? 'Add New Product' : 'Add New Dish';


  if (loading) {
    return (
        <div className="p-6 text-center h-screen flex items-center justify-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div>
        </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 bg-background text-foreground min-h-screen">
      <AddItemModal 
        isOpen={isModalOpen} 
        setIsOpen={setIsModalOpen}
        onSave={handleSaveItem}
        editingItem={editingItem}
        allCategories={allCategories}
      />

      <BulkAddModal
        isOpen={isBulkModalOpen}
        setIsOpen={setIsBulkModalOpen}
        onSave={handleBulkSave}
        businessType={businessType}
      />

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">{pageTitle}</h1>
            <p className="text-muted-foreground mt-1">{pageDescription}</p>
        </div>
        <div className="flex gap-2">
            <MotionButton
                onClick={() => setIsBulkModalOpen(true)}
                variant="outline"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
            >
                <FileJson size={20} className="mr-2" />
                Bulk Add via JSON
            </MotionButton>
            <MotionButton 
                onClick={handleAddNewItem}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
            >
                <PlusCircle size={20} className="mr-2" />
                {addNewText}
            </MotionButton>
        </div>
      </div>

      {/* Search & Bulk Actions Bar */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 p-3 bg-card border border-border rounded-xl">
        <div className="flex items-center gap-2 w-full max-w-sm">
            <Search size={20} className="text-muted-foreground"/>
            <input placeholder={searchPlaceholder} className="w-full bg-transparent focus:outline-none placeholder-muted-foreground text-foreground"/>
        </div>
      </div>
      
      {/* Menu Categories */}
      <div className="space-y-4 pb-24">
        {Object.keys(allCategories).sort((a, b) => {
            const titleA = allCategories[a]?.title;
            const titleB = allCategories[b]?.title;
            if (!titleA) return 1;
            if (!titleB) return -1;
            return titleA.localeCompare(titleB);
          }).map(categoryId => {
            const config = allCategories[categoryId];
            const items = menu[categoryId] || [];
            if (!config || items.length === 0 && !customCategories.some(c => c.id === categoryId)) return null;
            
            return (
                <MenuCategory
                    key={categoryId}
                    categoryId={categoryId}
                    title={config.title}
                    icon={config.icon || Utensils}
                    items={items}
                    onDeleteItem={handleDeleteItem}
                    onEditItem={handleEditItem}
                    onToggleAvailability={handleToggleAvailability}
                    setMenu={setMenu}
                    open={openCategory}
                    setOpen={setOpenCategory}
                    selectedItems={selectedItems}
                    setSelectedItems={setSelectedItems}
                />
            );
        })}
      </div>

      <AnimatePresence>
        {selectedItems.length > 0 && (
            <motion.div 
                className="fixed bottom-4 left-1/2 -translate-x-1/2 w-auto bg-card border border-border rounded-xl shadow-2xl p-3 flex items-center gap-4 z-50"
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
            >
                <p className="text-sm font-semibold">{selectedItems.length} item(s) selected</p>
                <Button variant="outline" size="sm" onClick={handleBulkOutOfStock}>
                    <XCircle size={16} className="mr-2" /> Mark Out of Stock
                </Button>
                <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                    <Trash2 size={16} className="mr-2" /> Delete Selected
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedItems([])}>
                    <X size={16} />
                </Button>
            </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}



