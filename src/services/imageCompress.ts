/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Client-side image compression.
 *
 * Two entry points:
 *   compressImage()  — chat attachments. 1920px, q0.92, WebP preferred.
 *   compressAvatar() — profile pictures. 256px, target < 200 KB.
 *
 * Both fall back to the original file on any error, so callers never
 * have to catch a rejected promise from compression.
 */

const IMAGE_MAX_DIMENSION = 1920;
const IMAGE_QUALITY = 0.92;

const AVATAR_MAX_DIMENSION = 256;
const AVATAR_QUALITY = 0.82;
const AVATAR_TARGET_BYTES = 200 * 1024;

/** Whether the browser's canvas can actually encode WebP. */
let webpSupport: boolean | null = null;
function supportsWebp(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    webpSupport = c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.type === 'image/gif') return file; // preserve animation
  if (file.size < 100 * 1024) return file;    // already small

  try {
    const img = await loadImage(file);
    const { width, height } = fitInside(
      img.naturalWidth,
      img.naturalHeight,
      IMAGE_MAX_DIMENSION,
    );

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    const { blob, type, ext } = await encodeCanvas(canvas, IMAGE_QUALITY);
    if (!blob) return file;
    if (blob.size >= file.size) return file;

    return new File([blob], renameTo(file.name, 'image', ext), { type });
  } catch (err) {
    console.warn('[compressImage] failed, using original file', err);
    return file;
  }
}

export async function compressAvatar(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.type === 'image/gif') return file;

  try {
    const img = await loadImage(file);
    const { width, height } = fitInside(
      img.naturalWidth,
      img.naturalHeight,
      AVATAR_MAX_DIMENSION,
    );

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    let quality = AVATAR_QUALITY;
    let result = await encodeCanvas(canvas, quality);
    let blob = result.blob;

    while (blob && blob.size > AVATAR_TARGET_BYTES && quality > 0.4) {
      quality -= 0.15;
      result = await encodeCanvas(canvas, quality);
      blob = result.blob;
    }

    if (!blob) return file;
    if (blob.size >= file.size && file.size < AVATAR_TARGET_BYTES) return file;

    return new File([blob], renameTo(file.name, 'avatar', result.ext), {
      type: result.type,
    });
  } catch (err) {
    console.warn('[compressAvatar] failed, using original file', err);
    return file;
  }
}

/* ── helpers ─────────────────────────────────────────────── */

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Encode a canvas, preferring WebP (≈30% smaller than JPEG at equal
 * perceptual quality). Falls back to JPEG on browsers without canvas
 * WebP encoding.
 */
async function encodeCanvas(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<{ blob: Blob | null; type: string; ext: string }> {
  if (supportsWebp()) {
    const webp = await canvasToBlob(canvas, 'image/webp', quality);
    if (webp && webp.size > 0) {
      return { blob: webp, type: 'image/webp', ext: 'webp' };
    }
  }
  const jpeg = await canvasToBlob(canvas, 'image/jpeg', quality);
  return { blob: jpeg, type: 'image/jpeg', ext: 'jpg' };
}

function fitInside(w: number, h: number, maxDim: number) {
  if (w <= maxDim && h <= maxDim) return { width: w, height: h };
  const scale = maxDim / Math.max(w, h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

function renameTo(originalName: string, fallback: string, ext: string): string {
  const base = originalName.replace(/\.[^.]+$/, '') || fallback;
  return `${base}.${ext}`;
}