/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  AtSign,
  Check,
  Clock,
  KeyRound,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
  WifiOff,
  Zap,
  X,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { AuthInput } from '../components/AuthInput';
import { AuthButton } from '../components/AuthButton';
import { API_BASE_URL, extractErrorMessage } from '../services/api';

const SPRING = { type: 'spring' as const, stiffness: 240, damping: 26 };
const SOFT_SPRING = { type: 'spring' as const, stiffness: 180, damping: 22 };

/* ─────────────────────────────────────────────────────────
   Types + validation
   ───────────────────────────────────────────────────────── */

type FieldKey = 'displayName' | 'handle' | 'email' | 'password' | 'confirm';
type FieldErrors = Partial<Record<FieldKey, string>>;

type AuthError = {
  kind: 'validation' | 'conflict' | 'rate-limited' | 'network' | 'server' | 'unknown';
  message: string;
};

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(values: {
  displayName: string;
  handle: string;
  email: string;
  password: string;
  confirm: string;
}): FieldErrors {
  const errs: FieldErrors = {};

  const name = values.displayName.trim();
  if (!name) errs.displayName = 'Enter a display name.';
  else if (name.length < 2) errs.displayName = 'At least 2 characters.';
  else if (name.length > 40) errs.displayName = 'Keep it under 40 characters.';

  const h = values.handle.trim().toLowerCase();
  if (!h) errs.handle = 'Pick a handle.';
  else if (!HANDLE_RE.test(h)) errs.handle = '3–20 lowercase letters, numbers, or _.';

  const email = values.email.trim();
  if (!email) errs.email = 'Email is required.';
  else if (!EMAIL_RE.test(email)) errs.email = 'Enter a valid email.';

  if (!values.password) errs.password = 'Create a password.';
  else if (values.password.length < 8) errs.password = 'At least 8 characters.';

  if (!values.confirm) errs.confirm = 'Confirm your password.';
  else if (values.confirm !== values.password) errs.confirm = 'Passwords don’t match.';

  return errs;
}

/* ─────────────────────────────────────────────────────────
   Password strength
   ───────────────────────────────────────────────────────── */

function scorePassword(pw: string) {
  if (pw.length < 8) return { score: 0 as 0 | 1 | 2 | 3 | 4, label: 'Too short' };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const score = Math.min(s, 4) as 0 | 1 | 2 | 3 | 4;
  const label = score <= 1 ? 'Weak' : score === 2 ? 'Fair' : score === 3 ? 'Good' : 'Strong';
  return { score, label };
}

/* ─────────────────────────────────────────────────────────
   Error classifier
   ───────────────────────────────────────────────────────── */

function classify(raw: string, status?: number): AuthError['kind'] {
  const m = raw.toLowerCase();
  if (status === 409 || m.includes('already') || m.includes('taken')) return 'conflict';
  if (status === 429 || m.includes('too many')) return 'rate-limited';
  if (status && status >= 500) return 'server';
  if (m.includes('network') || m.includes('failed to fetch') || m.includes('timeout'))
    return 'network';
  if (status === 400) return 'validation';
  return 'unknown';
}

function toAuthError(err: unknown, fallback: string): AuthError {
  const status = (() => {
    if (typeof err === 'object' && err !== null) {
      const e = err as { status?: number; response?: { status?: number } };
      return e.status ?? e.response?.status;
    }
    return undefined;
  })();
  const raw = extractErrorMessage(err, fallback);
  return { kind: classify(raw, status), message: raw };
}

/* ─────────────────────────────────────────────────────────
   Compact password strength bar (inline)
   ───────────────────────────────────────────────────────── */

function StrengthBar({ value }: { value: string }) {
  const { score, label } = useMemo(() => scorePassword(value), [value]);
  const reduceMotion = useReducedMotion();
  if (!value) return null;

  const colors = [
    'bg-[#B91C1C]',
    'bg-[#B91C1C]',
    'bg-[#D97706]',
    'bg-[#CA8A04]',
    'bg-[#15803D]',
  ];
  const text = [
    'text-[#F87171]',
    'text-[#F87171]',
    'text-[#FBBF24]',
    'text-[#FACC15]',
    'text-[#4ADE80]',
  ];

  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="flex gap-1 flex-1">
        {[0, 1, 2, 3].map((i) => (
          <motion.div
            key={i}
            initial={false}
            animate={{ opacity: i < score ? 1 : 0.35 }}
            transition={reduceMotion ? { duration: 0 } : SOFT_SPRING}
            className={`h-1 flex-1 rounded-full ${
              i < score ? colors[score] : 'bg-white/[0.08]'
            }`}
          />
        ))}
      </div>
      <span className={`text-[10.5px] font-mono ${text[score]} tabular-nums`}>
        {label}
      </span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Error banner (compact)
   ───────────────────────────────────────────────────────── */

function ErrorBanner({
  error,
  onRetry,
  retryCountdown,
}: {
  error: AuthError;
  onRetry: () => void;
  retryCountdown: number | null;
}) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
  }, [error.kind, error.message]);

  const { icon, tone, title, hint } = useMemo(() => {
    switch (error.kind) {
      case 'conflict':
        return {
          icon: <AlertTriangle className="w-3.5 h-3.5" />,
          tone: 'amber' as const,
          title: 'Already in use',
          hint: error.message,
        };
      case 'rate-limited':
        return {
          icon: <Clock className="w-3.5 h-3.5" />,
          tone: 'amber' as const,
          title: 'Too many attempts',
          hint: retryCountdown ? `Try again in ${retryCountdown}s.` : 'Please wait.',
        };
      case 'network':
        return {
          icon: <WifiOff className="w-3.5 h-3.5" />,
          tone: 'neutral' as const,
          title: 'Connection problem',
          hint: 'Check your internet and retry.',
        };
      case 'server':
        return {
          icon: <AlertCircle className="w-3.5 h-3.5" />,
          tone: 'red' as const,
          title: 'Server error',
          hint: 'Try again shortly.',
        };
      default:
        return {
          icon: <AlertCircle className="w-3.5 h-3.5" />,
          tone: 'red' as const,
          title: 'Registration failed',
          hint: error.message,
        };
    }
  }, [error, retryCountdown]);

  const tones = {
    red: 'bg-[#B91C1C]/10 border-[#B91C1C]/25 text-[#F87171]',
    amber: 'bg-[#D97706]/10 border-[#D97706]/25 text-[#FBBF24]',
    neutral: 'bg-white/[0.03] border-white/[0.08] text-[#C9C1B3]',
  } as const;

  return (
    <motion.div
      ref={ref}
      tabIndex={-1}
      role="alert"
      initial={reduceMotion ? false : { opacity: 0, y: -4, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, height: 0 }}
      transition={SOFT_SPRING}
      className={`overflow-hidden rounded-lg border px-3 py-2 text-[12px] ${tones[tone]}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-[1px] shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <span className="font-medium">{title}.</span>{' '}
          <span className="opacity-90">{hint}</span>
          {error.kind === 'network' && (
            <button
              type="button"
              onClick={onRetry}
              className="ml-1.5 inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────
   Left panel — brand + benefits
   ───────────────────────────────────────────────────────── */

const BENEFITS = [
  {
    icon: <ShieldCheck className="w-4 h-4" />,
    title: 'End-to-end encrypted',
    body: 'Messages and calls stay private to you.',
  },
  {
    icon: <Zap className="w-4 h-4" />,
    title: 'Real-time everything',
    body: 'Group chats and HD calls, instantly.',
  },
  {
    icon: <Sparkles className="w-4 h-4" />,
    title: 'No ads. Ever.',
    body: 'We don’t sell your data. That’s the promise.',
  },
];

function BrandPanel() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="hidden lg:flex flex-col justify-between p-10 xl:p-12 bg-gradient-to-br from-[#151210] to-[#0F0D0A] border-r border-white/[0.06]">
      {/* Ambient blob */}
      <motion.div
        aria-hidden
        animate={
          reduceMotion ? undefined : { opacity: [0.6, 1, 0.6], scale: [1, 1.08, 1] }
        }
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none absolute -top-40 -left-20 w-[500px] h-[500px] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(217,119,6,0.14) 0%, rgba(217,119,6,0) 70%)',
          filter: 'blur(80px)',
        }}
      />

      <div className="relative">
        {/* Wordmark */}
        <Link to="/" className="inline-flex items-baseline gap-2 select-none">
          <span
            className="text-[26px] leading-none text-[#EDE5D4] tracking-tight"
            style={{ fontFamily: '"Instrument Serif", Georgia, serif' }}
          >
            Orbital
          </span>
          <span
            aria-hidden
            className="w-1.5 h-1.5 rounded-full bg-[#D97706] inline-block translate-y-[-3px] shadow-[0_0_10px_rgba(217,119,6,0.6)]"
          />
        </Link>

        <p className="mt-3 text-[13px] text-[#A8A29E] max-w-[280px] leading-relaxed">
          Private conversations, on your terms.
        </p>
      </div>

      <div className="relative space-y-5 my-8">
        {BENEFITS.map((b, i) => (
          <motion.div
            key={b.title}
            initial={reduceMotion ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...SOFT_SPRING, delay: 0.1 + i * 0.08 }}
            className="flex items-start gap-3"
          >
            <span className="w-8 h-8 rounded-lg bg-[#D97706]/10 ring-1 ring-inset ring-[#D97706]/20 text-[#D97706] grid place-items-center shrink-0">
              {b.icon}
            </span>
            <div className="min-w-0">
              <div className="text-[13.5px] text-[#EDE5D4] font-medium">
                {b.title}
              </div>
              <div className="text-[12px] text-[#78716C] mt-0.5 leading-relaxed">
                {b.body}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <p className="relative text-[11.5px] text-[#6B6259]">
        © {new Date().getFullYear()} Orbital · Private &amp; Direct
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Register
   ───────────────────────────────────────────────────────── */

function Register(): React.JSX.Element {
  const navigate = useNavigate();
  const { register } = useAuth();
  const reduceMotion = useReducedMotion();

  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);

  const nameRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const emailRef = useRef<HTMLDivElement | null>(null);
  const passwordRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLDivElement | null>(null);

  // Rate-limit countdown
  useEffect(() => {
    if (retryCountdown == null) return;
    if (retryCountdown <= 0) {
      setRetryCountdown(null);
      setError((e) => (e?.kind === 'rate-limited' ? null : e));
      return;
    }
    const t = window.setTimeout(
      () => setRetryCountdown((n) => (n == null ? null : n - 1)),
      1000,
    );
    return () => window.clearTimeout(t);
  }, [retryCountdown]);

  const focusField = useCallback((key: FieldKey) => {
    const refs: Record<FieldKey, React.RefObject<HTMLDivElement | null>> = {
      displayName: nameRef,
      handle: handleRef,
      email: emailRef,
      password: passwordRef,
      confirm: confirmRef,
    };
    refs[key]?.current?.querySelector('input')?.focus();
  }, []);

  const focusFirstError = useCallback(
    (errs: FieldErrors) => {
      const order: FieldKey[] = ['displayName', 'handle', 'email', 'password', 'confirm'];
      const first = order.find((k) => errs[k]);
      if (first) focusField(first);
    },
    [focusField],
  );

  const doRegister = useCallback(async () => {
    if (loading) return;

    const errs = validate({ displayName, handle, email, password, confirm });
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setError(null);
      focusFirstError(errs);
      return;
    }
    if (!consent) {
      setConsentError('Please accept the Terms and Privacy Policy to continue.');
      return;
    }
    setConsentError(null);
    setLoading(true);
    setError(null);
    setFieldErrors({});
    setRetryCountdown(null);

    try {
      await register({
        displayName: displayName.trim(),
        userHandle: handle.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        password,
      });
      navigate(
        `/confirm-email-pending?email=${encodeURIComponent(email.trim().toLowerCase())}`,
      );
    } catch (err) {
      const authErr = toAuthError(err, 'Registration failed.');
      const m = authErr.message.toLowerCase();
      if (authErr.kind === 'conflict') {
        if (m.includes('handle')) setFieldErrors({ handle: authErr.message });
        else if (m.includes('email')) setFieldErrors({ email: authErr.message });
        else setError(authErr);
      } else {
        setError(authErr);
      }
      if (authErr.kind === 'rate-limited') setRetryCountdown(30);
    } finally {
      setLoading(false);
    }
  }, [
    displayName,
    handle,
    email,
    password,
    confirm,
    consent,
    loading,
    register,
    navigate,
    focusFirstError,
  ]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void doRegister();
  };

  const handleGoogleSignup = () => {
  window.location.href = `${API_BASE_URL.replace(/\/+$/, '')}/api/Auth/google-login?prompt=select_account`;};

  const clearField = (key: FieldKey) => {
    if (fieldErrors[key]) setFieldErrors((f) => ({ ...f, [key]: undefined }));
  };

  const stagger = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0 },
          transition: { ...SPRING, delay },
        };

  return (
    <div className="min-h-screen bg-[#0F0D0A] text-[#EDE5D4] flex items-center justify-center p-4 lg:p-6">
      {/* Card */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="relative w-full max-w-[1100px] grid lg:grid-cols-[420px_1fr] rounded-2xl overflow-hidden bg-[#131110] ring-1 ring-inset ring-white/[0.08] shadow-2xl shadow-black/50"
      >
        {/* Left panel (lg+) */}
        <BrandPanel />

        {/* Right: form */}
        <div className="relative p-6 sm:p-8 lg:p-10">
          {/* Header */}
          <motion.div {...stagger(0)}>
            <h1 className="text-[22px] sm:text-[24px] font-medium tracking-[-0.01em] text-[#EDE5D4]">
              Create account
            </h1>
            <p className="text-[12.5px] text-[#A8A29E] mt-1">
              A few details and you’re in.
            </p>
          </motion.div>

          <div className="mt-5 space-y-3.5">
            {/* Google */}
            <motion.div {...stagger(0.04)}>
              <button
                type="button"
                onClick={handleGoogleSignup}
                disabled={loading}
                className="w-full h-10 rounded-lg bg-white text-[#0F0D0A] hover:bg-[#F2EDE3] text-[13px] font-medium inline-flex items-center justify-center gap-2.5 transition-all duration-200 active:scale-[0.98] shadow-[0_6px_20px_-8px_rgba(0,0,0,0.5)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <GoogleIcon />
                <span>Continue with Google</span>
              </button>
            </motion.div>

            {/* Divider */}
            <motion.div {...stagger(0.08)} className="relative">
              <div className="absolute inset-0 flex items-center" aria-hidden>
                <div className="w-full border-t border-white/[0.08]" />
              </div>
              <div className="relative flex justify-center">
                <span className="px-3 text-[10px] uppercase tracking-[0.24em] text-[#6B6259] bg-[#131110]">
                  or
                </span>
              </div>
            </motion.div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-3" noValidate>
              {/* Row 1: Name + Handle */}
              <div className="grid sm:grid-cols-2 gap-3">
                <motion.div {...stagger(0.12)} ref={nameRef}>
                  <AuthInput
                    id="reg-name"
                    label="Display name"
                    value={displayName}
                    onChange={(e) => {
                      setDisplayName(e.target.value);
                      clearField('displayName');
                    }}
                    placeholder="John Doe"
                    required
                    autoComplete="name"
                    icon={<UserIcon className="w-4 h-4" />}
                    error={fieldErrors.displayName}
                    maxLength={40}
                  />
                </motion.div>

                <motion.div {...stagger(0.16)} ref={handleRef}>
                  <AuthInput
                    id="reg-handle"
                    label="Handle"
                    value={handle}
                    onChange={(e) => {
                      const v = e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, '')
                        .slice(0, 20);
                      setHandle(v);
                      clearField('handle');
                    }}
                    placeholder="elena"
                    required
                    autoComplete="username"
                    icon={<AtSign className="w-4 h-4" />}
                    trailingTag={handle ? '@orbit' : undefined}
                    error={fieldErrors.handle}
                    hint={!fieldErrors.handle ? 'Your unique ID on Orbit.' : undefined}
                  />
                </motion.div>
              </div>

              {/* Row 2: Email (full) */}
              <motion.div {...stagger(0.2)} ref={emailRef}>
                <AuthInput
                  id="reg-email"
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearField('email');
                  }}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  icon={<Mail className="w-4 h-4" />}
                  error={fieldErrors.email}
                  hint={!fieldErrors.email ? 'We’ll send a verification link.' : undefined}
                />
              </motion.div>

              {/* Row 3: Password + Confirm */}
              <div className="grid sm:grid-cols-2 gap-3">
                <motion.div {...stagger(0.24)} ref={passwordRef}>
                  <AuthInput
                    id="reg-password"
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      clearField('password');
                      if (confirm) clearField('confirm');
                    }}
                    placeholder="At least 8 chars"
                    required
                    autoComplete="new-password"
                    icon={<KeyRound className="w-4 h-4" />}
                    error={fieldErrors.password}
                  />
                  <StrengthBar value={password} />
                </motion.div>

                <motion.div {...stagger(0.28)} ref={confirmRef}>
                  <AuthInput
                    id="reg-confirm"
                    label="Confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => {
                      setConfirm(e.target.value);
                      clearField('confirm');
                    }}
                    placeholder="Repeat password"
                    required
                    autoComplete="new-password"
                    icon={<Lock className="w-4 h-4" />}
                    error={fieldErrors.confirm}
                  />
                  <AnimatePresence initial={false}>
                    {confirm && !fieldErrors.confirm && (
                      <motion.div
                        key="match"
                        initial={{ opacity: 0, y: -3 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={SOFT_SPRING}
                        className="mt-1.5 flex items-center gap-1.5 text-[10.5px] font-mono"
                        aria-live="polite"
                      >
                        {password === confirm ? (
                          <span className="inline-flex items-center gap-1.5 text-[#4ADE80]">
                            <Check className="w-3 h-3" />
                            Match
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[#F87171]">
                            <X className="w-3 h-3" />
                            Doesn’t match yet
                          </span>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </div>

              {/* Consent */}
              <motion.div {...stagger(0.32)} className="flex items-start gap-2.5 pt-1">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={consent}
                  onClick={() => {
                    setConsent((v) => !v);
                    if (consentError) setConsentError(null);
                  }}
                  className={`mt-0.5 w-4 h-4 rounded border-[1.5px] shrink-0 grid place-items-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B45309]/50 ${
                    consent
                      ? 'bg-[#B45309] border-[#B45309]'
                      : 'bg-transparent border-[rgba(237,229,212,0.25)] hover:border-[rgba(237,229,212,0.4)]'
                  }`}
                >
                  <AnimatePresence initial={false}>
                    {consent && (
                      <motion.span
                        initial={{ scale: 0.4, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.4, opacity: 0 }}
                        transition={SPRING}
                        className="grid place-items-center"
                      >
                        <Check className="w-3 h-3 text-white" strokeWidth={3} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>

                <label className="text-[11.5px] text-[#A8A29E] leading-snug cursor-pointer select-none">
                  I agree to the{' '}
                  <Link
                    to="/terms"
                    className="text-[#D97706] hover:text-[#B45309] transition-colors"
                  >
                    Terms
                  </Link>{' '}
                  and{' '}
                  <Link
                    to="/privacy"
                    className="text-[#D97706] hover:text-[#B45309] transition-colors"
                  >
                    Privacy Policy
                  </Link>
                  .
                </label>
              </motion.div>

              <AnimatePresence initial={false}>
                {consentError && (
                  <motion.p
                    key="consent-err"
                    role="alert"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={SOFT_SPRING}
                    className="overflow-hidden text-[11px] text-[#F87171] font-mono flex items-center gap-1.5"
                  >
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {consentError}
                  </motion.p>
                )}
              </AnimatePresence>

              <AnimatePresence initial={false}>
                {error && (
                  <ErrorBanner
                    key={`${error.kind}-${error.message}`}
                    error={error}
                    onRetry={() => void doRegister()}
                    retryCountdown={retryCountdown}
                  />
                )}
              </AnimatePresence>

              <motion.div {...stagger(0.36)} className="pt-1">
                <AuthButton type="submit" loading={loading} variant="primary">
                  {retryCountdown
                    ? `Try again in ${retryCountdown}s`
                    : 'Create account'}
                </AuthButton>
              </motion.div>
            </form>

            {/* Footer links */}
            <motion.div
              {...stagger(0.4)}
              className="pt-4 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[12px] text-[#A8A29E]"
            >
              <span>
                Already have an account?{' '}
                <Link
                  to="/login"
                  className="text-[#D97706] hover:text-[#B45309] font-medium transition-colors"
                >
                  Sign in
                </Link>
              </span>
              <Link
                to="/confirm-email-pending"
                className="text-[#6B6259] hover:text-[#D97706] transition-colors"
              >
                Resend verification
              </Link>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── */

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export default Register;