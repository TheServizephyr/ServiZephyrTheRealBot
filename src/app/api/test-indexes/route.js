// Test if indexes are working
import { getFirestore } from '@/lib/firebase-admin';
status: userTime < 100 ? '✅ FAST (Indexed)' : '⚠️ SLOW (No Index)',
    ready: userTime < 100
                },
couponStatusIndex: {
    queryTime: `${couponTime}ms`,
        status: couponTime < 100 ? '✅ FAST (Indexed)' : '⚠️ SLOW (No Index)',
            ready: couponTime < 100
},
menuAvailableIndex: {
    queryTime: `${menuTime}ms`,
        status: menuTime < 100 ? '✅ FAST (Indexed)' : '⚠️ SLOW (No Index)',
            ready: menuTime < 100
}
            },
totalTime: `${totalTime}ms`,
    allIndexesReady: userTime < 100 && couponTime < 100 && menuTime < 100
        });

    } catch (error) {
    return Response.json({
        success: false,
        error: error.message,
        note: 'If error mentions "requires an index", indexes are not ready yet'
    }, { status: 500 });
}
}
