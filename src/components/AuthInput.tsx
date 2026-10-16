/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AuthInput — 144 Hz pass.
 *
 * ⚡ All motion is CSS, transform / opacity only.
 * ⚡ Error/hint collapse uses the CSS grid trick (0fr → 1fr) with
 *    `contain: layout paint` so it never reflows the rest of the form.
 * ⚡ Shake is a class toggle on a stable parent, not a key change —
 *    the <input> is never remounted, focus is never lost.
 * ⚡ Password eye toggle is a plain <button> with CSS icon swap.
 */

import React, {
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
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
  icon?: React.ReactNode;
  hint?: string;
  showCount?: boolean;
  maxLength?: number;
  showPasswordToggle?: boolean;
  trailingTag?: string;
}

const INPUT_CSS = `
  /* ────────────── shake (restartable via class toggle) ────────────── */
  @keyframes orbital-input-shake {
    0%, 100% { transform: translate3d(0, 0, 0); }
    15%      { transform: translate3d(-6px, 0, 0); }
    30%      { transform: translate3d(6px, 0, 0); }
    45%      { transform: translate3d(-4px, 0, 0); }
    60%      { transform: translate3d(4px, 0, 0); }
    75%      { transform: translate3d(-2px, 0, 0); }
    90%      { transform: translate3d(2px, 0, 0); }
  }
  .orbital-input-shake {
    animation: orbital-input-shake 350ms cubic-bezier(0.36, 0.07, 0.19, 0.97);
    backface-visibility: hidden;
  }

  /* ────────────── collapsing hint/error slot ────────────── */
  .orbital-input-slot {
    display: grid;
    grid-template-rows: 0fr;
    contain: layout paint;
    transition: grid-template-rows 170ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .orbital-input-slot[data-open='true'] {
    grid-template-rows: 1fr;
  }
  .orbital-input-slot > .orbital-input-slot-inner {
    overflow: hidden;
    min-height: 0;
  }

  /* ────────────── eye toggle icon cross-fade ────────────── */
  .orbital-eye-icon {
    display: inline-grid;
    place-items: center;
    grid-template-areas: "icon";
    transition: transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .orbital-eye-icon > * {
    grid-area: icon;
    transition: opacity 150ms linear, transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .orbital-eye-icon[data-on='false'] .orbital-eye-on  { opacity: 0; transform: scale(0.7) rotate(20deg); }
  .orbital-eye-icon[data-on='false'] .orbital-eye-off { opacity: 1; transform: scale(1) rotate(0deg); }
  .orbital-eye-icon[data-on='true']  .orbital-eye-on  { opacity: 1; transform: scale(1) rotate(0deg); }
  .orbital-eye-icon[data-on='true']  .orbital-eye-off { opacity: 0; transform: scale(0.7) rotate(-20deg); }

  @media (prefers-reduced-motion: reduce) {
    .orbital-input-shake { animation: none !important; }
    .orbital-input-slot { transition: none !important; }
    .orbital-eye-icon,
    .orbital-eye-icon > * { transition: none !important; }
  }
`;

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
  const hintId = useId();

  const hasError = Boolean(error);
  const isPassword = type === 'password';

  const [revealed, setRevealed] = useState(false);
  const toggleReveal = useCallback(() => setRevealed((v) => !v), []);
  const effectiveType = isPassword && revealed ? 'text' : type;
  const canTogglePassword = isPassword && (showPasswordToggle ?? true);

  /* Shake replay — toggle a class on a stable wrapper. The input
     is never remounted, so focus/caret survive error transitions. */
  const shakeWrapRef = useRef<HTMLDivElement | null>(null);
  const lastErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasError) {
      lastErrorRef.current = null;
      return;
    }
    if (lastErrorRef.current === error) return; // same message, no re-shake
    lastErrorRef.current = error ?? null;

    const el = shakeWrapRef.current;
    if (!el) return;
    el.classList.remove('orbital-input-shake');
    // Force reflow so the animation restarts even on the same tick
    void el.offsetWidth;
    el.classList.add('orbital-input-shake');
  }, [error, hasError]);

  const describedBy = hasError ? `${id}-error` : hint ? hintId : undefined;

  const leftPad = icon ? 'pl-10 ' : 'pl-3.5 ';
  const rightPad = canTogglePassword
    ? 'pr-10 '
    : trailingTag
      ? 'pr-16 '
      : 'pr-3.5 ';

  return (
    <div className={`w-full ${className}`}>
      <style>{INPUT_CSS}</style>

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

      {/* Field wrapper — stable, never re-keyed */}
      <div ref={shakeWrapRef} className="relative">
        {icon && (
          <span
            aria-hidden
            className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 grid place-items-center transition-colors duration-100 ${
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
            'placeholder:text-[#A8A29E] ' +
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

        {canTogglePassword && (
          <button
            type="button"
            onClick={toggleReveal}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            tabIndex={-1}
            className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-7 h-7 rounded-md text-[#78716C] hover:text-[#0F0D0A] hover:bg-black/[0.05] transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B45309]/50 active:scale-90"
          >
            <span className="orbital-eye-icon" data-on={revealed ? 'true' : 'false'}>
              <Eye className="orbital-eye-off w-4 h-4" />
              <EyeOff className="orbital-eye-on w-4 h-4" />
            </span>
          </button>
        )}
      </div>

      {/* Collapsing hint / error slot — grid-rows trick */}
      <div
        className="orbital-input-slot"
        data-open={hasError || hint ? 'true' : 'false'}
      >
        <div className="orbital-input-slot-inner">
          {hasError ? (
            <p
              id={`${id}-error`}
              role="alert"
              className="mt-1.5 text-xs font-mono text-[#B91C1C] leading-normal flex items-start gap-1.5"
            >
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-[1px]" />
              <span>{error}</span>
            </p>
          ) : hint ? (
            <p
              id={hintId}
              className="mt-1.5 text-[11px] font-mono text-[#78716C] leading-normal"
            >
              {hint}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default memo(AuthInput);
export { AuthInput };