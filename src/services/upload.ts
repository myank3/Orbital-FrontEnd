/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MediaType } from '../types/api';
import { API_BASE_URL, extractErrorMessage, getAccessToken } from './api';

/**
 * Hard 5 MB ceiling across the board.
 *
 * The client enforces it here (instant feedback), the server enforces it
 * again in web.config + the upload endpoint, and the DB has a CHECK
 * constraint as the final backstop. None of these three is optional.
 */
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

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

  if (file.size <= 0) {
    return {
      valid: false,
      error: `File "${file.name}" is empty.`,
      mediaType,
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File "${file.name}" is ${formatFileSize(file.size)} — max is ${formatFileSize(MAX_FILE_SIZE)}.`,
      mediaType,
    };
  }

  return { valid: true, mediaType };
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

  // 30 s timeout for uploads — bigger than the API default so slow
  // connections don't fail spuriously, but still bounded.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch(uploadEndpoint, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: formData,
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error('Upload timed out. Please try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

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
    throw new Error(
      extractErrorMessage(errorDetail) || `Upload failed with status ${response.status}`,
    );
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
  if (!finalUrl) {
    throw new Error('Upload succeeded but server returned no URL.');
  }

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