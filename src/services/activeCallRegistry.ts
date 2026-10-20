/**
 * Shared registry of the currently-active call, if any.
 *
 * Both call systems publish here:
 *   - CallContext (1-on-1)  → kind: '1on1'
 *   - useGroupCall (group)  → kind: 'group'
 *
 * Each subscribes to block starting a call of the other kind. Neither
 * needs to import the other; this is the only shared surface.
 *
 * At most one call can be active at a time across both kinds.
 */

export type CallKind = '1on1' | 'group';

export interface ActiveCallEntry {
  kind: CallKind;
  /** Ends/leaves the call. Fire-and-forget. */
  leave: () => void | Promise<void>;
  /** Human-readable label for toasts (peer name / group name). */
  label?: string;
}

const registry = new Map<CallKind, ActiveCallEntry>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) {
    try { l(); } catch { /* ignore listener failures */ }
  }
}

export const activeCallRegistry = {
  register(entry: ActiveCallEntry): void {
    registry.set(entry.kind, entry);
    emit();
  },

  unregister(kind: CallKind): void {
    if (registry.delete(kind)) emit();
  },

  get(kind: CallKind): ActiveCallEntry | undefined {
    return registry.get(kind);
  },

  /**
   * Returns the entry the caller would have to leave to start a call of
   * `excludeKind`. `undefined` means: nothing is blocking.
   */
  blocking(excludeKind?: CallKind): ActiveCallEntry | undefined {
    for (const [kind, entry] of registry) {
      if (kind !== excludeKind) return entry;
    }
    return undefined;
  },

  hasAny(excludeKind?: CallKind): boolean {
    return activeCallRegistry.blocking(excludeKind) !== undefined;
  },

  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
};