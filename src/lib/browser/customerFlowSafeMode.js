'use client';

import { useEffect, useState } from 'react';

function getNavigatorUserAgent() {
    if (typeof navigator === 'undefined') return '';
    return String(navigator.userAgent || '');
}

export function isCustomerFlowPath(pathname = '') {
    return /^\/(order\/|checkout|add-address|cart|track\/)/i.test(String(pathname || ''));
}

export function isIosSafariLike(userAgent = getNavigatorUserAgent()) {
    const ua = String(userAgent || '');
    const isIos = /iPhone|iPad|iPod/i.test(ua);
    const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT|YaBrowser|DuckDuckGo/i.test(ua);
    return isIos && isSafari;
}

export function isLikelyInAppBrowser(userAgent = getNavigatorUserAgent()) {
    const ua = String(userAgent || '');
    return /WhatsApp|Instagram|FBAN|FBAV|Messenger|Line|Snapchat|wv\)|; wv|WebView|Telegram/i.test(ua);
}

export function shouldUseCustomerFlowSafeMode() {
    if (typeof window === 'undefined') return false;

    const pathname = window.location?.pathname || '';
    if (!isCustomerFlowPath(pathname)) return false;

    const ua = getNavigatorUserAgent();
    const hasCoarsePointer = typeof window.matchMedia === 'function'
        ? window.matchMedia('(pointer: coarse)').matches
        : false;

    return isLikelyInAppBrowser(ua) || isIosSafariLike(ua) || hasCoarsePointer;
}

export function useCustomerFlowSafeMode() {
    const [safeMode, setSafeMode] = useState(false);

    useEffect(() => {
        setSafeMode(shouldUseCustomerFlowSafeMode());
    }, []);

    return safeMode;
}
