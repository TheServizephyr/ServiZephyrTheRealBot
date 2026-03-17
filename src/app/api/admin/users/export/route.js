import { NextResponse } from 'next/server';
import { getFirestore } from '@/lib/firebase-admin';

const toIso = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const pickTimestamp = (data, fields) => {
    for (const field of fields) {
        const iso = toIso(data?.[field]);
        if (iso) return iso;
    }
    return null;
};

const firstAddressText = (addresses) => {
    if (!Array.isArray(addresses) || addresses.length === 0) return 'No Address';
    const addr = addresses[0] || {};
    return addr.full || [
        addr.street,
        addr.area,
        addr.city,
        addr.state,
        addr.postalCode,
        addr.country
    ].filter(Boolean).join(', ') || 'No Address';
};

const formatDateTime = (isoString) => {
    if (!isoString || isoString === 'Unknown') return isoString;
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return isoString;
        
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        
        let hh = date.getHours();
        const ampm = hh >= 12 ? 'PM' : 'AM';
        hh = hh % 12;
        hh = hh ? hh : 12;
        const mins = String(date.getMinutes()).padStart(2, '0');
        
        return `${dd}-${mm}-${yyyy} (${hh}:${mins} ${ampm})`;
    } catch (e) {
        return isoString;
    }
};

export async function GET(req) {
    try {
        const { verifyAdmin } = await import('@/lib/verify-admin');
        await verifyAdmin(req);

        const { searchParams } = new URL(req.url);
        const targetRole = searchParams.get('role');

        const firestore = await getFirestore();

        let allUsers = [];

        if (targetRole === 'Guest Customer') {
            const guestProfilesSnap = await firestore.collection('guest_profiles').get();
            allUsers = guestProfilesSnap.docs.map(doc => {
                const data = doc.data();
                if (data.isDeleted) return null;
                const joinDate = pickTimestamp(data, ['createdAt']) || 'Unknown';
                const lastActivity = pickTimestamp(data, ['lastActivityAt', 'lastSeen', 'updatedAt', 'lastOrderAt']) || joinDate;
                const phone = data.phone || 'No Phone';
                return {
                    "User ID": doc.id,
                    "Name": data.name || `Guest ${phone.slice(-4) || doc.id.slice(-4)}`,
                    "Email": data.email || 'Guest (No Email)',
                    "Phone": phone,
                    "Address": firstAddressText(data.addresses),
                    "Role": 'Guest Customer',
                    "First Join Date": joinDate,
                    "Last Activity": lastActivity,
                    "Total Orders": 0,
                    "Current Status": (data.status === 'Blocked' || data.blocked) ? 'Blocked' : 'Active',
                };
            }).filter(Boolean);
        } else {
            const usersSnap = await firestore.collection('users').get();
            allUsers = usersSnap.docs.map(doc => {
                const data = doc.data();
                if (data.isDeleted) return null;
                let role = 'Customer';
                if (data.role === 'admin' || data.isAdmin) role = 'Admin';
                else if (data.businessType === 'restaurant') role = 'Owner';
                else if (data.businessType === 'shop' || data.businessType === 'store') role = 'Shop Owner';
                else if (data.businessType === 'street-vendor' || data.businessType === 'street_vendor') role = 'Street Vendor';
                else if (data.role === 'rider' || data.role === 'delivery') role = 'Rider';
                else if (data.role === 'owner') role = 'Owner';
                else if (data.role) role = data.role.charAt(0).toUpperCase() + data.role.slice(1);
                
                if (targetRole && role !== targetRole) {
                    if (!(targetRole === 'Shop Owner' && role === 'Store Owner')) return null;
                }
                const joinDate = pickTimestamp(data, ['createdAt', 'created_at', 'registeredAt', 'timestamp', 'joinedAt']) || 'Unknown';
                const lastActivity = pickTimestamp(data, ['lastActivityAt', 'lastSeen', 'updatedAt', 'lastLoginAt', 'lastOrderAt']) || joinDate;
                return {
                    "User ID": doc.id,
                    "Name": data.name || 'Unnamed User',
                    "Email": data.email || 'No Email',
                    "Phone": data.phone || data.phoneNumber || 'No Phone',
                    "Address": firstAddressText(data.addresses),
                    "Role": role,
                    "First Join Date": joinDate,
                    "Last Activity": lastActivity,
                    "Total Orders": 0,
                    "Current Status": data.status || 'Active',
                };
            }).filter(Boolean);
        }

        const businessMap = {};
        const [rSnap, sSnap, vSnap] = await Promise.all([
            firestore.collection('restaurants').get(),
            firestore.collection('shops').get(),
            firestore.collection('street_vendors').get()
        ]);
        rSnap.docs.forEach(d => businessMap[d.id] = d.data().name || 'Restaurant');
        sSnap.docs.forEach(d => businessMap[d.id] = d.data().name || 'Shop');
        vSnap.docs.forEach(d => businessMap[d.id] = d.data().name || 'Vendor');

        const chunkSize = 25;
        for (let i = 0; i < allUsers.length; i += chunkSize) {
            const chunk = allUsers.slice(i, i + chunkSize);
            await Promise.all(
                chunk.map(async (u) => {
                    const userId = u['User ID'];
                    let phone = String(u['Phone'] || '').replace(/\D/g, '');
                    if (phone.length > 10) phone = phone.slice(-10);

                    // 1. Orders
                    try {
                        const ordersSnap = await firestore.collection('orders').where('userId', '==', userId).get();
                        u['Total Orders'] = ordersSnap.size;
                        const bizIds = new Set();
                        ordersSnap.docs.forEach(doc => { if (doc.data().restaurantId) bizIds.add(doc.data().restaurantId); });
                        const names = Array.from(bizIds).map(id => businessMap[id] || id).filter(Boolean);
                        u['Ordered From Restaurant'] = names.length > 0 ? names.join(', ') : 'None';
                    } catch (e) {
                         console.error(`Orders error for ${userId}:`, e.message);
                         u['Total Orders'] = 0; u['Ordered From Restaurant'] = 'None';
                    }

                    // 2. Bot Conversations
                    try {
                        if (phone && phone.length === 10) {
                            const convSnap = await firestore.collectionGroup('conversations').where('customerPhone', '==', phone).get();
                            const convBizIds = new Set();
                            convSnap.docs.forEach(doc => {
                                const bId = doc.ref.parent.parent.id;
                                if (bId) convBizIds.add(bId);
                            });
                            const messaged = Array.from(convBizIds).map(id => businessMap[id] || id).filter(Boolean);
                            u['Message to Restaurant Bot'] = messaged.length > 0 ? messaged.join(', ') : 'None';
                        } else {
                            u['Message to Restaurant Bot'] = 'None';
                        }
                    } catch (e) {
                        console.error(`Convs error for ${phone}:`, e.message);
                        u['Message to Restaurant Bot'] = 'None';
                    }
                })
            );
        }

        allUsers.forEach(u => {
            u['_sortDate'] = new Date(u['First Join Date']).getTime();
            u['First Join Date'] = formatDateTime(u['First Join Date']);
            u['Last Activity'] = formatDateTime(u['Last Activity']);
        });
        allUsers.sort((a, b) => (b['_sortDate'] || 0) - (a['_sortDate'] || 0));
        allUsers.forEach(u => delete u['_sortDate']);

        return NextResponse.json({ exportData: allUsers }, { status: 200 });

    } catch (error) {
        console.error("GET /api/admin/users/export ERROR:", error);
        return NextResponse.json({ message: 'Internal Server Error', error: error.message }, { status: 500 });
    }
}
