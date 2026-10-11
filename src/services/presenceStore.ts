/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared presence cache.
 *
 * Presence events (UserStatusChanged, InitialPresenceList) arrive over
 * SignalR regardless of which component is mounted. We keep the current
 * online set in a module-scoped store so any component can read it
 * synchronously and subscribe to changes — avoiding the race where
 * getFriends() and the initial snapshot resolve out of order.
 */

type PresenceListener = (online: ReadonlySet<string>) => void;

class PresenceStore {
  private online: Set<string> = new Set();
  private listeners: Set<PresenceListener> = new Set();
  private hydrated = false;

  /** True once the initial snapshot has arrived from the server. */
  public isHydrated(): boolean {
    return this.hydrated;
  }

  /** Read the current online set (immutable snapshot). */
  public getOnline(): ReadonlySet<string> {
    return this.online;
  }

  /** Is the given user currently online? */
  public isOnline(userId: string | null | undefined): boolean {
    if (!userId) return false;
    return this.online.has(userId);
  }

  /** Replace the entire set (called when InitialPresenceList arrives). */
  public setAll(userIds: Iterable<string>): void {
    this.online = new Set(userIds);
    this.hydrated = true;
    this.emit();
  }

  /** Mark a single user online. */
  public setOnline(userId: string): void {
    if (this.online.has(userId)) return;
    this.online.add(userId);
    this.emit();
  }

  /** Mark a single user offline. */
  public setOffline(userId: string): void {
    if (!this.online.has(userId)) return;
    this.online.delete(userId);
    this.emit();
  }

  /** Clear everything (on logout / disconnect). */
  public reset(): void {
    this.online = new Set();
    this.hydrated = false;
    this.emit();
  }

  /** Subscribe to changes. Fires immediately with the current state. */
  public subscribe(listener: PresenceListener): () => void {
    this.listeners.add(listener);
    try {
      listener(this.online);
    } catch (err) {
      console.error('presenceStore subscriber error:', err);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.online);
      } catch (err) {
        console.error('presenceStore listener error:', err);
      }
    }
  }
}

export const presenceStore = new PresenceStore();