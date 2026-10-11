/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiService, extractErrorMessage } from '../services/api';
import { AuthShell } from '../components/AuthShell';
import { AuthInput } from '../components/AuthInput';
import { AuthButton } from '../components/AuthButton';
import { CheckCircle2 } from 'lucide-react';

function ForgotPassword(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Please provide your email address.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await apiService.forgetPassword({ email: email.trim() });
      setSubmitted(true);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Recover Access"
      subtitle="Enter the email associated with your account to receive instructions."
    >
      {submitted ? (
        <div className="space-y-6 text-center">
          <div className="w-12 h-12 rounded-full bg-[#15803D]/10 text-[#15803D] flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>

          <div className="space-y-2">
            <h3 className="font-serif text-xl text-[#0F0D0A]">Instructions Dispatched</h3>
            <p className="text-xs text-[#57534E] leading-relaxed">
              If an account is associated with <span className="font-mono text-[#0F0D0A] font-medium">{email}</span>,
              a secure reset link has been dispatched to your inbox.
            </p>
          </div>

          <div className="pt-2">
            <Link to="/login" className="block w-full">
              <AuthButton variant="secondary">Return to Sign In</AuthButton>
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <AuthInput
            id="recovery-email"
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(null);
            }}
            placeholder="name@domain.com"
            required
            autoComplete="email"
          />

          {error && (
            <div className="p-3 rounded-lg bg-[#B91C1C]/10 border border-[#B91C1C]/20 text-xs font-mono text-[#B91C1C]">
              {error}
            </div>
          )}

          <AuthButton type="submit" loading={loading} variant="primary">
            Send Recovery Link
          </AuthButton>

          <div className="pt-3 border-t border-[rgba(15,13,10,0.10)] flex items-center justify-between text-xs font-mono text-[#57534E]">
            <Link to="/login" className="hover:text-[#0F0D0A]">
              &larr; Back to sign in
            </Link>
            <Link to="/register" className="hover:text-[#B45309]">
              Create account
            </Link>
          </div>
        </form>
      )}
    </AuthShell>
  );
}

export default ForgotPassword;
export { ForgotPassword };
