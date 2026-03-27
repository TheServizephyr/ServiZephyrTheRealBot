'use client';

import { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export function isEditableShortcutTarget(target) {
    if (!target || !(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;

    const tagName = String(target.tagName || '').toUpperCase();
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;

    const role = String(target.getAttribute?.('role') || '').toLowerCase();
    return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}

function normalizeKey(value) {
    return String(value || '').trim().toLowerCase();
}

function matchesShortcut(event, shortcut) {
    const key = normalizeKey(event.key);
    const expectedKey = normalizeKey(shortcut.key);
    if (!expectedKey || key !== expectedKey) return false;

    return Boolean(shortcut.altKey) === Boolean(event.altKey)
        && Boolean(shortcut.ctrlKey) === Boolean(event.ctrlKey)
        && Boolean(shortcut.metaKey) === Boolean(event.metaKey)
        && Boolean(shortcut.shiftKey) === Boolean(event.shiftKey);
}

export function buildOwnerDashboardShortcutPath(basePath, {
    impersonatedOwnerId = '',
    employeeOfOwnerId = '',
} = {}) {
    const params = new URLSearchParams();
    if (impersonatedOwnerId) params.set('impersonate_owner_id', impersonatedOwnerId);
    else if (employeeOfOwnerId) params.set('employee_of', employeeOfOwnerId);

    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
}

export function navigateToShortcutPath(path) {
    if (!path || typeof window === 'undefined') return;
    window.location.assign(path);
}

export function useOwnerDashboardShortcuts({
    shortcuts = [],
    enabled = true,
    onOpenHelp,
}) {
    useEffect(() => {
        if (!enabled) return undefined;

        const handleKeyDown = (event) => {
            if (event.defaultPrevented) return;

            const isEditableTarget = isEditableShortcutTarget(event.target);
            const wantsHelp = !event.altKey && !event.ctrlKey && !event.metaKey && (event.key === '?' || (event.key === '/' && event.shiftKey));

            if (wantsHelp && !isEditableTarget) {
                event.preventDefault();
                onOpenHelp?.();
                return;
            }

            for (const shortcut of shortcuts) {
                if (!shortcut) continue;
                if (isEditableTarget && !shortcut.allowInEditable) continue;
                if (!matchesShortcut(event, shortcut)) continue;

                event.preventDefault();
                event.stopPropagation();
                shortcut.action?.(event);
                return;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [enabled, onOpenHelp, shortcuts]);
}

export function OwnerDashboardShortcutsDialog({
    open,
    onOpenChange,
    title = 'Keyboard Shortcuts',
    description = 'Use these shortcuts to move faster around the dashboard.',
    sections = [],
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {sections.map((section) => (
                        <div key={section.title || 'section'} className="rounded-xl border border-border bg-muted/20 p-4">
                            {section.title && (
                                <h3 className="mb-3 text-sm font-semibold text-foreground">{section.title}</h3>
                            )}
                            <div className="space-y-2">
                                {(section.shortcuts || []).map((shortcut) => (
                                    <div
                                        key={`${section.title}-${shortcut.combo}-${shortcut.description}`}
                                        className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/70 px-3 py-2"
                                    >
                                        <span className="text-sm text-muted-foreground">{shortcut.description}</span>
                                        <kbd className="rounded-md border border-border bg-muted px-2 py-1 text-xs font-semibold text-foreground">
                                            {shortcut.combo}
                                        </kbd>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}
