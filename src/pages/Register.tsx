import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, AtSign, Check, KeyRound, Lock, Mail, User as UserIcon, X } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { AuthShell } from '../components/AuthShell';
import { AuthInput } from '../components/AuthInput';
import { AuthButton } from '../components/AuthButton';
import { API_BASE_URL, extractErrorMessage } from '../services/api';

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldKey = 'displayName' | 'handle' | 'email' | 'password' | 'confirm';
type FieldErrors = Partial<Record<FieldKey, string>>;
type AuthError = { kind: 'validation' | 'conflict' | 'rate-limited' | 'network' | 'server' | 'unknown'; message: string; };

function validate(values: any): FieldErrors {
  const errs: FieldErrors = {};
  const name = values.displayName.trim();
  if (!name) errs.displayName = 'Enter a display name.';
  else if (name.length < 2) errs.displayName = 'At least 2 characters.';

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

function toAuthError(err: unknown, fallback: string): AuthError {
  const status = (typeof err === 'object' && err !== null) ? ((err as any).status ?? (err as any).response?.status) : undefined;
  const raw = extractErrorMessage(err, fallback);
  const m = raw.toLowerCase();
  let kind: AuthError['kind'] = 'unknown';
  if (status === 409 || m.includes('already') || m.includes('taken')) kind = 'conflict';
  else if (status === 429 || m.includes('too many')) kind = 'rate-limited';
  else if (status && status >= 500) kind = 'server';
  else if (m.includes('network') || m.includes('failed to fetch')) kind = 'network';
  else if (status === 400) kind = 'validation';
  return { kind, message: raw };
}

function StrengthBar({ value }: { value: string }) {
  let score = 0;
  if (value.length >= 8) score = 1;
  if (value.length >= 12) score = 2;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score = Math.max(score, 2);
  if (/\d/.test(value)) score = Math.max(score, 3);
  if (/[^A-Za-z0-9]/.test(value)) score = 4;

  if (!value) return null;
  const colors = ['bg-[#B91C1C]', 'bg-[#B91C1C]', 'bg-[#D97706]', 'bg-[#CA8A04]', 'bg-[#15803D]'];
  return (
    <div className="mt-1.5 flex gap-1">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className={`h-1 flex-1 rounded-full transition-opacity ${i <= score ? colors[score] : 'bg-white/[0.08]'}`} />
      ))}
    </div>
  );
}

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
);

export default function Register(): React.JSX.Element {
  const navigate = useNavigate();
  const { register } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [consent, setConsent] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (retryCountdown == null) return;
    if (retryCountdown <= 0) { setRetryCountdown(null); setError((e) => (e?.kind === 'rate-limited' ? null : e)); return; }
    const t = window.setTimeout(() => setRetryCountdown((n) => (n == null ? null : n - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [retryCountdown]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const errs = validate({ displayName, handle, email, password, confirm });
    if (Object.keys(errs).length) { setFieldErrors(errs); setError(null); return; }
    if (!consent) { setError({ kind: 'validation', message: 'Please accept the Terms to continue.' }); return; }

    setLoading(true); setError(null); setFieldErrors({}); setRetryCountdown(null);
    try {
      await register({ displayName: displayName.trim(), userHandle: handle.trim().toLowerCase(), email: email.trim().toLowerCase(), password });
      navigate(`/confirm-email-pending?email=${encodeURIComponent(email.trim().toLowerCase())}`);
    } catch (err) {
      const authErr = toAuthError(err, 'Registration failed.');
      setError(authErr);
      if (authErr.kind === 'rate-limited') setRetryCountdown(30);
    } finally {
      setLoading(false);
    }
  }, [displayName, handle, email, password, confirm, consent, loading, register, navigate]);

  return (
    <AuthShell title="Create account" subtitle="A few details and you’re in.">
      <div className="space-y-5">
        <button type="button" onClick={() => window.location.href = `${API_BASE_URL.replace(/\/+$/, '')}/api/Auth/google-login?prompt=select_account`} disabled={loading} className="w-full h-12 rounded-xl bg-white text-[#0F0D0A] hover:bg-[#F2EDE3] text-[14px] font-medium inline-flex items-center justify-center gap-2.5 transition-all duration-200 active:scale-[0.98] shadow-[0_6px_20px_-8px_rgba(0,0,0,0.5)] disabled:opacity-50">
          <GoogleIcon />
          <span>Continue with Google</span>
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden><div className="w-full border-t border-white/[0.08]" /></div>
          <div className="relative flex justify-center"><span className="px-3 text-[10px] uppercase tracking-[0.24em] text-[#6B6259] bg-[#131110]/60 backdrop-blur-sm">or</span></div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="grid sm:grid-cols-2 gap-4">
            <AuthInput id="name" label="Display name" value={displayName} onChange={(e) => { setDisplayName(e.target.value); setFieldErrors({}); }} placeholder="John Doe" required icon={<UserIcon className="w-4 h-4" />} error={fieldErrors.displayName} />
            <AuthInput id="handle" label="Handle" value={handle} onChange={(e) => { setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); setFieldErrors({}); }} placeholder="elena" required icon={<AtSign className="w-4 h-4" />} trailingTag={handle ? '@orbit' : undefined} error={fieldErrors.handle} />
          </div>

          <AuthInput id="email" label="Email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setFieldErrors({}); }} placeholder="you@example.com" required icon={<Mail className="w-4 h-4" />} error={fieldErrors.email} />

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <AuthInput id="password" label="Password" type="password" value={password} onChange={(e) => { setPassword(e.target.value); setFieldErrors({}); }} placeholder="At least 8 chars" required icon={<KeyRound className="w-4 h-4" />} error={fieldErrors.password} />
              <StrengthBar value={password} />
            </div>
            <div>
              <AuthInput id="confirm" label="Confirm" type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setFieldErrors({}); }} placeholder="Repeat password" required icon={<Lock className="w-4 h-4" />} error={fieldErrors.confirm} />
              {confirm && !fieldErrors.confirm && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] font-mono">
                  {password === confirm ? <span className="text-[#4ADE80] flex items-center gap-1"><Check className="w-3 h-3" /> Match</span> : <span className="text-[#F87171] flex items-center gap-1"><X className="w-3 h-3" /> Mismatch</span>}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2.5 pt-1">
            <button type="button" role="checkbox" aria-checked={consent} onClick={() => setConsent(!consent)} className={`mt-0.5 w-4 h-4 rounded border-[1.5px] shrink-0 grid place-items-center transition-colors ${consent ? 'bg-[#B45309] border-[#B45309]' : 'bg-transparent border-[rgba(237,229,212,0.25)]'}`}>
              {consent && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
            </button>
            <label className="text-[12px] text-[#A8A29E] leading-snug cursor-pointer select-none">
              I agree to the <Link to="/terms" className="text-[#D97706] hover:text-[#B45309]">Terms</Link> and <Link to="/privacy" className="text-[#D97706] hover:text-[#B45309]">Privacy Policy</Link>.
            </label>
          </div>

          {error && (
            <div className="rounded-xl border border-[#B91C1C]/25 bg-[#B91C1C]/10 px-4 py-3 text-[13px] text-[#F87171] flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-[1px]" />
              <div className="font-medium">{error.message}</div>
            </div>
          )}

          <div className="pt-2">
            <AuthButton type="submit" loading={loading}>
              {retryCountdown ? `Try again in ${retryCountdown}s` : 'Create account'}
            </AuthButton>
          </div>
        </form>

        <div className="pt-5 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[12.5px] text-[#A8A29E]">
          <span>Already have an account? <Link to="/login" className="text-[#D97706] hover:text-[#B45309] font-medium">Sign in</Link></span>
          <Link to="/confirm-email-pending" className="text-[#6B6259] hover:text-[#D97706]">Resend verification</Link>
        </div>
      </div>
    </AuthShell>
  );
}