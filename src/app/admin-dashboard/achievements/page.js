'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { Trophy, Star, Zap, Award, Medal, Crown, Sparkles, TrendingUp, RefreshCw, Store, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

/* ─────────────────────────── helpers ─────────────────────────── */

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-IN');
}

/* ─────────────── milestone config ─────────────────────────────── */

const MILESTONES = [
  {
    count: 100,
    label: '100 Orders',
    emoji: '🥉',
    badge: 'Rising Star',
    gradient: 'from-amber-400 via-orange-400 to-yellow-300',
    glowColor: 'rgba(251,191,36,0.5)',
    borderColor: 'border-amber-400/60',
    bgColor: 'bg-amber-500/10',
    icon: Star,
    particles: '✦ ✧ ⭐ 🌟',
    description: 'Pehle 100 orders! Yeh toh bas shuruaat hai!',
  },
  {
    count: 200,
    label: '200 Orders',
    emoji: '🥈',
    badge: 'Growing Champion',
    gradient: 'from-slate-300 via-gray-200 to-slate-400',
    glowColor: 'rgba(148,163,184,0.6)',
    borderColor: 'border-slate-300/60',
    bgColor: 'bg-slate-400/10',
    icon: Medal,
    particles: '✦ 💫 🌙 ✨',
    description: '200 orders ka jaadu! Double century! Mast hai bhai!',
  },
  {
    count: 300,
    label: '300 Orders',
    emoji: '🥇',
    badge: 'Order Legend',
    gradient: 'from-yellow-400 via-amber-300 to-yellow-200',
    glowColor: 'rgba(234,179,8,0.65)',
    borderColor: 'border-yellow-400/60',
    bgColor: 'bg-yellow-500/10',
    icon: Award,
    particles: '🎊 🎉 ✨ 🌟 💥',
    description: 'Teen sau orders! ServiZephyr ke sath waah! Legend ho tum!',
  },
  {
    count: 500,
    label: '500 Orders',
    emoji: '👑',
    badge: 'Elite Titan',
    gradient: 'from-violet-500 via-purple-400 to-fuchsia-500',
    glowColor: 'rgba(168,85,247,0.65)',
    borderColor: 'border-violet-400/60',
    bgColor: 'bg-violet-500/10',
    icon: Crown,
    particles: '👑 💎 🔥 ⚡ 🚀',
    description: '500 orders! Ye toh ek empire hai bhai! ServiZephyr ka KING!',
  },
];

/* ─────────────── confetti particle ─────────────────────────────── */

function ConfettiParticle({ color, delay, left, duration }) {
  return (
    <motion.div
      className="absolute top-0 w-2 h-2 rounded-sm pointer-events-none"
      style={{ left: `${left}%`, backgroundColor: color }}
      initial={{ y: -20, opacity: 1, rotate: 0, scale: 1 }}
      animate={{
        y: [0, 120, 260, 420],
        opacity: [1, 1, 0.8, 0],
        rotate: [0, 180, 360, 540],
        x: [0, Math.random() * 60 - 30, Math.random() * 80 - 40],
        scale: [1, 0.8, 0.6, 0.4],
      }}
      transition={{ duration, delay, ease: 'easeOut' }}
    />
  );
}

function ConfettiBurst({ active }) {
  const colors = ['#f59e0b', '#8b5cf6', '#10b981', '#ef4444', '#3b82f6', '#f97316', '#ec4899', '#facc15'];
  const particles = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    color: colors[i % colors.length],
    delay: (i * 0.06) % 1.2,
    left: Math.random() * 100,
    duration: 1.5 + Math.random() * 1,
  }));

  if (!active) return null;

  return (
    <div className="absolute inset-x-0 top-0 h-80 overflow-hidden pointer-events-none z-50">
      {particles.map((p) => (
        <ConfettiParticle key={p.id} {...p} />
      ))}
    </div>
  );
}

/* ─────────────── floating particle bg ─────────────────────────── */

function FloatingParticle({ emoji, x, y, duration, delay }) {
  return (
    <motion.div
      className="absolute text-2xl select-none pointer-events-none"
      style={{ left: `${x}%`, top: `${y}%` }}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{
        opacity: [0, 0.7, 0.5, 0.7, 0],
        y: [0, -30, -20, -40, -60],
        scale: [0.5, 1, 0.9, 1.1, 0.7],
        rotate: [0, 15, -10, 20, 0],
      }}
      transition={{ duration, delay, repeat: Infinity, repeatDelay: duration * 0.3 }}
    >
      {emoji}
    </motion.div>
  );
}

/* ─────────────── animated counter ─────────────────────────────── */

function AnimatedCounter({ target, duration = 2000 }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const hasRun = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasRun.current) {
          hasRun.current = true;
          const start = Date.now();
          const tick = () => {
            const elapsed = Date.now() - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(eased * target));
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target, duration]);

  return <span ref={ref}>{formatNumber(count)}</span>;
}

/* ─────────────── milestone card ─────────────────────────────── */

function MilestoneCard({ milestone, restaurantName, orderCount, isUnlocked, index }) {
  const [showConfetti, setShowConfetti] = useState(false);
  const [hovered, setHovered] = useState(false);
  const isExact = orderCount >= milestone.count;
  const progress = Math.min((orderCount / milestone.count) * 100, 100);
  const Icon = milestone.icon;

  useEffect(() => {
    if (isUnlocked) {
      const t = setTimeout(() => {
        setShowConfetti(true);
        const t2 = setTimeout(() => setShowConfetti(false), 2500);
        return () => clearTimeout(t2);
      }, index * 400 + 600);
      return () => clearTimeout(t);
    }
  }, [isUnlocked, index]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 60, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.15, duration: 0.6, type: 'spring', stiffness: 120 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className="relative"
    >
      <ConfettiBurst active={showConfetti} />

      {/* glow ring on hover or unlock */}
      <motion.div
        className={`absolute -inset-1 rounded-2xl bg-gradient-to-r ${milestone.gradient} opacity-0 blur-lg`}
        animate={{ opacity: isUnlocked && hovered ? 0.5 : isUnlocked ? 0.25 : 0 }}
        transition={{ duration: 0.4 }}
      />

      <div
        className={`relative rounded-2xl border ${milestone.borderColor} ${milestone.bgColor} backdrop-blur-sm overflow-hidden transition-all duration-300 ${
          isUnlocked ? 'shadow-2xl' : 'opacity-60 grayscale-[40%]'
        }`}
        style={isUnlocked ? { boxShadow: `0 0 30px ${milestone.glowColor}` } : {}}
      >
        {/* top gradient strip */}
        <div className={`h-1.5 w-full bg-gradient-to-r ${milestone.gradient}`} />

        {/* locked overlay */}
        {!isUnlocked && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/60 backdrop-blur-[2px] rounded-2xl">
            <div className="text-center">
              <div className="text-4xl mb-2">🔒</div>
              <p className="text-sm font-semibold text-muted-foreground">{milestone.count - orderCount} more orders to unlock</p>
            </div>
          </div>
        )}

        <div className="p-6 md:p-8">
          {/* header row */}
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              {/* icon circle */}
              <motion.div
                className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${milestone.gradient} shadow-lg`}
                animate={isUnlocked ? { rotate: [0, -8, 8, -4, 0] } : {}}
                transition={{ duration: 1.2, delay: index * 0.2 + 0.8, type: 'spring' }}
              >
                <Icon className="h-7 w-7 text-white drop-shadow" />
              </motion.div>

              <div>
                <div className="text-3xl">{milestone.emoji}</div>
                <h3 className="text-lg font-bold mt-0.5">{milestone.label}</h3>
              </div>
            </div>

            {/* badge */}
            {isUnlocked && (
              <motion.div
                initial={{ scale: 0, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: index * 0.15 + 0.5, type: 'spring', stiffness: 200 }}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold bg-gradient-to-r ${milestone.gradient} text-white shadow-md`}
              >
                {milestone.badge}
              </motion.div>
            )}
          </div>

          {/* description */}
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{milestone.description}</p>

          {/* progress bar */}
          <div className="space-y-2 mb-4">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span className="font-semibold">{Math.round(progress)}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
              <motion.div
                className={`h-full rounded-full bg-gradient-to-r ${milestone.gradient}`}
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 1.2, delay: index * 0.15 + 0.3, ease: 'easeOut' }}
              />
            </div>
          </div>

          {/* order count display */}
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Total Orders</p>
              <p className="text-2xl font-black tabular-nums">
                {isUnlocked ? <AnimatedCounter target={orderCount} /> : formatNumber(orderCount)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Target</p>
              <p className="text-2xl font-black text-muted-foreground">{formatNumber(milestone.count)}</p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ─────────────── restaurant hero card ─────────────────────────── */

function RestaurantHeroCard({ restaurant, highestMilestone, hideNames }) {
  const milestone = highestMilestone;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 30 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.7, type: 'spring', stiffness: 100 }}
      className="relative rounded-3xl overflow-hidden border border-white/10 shadow-2xl"
    >
      {/* animated bg gradient */}
      <motion.div
        className={`absolute inset-0 bg-gradient-to-br ${milestone ? milestone.gradient : 'from-primary/30 via-primary/10 to-transparent'} opacity-20`}
        animate={{ opacity: [0.15, 0.25, 0.15] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* mesh / noise overlay */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 50%, rgba(255,255,255,0.15) 0%, transparent 60%), radial-gradient(circle at 80% 20%, rgba(255,255,255,0.1) 0%, transparent 60%)',
        }}
      />

      <div className="relative p-8 md:p-12 text-center">
        {/* powered by ServiZephyr */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/20 border border-primary/30 mb-6"
        >
          <Zap className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-bold text-primary tracking-wider uppercase">Powered by ServiZephyr</span>
          <Zap className="h-3.5 w-3.5 text-primary" />
        </motion.div>

        {/* trophy */}
        <motion.div
          animate={{ y: [0, -10, 0], rotate: [0, 3, -3, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className="text-7xl mb-4"
        >
          {milestone ? milestone.emoji : '🏆'}
        </motion.div>

        {/* restaurant name */}
        <motion.h1
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="text-4xl md:text-5xl font-black tracking-tight mb-2"
        >
          {restaurant.name}
        </motion.h1>

        <p className="text-muted-foreground text-base mb-8">
          {restaurant.id && (
            <span className="font-mono text-xs opacity-60">
              {restaurant.id}
            </span>
          )}
        </p>

        {/* big order count */}
        <div className="inline-block">
          <motion.div
            className={`text-6xl md:text-8xl font-black tabular-nums bg-gradient-to-r ${
              milestone ? milestone.gradient : 'from-primary to-primary/60'
            } bg-clip-text text-transparent`}
          >
            <AnimatedCounter target={restaurant.orderCount} duration={2500} />
          </motion.div>
          <p className="text-lg font-semibold text-muted-foreground mt-2">Total Orders</p>
        </div>

        {/* current badge */}
        {milestone && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className={`mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r ${milestone.gradient} shadow-xl`}
          >
            <Sparkles className="h-5 w-5 text-white" />
            <span className="text-white font-bold text-lg">{milestone.badge}</span>
            <Sparkles className="h-5 w-5 text-white" />
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

/* ─────────────── restaurant list card ─────────────────────────── */

function RestaurantListCard({ restaurant, index, onSelect, isSelected }) {
  const highestMilestone = [...MILESTONES].reverse().find((m) => restaurant.orderCount >= m.count);

  return (
    <motion.button
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.07 }}
      onClick={() => onSelect(restaurant)}
      className={`w-full text-left rounded-xl border p-4 transition-all duration-200 hover:shadow-md ${
        isSelected
          ? 'border-primary bg-primary/10 shadow-md shadow-primary/20'
          : 'border-border bg-card hover:border-primary/50 hover:bg-muted/50'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            highestMilestone ? `bg-gradient-to-br ${highestMilestone.gradient}` : 'bg-muted'
          }`}
        >
          {highestMilestone ? (
            <span className="text-lg">{highestMilestone.emoji}</span>
          ) : (
            <Store className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug truncate">{restaurant.name}</p>
          <p className="text-xs text-muted-foreground">{formatNumber(restaurant.orderCount)} orders</p>
        </div>
        {highestMilestone && (
          <span
            className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full bg-gradient-to-r ${highestMilestone.gradient} text-white`}
          >
            {highestMilestone.badge}
          </span>
        )}
      </div>
    </motion.button>
  );
}

/* ─────────────── main page ─────────────────────────────────────── */

export default function AchievementsPage() {
  const [restaurants, setRestaurants] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showBgParticles, setShowBgParticles] = useState(true);
  const [hideNames, setHideNames] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const headers = {};
      const currentUser = auth.currentUser;
      if (currentUser) {
        const idToken = await currentUser.getIdToken();
        headers.Authorization = `Bearer ${idToken}`;
      }

      // Use the existing analytics API — fetch a long range to get all-time totals
      const end = new Date().toISOString().split('T')[0];
      const start = '2020-01-01';
      const res = await fetch(`/api/admin/analytics?start=${start}&end=${end}`, {
        headers,
        cache: 'no-store',
      });

      if (!res.ok) {
        const text = await res.text();
        let msg = 'Could not load data';
        try { msg = JSON.parse(text).message || msg; } catch { msg = text || msg; }
        throw new Error(msg);
      }

      const data = await res.json();
      const rows = (data.restaurantBreakdown || []).map((r) => ({
        id: r.id,
        name: r.name,
        // Use year count as all-time proxy; fallback to month
        orderCount: r.year?.orderCount || r.month?.orderCount || r.today?.orderCount || 0,
      }));

      // Sort by orderCount desc
      rows.sort((a, b) => b.orderCount - a.orderCount);
      setRestaurants(rows);
      if (rows.length > 0) setSelected(rows[0]);
    } catch (err) {
      setError(err.message || 'Failed to load achievements data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const selectedRestaurant = selected || restaurants[0];
  const highestMilestone = selectedRestaurant
    ? [...MILESTONES].reverse().find((m) => selectedRestaurant.orderCount >= m.count)
    : null;

  const bgParticles = [
    { emoji: '🏆', x: 5, y: 10, duration: 6, delay: 0 },
    { emoji: '⭐', x: 90, y: 20, duration: 7, delay: 1 },
    { emoji: '🎉', x: 15, y: 75, duration: 5, delay: 2 },
    { emoji: '✨', x: 80, y: 60, duration: 8, delay: 0.5 },
    { emoji: '🥇', x: 50, y: 5, duration: 6.5, delay: 1.5 },
    { emoji: '💫', x: 70, y: 85, duration: 7.5, delay: 3 },
    { emoji: '🔥', x: 30, y: 90, duration: 5.5, delay: 0.8 },
    { emoji: '👑', x: 95, y: 45, duration: 9, delay: 2.2 },
  ];

  return (
    <div className="relative min-h-full space-y-8 overflow-hidden pb-12">
      {/* floating bg particles */}
      {showBgParticles && bgParticles.map((p, i) => (
        <FloatingParticle key={i} {...p} />
      ))}

      {/* PAGE HEADER */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <div className="flex items-center gap-3 mb-1">
            <motion.div
              animate={{ rotate: [0, -10, 10, 0] }}
              transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
            >
              <Trophy className="h-8 w-8 text-amber-400" />
            </motion.div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight bg-gradient-to-r from-amber-400 via-orange-400 to-yellow-300 bg-clip-text text-transparent">
              Achievements
            </h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Celebrate every milestone — powered by <span className="font-bold text-primary">ServiZephyr</span> 🚀
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={hideNames ? 'default' : 'outline'}
            onClick={() => setHideNames((v) => !v)}
            className={`w-fit gap-2 transition-all duration-300 ${
              hideNames ? 'bg-violet-600 hover:bg-violet-700 border-violet-600 text-white' : ''
            }`}
          >
            {hideNames ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {hideNames ? 'Show Others' : 'Hide Others'}
          </Button>
          <Button variant="outline" onClick={fetchData} disabled={loading} className="w-fit">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </motion.div>

      {/* ERROR */}
      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl border border-destructive/40 bg-destructive/5 px-5 py-4 text-sm text-destructive"
        >
          ⚠️ {error}
        </motion.div>
      )}

      {/* LOADING */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          >
            <Trophy className="h-12 w-12 text-amber-400" />
          </motion.div>
          <p className="text-muted-foreground font-medium">Loading achievements...</p>
        </div>
      )}

      {!loading && restaurants.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-32 text-muted-foreground gap-3">
          <Trophy className="h-16 w-16 opacity-30" />
          <p className="text-lg font-semibold">No restaurant data found</p>
          <p className="text-sm">Achievements will appear once orders come in.</p>
        </div>
      )}

      {!loading && restaurants.length > 0 && (
        <div className={`grid gap-8 ${hideNames ? '' : 'xl:grid-cols-[280px_1fr]'}`}>
          {/* LEFT: restaurant list — hidden when hideNames is on */}
          <AnimatePresence>
            {!hideNames && (
              <motion.div
                key="restaurant-list"
                initial={{ opacity: 0, x: -30, width: 0 }}
                animate={{ opacity: 1, x: 0, width: 'auto' }}
                exit={{ opacity: 0, x: -30, width: 0 }}
                transition={{ duration: 0.35, ease: 'easeInOut' }}
                className="space-y-2 overflow-hidden"
              >
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1 mb-3">
                  🏪 All Restaurants
                </p>
                <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                  {restaurants.map((r, i) => (
                    <RestaurantListCard
                      key={r.id}
                      restaurant={r}
                      index={i}
                      onSelect={setSelected}
                      isSelected={selectedRestaurant?.id === r.id}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* RIGHT: detail */}
          <div className="space-y-6">
            <AnimatePresence mode="wait">
              {selectedRestaurant && (
                <motion.div
                  key={selectedRestaurant.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.4 }}
                  className="space-y-6"
                >
                  {/* hero card */}
                  <RestaurantHeroCard restaurant={selectedRestaurant} highestMilestone={highestMilestone} hideNames={hideNames} />

                  {/* milestone cards grid */}
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
                      🏆 Milestones
                    </p>
                    <div className="grid gap-5 sm:grid-cols-2">
                      {MILESTONES.map((milestone, i) => (
                        <MilestoneCard
                          key={milestone.count}
                          milestone={milestone}
                          restaurantName={selectedRestaurant.name}
                          orderCount={selectedRestaurant.orderCount}
                          isUnlocked={selectedRestaurant.orderCount >= milestone.count}
                          index={i}
                        />
                      ))}
                    </div>
                  </div>

                  {/* ServiZephyr footer signature */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1 }}
                    className="flex flex-col items-center gap-2 py-8 border-t border-border"
                  >
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <TrendingUp className="h-4 w-4 text-primary" />
                      <span className="text-sm">
                        <span className="font-bold text-primary">ServiZephyr</span> — Har order ek naya milestone hai 🎯
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground opacity-60">
                      Achievements reset every milestone level • Keep growing!
                    </p>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
