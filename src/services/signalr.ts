/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';
import {
  CallEndedPayload,
  CallSessionDto,
  CallSignalPayload,
  DirectMessageDto,
  GroupMessageDto,
  SendDirectMessageDto,
  SendGroupMessageDto,
  UserPresencePayload,
} from '../types/api';
import { API_BASE_URL, getAccessToken, refreshAuthToken } from './api';
import { presenceStore } from './presenceStore';

/* ────────────────────────────────────────────────────────── */
/* Listener types                                             */
/* ────────────────────────────────────────────────────────── */

export type DirectMessageListener = (message: DirectMessageDto) => void;
export type GroupMessageListener = (message: GroupMessageDto) => void;
export type UserPresenceListener = (payload: UserPresencePayload) => void;
export type InitialPresenceListListener = (onlineUserIds: unknown[]) => void;
export type IncomingCallListener = (call: CallSessionDto) => void;
export type CallSignalListener = (signal: CallSignalPayload) => void;
export type CallEndedListener = (payload: CallEndedPayload) => void;

export interface DirectTypingPayload {
  senderId: string;
  senderHandle?: string;
  isTyping: boolean;
}
export type DirectTypingListener = (payload: DirectTypingPayload) => void;

export interface GroupTypingPayload {
  groupId: number;
  userId: string;
  handle?: string;
  isTyping: boolean;
}
export type GroupTypingListener = (payload: GroupTypingPayload) => void;

/* ────────────────────────────────────────────────────────── */
/* Payload normalisation                                      */
/* ────────────────────────────────────────────────────────── */

function extractUserIdFromPayload(item: unknown): string | null {
  if (typeof item === 'string' && item.length > 0) return item;
  if (item && typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    const candidates = ['userId', 'id', 'user', 'userName', 'handle'];
    for (const k of candidates) {
      const v = obj[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
  }
  return null;
}

function extractIsOnlineFromPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.isOnline === 'boolean') return obj.isOnline;
  if (typeof obj.online === 'boolean') return obj.online;
  if (typeof obj.status === 'string') return obj.status.toLowerCase() === 'online';
  if (typeof obj.presence === 'string') return obj.presence.toLowerCase() === 'online';
  return false;
}

/* ────────────────────────────────────────────────────────── */
/* Token helper — refresh before reconnect                    */
/* ────────────────────────────────────────────────────────── */

async function getFreshToken(): Promise<string> {
  const token = getAccessToken();
  if (!token) return '';
  try {
    const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: number };
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresInSec = (payload.exp ?? 0) - nowSec;
    if (expiresInSec < 60) {
      try {
        const fresh = await refreshAuthToken();
        return fresh ?? token;
      } catch {
        return token;
      }
    }
  } catch {
    /* non-JWT or malformed — use as-is */
  }
  return token;
}

/* ────────────────────────────────────────────────────────── */
/* Service                                                    */
/* ────────────────────────────────────────────────────────── */

class SignalRService {
  private connection: HubConnection | null = null;
  private isStarting = false;

  private directMessageListeners: Set<DirectMessageListener> = new Set();
  private groupMessageListeners: Set<GroupMessageListener> = new Set();
  private presenceListeners: Set<UserPresenceListener> = new Set();
  private initialPresenceListeners: Set<InitialPresenceListListener> = new Set();
  private incomingCallListeners: Set<IncomingCallListener> = new Set();
  private callSignalListeners: Set<CallSignalListener> = new Set();
  private callEndedListeners: Set<CallEndedListener> = new Set();
  private directTypingListeners: Set<DirectTypingListener> = new Set();
  private groupTypingListeners: Set<GroupTypingListener> = new Set();

  public getConnection(): HubConnection | null {
    return this.connection;
  }

  public getState(): HubConnectionState {
    return this.connection ? this.connection.state : HubConnectionState.Disconnected;
  }

  public isConnected(): boolean {
    return this.connection?.state === HubConnectionState.Connected;
  }

  public async start(): Promise<HubConnection> {
    if (this.connection && this.connection.state === HubConnectionState.Connected) {
      return this.connection;
    }

    if (this.isStarting) {
      while (this.isStarting) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (this.connection && this.connection.state === HubConnectionState.Connected) {
        return this.connection;
      }
    }

    this.isStarting = true;

    try {
      if (this.connection) {
        await this.connection.stop().catch(() => {});
        this.connection = null;
      }

      const baseHubUrl = `${API_BASE_URL.replace(/\/+$/, '')}/hubs/chat`;

      // accessTokenFactory must return string | Promise<string>.
      // Wrapping in an async IIFE guarantees a Promise<string> for
      // both @microsoft/signalr v6 and v7+ type definitions.
      const builder = new HubConnectionBuilder()
        .withUrl(baseHubUrl, {
          accessTokenFactory: async () => {
            const token = await getFreshToken();
            return token;
          },
        })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(LogLevel.Warning);

      this.connection = builder.build();
      this.bindInternalEvents(this.connection);

      // Surface reconnect events so we can see when drops happen.
      this.connection.onreconnecting((err) => {
        console.warn('[SignalR] Reconnecting:', err);
      });
      this.connection.onreconnected((id) => {
        console.log('[SignalR] Reconnected:', id);
      });
      this.connection.onclose((err) => {
        console.warn('[SignalR] Closed:', err);
      });

      await this.connection.start();
      return this.connection;
    } finally {
      this.isStarting = false;
    }
  }

  public async stop(): Promise<void> {
    if (this.connection) {
      await this.connection.stop();
      this.connection = null;
    }
    presenceStore.reset();
  }

  private bindInternalEvents(conn: HubConnection): void {
    /* ── Direct messages ─────────────────────────────── */
    conn.on('ReceiveDirectMessage', (message: DirectMessageDto) => {
      this.directMessageListeners.forEach((listener) => {
        try { listener(message); } catch (err) {
          console.error('Error in ReceiveDirectMessage listener:', err);
        }
      });
    });

    /* ── Group messages ──────────────────────────────── */
    conn.on('ReceiveGroupMessage', (message: GroupMessageDto) => {
      this.groupMessageListeners.forEach((listener) => {
        try { listener(message); } catch (err) {
          console.error('Error in ReceiveGroupMessage listener:', err);
        }
      });
    });

    /* ── Presence ────────────────────────────────────── */
    const handlePresence = (payload: UserPresencePayload, source: string) => {
      const uid = extractUserIdFromPayload(payload);
      if (uid) {
        const online = extractIsOnlineFromPayload(payload);
        if (online) presenceStore.setOnline(uid);
        else presenceStore.setOffline(uid);
      }
      this.presenceListeners.forEach((listener) => {
        try { listener(payload); } catch (err) {
          console.error(`Error in ${source} listener:`, err);
        }
      });
    };

    conn.on('UserStatusChanged', (p: UserPresencePayload) => handlePresence(p, 'UserStatusChanged'));
    conn.on('userstatuschanged', (p: UserPresencePayload) => handlePresence(p, 'userstatuschanged'));
    conn.on('UserPresenceChanged', (p: UserPresencePayload) => handlePresence(p, 'UserPresenceChanged'));

    /* ── Initial presence snapshot ───────────────────── */
    const handleInitialPresence = (onlineUserIds: unknown, source: string) => {
      const list = Array.isArray(onlineUserIds) ? onlineUserIds : [];
      const ids: string[] = [];
      for (const item of list) {
        const id = extractUserIdFromPayload(item);
        if (id) ids.push(id);
      }
      presenceStore.setAll(ids);
      this.initialPresenceListeners.forEach((listener) => {
        try { listener(list); } catch (err) {
          console.error(`Error in ${source} listener:`, err);
        }
      });
    };

    conn.on('InitialPresenceList', (ids: unknown) => handleInitialPresence(ids, 'InitialPresenceList'));
    conn.on('initialpresencelist', (ids: unknown) => handleInitialPresence(ids, 'initialpresencelist'));

    /* ── Typing indicators ───────────────────────────── */
    conn.on('DirectTypingStatus', (data: DirectTypingPayload) => {
      this.directTypingListeners.forEach((listener) => {
        try { listener(data); } catch (err) {
          console.error('Error in DirectTypingStatus listener:', err);
        }
      });
    });

    conn.on('GroupTypingStatus', (data: GroupTypingPayload) => {
      this.groupTypingListeners.forEach((listener) => {
        try { listener(data); } catch (err) {
          console.error('Error in GroupTypingStatus listener:', err);
        }
      });
    });

    /* ── Incoming call (canonical — backend sends callType) ── */
    conn.on('IncomingCall', (call: CallSessionDto) => {
      this.incomingCallListeners.forEach((listener) => {
        try { listener(call); } catch (err) {
          console.error('Error in IncomingCall listener:', err);
        }
      });
    });

    /* ── WebRTC signaling ────────────────────────────── */

    // Offer is delivered by the backend as a discrete event.
    // Note: DO NOT synthesise a second "IncomingCall" here — the
    // backend already sends one. Duplicating causes the callee to
    // see two calls and the second one wins with possibly-wrong data.
    conn.on(
      'ReceiveCallOffer',
      (data: { callerId: string; callerHandle?: string; sdp: unknown; sessionId: string }) => {
        const signalPayload: CallSignalPayload = {
          sessionId: data.sessionId,
          senderId: data.callerId,
          signalData: { type: 'offer', sdp: data.sdp },
        };
        this.callSignalListeners.forEach((listener) => {
          try { listener(signalPayload); } catch (err) {
            console.error('Error in ReceiveCallOffer listener:', err);
          }
        });
      },
    );

    conn.on(
      'ReceiveCallAnswer',
      (data: { responderId: string; sdp: unknown; sessionId: string }) => {
        const payload: CallSignalPayload = {
          sessionId: data.sessionId,
          senderId: data.responderId,
          signalData: { type: 'answer', sdp: data.sdp },
        };
        this.callSignalListeners.forEach((listener) => {
          try { listener(payload); } catch (err) {
            console.error('Error in ReceiveCallAnswer listener:', err);
          }
        });
      },
    );

    conn.on(
      'ReceiveIceCandidate',
      (data: { senderId: string; candidate: unknown; sessionId: string }) => {
        const payload: CallSignalPayload = {
          sessionId: data.sessionId,
          senderId: data.senderId,
          signalData: { type: 'candidate', candidate: data.candidate },
        };
        this.callSignalListeners.forEach((listener) => {
          try { listener(payload); } catch (err) {
            console.error('Error in ReceiveIceCandidate listener:', err);
          }
        });
      },
    );

    /* ── Call terminated ─────────────────────────────── */
    const handleCallTerminated = (payload: CallEndedPayload, source: string) => {
      this.callEndedListeners.forEach((listener) => {
        try { listener(payload); } catch (err) {
          console.error(`Error in ${source} listener:`, err);
        }
      });
    };

    conn.on(
      'CallTerminated',
      (data: { terminatedBy: string; sessionId: string; reason?: string }) => {
        handleCallTerminated(
          { sessionId: data.sessionId, endedBy: data.terminatedBy },
          'CallTerminated',
        );
      },
    );
    conn.on('CallEnded', (p: CallEndedPayload) => handleCallTerminated(p, 'CallEnded'));
  }

  /* ────────────────────────────────────────────────────── */
  /* Subscriptions                                          */
  /* ────────────────────────────────────────────────────── */

  public onReceiveDirectMessage(cb: DirectMessageListener): () => void {
    this.directMessageListeners.add(cb);
    return () => { this.directMessageListeners.delete(cb); };
  }
  public onReceiveGroupMessage(cb: GroupMessageListener): () => void {
    this.groupMessageListeners.add(cb);
    return () => { this.groupMessageListeners.delete(cb); };
  }
  public onUserPresenceChanged(cb: UserPresenceListener): () => void {
    this.presenceListeners.add(cb);
    return () => { this.presenceListeners.delete(cb); };
  }
  public onInitialPresenceList(cb: InitialPresenceListListener): () => void {
    this.initialPresenceListeners.add(cb);
    return () => { this.initialPresenceListeners.delete(cb); };
  }
  public onIncomingCall(cb: IncomingCallListener): () => void {
    this.incomingCallListeners.add(cb);
    return () => { this.incomingCallListeners.delete(cb); };
  }
  public onCallSignal(cb: CallSignalListener): () => void {
    this.callSignalListeners.add(cb);
    return () => { this.callSignalListeners.delete(cb); };
  }
  public onCallEnded(cb: CallEndedListener): () => void {
    this.callEndedListeners.add(cb);
    return () => { this.callEndedListeners.delete(cb); };
  }
  public onDirectTyping(cb: DirectTypingListener): () => void {
    this.directTypingListeners.add(cb);
    return () => { this.directTypingListeners.delete(cb); };
  }
  public onGroupTyping(cb: GroupTypingListener): () => void {
    this.groupTypingListeners.add(cb);
    return () => { this.groupTypingListeners.delete(cb); };
  }

  /* ────────────────────────────────────────────────────── */
  /* Invokes                                                */
  /* ────────────────────────────────────────────────────── */

  public async sendDirectMessage(dto: SendDirectMessageDto): Promise<void> {
    const conn = await this.ensureConnected();
    await conn.invoke('SendDirectMessage', dto);
  }

  public async sendDirectTyping(recipientId: string, isTyping: boolean): Promise<void> {
    try {
      const conn = await this.ensureConnected();
      await conn.invoke('SendDirectTyping', recipientId, isTyping);
    } catch {
      /* best-effort */
    }
  }

  public async sendGroupTyping(groupId: number, isTyping: boolean): Promise<void> {
    try {
      const conn = await this.ensureConnected();
      await conn.invoke('SendGroupTyping', groupId, isTyping);
    } catch {
      /* best-effort */
    }
  }

  public async joinGroupChannel(groupId: number): Promise<void> {
    const conn = await this.ensureConnected();
    await conn.invoke('JoinGroupRoom', groupId);
  }

  public async leaveGroupChannel(groupId: number): Promise<void> {
    const conn = await this.ensureConnected();
    await conn.invoke('LeaveGroupRoom', groupId);
  }

  public async sendGroupMessage(dto: SendGroupMessageDto): Promise<void> {
    const conn = await this.ensureConnected();
    await conn.invoke('SendGroupMessage', dto);
  }

  public async sendCallOffer(targetUserId: string, sdpOffer: unknown, sessionId: string): Promise<void> {
    const conn = await this.ensureConnected();
    await conn.invoke('SendCallOffer', targetUserId, sdpOffer, sessionId);
  }

  public async sendCallAnswer(targetUserId: string, sdpAnswer: unknown, sessionId: string): Promise<void> {
    const conn = await this.ensureConnected();
    await conn.invoke('SendCallAnswer', targetUserId, sdpAnswer, sessionId);
  }

  public async sendIceCandidate(targetUserId: string, iceCandidate: unknown, sessionId: string): Promise<void> {
    const conn = await this.ensureConnected();
    await conn.invoke('SendIceCandidate', targetUserId, iceCandidate, sessionId);
  }

  public async terminateCall(targetUserId: string, sessionId: string, reason: string): Promise<void> {
    const conn = await this.ensureConnected();
    await conn.invoke('RejectOrEndCall', targetUserId, sessionId, reason);
  }

  public async sendCallSignal(
    sessionId: string,
    targetUserId: string,
    signalData: string | Record<string, unknown>,
  ): Promise<void> {
    let parsed: Record<string, unknown>;
    if (typeof signalData === 'string') {
      try { parsed = JSON.parse(signalData) as Record<string, unknown>; }
      catch { return; }
    } else {
      parsed = signalData;
    }

    const type = parsed.type as string | undefined;
    if (type === 'offer') await this.sendCallOffer(targetUserId, parsed.sdp, sessionId);
    else if (type === 'answer') await this.sendCallAnswer(targetUserId, parsed.sdp, sessionId);
    else if (type === 'candidate') await this.sendIceCandidate(targetUserId, parsed.candidate, sessionId);
  }

  public async notifyCallEnded(sessionId: string, targetUserId?: string): Promise<void> {
    if (!targetUserId) return;
    await this.terminateCall(targetUserId, sessionId, 'ended');
  }

  private async ensureConnected(): Promise<HubConnection> {
    if (!this.connection) {
      return this.start();
    }

    if (this.connection.state === HubConnectionState.Connected) {
      return this.connection;
    }

    // In-flight connection: wait for it to settle instead of
    // tearing it down. Prevents mid-call ICE drops when SignalR
    // is reconnecting.
    if (
      this.connection.state === HubConnectionState.Connecting ||
      this.connection.state === HubConnectionState.Reconnecting
    ) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const state = this.connection.state;
        if (state === HubConnectionState.Connected) {
          return this.connection;
        }
        if (state === HubConnectionState.Disconnected) {
          break; // dead — fall through to restart
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // Disconnected → restart
    return this.start();
  }
}

const signalRService = new SignalRService();

export default signalRService;
export { signalRService };