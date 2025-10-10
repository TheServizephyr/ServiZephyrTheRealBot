'use client';

export default function PrivacyPolicy() {
  return (
    <div className="bg-background text-foreground">
      <div className="container mx-auto max-w-4xl px-4 py-12 sm:py-16">
        <h1 className="font-headline text-4xl sm:text-5xl font-bold tracking-tighter mb-8 text-center">Privacy Policy</h1>
        <div className="prose prose-lg dark:prose-invert mx-auto text-muted-foreground">
          <p>Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          
          <p>ServiZephyr ("us", "we", or "our") operates the ServiZephyr website (the "Service"). This page informs you of our policies regarding the collection, use, and disclosure of personal data when you use our Service and the choices you have associated with that data.</p>
          
          <h2>1. Information Collection and Use</h2>
          <p>We collect several different types of information for various purposes to provide and improve our Service to you. This may include, but is not limited to, your name, email address, phone number, and restaurant information.</p>
          
          <h2>2. Use of Data</h2>
          <p>ServiZephyr uses the collected data for various purposes:</p>
          <ul>
            <li>To provide and maintain the Service</li>
            <li>To notify you about changes to our Service</li>
            <li>To allow you to participate in interactive features of our Service when you choose to do so</li>
            <li>To provide customer care and support</li>
            <li>To provide analysis or valuable information so that we can improve the Service</li>
            <li>To monitor the usage of the Service</li>
            <li>To detect, prevent and address technical issues</li>
          </ul>

          <h2>3. Data Ownership for Restaurants</h2>
          <p>A core feature of our service is that you, the restaurant owner, retain ownership of your customer data (e.g., phone numbers, order history). We act as a data processor on your behalf. We will not use your customers' data for our own marketing purposes or share it with third parties, except as required to provide the service or as required by law.</p>

          <h2>4. Security of Data</h2>
          <p>The security of your data is important to us, but remember that no method of transmission over the Internet, or method of electronic storage is 100% secure. While we strive to use commercially acceptable means to protect your Personal Data, we cannot guarantee its absolute security.</p>
          
          <h2>5. Changes to This Privacy Policy</h2>
          <p>We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page. You are advised to review this Privacy Policy periodically for any changes.</p>
          
          <h2>6. Contact Us</h2>
          <p>If you have any questions about this Privacy Policy, please contact us by email: <a href="mailto:ashwanibaghel@servizephyr.com">ashwanibaghel@servizephyr.com</a></p>
        </div>
      </div>
    </div>
  );
}
