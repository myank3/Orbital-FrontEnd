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
/* Case-tolerant field reader                                 */
/* ────────────────────────────────────────────────────────── */

/**
 * Read a field from a SignalR payload regardless of whether the
 * backend sends camelCase, PascalCase, or SCREAMING_CASE keys.
 */
function field<T = unknown>(obj: unknown, ...names: string[]): T | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  for (const name of names) {
    if (name in rec && rec[name] !== undefined) return rec[name] as T;
  }
  // Case-insensitive fallback
  const lower = new Map<string, unknown>();
  for (const [k, v] of Object.entries(rec)) {
    lower.set(k.toLowerCase(), v);
  }
  for (const name of names) {
    const v = lower.get(name.toLowerCase());
    if (v !== undefined) return v as T;
  }
  return undefined;
}

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
/* Token helper                                               */
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
    /* non-JWT — use as-is */
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

      const builder = new HubConnectionBuilder()
        .withUrl(baseHubUrl, {
          accessTokenFactory: async () => await getFreshToken(),
        })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(LogLevel.Warning);

      this.connection = builder.build();
      this.bindInternalEvents(this.connection);

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
      this.directMessageListeners.forEach((l) => {
        try { l(message); } catch (e) { console.error(e); }
      });
    });

    /* ── Group messages ──────────────────────────────── */
    conn.on('ReceiveGroupMessage', (message: GroupMessageDto) => {
      this.groupMessageListeners.forEach((l) => {
        try { l(message); } catch (e) { console.error(e); }
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
      this.presenceListeners.forEach((l) => {
        try { l(payload); } catch (e) { console.error(source, e); }
      });
    };

    conn.on('UserStatusChanged', (p: UserPresencePayload) => handlePresence(p, 'UserStatusChanged'));
    conn.on('userstatuschanged', (p: UserPresencePayload) => handlePresence(p, 'userstatuschanged'));
    conn.on('UserPresenceChanged', (p: UserPresencePayload) => handlePresence(p, 'UserPresenceChanged'));

    /* ── Initial presence ────────────────────────────── */
    const handleInitialPresence = (onlineUserIds: unknown, source: string) => {
      const list = Array.isArray(onlineUserIds) ? onlineUserIds : [];
      const ids: string[] = [];
      for (const item of list) {
        const id = extractUserIdFromPayload(item);
        if (id) ids.push(id);
      }
      presenceStore.setAll(ids);
      this.initialPresenceListeners.forEach((l) => {
        try { l(list); } catch (e) { console.error(source, e); }
      });
    };

    conn.on('InitialPresenceList', (ids: unknown) => handleInitialPresence(ids, 'InitialPresenceList'));
    conn.on('initialpresencelist', (ids: unknown) => handleInitialPresence(ids, 'initialpresencelist'));

    /* ── Typing ──────────────────────────────────────── */
    conn.on('DirectTypingStatus', (data: DirectTypingPayload) => {
      this.directTypingListeners.forEach((l) => {
        try { l(data); } catch (e) { console.error(e); }
      });
    });
    conn.on('GroupTypingStatus', (data: GroupTypingPayload) => {
      this.groupTypingListeners.forEach((l) => {
        try { l(data); } catch (e) { console.error(e); }
      });
    });

    /* ── Incoming call ───────────────────────────────── */
    conn.on('IncomingCall', (raw: unknown) => {
      const call: CallSessionDto = {
        sessionId: String(field<string>(raw, 'sessionId', 'SessionId') ?? ''),
        callType: Number(field<number>(raw, 'callType', 'CallType') ?? 0),
        status: Number(field<number>(raw, 'status', 'Status') ?? 0),
        initiatorId: field<string>(raw, 'initiatorId', 'InitiatorId'),
        peerId: field<string>(raw, 'peerId', 'PeerId') ?? null,
        groupId: field<number>(raw, 'groupId', 'GroupId') ?? null,
        startedAt: field<string>(raw, 'startedAt', 'StartedAt'),
        endedAt: field<string>(raw, 'endedAt', 'EndedAt'),
      };
      this.incomingCallListeners.forEach((l) => {
        try { l(call); } catch (e) { console.error(e); }
      });
    });

    /* ── WebRTC signaling ────────────────────────────── */

    conn.on('ReceiveCallOffer', (raw: unknown) => {
      const callerId = field<string>(raw, 'callerId', 'CallerId');
      const sdp = field<string>(raw, 'sdp', 'Sdp', 'sdpOffer', 'SdpOffer');
      const sessionId = field<string>(raw, 'sessionId', 'SessionId');

      if (!callerId || !sdp || !sessionId) {
        console.warn('[SignalR] ReceiveCallOffer — missing fields:', {
          hasCallerId: !!callerId,
          hasSdp: !!sdp,
          hasSessionId: !!sessionId,
          raw,
        });
        return;
      }

      const payload: CallSignalPayload = {
        sessionId: String(sessionId),
        senderId: callerId,
        signalData: { type: 'offer', sdp },
      };
      this.callSignalListeners.forEach((l) => {
        try { l(payload); } catch (e) { console.error(e); }
      });
    });

    conn.on('ReceiveCallAnswer', (raw: unknown) => {
      const responderId = field<string>(raw, 'responderId', 'ResponderId', 'senderId', 'SenderId');
      const sdp = field<string>(raw, 'sdp', 'Sdp', 'sdpAnswer', 'SdpAnswer');
      const sessionId = field<string>(raw, 'sessionId', 'SessionId');

      if (!responderId || !sdp || !sessionId) {
        console.warn('[SignalR] ReceiveCallAnswer — missing fields:', {
          hasResponderId: !!responderId,
          hasSdp: !!sdp,
          hasSessionId: !!sessionId,
          raw,
        });
        return;
      }

      const payload: CallSignalPayload = {
        sessionId: String(sessionId),
        senderId: responderId,
        signalData: { type: 'answer', sdp },
      };
      this.callSignalListeners.forEach((l) => {
        try { l(payload); } catch (e) { console.error(e); }
      });
    });

    conn.on('ReceiveIceCandidate', (raw: unknown) => {
      const senderId = field<string>(raw, 'senderId', 'SenderId');
      const candidate = field<unknown>(raw, 'candidate', 'Candidate');
      const sessionId = field<string>(raw, 'sessionId', 'SessionId');

      if (!senderId || !candidate || !sessionId) {
        console.warn('[SignalR] ReceiveIceCandidate — missing fields:', {
          hasSenderId: !!senderId,
          hasCandidate: !!candidate,
          hasSessionId: !!sessionId,
          raw,
        });
        return;
      }

      const payload: CallSignalPayload = {
        sessionId: String(sessionId),
        senderId,
        signalData: { type: 'candidate', candidate: candidate as RTCIceCandidateInit },
      };
      this.callSignalListeners.forEach((l) => {
        try { l(payload); } catch (e) { console.error(e); }
      });
    });

    /* ── Call terminated ─────────────────────────────── */
    const handleCallTerminated = (raw: unknown, source: string) => {
      const sessionId = field<string>(raw, 'sessionId', 'SessionId');
      if (!sessionId) {
        console.warn(`[SignalR] ${source} — missing sessionId:`, raw);
        return;
      }
      const payload: CallEndedPayload = {
        sessionId: String(sessionId),
        endedBy: field<string>(raw, 'endedBy', 'EndedBy', 'terminatedBy', 'TerminatedBy'),
        reason: field<string>(raw, 'reason', 'Reason'),
      };
      this.callEndedListeners.forEach((l) => {
        try { l(payload); } catch (e) { console.error(source, e); }
      });
    };

    conn.on('CallTerminated', (raw: unknown) => handleCallTerminated(raw, 'CallTerminated'));
    conn.on('CallEnded', (raw: unknown) => handleCallTerminated(raw, 'CallEnded'));
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
    } catch { /* best-effort */ }
  }

  public async sendGroupTyping(groupId: number, isTyping: boolean): Promise<void> {
    try {
      const conn = await this.ensureConnected();
      await conn.invoke('SendGroupTyping', groupId, isTyping);
    } catch { /* best-effort */ }
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

  /**
   * Send a WebRTC signal (offer / answer / candidate) to the peer.
   * The backend's `RejectOrEndCall` accepts `(targetUserId, sessionId, reason)`.
   */
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
    const conn = await this.ensureConnected();

    if (type === 'offer') {
      await conn.invoke('SendCallOffer', targetUserId, parsed.sdp, sessionId);
    } else if (type === 'answer') {
      await conn.invoke('SendCallAnswer', targetUserId, parsed.sdp, sessionId);
    } else if (type === 'candidate') {
      await conn.invoke('SendIceCandidate', targetUserId, parsed.candidate, sessionId);
    }
  }

  public async notifyCallEnded(sessionId: string, targetUserId?: string): Promise<void> {
    if (!targetUserId) return;
    const conn = await this.ensureConnected();
    await conn.invoke('RejectOrEndCall', targetUserId, sessionId, 'ended');
  }

  private async ensureConnected(): Promise<HubConnection> {
    if (!this.connection) return this.start();

    if (this.connection.state === HubConnectionState.Connected) {
      return this.connection;
    }

    if (
      this.connection.state === HubConnectionState.Connecting ||
      this.connection.state === HubConnectionState.Reconnecting
    ) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const state = this.connection.state;
        if (state === HubConnectionState.Connected) return this.connection;
        if (state === HubConnectionState.Disconnected) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return this.start();
  }
}

const signalRService = new SignalRService();

export default signalRService;
export { signalRService };