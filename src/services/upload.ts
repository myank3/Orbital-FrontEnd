/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MediaType } from '../types/api';
import { API_BASE_URL, extractErrorMessage, getAccessToken } from './api';

export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB ceiling

export interface ValidationResult {
  valid: boolean;
  error?: string;
  mediaType: number;
}

export interface UploadResponse {
  mediaUrl: string;
  mediaType: number;
  fileName: string;
  fileSize: number;
}

export function determineMediaType(file: File): number {
  const mimeType = (file.type || '').toLowerCase();
  const fileName = (file.name || '').toLowerCase();

  if (mimeType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/.test(fileName)) {
    return MediaType.Image; // 1
  }
  if (mimeType.startsWith('video/') || /\.(mp4|webm|ogg|mov|mkv)$/.test(fileName)) {
    return MediaType.Video; // 2
  }
  if (mimeType.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(fileName)) {
    return MediaType.Audio; // 3
  }
  return MediaType.File; // 4
}

export function validateFileSize(file: File): ValidationResult {
  const mediaType = determineMediaType(file);

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File "${file.name}" exceeds the maximum limit of 25 MB (${formatFileSize(file.size)}).`,
      mediaType,
    };
  }

  if (file.size <= 0) {
    return {
      valid: false,
      error: `File "${file.name}" is empty.`,
      mediaType,
    };
  }

  return {
    valid: true,
    mediaType,
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  const normalizedIndex = Math.min(index, units.length - 1);
  const size = bytes / Math.pow(1024, normalizedIndex);
  return `${size.toFixed(1)} ${units[normalizedIndex]}`;
}

export async function uploadAttachment(file: File): Promise<UploadResponse> {
  const validation = validateFileSize(file);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Invalid file attachment');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('mediaType', validation.mediaType.toString());

  const token = getAccessToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const uploadEndpoint = `${API_BASE_URL.replace(/\/+$/, '')}/api/Upload`;

  const response = await fetch(uploadEndpoint, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: formData,
  });

  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    let errorDetail: unknown;
    try {
      errorDetail = await response.json();
    } catch {
      errorDetail = await response.text();
    }
    throw new Error(extractErrorMessage(errorDetail) || `Upload failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    url?: string;
    mediaUrl?: string;
    fileUrl?: string;
    mediaType?: number;
    fileName?: string;
    fileSize?: number;
  };

  const finalUrl = data.mediaUrl ?? data.url ?? data.fileUrl ?? '';

  return {
    mediaUrl: finalUrl,
    mediaType: typeof data.mediaType === 'number' ? data.mediaType : validation.mediaType,
    fileName: data.fileName ?? file.name,
    fileSize: data.fileSize ?? file.size,
  };
}

const uploadService = {
  MAX_FILE_SIZE,
  determineMediaType,
  validateFileSize,
  formatFileSize,
  uploadAttachment,
};

export default uploadService;
export { uploadService };
