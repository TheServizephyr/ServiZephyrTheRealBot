
'use client';

// This component is temporarily disabled due to build issues with the mapping library.
// We will explore a more stable map solution in the future.
// The code is kept here for reference.

import React from 'react';
import { Loader2 } from 'lucide-react';

const LiveTrackingMap = ({ restaurantLocation, customerLocation, riderLocation }) => {
    return (
        <div className="w-full h-full bg-muted flex flex-col items-center justify-center text-center p-4">
             <Loader2 className="h-8 w-8 text-primary animate-spin mb-4" />
            <p className="font-semibold text-foreground">Live Map Temporarily Unavailable</p>
            <p className="text-sm text-muted-foreground">We are working on resolving an issue with our mapping service.</p>
        </div>
    );
};

export default LiveTrackingMap;
