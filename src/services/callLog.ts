/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface CallLogEntry {
  id: string;
  peerId: string;
  peerName: string;
  peerAvatarUrl: string | null;
  callType: number;       // 0 = audio, 1 = video
  direction: 'outgoing' | 'incoming';
  outcome: 'answered' | 'missed' | 'declined' | 'failed';
  startedAt: string;      // ISO
  durationSeconds: number;
}

const STORAGE_KEY = 'orbital.callLog';
const MAX_ENTRIES = 200;

function read(): CallLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as CallLogEntry[];
  } catch {
    return [];
  }
}

function write(entries: CallLogEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // quota exceeded or private mode — silently ignore
  }
}

export function getCallLog(): CallLogEntry[] {
  return read();
}

export function recordCall(entry: Omit<CallLogEntry, 'id'>): CallLogEntry {
  const full: CallLogEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  const existing = read();
  write([full, ...existing]);
  // Notify any subscribed component
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('callLog:updated'));
  }
  return full;
}

export function clearCallLog(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event('callLog:updated'));
}

export function deleteCallLogEntry(id: string): void {
  const existing = read();
  write(existing.filter((e) => e.id !== id));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('callLog:updated'));
  }
}