/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum MediaType {
  Text = 0,
  Image = 1,
  Video = 2,
  Audio = 3,
  File = 4,
}

export enum CallType {
  Audio = 0,
  Video = 1,
}

export enum CallSessionStatus {
  Ringing = 0,
  Active = 1,
  Ended = 2,
  Missed = 3,
  Rejected = 4,
}

export type CallStatus = 'Ringing' | 'Active' | 'Ended' | 'Missed' | 'Rejected';
 
export interface UserProfileDto {
  id: string;
  userHandle: string;
  fullHandle: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: string;
  email? : string;
}

export interface FriendDto {
  friendshipId: number;
  userId: string;
  handle: string;
  fullHandle: string;
  displayName: string;
  avatarUrl?: string;
  isOnline: boolean;
  establishedAt: string;
}

export interface PendingFriendRequestDto {
  friendshipId: number;
  requesterId: string;
  requesterHandle: string;
  requesterDisplayName: string;
  requesterAvatarUrl?: string;
  sentAt: string;
}

export interface SendFriendRequestDto {
  targetIdentifier: string;
}

export interface RespondFriendRequestDto {
  friendshipId: number;
  accept: boolean;
}

export interface DirectMessageDto {
  id: number;
  senderId: string;
  recipientId: string;
  ciphertext: string | null;
  nonce: string | null;
  content: string | null;
  mediaUrl?: string;
  mediaKey?: string;
  mediaType?: number;
  isRead: boolean;
  sentAt: string;

  // Client-only: filled after decryption. Never sent to the server.
  plaintext?: string;
}

export interface SendDirectMessageDto {
  recipientId: string;
  ciphertext: string;
  nonce: string;
  mediaUrl?: string;
  mediaKey?: string;

  mediaType?: number;
}

export interface GroupDto {
  id: number;
  name: string;
  description?: string;
  groupAvatarUrl?: string;
  memberCount: number;
  createdById?: string;
  createdAt?: string;
}

export interface GroupDetailDto extends GroupDto {
  members?: UserProfileDto[];
}

export interface GroupMessageDto {
  id: number;
  groupId: number;
  senderId: string;
  senderDisplayName: string;
  content: string;
  senderAvatarUrl?: string;
  mediaUrl?: string;
  mediaKey?: string;
  mediaType: number;
  sentAt: string;
}

export interface SendGroupMessageDto {
  groupId: number;
  content: string;
  mediaUrl?: string;
  mediaKey?: string;
  mediaType?: number;
}

export interface CreateGroupDto {
  name: string;
  description?: string;
  groupAvatarUrl?: string;
}

export interface AddGroupMemberDto {
  groupId: number;
  userId: string;
}

export interface CallSessionDto {
  sessionId: string;
  callType: number;
  status: number;
  initiatorId?: string;
  peerId?: string;
  groupId?: number;
  startedAt?: string;
  endedAt?: string;
}

export interface InitiateCallDto {
  peerId: string;
  callType: number;
}

export interface IceServerConfigDto {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface RegisterDto {
  userHandle: string;
  displayName: string;
  email: string;
  password: string;
}

export interface LoginDto {
  identifier: string;
  password: string;
}

export interface LoginResponseDto {
  token: string;
}

export interface ConfirmEmailDto {
  email: string;
  token: string;
}

export interface ResendConfirmationDto {
  email: string;
}

export interface ForgetPasswordDto {
  email: string;
}

export interface ResetPasswordDto {
  email: string;
  token: string;
  newPassword: string;
}

export interface UpdateProfileDto {
  displayName?: string;
  avatarUrl?: string;
}

export interface ApiMessage {
  message: string;
  success?: boolean;
  errors?: string[];
}

export interface CallSignalPayload {
  sessionId: string;
  senderId: string;
  signalData: string | Record<string, unknown>;
}

export interface UserPresencePayload {
  userId: string;
  isOnline: boolean;
  lastSeen?: string;
}

export interface CallEndedPayload {
  sessionId: string;
  reason?: string;
}

export interface PresignedMessagesResponse<T> {
  messages: T[];
  presignedUrls: Record<string, string>;
}

const apiTypes = {
  MediaType,
  CallType,
  CallSessionStatus,
};

export default apiTypes;
export { apiTypes };