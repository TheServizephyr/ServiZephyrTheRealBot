
'use client'

import { motion, useInView, animate, AnimatePresence } from 'framer-motion'
import { CheckCircle, Bot, Zap, Rocket, Users, ArrowRight, Star, ShoppingCart, BarChart2, MessageSquare, Briefcase, Store, Soup, Pizza } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import React, { useEffect, useRef, useState } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import placeholderData from '@/app/lib/placeholder-images.json'
import AuthModal from '@/components/AuthModal'


const MotionLink = motion(Link);

const sectionVariants = {
  hidden: { opacity: 0, y: 50 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.1,
      duration: 0.5,
      ease: 'easeOut',
    },
  }),
};

const AnimatedNumber = ({ value, suffix = '', prefix = '' }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, amount: 0.5 });
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (isInView) {
      const controls = animate(0, value, {
        duration: 2,
        ease: "easeOut",
        onUpdate: (latest) => {
          setDisplayValue(Math.floor(latest));
        },
      });
      return () => controls.stop();
    }
  }, [isInView, value]);

  return (
    <span ref={ref}>
      {prefix}{displayValue}{suffix}
    </span>
  );
};

const AnimatedWhatShop = () => {
    const [part1, setPart1] = useState('');
    const [part2, setPart2] = useState('');
    const isMounted = useRef(true);

    useEffect(() => {
      isMounted.current = true;
      const sequence = async () => {
        while (isMounted.current) {
          // 1. Type WhatsApp
          setPart1('');
          setPart2('');
          const whatsAppText = "WhatsApp";
          for (let i = 1; i <= whatsAppText.length; i++) {
              if(!isMounted.current) return;
              setPart1(whatsAppText.substring(0, i));
              await new Promise(res => setTimeout(res, 80));
          }
          await new Promise(res => setTimeout(res, 1200));
          if(!isMounted.current) return;
  
          // 2. Delete App
          for (let i = "App".length; i >= 1; i--) {
            if(!isMounted.current) return;
            setPart1("Whats" + "App".substring(0, i-1));
            await new Promise(res => setTimeout(res, 120));
          }
          setPart1("Whats");
          await new Promise(res => setTimeout(res, 400));
          if(!isMounted.current) return;
          
          // 3. Type Shop
          const shopText = 'Shop';
          let tempShopText = '';
          for (const char of shopText) {
              if(!isMounted.current) return;
              tempShopText += char;
              setPart2(tempShopText);
              await new Promise(res => setTimeout(res, 150));
          }
          await new Promise(res => setTimeout(res, 2500));
          if(!isMounted.current) return;

          // 4. Delete WhatShop
          const fullText = "WhatShop";
           for (let i = fullText.length; i >= 0; i--) {
            if(!isMounted.current) return;
            setPart1(fullText.substring(0, i));
            setPart2('');
            await new Promise(res => setTimeout(res, 60));
          }
          await new Promise(res => setTimeout(res, 500));
          if(!isMounted.current) return;
        }
      };
  
      sequence();
  
      return () => {
        isMounted.current = false;
      }
      
    }, []);
  
    return (
        <h2 
          className="font-headline text-4xl md:text-6xl tracking-tighter leading-tight font-bold transition-colors duration-500"
          style={{ minHeight: '70px' }}
        >
          <span style={{ color: '#25D366' }}>{part1}</span>
          <span style={{ color: 'hsl(var(--primary))' }}>{part2}</span>
          <span className="animate-ping" style={{color: 'hsl(var(--muted-foreground))'}}>|</span>
        </h2>
    );
};

const AnimatedSubheadline = () => {
    const [part1, setPart1] = useState('');
    const [part2, setPart2] = useState('');
    const isMounted = useRef(true);
  
    useEffect(() => {
      isMounted.current = true;
      const sequence = async () => {
        while (isMounted.current) {
          // 1. Type WhatsApp
          setPart1('');
          setPart2('');
          const whatsAppText = "WhatsApp";
          for (let i = 1; i <= whatsAppText.length; i++) {
              if(!isMounted.current) return;
              setPart1(whatsAppText.substring(0, i));
              await new Promise(res => setTimeout(res, 80));
          }
          await new Promise(res => setTimeout(res, 1200));
          if(!isMounted.current) return;
  
          // 2. Delete App
          for (let i = "App".length; i >= 1; i--) {
            if(!isMounted.current) return;
            setPart1("Whats" + "App".substring(0, i-1));
            await new Promise(res => setTimeout(res, 120));
          }
          setPart1("Whats");
          await new Promise(res => setTimeout(res, 400));
          if(!isMounted.current) return;
          
          // 3. Type Shop
          const shopText = 'Shop';
          let tempShopText = '';
          for (const char of shopText) {
              if(!isMounted.current) return;
              tempShopText += char;
              setPart2(tempShopText);
              await new Promise(res => setTimeout(res, 150));
          }
          await new Promise(res => setTimeout(res, 2500));
          if(!isMounted.current) return;

          // 4. Delete WhatShop
          const fullText = "WhatShop";
           for (let i = fullText.length; i >= 0; i--) {
            if(!isMounted.current) return;
            setPart1(fullText.substring(0, i));
            setPart2('');
            await new Promise(res => setTimeout(res, 60));
          }
          await new Promise(res => setTimeout(res, 500));
          if(!isMounted.current) return;
        }
      };
  
      sequence();
  
      return () => {
        isMounted.current = false;
      }
      
    }, []);

    return (
         <h3 className="text-xl md:text-2xl text-muted-foreground">
            Ab lijiye direct orders customer ke <span style={{ color: '#25D366' }}>{part1}</span><span style={{ color: 'hsl(var(--primary))' }}>{part2}</span> se.
        </h3>
    );
};


export default function Home() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [animationFinished, setAnimationFinished] = useState(true); // Always show content now

  const testimonials = [
    {
      name: "Rohan Sharma",
      title: "Owner, Curry Cloud",
      quote: "ServiZephyr has been a game-changer for my cloud kitchen. We've saved over ₹50,000 in commissions in just 3 months! The best part is, we now own our customer data.",
      image: placeholderData.testimonials[0],
      rating: 5,
    },
    {
      name: "Priya Desai",
      title: "Manager, The Daily Grind Cafe",
      quote: "Our regulars love the WhatsApp ordering system. It's so much faster and more convenient for them. Our repeat orders have gone up by 40% since we switched.",
      image: placeholderData.testimonials[1],
      rating: 5,
    },
    {
      name: "Amit Patel",
      title: "Founder, Pizza on Wheels",
      quote: "I was skeptical at first, but the owner dashboard is incredibly powerful. I can see my sales in real-time and make decisions on the fly. This is the control I've always wanted.",
      image: placeholderData.testimonials[2],
      rating: 5,
    },
     {
      name: "Sunita Verma",
      title: "Co-founder, Healthy Bites",
      quote: "The best investment we've made. It's simple, powerful, and has given us a direct line to our customers. Our marketing is so much more effective now.",
      image: placeholderData.testimonials[0],
      rating: 5,
    },
    {
      name: "Rajesh Kumar",
      title: "Head Chef, Tandoori Nights",
      quote: "Finally, a system that understands restaurant owners. The dashboard is brilliant, and not paying high commissions means more profit in our pocket.",
      image: placeholderData.testimonials[1],
      rating: 5,
    },
  ];


  return (
    <>
      <main className="bg-background">
        {/* Hero Section */}
        <section className="relative w-full flex flex-col justify-center items-center py-20 md:py-32">
          <video 
            src="/Animated_Hero_Video_for_Website.mp4" 
            autoPlay 
            loop 
            muted 
            playsInline
            className="absolute top-0 left-0 w-full h-full object-cover z-0 opacity-20"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-transparent to-background z-10"></div>
          
          <div className="relative container px-4 md:px-6 text-center z-20">
            <div className="max-w-4xl mx-auto flex flex-col items-center">
               <h1 className="font-headline text-5xl md:text-7xl tracking-tighter leading-tight text-foreground">
                Your Business. Your Customers. Your Control.
              </h1>

              <div className="my-6 h-16 md:h-20 flex items-center justify-center">
                <AnimatedWhatShop />
              </div>

              <AnimatePresence>
                {animationFinished && (
                  <motion.div
                    className="flex flex-col items-center w-full"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  >
                    <AnimatedSubheadline />
                     <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-foreground mt-6">
                        Cut Commission. Boost Profits by <span className="text-green-500">25%+.</span>
                    </h2>
                    <button 
                        onClick={() => setIsModalOpen(true)}
                        className="mt-8 bg-primary text-primary-foreground font-bold py-3 px-8 rounded-lg text-lg hover:bg-primary/90 transition-transform transform hover:scale-105"
                    >
                      Start Your Free Trial
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </section>
        
        {/* Animated Stats Section */}
        <motion.section
          className="container mx-auto py-12"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.5 }}
          variants={sectionVariants}
        >
          <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-3 md:grid-cols-5 md:gap-8">
            <div className="rounded-lg border bg-secondary p-6 md:p-8 shadow-sm transition-all duration-300 hover:shadow-lg hover:-translate-y-2">
              <h3 className="text-4xl sm:text-5xl font-bold text-primary">
                <AnimatedNumber value={25} suffix="%" />+
              </h3>
              <p className="mt-2 text-muted-foreground text-sm">Commission Saved</p>
            </div>
            <div className="rounded-lg border bg-secondary p-6 md:p-8 shadow-sm transition-all duration-300 hover:shadow-lg hover:-translate-y-2">
              <h3 className="text-4xl sm:text-5xl font-bold text-primary">
                <AnimatedNumber value={40} suffix="%" />+
              </h3>
              <p className="mt-2 text-muted-foreground text-sm">Increase in Repeat Orders</p>
            </div>
            <div className="rounded-lg border bg-secondary p-6 md:p-8 shadow-sm transition-all duration-300 hover:shadow-lg hover:-translate-y-2">
              <h3 className="text-4xl sm:text-5xl font-bold text-primary">
                <AnimatedNumber value={100} suffix="%" />
              </h3>
              <p className="mt-2 text-muted-foreground text-sm">Customer Data Ownership</p>
            </div>
            <div className="rounded-lg border bg-secondary p-6 md:p-8 shadow-sm transition-all duration-300 hover:shadow-lg hover:-translate-y-2">
              <h3 className="text-4xl sm:text-5xl font-bold text-primary">
                <AnimatedNumber value={500} suffix="+" />
              </h3>
              <p className="mt-2 text-muted-foreground text-sm">Happy Restaurants</p>
            </div>
             <div className="rounded-lg border bg-secondary p-6 md:p-8 shadow-sm transition-all duration-300 hover:shadow-lg hover:-translate-y-2 col-span-2 sm:col-span-1">
              <h3 className="text-4xl sm:text-5xl font-bold text-primary">
                <AnimatedNumber value={25000} suffix="+" />
              </h3>
              <p className="mt-2 text-muted-foreground text-sm">Happy Users</p>
            </div>
          </div>
        </motion.section>

        {/* Product Showcase Section */}
        <motion.section
          id="product"
          className="bg-card py-20 sm:py-28"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={sectionVariants}
        >
            <div className="container mx-auto px-4">
                <h2 className="mb-4 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-foreground">The Command Center You've Always Wanted</h2>
                <p className="mx-auto mb-16 max-w-3xl text-center text-lg text-muted-foreground md:text-xl">
                    Stop guessing, start growing. Our dashboard gives you a bird's-eye view of your entire operation, with actionable insights to boost your bottom line.
                </p>

                <div className="grid gap-16">
                    <div className="grid items-center gap-8 md:grid-cols-2">
                        <motion.div initial={{opacity: 0, x: -50}} whileInView={{opacity: 1, x: 0, transition:{duration: 0.7}}} viewport={{ once: true, amount: 0.5 }}>
                            <h3 className="text-2xl font-bold text-primary">Live Order Dashboard</h3>
                            <p className="mt-4 text-muted-foreground">Never miss an order. Get a real-time stream of incoming WhatsApp orders on a clean, intuitive interface. Manage status, accept, and dispatch with a single click.</p>
                             <div className="mt-4 rounded-lg border bg-background p-1.5 shadow-lg">
                                <Image 
                                    src={placeholderData.productShowcase2.src}
                                    alt="Live Order Dashboard Mockup"
                                    width={placeholderData.productShowcase2.width}
                                    height={placeholderData.productShowcase2.height}
                                    className="rounded-md"
                                    data-ai-hint={placeholderData.productShowcase2.hint}
                                />
                            </div>
                        </motion.div>
                         <motion.div className="md:order-first" initial={{opacity: 0, x: 50}} whileInView={{opacity: 1, x: 0, transition:{duration: 0.7}}} viewport={{ once: true, amount: 0.5 }}>
                            <div className="rounded-lg border bg-background p-1.5 shadow-lg">
                                <Image 
                                    src={placeholderData.productShowcase1.src}
                                    alt="Analytics Chart Mockup"
                                    width={placeholderData.productShowcase1.width}
                                    height={placeholderData.productShowcase1.height}
                                    className="rounded-md"
                                    data-ai-hint={placeholderData.productShowcase1.hint}
                                />
                            </div>
                        </motion.div>
                    </div>
                </div>
            </div>
        </motion.section>

        {/* Feature Breakdown Section */}
        <motion.section 
          id="features"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={sectionVariants}
          className="container mx-auto px-4 py-20 sm:py-28"
        >
          <h2 className="mb-12 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-foreground">Your All-in-One Growth Engine</h2>
          <p className="mx-auto mb-12 max-w-2xl text-center text-lg text-muted-foreground md:text-xl">
            From seamless ordering to powerful analytics and marketing, ServiZephyr is packed with features designed to help you succeed.
          </p>
          <Tabs defaultValue="ordering" className="w-full">
            <TabsList className="grid w-full grid-cols-1 md:grid-cols-3 bg-muted">
              <TabsTrigger value="ordering"><ShoppingCart className="mr-2 h-4 w-4" /> WhatsApp Ordering</TabsTrigger>
              <TabsTrigger value="dashboard"><BarChart2 className="mr-2 h-4 w-4" /> Owner Command Center</TabsTrigger>
              <TabsTrigger value="growth"><Rocket className="mr-2 h-4 w-4" /> Growth Toolkit</TabsTrigger>
            </TabsList>
            <TabsContent value="ordering" className="mt-8">
               <Card>
                <CardHeader>
                  <CardTitle className="text-foreground">Commission-Free Direct Orders</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-muted-foreground">
                  <p>Let customers order from a beautiful, interactive menu directly on WhatsApp. No apps, no logins, no friction.</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><span className="font-semibold text-foreground">Live Interactive Menu:</span> Customers browse and add items to cart within WhatsApp.</li>
                    <li><span className="font-semibold text-foreground">Integrated Payments:</span> Accept UPI, Cards, and Netbanking payments right in the chat.</li>
                    <li><span className="font-semibold text-foreground">Automated Order Confirmations:</span> Keep customers updated without lifting a finger.</li>
                  </ul>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="dashboard" className="mt-8">
              <Card>
                <CardHeader>
                  <CardTitle className="text-foreground">Your Business at Your Fingertips</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-muted-foreground">
                  <p>Make data-driven decisions with a powerful dashboard that gives you a 360-degree view of your restaurant's performance.</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><span className="font-semibold text-foreground">Real-time Sales Analytics:</span> Track your revenue, top-selling items, and busiest hours.</li>
                    <li><span className="font-semibold text-foreground">Menu & Inventory Management:</span> Update your menu, change prices, or mark items "out of stock" instantly.</li>
                    <li><span className="font-semibold text-foreground">Customer Hub (CRM):</span> See who your most loyal customers are and understand their ordering habits.</li>
                  </ul>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="growth" className="mt-8">
              <Card>
                <CardHeader>
                  <CardTitle className="text-foreground">Tools to Grow Your Brand</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-muted-foreground">
                  <p>Stop relying on aggregators for discovery. Use our built-in marketing tools to build your own brand and drive repeat business.</p>
                  <ul className="list-disc pl-5 space-y-2">
                    <li><span className="font-semibold text-foreground">WhatsApp Marketing:</span> Send promotions, new menu alerts, and festival offers to your customers (with their consent!).</li>
                    <li><span className="font-semibold text-foreground">Customer Feedback & Reviews:</span> Automatically collect feedback after every order to improve your service.</li>
                    <li><span className="font-semibold text-foreground">QR Code Generator:</span> Create a unique QR code for your tables or flyers that opens your WhatsApp menu.</li>
                  </ul>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </motion.section>

        {/* Target Audience Section */}
        <motion.section 
          className="bg-card py-20 sm:py-28"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={sectionVariants}
        >
          <div className="container mx-auto px-4">
            <h2 className="mb-12 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-foreground">Built for Every Kind of Food Business</h2>
            <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
              {[
                { icon: <Store className="h-10 w-10 text-primary" />, name: 'QSRs' },
                { icon: <Briefcase className="h-10 w-10 text-primary" />, name: 'Cloud Kitchens' },
                { icon: <Soup className="h-10 w-10 text-primary" />, name: 'Restaurants' },
                { icon: <Pizza className="h-10 w-10 text-primary" />, name: 'Cafes & Bakeries' },
              ].map((item, i) => (
                <motion.div key={item.name} custom={i} variants={cardVariants} className="flex flex-col items-center text-center">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-background shadow-inner">
                    {item.icon}
                  </div>
                  <h3 className="mt-4 text-xl font-bold text-foreground">{item.name}</h3>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.section>

        {/* Testimonials Section */}
        <motion.section
          className="py-20 sm:py-28"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={sectionVariants}
        >
          <h2 className="mb-12 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-foreground">Don't Just Take Our Word for It</h2>
          <div className="relative w-full overflow-hidden marquee-container">
            <div className="flex marquee">
              {[...testimonials, ...testimonials].map((testimonial, index) => (
                <Card key={index} className="mx-4 flex-shrink-0" style={{width: '350px'}}>
                  <CardContent className="p-6 flex flex-col flex-grow h-full">
                    <div className="flex mb-4">
                      {[...Array(testimonial.rating)].map((_, i) => (
                        <Star key={i} className="h-5 w-5 text-yellow-400 fill-yellow-400" />
                      ))}
                    </div>
                    <p className="text-muted-foreground italic flex-grow">"{testimonial.quote}"</p>
                    <div className="flex items-center mt-6">
                      <Image
                        src={testimonial.image.src}
                        width={testimonial.image.width}
                        height={testimonial.image.height}
                        alt={testimonial.name}
                        className="h-12 w-12 rounded-full border-2 border-primary"
                        data-ai-hint={testimonial.image.hint}
                      />
                      <div className="ml-4">
                        <p className="font-bold text-foreground">{testimonial.name}</p>
                        <p className="text-sm text-muted-foreground">{testimonial.title}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </motion.section>


        {/* Comparison Table Section */}
        <motion.section 
          className="bg-card py-20 sm:py-28"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={sectionVariants}
        >
          <div className="container mx-auto px-4">
            <h2 className="mb-12 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-foreground">The Choice is Clear</h2>
            <div className="mx-auto max-w-4xl">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%] text-lg text-foreground">Feature</TableHead>
                    <TableHead className="text-center text-lg text-primary font-bold">ServiZephyr</TableHead>
                    <TableHead className="text-center text-lg text-muted-foreground">Food Aggregators</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { feature: "Platform Commission", servizephyr: "0%", aggregators: "18% - 30%" },
                    { feature: "Customer Data Ownership", servizephyr: "You Own It", aggregators: "They Own It" },
                    { feature: "Direct Marketing", servizephyr: "Yes (WhatsApp)", aggregators: "No" },
                    { feature: "Menu Control & Pricing", servizephyr: "Full Control", aggregators: "Limited / Conditional" },
                    { feature: "Payment Gateway Charges", servizephyr: "As per actuals", aggregators: "Included in commission" },
                    { feature: "Brand Building", servizephyr: "Your Own Brand", aggregators: "On Their Platform" },
                  ].map(item => (
                    <TableRow key={item.feature}>
                      <TableCell className="font-medium text-foreground">{item.feature}</TableCell>
                      <TableCell className="text-center font-bold text-green-500"><CheckCircle className="inline-block mr-2 h-5 w-5" />{item.servizephyr}</TableCell>
                      <TableCell className="text-center text-primary font-bold">{item.aggregators}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </motion.section>

        {/* Pricing Section */}
        <motion.section 
          id="pricing"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={sectionVariants}
          className="py-20 sm:py-28"
        >
          <div className="container mx-auto flex flex-col items-center px-4">
            <h2 className="text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-foreground">Simple & Transparent Pricing</h2>
            <div className="mt-12 w-full max-w-md rounded-2xl border-2 border-primary bg-card p-8 shadow-2xl shadow-primary/20 transition-transform duration-300 hover:scale-105">
              <h3 className="text-3xl font-bold text-center text-foreground">Pro Plan</h3>
              <p className="mt-4 text-center text-5xl font-bold text-foreground">₹999 <span className="text-lg font-normal text-muted-foreground">/ month</span></p>
              <ul className="mt-8 space-y-4">
                <li className="flex items-center"><CheckCircle className="mr-2 h-5 w-5 text-primary" /> Unlimited Orders</li>
                <li className="flex items-center"><CheckCircle className="mr-2 h-5 w-5 text-primary" /> WhatsApp Bot</li>
                <li className="flex items-center"><CheckCircle className="mr-2 h-5 w-5 text-primary" /> Owner Dashboard</li>
                <li className="flex items-center"><CheckCircle className="mr-2 h-5 w-5 text-primary" /> Menu Management</li>
                <li className="flex items-center"><CheckCircle className="mr-2 h-5 w-5 text-primary" /> Growth Toolkit</li>
                 <li className="flex items-center"><CheckCircle className="mr-2 h-5 w-5 text-primary" /> Customer Hub (CRM)</li>
              </ul>
              <button onClick={() => setIsModalOpen(true)} className="btn-shine mt-8 inline-flex h-12 w-full items-center justify-center rounded-md bg-primary text-lg font-bold text-primary-foreground shadow-lg shadow-primary/50 transition-transform duration-300 hover:scale-105">
                Choose Plan
              </button>
            </div>
          </div>
        </motion.section>

        {/* FAQ Section */}
        <motion.section 
          id="faq"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={sectionVariants}
          className="container mx-auto px-4 py-20 sm:py-28"
        >
          <h2 className="mb-12 text-center text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-foreground">Frequently Asked Questions</h2>
          <div className="mx-auto max-w-3xl">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="item-1">
                <AccordionTrigger className="text-foreground">Do I need any technical knowledge?</AccordionTrigger>
                <AccordionContent>
                  Not at all! ServiZephyr is designed to be extremely easy to use. Our dashboard is completely user-friendly. If you can use WhatsApp, you can use ServiZephyr.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2">
                <AccordionTrigger className="text-foreground">How long does the setup take?</AccordionTrigger>
                <AccordionContent>
                  The entire setup takes no more than 5-10 minutes. You just need to sign up, scan a QR code to connect your WhatsApp number, and your system will be live.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-3">
                <AccordionTrigger className="text-foreground">Can I easily change my menu?</AccordionTrigger>
                <AccordionContent>
                  Yes, absolutely. From your dashboard, you can add new items, change their prices, or mark an item as "out of stock" anytime, from anywhere. Everything updates in real-time.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-4">
                <AccordionTrigger className="text-foreground">Will I get customer support?</AccordionTrigger>
                <AccordionContent>
                  Yes. We provide dedicated WhatsApp and email support to all our Pro plan users to help you with any issues or questions you might have.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </motion.section>

      </main>
      <AuthModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  )
}
