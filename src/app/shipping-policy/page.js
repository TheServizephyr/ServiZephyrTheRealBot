'use client';

export default function ShippingPolicyPage() {
  return (
    <div className="bg-background text-foreground">
      <div className="container mx-auto max-w-4xl px-4 py-12 sm:py-16">
        <h1 className="font-headline text-4xl sm:text-5xl font-bold tracking-tighter mb-8 text-center">Shipping &amp; Delivery Policy</h1>
        <div className="prose prose-lg dark:prose-invert mx-auto text-muted-foreground">
          <p>Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          
          <h2>1. Service Nature</h2>
          <p>ServiZephyr provides a Software-as-a-Service (SaaS) platform for restaurant management. As our product is a digital service, there is no physical shipping of goods involved. Access to our service is granted electronically upon successful subscription and account setup.</p>
          
          <h2>2. For Restaurant Customers</h2>
          <p>This policy also applies to the end-customers ordering from restaurants that use the ServiZephyr platform. ServiZephyr is a technology provider and is not responsible for the preparation, delivery, or quality of food and beverages ordered through our platform.</p>
          <p>Each restaurant is solely responsible for its own shipping, delivery, and returns policy. Please refer to the specific restaurant's policy from which you are ordering.</p>

          <h2>3. Delivery of Our Service</h2>
          <p>Upon completing your subscription purchase, you will receive an email confirmation with details on how to access your account and set up your restaurant profile. Access is typically granted immediately after payment confirmation.</p>
          <p>If you do not receive your access details within a few hours of subscribing, please check your spam folder and then contact our support team at <a href="mailto:ashwanibaghel@servizephyr.com">ashwanibaghel@servizephyr.com</a>.</p>

          <h2>4. Service Availability</h2>
          <p>We strive to ensure our platform is available 24/7. However, there may be occasional downtime for maintenance or due to unforeseen technical issues. We will do our best to notify you in advance of any scheduled maintenance.</p>

          <h2>5. Contact Us</h2>
          <p>If you have any questions regarding this policy or your access to our service, please do not hesitate to contact us at <a href="mailto:ashwanibaghel@servizephyr.com">ashwanibaghel@servizephyr.com</a>.</p>
        </div>
      </div>
    </div>
  );
}
