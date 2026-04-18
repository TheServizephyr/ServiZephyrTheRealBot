
'use client';

import { useState, useEffect, Suspense, useMemo, useCallback, useRef } from "react";
import Sidebar from "@/components/OwnerDashboard/Sidebar";
import Navbar from "@/components/OwnerDashboard/Navbar";
import styles from "@/components/OwnerDashboard/OwnerDashboard.module.css";
import { motion } from "framer-motion";
import { ThemeProvider } from "@/components/ThemeProvider";
import ThemeColorUpdater from "@/components/ThemeColorUpdater";
import GlobalHapticHandler from "@/components/GlobalHapticHandler";
import "../globals.css";
import { AlertTriangle, HardHat, ShieldOff, Salad, Lock, Mail, Phone, MessageSquare, Loader2, PhoneCall, ArrowRight, X } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/firebase";
import { auth, db, rtdb } from "@/lib/firebase";
import { onValue, ref } from "firebase/database";
import { doc, getDoc } from "firebase/firestore";
import GoldenCoinSpinner from "@/components/GoldenCoinSpinner";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import EmployeeBanner from "@/components/EmployeeBanner";
import {
  buildOwnerDashboardShortcutPath,
  navigateToShortcutPath,
  OwnerDashboardShortcutsDialog,
  useOwnerDashboardShortcuts,
} from "@/lib/ownerDashboardShortcuts";
import {
  buildActiveCallSyncUserPath,
  buildCallSyncEventKey,
  dismissCallSyncEventForSession,
  isCallSyncEventFresh,
  isCallSyncLiveSuggestionState,
  isDismissedCallSyncEvent,
  normalizeIndianPhoneLoose,
} from "@/lib/call-sync";
import DesktopSyncProcessor from "@/components/DesktopSyncProcessor";
import AppNotificationCenter from "@/components/AppNotificationCenter";
import { getBestEffortIdToken } from "@/lib/client-session";
import { isDesktopApp } from "@/lib/desktop/runtime";
import {
  getOwnerDashboardLayoutMode,
  onOwnerDashboardLayoutModeChange,
  resolveOwnerDashboardMobileState,
} from '@/lib/screenOrientation';

export const dynamic = 'force-dynamic';

const buildLoginRedirect = (path) => `/login?redirect=${encodeURIComponent(path || '/owner-dashboard/live-orders')}`;

const resolveOwnerFeatureIdFromPath = (pathname) => {
  const segments = String(pathname || '').split('/').filter(Boolean);
  if (segments[0] !== 'owner-dashboard') return segments[segments.length - 1] || '';
  if (segments.length === 1) return 'dashboard';

  const section = segments[1];
  if (section === 'settings' && segments[2] === 'connections') return 'connections';
  if (section === 'settings' && segments[2] === 'location') return 'location';
  return section || 'dashboard';
};

const normalizeBusinessType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'shop' || normalized === 'store') return 'store';
  if (normalized === 'street_vendor') return 'street-vendor';
  if (normalized === 'street-vendor' || normalized === 'restaurant') return normalized;
  return 'restaurant';
};

const isDesktopOfflineMode = (desktopRuntime) => (
  Boolean(
    desktopRuntime &&
    typeof navigator !== 'undefined' &&
    navigator.onLine === false
  )
);

const isOfflineEligibleMessage = (value) => {
  const message = String(value || '').toLowerCase();
  return (
    message.includes('backend error') ||
    message.includes('token verification failed') ||
    message.includes('enotfound') ||
    message.includes('ehostunreach') ||
    message.includes('unavailable') ||
    message.includes('no connection established') ||
    message.includes('identitytoolkit') ||
    message.includes('network')
  );
};

function FeatureLockScreen({ remark, featureId }) {
  const supportPhone = "919027872803";
  const supportEmail = "contact@servizephyr.com";

  const resolvedRemark = remark || 'This feature is not available for your account. Please contact support for more information.';
  const whatsappText = encodeURIComponent(`Hello ServiZephyr Team,\n\nMy access to the '${featureId}' feature has been restricted. The remark says: "${resolvedRemark}".\n\nPlease help me resolve this.`);
  const emailSubject = encodeURIComponent(`Issue: Access Restricted for '${featureId}' Feature`);
  const emailBody = encodeURIComponent(`Hello ServiZephyr Team,\n\nI am writing to you because my access to the '${featureId}' feature on my dashboard has been restricted.\n\nThe remark provided is: "${resolvedRemark}"\n\nCould you please provide more details or guide me on the steps to resolve this?\n\nThank you.`);


  return (
    <div className="flex flex-col items-center justify-center text-center h-full p-8 bg-card border border-border rounded-xl">
      <Lock className="h-16 w-16 text-yellow-400" />
      <h2 className="mt-6 text-2xl font-bold">Feature Restricted</h2>
      <p className="mt-2 max-w-md text-muted-foreground">Access to this feature has been temporarily restricted by the platform administrator.</p>
      {resolvedRemark && (
        <div className="mt-4 p-4 bg-muted/50 rounded-lg w-full max-w-md">
          <p className="font-semibold">Message:</p>
          <p className="text-muted-foreground italic">&quot;{resolvedRemark}&quot;</p>
        </div>
      )}
      <div className="mt-6 pt-6 border-t border-border w-full max-w-md">
        <p className="text-sm font-semibold mb-4">Need help? Contact support.</p>
        <div className="flex justify-center gap-4">
          <a href={`https://wa.me/${supportPhone}?text=${whatsappText}`} target="_blank" rel="noopener noreferrer">
            <Button variant="outline"><MessageSquare className="mr-2 h-4 w-4" /> WhatsApp</Button>
          </a>
          <a href={`mailto:${supportEmail}?subject=${emailSubject}&body=${emailBody}`}>
            <Button variant="outline"><Mail className="mr-2 h-4 w-4" /> Email</Button>
          </a>
          <a href={`tel:${supportPhone}`}>
            <Button variant="outline"><Phone className="mr-2 h-4 w-4" /> Call Us</Button>
          </a>
        </div>
      </div>
    </div>
  );
}


function OwnerDashboardContent({ children }) {
  const desktopRuntime = useMemo(() => isDesktopApp(), []);
  const [isMobile, setIsMobile] = useState(true); // FIX: Default to true
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [restaurantStatus, setRestaurantStatus] = useState({
    status: null,
    restrictedFeatures: [],
    lockedFeatures: [],
    suspensionRemark: ''
  });
  const [restaurantName, setRestaurantName] = useState('My Dashboard');
  const [restaurantLogo, setRestaurantLogo] = useState(null);
  const [navbarOwnerSettings, setNavbarOwnerSettings] = useState(null);
  const [userRole, setUserRole] = useState(null); // For employee role-based access
  const [callSyncTarget, setCallSyncTarget] = useState({ businessId: '', collectionName: '' });
  const [incomingCallBanner, setIncomingCallBanner] = useState(null);
  const [businessType, setBusinessType] = useState(() => {
    if (typeof window === 'undefined') return 'restaurant';
    return normalizeBusinessType(localStorage.getItem('businessType')) || 'restaurant';
  });
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const impersonatedOwnerId = searchParams.get('impersonate_owner_id');
  const employeeOfOwnerId = searchParams.get('employee_of'); // Employee accessing owner's data
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);

  // Use either impersonation or employee context for fetching owner's data
  const effectiveOwnerId = impersonatedOwnerId || employeeOfOwnerId;

  const { user, isUserLoading } = useUser();
  const [isRecoveringSession, setIsRecoveringSession] = useState(false);
  const [hasAttemptedSessionRecovery, setHasAttemptedSessionRecovery] = useState(false);
  const pendingHistoryNavigationRef = useRef(null);
  const pendingHistoryTimerRef = useRef(null);
  const ownerBootstrapRef = useRef({ key: '', inFlight: false });
  const impersonationLogRef = useRef('');
  const ownerCacheKey = useMemo(() => {
    const scope = impersonatedOwnerId ? `imp_${impersonatedOwnerId}` : (employeeOfOwnerId ? `emp_${employeeOfOwnerId}` : 'owner_self');
    return `owner_dashboard_shell_cache_v1_${scope}`;
  }, [employeeOfOwnerId, impersonatedOwnerId]);
  const ownerBootstrapKey = useMemo(() => (
    `${user?.uid || 'anon'}::${impersonatedOwnerId || employeeOfOwnerId || 'owner_self'}`
  ), [employeeOfOwnerId, impersonatedOwnerId, user?.uid]);

  const readOwnerCache = useCallback(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(ownerCacheKey);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }, [ownerCacheKey]);

  const writeOwnerCache = useCallback((payload = {}) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(ownerCacheKey, JSON.stringify({
        ts: Date.now(),
        ...payload,
      }));
    } catch {
      // Ignore cache write failures
    }
  }, [ownerCacheKey]);

  useEffect(() => {
    if (!desktopRuntime) return;
    const cached = readOwnerCache();
    if (!cached) return;

    if (cached.restaurantName) setRestaurantName(cached.restaurantName);
    if (cached.restaurantLogo) setRestaurantLogo(cached.restaurantLogo);
    if (cached.navbarOwnerSettings) setNavbarOwnerSettings(cached.navbarOwnerSettings);
    if (cached.businessType) {
      const normalizedBusinessType = normalizeBusinessType(cached.businessType);
      localStorage.setItem('businessType', normalizedBusinessType);
      setBusinessType(normalizedBusinessType);
    }
    if (cached.restaurantStatus) {
      setRestaurantStatus(cached.restaurantStatus);
    }
  }, [desktopRuntime, readOwnerCache]);

  const hasOwnerSessionHint = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const role = String(localStorage.getItem('role') || '').trim().toLowerCase();
    const justLoggedIn = sessionStorage.getItem('justLoggedIn');
    return ['owner', 'restaurant-owner', 'shop-owner'].includes(role) || !!justLoggedIn;
  }, []);

  const navigateWithShortcut = useCallback((basePath) => {
    const path = buildOwnerDashboardShortcutPath(basePath, {
      impersonatedOwnerId,
      employeeOfOwnerId,
    });
    navigateToShortcutPath(path);
  }, [employeeOfOwnerId, impersonatedOwnerId]);

  const buildScopedOwnerUrl = useCallback((endpoint) => {
    const url = new URL(endpoint, typeof window !== 'undefined' ? window.location.origin : 'https://servizephyr.com');
    if (impersonatedOwnerId) {
      url.searchParams.append('impersonate_owner_id', impersonatedOwnerId);
    } else if (employeeOfOwnerId) {
      url.searchParams.append('employee_of', employeeOfOwnerId);
    }
    return url.toString();
  }, [employeeOfOwnerId, impersonatedOwnerId]);

  const historyCapableShortcuts = useMemo(() => ({
    m: {
      label: 'Manual billing',
      pagePath: '/owner-dashboard/manual-order',
      historyPath: '/owner-dashboard/manual-order-history',
    },
    o: {
      label: 'Live orders',
      pagePath: '/owner-dashboard/live-orders',
      historyPath: '/owner-dashboard/order-history',
    },
    d: {
      label: 'Dine in',
      pagePath: '/owner-dashboard/dine-in',
      historyPath: '/owner-dashboard/dine-in-history',
    },
    c: {
      label: 'Custom bill',
      pagePath: '/owner-dashboard/custom-bill',
      historyPath: '/owner-dashboard/custom-bill-history',
    },
  }), []);

  const currentHistoryShortcut = useMemo(() => (
    Object.values(historyCapableShortcuts).find((shortcut) => shortcut.pagePath === pathname) || null
  ), [historyCapableShortcuts, pathname]);

  const clearPendingHistoryNavigation = useCallback(() => {
    if (pendingHistoryTimerRef.current) {
      clearTimeout(pendingHistoryTimerRef.current);
      pendingHistoryTimerRef.current = null;
    }
    pendingHistoryNavigationRef.current = null;
  }, []);

  const queueHistoryAwareNavigation = useCallback((shortcutConfig) => {
    clearPendingHistoryNavigation();
    pendingHistoryNavigationRef.current = shortcutConfig;
    pendingHistoryTimerRef.current = setTimeout(() => {
      const pendingShortcut = pendingHistoryNavigationRef.current;
      clearPendingHistoryNavigation();
      if (pendingShortcut?.pagePath) {
        navigateWithShortcut(pendingShortcut.pagePath);
      }
    }, 1200);
  }, [clearPendingHistoryNavigation, navigateWithShortcut]);

  const ownerDashboardShortcuts = useMemo(() => ([
    { key: 'a', altKey: true, action: () => navigateWithShortcut('/owner-dashboard/analytics') },
    { key: 'w', altKey: true, action: () => navigateWithShortcut('/owner-dashboard/whatsapp-direct') },
    { key: 't', altKey: true, action: () => navigateWithShortcut('/owner-dashboard/manual-order') },
  ]), [navigateWithShortcut]);

  useEffect(() => {
    const handleHistoryShortcut = (event) => {
      if (event.defaultPrevented) return;

      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) return;
        const tagName = String(target.tagName || '').toUpperCase();
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return;
        const role = String(target.getAttribute?.('role') || '').toLowerCase();
        if (role === 'textbox' || role === 'combobox' || role === 'searchbox') return;
      }

      const key = String(event.key || '').trim().toLowerCase();
      const isAltOnly = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

      if (!event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'h' && pendingHistoryNavigationRef.current?.historyPath) {
        event.preventDefault();
        event.stopPropagation();
        const pendingShortcut = pendingHistoryNavigationRef.current;
        clearPendingHistoryNavigation();
        navigateWithShortcut(pendingShortcut.historyPath);
        return;
      }

      if (isAltOnly && key === 'h' && currentHistoryShortcut?.historyPath) {
        event.preventDefault();
        event.stopPropagation();
        clearPendingHistoryNavigation();
        navigateWithShortcut(currentHistoryShortcut.historyPath);
        return;
      }

      if (isAltOnly && historyCapableShortcuts[key]) {
        event.preventDefault();
        event.stopPropagation();
        queueHistoryAwareNavigation(historyCapableShortcuts[key]);
      }
    };

    window.addEventListener('keydown', handleHistoryShortcut, true);
    return () => {
      window.removeEventListener('keydown', handleHistoryShortcut, true);
      clearPendingHistoryNavigation();
    };
  }, [clearPendingHistoryNavigation, currentHistoryShortcut, historyCapableShortcuts, navigateWithShortcut, queueHistoryAwareNavigation]);

  const shortcutSections = useMemo(() => {
    const sections = [
      {
        title: 'Dashboard Navigation',
        shortcuts: [
          { combo: 'Alt + M', description: 'Open manual billing' },
          { combo: 'Alt + O', description: 'Open live orders' },
          { combo: 'Alt + A', description: 'Open analytics' },
          { combo: 'Alt + D', description: 'Open dine in' },
          { combo: 'Alt + C', description: 'Open custom bill' },
          { combo: 'Alt + W', description: 'Open WhatsApp direct' },
          { combo: 'Alt + T', description: 'Open manual billing (Dine-in)' },
          { combo: 'Alt + H', description: currentHistoryShortcut ? `Open ${currentHistoryShortcut.label.toLowerCase()} history` : 'Open current page history when available' },
          { combo: 'Alt + M then H', description: 'Open manual billing history' },
          { combo: 'Alt + O then H', description: 'Open live order history' },
          { combo: 'Alt + D then H', description: 'Open dine in history' },
          { combo: 'Alt + C then H', description: 'Open custom bill history' },
          { combo: '?', description: 'Show keyboard shortcuts' },
        ],
      },
    ];

    if (pathname === '/owner-dashboard/manual-order') {
      sections.push({
        title: 'Manual Billing',
        shortcuts: [
          { combo: 'Alt + 1', description: 'Switch to delivery' },
          { combo: 'Alt + 2', description: 'Switch to dine in' },
          { combo: 'Alt + 3', description: 'Switch to pickup' },
          { combo: '/', description: 'Focus search' },
          { combo: 'Alt + Z', description: 'Undo last item' },
          { combo: 'Alt + X', description: 'Clear current bill' },
          { combo: 'Alt + P', description: 'Open print bill' },
        ],
      });
    }

    return sections;
  }, [pathname]);

  useOwnerDashboardShortcuts({
    shortcuts: ownerDashboardShortcuts,
    onOpenHelp: () => setIsShortcutHelpOpen(true),
  });

  // CRITICAL: Role detection - prevent owner from being blocked
  useEffect(() => {
    async function fetchEmployeeRole() {
      if (employeeOfOwnerId && user) {
        if (user.uid === employeeOfOwnerId) {
          console.log('[Layout] Owner detected, full access');
          setUserRole(null);
          return;
        }

        // Fetch employee role from Firestore linkedOutlets
        console.log('[Layout] Employee detected, checking Firestore...');
        try {
          await getBestEffortIdToken(user);

          const userDocRef = doc(db, 'users', user.uid);
          const userSnap = await getDoc(userDocRef);

          if (userSnap.exists()) {
            const userData = userSnap.data();
            const linkedOutlets = userData.linkedOutlets || [];

            const outlet = linkedOutlets.find(
              o => o.ownerId === employeeOfOwnerId && o.status === 'active'
            );

            if (outlet) {
              console.log('[Layout] Employee role found:', outlet.employeeRole);
              setUserRole(outlet.employeeRole);

              // For custom roles, store the allowed pages in localStorage
              if (outlet.employeeRole === 'custom' && outlet.customAllowedPages) {
                localStorage.setItem('customAllowedPages', JSON.stringify(outlet.customAllowedPages));
                console.log('[Layout] Custom role pages stored:', outlet.customAllowedPages);
              } else {
                // Clear custom pages if not a custom role
                localStorage.removeItem('customAllowedPages');
              }
            } else {
              console.error('[Layout] No matching outlet');
              setUserRole(null);
              localStorage.removeItem('customAllowedPages');
            }
          } else {
            console.error('[Layout] User doc not found');
            setUserRole(null);
            localStorage.removeItem('customAllowedPages');
          }
        } catch (err) {
          console.error('[Layout] Firestore error:', err);
          setUserRole(null);
          localStorage.removeItem('customAllowedPages');
        }
      } else {
        setUserRole(null);
        // Owner accessing own dashboard - clear any custom pages
        localStorage.removeItem('customAllowedPages');
      }
    }

    fetchEmployeeRole();
  }, [employeeOfOwnerId, user]);

  useEffect(() => {
    const checkScreenSize = () => {
      const mobile = resolveOwnerDashboardMobileState({
        width: window.innerWidth,
        mode: getOwnerDashboardLayoutMode(),
      });
      setIsMobile(mobile);
      if (mobile) {
        setSidebarOpen(false);
      } else {
        // Only collapse initially if the current path is manual-order
        if (typeof window !== 'undefined' && window.location.pathname === '/owner-dashboard/manual-order') {
          setSidebarOpen(false);
        } else {
          setSidebarOpen(true);
        }
      }
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    const unsubscribe = onOwnerDashboardLayoutModeChange(checkScreenSize);
    return () => {
      window.removeEventListener('resize', checkScreenSize);
      unsubscribe();
    };
  }, []);

  // Auto-collapse sidebar based on pathname navigation
  useEffect(() => {
    if (!isMobile) {
      if (pathname === '/owner-dashboard/manual-order' || pathname.startsWith('/owner-dashboard/manual-order?')) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    }
  }, [pathname, isMobile]);

  // Track if we've given auth time to settle
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    // Wait for loading to complete
    if (isUserLoading) {
      return;
    }

    const settleDelayMs = hasOwnerSessionHint ? 1600 : 500;

    // Give persisted sessions a little more time to restore on resume/background wakeup.
    const timer = setTimeout(() => {
      setAuthChecked(true);
    }, settleDelayMs);

    return () => clearTimeout(timer);
  }, [isUserLoading, hasOwnerSessionHint]);

  useEffect(() => {
    if (user) {
      setHasAttemptedSessionRecovery(false);
      setIsRecoveringSession(false);
    }
  }, [user]);

  useEffect(() => {
    const businessId = String(callSyncTarget?.businessId || '').trim();
    const collectionName = String(callSyncTarget?.collectionName || '').trim();
    const listenerUid = String(user?.uid || '').trim();

    if (!listenerUid || !businessId || !collectionName || pathname?.startsWith('/owner-dashboard/manual-order')) {
      setIncomingCallBanner(null);
      return undefined;
    }

    const callRef = ref(rtdb, buildActiveCallSyncUserPath(listenerUid));
    const unsubscribe = onValue(
      callRef,
      (snapshot) => {
        const activeCall = snapshot.exists() ? snapshot.val() : null;
        if (!activeCall) {
          setIncomingCallBanner(null);
          return;
        }

        if (
          String(activeCall?.businessId || '').trim() !== businessId ||
          String(activeCall?.collectionName || '').trim() !== collectionName
        ) {
          setIncomingCallBanner(null);
          return;
        }

        const phone = normalizeIndianPhoneLoose(activeCall.phone);
        const state = String(activeCall.state || '').trim().toLowerCase();
        const timestampMs = Number(activeCall.timestampMs || activeCall.updatedAt || 0);
        const callKey = buildCallSyncEventKey(phone, timestampMs);
        const isIncoming = isCallSyncLiveSuggestionState(state);

        if (!isIncoming || phone.length !== 10 || !isCallSyncEventFresh(timestampMs) || !callKey || isDismissedCallSyncEvent(callKey)) {
          setIncomingCallBanner(null);
          return;
        }

        setIncomingCallBanner((prev) => {
          if (prev?.callKey === callKey) return prev;
          return { phone, timestampMs, callKey };
        });
      },
      (error) => {
        console.error('[OwnerDashboardLayout] Call sync realtime listener failed:', error);
        setIncomingCallBanner(null);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [callSyncTarget?.businessId, callSyncTarget?.collectionName, pathname, user?.uid]);

  useEffect(() => {
    console.log('[Layout] 🔄 useEffect triggered', { authChecked, hasUser: !!user, isUserLoading });

    // Only redirect after auth has been properly checked
    if (!authChecked) {
      console.log('[Layout] ⏸️ Auth not checked yet, waiting...');
      return;
    }

    if (!isUserLoading && !user) {
      // If Firebase has already restored a user internally, wait for provider sync.
      if (auth.currentUser) {
        console.log('[Layout] ⏳ Auth provider sync pending, waiting...');
        return;
      }

      const nextPath = pathname || '/owner-dashboard/live-orders';

      // Try one recovery cycle before redirecting to landing page.
      if (hasOwnerSessionHint && !hasAttemptedSessionRecovery && !isRecoveringSession) {
        let cancelled = false;
        (async () => {
          try {
            setIsRecoveringSession(true);
            setHasAttemptedSessionRecovery(true);

            if (typeof auth.authStateReady === 'function') {
              await Promise.race([
                auth.authStateReady(),
                new Promise((resolve) => setTimeout(resolve, 3500))
              ]);
            } else {
              await new Promise((resolve) => setTimeout(resolve, 1200));
            }

            const startedAt = Date.now();
            while (!auth.currentUser && Date.now() - startedAt < 2500) {
              await new Promise((resolve) => setTimeout(resolve, 250));
            }

            if (cancelled) return;

            if (!auth.currentUser) {
              console.log('[Layout] ❌ Session recovery failed, redirecting to landing page.');
              router.replace(buildLoginRedirect(nextPath));
            } else {
              console.log('[Layout] ✅ Session recovered from persisted auth state.');
            }
          } catch (recoveryError) {
            console.error('[Layout] Session recovery error:', recoveryError);
            if (!cancelled) {
              router.replace(buildLoginRedirect(nextPath));
            }
          } finally {
            if (!cancelled) setIsRecoveringSession(false);
          }
        })();

        return () => {
          cancelled = true;
        };
      }

      // No recovery hint / recovery already attempted -> redirect.
      router.replace(buildLoginRedirect(nextPath));
      return;
    }

    // Log impersonation when detected
    if (user && impersonatedOwnerId && impersonationLogRef.current !== ownerBootstrapKey) {
      impersonationLogRef.current = ownerBootstrapKey;
      getBestEffortIdToken(user).then(idToken => {
        fetch('/api/admin/log-impersonation', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            targetUserId: impersonatedOwnerId,
            targetUserEmail: user.email,
            targetUserRole: 'Owner',
            action: 'start_impersonation_owner'
          })
        }).catch(err => console.error('Failed to log impersonation:', err));
      });
    }

    const fetchRestaurantData = async () => {
      console.log('[Layout] 🚀 fetchRestaurantData started');
      try {
        const cached = readOwnerCache();
        if (isDesktopOfflineMode(desktopRuntime) && cached) {
          setRestaurantName(cached.restaurantName || 'My Dashboard');
          setRestaurantLogo(cached.restaurantLogo || null);
          if (cached.businessType) {
            const normalizedBusinessType = normalizeBusinessType(cached.businessType);
            localStorage.setItem('businessType', normalizedBusinessType);
            setBusinessType(normalizedBusinessType);
          }
          if (cached.restaurantStatus) {
            setRestaurantStatus(cached.restaurantStatus);
          }
          return;
        }

        const idToken = await getBestEffortIdToken(user);
        console.log('[Layout] ✅ Got ID token');

        let statusUrl = '/api/owner/status';
        let settingsUrl = '/api/owner/settings';

        // Use correct param based on context
        if (impersonatedOwnerId) {
          statusUrl += `?impersonate_owner_id=${impersonatedOwnerId}`;
          settingsUrl += `?impersonate_owner_id=${impersonatedOwnerId}`;
          console.log('[Layout] 🔄 Using impersonation for owner:', impersonatedOwnerId);
        } else if (employeeOfOwnerId) {
          statusUrl += `?employee_of=${employeeOfOwnerId}`;
          settingsUrl += `?employee_of=${employeeOfOwnerId}`;
          console.log('[Layout] 👤 Using employee access for owner:', employeeOfOwnerId);
        } else {
          console.log('[Layout] 👑 Owner accessing own dashboard');
        }

        console.log('[Layout] 📡 Fetching from:', { statusUrl, settingsUrl });

        const [statusRes, settingsRes] = await Promise.all([
          fetch(statusUrl, { headers: { 'Authorization': `Bearer ${idToken}` } }),
          fetch(settingsUrl, { headers: { 'Authorization': `Bearer ${idToken}` } })
        ]);

        console.log('[Layout] 📊 API Response Status:', {
          status: statusRes.status,
          settings: settingsRes.status
        });

        if (settingsRes.ok) {
          const settingsData = await settingsRes.json();
          console.log('[Layout] ✅ Settings loaded:', {
            restaurantName: settingsData.restaurantName,
            hasLogo: !!settingsData.logoUrl
          });
          if (settingsData.businessType) {
            const normalizedBusinessType = normalizeBusinessType(settingsData.businessType);
            localStorage.setItem('businessType', normalizedBusinessType);
            setBusinessType(normalizedBusinessType);
          }
          setRestaurantName(settingsData.restaurantName || 'My Dashboard');
          setRestaurantLogo(settingsData.logoUrl || null);
          setNavbarOwnerSettings({
            isOpen: settingsData.isOpen !== false,
            autoScheduleEnabled: settingsData.autoScheduleEnabled === true,
            openingTime: settingsData.openingTime || '09:00',
            closingTime: settingsData.closingTime || '22:00',
          });
          if (settingsData.businessId && settingsData.collectionName) {
            setCallSyncTarget({
              businessId: String(settingsData.businessId),
              collectionName: String(settingsData.collectionName),
            });
          }
          writeOwnerCache({
            restaurantName: settingsData.restaurantName || 'My Dashboard',
            restaurantLogo: settingsData.logoUrl || null,
            navbarOwnerSettings: {
              isOpen: settingsData.isOpen !== false,
              autoScheduleEnabled: settingsData.autoScheduleEnabled === true,
              openingTime: settingsData.openingTime || '09:00',
              closingTime: settingsData.closingTime || '22:00',
            },
            businessType: settingsData.businessType || businessType,
            restaurantStatus,
          });
        } else {
          const settingsError = await settingsRes.json().catch(() => ({}));
          console.warn('[Layout] ⚠️ Settings API failed:', settingsRes.status, settingsError?.message);
          const cached = readOwnerCache();
          if (desktopRuntime && cached && isOfflineEligibleMessage(settingsError?.message || '')) {
            setRestaurantName(cached.restaurantName || 'My Dashboard');
            setRestaurantLogo(cached.restaurantLogo || null);
            if (cached.businessType) {
              const normalizedBusinessType = normalizeBusinessType(cached.businessType);
              localStorage.setItem('businessType', normalizedBusinessType);
              setBusinessType(normalizedBusinessType);
            }
          }
        }

        if (statusRes.ok) {
          const statusData = await statusRes.json();
          console.log('[Layout] ✅ Status loaded:', {
            status: statusData.status,
            restrictedFeatures: statusData.restrictedFeatures?.length || 0,
            lockedFeatures: statusData.lockedFeatures?.length || 0,
          });
          setRestaurantStatus({
            status: statusData.status,
            restrictedFeatures: statusData.restrictedFeatures || [],
            lockedFeatures: statusData.lockedFeatures || [],
            suspensionRemark: statusData.suspensionRemark || '',
          });
          writeOwnerCache({
            restaurantName,
            restaurantLogo,
            businessType,
            restaurantStatus: {
              status: statusData.status,
              restrictedFeatures: statusData.restrictedFeatures || [],
              lockedFeatures: statusData.lockedFeatures || [],
              suspensionRemark: statusData.suspensionRemark || '',
            },
          });
        } else if (statusRes.status === 404) {
          console.log('[Layout] ⚠️ Status 404 - Setting to pending');
          setRestaurantStatus({ status: 'pending', restrictedFeatures: [], lockedFeatures: [], suspensionRemark: '' });
        } else if (statusRes.status === 403) {
          // Unauthorized access - redirect to select-role for employees or homepage
          console.error("[Layout] ❌ User not authorized (403), redirecting to select-role...");
          router.push('/select-role');
          return;
        } else {
          const errorData = await statusRes.json();
          console.error("[Layout] ❌ Error fetching status:", errorData.message);
          const cached = readOwnerCache();
          if (desktopRuntime && cached?.restaurantStatus && isOfflineEligibleMessage(errorData?.message || '')) {
            setRestaurantStatus(cached.restaurantStatus);
          } else {
            setRestaurantStatus({ status: 'error', restrictedFeatures: [], lockedFeatures: [], suspensionRemark: '' });
          }
        }

      } catch (e) {
        console.error("[DEBUG] OwnerLayout: CRITICAL error fetching owner data:", e);
        const cached = readOwnerCache();
        const canUseCachedDesktopState =
          desktopRuntime &&
          cached?.restaurantStatus &&
          (
            typeof navigator !== 'undefined' ? navigator.onLine === false : false
          ||
            String(e?.message || '').toLowerCase().includes('network')
          ||
            String(e?.message || '').toLowerCase().includes('enotfound')
          ||
            String(e?.message || '').toLowerCase().includes('auth')
          );

        if (canUseCachedDesktopState) {
          setRestaurantName(cached.restaurantName || 'My Dashboard');
          setRestaurantLogo(cached.restaurantLogo || null);
          if (cached.businessType) {
            const normalizedBusinessType = normalizeBusinessType(cached.businessType);
            localStorage.setItem('businessType', normalizedBusinessType);
            setBusinessType(normalizedBusinessType);
          }
          setRestaurantStatus(cached.restaurantStatus);
          return;
        }

        setRestaurantStatus({ status: 'error', restrictedFeatures: [], lockedFeatures: [], suspensionRemark: '' });
      }
    }

    // Fetch user role (check if user is an employee)
    const fetchUserRole = async () => {
      if (impersonatedOwnerId) {
        setUserRole(null);
        return;
      }

      // If accessing via employee_of, use role from localStorage (set by select-role page)
      if (employeeOfOwnerId) {
        const storedRole = localStorage.getItem('employeeRole');
        if (storedRole) {
          setUserRole(storedRole);
          return;
        }
      }

      try {
        const idToken = await getBestEffortIdToken(user);
        const response = await fetch('/api/employee/me', {
          headers: { 'Authorization': `Bearer ${idToken}` }
        });
        if (response.ok) {
          const data = await response.json();
          if (data.role && data.role !== 'owner') {
            setUserRole(data.role);
          }
        }
      } catch (err) {
        // User is not an employee, use default (owner) access
        console.log('User role check:', err.message);
      }
    };

    if (user) {
      if (ownerBootstrapRef.current.inFlight && ownerBootstrapRef.current.key === ownerBootstrapKey) {
        return;
      }

      if (ownerBootstrapRef.current.key === ownerBootstrapKey) {
        return;
      }

      ownerBootstrapRef.current = { key: ownerBootstrapKey, inFlight: true };
      console.log('[Layout] ✅ Calling fetch functions...');
      Promise.allSettled([
        fetchRestaurantData(),
        fetchUserRole(),
      ]).finally(() => {
        ownerBootstrapRef.current = { key: ownerBootstrapKey, inFlight: false };
      });
    }

  }, [
    user,
    isUserLoading,
    authChecked,
    hasOwnerSessionHint,
    hasAttemptedSessionRecovery,
    isRecoveringSession,
    ownerBootstrapKey,
    router,
    employeeOfOwnerId,
    impersonatedOwnerId
  ]);

  if ((isUserLoading || !authChecked || isRecoveringSession) && !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <GoldenCoinSpinner />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <GoldenCoinSpinner />
      </div>
    );
  }

  const renderStatusScreen = () => {
    const featureId = resolveOwnerFeatureIdFromPath(pathname);

    if (restaurantStatus.status === 'approved') {
      if (restaurantStatus.lockedFeatures.includes(featureId)) {
        return <FeatureLockScreen remark="This feature is not available for your account. Please contact support for more information." featureId={featureId} />;
      }
      return null;
    }

    if (restaurantStatus.status === 'suspended') {
      if (restaurantStatus.restrictedFeatures.includes(featureId)) {
        return <FeatureLockScreen remark={restaurantStatus.suspensionRemark} featureId={featureId} />;
      }
      return null;
    }

    if (restaurantStatus.status === 'error') {
      if (desktopRuntime) {
        return null;
      }
      return (
        <main className={styles.mainContent} style={{ padding: '1rem' }}>
          <div className="flex flex-col items-center justify-center text-center h-full p-8 bg-card border border-border rounded-xl">
            <AlertTriangle className="h-16 w-16 text-red-500" />
            <h2 className="mt-6 text-2xl font-bold">Could Not Verify Status</h2>
            <p className="mt-2 max-w-md text-muted-foreground">We couldn&apos;t verify your outlet&apos;s status. This could be a temporary issue. Please refresh or contact support.</p>
            <div className="mt-6 flex gap-4">
              <Button onClick={() => window.location.reload()} variant="default">Refresh</Button>
              <Button variant="default" onClick={() => router.push('/contact')}>Contact Support</Button>
            </div>
          </div>
        </main>
      );
    }

    const normalizedBusinessType = normalizeBusinessType(businessType);
    const alwaysEnabled = [
      'menu',
      'settings',
      'connections',
      'payout-settings',
      'whatsapp-direct',
      'location',
    ];

    if (normalizedBusinessType === 'restaurant') {
      alwaysEnabled.push('dine-in', 'bookings');
    }
    const isDisabled = !alwaysEnabled.includes(featureId);

    if ((restaurantStatus.status === 'pending' || restaurantStatus.status === 'rejected') && isDisabled) {
      return (
        <main className={styles.mainContent} style={{ padding: '1rem' }}>
          <div className="flex flex-col items-center justify-center text-center h-full p-8 bg-card border border-border rounded-xl">
            <HardHat className="h-16 w-16 text-yellow-400" />
            <h2 className="mt-6 text-2xl font-bold">Account {restaurantStatus.status.charAt(0).toUpperCase() + restaurantStatus.status.slice(1)}</h2>
            <p className="mt-2 max-w-md text-muted-foreground">
              Your account is currently {restaurantStatus.status}. Full access will be granted upon approval. You can still set up your menu and settings.
            </p>
            <div className="mt-6 flex gap-4">
              <Button onClick={() => router.push('/owner-dashboard/menu')}>
                <Salad className="mr-2 h-4 w-4" /> Go to Menu
              </Button>
              <Button variant="outline" onClick={() => router.push('/contact')}>Contact Support</Button>
            </div>
          </div>
        </main>
      )
    }

    return null;
  }

  const blockedContent = renderStatusScreen();
  const isCollapsed = !isSidebarOpen && !isMobile;
  const showGlobalIncomingCallBanner =
    !!incomingCallBanner?.phone &&
    !pathname?.startsWith('/owner-dashboard/manual-order');

  return (
    <>
      <DesktopSyncProcessor />
      <ImpersonationBanner vendorName={restaurantName} />
      {showGlobalIncomingCallBanner && (
        <motion.div
          initial={{ x: 280, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 280, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="fixed right-4 top-4 z-[120] w-[min(420px,calc(100vw-2rem))]"
        >
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 shadow-2xl backdrop-blur-md">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-emerald-500/15 p-2 text-emerald-500">
                <PhoneCall className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">Incoming call</p>
                <p className="text-lg font-bold tracking-wide text-foreground">{incomingCallBanner.phone}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  dismissCallSyncEventForSession(incomingCallBanner.callKey);
                  setIncomingCallBanner(null);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-background/60 hover:text-foreground"
                title="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-full bg-foreground px-4 text-background hover:bg-foreground/90"
                onClick={() => navigateWithShortcut('/owner-dashboard/manual-order')}
              >
                Jump to Manual Billing
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </motion.div>
      )}
      <div className="flex h-screen bg-background text-foreground">
        <motion.aside
          key={isMobile ? "mobile" : "desktop"}
          className="fixed md:relative h-full z-50 bg-card border-r border-border flex flex-col"
          animate={isMobile ? (isSidebarOpen ? { x: 0 } : { x: '-100%' }) : { width: isCollapsed ? '80px' : '260px' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          initial={false}
        >
          <Sidebar
            isOpen={isSidebarOpen}
            setIsOpen={setSidebarOpen}
            isMobile={isMobile}
            isCollapsed={isCollapsed}
            restrictedFeatures={restaurantStatus.restrictedFeatures}
            lockedFeatures={restaurantStatus.lockedFeatures}
            status={restaurantStatus.status}
            userRole={userRole}
          />
        </motion.aside>

        {isMobile && isSidebarOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-40"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {pathname?.startsWith('/owner-dashboard/manual-order') && (
          <div className="pointer-events-none fixed right-4 top-4 z-[115] opacity-0">
            <AppNotificationCenter scope="owner" />
          </div>
        )}


        <div className="flex-1 flex flex-col overflow-hidden">
          {!pathname?.startsWith('/owner-dashboard/manual-order') && (
            <header className="flex items-center justify-between h-[65px] px-4 md:px-6 bg-card border-b border-border shrink-0">
              <Navbar
                isSidebarOpen={isSidebarOpen}
                setSidebarOpen={setSidebarOpen}
                restaurantName={restaurantName}
                restaurantLogo={restaurantLogo}
                userRole={userRole}
                initialOwnerSettings={navbarOwnerSettings}
                impersonatedOwnerId={impersonatedOwnerId}
                employeeOfOwnerId={employeeOfOwnerId}
              />
            </header>
          )}
          <main className={`flex-1 overflow-y-auto ${pathname?.startsWith('/owner-dashboard/manual-order') ? 'p-0' : 'p-4 md:p-6'}`}>
            {blockedContent || children}
          </main>
        </div>
        <OwnerDashboardShortcutsDialog
          open={isShortcutHelpOpen}
          onOpenChange={setIsShortcutHelpOpen}
          sections={shortcutSections}
        />
      </div>
    </>
  );
}


export default function OwnerDashboardRootLayout({ children }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <ThemeColorUpdater />
      <GlobalHapticHandler />
      <Suspense fallback={<div className="flex h-screen items-center justify-center bg-background"><GoldenCoinSpinner /></div>}>
        <OwnerDashboardContent>{children}</OwnerDashboardContent>
      </Suspense>
    </ThemeProvider>
  );
}
