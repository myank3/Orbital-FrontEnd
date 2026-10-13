/**
 * Orbital — Landing page.
 * Dark, immersive, cinematic. Privacy-first. Comparison. Compact layout.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from 'motion/react';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import {
  Lock,
  Eye,
  Server,
  Key,
  Check,
  X,
  Shield,
  MessagesSquare,
  Users,
  Video,
} from 'lucide-react';

const SPRING = { type: 'spring' as const, stiffness: 180, damping: 30 };

/* ────────────────────────────────────────────────────────── */
/* Unsplash imagery — sized for realistic mobile download      */
/* ────────────────────────────────────────────────────────── */

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1600&q=75&auto=format&fit=crop';

const ENCRYPTION_IMAGE =
  'https://images.unsplash.com/photo-1633265486064-086b219458ec?w=1200&q=75&auto=format&fit=crop';

const FEATURE_MESSAGES_IMAGE =
  'https://images.unsplash.com/photo-1516110833967-0b5716ca1387?w=800&q=75&auto=format&fit=crop';

const FEATURE_GROUPS_IMAGE =
  'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=75&auto=format&fit=crop';

const FEATURE_CALLS_IMAGE =
  'https://images.unsplash.com/photo-1516387938699-a93567ec168e?w=800&q=75&auto=format&fit=crop';

const CTA_IMAGE =
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1600&q=75&auto=format&fit=crop';

/* ────────────────────────────────────────────────────────── */

export function Landing() {
  const reduceMotion = useReducedMotion();

  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const heroRef = useRef<HTMLDivElement | null>(null);

  const heroScroll = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const heroBgY = useTransform(heroScroll.scrollYProgress, [0, 1], ['0%', '35%']);
  const heroContentY = useTransform(heroScroll.scrollYProgress, [0, 1], ['0%', '20%']);
  const heroContentOpacity = useTransform(heroScroll.scrollYProgress, [0, 0.8], [1, 0]);

  const encryptionRef = useRef<HTMLDivElement | null>(null);
  const encryptionScroll = useScroll({
    target: encryptionRef,
    offset: ['start end', 'end start'],
  });
  const encryptionImgY = useTransform(encryptionScroll.scrollYProgress, [0, 1], ['-8%', '8%']);

  const ctaRef = useRef<HTMLDivElement | null>(null);
  const ctaScroll = useScroll({ target: ctaRef, offset: ['start end', 'end start'] });
  const ctaBgY = useTransform(ctaScroll.scrollYProgress, [0, 1], ['-12%', '12%']);
  const ctaOverlayOpacity = useTransform(ctaScroll.scrollYProgress, [0, 0.5, 1], [0.85, 0.7, 0.85]);

  useEffect(() => {
    if (reduceMotion) return;
    const el = heroRef.current;
    if (!el) return;

    // Only enable the mouse-tracked glow on real pointer devices.
    // Touch phones don't fire mousemove, but the listener + RAF loop
    // still runs for nothing on mobile — skip it entirely there.
    const isFinePointer =
      typeof window !== 'undefined' &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!isFinePointer) return;

    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        raf = 0;
      });
    };

    el.addEventListener('mousemove', onMove);
    return () => {
      el.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduceMotion]);

  const reveal = (delay = 0) =>
    reduceMotion
      ? { initial: false as const, animate: false as const }
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { ...SPRING, delay },
        };

  const inView = (delay = 0) =>
    reduceMotion
      ? { initial: false as const, whileInView: undefined }
      : {
          initial: { opacity: 0, y: 16 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: '-60px' },
          transition: { ...SPRING, delay },
        };

  const headlineWords = ['Private', 'by', 'default.', 'Yours', 'by', 'design.'];

  return (
    <div className="min-h-screen bg-[#0F0D0A] text-[#EDE5D4] relative overflow-hidden">
      <Navbar />

      {/* ═══════════════════════════════════════════════════ */}
      {/* HERO — shorter on mobile for faster paint           */}
      {/* ═══════════════════════════════════════════════════ */}
      <section
        ref={heroRef}
        className="relative min-h-[80svh] sm:min-h-[92svh] flex items-center justify-center overflow-hidden"
      >
        <motion.div
          aria-hidden
          style={{ y: reduceMotion ? 0 : heroBgY }}
          className="absolute inset-0 -z-10 will-change-transform"
        >
          <img
            src={HERO_IMAGE}
            alt=""
            loading="eager"
            fetchPriority="high"
            className="absolute inset-0 w-full h-full object-cover scale-110"
          />
          <div className="absolute inset-0 bg-[#0F0D0A]/75" />
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse at 50% 100%, rgba(217,119,6,0.20), rgba(15,13,10,0.95) 60%)',
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(15,13,10,0.85) 0%, rgba(15,13,10,0.55) 50%, rgba(15,13,10,1) 100%)',
            }}
          />
        </motion.div>

        {!reduceMotion && cursor && (
          <div
            aria-hidden
            className="pointer-events-none absolute -z-[1] w-[520px] h-[520px] rounded-full"
            style={{
              left: cursor.x - 260,
              top: cursor.y - 260,
              background:
                'radial-gradient(circle, rgba(217,119,6,0.14) 0%, rgba(217,119,6,0) 65%)',
              filter: 'blur(40px)',
              mixBlendMode: 'screen',
            }}
          />
        )}

        <motion.div
          style={{
            y: reduceMotion ? 0 : heroContentY,
            opacity: reduceMotion ? 1 : heroContentOpacity,
          }}
          className="relative max-w-4xl mx-auto px-5 sm:px-6 text-center will-change-transform"
        >
          <motion.div
            {...reveal(0.05)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.05] backdrop-blur-md border border-white/[0.10] mb-5 sm:mb-7"
          >
            <Lock className="w-3 h-3 text-[#D97706]" />
            <span className="text-[10.5px] sm:text-[11px] uppercase tracking-[0.24em] text-[#A8A29E]">
              End-to-end encrypted
            </span>
          </motion.div>

          <h1 className="text-[34px] sm:text-[56px] lg:text-[84px] leading-[1.05] sm:leading-[1] tracking-[-0.04em] text-[#EDE5D4] font-normal">
            {headlineWords.map((word, i) => (
              <motion.span
                key={`${word}-${i}`}
                initial={reduceMotion ? false : { opacity: 0, y: 26, filter: 'blur(10px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{
                  duration: 0.65,
                  delay: 0.15 + i * 0.07,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className={`inline-block mr-2 sm:mr-4 ${
                  i === 2 || i === 5 ? 'text-[#D97706]' : ''
                }`}
              >
                {word}
              </motion.span>
            ))}
          </h1>

          <motion.p
            {...reveal(0.65)}
            className="text-[14px] sm:text-[16px] text-[#A8A29E] leading-[1.7] max-w-[560px] mx-auto mt-5 sm:mt-7 px-2"
          >
            Every message, call, and file is encrypted on your device before
            it leaves it. We can't read your conversations — and neither can
            anyone else.
          </motion.p>

          <motion.div
            {...reveal(0.8)}
            className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 px-4 sm:px-0 max-w-[420px] sm:max-w-none mx-auto"
          >
            <Link
              to="/register"
              className="group relative h-11 px-7 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-sm font-medium inline-flex items-center justify-center transition-all duration-200 active:scale-[0.97] shadow-[0_8px_28px_-8px_rgba(217,119,6,0.7)] hover:shadow-[0_12px_40px_-8px_rgba(217,119,6,0.9)]"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-xl"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(255,255,255,0.24), rgba(255,255,255,0))',
                }}
              />
              <span className="relative">Create account</span>
            </Link>
            <Link
              to="/login"
              className="h-11 px-7 rounded-xl text-sm text-[#A8A29E] hover:text-[#EDE5D4] transition-colors inline-flex items-center justify-center border border-white/[0.08] hover:border-white/[0.16] backdrop-blur-md bg-white/[0.02]"
            >
              Sign in
            </Link>
          </motion.div>

          <motion.div
            {...reveal(0.95)}
            className="mt-9 sm:mt-11 flex items-center justify-center gap-x-5 gap-y-2.5 flex-wrap text-[11.5px] sm:text-[12px] text-[#6B6259] px-4"
          >
            <TrustChip icon={<Lock className="w-3 h-3" />} label="E2E encrypted" />
            <TrustChip icon={<Server className="w-3 h-3" />} label="No data mining" />
            <TrustChip icon={<Eye className="w-3 h-3" />} label="No ads, ever" />
            <TrustChip icon={<Key className="w-3 h-3" />} label="You own your keys" />
          </motion.div>
        </motion.div>

        {!reduceMotion && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.4, duration: 0.6 }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
          >
            <motion.span
              animate={{ y: [0, 6, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              className="w-px h-7 bg-gradient-to-b from-[#D97706]/60 to-transparent"
            />
          </motion.div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════ */}
      {/* ENCRYPTION                                          */}
      {/* ═══════════════════════════════════════════════════ */}
      <section
        id="features"
        ref={encryptionRef}
        className="relative px-5 sm:px-6 py-14 sm:py-20 lg:py-24 bg-[#0F0D0A] overflow-hidden"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[400px] animate-pulse"
          style={{
            background:
              'radial-gradient(ellipse, rgba(217,119,6,0.10) 0%, rgba(217,119,6,0) 70%)',
            filter: 'blur(80px)',
            animationDuration: '12s',
          }}
        />

        <div className="relative max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 sm:gap-12 items-center">
            <motion.div {...inView(0)}>
              <div className="text-[11px] uppercase tracking-[0.32em] text-[#D97706] mb-3">
                Encryption
              </div>
              <h2 className="text-[26px] sm:text-[36px] lg:text-[42px] leading-[1.15] sm:leading-[1.1] tracking-[-0.03em] text-[#EDE5D4]">
                We couldn't read your messages
                <br className="hidden sm:block" />
                {' '}even if we wanted to.
              </h2>
              <p className="mt-4 sm:mt-5 text-[14px] sm:text-[14.5px] text-[#A8A29E] leading-[1.7] max-w-[480px]">
                Encryption happens on your device before anything is sent.
                Keys never touch the server.
              </p>

              <ul className="mt-6 sm:mt-8 space-y-4">
                <EncryptionPoint
                  icon={<Lock className="w-4 h-4" />}
                  title="On-device encryption"
                  body="Messages are encrypted before they leave your browser or app."
                  delay={0.08}
                  reduceMotion={!!reduceMotion}
                />
                <EncryptionPoint
                  icon={<Key className="w-4 h-4" />}
                  title="Keys never leave your control"
                  body="Your encryption keys stay on your device. We store ciphertext."
                  delay={0.14}
                  reduceMotion={!!reduceMotion}
                />
                <EncryptionPoint
                  icon={<Server className="w-4 h-4" />}
                  title="Zero-knowledge infrastructure"
                  body="Servers relay ciphertext. They don't know what's inside."
                  delay={0.2}
                  reduceMotion={!!reduceMotion}
                />
                <EncryptionPoint
                  icon={<Eye className="w-4 h-4" />}
                  title="No tracking, no profiling"
                  body="No ads, no analytics on content, no metadata mining."
                  delay={0.26}
                  reduceMotion={!!reduceMotion}
                />
              </ul>
            </motion.div>

            <motion.div
              {...inView(0.12)}
              className="relative aspect-[4/5] max-h-[520px] rounded-2xl overflow-hidden border border-white/[0.08] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]"
            >
              <motion.img
                src={ENCRYPTION_IMAGE}
                alt="Encrypted data visualization"
                loading="lazy"
                style={{ y: reduceMotion ? 0 : encryptionImgY }}
                className="absolute inset-0 w-full h-[120%] object-cover -top-[10%] will-change-transform"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0F0D0A] via-[#0F0D0A]/40 to-transparent" />

              <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#0F0D0A]/70 backdrop-blur-md border border-white/[0.10]">
                <Lock className="w-3 h-3 text-[#15803D]" />
                <span className="text-[11px] font-mono text-[#EDE5D4]">
                  AES-256 · Verified
                </span>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════ */}
      {/* COMPARISON                                          */}
      {/* ═══════════════════════════════════════════════════ */}
      <section
        id="calling"
        className="relative px-5 sm:px-6 py-14 sm:py-20 lg:py-24 border-t border-white/[0.06] overflow-hidden"
      >
        <div className="relative max-w-6xl mx-auto">
          <motion.div {...inView(0)} className="mb-10 sm:mb-12 text-center">
            <div className="text-[11px] uppercase tracking-[0.32em] text-[#D97706] mb-3">
              Comparison
            </div>
            <h2 className="text-[26px] sm:text-[36px] lg:text-[42px] leading-[1.15] sm:leading-[1.1] tracking-[-0.03em] text-[#EDE5D4]">
              How we compare.
            </h2>
            <p className="mt-3 sm:mt-4 text-[14px] sm:text-[14.5px] text-[#A8A29E] max-w-[560px] mx-auto leading-[1.7]">
              The same convenience you expect, without the trade-offs.
            </p>
          </motion.div>

          <motion.div
            {...inView(0.08)}
            className="rounded-2xl bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] overflow-hidden"
          >
            <div className="hidden md:grid grid-cols-[2fr_1fr_1fr] gap-4 px-6 py-3.5 border-b border-white/[0.06] bg-white/[0.02]">
              <div className="text-[11px] uppercase tracking-[0.24em] text-[#6B6259]">
                Feature
              </div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-[#D97706] text-center">
                Orbital
              </div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-[#6B6259] text-center">
                Typical messengers
              </div>
            </div>

            <ComparisonRow
              label="End-to-end encryption"
              us="Default, always on"
              them="Optional, off by default"
              delay={0}
              reduceMotion={!!reduceMotion}
            />
            <ComparisonRow
              label="Server can read messages"
              us={false}
              them={true}
              delay={0.03}
              reduceMotion={!!reduceMotion}
            />
            <ComparisonRow
              label="Ads or sponsored content"
              us={false}
              them={true}
              delay={0.06}
              reduceMotion={!!reduceMotion}
            />
            <ComparisonRow
              label="Message metadata collected"
              us="None"
              them="Extensive"
              delay={0.09}
              reduceMotion={!!reduceMotion}
            />
            <ComparisonRow
              label="Calls encrypted end-to-end"
              us={true}
              them="Varies"
              delay={0.12}
              reduceMotion={!!reduceMotion}
            />
            <ComparisonRow
              label="Open source"
              us={true}
              them={false}
              delay={0.15}
              reduceMotion={!!reduceMotion}
            />
            <ComparisonRow
              label="Data export anytime"
              us={true}
              them="Limited"
              delay={0.18}
              reduceMotion={!!reduceMotion}
              last
            />
          </motion.div>

          <motion.p
            {...inView(0.24)}
            className="mt-4 sm:mt-5 text-[11.5px] sm:text-[12px] text-[#6B6259] text-center px-2"
          >
            Comparisons reflect the default behavior of mainstream messaging
            apps. Specifics vary by product.
          </motion.p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════ */}
      {/* PRODUCT FEATURES                                    */}
      {/* ═══════════════════════════════════════════════════ */}
      <section
        id="docs"
        className="relative px-5 sm:px-6 py-14 sm:py-20 lg:py-24 border-t border-white/[0.06] overflow-hidden"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 w-[1100px] h-[500px] animate-pulse"
          style={{
            background:
              'radial-gradient(ellipse, rgba(217,119,6,0.09) 0%, rgba(217,119,6,0) 70%)',
            filter: 'blur(100px)',
            animationDuration: '14s',
          }}
        />

        <div className="relative max-w-6xl mx-auto">
          <motion.div {...inView(0)} className="mb-10 sm:mb-12 text-center">
            <div className="text-[11px] uppercase tracking-[0.32em] text-[#D97706] mb-3">
              Product
            </div>
            <h2 className="text-[26px] sm:text-[36px] lg:text-[42px] leading-[1.15] sm:leading-[1.1] tracking-[-0.03em] text-[#EDE5D4]">
              Private messaging that works.
            </h2>
            <p className="mt-3 sm:mt-4 text-[14px] sm:text-[14.5px] text-[#A8A29E] max-w-[520px] mx-auto leading-[1.7]">
              Encryption you don't have to think about, on top of the
              features you actually use.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
            <ProductCard
              image={FEATURE_MESSAGES_IMAGE}
              icon={<MessagesSquare className="w-4 h-4" />}
              title="Direct messages"
              body="One-to-one conversations, encrypted before they leave your device. Read receipts, attachments, instant delivery."
              delay={0}
              reduceMotion={!!reduceMotion}
            />
            <ProductCard
              image={FEATURE_GROUPS_IMAGE}
              icon={<Users className="w-4 h-4" />}
              title="Group chats"
              body="Groups with the same encryption guarantees. Invite by handle, share files, everyone in sync."
              delay={0.06}
              reduceMotion={!!reduceMotion}
            />
            <ProductCard
              image={FEATURE_CALLS_IMAGE}
              icon={<Video className="w-4 h-4" />}
              title="Encrypted calls"
              body="Audio and video calls with end-to-end encrypted streams. One tap to connect, up to four people."
              delay={0.12}
              reduceMotion={!!reduceMotion}
            />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════ */}
      {/* FINAL CTA                                           */}
      {/* ═══════════════════════════════════════════════════ */}
      <section
        ref={ctaRef}
        className="relative px-5 sm:px-6 py-20 sm:py-24 lg:py-28 overflow-hidden"
      >
        <motion.div
          aria-hidden
          style={{ y: reduceMotion ? 0 : ctaBgY }}
          className="absolute inset-0 -z-10 will-change-transform"
        >
          <img
            src={CTA_IMAGE}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-[130%] -top-[15%] object-cover"
          />
        </motion.div>

        <motion.div
          aria-hidden
          style={{ opacity: reduceMotion ? 0.85 : ctaOverlayOpacity }}
          className="absolute inset-0 -z-[9] bg-[#0F0D0A]"
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-[8]"
          style={{
            background:
              'radial-gradient(ellipse at 50% 50%, rgba(217,119,6,0.20), rgba(15,13,10,0.95) 70%)',
          }}
        />

        {!reduceMotion && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full"
            style={{
              background:
                'radial-gradient(ellipse, rgba(217,119,6,0.22) 0%, rgba(217,119,6,0) 70%)',
              filter: 'blur(80px)',
            }}
            animate={{ y: [0, 20, 0], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        <motion.div
          {...inView(0)}
          className="relative max-w-3xl mx-auto text-center"
        >
          <motion.div
            {...inView(0.08)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.05] backdrop-blur-md border border-white/[0.10] mb-6 sm:mb-7"
          >
            <Shield className="w-3 h-3 text-[#D97706]" />
            <span className="text-[10.5px] sm:text-[11px] uppercase tracking-[0.24em] text-[#A8A29E]">
              Your data stays yours
            </span>
          </motion.div>

          <h2 className="text-[30px] sm:text-[44px] lg:text-[56px] leading-[1.08] sm:leading-[1.02] tracking-[-0.04em] text-[#EDE5D4]">
            Start private.
            <br />
            Stay private.
          </h2>
          <p className="mt-4 sm:mt-5 text-[14px] sm:text-[14.5px] text-[#A8A29E] max-w-[440px] mx-auto leading-[1.7] px-2">
            Create your account in under a minute.
            No credit card, no newsletter, no tracking.
          </p>
          <Link
            to="/register"
            className="group relative mt-8 sm:mt-9 inline-flex items-center h-11 px-9 rounded-xl bg-[#D97706] hover:bg-[#B45309] text-[#0F0D0A] text-sm font-medium transition-all duration-200 active:scale-[0.97] shadow-[0_8px_28px_-8px_rgba(217,119,6,0.7)] hover:shadow-[0_12px_40px_-8px_rgba(217,119,6,0.95)]"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-xl"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.24), rgba(255,255,255,0))',
              }}
            />
            <span className="relative">Create account</span>
          </Link>
        </motion.div>
      </section>

      <Footer />
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */

function TrustChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[#6B6259] whitespace-nowrap">
      <span className="text-[#D97706]">{icon}</span>
      {label}
    </span>
  );
}

function EncryptionPoint({
  icon,
  title,
  body,
  delay,
  reduceMotion,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  delay: number;
  reduceMotion: boolean;
}) {
  return (
    <motion.li
      initial={reduceMotion ? false : { opacity: 0, x: -10 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, x: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ ...SPRING, delay }}
      className="flex items-start gap-3.5"
    >
      <div className="w-8 h-8 rounded-lg bg-[#D97706]/12 border border-[#D97706]/20 text-[#D97706] flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div>
        <div className="text-[14px] font-medium text-[#EDE5D4] mb-0.5">
          {title}
        </div>
        <div className="text-[13px] text-[#A8A29E] leading-[1.6]">
          {body}
        </div>
      </div>
    </motion.li>
  );
}

function ComparisonRow({
  label,
  us,
  them,
  delay,
  reduceMotion,
  last = false,
}: {
  label: string;
  us: string | boolean;
  them: string | boolean;
  delay: number;
  reduceMotion: boolean;
  last?: boolean;
}) {
  const renderCell = (value: string | boolean) => {
    if (value === true) {
      return (
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#15803D]/15 text-[#15803D]">
          <Check className="w-4 h-4" strokeWidth={2.5} />
        </span>
      );
    }
    if (value === false) {
      return (
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#B91C1C]/15 text-[#B91C1C]">
          <X className="w-4 h-4" strokeWidth={2.5} />
        </span>
      );
    }
    return (
      <span className="text-[13px] text-[#A8A29E] text-center">{value}</span>
    );
  };

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ ...SPRING, delay }}
      className={`grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr] gap-3 md:gap-4 px-5 sm:px-6 py-4 items-center hover:bg-white/[0.02] transition-colors ${
        last ? '' : 'border-b border-white/[0.06]'
      }`}
    >
      <div className="text-[13.5px] text-[#EDE5D4]">{label}</div>
      <div className="flex md:justify-center items-center gap-2">
        <span className="md:hidden text-[11px] uppercase tracking-[0.16em] text-[#6B6259] w-20 shrink-0">
          Orbital
        </span>
        {renderCell(us)}
      </div>
      <div className="flex md:justify-center items-center gap-2">
        <span className="md:hidden text-[11px] uppercase tracking-[0.16em] text-[#6B6259] w-20 shrink-0">
          Others
        </span>
        {renderCell(them)}
      </div>
    </motion.div>
  );
}

function ProductCard({
  image,
  icon,
  title,
  body,
  delay,
  reduceMotion,
}: {
  image: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  delay: number;
  reduceMotion: boolean;
}) {
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 20 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ ...SPRING, delay }}
      className="group rounded-2xl overflow-hidden bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] hover:border-white/[0.18] hover:bg-white/[0.05] transition-all duration-300"
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <img
          src={image}
          alt={title}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0F0D0A] via-[#0F0D0A]/40 to-transparent" />
        <div className="absolute inset-0 bg-[#0F0D0A]/30 group-hover:bg-[#0F0D0A]/10 transition-colors duration-500" />
      </div>

      <div className="p-5">
        <div className="w-9 h-9 rounded-lg bg-[#D97706]/15 text-[#D97706] flex items-center justify-center mb-3.5">
          {icon}
        </div>
        <h3 className="text-[16.5px] font-medium text-[#EDE5D4] mb-1.5">{title}</h3>
        <p className="text-[13px] text-[#A8A29E] leading-[1.6]">{body}</p>
      </div>
    </motion.div>
  );
}

export default Landing;