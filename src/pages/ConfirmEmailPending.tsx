/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { apiService, extractErrorMessage } from '../services/api';
import { AuthShell } from '../components/AuthShell';
import { AuthButton } from '../components/AuthButton';
import { AuthInput } from '../components/AuthInput';
import { Mail, CheckCircle2 } from 'lucide-react';

const SPRING = { type: 'spring' as const, stiffness: 240, damping: 26 };

function ConfirmEmailPending(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const emailFromUrl = searchParams.get('email') ?? '';
  const reduceMotion = useReducedMotion();

  const [resendEmail, setResendEmail] = useState(emailFromUrl);
  const [loading, setLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail.trim()) {
      setResendError('Enter the email you registered with.');
      return;
    }

    setLoading(true);
    setResendError(null);

    try {
      await apiService.resendConfirmation({ email: resendEmail.trim() });
      setResendSuccess(true);
    } catch (err) {
      setResendError(extractErrorMessage(err, 'Could not resend. Try again in a moment.'));
    } finally {
      setLoading(false);
    }
  };

  const stagger = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          transition: { ...SPRING, delay },
        };

  return (
    <AuthShell
      title="Check your inbox"
      subtitle={`We sent a verification link to ${emailFromUrl || 'your email'}.`}
    >
      <div className="space-y-6">
        {/* Icon + email chip */}
        <motion.div {...stagger(0)} className="text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-[#D97706]/10 border border-[#D97706]/20 text-[#D97706] flex items-center justify-center mx-auto">
            <Mail className="w-6 h-6" />
          </div>

          {emailFromUrl && (
            <p className="text-[12.5px] text-[#EDE5D4] bg-white/[0.05] backdrop-blur-md border border-white/[0.08] px-3.5 py-1.5 rounded-full inline-block">
              {emailFromUrl}
            </p>
          )}

          <p className="text-[13px] text-[#A8A29E] leading-[1.65] max-w-sm mx-auto">
            Open the link in your email to verify your address. Once confirmed,
            you can sign in immediately.
          </p>
        </motion.div>

        {/* Tips */}
        <motion.div
          {...stagger(0.08)}
          className="rounded-xl bg-white/[0.03] backdrop-blur-md border border-white/[0.06] p-4 space-y-2"
        >
          <Tip>Check spam or junk if it hasn't arrived within 2 minutes.</Tip>
          <Tip>The link is valid for 24 hours.</Tip>
        </motion.div>

        {/* Resend */}
        {resendSuccess ? (
          <motion.div
            {...stagger(0.12)}
            className="rounded-xl bg-[#15803D]/10 border border-[#15803D]/25 px-3.5 py-3 text-[12.5px] text-[#4ADE80] flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>A fresh verification link has been sent.</span>
          </motion.div>
        ) : (
          <motion.form
            {...stagger(0.12)}
            onSubmit={handleResend}
            className="space-y-3"
          >
            <AuthInput
              id="resend-email"
              label="Resend to"
              type="email"
              value={resendEmail}
              onChange={(e) => {
                setResendEmail(e.target.value);
                if (resendError) setResendError(null);
              }}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />

            {resendError && (
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="rounded-xl bg-[#B91C1C]/10 border border-[#B91C1C]/25 px-3.5 py-2.5 text-[12.5px] text-[#F87171] leading-relaxed"
              >
                {resendError}
              </motion.div>
            )}

            <AuthButton type="submit" loading={loading} variant="secondary">
              Resend link
            </AuthButton>
          </motion.form>
        )}

        {/* Back to sign in */}
        <motion.div
          {...stagger(0.2)}
          className="pt-5 border-t border-white/[0.06] text-center text-[12.5px]"
        >
          <Link
            to="/login"
            className="text-[#A8A29E] hover:text-[#EDE5D4] transition-colors"
          >
            ← Back to sign in
          </Link>
        </motion.div>
      </div>
    </AuthShell>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-[12.5px] text-[#A8A29E] leading-[1.55]">
      <span className="w-1 h-1 rounded-full bg-[#D97706] mt-2 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export default ConfirmEmailPending;