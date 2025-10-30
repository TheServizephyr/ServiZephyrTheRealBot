'use client';

import { motion } from 'framer-motion';
import { ArrowRight, RefreshCw, BarChart2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1 },
};

export default function CustomerHubPage() {
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="p-4 md:p-6 space-y-8"
    >
      <header>
        <h1 className="text-3xl font-bold tracking-tight">My Hub</h1>
        <p className="text-muted-foreground mt-1">Your personal stats and shortcuts.</p>
      </header>

      {/* Quick Re-Order Section */}
      <motion.div variants={itemVariants}>
        <Card className="bg-primary/10 border-primary/20">
          <CardHeader>
            <CardTitle className="text-primary flex items-center gap-2">
                <RefreshCw size={20} /> Quick Re-Order
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg">Time for your favorite <span className="font-bold text-foreground">'Paneer Tikka'</span> from <span className="font-bold text-foreground">Baghel's Restaurant</span>?</p>
            <button className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90">
              Re-order Now <ArrowRight size={16}/>
            </button>
          </CardContent>
        </Card>
      </motion.div>

      {/* My Restaurants Section */}
       <motion.div variants={itemVariants}>
        <h2 className="text-xl font-bold mb-4">My Restaurants</h2>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {['Baghel\'s', 'Pizza Point', 'Curry Corner', 'Noodle House', 'Taco Town'].map(name => (
            <div key={name} className="flex-shrink-0 w-24 text-center">
                <div className="w-24 h-24 bg-muted rounded-full flex items-center justify-center border-2 border-border">
                    <span className="text-xs font-bold text-foreground">{name}</span>
                </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* My Stats Section */}
      <motion.div variants={itemVariants}>
        <h2 className="text-xl font-bold mb-4">My Stats</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
                <CardHeader><CardTitle>Total Savings this Month</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold text-green-500">₹450</p></CardContent>
            </Card>
             <Card>
                <CardHeader><CardTitle>Your Top Restaurant</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold">Baghel's</p></CardContent>
            </Card>
             <Card>
                <CardHeader><CardTitle>Your Top Dish</CardTitle></CardHeader>
                <CardContent><p className="text-3xl font-bold">Paneer Tikka</p></CardContent>
            </Card>
        </div>
      </motion.div>
    </motion.div>
  );
}
