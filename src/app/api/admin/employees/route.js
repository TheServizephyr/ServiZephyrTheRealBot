import { NextResponse } from 'next/server';
import { getAuth, getFirestore } from '@/lib/firebase-admin';
import { getRoleDisplayName, normalizeBusinessType } from '@/lib/permissions';

const BUSINESS_COLLECTIONS = [
    { collectionName: 'restaurants', businessType: 'restaurant', label: 'Restaurant' },
    { collectionName: 'shops', businessType: 'store', label: 'Store' },
    { collectionName: 'street_vendors', businessType: 'street-vendor', label: 'Street Vendor' },
];

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

const normalizeStatus = (status) => {
    const normalized = String(status || 'active').trim().toLowerCase();
    if (['inactive', 'blocked', 'removed', 'deleted', 'disabled'].includes(normalized)) return 'inactive';
    if (normalized === 'pending') return 'pending';
    return 'active';
};

const normalizeEmployeeKey = (employee = {}) => (
    String(employee.userId || employee.uid || employee.id || employee.email || '').trim().toLowerCase()
);

const getEmployeeBusinessKey = ({ employee, fallbackId, business }) => {
    const employeeKey = normalizeEmployeeKey({ ...employee, userId: employee.userId || employee.uid || employee.id || fallbackId });
    return `${business.collectionName}:${business.id}:${employeeKey}`;
};

const getBusinessTypeFromCollection = (collectionName, data = {}) => {
    const configured = normalizeBusinessType(data.businessType);
    if (configured) return configured;
    if (collectionName === 'shops') return 'store';
    if (collectionName === 'street_vendors') return 'street-vendor';
    return 'restaurant';
};

const getBusinessLabel = (businessType) => {
    if (businessType === 'store') return 'Store';
    if (businessType === 'street-vendor') return 'Street Vendor';
    return 'Restaurant';
};

const serializeBusiness = (doc, collectionName) => {
    const data = doc.data() || {};
    const businessType = getBusinessTypeFromCollection(collectionName, data);
    return {
        id: doc.id,
        collectionName,
        businessType,
        businessTypeLabel: getBusinessLabel(businessType),
        name: data.name || data.restaurantName || data.businessName || 'Unnamed Business',
        ownerId: data.ownerId || '',
        ownerName: data.ownerName || data.contactName || 'N/A',
        ownerEmail: data.ownerEmail || data.email || 'N/A',
        ownerPhone: data.ownerPhone || data.phone || data.phoneNumber || '',
        status: data.approvalStatus || data.status || 'unknown',
        onboarded: pickTimestamp(data, ['createdAt', 'onboardedAt', 'updatedAt']) || null,
        raw: data,
    };
};

const serializeEmployee = ({ employee, fallbackId, business, userData = null, source = 'subcollection' }) => {
    const role = employee.role || employee.employeeRole || 'custom';
    const userId = employee.userId || employee.uid || employee.id || fallbackId || '';
    const status = normalizeStatus(employee.status);
    const customRoleName = employee.customRoleName || userData?.customRoleName || '';

    return {
        id: `${business.collectionName}:${business.id}:${userId || employee.email || fallbackId}`,
        userId,
        name: employee.name || userData?.name || userData?.displayName || 'Unnamed Employee',
        email: employee.email || userData?.email || 'No Email',
        phone: employee.phone || employee.phoneNumber || userData?.phone || userData?.phoneNumber || 'No Phone',
        role,
        roleDisplay: role === 'custom'
            ? (customRoleName || 'Custom')
            : getRoleDisplayName(role, business.businessType),
        customRoleName,
        customAllowedPages: Array.isArray(employee.customAllowedPages) ? employee.customAllowedPages : [],
        permissions: Array.isArray(employee.permissions) ? employee.permissions : [],
        status,
        businessId: business.id,
        businessName: business.name,
        businessType: business.businessType,
        businessTypeLabel: business.businessTypeLabel,
        collectionName: business.collectionName,
        ownerId: business.ownerId,
        ownerName: business.ownerName,
        ownerEmail: business.ownerEmail,
        ownerPhone: business.ownerPhone,
        addedAt: pickTimestamp(employee, ['addedAt', 'createdAt', 'joinedAt']),
        acceptedAt: pickTimestamp(employee, ['acceptedAt']),
        updatedAt: pickTimestamp(employee, ['updatedAt']),
        source,
        hasUserAccount: Boolean(userData || userId),
    };
};

async function fetchBusinesses(firestore) {
    const snapshots = await Promise.all(
        BUSINESS_COLLECTIONS.map((config) => firestore.collection(config.collectionName).get())
    );

    return snapshots.flatMap((snapshot, index) => (
        snapshot.docs
            .map((doc) => serializeBusiness(doc, BUSINESS_COLLECTIONS[index].collectionName))
            .filter((business) => business.id)
    ));
}

async function fetchOwnerMap(firestore, ownerIds) {
    const cleanOwnerIds = Array.from(new Set(
        ownerIds.map((value) => String(value || '').trim()).filter(Boolean)
    ));
    const ownerMap = new Map();

    for (let i = 0; i < cleanOwnerIds.length; i += 250) {
        const ids = cleanOwnerIds.slice(i, i + 250);
        const refs = ids.map((id) => firestore.collection('users').doc(id));
        const docs = await firestore.getAll(...refs);
        docs.forEach((doc) => {
            if (!doc.exists) return;
            const data = doc.data() || {};
            ownerMap.set(doc.id, {
                ownerName: data.name || data.displayName || data.whatsappName || '',
                ownerEmail: data.email || '',
                ownerPhone: data.phone || data.phoneNumber || '',
            });
        });
    }

    const missingOwnerIds = cleanOwnerIds.filter((id) => {
        const owner = ownerMap.get(id);
        return !owner?.ownerName || !owner?.ownerEmail;
    });

    if (missingOwnerIds.length > 0) {
        try {
            const auth = await getAuth();
            for (let i = 0; i < missingOwnerIds.length; i += 100) {
                const identifiers = missingOwnerIds.slice(i, i + 100).map((uid) => ({ uid }));
                const result = await auth.getUsers(identifiers);
                result.users.forEach((userRecord) => {
                    const existing = ownerMap.get(userRecord.uid) || {};
                    ownerMap.set(userRecord.uid, {
                        ownerName: existing.ownerName || userRecord.displayName || 'N/A',
                        ownerEmail: existing.ownerEmail || userRecord.email || 'N/A',
                        ownerPhone: existing.ownerPhone || userRecord.phoneNumber || '',
                    });
                });
            }
        } catch (error) {
            console.warn('[admin employees] Owner auth lookup skipped:', error?.message || error);
        }
    }

    return ownerMap;
}

function applyOwnerDetails(businesses, ownerMap) {
    return businesses.map((business) => {
        const owner = ownerMap.get(business.ownerId) || {};
        return {
            ...business,
            ownerName: business.ownerName !== 'N/A' ? business.ownerName : (owner.ownerName || 'N/A'),
            ownerEmail: business.ownerEmail !== 'N/A' ? business.ownerEmail : (owner.ownerEmail || 'N/A'),
            ownerPhone: business.ownerPhone || owner.ownerPhone || '',
        };
    });
}

async function fetchEmployeesForBusiness(firestore, business) {
    const employeesSnap = await firestore
        .collection(business.collectionName)
        .doc(business.id)
        .collection('employees')
        .get();

    const seen = new Set();
    const employees = employeesSnap.docs.map((doc) => {
        const data = doc.data() || {};
        const key = normalizeEmployeeKey({ ...data, userId: data.userId || doc.id });
        if (key) seen.add(key);
        return { employee: data, fallbackId: doc.id, business, source: 'subcollection' };
    });

    const legacyEmployees = Array.isArray(business.raw?.employees)
        ? business.raw.employees
            .map((employee, index) => {
                const key = normalizeEmployeeKey(employee);
                if (!key || seen.has(key)) return null;
                seen.add(key);
                return {
                    employee,
                    fallbackId: employee.userId || employee.uid || employee.id || `legacy-${index}`,
                    business,
                    source: 'legacy-array',
                };
            })
            .filter(Boolean)
        : [];

    return [...employees, ...legacyEmployees];
}

async function fetchLinkedOutletEmployees(firestore, businessMap, seenKeys) {
    const usersSnap = await firestore.collection('users').get();
    const linkedEmployees = [];

    usersSnap.docs.forEach((doc) => {
        const userData = doc.data() || {};
        if (userData.isDeleted) return;

        const linkedOutlets = Array.isArray(userData.linkedOutlets) ? userData.linkedOutlets : [];
        linkedOutlets.forEach((outlet, index) => {
            const collectionName = outlet.collectionName || 'restaurants';
            const outletId = outlet.outletId || outlet.businessId || outlet.restaurantId;
            if (!outletId) return;

            const business = businessMap.get(`${collectionName}:${outletId}`);
            if (!business) return;

            const employee = {
                userId: doc.id,
                email: userData.email || outlet.email || '',
                name: userData.name || outlet.name || '',
                phone: userData.phone || userData.phoneNumber || outlet.phone || '',
                role: outlet.employeeRole || outlet.role || 'custom',
                permissions: outlet.permissions || [],
                status: outlet.status || (outlet.isActive === false ? 'inactive' : 'active'),
                joinedAt: outlet.joinedAt,
                customRoleName: outlet.customRoleName,
                customAllowedPages: outlet.customAllowedPages,
            };

            const record = {
                employee,
                fallbackId: doc.id || `linked-${index}`,
                business,
                source: 'linked-outlets',
            };
            const recordKey = getEmployeeBusinessKey(record);
            if (seenKeys.has(recordKey)) return;
            seenKeys.add(recordKey);
            linkedEmployees.push({ ...record, userData });
        });
    });

    return linkedEmployees;
}

async function fetchUserMap(firestore, employeeRecords) {
    const userIds = Array.from(new Set(
        employeeRecords
            .map(({ employee, fallbackId }) => employee.userId || employee.uid || employee.id || fallbackId)
            .map((value) => String(value || '').trim())
            .filter((value) => value && !value.includes('@') && !value.startsWith('legacy-'))
    ));

    const userMap = new Map();
    for (let i = 0; i < userIds.length; i += 250) {
        const refs = userIds.slice(i, i + 250).map((id) => firestore.collection('users').doc(id));
        if (refs.length === 0) continue;
        const docs = await firestore.getAll(...refs);
        docs.forEach((doc) => {
            if (doc.exists) userMap.set(doc.id, doc.data() || {});
        });
    }

    return userMap;
}

async function fetchPendingInvites(firestore, businessMap) {
    const snapshot = await firestore
        .collection('employee_invitations')
        .where('status', '==', 'pending')
        .get();

    return snapshot.docs.map((doc) => {
        const data = doc.data() || {};
        const businessKey = `${data.collectionName || 'restaurants'}:${data.outletId || ''}`;
        const business = businessMap.get(businessKey) || {
            id: data.outletId || '',
            name: data.outletName || 'Unknown Business',
            businessType: getBusinessTypeFromCollection(data.collectionName || 'restaurants', {}),
            businessTypeLabel: getBusinessLabel(getBusinessTypeFromCollection(data.collectionName || 'restaurants', {})),
            collectionName: data.collectionName || 'restaurants',
            ownerId: data.ownerId || '',
            ownerName: 'N/A',
            ownerEmail: 'N/A',
        };
        const role = data.role || 'custom';
        return {
            id: doc.id,
            inviteCode: doc.id,
            name: data.name || 'Pending Invite',
            email: data.email || 'No Email',
            phone: data.phone || 'No Phone',
            role,
            roleDisplay: role === 'custom'
                ? (data.customRoleName || 'Custom')
                : getRoleDisplayName(role, business.businessType),
            customRoleName: data.customRoleName || '',
            customAllowedPages: Array.isArray(data.customAllowedPages) ? data.customAllowedPages : [],
            permissions: Array.isArray(data.permissions) ? data.permissions : [],
            status: 'pending',
            businessId: business.id,
            businessName: business.name,
            businessType: business.businessType,
            businessTypeLabel: business.businessTypeLabel,
            collectionName: business.collectionName,
            ownerId: data.ownerId || business.ownerId || '',
            ownerName: business.ownerName || 'N/A',
            ownerEmail: business.ownerEmail || 'N/A',
            invitedBy: data.invitedBy || '',
            invitedByName: data.invitedByName || '',
            createdAt: toIso(data.createdAt),
            expiresAt: toIso(data.expiresAt),
        };
    });
}

export async function GET(req) {
    try {
        const { verifyAdmin } = await import('@/lib/verify-admin');
        await verifyAdmin(req);

        const firestore = await getFirestore();
        const rawBusinesses = await fetchBusinesses(firestore);
        const ownerMap = await fetchOwnerMap(firestore, rawBusinesses.map((business) => business.ownerId));
        const businesses = applyOwnerDetails(rawBusinesses, ownerMap);
        const businessMap = new Map(
            businesses.map((business) => [`${business.collectionName}:${business.id}`, business])
        );

        const employeeRecords = (await Promise.all(
            businesses.map((business) => fetchEmployeesForBusiness(firestore, business))
        )).flat();
        const seenEmployeeBusinessKeys = new Set(employeeRecords.map(getEmployeeBusinessKey));
        const linkedOutletEmployees = await fetchLinkedOutletEmployees(firestore, businessMap, seenEmployeeBusinessKeys);
        const allEmployeeRecords = [...employeeRecords, ...linkedOutletEmployees];

        const userMap = await fetchUserMap(firestore, allEmployeeRecords);
        const employees = allEmployeeRecords.map((record) => {
            const userId = String(record.employee.userId || record.employee.uid || record.employee.id || record.fallbackId || '').trim();
            return serializeEmployee({
                ...record,
                userData: record.userData || userMap.get(userId) || null,
            });
        });

        const pendingInvites = await fetchPendingInvites(firestore, businessMap);

        employees.sort((a, b) => {
            const dateA = new Date(a.acceptedAt || a.addedAt || a.updatedAt || 0);
            const dateB = new Date(b.acceptedAt || b.addedAt || b.updatedAt || 0);
            return dateB - dateA;
        });

        pendingInvites.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        const summaries = businesses.map((business) => {
            const businessEmployees = employees.filter((employee) => (
                employee.collectionName === business.collectionName && employee.businessId === business.id
            ));
            const businessPending = pendingInvites.filter((invite) => (
                invite.collectionName === business.collectionName && invite.businessId === business.id
            ));

            return {
                id: business.id,
                collectionName: business.collectionName,
                businessName: business.name,
                businessType: business.businessType,
                businessTypeLabel: business.businessTypeLabel,
                ownerId: business.ownerId,
                ownerName: business.ownerName,
                ownerEmail: business.ownerEmail,
                activeEmployees: businessEmployees.filter((employee) => employee.status === 'active').length,
                inactiveEmployees: businessEmployees.filter((employee) => employee.status === 'inactive').length,
                pendingInvites: businessPending.length,
                totalEmployees: businessEmployees.length,
            };
        }).filter((summary) => summary.totalEmployees > 0 || summary.pendingInvites > 0)
            .sort((a, b) => (b.activeEmployees + b.pendingInvites) - (a.activeEmployees + a.pendingInvites));

        return NextResponse.json({
            employees,
            pendingInvites,
            summaries,
            counts: {
                totalEmployees: employees.length,
                activeEmployees: employees.filter((employee) => employee.status === 'active').length,
                inactiveEmployees: employees.filter((employee) => employee.status === 'inactive').length,
                pendingInvites: pendingInvites.length,
                businessesWithStaff: summaries.length,
            },
        }, { status: 200 });
    } catch (error) {
        console.error('GET /api/admin/employees ERROR:', error);
        return NextResponse.json(
            { message: 'Internal Server Error', error: error.message },
            { status: error.status || 500 }
        );
    }
}
