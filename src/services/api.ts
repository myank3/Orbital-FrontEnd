/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import {
  ApiMessage,
  CallSessionDto,
  CallStatus,
  ConfirmEmailDto,
  CreateGroupDto,
  DirectMessageDto,
  ForgetPasswordDto,
  FriendDto,
  GroupDetailDto,
  GroupDto,
  GroupMessageDto,
  IceServerConfigDto,
  InitiateCallDto,
  LoginDto,
  LoginResponseDto,
  PendingFriendRequestDto,
  PresignedMessagesResponse,
  RegisterDto,
  ResendConfirmationDto,
  ResetPasswordDto,
  RespondFriendRequestDto,
  SendDirectMessageDto,
  SendFriendRequestDto,
  SendGroupMessageDto,
  UpdateProfileDto,
  UserProfileDto,
} from '../types/api';

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'https://orbital.runasp.net';

export const TOKEN_KEY = 'orbital.token';
export const REFRESH_TOKEN_KEY = 'refreshToken';
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/* ────────────────────────────────────────────────────────── */
/* Native-safe Token Management                               */
/* ────────────────────────────────────────────────────────── */

let memoryToken: string | null = null;

/** MUST be called in main.tsx before the app renders */
export async function initAuthToken(): Promise<void> {
  try {
    const { value } = await Preferences.get({ key: TOKEN_KEY });
    memoryToken = value;
  } catch (e) {
    console.error('[auth] Failed to load token from native storage', e);
  }
}

export function getAccessToken(): string | null {
  return memoryToken;
}

export function setAccessToken(token: string | null): void {
  memoryToken = token;
  if (token) {
    void Preferences.set({ key: TOKEN_KEY, value: token }).catch(() => {});
  } else {
    void Preferences.remove({ key: TOKEN_KEY }).catch(() => {});
  }
}

/**
 * Refresh the access token if it's expired or about to expire.
 * Uses the httpOnly refresh cookie (web) OR Capacitor Preferences (mobile).
 */
export async function refreshAuthToken(): Promise<string | null> {
  const current = getAccessToken();

  // 1. If token exists and is valid for > 60s, return it immediately
  if (current) {
    try {
      const payload = JSON.parse(atob(current.split('.')[1])) as { exp?: number };
      const nowSec = Math.floor(Date.now() / 1000);
      const expiresInSec = (payload.exp ?? 0) - nowSec;
      if (expiresInSec > 60) return current;
    } catch {
      /* non-JWT or malformed — try to refresh below */
    }
  }

  // 2. Try to use the refresh token
  try {
    // Get the refresh token from Capacitor Preferences (saved during login or deep link)
    const { value: storedRefreshToken } = await Preferences.get({ key: REFRESH_TOKEN_KEY });

    const res = await fetch(
      `${API_BASE_URL.replace(/\/+$/, '')}/api/Auth/refresh`,
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(Capacitor.isNativePlatform() ? { 'X-Client-Type': 'mobile' } : {})
        },
        credentials: 'include', // Fallback for web cookies
        body: JSON.stringify({ refreshToken: storedRefreshToken || undefined }),
      },
    );

    if (!res.ok) return current;

    const data = (await res.json()) as LoginResponseDto;
    
    if (data.accessToken) {
      setAccessToken(data.accessToken);
      if (data.refreshToken) {
        await Preferences.set({ key: REFRESH_TOKEN_KEY, value: data.refreshToken });
      }
      return data.accessToken;
    }
    return current;
  } catch {
    return current;
  }
}

export function extractErrorMessage(
  error: unknown,
  fallback = 'A network or server error occurred',
): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const r = error as Record<string, unknown>;
    if (typeof r.detail === 'string' && r.detail) return r.detail;
    if (typeof r.message === 'string' && r.message) return r.message;
    if (typeof r.error === 'string' && r.error) return r.error;
    if (typeof r.title === 'string' && r.title) return r.title;
    if (Array.isArray(r.errors)) {
      return (r.errors as unknown[])
        .map((err) => (typeof err === 'string' ? err : JSON.stringify(err)))
        .join(', ');
    }
    if (typeof r.errors === 'object' && r.errors !== null) {
      const fieldErrors = r.errors as Record<string, string[]>;
      return Object.values(fieldErrors).flat().join(', ');
    }
  }
  return fallback;
}

export function validateFileSize(file: File): { valid: boolean; error?: string; mediaType: number } {
  if (file.size <= 0) {
    return { valid: false, error: 'File is empty.', mediaType: 0 };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: 'File size exceeds 5 MB limit.', mediaType: 0 };
  }
  let mediaType = 4;
  if (file.type.startsWith('image/')) mediaType = 1;
  else if (file.type.startsWith('video/')) mediaType = 2;
  else if (file.type.startsWith('audio/')) mediaType = 3;
  return { valid: true, mediaType };
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function applyPresignedUrls<T extends { mediaKey?: string; mediaUrl?: string }>(
  messages: T[],
  presignedUrls: Record<string, string> | undefined | null,
): T[] {
  if (!messages) return [];
  if (!presignedUrls || messages.length === 0) return messages;
  let changed = false;
  const next = messages.map((m) => {
    if (m.mediaKey && presignedUrls[m.mediaKey]) {
      changed = true;
      return { ...m, mediaUrl: presignedUrls[m.mediaKey] };
    }
    return m;
  });
  return changed ? next : messages;
}

interface RequestConfig extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
  skipAuth?: boolean;
  _retry?: boolean;
}

async function request<T>(endpoint: string, config: RequestConfig = {}): Promise<T> {
  const { headers = {}, skipAuth = false, _retry = false, ...customOptions } = config;

  if (!skipAuth) {
    await refreshAuthToken();
  }

  const url = endpoint.startsWith('http')
    ? endpoint
    : `${API_BASE_URL.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;

  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  };

  if (!(customOptions.body instanceof FormData)) {
    if (!requestHeaders['Content-Type']) {
      requestHeaders['Content-Type'] = 'application/json';
    }
  }

  if (!skipAuth) {
    const token = getAccessToken();
    if (token) {
      requestHeaders.Authorization = `Bearer ${token}`;
    }
  }

  // 🔥 Add native header so the backend knows to return refresh tokens in the JSON
  if (Capacitor.isNativePlatform()) {
    requestHeaders['X-Client-Type'] = 'mobile';
  }

  const response = await fetch(url, {
    headers: requestHeaders,
    credentials: 'include',
    ...customOptions,
  });

  if (response.status === 401) {
    if (!skipAuth && !_retry) {
      const fresh = await refreshAuthToken();

      if (fresh && fresh !== getAccessToken()) {
        return request<T>(endpoint, { ...config, _retry: true });
      }
    }

    if (typeof window !== 'undefined') {
      let reason: string | null = null;
      try {
        const raw = await response.text();
        if (raw) {
          try {
            const body = JSON.parse(raw) as { message?: string };
            reason = body?.message ?? null;
          } catch { /* not json */ }
        }
      } catch { /* consumed */ }
      if (reason) {
        sessionStorage.setItem('orbital.auth.reason', reason);
      }
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
    throw new Error('Unauthorized');
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  const raw = await response.text();

  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const errorDetail = parsed ?? raw;
    const message =
      extractErrorMessage(errorDetail) ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (parsed !== null) {
    return parsed as T;
  }

  return raw as unknown as T;
}

export async function uploadToR2(
  uploadUrl: string,
  file: File | Blob,
  contentType: string,
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });

  if (!response.ok) {
    throw new Error(
      `R2 upload failed (${response.status}). ` +
      `This usually means the Content-Type doesn't match what was signed.`,
    );
  }
}

const apiService = {
  getAccessToken,
  setAccessToken,
  extractErrorMessage,
  validateFileSize,
  formatFileSize,
  uploadToR2,

  async register(dto: RegisterDto): Promise<void> {
    await request<void>('/api/Auth/register', {
      method: 'POST',
      body: JSON.stringify({
        userHandle: dto.userHandle.trim().toLowerCase().replace('@orbit', ''),
        displayName: dto.displayName.trim(),
        email: dto.email.trim(),
        password: dto.password,
      }),
      skipAuth: true,
    });
  },

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    return request<LoginResponseDto>('/api/Auth/login', {
      method: 'POST',
      body: JSON.stringify({
        identifier: dto.identifier.trim(),
        password: dto.password,
      }),
      skipAuth: true,
    });
  },

  async refresh(refreshToken?: string): Promise<LoginResponseDto> {
    const result = await request<LoginResponseDto>('/api/Auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
      skipAuth: true,
    });
    // 🔥 FIXED: Use accessToken instead of token
    if (result?.accessToken) setAccessToken(result.accessToken);
    return result;
  },

  async logout(): Promise<void> {
    try {
      await request<void>('/api/Auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      await Preferences.remove({ key: REFRESH_TOKEN_KEY });
    }
  },

  async confirmEmail(dto: ConfirmEmailDto): Promise<ApiMessage> {
    return request<ApiMessage>('/api/Auth/confirm-email', {
      method: 'POST',
      body: JSON.stringify({
        email: dto.email.trim(),
        token: dto.token.trim(),
      }),
      skipAuth: true,
    });
  },

  async resendConfirmation(dto: ResendConfirmationDto): Promise<ApiMessage> {
    return request<ApiMessage>('/api/Auth/resend-confirmation', {
      method: 'POST',
      body: JSON.stringify({ email: dto.email.trim() }),
      skipAuth: true,
    });
  },

  async forgetPassword(dto: ForgetPasswordDto): Promise<ApiMessage> {
    return request<ApiMessage>('/api/Auth/forget-password', {
      method: 'POST',
      body: JSON.stringify({ email: dto.email.trim() }),
      skipAuth: true,
    });
  },

  async resetPassword(dto: ResetPasswordDto): Promise<ApiMessage> {
    return request<ApiMessage>('/api/Auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        email: dto.email.trim(),
        token: dto.token.trim(),
        newPassword: dto.newPassword,
      }),
      skipAuth: true,
    });
  },

  async getMyProfile(): Promise<UserProfileDto> {
    return request<UserProfileDto>('/api/User/profile', { method: 'GET' });
  },

  async getUserProfile(userId: string): Promise<UserProfileDto> {
    return request<UserProfileDto>(
      `/api/User/profile/${encodeURIComponent(userId)}`,
      { method: 'GET' },
    );
  },

  async searchUsers(query: string, take = 30): Promise<UserProfileDto[]> {
    const params = new URLSearchParams({
      q: query.trim(),
      take: take.toString(),
    });
    return request<UserProfileDto[]>(
      `/api/User/search?${params.toString()}`,
      { method: 'GET' },
    );
  },

  async updateProfile(dto: UpdateProfileDto): Promise<UserProfileDto> {
    return request<UserProfileDto>('/api/User/profile', {
      method: 'PUT',
      body: JSON.stringify(dto),
    });
  },

  async getFriends(): Promise<FriendDto[]> {
    return request<FriendDto[]>('/api/Friendship/list', { method: 'GET' });
  },

  async getPendingRequests(): Promise<PendingFriendRequestDto[]> {
    try {
      return await request<PendingFriendRequestDto[]>('/api/Friendship/pending', {
        method: 'GET',
      });
    } catch {
      return [];
    }
  },

  async sendFriendRequest(dto: SendFriendRequestDto): Promise<ApiMessage> {
    return request<ApiMessage>('/api/Friendship/request', {
      method: 'POST',
      body: JSON.stringify({
        targetIdentifier: dto.targetIdentifier.trim(),
      }),
    });
  },

  async respondFriendRequest(dto: RespondFriendRequestDto): Promise<ApiMessage> {
    return request<ApiMessage>('/api/Friendship/respond', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  },

  async unfriend(targetUserId: string): Promise<void> {
    await request<void>(
      `/api/Friendship/unfriend/${encodeURIComponent(targetUserId)}`,
      { method: 'DELETE' },
    );
  },

  async blockUser(targetUserId: string): Promise<void> {
    await request<void>(
      `/api/Friendship/block/${encodeURIComponent(targetUserId)}`,
      { method: 'POST' },
    );
  },

  async unblockUser(targetUserId: string): Promise<void> {
    await request<void>(
      `/api/Friendship/unblock/${encodeURIComponent(targetUserId)}`,
      { method: 'POST' },
    );
  },

  async getBlockedUsers(): Promise<UserProfileDto[]> {
    return request<UserProfileDto[]>('/api/Friendship/blocked', {
      method: 'GET',
    });
  },

  async uploadPublicKey(publicKey: string): Promise<void> {
    await request<void>('/api/Keys/upload', {
      method: 'POST',
      body: JSON.stringify({ publicKey }),
    });
  },

  async getMyPublicKey(): Promise<string | null> {
    const res = await request<{ publicKey: string | null }>(
      '/api/Keys/me',
      { method: 'GET' },
    );
    return res.publicKey ?? null;
  },

  async getUserPublicKey(userId: string): Promise<string> {
    const res = await request<{ publicKey: string }>(
      `/api/Keys/${encodeURIComponent(userId)}`,
      { method: 'GET' },
    );
    return res.publicKey;
  },

  async presignUpload(
    fileName: string,
    contentType: string,
    sizeBytes: number,
    kind: 'dm' | 'group' | 'avatar' = 'dm',
    groupId?: number,
  ): Promise<{ mediaKey: string; uploadUrl: string; expiresAt: string }> {
    return request<{ mediaKey: string; uploadUrl: string; expiresAt: string }>(
      '/api/media/presign-upload',
      {
        method: 'POST',
        body: JSON.stringify({ fileName, contentType, sizeBytes, kind, groupId }),
      },
    );
  },

  async presignDownload(keys: string[]): Promise<Record<string, string>> {
    if (!keys || keys.length === 0) return {};
    return request<Record<string, string>>('/api/media/presign-download', {
      method: 'POST',
      body: JSON.stringify({ keys }),
    });
  },

  async getDmHistory(
    targetUserId: string,
    take = 50,
    beforeId?: number,
  ): Promise<PresignedMessagesResponse<DirectMessageDto>> {
    const params = new URLSearchParams({ take: take.toString() });
    if (typeof beforeId === 'number') {
      params.append('beforeId', beforeId.toString());
    }
    const raw = await request<PresignedMessagesResponse<DirectMessageDto> | DirectMessageDto[]>(
      `/api/DirectMessage/history/${encodeURIComponent(targetUserId)}?${params.toString()}`,
      { method: 'GET' },
    );
    return Array.isArray(raw) ? { messages: raw, presignedUrls: {} } : raw;
  },

  async sendDm(dto: SendDirectMessageDto): Promise<DirectMessageDto> {
    return request<DirectMessageDto>('/api/DirectMessage/send', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  },

  async markDmRead(senderId: string): Promise<void> {
    try {
      await request<void>(
        `/api/DirectMessage/read/${encodeURIComponent(senderId)}`,
        { method: 'POST' },
      );
    } catch { /* ignore */ }
  },

  async deleteDm(messageId: string | number): Promise<void> {
    await request<void>(
      `/api/DirectMessage/${encodeURIComponent(String(messageId))}`,
      { method: 'DELETE' },
    );
  },

  async deleteDmForEveryone(messageId: string | number): Promise<void> {
    await request<void>(
      `/api/DirectMessage/${encodeURIComponent(String(messageId))}/everyone`,
      { method: 'DELETE' },
    );
  },

  async clearConversation(targetUserId: string): Promise<void> {
    await request<void>(
      `/api/DirectMessage/conversation/${encodeURIComponent(targetUserId)}`,
      { method: 'DELETE' },
    );
  },

  async getMyGroups(): Promise<GroupDto[]> {
    return request<GroupDto[]>('/api/Group/my-groups', { method: 'GET' });
  },

  async getGroupDetail(groupId: number): Promise<GroupDetailDto> {
    return request<GroupDetailDto>(`/api/Group/${groupId}`, { method: 'GET' });
  },

  async createGroup(dto: CreateGroupDto): Promise<GroupDto> {
    return request<GroupDto>('/api/Group/create', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  },

  async addGroupMember(groupId: number, userId: string): Promise<void> {
    await request<void>('/api/Group/add-member', {
      method: 'POST',
      body: JSON.stringify({ groupId, userId }),
    });
  },

  async getGroupMessages(
    groupId: number,
    take = 50,
    beforeId?: number,
  ): Promise<PresignedMessagesResponse<GroupMessageDto>> {
    const params = new URLSearchParams({ take: take.toString() });
    if (typeof beforeId === 'number') {
      params.append('beforeId', beforeId.toString());
    }
    const raw = await request<PresignedMessagesResponse<GroupMessageDto> | GroupMessageDto[]>(
      `/api/Group/${groupId}/messages?${params.toString()}`,
      { method: 'GET' },
    );
    return Array.isArray(raw) ? { messages: raw, presignedUrls: {} } : raw;
  },

  async sendGroupMessage(dto: SendGroupMessageDto): Promise<GroupMessageDto> {
    return request<GroupMessageDto>('/api/Group/messages/send', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  },

  async leaveGroup(groupId: number): Promise<void> {
    await request<void>(`/api/Group/${groupId}/leave`, { method: 'POST' });
  },

  async removeGroupMember(groupId: number, targetUserId: string): Promise<void> {
    await request<void>(
      `/api/Group/${groupId}/members/${encodeURIComponent(targetUserId)}`,
      { method: 'DELETE' },
    );
  },

  async deleteGroup(groupId: number): Promise<void> {
    await request<void>(`/api/Group/${groupId}`, { method: 'DELETE' });
  },

  async deleteGroupMessageForEveryone(messageId: string | number): Promise<void> {
    await request<void>(
      `/api/Group/messages/${encodeURIComponent(String(messageId))}`,
      { method: 'DELETE' },
    );
  },

  async getIceServers(): Promise<IceServerConfigDto[]> {
    try {
      const result = await request<IceServerConfigDto | IceServerConfigDto[]>(
        '/api/Call/ice-servers',
        { method: 'GET' },
      );
      if (Array.isArray(result)) return result;
      if (result && Array.isArray((result as IceServerConfigDto).urls)) {
        return [result as IceServerConfigDto];
      }
    } catch { /* fall through */ }
    return [
      {
        urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
      },
    ];
  },

  async initiateCall(dto: InitiateCallDto): Promise<CallSessionDto> {
    return request<CallSessionDto>('/api/Call/initiate', {
      method: 'POST',
      body: JSON.stringify({
        peerId: dto.peerId,
        callType: dto.callType,
      }),
    });
  },

  async endCall(sessionId: string): Promise<void> {
    return request<void>(`/api/Call/${encodeURIComponent(sessionId)}/end`, {
      method: 'POST',
    });
  },

  async updateCallStatus(sessionId: string, status: CallStatus | number): Promise<void> {
    const params = new URLSearchParams({ status: String(status) });
    return request<void>(
      `/api/Call/${encodeURIComponent(sessionId)}/status?${params.toString()}`,
      { method: 'PATCH' },
    );
  },
};

export default apiService;
export { apiService };