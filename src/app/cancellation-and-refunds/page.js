'use client';

export default function CancellationRefundPolicyPage() {
  return (
    <div className="bg-background text-foreground">
      <div className="container mx-auto max-w-4xl px-4 py-12 sm:py-16">
        <h1 className="font-headline text-4xl sm:text-5xl font-bold tracking-tighter mb-8 text-center">Cancellation &amp; Refund Policy</h1>
        <div className="prose prose-lg dark:prose-invert mx-auto text-muted-foreground">
          <p>Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

          <h2>1. General Policy</h2>
          <p>At ServiZephyr, we strive to provide the best service possible. This policy outlines the terms under which cancellations and refunds will be processed for our subscription services.</p>

          <h2>2. Subscription Cancellation</h2>
          <p>You may cancel your subscription at any time. To cancel, please log in to your account dashboard and navigate to the subscription settings or contact our support team at <a href="mailto:ashwanibaghel@servizephyr.com">ashwanibaghel@servizephyr.com</a>.</p>
          <p>Your cancellation will take effect at the end of your current billing cycle. You will continue to have access to the service until the end of that period. We do not provide prorated refunds for cancellations made mid-cycle.</p>

          <h2>3. Refund Policy</h2>
          <p>We offer a 7-day money-back guarantee for new customers on their first subscription payment. If you are not satisfied with our service within the first 7 days of your subscription, you may request a full refund.</p>
          <p>To request a refund, please contact our support team with your account details and the reason for your request. Refunds will be processed to the original method of payment within 5-10 business days.</p>
          <p>After the initial 7-day period, subscription fees are non-refundable. We do not issue refunds for partial subscription periods, unused services, or account inactivity.</p>

          <h2>4. Changes to Policy</h2>
          <p>ServiZephyr reserves the right to modify this Cancellation & Refund Policy at any time. We will notify you of any significant changes by posting the new policy on this page and updating the "Last updated" date.</p>

          <h2>5. Contact Us</h2>
          <p>If you have any questions about this policy, please contact us at <a href="mailto:ashwanibaghel@servizephyr.com">ashwanibaghel@servizephyr.com</a>.</p>
        </div>
      </div>
    </div>
  );
}
