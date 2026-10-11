/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiService, extractErrorMessage } from '../services/api';
import { AuthShell } from '../components/AuthShell';
import { AuthInput } from '../components/AuthInput';
import { AuthButton } from '../components/AuthButton';
import { CheckCircle2 } from 'lucide-react';

function ResetPassword(): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const emailParam = searchParams.get('email') ?? '';
  const tokenParam = searchParams.get('token') ?? searchParams.get('code') ?? '';

  const [email, setEmail] = useState(emailParam);
  const [token, setToken] = useState(tokenParam);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      setError('Email address is required.');
      return;
    }
    if (!token.trim()) {
      setError('Password reset token is missing from the URL link.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must contain at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await apiService.resetPassword({
        email: email.trim(),
        token: token.trim(),
        newPassword,
      });
      setIsSuccess(true);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Set New Password"
      subtitle="Choose a secure credential to re-establish access to your account."
    >
      {isSuccess ? (
        <div className="space-y-6 text-center">
          <div className="w-12 h-12 rounded-full bg-[#15803D]/10 text-[#15803D] flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>

          <div className="space-y-2">
            <h3 className="font-serif text-xl text-[#0F0D0A]">Password Updated</h3>
            <p className="text-xs text-[#57534E] leading-relaxed">
              Your security credential has been successfully renewed. You may now sign in.
            </p>
          </div>

          <div className="pt-2">
            <Link to="/login" className="block w-full">
              <AuthButton variant="primary">Proceed to Sign In</AuthButton>
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {!emailParam && (
            <AuthInput
              id="reset-email"
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@domain.com"
              required
            />
          )}

          {!tokenParam && (
            <AuthInput
              id="reset-token"
              label="Reset Code / Token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste security token from email"
              required
            />
          )}

          <AuthInput
            id="new-password"
            label="New Password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Min. 6 characters"
            required
            autoComplete="new-password"
          />

          <AuthInput
            id="confirm-new-password"
            label="Confirm Password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
            required
            autoComplete="new-password"
          />

          {error && (
            <div className="p-3 rounded-lg bg-[#B91C1C]/10 border border-[#B91C1C]/20 text-xs font-mono text-[#B91C1C]">
              {error}
            </div>
          )}

          <div className="pt-2">
            <AuthButton type="submit" loading={loading} variant="primary">
              Update Password
            </AuthButton>
          </div>

          <div className="pt-3 border-t border-[rgba(15,13,10,0.10)] text-center text-xs font-mono text-[#57534E]">
            <Link to="/login" className="hover:text-[#0F0D0A]">
              &larr; Return to sign in
            </Link>
          </div>
        </form>
      )}
    </AuthShell>
  );
}

export default ResetPassword;
export { ResetPassword };
