/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  HttpTransportType,
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
import { API_BASE_URL, getAccessToken } from './api';
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
          accessTokenFactory: () => getAccessToken() ?? '',
          transport: HttpTransportType.LongPolling,
        })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(LogLevel.Warning);

      this.connection = builder.build();
      this.bindInternalEvents(this.connection);

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
    conn.on('ReceiveDirectMessage', (message: DirectMessageDto) => {
      this.directMessageListeners.forEach((listener) => {
        try { listener(message); } catch (err) {
          console.error('Error in ReceiveDirectMessage listener:', err);
        }
      });
    });

    conn.on('ReceiveGroupMessage', (message: GroupMessageDto) => {
      this.groupMessageListeners.forEach((listener) => {
        try { listener(message); } catch (err) {
          console.error('Error in ReceiveGroupMessage listener:', err);
        }
      });
    });

    // ── Presence ────────────────────────────────────────────
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

    // ── Initial presence snapshot ───────────────────────────
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

    // ── Direct typing indicators ────────────────────────────
    conn.on('DirectTypingStatus', (data: DirectTypingPayload) => {
      this.directTypingListeners.forEach((listener) => {
        try { listener(data); } catch (err) {
          console.error('Error in DirectTypingStatus listener:', err);
        }
      });
    });

    // ── Group typing indicators ─────────────────────────────
    conn.on('GroupTypingStatus', (data: GroupTypingPayload) => {
      this.groupTypingListeners.forEach((listener) => {
        try { listener(data); } catch (err) {
          console.error('Error in GroupTypingStatus listener:', err);
        }
      });
    });

    // ── Incoming call ──────────────────────────────────────
    conn.on('IncomingCall', (call: CallSessionDto) => {
      this.incomingCallListeners.forEach((listener) => {
        try { listener(call); } catch (err) {
          console.error('Error in IncomingCall listener:', err);
        }
      });
    });

    // ── WebRTC call signaling ──────────────────────────────
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
            console.error('Error in ReceiveCallOffer (signal) listener:', err);
          }
        });

        const sdpStr = typeof data.sdp === 'string' ? data.sdp : JSON.stringify(data.sdp ?? '');
        const hasVideo = /m=video/.test(sdpStr);
        const callType = hasVideo ? 1 : 0;

        const syntheticSession: CallSessionDto = {
          sessionId: data.sessionId,
          callType,
          status: 0,
          initiatorId: data.callerId,
          peerId: null,
          groupId: null,
          startedAt: new Date().toISOString(),
          endedAt: null,
        };

        this.incomingCallListeners.forEach((listener) => {
          try { listener(syntheticSession); } catch (err) {
            console.error('Error in ReceiveCallOffer (incoming) listener:', err);
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

    // ── Call terminated ────────────────────────────────────
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

  public onReceiveDirectMessage(callback: DirectMessageListener): () => void {
    this.directMessageListeners.add(callback);
    return () => { this.directMessageListeners.delete(callback); };
  }

  public onReceiveGroupMessage(callback: GroupMessageListener): () => void {
    this.groupMessageListeners.add(callback);
    return () => { this.groupMessageListeners.delete(callback); };
  }

  public onUserPresenceChanged(callback: UserPresenceListener): () => void {
    this.presenceListeners.add(callback);
    return () => { this.presenceListeners.delete(callback); };
  }

  public onInitialPresenceList(callback: InitialPresenceListListener): () => void {
    this.initialPresenceListeners.add(callback);
    return () => { this.initialPresenceListeners.delete(callback); };
  }

  public onIncomingCall(callback: IncomingCallListener): () => void {
    this.incomingCallListeners.add(callback);
    return () => { this.incomingCallListeners.delete(callback); };
  }

  public onCallSignal(callback: CallSignalListener): () => void {
    this.callSignalListeners.add(callback);
    return () => { this.callSignalListeners.delete(callback); };
  }

  public onCallEnded(callback: CallEndedListener): () => void {
    this.callEndedListeners.add(callback);
    return () => { this.callEndedListeners.delete(callback); };
  }

  public onDirectTyping(callback: DirectTypingListener): () => void {
    this.directTypingListeners.add(callback);
    return () => { this.directTypingListeners.delete(callback); };
  }

  public onGroupTyping(callback: GroupTypingListener): () => void {
    this.groupTypingListeners.add(callback);
    return () => { this.groupTypingListeners.delete(callback); };
  }

  /* ────────────────────────────────────────────────────── */
  /* Invokes                                                */
  /* ────────────────────────────────────────────────────── */

  public async sendDirectMessage(dto: SendDirectMessageDto): Promise<void> {
    const conn = await this.ensureConnected();
    await conn.invoke('SendDirectMessage', dto);
  }

  /** Fire-and-forget typing indicator. Ignores errors so a transient
   *  connection issue never blocks the user's typing experience. */
  public async sendDirectTyping(recipientId: string, isTyping: boolean): Promise<void> {
    try {
      const conn = await this.ensureConnected();
      await conn.invoke('SendDirectTyping', recipientId, isTyping);
    } catch {
      // silent — typing indicators are best-effort
    }
  }

  public async sendGroupTyping(groupId: number, isTyping: boolean): Promise<void> {
    try {
      const conn = await this.ensureConnected();
      await conn.invoke('SendGroupTyping', groupId, isTyping);
    } catch {
      // silent
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
    if (!this.connection || this.connection.state !== HubConnectionState.Connected) {
      return this.start();
    }
    return this.connection;
  }
}

const signalRService = new SignalRService();

export default signalRService;
export { signalRService };