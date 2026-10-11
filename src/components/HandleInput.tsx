/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';

export interface HandleInputProps {
  value: string;
  onChange: (val: string) => void;
  error?: string | null;
  onBlur?: () => void;
  id?: string;
  disabled?: boolean;
  className?: string;
}

export function sanitizeHandle(input: string): string {
  // Strip any @orbit or @ suffix/prefix, force lowercase, allow only [a-z0-9_], max 20 chars
  return input
    .toLowerCase()
    .replace(/@orbit/gi, '')
    .replace(/@/g, '')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20);
}

function HandleInput({
  value,
  onChange,
  error,
  onBlur,
  id = 'user-handle-input',
  disabled = false,
  className = '',
}: HandleInputProps): React.JSX.Element {
  const hasError = Boolean(error);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const sanitized = sanitizeHandle(e.target.value);
      onChange(sanitized);
    },
    [onChange],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData('text');
      const sanitized = sanitizeHandle(pasted);
      onChange(sanitized);
    },
    [onChange],
  );

  return (
    <div className={`w-full ${className}`}>
      <label
        htmlFor={id}
        className="block text-xs font-mono font-medium text-[#57534E] uppercase tracking-wider mb-1.5"
      >
        Handle <span className="text-[#B45309]">*</span>
      </label>

      {/* Two-part pill layout: [ editable prefix ][ │ ][ @orbit ] */}
      <div
        className={`h-11 w-full rounded-lg bg-[#EDEAE3] px-3.5 flex items-center transition-colors duration-150 border-[1.5px] ${
          hasError
            ? 'border-[#B91C1C] focus-within:border-[#B91C1C]'
            : 'border-[rgba(15,13,10,0.15)] focus-within:border-[#B45309]'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <input
          id={id}
          name="handle"
          type="text"
          value={value}
          onChange={handleInputChange}
          onPaste={handlePaste}
          onBlur={onBlur}
          disabled={disabled}
          placeholder="your_handle"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 bg-transparent border-none outline-none text-sm text-[#0F0D0A] font-mono placeholder:text-[#A8A29E] disabled:cursor-not-allowed"
        />

        {/* 1px divider height 20px */}
        <div
          className="h-5 w-0 border-l border-[rgba(15,13,10,0.15)] mx-3 shrink-0"
          aria-hidden="true"
        />

        {/* Non-editable @orbit suffix in ink-lo */}
        <span className="text-xs font-mono text-[#A8A29E] font-medium select-none shrink-0">
          @orbit
        </span>
      </div>

      {/* Error display below field via motion AnimatePresence */}
      <AnimatePresence mode="wait">
        {hasError && (
          <motion.p
            key="handle-error"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="mt-1.5 text-xs font-mono text-[#B91C1C] leading-normal"
            role="alert"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

export default HandleInput;
export { HandleInput };
