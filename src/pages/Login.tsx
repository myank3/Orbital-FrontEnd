/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Login — v2 · ultra-fast pass
 *
 * ⚡ deltas vs previous:
 *   · FRAMER MOTION REMOVED ENTIRELY — no `motion`, no `AnimatePresence`,
 *     no spring solver, no per-component subscription. All entrance and
 *     exit animations are CSS keyframes on transform/opacity only.
 *   · ERROR BANNER IS PURE CSS — grid-template-rows collapse (0fr → 1fr)
 *     instead of animating `height: auto`, which forced a reflow every
 *     frame. Now the compositor drives it.
 *   · NO LAYOUT-THREATENING ANIMATIONS — never animates height, width,
 *     top, left, margin, or padding. Only transform / opacity / grid rows.
 *   · HOISTED REGEX + STYLE CONSTANTS — no new RegExp objects or string
 *     concats per keystroke / per render.
 *   · MEMOIZED — ErrorBanner, GoogleIcon, and the change handlers are
 *     memoized so typing only re-renders the fields that actually change.
 *   · SCRUBBED: useReducedMotion JS hook → CSS @media query.
 */

import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  AtSign,
  Clock,
  KeyRound,
  Lock,
  MailWarning,
  RefreshCw,
  ShieldAlert,
  WifiOff,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { AuthShell } from '../components/AuthShell';
import { AuthInput } from '../components/AuthInput';
import { AuthButton } from '../components/AuthButton';
import { API_BASE_URL, extractErrorMessage } from '../services/api';

/* ═══════════════════════════════════════════════════════════
   CONSTANTS — hoisted so nothing is created per render
   ═══════════════════════════════════════════════════════════ */

type IdentifierMode = 'handle' | 'email' | 'unknown';
const HANDLE_DOMAIN = 'orbit';

/* Compiled once — reused on every keystroke. */
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_HANDLE_BARE = /^[a-z0-9_.-]{2,32}$/;
const RE_HANDLE_LOOSE = /^[a-z0-9_.-]{2,}$/;
const RE_HANDLE_SUFFIX = new RegExp(`@${HANDLE_DOMAIN}$`, 'i');

const TONES = {
  red: 'bg-[#B91C1C]/10 border-[#B91C1C]/25 text-[#F87171]',
  amber: 'bg-[#D97706]/10 border-[#D97706]/25 text-[#FBBF24]',
  neutral: 'bg-white/[0.03] border-white/[0.08] text-[#C9C1B3]',
} as const;

/* ═══════════════════════════════════════════════════════════
   SCOPED CSS — compositor-only animations, no layout thrash.
   Rendered once as a <style> tag inside the page tree.
   ═══════════════════════════════════════════════════════════ */

const LOGIN_CSS = `
  /* entrance — transform + opacity only, GPU-composited */
  @keyframes orbital-fade-up {
    from { opacity: 0; transform: translate3d(0, 8px, 0); }
    to   { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  .orbital-fade-up {
    animation: orbital-fade-up 0.36s cubic-bezier(0.22, 1, 0.36, 1) both;
    backface-visibility: hidden;
  }

  /* error banner entrance */
  @keyframes orbital-error-in {
    from { opacity: 0; transform: translate3d(0, -4px, 0); }
    to   { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  .orbital-error-in {
    animation: orbital-error-in 0.24s cubic-bezier(0.22, 1, 0.36, 1) both;
    backface-visibility: hidden;
  }

  /* collapsing slot — grid-template-rows, NOT height:auto.
     Avoids the reflow-every-frame cost of animating height. */
  .orbital-error-slot {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .orbital-error-slot[data-open='true'] {
    grid-template-rows: 1fr;
  }
  .orbital-error-slot > .orbital-error-inner {
    overflow: hidden;
    min-height: 0;
  }

  /* respect the user's motion preference without a JS hook */
  @media (prefers-reduced-motion: reduce) {
    .orbital-fade-up,
    .orbital-error-in { animation: none !important; }
    .orbital-error-slot { transition: none !important; }
  }
`;

/* ═══════════════════════════════════════════════════════════
   IDENTIFIER PARSING
   ═══════════════════════════════════════════════════════════ */

function detectIdentifierMode(raw: string): IdentifierMode {
  const v = raw.trim().toLowerCase();
  if (!v) return 'unknown';
  if (v.endsWith(`@${HANDLE_DOMAIN}`)) return 'handle';
  if (RE_EMAIL.test(v)) return 'email';
  if (RE_HANDLE_LOOSE.test(v)) return 'handle';
  return 'unknown';
}

function normalizeHandle(raw: string): string {
  const bare = raw.trim().toLowerCase().replace(RE_HANDLE_SUFFIX, '');
  return `${bare}@${HANDLE_DOMAIN}`;
}

type IdentifierResult =
  | { ok: true; normalized: string; mode: 'handle' | 'email' }
  | { ok: false; message: string };

function validateIdentifier(raw: string): IdentifierResult {
  const v = raw.trim();
  if (!v) return { ok: false, message: 'Enter your email or handle.' };

  const mode = detectIdentifierMode(v);

  if (mode === 'email') {
    if (!RE_EMAIL.test(v)) {
      return { ok: false, message: 'That doesn’t look like a valid email.' };
    }
    return { ok: true, normalized: v.toLowerCase(), mode: 'email' };
  }

  if (mode === 'handle') {
    const bare = v.toLowerCase().replace(RE_HANDLE_SUFFIX, '');
    if (!RE_HANDLE_BARE.test(bare)) {
      return {
        ok: false,
        message: 'Handles are 2–32 characters (letters, numbers, . _ -).',
      };
    }
    return { ok: true, normalized: normalizeHandle(v), mode: 'handle' };
  }

  return {
    ok: false,
    message: 'Enter a valid email or your handle (e.g. jane@orbit).',
  };
}

/* ═══════════════════════════════════════════════════════════
   ERROR TYPES + CLASSIFICATION
   ═══════════════════════════════════════════════════════════ */

type AuthErrorKind =
  | 'validation'
  | 'credentials'
  | 'unverified'
  | 'rate-limited'
  | 'locked'
  | 'network'
  | 'server'
  | 'unknown';

type AuthError = {
  kind: AuthErrorKind;
  message: string;
  field?: 'identifier' | 'password';
};

type FieldErrors = Partial<Record<'identifier' | 'password', string>>;

function classifyAuthError(raw: string, status?: number): AuthErrorKind {
  const m = raw.toLowerCase();
  if (status === 401 || m.includes('invalid credential') || m.includes('wrong password'))
    return 'credentials';
  if (status === 403 && (m.includes('verify') || m.includes('not verified')))
    return 'unverified';
  if (m.includes('verify your email') || m.includes('not verified') || m.includes('unverified'))
    return 'unverified';
  if (status === 429 || m.includes('too many') || m.includes('rate limit'))
    return 'rate-limited';
  if (m.includes('locked') || m.includes('suspended') || m.includes('disabled'))
    return 'locked';
  if (status && status >= 500) return 'server';
  if (
    m.includes('network') ||
    m.includes('failed to fetch') ||
    m.includes('timeout') ||
    m.includes('offline')
  )
    return 'network';
  if (status === 400 || m.includes('required') || m.includes('invalid email'))
    return 'validation';
  return 'unknown';
}

function toAuthError(err: unknown, fallback = 'Invalid credentials.'): AuthError {
  const status = (() => {
    if (typeof err === 'object' && err !== null) {
      const anyErr = err as { status?: number; response?: { status?: number } };
      return anyErr.status ?? anyErr.response?.status;
    }
    return undefined;
  })();
  const raw = extractErrorMessage(err, fallback);
  const kind = classifyAuthError(raw, status);
  return { kind, message: raw };
}

/* ═══════════════════════════════════════════════════════════
   ERROR BANNER — memoized, pure CSS, no motion runtime
   ═══════════════════════════════════════════════════════════ */

type ErrorBannerProps = {
  error: AuthError;
  onResend: () => void;
  onRetry: () => void;
  retryCountdown: number | null;
};

const ErrorBanner = memo(function ErrorBanner({
  error,
  onResend,
  onRetry,
  retryCountdown,
}: ErrorBannerProps) {
  const bannerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bannerRef.current?.focus();
  }, [error.kind, error.message]);

  const { icon, tone, title, hint } = useMemo(() => {
    switch (error.kind) {
      case 'unverified':
        return {
          icon: <MailWarning className="w-4 h-4" />,
          tone: 'amber' as const,
          title: 'Email not verified',
          hint: 'Check your inbox — or resend the link below.',
        };
      case 'rate-limited':
        return {
          icon: <Clock className="w-4 h-4" />,
          tone: 'amber' as const,
          title: 'Too many attempts',
          hint:
            retryCountdown && retryCountdown > 0
              ? `Try again in ${retryCountdown}s.`
              : 'Please wait a moment before trying again.',
        };
      case 'locked':
        return {
          icon: <Lock className="w-4 h-4" />,
          tone: 'red' as const,
          title: 'Account locked',
          hint: 'Contact support to restore access.',
        };
      case 'network':
        return {
          icon: <WifiOff className="w-4 h-4" />,
          tone: 'neutral' as const,
          title: 'Connection problem',
          hint: 'Check your internet connection and try again.',
        };
      case 'server':
        return {
          icon: <ShieldAlert className="w-4 h-4" />,
          tone: 'red' as const,
          title: 'Something went wrong',
          hint: 'Our servers are having trouble. Try again shortly.',
        };
      case 'credentials':
        return {
          icon: <AlertCircle className="w-4 h-4" />,
          tone: 'red' as const,
          title: 'Sign-in failed',
          hint: 'Double-check your email/handle and password.',
        };
      case 'validation':
        return {
          icon: <AlertTriangle className="w-4 h-4" />,
          tone: 'amber' as const,
          title: 'Check your details',
          hint: error.message,
        };
      default:
        return {
          icon: <AlertCircle className="w-4 h-4" />,
          tone: 'red' as const,
          title: 'Sign-in failed',
          hint: error.message,
        };
    }
  }, [error, retryCountdown]);

  return (
    <div
      ref={bannerRef}
      tabIndex={-1}
      role="alert"
      aria-live="polite"
      className={`orbital-error-in overflow-hidden rounded-xl border px-3.5 py-3 text-[12.5px] leading-relaxed ${TONES[tone]} focus:outline-none`}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-[1px] shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{title}</div>
          <div className="opacity-90 mt-0.5">{hint}</div>

          {error.kind === 'unverified' && (
            <button
              type="button"
              onClick={onResend}
              className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium underline-offset-2 hover:underline"
            >
              <RefreshCw className="w-3 h-3" />
              Resend verification link
            </button>
          )}

          {error.kind === 'network' && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium underline-offset-2 hover:underline"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════
   LOGIN
   ═══════════════════════════════════════════════════════════ */

function Login(): React.JSX.Element {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);

  /* ⚡ lags `error` on clear so the grid collapse can finish before
     the banner unmounts. Immediate on appear (useLayoutEffect). */
  const [visibleError, setVisibleError] = useState<AuthError | null>(null);

  const identifierRef = useRef<HTMLDivElement | null>(null);
  const passwordRef = useRef<HTMLDivElement | null>(null);

  /* retry countdown ticker */
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

  /* ⚡ keep the exit animation smooth. useLayoutEffect so appearing
     content lands in the same paint as the container's expansion. */
  useLayoutEffect(() => {
    if (error) {
      setVisibleError(error);
    } else if (visibleError) {
      const t = window.setTimeout(() => setVisibleError(null), 240);
      return () => window.clearTimeout(t);
    }
  }, [error, visibleError]);

  const identifierMode = useMemo(
    () => detectIdentifierMode(identifier),
    [identifier],
  );

  const identifierTag =
    identifierMode === 'handle'
      ? 'Handle'
      : identifierMode === 'email'
        ? 'Email'
        : undefined;

  const validate = useCallback((): FieldErrors => {
    const errs: FieldErrors = {};
    const result = validateIdentifier(identifier);
    if (!result.ok) errs.identifier = result.message;
    if (!password) errs.password = 'Enter your password.';
    return errs;
  }, [identifier, password]);

  const focusFirstError = useCallback((errs: FieldErrors) => {
    if (errs.identifier) identifierRef.current?.querySelector('input')?.focus();
    else if (errs.password) passwordRef.current?.querySelector('input')?.focus();
  }, []);

  const doLogin = useCallback(async () => {
    if (loading) return;

    const errs = validate();
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setError(null);
      focusFirstError(errs);
      return;
    }

    const parsed = validateIdentifier(identifier);
    if (!parsed.ok) {
      setFieldErrors({ identifier: parsed.message });
      return;
    }

    setLoading(true);
    setError(null);
    setFieldErrors({});
    setRetryCountdown(null);

    try {
      await login(parsed.normalized, password);
      navigate('/app');
    } catch (err) {
      const authErr = toAuthError(err, 'Invalid credentials.');

      if (authErr.kind === 'credentials') {
        setFieldErrors({ password: 'Incorrect password.' });
      } else if (authErr.kind === 'validation') {
        setFieldErrors({ identifier: authErr.message });
      } else {
        setError(authErr);
      }

      if (authErr.kind === 'rate-limited') {
        setRetryCountdown(30);
      }
    } finally {
      setLoading(false);
    }
  }, [identifier, password, loading, login, navigate, validate, focusFirstError]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void doLogin();
    },
    [doLogin],
  );

  const handleResend = useCallback(() => {
    const parsed = validateIdentifier(identifier);
    if (!parsed.ok || parsed.mode !== 'email') {
      setFieldErrors({
        identifier: 'Enter the email you signed up with to resend the link.',
      });
      identifierRef.current?.querySelector('input')?.focus();
      return;
    }
    navigate(
      `/confirm-email-pending?email=${encodeURIComponent(parsed.normalized)}`,
    );
  }, [identifier, navigate]);

  const handleRetry = useCallback(() => {
    void doLogin();
  }, [doLogin]);

  const handleGoogleLogin = useCallback(() => {
    window.location.href = `${API_BASE_URL.replace(/\/+$/, '')}/api/Auth/google-login?prompt=select_account`;
  }, []);

  /* ⚡ functional updates → no dep on fieldErrors/error, stable identity */
  const onIdentifierChange = useCallback((value: string) => {
    setIdentifier(value);
    setFieldErrors((f) => (f.identifier ? { ...f, identifier: undefined } : f));
    setError((e) =>
      e?.kind === 'credentials' || e?.kind === 'validation' ? null : e,
    );
  }, []);

  const onPasswordChange = useCallback((value: string) => {
    setPassword(value);
    setFieldErrors((f) => (f.password ? { ...f, password: undefined } : f));
    setError((e) => (e?.kind === 'credentials' ? null : e));
  }, []);

  const busy = loading;
  const errorOpen = error ? 'true' : 'false';

  return (
    <AuthShell title="Sign in" subtitle="Welcome back to Orbital.">
      {/* scoped styles — rendered once, defines the keyframes above */}
      <style>{LOGIN_CSS}</style>

      <div className="space-y-5">
        {/* Google button */}
        <div className="orbital-fade-up">
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={busy}
            className="w-full h-11 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.10] hover:border-white/[0.18] text-[#EDE5D4] text-[13.5px] font-medium inline-flex items-center justify-center gap-2.5 transition-colors duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <GoogleIcon />
            <span>Continue with Google</span>
          </button>
        </div>

        {/* Divider */}
        <div
          className="orbital-fade-up relative"
          style={{ animationDelay: '0.06s' }}
        >
          <div className="absolute inset-0 flex items-center" aria-hidden>
            <div className="w-full border-t border-white/[0.08]" />
          </div>
          <div className="relative flex justify-center">
            <span className="px-3 text-[10px] uppercase tracking-[0.24em] text-[#6B6259] bg-[#131110]">
              or
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Identifier */}
          <div
            ref={identifierRef}
            className="orbital-fade-up"
            style={{ animationDelay: '0.12s' }}
          >
            <AuthInput
              id="login-identifier"
              label="Email or handle"
              type="text"
              value={identifier}
              onChange={(e) => onIdentifierChange(e.target.value)}
              placeholder="you@orbit"
              required
              autoComplete="username"
              icon={<AtSign className="w-4 h-4" />}
              trailingTag={identifierTag}
              error={fieldErrors.identifier}
              hint="Use your email or handle@orbit"
            />
          </div>

          {/* Password */}
          <div
            ref={passwordRef}
            className="orbital-fade-up space-y-2"
            style={{ animationDelay: '0.18s' }}
          >
            <AuthInput
              id="login-password"
              label="Password"
              type="password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              icon={<KeyRound className="w-4 h-4" />}
              error={fieldErrors.password}
            />
            <div className="flex justify-end">
              <Link
                to="/forgot-password"
                className="text-[12px] text-[#A8A29E] hover:text-[#D97706] transition-colors"
              >
                Forgot password?
              </Link>
            </div>
          </div>

          {/* ⚡ collapsing error slot — grid-template-rows only, no motion runtime */}
          <div className="orbital-error-slot" data-open={errorOpen}>
            <div className="orbital-error-inner">
              {visibleError && (
                <ErrorBanner
                  key={`${visibleError.kind}-${visibleError.message}`}
                  error={visibleError}
                  onResend={handleResend}
                  onRetry={handleRetry}
                  retryCountdown={retryCountdown}
                />
              )}
            </div>
          </div>

          {/* Submit */}
          <div className="orbital-fade-up" style={{ animationDelay: '0.24s' }}>
            <AuthButton type="submit" loading={loading} variant="primary">
              {retryCountdown ? `Try again in ${retryCountdown}s` : 'Sign in'}
            </AuthButton>
          </div>
        </form>

        {/* Footer */}
        <div
          className="orbital-fade-up pt-5 border-t border-white/[0.06] text-center text-[12.5px] text-[#A8A29E]"
          style={{ animationDelay: '0.3s' }}
        >
          Don't have an account?{' '}
          <Link
            to="/register"
            className="text-[#D97706] hover:text-[#B45309] font-medium transition-colors"
          >
            Sign up
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}

/* ═══════════════════════════════════════════════════════════
   GOOGLE ICON — static, memoized so it never re-renders
   ═══════════════════════════════════════════════════════════ */

const GoogleIcon = memo(function GoogleIcon() {
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
});

export default Login;