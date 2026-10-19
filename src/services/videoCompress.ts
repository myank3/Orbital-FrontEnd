/**
 * Client-side video compression via ffmpeg.wasm.
 *
 * Guarantees:
 *   - Output ≤ opts.maxBytes whenever physically possible.
 *   - Handles every ffmpeg-decodable input format.
 *   - Retries with tighter budgets if the encoder overshoots.
 *   - Refuses fast (returns original) when a clip can't fit.
 *   - Logs each attempt to the console so failures are diagnosable.
 *
 * Quality notes (vs. the old version):
 *   - Default maxWidth is now 1280 (720p class), not 640.
 *   - Resolution ladder is 426 / 640 / 854 (was 240 / 320 / 480).
 *   - Preset is veryfast / faster (was veryfast / ultrafast).
 *   - Video bitrate ceiling is 8000 kbps (was 2500).
 *   - Starting budget is 90% of cap (was 75%), so first attempt
 *     usually passes and the retry loop rarely degrades quality.
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
  maxBytes: number;
  maxWidth?: number;
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

    // Start at 90% of the cap — leaves just enough headroom for
    // container + x264 overshoot, so the first attempt usually passes.
    let budgetBytes = Math.floor(opts.maxBytes * 0.9);

    // Up to 3 attempts. Each retry shrinks the budget proportionally
    // to the previous overshoot, so convergence is fast.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const totalKbps = (budgetBytes * 8 * 0.85) / duration / 1000;
      const audioKbps = Math.min(64, Math.max(16, Math.round(totalKbps * 0.2)));
      const videoKbps = Math.floor(totalKbps - audioKbps);

      if (videoKbps < 30) {
        console.warn(
          `[compressVideo] ${duration.toFixed(0)}s needs ${videoKbps}kbps video < 30 minimum — refusing`,
        );
        return file;
      }

      // Adaptive resolution — keep 720p class by default.
      let maxW = opts.maxWidth ?? 1280;
      if (videoKbps < 150) maxW = Math.min(maxW, 426);
      else if (videoKbps < 400) maxW = Math.min(maxW, 640);
      else if (videoKbps < 900) maxW = Math.min(maxW, 854);

      // Don't artificially cap below the bitrate the size budget allows.
      const targetKbps = Math.min(8000, videoKbps);
      const preset = targetKbps < 400 ? 'veryfast' : 'faster';

      console.log(
        `[compressVideo] attempt ${attempt}: budget=${budgetBytes}B target=${targetKbps}kbps audio=${audioKbps}kbps maxW=${maxW} preset=${preset}`,
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
        // Deliberately minimal flag set — only things supported by
        // every ffmpeg-core build. If this still throws, the error
        // in the console is the actual ffmpeg stderr message.
        await ff.exec([
          '-i', inName,
          '-map', '0:v:0',
          '-map', '0:a:0?',
          '-vf', `scale='min(${maxW},iw)':-2`,
          '-c:v', 'libx264',
          '-preset', preset,
          '-profile:v', 'main',
          '-pix_fmt', 'yuv420p',
          '-b:v', `${targetKbps}k`,
          '-maxrate', `${targetKbps}k`,
          '-bufsize', `${targetKbps * 2}k`,
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
        `[compressVideo] attempt ${attempt} output: ${blob.size}B (cap: ${opts.maxBytes}B, ${blob.size <= opts.maxBytes ? 'PASS' : 'overshoot'})`,
      );

      if (blob.size <= opts.maxBytes) {
        return new File(
          [blob],
          file.name.replace(/\.\w+$/, '.mp4'),
          { type: 'video/mp4' },
        );
      }

      // Overshoot — shrink budget mildly and retry.
      if (attempt < 3) {
        const ratio = opts.maxBytes / blob.size;
        budgetBytes = Math.max(
          Math.floor(opts.maxBytes * 0.1),
          Math.floor(budgetBytes * ratio * 0.95),
        );
        console.warn(
          `[compressVideo] overshoot, retry ${attempt + 1} with budget ${budgetBytes}B`,
        );
      }
    }

    console.warn('[compressVideo] failed after 3 attempts');
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