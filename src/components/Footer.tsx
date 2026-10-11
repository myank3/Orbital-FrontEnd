/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public footer — dark glass + ambient. Matches the navbar.
 * Legal links open in-page modals (no navigation / no scroll-to-top).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from 'motion/react';
import {
  Check,
  Cookie,
  Copy,
  FileText,
  Mail,
  ShieldCheck,
  X,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────
   Constants
   ───────────────────────────────────────────────────────── */

const CONTACT_EMAIL = 'proelium7@outlook.com';

const SPRING = { type: 'spring' as const, stiffness: 260, damping: 26 };
const SOFT_SPRING = { type: 'spring' as const, stiffness: 180, damping: 22 };

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: SPRING },
};

type FooterLinkDef = { label: string; to: string; internal?: boolean };

const PRODUCT_LINKS: FooterLinkDef[] = [
  { label: 'Features', to: '#features' },
  { label: 'Calling', to: '#calling' },
  { label: 'Docs', to: '#docs' },
];

const ACCOUNT_LINKS: FooterLinkDef[] = [
  { label: 'Sign in', to: '/login', internal: true },
  { label: 'Sign up', to: '/register', internal: true },
];

/* ─────────────────────────────────────────────────────────
   Legal documents (data)
   ───────────────────────────────────────────────────────── */

type LegalSection = {
  heading: string;
  paragraphs?: string[];
  list?: string[];
};

type LegalDoc = {
  key: 'privacy' | 'terms' | 'cookies';
  label: string;
  title: string;
  updated: string;
  icon: React.ReactNode;
  accent: 'green' | 'amber' | 'neutral';
  summary: string;
  sections: LegalSection[];
};

const LEGAL_DOCS: LegalDoc[] = [
  {
    key: 'privacy',
    label: 'Privacy Policy',
    title: 'Privacy Policy',
    updated: 'January 2026',
    icon: <ShieldCheck className="w-3.5 h-3.5 text-[#4ADE80]" />,
    accent: 'green',
    summary: 'How we collect, use, and protect your data.',
    sections: [
      {
        heading: 'What we collect',
        paragraphs: [
          'We collect the minimum data required to run Orbital: your account details (name, handle, email), the messages and media you choose to send, and basic device/usage signals that keep the service secure and reliable.',
        ],
        list: [
          'Account information you provide at sign-up',
          'Messages, calls, and files you send through Orbital',
          'Device and connection metadata used for delivery and abuse prevention',
        ],
      },
      {
        heading: 'How we use it',
        paragraphs: [
          'Your data is used to deliver messages, sync your account across devices, prevent abuse, and improve reliability. We do not sell your personal data.',
        ],
      },
      {
        heading: 'Encryption',
        paragraphs: [
          'Messages and calls are end-to-end encrypted on your device. We cannot read the contents of your conversations, and neither can anyone else in transit.',
        ],
      },
      {
        heading: 'Your controls',
        paragraphs: [
          'You can update your profile, export your data, or delete your account at any time from Settings. Deleting your account removes your messages from our servers.',
        ],
      },
      {
        heading: 'Contact',
        paragraphs: [
          `Questions about privacy? Reach us at ${CONTACT_EMAIL}.`,
        ],
      },
    ],
  },
  {
    key: 'terms',
    label: 'Terms of Service',
    title: 'Terms of Service',
    updated: 'January 2026',
    icon: <FileText className="w-3.5 h-3.5 text-[#D97706]" />,
    accent: 'amber',
    summary: 'The rules for using Orbital.',
    sections: [
      {
        heading: 'Acceptance',
        paragraphs: [
          'By creating an account or using Orbital, you agree to these terms. If you do not agree, please do not use the service.',
        ],
      },
      {
        heading: 'Your account',
        paragraphs: [
          'You are responsible for the activity on your account and for keeping your credentials secure. You must be at least 13 years old to use Orbital.',
        ],
      },
      {
        heading: 'Acceptable use',
        paragraphs: ['You agree not to:'],
        list: [
          'Harass, threaten, or harm other users',
          'Send spam, malware, or illegal content',
          'Attempt to reverse-engineer or disrupt the service',
          'Impersonate others or misrepresent your identity',
        ],
      },
      {
        heading: 'Content',
        paragraphs: [
          'You own the content you send. You grant us a limited license to transmit and store it solely to operate the service. We do not claim ownership of your messages.',
        ],
      },
      {
        heading: 'Termination',
        paragraphs: [
          'You may stop using Orbital at any time. We may suspend accounts that violate these terms or pose a risk to other users.',
        ],
      },
      {
        heading: 'Contact',
        paragraphs: [
          `Questions about these terms? Reach us at ${CONTACT_EMAIL}.`,
        ],
      },
    ],
  },
  {
    key: 'cookies',
    label: 'Cookie Preferences',
    title: 'Cookie Preferences',
    updated: 'January 2026',
    icon: <Cookie className="w-3.5 h-3.5 text-[#A8A29E]" />,
    accent: 'neutral',
    summary: 'Manage how we use cookies.',
    sections: [
      {
        heading: 'What we use',
        paragraphs: [
          'Orbital uses a small number of cookies and local storage keys. Only the essential ones are enabled by default.',
        ],
        list: [
          'Essential — session, auth, and security (always on)',
          'Preferences — theme and language (optional)',
          'Analytics — anonymized usage signals (optional)',
        ],
      },
      {
        heading: 'Managing cookies',
        paragraphs: [
          'You can clear or block cookies from your browser settings at any time. Disabling essential cookies may break sign-in and messaging.',
        ],
      },
    ],
  },
];

const LEGAL_BY_KEY = Object.fromEntries(
  LEGAL_DOCS.map((d) => [d.key, d]),
) as Record<LegalDoc['key'], LegalDoc>;

/* ─────────────────────────────────────────────────────────
   Footer
   ───────────────────────────────────────────────────────── */

export function Footer() {
  const year = new Date().getFullYear();
  const reduceMotion = useReducedMotion();

  const [openDoc, setOpenDoc] = useState<LegalDoc['key'] | null>(null);

  return (
    <footer className="relative border-t border-white/[0.06] bg-[#0F0D0A]">
      {/* Ambient blob — slow drift */}
      <motion.div
        aria-hidden
        initial={false}
        animate={
          reduceMotion
            ? undefined
            : { opacity: [0.7, 1, 0.7], scale: [1, 1.06, 1] }
        }
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none absolute -bottom-32 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(217,119,6,0.10) 0%, rgba(217,119,6,0) 70%)',
          filter: 'blur(80px)',
        }}
      />

      {/* Top glass line */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(255,255,255,0.10) 20%, rgba(255,255,255,0.10) 80%, transparent)',
        }}
      />

      <div className="relative max-w-6xl mx-auto px-6 py-14">
        <motion.div
          variants={listVariants}
          initial={reduceMotion ? false : 'hidden'}
          whileInView="show"
          viewport={{ once: true, amount: 0.15 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-12"
        >
          {/* Brand column */}
          <motion.div
            variants={itemVariants}
            className="col-span-2 md:col-span-1"
          >
            <Brand />
            <p className="text-[13px] text-[#A8A29E] leading-[1.7] max-w-[260px] mt-4">
              Real-time messaging, group chats, and HD calls.
            </p>

            <ContactPill />
          </motion.div>

          {/* Product */}
          <motion.div variants={itemVariants}>
            <FooterColumn title="Product" links={PRODUCT_LINKS} />
          </motion.div>

          {/* Account */}
          <motion.div variants={itemVariants}>
            <FooterColumn title="Account" links={ACCOUNT_LINKS} />
          </motion.div>

          {/* Legal — opens modals */}
          <motion.div variants={itemVariants}>
            <LegalColumn onOpen={setOpenDoc} />
          </motion.div>
        </motion.div>

        {/* Legal strip */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ ...SOFT_SPRING, delay: 0.3 }}
          className="pt-6 border-t border-white/[0.06] flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-[#6B6259]"
        >
          {LEGAL_DOCS.map((item) => (
            <button
              key={`strip-${item.key}`}
              type="button"
              onClick={() => setOpenDoc(item.key)}
              className="hover:text-[#EDE5D4] transition-colors"
            >
              {item.label}
            </button>
          ))}
        </motion.div>

        {/* Bottom row */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ ...SOFT_SPRING, delay: 0.4 }}
          className="pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
        >
          <div className="text-[12px] text-[#6B6259]">
            © {year} Orbital. All rights reserved.
          </div>

          <StatusBadge />
        </motion.div>
      </div>

      {/* Legal modals */}
      <LegalModal
        doc={openDoc ? LEGAL_BY_KEY[openDoc] : null}
        onClose={() => setOpenDoc(null)}
      />
    </footer>
  );
}

/* ─────────────────────────────────────────────────────────
   Subcomponents
   ───────────────────────────────────────────────────────── */

function Brand() {
  return (
    <Link
      to="/"
      className="inline-flex items-baseline gap-2 select-none"
      aria-label="Orbital home"
    >
      <span
        className="text-[20px] leading-none text-[#EDE5D4] tracking-tight"
        style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
      >
        Orbital
      </span>
      <span
        aria-hidden
        className="w-1.5 h-1.5 rounded-full bg-[#D97706] inline-block translate-y-[-2px] shadow-[0_0_10px_rgba(217,119,6,0.6)]"
      />
    </Link>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: FooterLinkDef[];
}) {
  return (
    <nav aria-label={title}>
      <h3 className="text-[11px] uppercase tracking-[0.24em] text-[#D97706] mb-4 font-medium">
        {title}
      </h3>
      <ul className="space-y-2.5">
        {links.map((l) => (
          <FooterLink key={l.label} {...l} />
        ))}
      </ul>
    </nav>
  );
}

function FooterLink({ to, label, internal = false }: FooterLinkDef) {
  const reduceMotion = useReducedMotion();
  const className =
    'inline-block text-[13px] text-[#A8A29E] hover:text-[#EDE5D4] transition-colors';

  const content = internal ? (
    <Link to={to} className={className}>
      {label}
    </Link>
  ) : (
    <a href={to} className={className}>
      {label}
    </a>
  );

  return (
    <motion.li
      whileHover={reduceMotion ? undefined : { x: 3 }}
      transition={SOFT_SPRING}
    >
      {content}
    </motion.li>
  );
}

/* ─────────────────────────────────────────────────────────
   Legal column
   ───────────────────────────────────────────────────────── */

function LegalColumn({
  onOpen,
}: {
  onOpen: (key: LegalDoc['key']) => void;
}) {
  return (
    <nav aria-label="Legal">
      <h3 className="text-[11px] uppercase tracking-[0.24em] text-[#D97706] mb-4 font-medium">
        Legal
      </h3>
      <ul className="space-y-3.5">
        {LEGAL_DOCS.map((doc) => (
          <LegalLink key={doc.key} doc={doc} onOpen={onOpen} />
        ))}
      </ul>
    </nav>
  );
}

function LegalLink({
  doc,
  onOpen,
}: {
  doc: LegalDoc;
  onOpen: (key: LegalDoc['key']) => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(doc.key)}
        className="text-left w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/50 rounded-md"
      >
        <motion.div
          initial="rest"
          whileHover="hover"
          animate="rest"
          className="group flex items-start gap-2.5 max-w-[220px]"
        >
          <motion.span
            variants={
              reduceMotion ? undefined : { rest: { x: 0 }, hover: { x: 2 } }
            }
            transition={SOFT_SPRING}
            className="mt-0.5 shrink-0"
          >
            {doc.icon}
          </motion.span>
          <div className="min-w-0">
            <div className="text-[13px] text-[#EDE5D4] group-hover:text-[#D97706] transition-colors">
              {doc.label}
            </div>
            <p className="text-[11.5px] text-[#6B6259] mt-0.5 leading-snug">
              {doc.summary}
            </p>
          </div>
        </motion.div>
      </button>
    </li>
  );
}

/* ─────────────────────────────────────────────────────────
   Legal modal
   ───────────────────────────────────────────────────────── */

function LegalModal({
  doc,
  onClose,
}: {
  doc: LegalDoc | null;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // ESC + scroll lock while open
  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus close button for keyboard users
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 50);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
  }, [doc, onClose]);

  const accentClass = useMemo(() => {
    if (!doc) return 'from-transparent';
    switch (doc.accent) {
      case 'green':
        return 'from-[#15803D]/40 via-[#15803D]/10 to-transparent';
      case 'amber':
        return 'from-[#D97706]/40 via-[#D97706]/10 to-transparent';
      default:
        return 'from-white/[0.15] via-white/[0.05] to-transparent';
    }
  }, [doc]);

  return (
    <AnimatePresence>
      {doc && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="legal-modal-title"
        >
          <motion.div
            initial={
              reduceMotion
                ? false
                : { opacity: 0, y: 24, scale: 0.98 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              reduceMotion
                ? undefined
                : { opacity: 0, y: 24, scale: 0.98 }
            }
            transition={SPRING}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full sm:max-w-2xl max-h-[90vh] sm:max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-[#131110] ring-1 ring-inset ring-white/[0.10] overflow-hidden shadow-2xl shadow-black/50"
          >
            {/* Accent gradient at top */}
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${accentClass}`}
            />

            {/* Header */}
            <header className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-white/[0.06]">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-white/[0.04] ring-1 ring-inset ring-white/[0.06]">
                    {doc.icon}
                  </span>
                  <h2
                    id="legal-modal-title"
                    className="text-[15px] font-medium text-[#EDE5D4] truncate"
                  >
                    {doc.title}
                  </h2>
                </div>
                <p className="text-[11.5px] text-[#6B6259] mt-1.5">
                  Last updated · {doc.updated}
                </p>
              </div>

              <motion.button
                ref={closeBtnRef}
                type="button"
                onClick={onClose}
                whileHover={reduceMotion ? undefined : { rotate: 90 }}
                whileTap={reduceMotion ? undefined : { scale: 0.9 }}
                transition={SOFT_SPRING}
                aria-label="Close"
                className="shrink-0 w-8 h-8 rounded-lg grid place-items-center text-[#6B6259] hover:text-[#EDE5D4] hover:bg-white/[0.05] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/60"
              >
                <X className="w-4 h-4" />
              </motion.button>
            </header>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 legal-scroll">
              <LegalBody doc={doc} />
            </div>

            {/* Footer */}
            <footer className="px-5 sm:px-6 py-3.5 border-t border-white/[0.06] bg-[#0F0D0A]/40 flex items-center justify-between gap-3">
              <span className="text-[11.5px] text-[#6B6259]">
                Orbital · Private &amp; Direct
              </span>
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-4 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] ring-1 ring-inset ring-white/[0.06] text-[12.5px] text-[#EDE5D4] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/60"
              >
                Close
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function LegalBody({ doc }: { doc: LegalDoc }) {
  return (
    <div className="space-y-7 max-w-[65ch]">
      {doc.sections.map((section, i) => (
        <motion.section
          key={section.heading}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.04 * i, ...SOFT_SPRING }}
        >
          <h3 className="text-[12px] uppercase tracking-[0.18em] text-[#D97706] font-medium mb-2.5">
            {section.heading}
          </h3>

          {section.paragraphs?.map((p, j) => (
            <p
              key={j}
              className="text-[13.5px] leading-[1.75] text-[#C9C1B3] mb-2.5 last:mb-0"
            >
              {p}
            </p>
          ))}

          {section.list && (
            <ul className="mt-2 space-y-1.5">
              {section.list.map((item, j) => (
                <li
                  key={j}
                  className="flex items-start gap-2.5 text-[13.5px] leading-[1.7] text-[#C9C1B3]"
                >
                  <span className="mt-[9px] w-1 h-1 rounded-full bg-[#D97706]/70 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </motion.section>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Contact + status
   ───────────────────────────────────────────────────────── */

function ContactPill() {
  const reduceMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  return (
    <div className="mt-5 space-y-2.5">
      <div className="text-[11px] uppercase tracking-[0.24em] text-[#D97706] font-medium">
        Contact
      </div>

      <div className="inline-flex items-center gap-1 rounded-full bg-white/[0.035] ring-1 ring-inset ring-white/[0.07] pl-2.5 pr-1 py-1 hover:ring-white/[0.14] transition-shadow">
        <Mail className="w-3.5 h-3.5 text-[#6B6259] shrink-0" />
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="text-[12.5px] text-[#EDE5D4] hover:text-[#D97706] transition-colors truncate max-w-[180px]"
          title={CONTACT_EMAIL}
        >
          {CONTACT_EMAIL}
        </a>

        <motion.button
          type="button"
          onClick={copy}
          whileTap={reduceMotion ? undefined : { scale: 0.9 }}
          aria-label="Copy email address"
          title="Copy email"
          className="ml-0.5 w-6 h-6 rounded-full grid place-items-center text-[#6B6259] hover:text-[#EDE5D4] hover:bg-white/[0.06] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/60"
        >
          <AnimatePresence mode="wait" initial={false}>
            {copied ? (
              <motion.span
                key="check"
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={SPRING}
                className="inline-block"
              >
                <Check className="w-3.5 h-3.5 text-[#4ADE80]" />
              </motion.span>
            ) : (
              <motion.span
                key="copy"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.14 }}
                className="inline-block"
              >
                <Copy className="w-3 h-3" />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      </div>
    </div>
  );
}

function StatusBadge() {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      whileHover={reduceMotion ? undefined : { y: -1 }}
      transition={SOFT_SPRING}
      className="inline-flex items-center gap-2 text-[12px] text-[#A8A29E] rounded-full bg-white/[0.025] ring-1 ring-inset ring-white/[0.06] px-3 py-1.5"
    >
      <span className="relative flex w-1.5 h-1.5">
        <span className="absolute inline-flex w-full h-full rounded-full bg-[#15803D] opacity-75 animate-ping" />
        <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-[#15803D]" />
      </span>
      <span>Made by Mayank Pal</span>
    </motion.div>
  );
}

export default Footer;