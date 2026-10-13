/**
 * Client-side image compression.
 * Reduces a 3-5 MB photo to ~200 KB before it enters the message pipeline.
 * This is what prevents the 130 MB+ memory spike per image send.
 */

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

export async function compressImage(file: File): Promise<File> {
  // Only compress images. Leave everything else untouched.
  if (!file.type.startsWith('image/')) return file;

  // Skip GIFs — compression would kill the animation.
  if (file.type === 'image/gif') return file;

  // Skip very small images — already fine.
  if (file.size < 100 * 1024) return file;

  try {
    const img = await loadImage(file);
    const { width, height } = fitInside(
      img.naturalWidth,
      img.naturalHeight,
      MAX_DIMENSION,
    );

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );

    if (!blob) return file;

    // If compression made it bigger (rare — tiny PNGs), keep the original.
    if (blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch (err) {
    console.warn('[compressImage] failed, using original file', err);
    return file;
  }
}

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

function fitInside(w: number, h: number, maxDim: number) {
  if (w <= maxDim && h <= maxDim) return { width: w, height: h };
  const scale = maxDim / Math.max(w, h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}