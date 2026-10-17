import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, AtSign, KeyRound } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { AuthShell } from '../components/AuthShell';
import { AuthInput } from '../components/AuthInput';
import { AuthButton } from '../components/AuthButton';
import { API_BASE_URL, extractErrorMessage } from '../services/api';

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_HANDLE = /^[a-z0-9_.-]{2,32}$/;

type AuthError = { kind: 'credentials' | 'unverified' | 'rate-limited' | 'locked' | 'network' | 'server' | 'validation' | 'unknown'; message: string };
type FieldErrors = Partial<Record<'identifier' | 'password', string>>;

function validateIdentifier(raw: string) {
  const v = raw.trim().toLowerCase();
  if (!v) return { ok: false, message: 'Enter your email or handle.' };
  if (v.includes('@') && !v.endsWith('@orbit')) {
    if (!RE_EMAIL.test(v)) return { ok: false, message: 'Enter a valid email.' };
    return { ok: true, normalized: v, mode: 'email' as const };
  }
  const bare = v.replace(/@orbit$/, '');
  if (!RE_HANDLE.test(bare)) return { ok: false, message: 'Handles are 2-32 characters.' };
  return { ok: true, normalized: `${bare}@orbit`, mode: 'handle' as const };
}

function toAuthError(err: unknown, fallback = 'Invalid credentials.'): AuthError {
  const status = (typeof err === 'object' && err !== null) ? ((err as any).status ?? (err as any).response?.status) : undefined;
  const raw = extractErrorMessage(err, fallback);
  const m = raw.toLowerCase();
  let kind: AuthError['kind'] = 'unknown';
  if (status === 401 || m.includes('invalid credential')) kind = 'credentials';
  else if (m.includes('verify') || m.includes('not verified')) kind = 'unverified';
  else if (status === 429 || m.includes('too many')) kind = 'rate-limited';
  else if (m.includes('locked') || m.includes('suspended')) kind = 'locked';
  else if (status && status >= 500) kind = 'server';
  else if (m.includes('network') || m.includes('failed to fetch')) kind = 'network';
  return { kind, message: raw };
}

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
);

export default function Login(): React.JSX.Element {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
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

    const parsed = validateIdentifier(identifier);
    const errs: FieldErrors = {};
    if (!parsed.ok) errs.identifier = parsed.message;
    if (!password) errs.password = 'Enter your password.';

    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setError(null);
      return;
    }

    setLoading(true); setError(null); setFieldErrors({}); setRetryCountdown(null);
    try {
      await login((parsed as any).normalized, password);
      navigate('/app');
    } catch (err) {
      const authErr = toAuthError(err);
      if (authErr.kind === 'credentials') setFieldErrors({ password: 'Incorrect password.' });
      else setError(authErr);
      if (authErr.kind === 'rate-limited') setRetryCountdown(30);
    } finally {
      setLoading(false);
    }
  }, [identifier, password, loading, login, navigate]);

  const handleGoogleLogin = () => {
    window.location.href = `${API_BASE_URL.replace(/\/+$/, '')}/api/Auth/google-login?prompt=select_account`;
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to continue your orbit.">
      <div className="space-y-6">
        <button 
          type="button" 
          onClick={handleGoogleLogin} 
          disabled={loading} 
          className="w-full h-12 rounded-xl bg-white text-[#0F0D0A] hover:bg-[#F2EDE3] text-[14px] font-medium inline-flex items-center justify-center gap-2.5 transition-all duration-200 active:scale-[0.98] shadow-[0_6px_20px_-8px_rgba(0,0,0,0.5)] disabled:opacity-50"
        >
          <GoogleIcon />
          <span>Continue with Google</span>
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden><div className="w-full border-t border-white/[0.08]" /></div>
          <div className="relative flex justify-center"><span className="px-3 text-[10px] uppercase tracking-[0.24em] text-[#6B6259] bg-[#131110]/60 backdrop-blur-sm">or</span></div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <AuthInput id="identifier" label="Email or handle" value={identifier} onChange={(e) => { setIdentifier(e.target.value); setFieldErrors({}); setError(null); }} placeholder="you@orbit" required icon={<AtSign className="w-4 h-4" />} error={fieldErrors.identifier} />
          
          <div className="space-y-1">
            <AuthInput id="password" label="Password" type="password" value={password} onChange={(e) => { setPassword(e.target.value); setFieldErrors({}); setError(null); }} placeholder="••••••••" required icon={<KeyRound className="w-4 h-4" />} error={fieldErrors.password} />
            <div className="flex justify-end pt-1">
              <Link to="/forgot-password" className="text-[12.5px] text-[#A8A29E] hover:text-[#D97706] transition-colors">Forgot password?</Link>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-[#B91C1C]/25 bg-[#B91C1C]/10 px-4 py-3 text-[13px] text-[#F87171] flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-[1px]" />
              <div className="font-medium">{error.message}</div>
            </div>
          )}

          <div className="pt-2">
            <AuthButton type="submit" loading={loading}>
              {retryCountdown ? `Try again in ${retryCountdown}s` : 'Sign in'}
            </AuthButton>
          </div>
        </form>

        <div className="pt-6 border-t border-white/[0.06] text-center text-[13px] text-[#A8A29E]">
          Don't have an account? <Link to="/register" className="text-[#D97706] hover:text-[#B45309] font-medium">Sign up</Link>
        </div>
      </div>
    </AuthShell>
  );
}