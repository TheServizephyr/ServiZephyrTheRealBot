function toFinitePrice(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
}

function buildMenuItemMap(menu) {
    const map = new Map();
    if (!menu || typeof menu !== 'object') return map;

    Object.values(menu).forEach((items) => {
        if (!Array.isArray(items)) return;
        items.forEach((item) => {
            if (item?.id) map.set(String(item.id), item);
        });
    });

    return map;
}

function findAddon(menuItem, selectedAddon) {
    const addonName = String(selectedAddon?.name || '').trim();
    if (!addonName) return null;

    if (Array.isArray(menuItem?.addons)) {
        const addon = menuItem.addons.find((candidate) => String(candidate?.name || '').trim() === addonName);
        if (addon) return addon;
    }

    if (Array.isArray(menuItem?.addOnGroups)) {
        for (const group of menuItem.addOnGroups) {
            if (!Array.isArray(group?.options)) continue;
            const addon = group.options.find((candidate) => String(candidate?.name || '').trim() === addonName);
            if (addon) return addon;
        }
    }

    return null;
}

function resolveCurrentCartItem(cartItem, menuItem) {
    if (!menuItem || menuItem.isAvailable === false) return null;

    const portions = Array.isArray(menuItem.portions) ? menuItem.portions : [];
    const requestedPortionName = String(cartItem?.portion?.name || '').trim();
    let currentPortion = null;
    let unitPrice = 0;

    if (requestedPortionName && portions.length > 0) {
        currentPortion = portions.find((portion) => String(portion?.name || '').trim() === requestedPortionName);
        if (!currentPortion) return null;
        unitPrice = toFinitePrice(currentPortion.price);
    } else if (portions.length === 1) {
        currentPortion = portions[0];
        unitPrice = toFinitePrice(currentPortion.price);
    } else if (portions.length > 1) {
        const cartUnitPrice = toFinitePrice(cartItem?.price ?? cartItem?.totalPrice);
        currentPortion = portions.find((portion) => toFinitePrice(portion?.price) === cartUnitPrice);
        if (!currentPortion) return null;
        unitPrice = toFinitePrice(currentPortion.price);
    } else {
        unitPrice = toFinitePrice(menuItem.price);
    }

    const selectedAddOns = Array.isArray(cartItem?.selectedAddOns) ? cartItem.selectedAddOns : [];
    const syncedAddOns = [];
    for (const selectedAddon of selectedAddOns) {
        const addon = findAddon(menuItem, selectedAddon);
        if (!addon) return null;
        const addonQty = Number(selectedAddon?.quantity) || 1;
        const addonPrice = toFinitePrice(addon.price);
        unitPrice += addonPrice * addonQty;
        syncedAddOns.push({
            ...selectedAddon,
            price: addonPrice,
            quantity: addonQty,
        });
    }

    return {
        ...menuItem,
        ...cartItem,
        name: menuItem.name || cartItem.name,
        categoryId: menuItem.categoryId || cartItem.categoryId,
        portions,
        portion: currentPortion
            ? {
                ...cartItem.portion,
                ...currentPortion,
            }
            : cartItem.portion,
        portionCount: portions.length || cartItem.portionCount || 0,
        selectedAddOns: syncedAddOns,
        price: unitPrice,
        totalPrice: unitPrice,
    };
}

function didCartItemChange(before, after) {
    if (!after) return true;
    if (toFinitePrice(before?.price) !== toFinitePrice(after?.price)) return true;
    if (toFinitePrice(before?.totalPrice) !== toFinitePrice(after?.totalPrice)) return true;
    if (String(before?.name || '') !== String(after?.name || '')) return true;
    if (toFinitePrice(before?.portion?.price) !== toFinitePrice(after?.portion?.price)) return true;
    return JSON.stringify(before?.selectedAddOns || []) !== JSON.stringify(after?.selectedAddOns || []);
}

export function normalizeCartItemsAgainstMenu(cart, menu) {
    const items = Array.isArray(cart) ? cart : [];
    const menuItemMap = buildMenuItemMap(menu);
    if (!items.length || menuItemMap.size === 0) {
        return { cart: items, changed: false, removedCount: 0 };
    }

    let changed = false;
    let removedCount = 0;
    const syncedCart = [];

    items.forEach((cartItem) => {
        const menuItem = menuItemMap.get(String(cartItem?.id || ''));
        const syncedItem = resolveCurrentCartItem(cartItem, menuItem);

        if (!syncedItem) {
            changed = true;
            removedCount += 1;
            return;
        }

        if (didCartItemChange(cartItem, syncedItem)) {
            changed = true;
        }

        syncedCart.push(syncedItem);
    });

    return { cart: syncedCart, changed, removedCount };
}
