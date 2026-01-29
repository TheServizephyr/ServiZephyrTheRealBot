import { optimizeDeliveryRoute, formatRouteForGoogleMaps } from '@/lib/routeOptimizer';
import { getFirestore, verifyAndGetUid } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/**
 * POST /api/rider/optimize-route
 * Optimize delivery route for multiple orders assigned to a rider
 */
export async function POST(request) {
    try {
        // Verify rider authentication
        const riderId = await verifyAndGetUid(request);
        const db = await getFirestore();
        const body = await request.json();
        const { orderIds, restaurantId } = body;

        console.log('[Route Optimizer] Request received:', { riderId, orderCount: orderIds?.length, restaurantId });

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            console.error('[Route Optimizer] Invalid orderIds:', orderIds);
            return Response.json({ error: 'Order IDs required' }, { status: 400 });
        }

        if (!restaurantId) {
            console.error('[Route Optimizer] Missing restaurantId');
            return Response.json({ error: 'Restaurant ID required' }, { status: 400 });
        }

        if (orderIds.length > 9) {
            console.warn(`[Route Optimizer] ${orderIds.length} orders - using greedy approximation`);
        }

        // Fetch restaurant location
        const restaurantDoc = await db.collection('restaurants').doc(restaurantId).get();
        if (!restaurantDoc.exists) {
            console.error('[Route Optimizer] Restaurant not found:', restaurantId);
            return Response.json({ error: 'Restaurant not found' }, { status: 404 });
        }

        const restaurantData = restaurantDoc.data();
        const restaurantLocation = {
            lat: restaurantData.location?._latitude || restaurantData.location?.latitude,
            lng: restaurantData.location?._longitude || restaurantData.location?.longitude
        };

        console.log('[Route Optimizer] Restaurant location:', restaurantLocation);

        if (!restaurantLocation.lat || !restaurantLocation.lng) {
            console.error('[Route Optimizer] Invalid restaurant location:', restaurantData.location);
            return Response.json({ error: 'Invalid restaurant location' }, { status: 400 });
        }

        // Fetch all orders
        const ordersPromises = orderIds.map(orderId =>
            db.collection('orders').doc(orderId).get()
        );
        const orderDocs = await Promise.all(ordersPromises);

        const orders = orderDocs
            .filter(doc => doc.exists)
            .map(doc => ({
                orderId: doc.id,
                ...doc.data()
            }));

        console.log('[Route Optimizer] Orders fetched:', orders.length);

        if (orders.length === 0) {
            console.error('[Route Optimizer] No valid orders found for IDs:', orderIds);
            return Response.json({ error: 'No valid orders found' }, { status: 404 });
        }

        // Optimize route
        const optimizationResult = optimizeDeliveryRoute(restaurantLocation, orders);

        // Generate Google Maps URL with optimized waypoints
        const googleMapsUrl = formatRouteForGoogleMaps(optimizationResult.optimizedRoute);

        // Log optimization for analytics
        console.log(`[Route Optimizer] SUCCESS for Rider ${riderId}:`, {
            deliveries: orders.length,
            totalDistance: optimizationResult.totalDistance.toFixed(2) + ' km',
            distanceSaved: optimizationResult.metrics.distanceSaved?.toFixed(2) + ' km',
            computationTime: optimizationResult.computationTime + 'ms'
        });

        return Response.json({
            success: true,
            optimizedRoute: optimizationResult.optimizedRoute.map((order, index) => ({
                sequence: index + 1,
                orderId: order.orderId,
                customerName: order.customerName,
                customerAddress: order.customerAddress,
                customerLocation: order.customerLocation,
                totalAmount: order.totalAmount,
                paymentMethod: order.paymentMethod,
                deliveryPriority: order.deliveryPriority
            })),
            metrics: {
                totalDistance: optimizationResult.totalDistance,
                distanceSaved: optimizationResult.metrics.distanceSaved,
                deliveryCount: orders.length,
                computationTime: optimizationResult.computationTime,
                fuelSavings: calculateFuelSavings(optimizationResult.metrics.distanceSaved)
            },
            googleMapsUrl,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[Route Optimizer] FATAL ERROR:', error);
        console.error('[Route Optimizer] Error stack:', error.stack);

        // Handle specific auth errors
        if (error.status === 401 || error.code === 'auth/id-token-expired') {
            return Response.json(
                { error: 'Authentication failed', message: error.message || 'Please login again' },
                { status: 401 }
            );
        }

        return Response.json(
            { error: 'Failed to optimize route', message: error.message, details: error.toString() },
            { status: 500 }
        );
    }
}

/**
 * Calculate estimated fuel savings based on distance saved
 * Assumptions: Average bike mileage = 40 km/L, Petrol price = ₹100/L
 */
function calculateFuelSavings(distanceSavedKm) {
    if (!distanceSavedKm || distanceSavedKm <= 0) return 0;

    const MILEAGE_KM_PER_LITER = 40;
    const PETROL_PRICE_PER_LITER = 100;

    const fuelSavedLiters = distanceSavedKm / MILEAGE_KM_PER_LITER;
    const moneySaved = fuelSavedLiters * PETROL_PRICE_PER_LITER;

    return {
        distanceKm: parseFloat(distanceSavedKm.toFixed(2)),
        fuelLiters: parseFloat(fuelSavedLiters.toFixed(3)),
        moneyRupees: parseFloat(moneySaved.toFixed(2))
    };
}
