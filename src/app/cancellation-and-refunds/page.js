'use client';

export default function CancellationRefundPolicyPage() {
  return (
    <div className="bg-background text-foreground">
      <div className="container mx-auto max-w-4xl px-4 py-12 sm:py-16">
        <h1 className="font-headline text-4xl sm:text-5xl font-bold tracking-tighter mb-8 text-center">Cancellation &amp; Refund Policy</h1>
        <div className="prose prose-lg dark:prose-invert mx-auto text-muted-foreground">
          <p>Last updated: October 11, 2025</p>

          <p>At ServiZephyr, our goal is to provide an exceptional experience for both our customers and our restaurant partners. To ensure clarity and fairness, our cancellation and refund policy is as follows:</p>

          <h2>1. Order Cancellation Policy</h2>
          
          <h4>1.1. Cancellation Window</h4>
          <p>You may cancel your order without any reason within **2 minutes** of placing it.</p>
          
          <h4>1.2. Cancellation After 2 Minutes</h4>
          <p>If more than 2 minutes have passed, an order can only be canceled if the restaurant partner has not yet accepted it and started preparing the food.</p>
          
          <h4>1.3. Cancellation After Acceptance</h4>
          <p>Once the restaurant partner has accepted your order, it cannot be canceled, and no refund will be issued for a cancellation request at this stage.</p>

          <h4>1.4. Cancellation by Restaurant</h4>
          <p>If the restaurant partner cancels your order for any reason (e.g., item unavailability), you will automatically receive a 100% refund.</p>

          <h2>2. Refund & Replacement Policy</h2>

          <h4>2.1. Issues with Order</h4>
          <p>If you receive a wrong item, have a missing item, or are unsatisfied with the food quality, please contact our customer support team with a photograph of the order within **60 minutes** of receiving it.</p>

          <h4>2.2. Complaint Resolution</h4>
          <p>We will immediately forward your complaint to the respective restaurant partner. After an investigation by the restaurant, a replacement or refund will be processed as deemed appropriate. ServiZephyr will fully assist you throughout this process.</p>

          <h4>2.3. Refund Timeline</h4>
          <p>Once a refund is approved, it may take **5-7 working days** to be processed and credited back to your original payment method.</p>
        </div>
      </div>
    </div>
  );
}
