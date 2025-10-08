

"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PlusCircle, GripVertical, Trash2, Edit, Image as ImageIcon, Search, X, Utensils, Pizza, Soup, Drumstick, Salad, CakeSlice, GlassWater, ChevronDown } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { auth } from '@/lib/firebase';

const categoryConfig = {
  "starters": { title: "Starters", icon: Utensils },
  "momos": { title: "Momos", icon: Drumstick },
  "burgers": { title: "Burgers", icon: Pizza },
  "rolls": { title: "Rolls", icon: Salad },
  "soup": { title: "Soup", icon: Soup },
  "tandoori-item": { title: "Tandoori Items", icon: Drumstick },
  "main-course": { title: "Main Course", icon: Utensils },
  "tandoori-khajana": { title: "Tandoori Khajana", icon: Utensils },
  "rice": { title: "Rice", icon: Utensils },
  "noodles": { title: "Noodles", icon: Utensils },
  "pasta": { title: "Pasta", icon: Utensils },
  "raita": { title: "Raita", icon: Utensils },
  "desserts": { title: "Desserts", icon: CakeSlice },
  "beverages": { title: "Beverages", icon: GlassWater },
};


// --- COMPONENTS (Single File) ---

const MenuItem = ({ item, index, onDelete, onEdit, onToggleAvailability }) => {
  const hasOnlyFullPrice = item.halfPrice === null || item.halfPrice === undefined || item.halfPrice === '';
  return (
    <Draggable draggableId={item.id} index={index}>
      {(provided, snapshot) => (
        <motion.div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={`flex flex-col md:grid md:grid-cols-12 md:items-center p-3 rounded-lg gap-3 bg-gray-800/60 m-2 border border-gray-700 ${snapshot.isDragging ? 'bg-indigo-500/20 shadow-lg ring-2 ring-indigo-400' : ''}`}
          whileHover={{ 
            y: -2,
            backgroundColor: "hsl(var(--primary) / 0.1)"
          }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          {/* Column 1: Drag Handle */}
          <div className="flex items-center md:col-span-1 text-center md:text-left">
            <div {...provided.dragHandleProps} className="p-2 cursor-grab text-muted-foreground hover:text-white">
              <GripVertical size={20} />
            </div>
          </div>

          {/* Column 2: Item Image & Name */}
          <div className="flex md:col-span-4 items-center gap-4">
              <div className="relative w-16 h-16 rounded-md overflow-hidden bg-muted flex-shrink-0">
                  {item.imageUrl ? (
                      <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" />
                  ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground"><ImageIcon/></div>
                  )}
              </div>
              <div className="flex-grow text-left">
                <p className="font-semibold text-white">{item.name}</p>
                {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
              </div>
          </div>
          
          {/* Spacer for Mobile (Price headers) */}
          <div className="md:hidden font-medium flex justify-around items-center pt-2 border-t border-gray-700 mt-2">
            <div className="w-1/2 text-center text-xs text-muted-foreground">Half</div>
            <div className="w-1/2 text-center text-xs text-muted-foreground">Full</div>
          </div>

          {/* Column 3: Prices */}
          <div className="md:col-span-2 font-medium flex justify-around items-center -mt-2 md:mt-0 text-white">
            {hasOnlyFullPrice ? (
               <span className="w-full text-center">₹{item.fullPrice}</span>
            ) : (
              <>
                <span className="w-1/2 text-center">{item.halfPrice ? `₹${item.halfPrice}`: '-'}</span>
                <span className="w-1/2 text-center">₹{item.fullPrice}</span>
              </>
            )}
          </div>
          
          {/* Column 4: Availability */}
          <div className="md:col-span-2 flex justify-center items-center">
             <div className="flex items-center justify-between w-full md:w-auto md:justify-center py-2 md:py-0">
                <span className="text-xs text-muted-foreground md:hidden mr-2">Available</span>
                <Switch checked={item.isAvailable} onCheckedChange={() => onToggleAvailability(item.id, !item.isAvailable)} aria-label="Toggle Availability" />
             </div>
          </div>

          {/* Column 5: Actions */}
          <div className="md:col-span-3 flex justify-center gap-2 pt-2 border-t border-gray-700 md:border-t-0 md:pt-0">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-white" onClick={() => onEdit(item)}>
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


const MenuCategory = ({ categoryId, title, icon, items, onDeleteItem, onEditItem, onToggleAvailability, setMenu, open, setOpen }) => {
    const Icon = icon;
    const isExpanded = open === categoryId;

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
            className="bg-gray-900/50 border border-gray-700 rounded-xl overflow-hidden"
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
            <button className="flex items-center justify-between w-full p-4 hover:bg-gray-800/50 transition-colors" onClick={() => setOpen(isExpanded ? null : categoryId)}>
                <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-3 rounded-full">
                        <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold text-white">{title}</h3>
                    <span className="text-sm text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded-md">({items.length})</span>
                </div>
                <motion.div animate={{ rotate: isExpanded ? 180 : 0 }}>
                    <ChevronDown size={24} className="text-white"/>
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
                        <div className="hidden md:grid grid-cols-12 items-center px-3 py-2 text-sm font-semibold text-muted-foreground bg-black/20">
                            <div className="col-span-1"></div>
                            <div className="col-span-4">Item</div>
                            <div className="col-span-2 flex justify-around">
                                <span className="w-1/2 text-center">Half</span>
                                <span className="w-1/2 text-center">Full</span>
                            </div>
                            <div className="col-span-2 text-center">Available</div>
                            <div className="col-span-3 text-center pr-4">Actions</div>
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

    useEffect(() => {
        if (isOpen) {
            setIsSaving(false);
            if (editingItem) {
                setItem({
                    ...editingItem,
                    tags: Array.isArray(editingItem.tags) ? editingItem.tags.join(', ') : '',
                });
            } else {
                setItem({
                    name: "",
                    description: "",
                    halfPrice: "",
                    fullPrice: "",
                    categoryId: "starters",
                    isVeg: true,
                    isAvailable: true,
                    imageUrl: "",
                    tags: "",
                });
            }
        } else {
            setItem(null);
        }
    }, [editingItem, isOpen]);

    const handleChange = (field, value) => {
        setItem(prev => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!item || isSaving) return;

        setIsSaving(true);
        try {
            const tagsArray = item.tags ? item.tags.split(',').map(tag => tag.trim()).filter(Boolean) : [];

            const newItemData = {
                id: editingItem ? item.id : undefined,
                name: item.name,
                description: item.description,
                halfPrice: item.halfPrice ? parseFloat(item.halfPrice) : null,
                fullPrice: item.fullPrice ? parseFloat(item.fullPrice) : 0,
                isVeg: item.isVeg,
                isAvailable: item.isAvailable,
                imageUrl: item.imageUrl || `https://picsum.photos/seed/${item.name.replace(/\s/g, '')}/100/100`,
                tags: tagsArray,
            };

            if (!newItemData.name || !newItemData.fullPrice) {
                alert("Please provide at least a name and a full price.");
                setIsSaving(false);
                return;
            }

            await onSave(newItemData, item.categoryId, !!editingItem);
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
            <DialogContent className="sm:max-w-[520px] bg-gray-900 border-gray-700 text-white">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{editingItem ? 'Edit Menu Item' : 'Add New Menu Item'}</DialogTitle>
                        <DialogDescription>
                            {editingItem ? 'Update the details for this dish.' : "Fill in the details for the new dish. Click save when you're done."}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4 max-h-[70vh] overflow-y-auto pr-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="name" className="text-right">Name</Label>
                            <input id="name" value={item.name} onChange={e => handleChange('name', e.target.value)} required placeholder="e.g., Veg Pulao" className="col-span-3 p-2 border rounded-md bg-gray-800 border-gray-600 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="description" className="text-right">Description</Label>
                            <input id="description" value={item.description} onChange={e => handleChange('description', e.target.value)} placeholder="e.g., 10 Pcs." className="col-span-3 p-2 border rounded-md bg-gray-800 border-gray-600 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="halfPrice" className="text-right">Half Price (₹)</Label>
                            <input id="halfPrice" type="number" value={item.halfPrice} onChange={e => handleChange('halfPrice', e.target.value)} placeholder="Leave empty if none" className="col-span-3 p-2 border rounded-md bg-gray-800 border-gray-600 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="fullPrice" className="text-right">Full Price (₹)</Label>
                            <input id="fullPrice" type="number" value={item.fullPrice} onChange={e => handleChange('fullPrice', e.target.value)} required placeholder="e.g., 250" className="col-span-3 p-2 border rounded-md bg-gray-800 border-gray-600 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="category" className="text-right">Category</Label>
                            <select id="category" value={item.categoryId} onChange={e => handleChange('categoryId', e.target.value)} disabled={!!editingItem} className="col-span-3 p-2 border rounded-md bg-gray-800 border-gray-600 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-70">
                                {Object.keys(allCategories).map((key) => (
                                    <option key={key} value={key}>{allCategories[key].title}</option>
                                ))}
                            </select>
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="tags" className="text-right">Tags</Label>
                            <input id="tags" value={item.tags} onChange={e => handleChange('tags', e.target.value)} placeholder="e.g., Spicy, Chef's Special" className="col-span-3 p-2 border rounded-md bg-gray-800 border-gray-600 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
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
                    <DialogFooter>
                        <DialogClose asChild>
                           <Button type="button" variant="secondary" disabled={isSaving}>Cancel</Button>
                        </DialogClose>
                        <Button type="submit" disabled={isSaving} className="bg-indigo-600 hover:bg-indigo-700">
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


const MotionButton = motion(Button);

// --- Main Page Component ---
export default function MenuPage() {
  const [menu, setMenu] = useState({});
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [openCategory, setOpenCategory] = useState("starters");
  
  const handleApiCall = async (endpoint, method, body) => {
    const user = auth.currentUser;
    if (!user) throw new Error("User not authenticated.");
    const idToken = await user.getIdToken();
    const res = await fetch(endpoint, {
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
  }, []);

  const handleSaveItem = async (itemData, categoryId, isEditing) => {
    try {
        const data = await handleApiCall('/api/owner/menu', 'POST', { item: itemData, categoryId, isEditing });
        alert(data.message);
        await fetchMenu();
    } catch (error) {
        console.error("Error saving item:", error);
        alert("Could not save item. " + error.message);
        throw error; // Re-throw to keep modal open
    }
  };

  const handleEditItem = (item) => {
    const categoryId = Object.keys(menu).find(key => 
        (menu[key] || []).some(i => i.id === item.id)
    ) || "starters";
    setEditingItem({ ...item, categoryId });
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

  if (loading) {
    return (
        <div className="p-6 text-center h-screen flex items-center justify-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div>
        </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <AddItemModal 
        isOpen={isModalOpen} 
        setIsOpen={setIsModalOpen}
        onSave={handleSaveItem}
        editingItem={editingItem}
        allCategories={categoryConfig}
      />

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white">Menu Management</h1>
            <p className="text-muted-foreground mt-1">Organize categories, reorder items, and manage availability.</p>
        </div>
        <MotionButton 
          onClick={handleAddNewItem}
          className="bg-indigo-600 text-white hover:bg-indigo-700"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <PlusCircle size={20} className="mr-2" />
          Add New Item
        </MotionButton>
      </div>

      {/* Search & Bulk Actions Bar */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 p-3 bg-gray-800/50 border border-gray-700 rounded-xl">
        <div className="flex items-center gap-2 w-full max-w-sm">
            <Search size={20} className="text-muted-foreground"/>
            <input placeholder="Search for a dish..." className="w-full bg-transparent focus:outline-none placeholder-gray-500 dark:placeholder-gray-400 text-white"/>
        </div>
      </div>
      
      {/* Menu Categories */}
      <div className="space-y-4">
        {Object.keys(categoryConfig).map(categoryId => {
          const config = categoryConfig[categoryId];
          const items = menu[categoryId] || [];
          
          return (
            <MenuCategory
                key={categoryId}
                categoryId={categoryId}
                title={config.title}
                icon={config.icon}
                items={items}
                onDeleteItem={handleDeleteItem}
                onEditItem={handleEditItem}
                onToggleAvailability={handleToggleAvailability}
                setMenu={setMenu}
                open={openCategory}
                setOpen={setOpenCategory}
            />
          );
        })}
      </div>
    </div>
  );
}
