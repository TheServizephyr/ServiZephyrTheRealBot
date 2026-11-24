export function createWaitlistMutations() {
    const confirmed = new Map();
    let version = 0;

    return {
        get version() { return version; },
        confirm(entryId, entry = null) {
            confirmed.set(entryId, {
                entry, version: ++version, removed: entry === null, seenInRealtime: false,
            });
        },
        reconcile(rows, { readVersion = -1, fromServer = false } = {}) {
            if (confirmed.size === 0) return rows;
            const sourceVersion = fromServer ? ++version : readVersion;
            const entries = new Map(rows.map(entry => [entry.id, entry]));
            for (const [id, change] of confirmed) {
                if (change.removed) {
                    // Seating is terminal. Keep its ID for this dashboard session.
                    entries.delete(id);
                    continue;
                }

                if (fromServer && entries.has(id)) change.seenInRealtime = true;
                const authoritative = fromServer ? change.seenInRealtime : readVersion >= change.version;
                if (authoritative) {
                    // Retain the latest confirmed view for any older response still in flight.
                    change.version = sourceVersion;
                    change.entry = entries.get(id) || null;
                } else if (change.entry) {
                    entries.set(id, change.entry);
                } else {
                    entries.delete(id);
                }
            }
            return [...entries.values()];
        },
    };
}

export function watchNewManualWaitlistEntry(subscribe, onRemoval, onError) {
    return subscribe((snapshot) => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        const status = snapshot.data()?.status;
        if (!snapshot.exists() || status === 'seated' || status === 'cancelled') onRemoval();
    }, onError);
}
