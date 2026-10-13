/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
export const MAX_FILE_SIZE = 25 * 1024 * 1024;

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function refreshAuthToken(): Promise<string | null> {
  const current = getAccessToken();
  if (!current) return null;

  try {
    const payload = JSON.parse(atob(current.split('.')[1])) as { exp?: number };
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresInSec = (payload.exp ?? 0) - nowSec;
    if (expiresInSec > 60) return current;
  } catch {
    /* non-JWT or malformed — use as-is */
  }

  try {
    const res = await fetch(
      `${API_BASE_URL.replace(/\/+$/, '')}/api/Auth/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      },
    );

    if (!res.ok) return current;

    const data = (await res.json()) as {
      token?: string;
      accessToken?: string;
    };
    const newToken = data.token ?? data.accessToken ?? null;
    if (newToken) setAccessToken(newToken);
    return newToken ?? current;
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
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: 'File size exceeds 25 MB limit.', mediaType: 0 };
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

interface RequestConfig extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
  skipAuth?: boolean;
}

async function request<T>(endpoint: string, config: RequestConfig = {}): Promise<T> {
  const { headers = {}, skipAuth = false, ...customOptions } = config;

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

  const response = await fetch(url, {
    headers: requestHeaders,
    credentials: 'include',
    ...customOptions,
  });

  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
    throw new Error('Unauthorized');
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');

  if (!response.ok) {
    let errorDetail: unknown;
    if (isJson) {
      try {
        errorDetail = await response.json();
      } catch {
        errorDetail = await response.text();
      }
    } else {
      errorDetail = await response.text();
    }
    const message =
      extractErrorMessage(errorDetail) || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (isJson) {
    return (await response.json()) as T;
  }

  const textData = await response.text();
  try {
    return JSON.parse(textData) as T;
  } catch {
    return textData as unknown as T;
  }
}

const apiService = {
  getAccessToken,
  setAccessToken,
  extractErrorMessage,
  validateFileSize,
  formatFileSize,

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
    });
    if (result?.token) setAccessToken(result.token);
    return result;
  },

  async logout(): Promise<void> {
    try {
      await request<void>('/api/Auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
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

  /* ── E2EE: public key endpoints ──────────────────────── */

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

  /* ── Direct messages ─────────────────────────────────── */

  async getDmHistory(
    targetUserId: string,
    take = 50,
    beforeId?: number,
  ): Promise<DirectMessageDto[]> {
    const params = new URLSearchParams({ take: take.toString() });
    if (typeof beforeId === 'number') {
      params.append('beforeId', beforeId.toString());
    }
    return request<DirectMessageDto[]>(
      `/api/DirectMessage/history/${encodeURIComponent(targetUserId)}?${params.toString()}`,
      { method: 'GET' },
    );
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
    } catch {
      /* ignore */
    }
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

  /* ── Groups ──────────────────────────────────────────── */

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
  ): Promise<GroupMessageDto[]> {
    const params = new URLSearchParams({ take: take.toString() });
    if (typeof beforeId === 'number') {
      params.append('beforeId', beforeId.toString());
    }
    return request<GroupMessageDto[]>(
      `/api/Group/${groupId}/messages?${params.toString()}`,
      { method: 'GET' },
    );
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

  /* ── Calls ───────────────────────────────────────────── */

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
    } catch {
      /* fall through */
    }
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