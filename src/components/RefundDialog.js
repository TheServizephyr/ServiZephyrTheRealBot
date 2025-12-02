'use client';

import { useState } from 'react';
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, Loader2, IndianRupee } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

const REFUND_REASONS = [
    'Quality issue',
    'Wrong item delivered',
    'Item missing',
    'Customer complaint',
    'Order cancelled',
    'Other'
];

export default function RefundDialog({ order, open, onOpenChange, onRefundSuccess }) {
    const { user } = useUser();
    const [refundType, setRefundType] = useState('full');
    const [selectedItems, setSelectedItems] = useState([]);
    const [reason, setReason] = useState('');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const orderItems = order?.items || [];
    const totalAmount = order?.totalAmount || order?.grandTotal || 0;

    // Calculate online payment amount (sum of ALL online payments for split payment support)
    const getOnlinePaymentAmount = () => {
        const paymentDetailsArray = Array.isArray(order?.paymentDetails)
            ? order.paymentDetails
            : [order?.paymentDetails].filter(Boolean);

        // Sum ALL Razorpay/online payments (handles split payments where multiple users paid)
        const totalOnlineAmount = paymentDetailsArray
            .filter(p =>
                (p.method === 'razorpay' || p.method === 'phonepe' || p.method === 'online')
                && p.razorpay_payment_id
            )
            .reduce((sum, payment) => sum + (payment.amount || 0), 0);

        return totalOnlineAmount;
    };

    const onlinePaymentAmount = getOnlinePaymentAmount();

    // Calculate refund amount
    const calculateRefundAmount = () => {
        if (refundType === 'full') {
            // Refund only the online payment amount, not total order amount
            return onlinePaymentAmount;
        }

        // Partial refund calculation
        let itemsTotal = 0;
        selectedItems.forEach(itemId => {
            const item = orderItems.find(i => i.id === itemId || i.name === itemId);
            if (item) {
                // Calculate price - use portion.price if totalPrice not available
                let price = item.totalPrice || item.price;

                if (!price && item.portion) {
                    price = item.portion.price || 0;

                    // Add addon prices
                    if (item.selectedAddOns && Array.isArray(item.selectedAddOns)) {
                        item.selectedAddOns.forEach(addon => {
                            const addonPrice = addon.price || 0;
                            const addonQty = addon.quantity || 1;
                            price += addonPrice * addonQty;
                        });
                    }
                }

                price = price || 0;

                const qty = item.quantity || item.qty || 1;
                itemsTotal += price * qty;
            }
        });

        // Add proportional tax
        const subtotal = order?.subtotal || totalAmount;
        const taxAmount = totalAmount - subtotal;
        const taxRatio = subtotal > 0 ? taxAmount / subtotal : 0;
        const totalWithTax = itemsTotal + (itemsTotal * taxRatio);

        // Cap partial refund to online payment amount
        return Math.min(totalWithTax, onlinePaymentAmount);
    };

    const refundAmount = calculateRefundAmount();

    const handleItemToggle = (itemId) => {
        setSelectedItems(prev =>
            prev.includes(itemId)
                ? prev.filter(id => id !== itemId)
                : [...prev, itemId]
        );
    };

    const handleRefund = async () => {
        // Validation
        if (!reason) {
            setError('Please select a refund reason');
            return;
        }

        if (refundType === 'partial' && selectedItems.length === 0) {
            setError('Please select at least one item for partial refund');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // Get Firebase ID token
            if (!user) {
                setError('User not authenticated');
                setLoading(false);
                return;
            }

            const idToken = await user.getIdToken();

            const response = await fetch('/api/owner/refund', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    orderId: order.id,
                    refundType,
                    items: refundType === 'partial' ? selectedItems : [],
                    reason,
                    notes
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Refund failed');
            }

            // Success
            onRefundSuccess && onRefundSuccess(data);
            onOpenChange(false);

            // Reset form
            setRefundType('full');
            setSelectedItems([]);
            setReason('');
            setNotes('');
        } catch (err) {
            console.error('Refund error:', err);
            setError(err.message || 'Failed to process refund');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Process Refund</DialogTitle>
                    <DialogDescription>
                        Refund for Order #{order?.id?.slice(-8)}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Error Alert */}
                    {error && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {/* Payment Breakdown Info (for mixed payments) */}
                    {onlinePaymentAmount < totalAmount && onlinePaymentAmount > 0 && (
                        <Alert>
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                                <div className="space-y-1">
                                    <p className="font-semibold">Mixed Payment Order</p>
                                    <p className="text-sm">Order Total: ₹{totalAmount.toFixed(2)}</p>
                                    <p className="text-sm text-green-600">• Online Payment: ₹{onlinePaymentAmount.toFixed(2)}</p>
                                    <p className="text-sm text-yellow-600">• Cash at Counter: ₹{(totalAmount - onlinePaymentAmount).toFixed(2)}</p>
                                    <p className="text-xs mt-2 text-muted-foreground">
                                        Only the online payment amount can be refunded.
                                    </p>
                                </div>
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* Refund Type */}
                    <div className="space-y-3">
                        <Label>Refund Type</Label>
                        <RadioGroup value={refundType} onValueChange={setRefundType}>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="full" id="full" />
                                <Label htmlFor="full" className="font-normal cursor-pointer">
                                    Full Refund - ₹{onlinePaymentAmount.toFixed(2)}
                                    {onlinePaymentAmount < totalAmount && (
                                        <span className="text-xs text-muted-foreground ml-2">
                                            (Online payment only)
                                        </span>
                                    )}
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="partial" id="partial" />
                                <Label htmlFor="partial" className="font-normal cursor-pointer">
                                    Partial Refund - Select items
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>

                    {/* Item Selection (for partial refund) */}
                    {refundType === 'partial' && (
                        <div className="space-y-3">
                            <Label>Select Items to Refund</Label>
                            <div className="border rounded-lg p-4 space-y-2 max-h-48 overflow-y-auto">
                                {orderItems.map((item, index) => {
                                    const itemId = item.id || item.name;

                                    // Calculate price - use portion.price if totalPrice not available
                                    let itemPrice = item.totalPrice || item.price;

                                    if (!itemPrice && item.portion) {
                                        itemPrice = item.portion.price || 0;

                                        // Add addon prices
                                        if (item.selectedAddOns && Array.isArray(item.selectedAddOns)) {
                                            item.selectedAddOns.forEach(addon => {
                                                const addonPrice = addon.price || 0;
                                                const addonQty = addon.quantity || 1;
                                                itemPrice += addonPrice * addonQty;
                                            });
                                        }
                                    }

                                    itemPrice = itemPrice || 0;

                                    const itemQty = item.quantity || item.qty || 1;
                                    const itemTotal = itemPrice * itemQty;

                                    // Debug logging
                                    console.log('[RefundDialog] Item calculation:', {
                                        name: item.name,
                                        itemPrice,
                                        itemQty,
                                        itemTotal,
                                        rawItem: item
                                    });

                                    return (
                                        <div key={index} className="flex items-center space-x-2">
                                            <Checkbox
                                                id={`item-${index}`}
                                                checked={selectedItems.includes(itemId)}
                                                onCheckedChange={() => handleItemToggle(itemId)}
                                            />
                                            <Label
                                                htmlFor={`item-${index}`}
                                                className="flex-1 font-normal cursor-pointer"
                                            >
                                                <div className="flex justify-between">
                                                    <span>{item.name} x {itemQty}</span>
                                                    <span className="text-muted-foreground">
                                                        ₹{itemTotal.toFixed(2)}
                                                    </span>
                                                </div>
                                            </Label>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Refund Amount Display */}
                    <div className="bg-muted p-4 rounded-lg">
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-medium">Refund Amount:</span>
                            <span className="text-2xl font-bold flex items-center">
                                <IndianRupee className="h-5 w-5" />
                                {refundAmount.toFixed(2)}
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                            Amount will be credited to customer's account in 5-7 working days
                        </p>
                    </div>

                    {/* Refund Reason */}
                    <div className="space-y-3">
                        <Label htmlFor="reason">Reason for Refund *</Label>
                        <Select value={reason} onValueChange={setReason}>
                            <SelectTrigger id="reason">
                                <SelectValue placeholder="Select a reason" />
                            </SelectTrigger>
                            <SelectContent>
                                {REFUND_REASONS.map((r) => (
                                    <SelectItem key={r} value={r}>
                                        {r}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Additional Notes */}
                    <div className="space-y-3">
                        <Label htmlFor="notes">Additional Notes (Optional)</Label>
                        <Textarea
                            id="notes"
                            placeholder="Add any additional details about the refund..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={3}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={loading}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleRefund}
                        disabled={loading || refundAmount <= 0}
                    >
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Process Refund
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
