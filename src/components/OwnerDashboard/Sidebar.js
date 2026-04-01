
'use client';

import {
  LayoutDashboard,
  ClipboardList,
  Users,
  BarChart2,
  Settings,
  ChevronLeft,
  ChevronRight,
  Salad,
  Truck,
  Ticket,
  Lock,
  Bot,
  MessageSquare,
  Banknote,
  Package as PackageIcon,
  Boxes,
  ConciergeBell,
  CalendarClock,
  MapPin,
  QrCode,
  UserCircle,
  FilePlus,
  GripVertical
} from "lucide-react";
import styles from "./OwnerDashboard.module.css";
import SidebarLink from "./SidebarLink";
import { motion } from 'framer-motion';
import { useState, useEffect, useMemo, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, getDocs, collection, query, where, onSnapshot, limit } from 'firebase/firestore';
import Image from 'next/image';
import Link from "next/link";
import { useSearchParams, usePathname } from 'next/navigation';
import { canAccessPage, ROLES } from '@/lib/permissions';
import { clearAppNotificationAlarmState, emitAppNotification, setAppNotificationAlarmState } from '@/lib/appNotifications';
import { isDesktopApp } from '@/lib/desktop/runtime';

const normalizeBusinessType = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'store' || normalized === 'shop') return 'store';
  if (normalized === 'street-vendor' || normalized === 'street_vendor') return 'street-vendor';
  return 'restaurant';
};

const getCollectionsForBusinessType = (businessType = 'restaurant') => {
  const normalized = normalizeBusinessType(businessType) || 'restaurant';
  const primary =
    normalized === 'store'
      ? 'shops'
      : normalized === 'street-vendor'
        ? 'street_vendors'
        : 'restaurants';
  return [primary, ...['restaurants', 'shops', 'street_vendors'].filter((name) => name !== primary)];
};

const resolveOwnedBusiness = async (uid, businessType = 'restaurant') => {
  const collectionsToTry = getCollectionsForBusinessType(businessType);

  for (const collectionName of collectionsToTry) {
    const businessQuery = query(
      collection(db, collectionName),
      where('ownerId', '==', uid),
      limit(1)
    );
    const businessSnapshot = await getDocs(businessQuery);
    if (!businessSnapshot.empty) {
      return {
        id: businessSnapshot.docs[0].id,
        collectionName,
        data: businessSnapshot.docs[0].data() || {},
      };
    }
  }

  return null;
};

const getMenuItems = (businessType, effectiveOwnerId, paramName = 'impersonate_owner_id') => {
  // Use the appropriate param name based on context (impersonate or employee access)
  const appendParam = (href) => effectiveOwnerId ? `${href}?${paramName}=${effectiveOwnerId}` : href;

  if (businessType === 'street-vendor') {
    return [
      { name: "Live Orders", icon: ClipboardList, href: appendParam("/street-vendor-dashboard"), featureId: "live-orders" },
      { name: "My Menu", icon: Salad, href: appendParam("/street-vendor-dashboard/menu"), featureId: "menu" },
      { name: "Team", icon: Users, href: appendParam("/street-vendor-dashboard/employees"), featureId: "employees" },
      { name: "Analytics", icon: BarChart2, href: appendParam("/street-vendor-dashboard/analytics"), featureId: "analytics" },
      { name: "My QR Code", icon: QrCode, href: appendParam("/street-vendor-dashboard/qr"), featureId: "qr" },
      { name: "Coupons", icon: Ticket, href: appendParam("/street-vendor-dashboard/coupons"), featureId: "coupons" },
    ];
  }
  // Default for restaurant/store
  const isStoreBusiness = businessType === 'store' || businessType === 'shop';
  const items = [
    { name: "Dashboard", icon: LayoutDashboard, href: appendParam("/owner-dashboard"), featureId: "dashboard" },
    { name: "Manual Order", icon: FilePlus, href: appendParam("/owner-dashboard/manual-order"), featureId: "manual-order" },
    { name: "Live Orders", icon: ClipboardList, href: appendParam("/owner-dashboard/live-orders"), featureId: "live-orders" },
    isStoreBusiness
      ? { name: "Items", icon: PackageIcon, href: appendParam("/owner-dashboard/menu"), featureId: "menu" }
      : { name: "Menu", icon: Salad, href: appendParam("/owner-dashboard/menu"), featureId: "menu" },
    ...(isStoreBusiness ? [{ name: "Inventory", icon: Boxes, href: appendParam("/owner-dashboard/inventory"), featureId: "inventory" }] : []),
    { name: "Team", icon: Users, href: appendParam("/owner-dashboard/employees"), featureId: "employees" },
    { name: "Customers", icon: Users, href: appendParam("/owner-dashboard/customers"), featureId: "customers" },
    { name: "WhatsApp Direct", icon: MessageSquare, href: appendParam("/owner-dashboard/whatsapp-direct"), featureId: "whatsapp-direct" },
    { name: "Analytics", icon: BarChart2, href: appendParam("/owner-dashboard/analytics"), featureId: "analytics" },
    { name: "Delivery", icon: Truck, href: appendParam("/owner-dashboard/delivery"), featureId: "delivery" },
    { name: "Coupons", icon: Ticket, href: appendParam("/owner-dashboard/coupons"), featureId: "coupons" },
  ];

  if (!isStoreBusiness) {
    items.splice(3, 0, { name: "Dine-In", icon: ConciergeBell, href: appendParam("/owner-dashboard/dine-in"), featureId: "dine-in" });
    items.splice(5, 0, { name: "Bookings", icon: CalendarClock, href: appendParam("/owner-dashboard/bookings"), featureId: "bookings" });
  }

  return items;
};

const getSettingsItems = (businessType, effectiveOwnerId, paramName = 'impersonate_owner_id') => {
  const appendParam = (href) => effectiveOwnerId ? `${href}?${paramName}=${effectiveOwnerId}` : href;

  if (businessType === 'street-vendor') {
    return [
      { name: "My Profile", icon: UserCircle, href: appendParam("/street-vendor-dashboard/my-profile"), featureId: "my-profile" },
      { name: "Profile", icon: Users, href: appendParam("/street-vendor-dashboard/profile"), featureId: "profile" },
      { name: "Payouts", icon: Banknote, href: appendParam("/street-vendor-dashboard/payout-settings"), featureId: "payouts" },
    ];
  }
  return [
    { name: "My Profile", icon: UserCircle, href: appendParam("/owner-dashboard/my-profile"), featureId: "my-profile" },
    // { name: "Payouts", icon: Banknote, href: appendParam("/owner-dashboard/payouts"), featureId: "payouts" },
    // { name: "Onboarding", icon: Banknote, href: appendParam("/owner-dashboard/payout-settings"), featureId: "payout-settings" },
    { name: "Settings", icon: Settings, href: appendParam("/owner-dashboard/settings"), featureId: "settings" },
  ];
};


export default function Sidebar({ isOpen, setIsOpen, isMobile, isCollapsed, restrictedFeatures = [], lockedFeatures = [], status, userRole = null }) {
  const desktopRuntime = useMemo(() => isDesktopApp(), []);
  const [businessType, setBusinessType] = useState('restaurant');
  const [badgeMonitoringReady, setBadgeMonitoringReady] = useState(() => !desktopRuntime);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
  const employeeOfOwnerId = searchParams.get('employee_of');

  // Use either impersonation or employee context for links
  const effectiveOwnerId = impersonatedOwnerId || employeeOfOwnerId;
  const paramName = employeeOfOwnerId ? 'employee_of' : 'impersonate_owner_id';

  useEffect(() => {
    if (!desktopRuntime) {
      setBadgeMonitoringReady(true);
      return undefined;
    }

    const timer = setTimeout(() => {
      setBadgeMonitoringReady(true);
    }, 3500);

    return () => clearTimeout(timer);
  }, [desktopRuntime]);

  useEffect(() => {
    const storedBusinessType = normalizeBusinessType(localStorage.getItem('businessType'));

    // If accessing someone else's data (impersonation or employee), infer business type from URL
    if (effectiveOwnerId) {
      if (pathname.includes('/street-vendor-dashboard')) {
        setBusinessType('street-vendor');
        return;
      } else if (pathname.includes('/shop-dashboard')) {
        setBusinessType('store');
        return;
      }

      // owner-dashboard can be restaurant or store, so prefer persisted value from settings/login
      if (storedBusinessType) {
        setBusinessType(storedBusinessType);
      } else {
        setBusinessType('restaurant');
      }
      return;
    }

    // Only use localStorage for owner's own dashboard (not employee access)
    if (!effectiveOwnerId) {
      if (storedBusinessType) {
        setBusinessType(storedBusinessType);
      }

      if (desktopRuntime && storedBusinessType) {
        return undefined;
      }

      const fetchBusinessType = async () => {
        const user = auth.currentUser;
        if (user) {
          try {
            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
              const fetchedType = normalizeBusinessType(userDoc.data().businessType) || 'restaurant';
              if (fetchedType !== storedBusinessType) {
                setBusinessType(fetchedType);
                localStorage.setItem('businessType', fetchedType);
              }
            }
          } catch (error) {
            console.error("Error fetching business type from Firestore:", error);
            if (!storedBusinessType) setBusinessType('restaurant');
          }
        }
      };

      const unsubscribe = auth.onAuthStateChanged((user) => {
        if (user) {
          fetchBusinessType();
        }
      });

      return () => unsubscribe();
    }
  }, [desktopRuntime, effectiveOwnerId, pathname]);


  const getIsDisabled = (featureId) => {
    if (lockedFeatures.includes(featureId)) {
      return true;
    }

    // 1. If suspended, explicitly check restricted features first
    if (status === 'suspended') {
      return restrictedFeatures.includes(featureId);
    }

    // 2. Only allow essential setup pages for pending/rejected accounts
    const alwaysEnabled = ['menu', 'settings', 'connections', 'payout-settings', 'location', 'profile', 'qr', 'coupons', 'employees', 'my-profile', 'bookings', 'dine-in', 'whatsapp-direct'];
    if (alwaysEnabled.includes(featureId)) {
      return false;
    }

    if (status === 'pending' || status === 'rejected') {
      return true;
    }

    return false;
  };

  const handleLinkClick = () => {
    if (isMobile) {
      setIsOpen(false);
    }
  };

  // Get all menu items with appropriate owner ID param (for impersonation or employee access)
  const allMenuItems = getMenuItems(businessType, effectiveOwnerId, paramName);
  const allSettingsItems = getSettingsItems(businessType, effectiveOwnerId, paramName);

  // Filter items based on user role
  // null = owner accessing their own dashboard
  // For street-vendor-dashboard, treat null as STREET_VENDOR role
  // IMPORTANT: If employee_of param exists but userRole is null, role is still loading - show nothing
  const isRolePending = employeeOfOwnerId && userRole === null;
  const effectiveRole = userRole || (pathname.includes('/street-vendor-dashboard') ? ROLES.STREET_VENDOR : ROLES.OWNER);

  // Get custom allowed pages from localStorage (set by layout when employee logs in)
  // Using state so sidebar re-renders when role changes
  const [customAllowedPages, setCustomAllowedPages] = useState(() => {
    // Read from localStorage on initial mount to prevent flash
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('customAllowedPages');
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch (e) {
          return null;
        }
      }
    }
    return null;
  });

  useEffect(() => {
    // Re-read localStorage when userRole changes (layout stores pages before passing role)
    if (userRole === 'custom') {
      const stored = localStorage.getItem('customAllowedPages');
      if (stored) {
        try {
          setCustomAllowedPages(JSON.parse(stored));
        } catch (e) {
          console.error('[Sidebar] Failed to parse customAllowedPages:', e);
          setCustomAllowedPages(null);
        }
      }
    } else {
      setCustomAllowedPages(null);
    }
  }, [userRole]);

  const [isMounted, setIsMounted] = useState(false);
  const [menuOrder, setMenuOrder] = useState([]);
  const [settingsOrder, setSettingsOrder] = useState([]);

  useEffect(() => {
    setIsMounted(true);
    if (typeof window === 'undefined') return;
    const uid = effectiveOwnerId || auth?.currentUser?.uid || 'default';
    try {
      const savedMenu = localStorage.getItem(`sidebar_menu_order_${uid}`);
      if (savedMenu) setMenuOrder(JSON.parse(savedMenu));
      const savedSettings = localStorage.getItem(`sidebar_settings_order_${uid}`);
      if (savedSettings) setSettingsOrder(JSON.parse(savedSettings));
    } catch (e) { }
  }, [effectiveOwnerId]);

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const { source, destination } = result;

    // Only allow sorting within the same list
    if (source.droppableId !== destination.droppableId) return;

    if (source.droppableId === 'menu') {
      setMenuOrder(prev => {
        const sortedIds = getSortedItems(visibleMenuItems, prev).map(i => i.featureId);
        const [reorderedItem] = sortedIds.splice(source.index, 1);
        sortedIds.splice(destination.index, 0, reorderedItem);
        try {
          const uid = effectiveOwnerId || auth?.currentUser?.uid || 'default';
          localStorage.setItem(`sidebar_menu_order_${uid}`, JSON.stringify(sortedIds));
        } catch(e) {}
        return sortedIds;
      });
    } else if (source.droppableId === 'settings') {
      setSettingsOrder(prev => {
        const sortedIds = getSortedItems(visibleSettingsItems, prev).map(i => i.featureId);
        const [reorderedItem] = sortedIds.splice(source.index, 1);
        sortedIds.splice(destination.index, 0, reorderedItem);
        try {
          const uid = effectiveOwnerId || auth?.currentUser?.uid || 'default';
          localStorage.setItem(`sidebar_settings_order_${uid}`, JSON.stringify(sortedIds));
        } catch(e) {}
        return sortedIds;
      });
    }
  };

  const getSortedItems = (items, order) => {
    if (!order || order.length === 0) return items;
    return [...items].sort((a, b) => {
      const indexA = order.indexOf(a.featureId);
      const indexB = order.indexOf(b.featureId);
      if (indexA === -1 && indexB === -1) return 0;
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });
  };

  // 1. Get all allowed features by role/permissions
  const allowedMenuItems = isRolePending ? [] : allMenuItems.filter(item => canAccessPage(effectiveRole, item.featureId, customAllowedPages, businessType));
  const allowedSettingsItems = isRolePending ? [] : allSettingsItems.filter(item => canAccessPage(effectiveRole, item.featureId, customAllowedPages, businessType));

  // 2. Sort the allowed items based on user preferences
  const sortedAllowedMenuItems = getSortedItems(allowedMenuItems, menuOrder);
  const sortedAllowedSettingsItems = getSortedItems(allowedSettingsItems, settingsOrder);

  // 3. Separate unlocked and locked items
  const unlockedMenuItems = sortedAllowedMenuItems.filter(item => !getIsDisabled(item.featureId));
  const lockedMenuItems = sortedAllowedMenuItems.filter(item => getIsDisabled(item.featureId));

  const unlockedSettingsItems = sortedAllowedSettingsItems.filter(item => !getIsDisabled(item.featureId));
  const lockedSettingsItems = sortedAllowedSettingsItems.filter(item => getIsDisabled(item.featureId));

  // 4. Pin locked items strictly to the bottom
  const sortedMenuItems = [...unlockedMenuItems, ...lockedMenuItems];
  const sortedSettingsItems = [...unlockedSettingsItems, ...lockedSettingsItems];

  // Using a separate constant to feed drag contexts so locked items are ignored during sort maps explicitly if needed
  // But since we just sort the *unlocked* in DnD, we only map the full array when rendering
  const visibleMenuItems = unlockedMenuItems;
  const visibleSettingsItems = unlockedSettingsItems;


  // Fetch WhatsApp Unread Count
  const [whatsappUnreadCount, setWhatsappUnreadCount] = useState(0);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const [waitlistEntriesCount, setWaitlistEntriesCount] = useState(0);
  const [dineInPendingOrdersCount, setDineInPendingOrdersCount] = useState(0);
  const [dineInServiceRequestsCount, setDineInServiceRequestsCount] = useState(0);
  const hasBootstrappedPendingNotifRef = useRef(false);
  const prevPendingCountRef = useRef(0);
  const hasBootstrappedWaNotifRef = useRef(false);
  const prevWaUnreadCountRef = useRef(0);
  const isOnWhatsAppDirectPage = pathname?.includes('/owner-dashboard/whatsapp-direct');
  const isOnLiveOrdersPage =
    pathname === '/owner-dashboard/live-orders' ||
    pathname === '/street-vendor-dashboard';

  // Realtime Listener for WhatsApp Unread Count
  useEffect(() => {
    // Only fetch if user is owner or has access (and not impersonating for now to keep it simple/secure in client)
    if (!auth.currentUser) return;
    if (impersonatedOwnerId || employeeOfOwnerId) return; // Skip for now until we handle composite query permissions perfectly
    if (isOnWhatsAppDirectPage) return; // Page has its own realtime pipeline; avoid duplicate reads
    if (!badgeMonitoringReady) return;

    let unsubscribe = () => { };

    const setupListener = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const business = await resolveOwnedBusiness(user.uid, businessType);
        if (!business?.id) return;

        // 2. Listen to Conversations with unreadCount > 0
        const q = query(
          collection(db, business.collectionName, business.id, 'conversations'),
          where('unreadCount', '>', 0)
        );

        unsubscribe = onSnapshot(q, (snapshot) => {
          // Notification/badge should only consider active direct-chat support threads.
          const totalUnread = snapshot.docs.reduce((acc, doc) => {
            const data = doc.data() || {};
            if (data.state !== 'direct_chat') return acc;
            return acc + (data.unreadCount || 0);
          }, 0);
          setWhatsappUnreadCount(totalUnread);
        }, (error) => {
          console.error("Error listening to whatsapp conversations:", error);
        });

      } catch (error) {
        console.error("Error setting up whatsapp listener:", error);
      }
    };

    setupListener();

    return () => unsubscribe();
  }, [badgeMonitoringReady, businessType, impersonatedOwnerId, employeeOfOwnerId, isOnWhatsAppDirectPage]);

  // Fetch Pending Orders Count (Real-time and Fallback)
  useEffect(() => {
    if (!auth.currentUser) return;
    if (isOnLiveOrdersPage) return; // Live Orders page already has direct realtime; avoid duplicate listener
    if (!badgeMonitoringReady) return;

    let unsubscribe = () => { };
    let pollInterval = null;

    const handleCountUpdate = (count) => {
      setPendingOrdersCount(count);

      if (count > 0) {
        setAppNotificationAlarmState('owner', {
          alarmId: 'live_orders_pending',
          title: 'New Live Order',
          message: count === 1
            ? '1 new order is waiting in Live Orders.'
            : count + ' new orders are waiting in Live Orders.',
          sound: '/notification-owner-manager.mp3',
          href: businessType === 'street-vendor' ? '/street-vendor-dashboard' : '/owner-dashboard/live-orders',
          disableAutoStop: true,
        });
      } else {
        clearAppNotificationAlarmState('owner', 'live_orders_pending');
      }
      if (!hasBootstrappedPendingNotifRef.current) {
        hasBootstrappedPendingNotifRef.current = true;
        prevPendingCountRef.current = count;
        return;
      }

      if (count > prevPendingCountRef.current) {
        const delta = count - prevPendingCountRef.current;
        emitAppNotification({
          scope: 'owner',
          title: 'New Live Order',
          message: delta === 1
            ? '1 new order is waiting in Live Orders.'
            : `${delta} new orders are waiting in Live Orders.`,
          dedupeKey: `sidebar_pending_${count}_${Date.now()}`,
          alarmId: 'live_orders_pending',
          disableAutoStop: true,
          sound: '/notification-owner-manager.mp3',
          href: businessType === 'street-vendor' ? '/street-vendor-dashboard' : '/owner-dashboard/live-orders'
        });
      }
      if (count === 0 && prevPendingCountRef.current > 0) {
        emitAppNotification({
          scope: 'owner',
          action: 'stop_alarm',
          alarmId: 'live_orders_pending'
        });
      }
      prevPendingCountRef.current = count;
    };

    const setupListener = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        // Fallback to API polling for impersonate/employee due to Firestore security rules
        if (impersonatedOwnerId || employeeOfOwnerId) {
          const pollData = async () => {
            try {
              const idToken = await user.getIdToken();
              let url = new URL('/api/owner/orders', window.location.origin);
              if (impersonatedOwnerId) url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
              else if (employeeOfOwnerId) url.searchParams.append('employee_of', employeeOfOwnerId);

              const res = await fetch(url.toString(), { headers: { 'Authorization': `Bearer ${idToken}` } });
              if (res.ok) {
                const data = await res.json();
                const count = (data.orders || []).filter(o => o.status === 'pending').length;
                handleCountUpdate(count);
              }
            } catch (e) {
              console.error('Sidebar Polling error:', e);
            }
          };

          pollData();
          pollInterval = setInterval(pollData, 60000); // Poll every 60s
          return;
        }

        const business = await resolveOwnedBusiness(user.uid, businessType);
        if (!business?.id) return;

        // Listen for Pending Orders (Realtime via Firestore)
        const ordersQuery = query(
          collection(db, 'orders'),
          where('restaurantId', '==', business.id),
          where('status', '==', 'pending')
        );

        unsubscribe = onSnapshot(ordersQuery, (snapshot) => {
          handleCountUpdate(snapshot.size);
        }, (error) => {
          console.error("Error listening to pending orders:", error);
        });

      } catch (error) {
        console.error("Error setting up pending orders listener:", error);
      }
    };

    setupListener();

    return () => {
      unsubscribe();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [badgeMonitoringReady, businessType, impersonatedOwnerId, employeeOfOwnerId, isOnLiveOrdersPage]);

  // Dine-In badge counts (pending dine-in orders + pending service requests)
  useEffect(() => {
    if ((normalizeBusinessType(businessType) || 'restaurant') !== 'restaurant') {
      setDineInPendingOrdersCount(0);
      return;
    }
    if (impersonatedOwnerId || employeeOfOwnerId || !auth.currentUser) return;
    if (!badgeMonitoringReady) return;

    let unsubscribeOrders = () => { };

    const setupListeners = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const business = await resolveOwnedBusiness(user.uid, 'restaurant');
        if (!business?.id) return;

        const dineInOrdersQuery = query(
          collection(db, 'orders'),
          where('restaurantId', '==', business.id),
          where('deliveryType', '==', 'dine-in'),
          where('status', '==', 'pending')
        );

        unsubscribeOrders = onSnapshot(dineInOrdersQuery, (snapshot) => {
          setDineInPendingOrdersCount(snapshot.size);
        }, (error) => {
          console.error('Error listening to dine-in pending orders:', error);
        });
      } catch (error) {
        console.error('Error setting up dine-in badge listeners:', error);
      }
    };

    setupListeners();
    return () => {
      unsubscribeOrders();
    };
  }, [badgeMonitoringReady, businessType, impersonatedOwnerId, employeeOfOwnerId]);

  // Fetch Waitlist Count (Real-time)
  useEffect(() => {
    if ((normalizeBusinessType(businessType) || 'restaurant') !== 'restaurant') {
      setWaitlistEntriesCount(0);
      return;
    }
    if (impersonatedOwnerId || employeeOfOwnerId || !auth.currentUser) return;
    if (!badgeMonitoringReady) return;

    let unsubscribe = () => { };

    const setupListener = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const business = await resolveOwnedBusiness(user.uid, 'restaurant');
        if (!business?.id) return;

        const waitlistQuery = query(
          collection(db, 'restaurants', business.id, 'waitlist'),
          where('status', 'in', ['pending', 'notified'])
        );

        unsubscribe = onSnapshot(waitlistQuery, (snapshot) => {
          setWaitlistEntriesCount(snapshot.size);
        }, (error) => {
          console.error("Error listening to waitlist:", error);
        });

      } catch (error) {
        console.error("Error setting up waitlist listener:", error);
      }
    };

    setupListener();

    return () => unsubscribe();
  }, [badgeMonitoringReady, impersonatedOwnerId, employeeOfOwnerId, businessType]);

  // Service request count via API (more reliable with Firestore security rules)
  useEffect(() => {
    if ((normalizeBusinessType(businessType) || 'restaurant') !== 'restaurant') {
      setDineInServiceRequestsCount(0);
      return;
    }
    if (employeeOfOwnerId || !auth.currentUser) return;
    if (!badgeMonitoringReady) return;

    let intervalId = null;
    let isMounted = true;

    const fetchServiceRequestCount = async () => {
      try {
        const user = auth.currentUser;
        if (!user || !isMounted) return;
        const idToken = await user.getIdToken();
        const url = new URL('/api/owner/service-requests', window.location.origin);
        if (impersonatedOwnerId) {
          url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
        }

        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${idToken}` }
        });

        if (!res.ok) {
          if (isMounted) setDineInServiceRequestsCount(0);
          return;
        }

        const data = await res.json();
        if (isMounted) {
          setDineInServiceRequestsCount(Array.isArray(data?.requests) ? data.requests.length : 0);
        }
      } catch (error) {
        console.error('Error fetching dine-in service requests count:', error);
        if (isMounted) setDineInServiceRequestsCount(0);
      }
    };

    fetchServiceRequestCount();
    intervalId = setInterval(fetchServiceRequestCount, desktopRuntime ? 45000 : 15000);

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [badgeMonitoringReady, businessType, desktopRuntime, impersonatedOwnerId, employeeOfOwnerId]);

  useEffect(() => {
    if (impersonatedOwnerId || employeeOfOwnerId) return;
    const unread = whatsappUnreadCount || 0;
    if (!hasBootstrappedWaNotifRef.current) {
      hasBootstrappedWaNotifRef.current = true;
      prevWaUnreadCountRef.current = unread;
      return;
    }

    if (unread > prevWaUnreadCountRef.current && !isOnWhatsAppDirectPage) {
      const delta = unread - prevWaUnreadCountRef.current;
      emitAppNotification({
        scope: 'owner',
        title: 'New WhatsApp Message',
        message: delta === 1 ? '1 new customer message received.' : `${delta} new customer messages received.`,
        dedupeKey: `sidebar_wa_${unread}`,
        sound: '/notification-whatsapp-message.mp3',
        href: '/owner-dashboard/whatsapp-direct'
      });
    }

    prevWaUnreadCountRef.current = unread;
  }, [whatsappUnreadCount, impersonatedOwnerId, employeeOfOwnerId, pathname, isOnWhatsAppDirectPage]);


  return (
    <>
      <div className={`flex items-center shrink-0 border-b border-border justify-between ${isCollapsed ? 'h-[65px] justify-center' : 'h-[65px] px-6'}`}>
        <Link href="/" passHref>
          <div className="flex items-center gap-2 cursor-pointer">
            <Image src="/logo.png" alt="Logo" width={isCollapsed ? 32 : 40} height={isCollapsed ? 32 : 40} />
            {!isCollapsed && <h1 className="text-xl font-bold text-primary">ServiZephyr</h1>}
          </div>
        </Link>
        <button className="hidden md:flex p-2 rounded-full hover:bg-muted" onClick={() => setIsOpen(prev => !prev)}>
          <ChevronLeft className={`transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <nav className={styles.sidebarNav}>
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="menu">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className={styles.menuGroup}>
                <span className={`${styles.menuGroupTitle} ${isCollapsed ? styles.collapsedText : ''}`}>Menu</span>
                {isMounted && sortedMenuItems.map((item, index) => {
                  const disabled = getIsDisabled(item.featureId);
                  return (
                  <Draggable key={item.featureId} draggableId={`menu-${item.featureId}`} index={index} isDragDisabled={isCollapsed || disabled}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className="relative flex items-center group cursor-default"
                        style={{ ...provided.draggableProps.style }}
                      >
                        {!disabled && (
                          <div
                            {...provided.dragHandleProps}
                            className={`absolute left-0.5 z-10 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing text-muted-foreground ${isCollapsed ? 'hidden' : 'block'}`}
                          >
                            <GripVertical size={16} />
                          </div>
                        )}
                        <div className="flex-1 w-full" onClick={handleLinkClick}>
                          <SidebarLink
                            item={{
                              ...item,
                              badge: item.featureId === 'whatsapp-direct'
                                ? whatsappUnreadCount
                                : item.featureId === 'live-orders'
                                  ? pendingOrdersCount
                                  : item.featureId === 'dine-in'
                                    ? (dineInPendingOrdersCount + dineInServiceRequestsCount)
                                    : item.featureId === 'bookings'
                                      ? waitlistEntriesCount
                                      : 0
                            }}
                            isCollapsed={isCollapsed}
                            isDisabled={disabled}
                            disabledIcon={Lock}
                            disabledMessage={`${item.name} is not available for your account. Please contact support for more information.`}
                          />
                        </div>
                      </div>
                    )}
                  </Draggable>
                )})}
                {provided.placeholder}
              </div>
            )}
          </Droppable>

          <Droppable droppableId="settings">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className={styles.menuGroup}>
                <span className={`${styles.menuGroupTitle} ${isCollapsed ? styles.collapsedText : ''}`}>General</span>
                {isMounted && sortedSettingsItems.map((item, index) => {
                  const disabled = getIsDisabled(item.featureId);
                  return (
                  <Draggable key={item.featureId} draggableId={`settings-${item.featureId}`} index={index} isDragDisabled={isCollapsed || disabled}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className="relative flex items-center group cursor-default"
                        style={{ ...provided.draggableProps.style }}
                      >
                        {!disabled && (
                          <div
                            {...provided.dragHandleProps}
                            className={`absolute left-0.5 z-10 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing text-muted-foreground ${isCollapsed ? 'hidden' : 'block'}`}
                          >
                            <GripVertical size={16} />
                          </div>
                        )}
                        <div className="flex-1 w-full" onClick={handleLinkClick}>
                          <SidebarLink
                            item={item}
                            isCollapsed={isCollapsed}
                            isDisabled={disabled}
                            disabledIcon={Lock}
                            disabledMessage={`${item.name} is not available for your account. Please contact support for more information.`}
                          />
                        </div>
                      </div>
                    )}
                  </Draggable>
                )})}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </nav>
    </>
  );
}

