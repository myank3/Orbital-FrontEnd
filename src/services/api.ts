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
export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB ceiling

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
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
    if (typeof r.detail === 'string' && r.detail) return r.detail; // ProblemDetails
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

export function validateFileSize(file: File): { valid: boolean; error?: string } {
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: 'File size exceeds 25 MB limit.' };
  }
  return { valid: true };
}

/** Human-readable file size — used by the DM composer's pending-file chip. */
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
    credentials: 'include',
    headers: requestHeaders,
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

  // 1. Auth: Register returns empty body (200 OK)
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

  // 2. Auth: Login returns { token }
  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const result = await request<LoginResponseDto>('/api/Auth/login', {
      method: 'POST',
      body: JSON.stringify({
        identifier: dto.identifier.trim(),
        password: dto.password,
      }),
      skipAuth: true,
    });

    if (result?.token) setAccessToken(result.token);
    return result;
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

  // 3. User: Profile fetched from /api/User/profile (NOT /api/Auth/me)
  async getMyProfile(): Promise<UserProfileDto> {
    return request<UserProfileDto>('/api/User/profile', { method: 'GET' });
  },

  async getUserProfile(userId: string): Promise<UserProfileDto> {
    return request<UserProfileDto>(
      `/api/User/profile/${encodeURIComponent(userId)}`,
      { method: 'GET' },
    );
  },

  async updateProfile(dto: UpdateProfileDto): Promise<UserProfileDto> {
    return request<UserProfileDto>('/api/User/profile', {
      method: 'PUT',
      body: JSON.stringify(dto),
    });
  },

  // 4. Friendship Endpoints
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

  /** Remove an existing friendship. Either side can unfriend. */
  async unfriend(targetUserId: string): Promise<void> {
    await request<void>(
      `/api/Friendship/unfriend/${encodeURIComponent(targetUserId)}`,
      { method: 'DELETE' },
    );
  },

  /** Block a user. Prevents friend requests and messaging. */
  async blockUser(targetUserId: string): Promise<void> {
    await request<void>(
      `/api/Friendship/block/${encodeURIComponent(targetUserId)}`,
      { method: 'POST' },
    );
  },

  /** Unblock a user. Reverts the friendship to Pending. */
  async unblockUser(targetUserId: string): Promise<void> {
    await request<void>(
      `/api/Friendship/unblock/${encodeURIComponent(targetUserId)}`,
      { method: 'POST' },
    );
  },

  // 5. Direct Message Endpoints
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
      // Read receipt endpoint may not be mounted; ignore silently
    }
  },

  /**
   * Delete your own DM. Backend enforces ownership — you can only
   * delete messages where you are the sender.
   */
  async deleteDm(messageId: string | number): Promise<void> {
    await request<void>(
      `/api/DirectMessage/${encodeURIComponent(String(messageId))}`,
      { method: 'DELETE' },
    );
  },

  /**
   * Clear the entire DM conversation with a user. Hard delete on the
   * backend — removes the messages for both sides.
   */
  async clearConversation(targetUserId: string): Promise<void> {
    await request<void>(
      `/api/DirectMessage/conversation/${encodeURIComponent(targetUserId)}`,
      { method: 'DELETE' },
    );
  },

  // 6. Group Endpoints
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

  /**
   * Add an existing user to a group. Requester must already be a member.
   * Backend: POST /api/Group/add-member  body: { groupId, userId }
   * Note: backend expects a user GUID, not a handle.
   */
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

  /** Leave a group. If you're the last member, the group is deleted. */
  async leaveGroup(groupId: number): Promise<void> {
    await request<void>(`/api/Group/${groupId}/leave`, { method: 'POST' });
  },

  /** Remove another member from a group. Creator only. */
  async removeGroupMember(groupId: number, targetUserId: string): Promise<void> {
    await request<void>(
      `/api/Group/${groupId}/members/${encodeURIComponent(targetUserId)}`,
      { method: 'DELETE' },
    );
  },

  /** Delete an entire group. Creator only. */
  async deleteGroup(groupId: number): Promise<void> {
    await request<void>(`/api/Group/${groupId}`, { method: 'DELETE' });
  },

  // 7. Call Endpoints
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
      // fall through to STUN fallback
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