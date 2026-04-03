const SkeletonBlock = ({ className = '' }) => (
    <div className={`animate-pulse rounded-xl bg-muted/70 ${className}`.trim()} />
);

export default function AddAddressPageSkeleton({ statusText = 'Preparing address page...' }) {
    return (
        <div className="min-h-screen min-h-[100dvh] w-screen bg-background text-foreground customer-flow-surface">
            <div className="border-b border-border bg-background/80 p-4 backdrop-blur-sm">
                <div className="flex items-center gap-4">
                    <SkeletonBlock className="h-10 w-10 rounded-full" />
                    <SkeletonBlock className="h-6 w-48 rounded-md" />
                </div>
            </div>

            <div className="flex flex-col md:flex-row">
                <div className="relative h-[48dvh] min-h-[340px] md:h-[calc(100dvh-73px)] md:w-1/2">
                    <div className="absolute inset-0 bg-muted/35" />
                    <div className="absolute inset-6 rounded-[28px] border border-border/60 bg-background/50 backdrop-blur-sm" />
                    <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-background/90 px-4 py-2 text-sm text-muted-foreground shadow-lg">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                        <span>{statusText}</span>
                    </div>
                </div>

                <div className="space-y-4 p-4 md:w-1/2">
                    <SkeletonBlock className="h-12 w-full rounded-2xl" />

                    <div className="space-y-4 rounded-2xl border border-border p-4">
                        <div className="space-y-3">
                            <SkeletonBlock className="h-4 w-36 rounded-md" />
                            <SkeletonBlock className="h-24 w-full rounded-2xl" />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <SkeletonBlock className="h-12 w-full rounded-xl" />
                            <SkeletonBlock className="h-12 w-full rounded-xl" />
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <SkeletonBlock className="h-9 w-20 rounded-full" />
                            <SkeletonBlock className="h-9 w-20 rounded-full" />
                            <SkeletonBlock className="h-9 w-20 rounded-full" />
                        </div>
                    </div>

                    <SkeletonBlock className="h-12 w-full rounded-2xl" />
                </div>
            </div>
        </div>
    );
}
