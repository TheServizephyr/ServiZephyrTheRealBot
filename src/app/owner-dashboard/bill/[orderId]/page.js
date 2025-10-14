@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%; /* #FFFFFF */
    --foreground: 240 10% 3.9%; /* #09090B */
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 240 10% 3.9%;
    --primary: 48 96% 53%; /* #FDBA12 */
    --primary-foreground: 240 6% 10%; /* #1A1A1A */
    --secondary: 240 5% 96%; /* #F5F5F7 */
    --secondary-foreground: 240 6% 10%;
    --muted: 240 5% 96%;
    --muted-foreground: 240 4% 46%; /* #707078 */
    --accent: 240 5% 90%; /* #E5E5E7 */
    --accent-foreground: 240 6% 10%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 6% 90%; /* #E5E5E7 */
    --input: 240 6% 90%;
    --ring: 48 96% 53%;
    --radius: 0.5rem;
    --chart-1: 12 76% 61%;
    --chart-2: 173 58% 39%;
    --chart-3: 197 37% 24%;
    --chart-4: 43 74% 66%;
    --chart-5: 27 87% 67%;
    --sidebar-background: 0 0% 0%; /* Black background */
    --sidebar-foreground: 0 0% 98%; /* White text */
    --sidebar-primary: 240 5.9% 10%;
    --sidebar-primary-foreground: 0 0% 98%;
    --sidebar-accent: 240 3.7% 15.9%;
    --sidebar-accent-foreground: 0 0% 98%;
    --sidebar-border: 240 3.7% 15.9%;
    --sidebar-ring: 217.2 91.2% 59.8%;
  }

  .dark {
    --background: 240 6% 10%; /* #1A1A1A */
    --foreground: 0 0% 98%; /* #FAFAFA */
    --card: 240 6% 10%;
    --card-foreground: 0 0% 98%;
    --popover: 240 6% 10%;
    --popover-foreground: 0 0% 98%;
    --primary: 48 96% 53%; /* #FDBA12 */
    --primary-foreground: 240 6% 10%;
    --secondary: 240 4% 16%; /* #29292B */
    --secondary-foreground: 0 0% 98%;
    --muted: 240 4% 16%;
    --muted-foreground: 240 5% 65%; /* #A1A1A8 */
    --accent: 240 4% 12%; /* #1F1F21 */
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 4% 16%;
    --input: 240 4% 16%;
    --ring: 48 96% 53%;
    --chart-1: 220 70% 50%;
    --chart-2: 160 60% 45%;
    --chart-3: 30 80% 55%;
    --chart-4: 280 65% 60%;
    --chart-5: 340 75% 55%;
    --sidebar-background: 240 5.9% 10%;
    --sidebar-foreground: 240 4.8% 95.9%;
    --sidebar-primary: 224.3 76.3% 48%;
    --sidebar-primary-foreground: 0 0% 100%;
    --sidebar-accent: 240 3.7% 15.9%;
    --sidebar-accent-foreground: 240 4.8% 95.9%;
    --sidebar-border: 240 3.7% 15.9%;
    --sidebar-ring: 217.2 91.2% 59.8%;
  }

  .green-theme {
    --primary: 142.1 76.2% 36.3%; /* A nice shade of green */
    --primary-foreground: 0 0% 100%;
    --ring: 142.1 76.2% 36.3%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}

@layer components {
  .marquee {
    animation: marquee 40s linear infinite;
  }

  .marquee-container:hover .marquee {
    animation-play-state: paused;
  }

  @keyframes marquee {
    0% { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }
}

@media print {
  body * {
    visibility: hidden;
  }
  #bill-content, #bill-content * {
    visibility: visible;
  }
  #bill-content {
    position: absolute;
    left: 0;
    top: 0;
    width: 80mm; /* Standard thermal printer width */
    height: auto;
    margin: 0;
    padding: 0;
  }
  .no-print {
    display: none !important;
  }
}