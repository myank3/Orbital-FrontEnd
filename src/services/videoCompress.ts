/**
 * Client-side video compression via ffmpeg.wasm — FAST PATH.
 *
 * Goals (in order):
 *   1. Never block the user for minutes. One encode pass, no retries.
 *   2. Output 720p-class (1280px) whenever the size budget allows.
 *   3. Fall back gracefully: if one pass overshoots, return the original
 *      so the caller can surface a clear "too large" error — never
 *      silently spend another 90 s re-encoding.
 *
 * Speed levers used here:
 *   - Single attempt (no retry loop). Retries were 3× the wall-clock
 *     time for no benefit now that R2 accepts the original file too.
 *   - `ultrafast` preset below 400 kbps, `veryfast` above.
 *     `faster` was ~2× slower for ~15% smaller output — not worth it.
 *   - Bitrate ceiling 4500 kbps (plenty for 720p30 in a chat).
 *   - Resolution ladder 426 / 640 / 854 / 1280 — keep 720p unless
 *     the size budget forces a drop.
 *   - `-threads 0` lets ffmpeg-core use its internal worker pool.
 *   - `-tune fastdecode` is a small free win for playback.
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg';

let ffmpegPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { toBlobURL } = await import('@ffmpeg/util');
      const ff = new FFmpeg();
      const base = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
      await ff.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      console.log('[compressVideo] ffmpeg core loaded');
      return ff;
    })();
  }
  return ffmpegPromise;
}

export interface CompressVideoOptions {
  /** Hard cap for the output file, in bytes. */
  maxBytes: number;
  /** Longest edge in pixels. Default 1280 (720p class). */
  maxWidth?: number;
  /** 0..100 progress callback. */
  onProgress?: (pct: number) => void;
}

export async function compressVideo(
  file: File,
  opts: CompressVideoOptions,
): Promise<File> {
  if (!file.type.startsWith('video/')) return file;
  if (file.size <= opts.maxBytes) return file;

  let progressHandler: ((e: { progress: number }) => void) | null = null;

  try {
    // ── Duration probe ───────────────────────────────────────
    let duration = await probeDuration(file);
    if (!isFinite(duration) || duration <= 0) {
      duration = Math.max(1, (file.size * 8) / 300_000);
      console.warn(
        `[compressVideo] duration unknown, estimating ${duration.toFixed(1)}s`,
      );
    }

    console.log(
      `[compressVideo] file="${file.name}" size=${file.size}B duration=${duration.toFixed(2)}s cap=${opts.maxBytes}B`,
    );

    // Single pass. Use 92% of the cap so x264 muxing overhead doesn't
    // push us over. If we overshoot, we return the original — the
    // caller shows a clear error instead of another slow encode.
    const budgetBytes = Math.floor(opts.maxBytes * 0.92);

    const totalKbps = (budgetBytes * 8 * 0.85) / duration / 1000;
    const audioKbps = Math.min(64, Math.max(16, Math.round(totalKbps * 0.2)));
    const videoKbps = Math.floor(totalKbps - audioKbps);

    if (videoKbps < 30) {
      console.warn(
        `[compressVideo] ${duration.toFixed(0)}s needs ${videoKbps}kbps video < 30 minimum — refusing`,
      );
      return file;
    }

    // Resolution ladder — keep 720p unless the budget forces a drop.
    let maxW = opts.maxWidth ?? 1280;
    if (videoKbps < 150) maxW = Math.min(maxW, 426);
    else if (videoKbps < 400) maxW = Math.min(maxW, 640);
    else if (videoKbps < 900) maxW = Math.min(maxW, 854);
    // >= 900 kbps: keep 1280 (720p)

    // Do not cap below what the size budget allows; 4500 kbps is plenty
    // for 720p30. Going higher only adds encode time with no visible gain.
    const targetKbps = Math.min(4500, videoKbps);

    // Speed-first presets. `faster` is ~2× the encode time for ~15%
    // smaller output — not a good trade for a browser WASM encoder.
    const preset = targetKbps < 400 ? 'ultrafast' : 'veryfast';

    console.log(
      `[compressVideo] single pass: budget=${budgetBytes}B target=${targetKbps}kbps audio=${audioKbps}kbps maxW=${maxW} preset=${preset}`,
    );

    const ff = await getFFmpeg();

    const inExt = getExt(file.name) || 'mp4';
    const inName = `in_${Date.now()}.${inExt}`;
    const outName = `out_${Date.now()}.mp4`;

    if (opts.onProgress) {
      progressHandler = ({ progress }) => {
        opts.onProgress!(Math.max(0, Math.min(100, Math.round(progress * 100))));
      };
      ff.on('progress', progressHandler);
    }

    const { fetchFile } = await import('@ffmpeg/util');
    await ff.writeFile(inName, await fetchFile(file));

    try {
      await ff.exec([
        '-i', inName,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-vf', `scale='min(${maxW},iw)':-2:flags=fast_bilinear`,
        '-c:v', 'libx264',
        '-preset', preset,
        '-tune', 'fastdecode',
        '-profile:v', 'main',
        '-level', '4.0',
        '-pix_fmt', 'yuv420p',
        '-b:v', `${targetKbps}k`,
        '-maxrate', `${targetKbps}k`,
        '-bufsize', `${targetKbps * 2}k`,
        '-threads', '0',
        '-c:a', 'aac',
        '-b:a', `${audioKbps}k`,
        '-ac', '2',
        '-movflags', '+faststart',
        outName,
      ]);
    } finally {
      if (progressHandler) {
        try { ff.off('progress', progressHandler); } catch { /* ignore */ }
        progressHandler = null;
      }
    }

    const data = await ff.readFile(outName);
    try { await ff.deleteFile(inName); } catch { /* ignore */ }
    try { await ff.deleteFile(outName); } catch { /* ignore */ }

    if (typeof data === 'string') {
      console.warn('[compressVideo] ffmpeg returned a string; treating as failure');
      return file;
    }

    const bytes = new Uint8Array(data);
    const blob = new Blob([bytes], { type: 'video/mp4' });

    console.log(
      `[compressVideo] output: ${blob.size}B (cap: ${opts.maxBytes}B, ${blob.size <= opts.maxBytes ? 'PASS' : 'overshoot → returning original'})`,
    );

    if (blob.size <= opts.maxBytes) {
      return new File(
        [blob],
        file.name.replace(/\.\w+$/, '.mp4'),
        { type: 'video/mp4' },
      );
    }

    // Single-pass overshoot: return original rather than spend another
    // 60–90 s re-encoding. The caller can surface a clear error.
    return file;
  } catch (err) {
    console.warn('[compressVideo] failed, using original file', err);
    return file;
  }
}

/* ── helpers ─────────────────────────────────────────────── */

function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;

    let timer: number | null = null;

    const cleanup = () => {
      if (timer != null) { window.clearTimeout(timer); timer = null; }
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('error', onError);
      URL.revokeObjectURL(url);
    };
    const onMeta = () => {
      const d = v.duration;
      cleanup();
      resolve(isFinite(d) && d > 0 ? d : 0);
    };
    const onError = () => { cleanup(); resolve(0); };

    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('error', onError);
    v.src = url;

    timer = window.setTimeout(() => { cleanup(); resolve(0); }, 5000);
  });
}

function getExt(name: string): string {
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
}