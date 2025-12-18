/**
 * Employee Management API
 * 
 * Endpoints:
 * - POST: Invite new employee (send email invitation)
 * - GET: List employees for outlet
 * - PATCH: Update employee role/permissions/status
 * - DELETE: Remove employee from outlet
 */

import { NextResponse } from 'next/server';
import { getFirestore, FieldValue, verifyAndGetUid } from '@/lib/firebase-admin';
import { verifyAccessWithRBAC, PERMISSIONS } from '@/lib/verify-access-rbac';
import { ROLES, ROLE_PERMISSIONS, ROLE_DISPLAY_NAMES, EMPLOYEE_ROLES, canManageRole, getInvitableRoles } from '@/lib/permissions';
import crypto from 'crypto';

// ============================================
// HELPER: Generate unique invite code
// ============================================
function generateInviteCode() {
    return crypto.randomBytes(16).toString('hex');
}

// ============================================
// HELPER: Get collection name for business type
// ============================================
function getCollectionName(businessType) {
    if (businessType === 'shop') return 'shops';
    if (businessType === 'street-vendor') return 'street_vendors';
    return 'restaurants';
}

// ============================================
// POST: Invite new employee
// ============================================
export async function POST(req) {
    try {
        const firestore = await getFirestore();

        // Verify owner/manager access with permission to invite
        const accessContext = await verifyAccessWithRBAC(req, PERMISSIONS.INVITE_EMPLOYEE);

        const body = await req.json();
        const { email, role, name, phone, customPermissions, customRoleName, customAllowedPages } = body;

        // Validation
        if (!email || !role) {
            return NextResponse.json(
                { message: 'Email and role are required.' },
                { status: 400 }
            );
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return NextResponse.json(
                { message: 'Invalid email format.' },
                { status: 400 }
            );
        }

        // Validate role - allow 'custom' role as well
        if (!EMPLOYEE_ROLES.includes(role) && role !== 'custom') {
            return NextResponse.json(
                { message: `Invalid role. Must be one of: ${EMPLOYEE_ROLES.join(', ')}, custom` },
                { status: 400 }
            );
        }

        // For custom role, require customRoleName and customAllowedPages
        if (role === 'custom') {
            if (!customRoleName || !customAllowedPages || customAllowedPages.length === 0) {
                return NextResponse.json(
                    { message: 'Custom role requires a name and at least one page access.' },
                    { status: 400 }
                );
            }
        }

        // Check if inviter can manage this role
        if (!canManageRole(accessContext.role, role)) {
            return NextResponse.json(
                { message: `You cannot invite ${role}. Only higher-level roles can invite.` },
                { status: 403 }
            );
        }

        const outletId = accessContext.outletId;
        const outletData = accessContext.outletData;
        const collectionName = accessContext.collectionName;

        // Check if employee already exists for this outlet
        const existingEmployees = outletData.employees || [];
        const existingEmployee = existingEmployees.find(e => e.email === email.toLowerCase());

        if (existingEmployee && existingEmployee.status === 'active') {
            return NextResponse.json(
                { message: 'This email is already an employee at this outlet.' },
                { status: 409 }
            );
        }

        // Check for pending invitation
        const pendingInviteQuery = await firestore
            .collection('employee_invitations')
            .where('email', '==', email.toLowerCase())
            .where('outletId', '==', outletId)
            .where('status', '==', 'pending')
            .limit(1)
            .get();

        if (!pendingInviteQuery.empty) {
            return NextResponse.json(
                { message: 'An invitation is already pending for this email.' },
                { status: 409 }
            );
        }

        // Generate invite code
        const inviteCode = generateInviteCode();

        // Get permissions for this role (or custom if provided)
        const permissions = customPermissions || ROLE_PERMISSIONS[role] || [];

        // Create invitation document
        const invitationData = {
            inviteCode,
            email: email.toLowerCase(),
            name: name || '',
            phone: phone || '',
            role,
            permissions,
            outletId,
            outletName: outletData.name,
            collectionName,
            ownerId: accessContext.isOwner ? accessContext.uid : accessContext.ownerId,
            invitedBy: accessContext.uid,
            invitedByName: accessContext.isOwner ? outletData.name : accessContext.employeeName,
            status: 'pending',
            createdAt: FieldValue.serverTimestamp(),
            expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
            // Custom role fields
            ...(role === 'custom' && {
                customRoleName,
                customAllowedPages,  // Array of page IDs this employee can access
            }),
        };

        await firestore.collection('employee_invitations').doc(inviteCode).set(invitationData);

        // Generate invite link
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.servizephyr.com';
        const inviteLink = `${baseUrl}/join/${inviteCode}`;

        console.log(`[EMPLOYEES API] Invitation created for ${email} as ${role} at outlet ${outletId}`);

        // TODO: Send email with invite link (integrate with email service)
        // For now, return the link in response for testing

        return NextResponse.json({
            message: 'Invitation sent successfully!',
            invitation: {
                email,
                role,
                roleDisplay: role === 'custom' ? customRoleName : ROLE_DISPLAY_NAMES[role],
                inviteLink, // Remove in production, send via email only
                expiresAt: invitationData.expiresAt,
            }
        }, { status: 201 });

    } catch (error) {
        console.error('[EMPLOYEES API] POST Error:', error);
        return NextResponse.json(
            { message: error.message || 'Failed to invite employee.' },
            { status: error.status || 500 }
        );
    }
}

// ============================================
// GET: List employees for outlet
// ============================================
export async function GET(req) {
    try {
        const firestore = await getFirestore();

        // Verify access with permission to view employees
        const accessContext = await verifyAccessWithRBAC(req, PERMISSIONS.VIEW_EMPLOYEES);

        const outletData = accessContext.outletData;
        const outletId = accessContext.outletId;
        const currentUserId = accessContext.uid;

        // Role hierarchy for sorting (lower number = higher rank)
        const ROLE_HIERARCHY = {
            'owner': 0,
            'manager': 1,
            'chef': 2,
            'waiter': 3,
            'cashier': 4,
            'order_taker': 5,
            'custom': 6,
        };

        // Get employees from outlet document
        const employeesFromOutlet = (outletData.employees || []).map(emp => ({
            ...emp,
            roleDisplay: emp.role === 'custom'
                ? (emp.customRoleName || 'Custom')
                : ROLE_DISPLAY_NAMES[emp.role],
            hierarchyOrder: ROLE_HIERARCHY[emp.role] || 99,
        }));

        // Create owner entry (always at top)
        // Use outletData.ownerId as the authoritative source
        const ownerId = outletData.ownerId;
        const ownerEntry = {
            userId: ownerId,
            email: outletData.email || outletData.ownerEmail || '',
            name: outletData.ownerName || outletData.restaurantName || outletData.name || 'Owner',
            phone: outletData.phone || outletData.ownerPhone || '',
            role: 'owner',
            roleDisplay: 'Owner',
            status: 'active',
            hierarchyOrder: 0,
            isOwner: true,
        };

        // Combine owner + employees, sort by hierarchy
        const allTeamMembers = [ownerEntry, ...employeesFromOutlet]
            .sort((a, b) => a.hierarchyOrder - b.hierarchyOrder);

        // Get pending invitations
        const pendingInvitesQuery = await firestore
            .collection('employee_invitations')
            .where('outletId', '==', outletId)
            .where('status', '==', 'pending')
            .get();

        const pendingInvites = pendingInvitesQuery.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                email: data.email,
                name: data.name,
                role: data.role,
                roleDisplay: data.role === 'custom'
                    ? (data.customRoleName || 'Custom')
                    : ROLE_DISPLAY_NAMES[data.role],
                status: 'pending',
                invitedBy: data.invitedByName,
                createdAt: data.createdAt?.toDate?.() || data.createdAt,
                expiresAt: data.expiresAt,
                hierarchyOrder: ROLE_HIERARCHY[data.role] || 99,
            };
        }).sort((a, b) => a.hierarchyOrder - b.hierarchyOrder);

        // Get roles that current user can invite  
        const invitableRoles = getInvitableRoles(accessContext.role).map(role => ({
            value: role,
            label: ROLE_DISPLAY_NAMES[role] || role, // Now using string directly
        }));

        return NextResponse.json({
            employees: allTeamMembers,
            pendingInvites,
            invitableRoles,
            currentUserId, // For frontend to show "(You)" label
            canInvite: accessContext.permissions.includes(PERMISSIONS.INVITE_EMPLOYEE),
            canManage: accessContext.permissions.includes(PERMISSIONS.MANAGE_EMPLOYEES),
        }, { status: 200 });

    } catch (error) {
        console.error('[EMPLOYEES API] GET Error:', error);
        return NextResponse.json(
            { message: error.message || 'Failed to fetch employees.' },
            { status: error.status || 500 }
        );
    }
}

// ============================================
// PATCH: Update employee role/permissions/status
// ============================================
export async function PATCH(req) {
    try {
        const firestore = await getFirestore();

        // Verify access with permission to manage employees
        const accessContext = await verifyAccessWithRBAC(req, PERMISSIONS.MANAGE_EMPLOYEES);

        const body = await req.json();
        const {
            employeeId,        // User ID of employee to update
            action,            // 'updateRole', 'updatePermissions', 'deactivate', 'reactivate'
            newRole,
            newPermissions,
        } = body;

        if (!employeeId || !action) {
            return NextResponse.json(
                { message: 'Employee ID and action are required.' },
                { status: 400 }
            );
        }

        const outletId = accessContext.outletId;
        const collectionName = accessContext.collectionName;
        const outletRef = firestore.collection(collectionName).doc(outletId);

        const outletDoc = await outletRef.get();
        const employees = outletDoc.data().employees || [];

        const employeeIndex = employees.findIndex(e => e.userId === employeeId);
        if (employeeIndex === -1) {
            return NextResponse.json(
                { message: 'Employee not found.' },
                { status: 404 }
            );
        }

        const currentEmployee = employees[employeeIndex];

        // Check if current user can manage this employee's role
        if (!canManageRole(accessContext.role, currentEmployee.role)) {
            return NextResponse.json(
                { message: 'You cannot manage employees at or above your level.' },
                { status: 403 }
            );
        }

        // Apply action
        switch (action) {
            case 'updateRole':
                if (!newRole || !EMPLOYEE_ROLES.includes(newRole)) {
                    return NextResponse.json(
                        { message: 'Invalid new role.' },
                        { status: 400 }
                    );
                }
                if (!canManageRole(accessContext.role, newRole)) {
                    return NextResponse.json(
                        { message: 'You cannot assign this role.' },
                        { status: 403 }
                    );
                }
                employees[employeeIndex].role = newRole;
                employees[employeeIndex].permissions = ROLE_PERMISSIONS[newRole];
                break;

            case 'updatePermissions':
                if (!newPermissions || !Array.isArray(newPermissions)) {
                    return NextResponse.json(
                        { message: 'New permissions array required.' },
                        { status: 400 }
                    );
                }
                employees[employeeIndex].permissions = newPermissions;
                break;

            case 'deactivate':
                employees[employeeIndex].status = 'inactive';
                employees[employeeIndex].deactivatedAt = new Date();
                employees[employeeIndex].deactivatedBy = accessContext.uid;
                break;

            case 'reactivate':
                employees[employeeIndex].status = 'active';
                employees[employeeIndex].reactivatedAt = new Date();
                break;

            default:
                return NextResponse.json(
                    { message: 'Invalid action.' },
                    { status: 400 }
                );
        }

        employees[employeeIndex].updatedAt = new Date();
        employees[employeeIndex].updatedBy = accessContext.uid;

        // Update outlet document
        await outletRef.update({ employees });

        // Also update the employee's user document if deactivating/reactivating
        if (action === 'deactivate' || action === 'reactivate' || action === 'updateRole' || action === 'updatePermissions') {
            const employeeUserRef = firestore.collection('users').doc(employeeId);
            const employeeUserDoc = await employeeUserRef.get();

            if (employeeUserDoc.exists) {
                const linkedOutlets = employeeUserDoc.data().linkedOutlets || [];
                const outletIndex = linkedOutlets.findIndex(o => o.outletId === outletId);

                if (outletIndex !== -1) {
                    linkedOutlets[outletIndex] = {
                        ...linkedOutlets[outletIndex],
                        status: employees[employeeIndex].status,
                        employeeRole: employees[employeeIndex].role,
                        permissions: employees[employeeIndex].permissions,
                    };
                    await employeeUserRef.update({ linkedOutlets });
                }
            }
        }

        console.log(`[EMPLOYEES API] Employee ${employeeId} updated with action: ${action}`);

        return NextResponse.json({
            message: `Employee ${action} successfully.`,
            employee: employees[employeeIndex],
        }, { status: 200 });

    } catch (error) {
        console.error('[EMPLOYEES API] PATCH Error:', error);
        return NextResponse.json(
            { message: error.message || 'Failed to update employee.' },
            { status: error.status || 500 }
        );
    }
}

// ============================================
// DELETE: Remove employee from outlet
// ============================================
export async function DELETE(req) {
    try {
        const firestore = await getFirestore();

        // Only owner can permanently remove employees
        const accessContext = await verifyAccessWithRBAC(req, PERMISSIONS.REMOVE_EMPLOYEE);

        const { searchParams } = new URL(req.url);
        const employeeId = searchParams.get('employeeId');
        const inviteCode = searchParams.get('inviteCode');

        if (!employeeId && !inviteCode) {
            return NextResponse.json(
                { message: 'Employee ID or invite code required.' },
                { status: 400 }
            );
        }

        const outletId = accessContext.outletId;
        const collectionName = accessContext.collectionName;

        // Handle pending invite cancellation
        if (inviteCode) {
            const inviteRef = firestore.collection('employee_invitations').doc(inviteCode);
            const inviteDoc = await inviteRef.get();

            if (!inviteDoc.exists || inviteDoc.data().outletId !== outletId) {
                return NextResponse.json(
                    { message: 'Invitation not found.' },
                    { status: 404 }
                );
            }

            await inviteRef.update({
                status: 'cancelled',
                cancelledAt: FieldValue.serverTimestamp(),
                cancelledBy: accessContext.uid,
            });

            return NextResponse.json({
                message: 'Invitation cancelled.',
            }, { status: 200 });
        }

        // Handle employee removal
        const outletRef = firestore.collection(collectionName).doc(outletId);
        const outletDoc = await outletRef.get();
        const employees = outletDoc.data().employees || [];

        const employeeIndex = employees.findIndex(e => e.userId === employeeId);
        if (employeeIndex === -1) {
            return NextResponse.json(
                { message: 'Employee not found.' },
                { status: 404 }
            );
        }

        const removedEmployee = employees[employeeIndex];

        // Check if current user can manage this employee
        if (!canManageRole(accessContext.role, removedEmployee.role)) {
            return NextResponse.json(
                { message: 'You cannot remove employees at or above your level.' },
                { status: 403 }
            );
        }

        // Remove from outlet's employee array
        employees.splice(employeeIndex, 1);
        await outletRef.update({ employees });

        // Update employee's user document - remove this outlet from linkedOutlets
        const employeeUserRef = firestore.collection('users').doc(employeeId);
        const employeeUserDoc = await employeeUserRef.get();

        if (employeeUserDoc.exists) {
            const linkedOutlets = employeeUserDoc.data().linkedOutlets || [];
            const updatedLinkedOutlets = linkedOutlets.filter(o => o.outletId !== outletId);

            const updateData = { linkedOutlets: updatedLinkedOutlets };

            // If no more linked outlets, update role back to customer
            if (updatedLinkedOutlets.length === 0) {
                const currentRoles = employeeUserDoc.data().roles || [];
                updateData.roles = currentRoles.filter(r => r !== 'employee');
                if (updateData.roles.length === 0) {
                    updateData.roles = ['customer'];
                }
                updateData.role = updateData.roles[0]; // Primary role
            }

            await employeeUserRef.update(updateData);
        }

        console.log(`[EMPLOYEES API] Employee ${employeeId} removed from outlet ${outletId}`);

        return NextResponse.json({
            message: 'Employee removed successfully.',
        }, { status: 200 });

    } catch (error) {
        console.error('[EMPLOYEES API] DELETE Error:', error);
        return NextResponse.json(
            { message: error.message || 'Failed to remove employee.' },
            { status: error.status || 500 }
        );
    }
}
