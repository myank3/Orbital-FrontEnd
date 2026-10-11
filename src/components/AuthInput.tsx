/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useId, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'motion/react';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';

export interface AuthInputProps {
  label: string;
  id: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string | null;
  type?: string;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  className?: string;

  /** Optional leading icon rendered inside the field. */
  icon?: React.ReactNode;
  /** Small helper text shown below the field when there is no error. */
  hint?: string;
  /** Show a character counter (requires maxLength). */
  showCount?: boolean;
  /** Max characters — also enforces the input length. */
  maxLength?: number;
  /** Auto-enabled for password fields; override to disable. */
  showPasswordToggle?: boolean;
  /** Small right-aligned tag (e.g. "Handle" or "Email"). */
  trailingTag?: string;
}

const SOFT_SPRING = { type: 'spring' as const, stiffness: 220, damping: 24 };

function AuthInput({
  label,
  id,
  value,
  onChange,
  error,
  type = 'text',
  onBlur,
  placeholder,
  required = false,
  disabled = false,
  autoComplete,
  className = '',
  icon,
  hint,
  showCount = false,
  maxLength,
  showPasswordToggle,
  trailingTag,
}: AuthInputProps): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const hintId = useId();

  const hasError = Boolean(error);
  const isPassword = type === 'password';

  // Password reveal
  const [revealed, setRevealed] = useState(false);
  const toggleReveal = useCallback(() => setRevealed((v) => !v), []);
  const effectiveType = isPassword && revealed ? 'text' : type;
  const canTogglePassword = isPassword && (showPasswordToggle ?? true);

  // Shake trigger: bump a key each time the error text changes
  const [shakeKey, setShakeKey] = useState(0);
  useEffect(() => {
    if (hasError && !reduceMotion) setShakeKey((k) => k + 1);
  }, [error, hasError, reduceMotion]);

  const describedBy = hasError ? `${id}-error` : hint ? hintId : undefined;

  // Padding math — trailing slots take priority
  const leftPad = icon ? 'pl-10 ' : 'pl-3.5 ';
  const rightPad = canTogglePassword
    ? 'pr-10 '
    : trailingTag
      ? 'pr-16 '
      : 'pr-3.5 ';

  return (
    <div className={`w-full ${className}`}>
      {/* Label row */}
      <div className="flex items-baseline justify-between mb-1.5">
        <label
          htmlFor={id}
          className="block text-xs font-mono font-medium text-[#57534E] uppercase tracking-wider"
        >
          {label}
          {required && <span className="text-[#B45309] ml-1">*</span>}
        </label>

        {showCount && maxLength != null && (
          <span
            className={`text-[10.5px] font-mono tabular-nums ${
              value.length > maxLength * 0.9
                ? 'text-[#B45309]'
                : 'text-[#A8A29E]'
            }`}
            aria-hidden
          >
            {value.length}/{maxLength}
          </span>
        )}
      </div>

      {/* Field wrapper */}
      <motion.div
        key={shakeKey}
        initial={false}
        animate={
          reduceMotion || !hasError
            ? { x: 0 }
            : { x: [0, -6, 6, -4, 4, -2, 2, 0] }
        }
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="relative"
      >
        {/* Leading icon */}
        {icon && (
          <span
            aria-hidden
            className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 grid place-items-center transition-colors ${
              hasError ? 'text-[#B91C1C]' : 'text-[#78716C]'
            }`}
          >
            {icon}
          </span>
        )}

        <input
          id={id}
          name={id}
          type={effectiveType}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          autoComplete={autoComplete}
          maxLength={maxLength}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          className={
            'h-11 w-full rounded-lg bg-[#EDEAE3] text-sm text-[#0F0D0A] ' +
            'placeholder:text-[#A8A29E] transition-[border-color,background,box-shadow] duration-150 ' +
            'border-[1.5px] outline-none disabled:cursor-not-allowed disabled:opacity-50 ' +
            leftPad +
            rightPad +
            (hasError
              ? 'border-[#B91C1C] focus:border-[#B91C1C] bg-[#B91C1C]/[0.03] ' +
                'focus:shadow-[0_0_0_3px_rgba(185,28,28,0.12)] '
              : 'border-[rgba(15,13,10,0.15)] focus:border-[#B45309] ' +
                'focus:shadow-[0_0_0_3px_rgba(180,83,9,0.12)] ')
          }
        />

        {/* Trailing tag (mode chip) — hidden when a password toggle is shown */}
        {trailingTag && !canTogglePassword && (
          <span
            aria-hidden
            className={
              'pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 ' +
              'text-[10px] font-mono uppercase tracking-wider ' +
              'px-1.5 py-0.5 rounded ' +
              (hasError
                ? 'text-[#B91C1C] bg-[#B91C1C]/10'
                : 'text-[#78716C] bg-black/[0.05]')
            }
          >
            {trailingTag}
          </span>
        )}

        {/* Password reveal toggle */}
        {canTogglePassword && (
          <motion.button
            type="button"
            onClick={toggleReveal}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            tabIndex={-1}
            whileTap={reduceMotion ? undefined : { scale: 0.9 }}
            transition={SOFT_SPRING}
            className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-7 h-7 rounded-md text-[#78716C] hover:text-[#0F0D0A] hover:bg-black/[0.05] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B45309]/50"
          >
            <AnimatePresence mode="wait" initial={false}>
              {revealed ? (
                <motion.span
                  key="off"
                  initial={{ opacity: 0, scale: 0.7, rotate: -20 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: 0.7, rotate: 20 }}
                  transition={{ duration: 0.15 }}
                  className="grid place-items-center"
                >
                  <EyeOff className="w-4 h-4" />
                </motion.span>
              ) : (
                <motion.span
                  key="on"
                  initial={{ opacity: 0, scale: 0.7, rotate: 20 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: 0.7, rotate: -20 }}
                  transition={{ duration: 0.15 }}
                  className="grid place-items-center"
                >
                  <Eye className="w-4 h-4" />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        )}
      </motion.div>

      {/* Error / hint */}
      <AnimatePresence initial={false} mode="wait">
        {hasError ? (
          <motion.p
            key="error"
            id={`${id}-error`}
            role="alert"
            initial={reduceMotion ? false : { opacity: 0, height: 0, y: -2 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0, y: -2 }}
            transition={SOFT_SPRING}
            className="overflow-hidden mt-1.5 text-xs font-mono text-[#B91C1C] leading-normal flex items-start gap-1.5"
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-[1px]" />
            <span>{error}</span>
          </motion.p>
        ) : hint ? (
          <motion.p
            key="hint"
            id={hintId}
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden mt-1.5 text-[11px] font-mono text-[#78716C] leading-normal"
          >
            {hint}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default AuthInput;
export { AuthInput };