/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { apiService, extractErrorMessage } from '../services/api';
import { AuthShell } from '../components/AuthShell';
import { AuthButton } from '../components/AuthButton';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

const SPRING = { type: 'spring' as const, stiffness: 240, damping: 26 };

function ConfirmEmail(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email') ?? '';
  const token = searchParams.get('token') ?? '';

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  // React 18 StrictMode double-fires effects in dev. The confirm-email
  // endpoint is not idempotent — the second call hits the backend with an
  // already-used token and returns 400. This ref ensures we only fire once
  // per page load.
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    if (!email || !token) {
      setError('This confirmation link is missing its email or token.');
      return;
    }

    (async () => {
      setLoading(true);
      setError(null);
      try {
        await apiService.confirmEmail({ email, token });
        setSuccess(true);
      } catch (err) {
        setError(
          extractErrorMessage(err, 'Verification failed. The link may have expired.'),
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [email, token]);

  const stagger = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: { ...SPRING, delay },
        };

  return (
    <AuthShell title="" hideBack={!success && !error}>
      <div className="space-y-6 text-center">
        {loading && (
          <motion.div {...stagger(0)} className="py-8 space-y-4">
            <Loader2 className="w-8 h-8 animate-spin text-[#D97706] mx-auto" />
            <p className="text-[13px] text-[#A8A29E]">Verifying your email…</p>
          </motion.div>
        )}

        {!loading && success && (
          <>
            <motion.div
              {...stagger(0)}
              className="w-14 h-14 rounded-full bg-[#15803D]/10 border border-[#15803D]/25 text-[#15803D] flex items-center justify-center mx-auto"
            >
              <CheckCircle2 className="w-6 h-6" />
            </motion.div>

            <motion.div {...stagger(0.08)} className="space-y-2">
              <h2 className="text-[22px] text-[#EDE5D4] font-medium">
                Email confirmed
              </h2>
              <p className="text-[13px] text-[#A8A29E] leading-[1.65] max-w-sm mx-auto">
                Your email address has been verified. You can now sign in.
              </p>
            </motion.div>

            <motion.div {...stagger(0.16)} className="pt-2">
              <Link to="/login" className="block w-full">
                <AuthButton variant="primary">Sign in</AuthButton>
              </Link>
            </motion.div>
          </>
        )}

        {!loading && error && (
          <>
            <motion.div
              {...stagger(0)}
              className="w-14 h-14 rounded-full bg-[#B91C1C]/10 border border-[#B91C1C]/25 text-[#B91C1C] flex items-center justify-center mx-auto"
            >
              <AlertCircle className="w-6 h-6" />
            </motion.div>

            <motion.div {...stagger(0.08)} className="space-y-2">
              <h2 className="text-[22px] text-[#EDE5D4] font-medium">
                Verification failed
              </h2>
              <p className="text-[12.5px] text-[#F87171] leading-[1.6] max-w-sm mx-auto">
                {error}
              </p>
              <p className="text-[12.5px] text-[#A8A29E] leading-[1.6] max-w-sm mx-auto">
                The link may have expired. You can request a fresh one.
              </p>
            </motion.div>

            <motion.div {...stagger(0.16)} className="pt-2 space-y-3">
              <Link to="/confirm-email-pending" className="block w-full">
                <AuthButton variant="secondary">Request new link</AuthButton>
              </Link>
              <Link
                to="/login"
                className="block text-[12.5px] text-[#A8A29E] hover:text-[#EDE5D4] transition-colors"
              >
                ← Back to sign in
              </Link>
            </motion.div>
          </>
        )}
      </div>
    </AuthShell>
  );
}

export default ConfirmEmail;