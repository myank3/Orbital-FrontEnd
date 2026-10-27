/**
 * @file src/pages/Landing.tsx
 * Orbital — v18.3 · "The Thread"
 *
 * ⚡ v18.3 deltas (PC + Android smoothness pass)
 *
 *  PC
 *   · Lenis now uses autoRaf:true on every web platform. Previously the
 *     desktop path called lenis.raf() from useFrame → scroll rate was
 *     clamped to WebGL fps. A 45 fps 3D scene = 45 fps scroll = "laggy".
 *   · Camera smoothing tightened (pos/look lambda 7.5/9.0 → 20 on web,
 *     45 on native app). The laggy-trailing-camera feel is gone.
 *   · store.smooth lambda 28 → 60 (was adding ~180 ms of extra delay).
 *   · Canvas starts at minDpr, AdaptiveResolution ramps up from there.
 *     Previous patch started at maxDpr, which caused first-2s stutter
 *     while shaders compiled at full res.
 *   · Heavy components (Thread/Gates/Portal/Gallery/PostFX) deferred by
 *     2 rAF so the first ~2 frames are cheap and paint is instant.
 *   · Texture upload queue batched 3/rAF + bumped per batch (progressive
 *     card appearance vs one big re-render).
 *   · LUT_STEPS 2048 → 1024; arcLengthDivisions 600 → 360 (halves
 *     module-load time, invisible in use). Strand tubulars 1600 → 1000.
 *   · SMAA added on high tier (fixes jaggies from EffectComposer when
 *     canvas antialias is disabled).
 *
 *  Android / mobile
 *   · AdaptiveResolution enabled on mobile (min 0.65, max 1.05). No
 *     more hard-pinned DPR 1.0 with no recovery path.
 *   · Gates get: per-instance tilt (rotates in local X), scale wobble
 *     with beat-staggered phase, velocity-reactive scale, additive
 *     ghost halo torus, thicker main torus (0.035 → 0.07).
 *   · Backdrop mobile shader: 2-octave fbm noise — texture instead of
 *     flat radial gradient.
 *   · Thread tube radii bumped for mobile so the spine reads.
 *   · Fake bloom overlay (2 radial gradients) since mobile skips PostFX.
 *
 * ROUTES PRESERVED   /login  /register  /downloads/orbital.apk
 */

import React, {
  memo,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Capacitor } from "@capacitor/core";
import { Link } from "react-router-dom";
import Lenis from "lenis";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  EffectComposer,
  Bloom,
  ToneMapping,
  Vignette,
  SMAA,
} from "@react-three/postprocessing";
import { ToneMappingMode, BlendFunction, KernelSize } from "postprocessing";

import {
  motion,
  useReducedMotion,
  AnimatePresence,
  useSpring,
  useScroll,
} from "motion/react";
import {
  ArrowRight,
  Camera,
  Check,
  CheckCheck,
  ChevronLeft,
  Fingerprint,
  LockKeyhole,
  MessageCircle,
  Mic,
  Paperclip,
  Phone,
  Plus,
  Send,
  ShieldCheck,
  Smile,
  Sparkles,
  Video,
  Wifi,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════
   IMAGE MANIFEST
   ═══════════════════════════════════════════════════════════ */
const u = (id: string, w: number, q = 85) => {
  if (id.startsWith("http")) return id;
  if (id.startsWith("px:")) {
    const photoId = id.slice(3);
    return `https://images.pexels.com/photos/${photoId}/pexels-photo-${photoId}.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=${w}&dpr=2`;
  }
  return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&crop=faces,entropy&w=${w}&q=${q}`;
};

const FACE_IDS = {
  ava:    "px:774909",
  sienna: "1524504388940-b1c1722653e1",
  lyra:   "px:1036623",
  nova:   "1534528741775-53994a69daeb",
  iris:   "px:733872",
  anita:  "px:1181686",
  taylor: "1494790108377-be9c29b29330",
  emery:  "px:2379004",
  john:   "1539571696357-5a69c17a67c6",
  sam:    "px:1043474",
  finn:   "px:1222271",
  rowan:  "px:1681010",
} as const;

const SCENE_IDS = {
  runway:    "px:3184291",
  milan:     "1522202176988-66273c2fd55f",
  nyfw:      "px:3182812",
  group1:    "px:3184418",
  manChat:   "px:842567",
  manCall:   "px:4050291",
  tokyo:     "1600880292203-757bb62b4baf",
  paris:     "px:1181396",
  aurora:    "1507679799987-c73779587ccf",
  milkyway:  "px:3184611",
  mountains: "1517048676732-d65bc937f952",
  ocean:     "px:3183150",
} as const;

function toUrls<T extends Record<string, string>>(
  ids: T,
  w: number,
  q: number,
) {
  const out: Record<string, string> = {};
  for (const k of Object.keys(ids)) out[k] = u(ids[k], w, q);
  return out as { [K in keyof T]: string };
}

/* FACE at 640 (cards are small), SCENE at 1200 (fewer MB, invisible at size) */
const FACE = toUrls(FACE_IDS, 640, 88);
const SCENE = toUrls(SCENE_IDS, 1200, 88);

/* Gallery texture atlas — trimmed from 1000/1800 to 800/1400 */
const GALLERY: string[] = [
  ...Object.values(FACE_IDS).map((id) => u(id, 800, 88)),
  ...Object.values(SCENE_IDS).map((id) => u(id, 1400, 88)),
];

if (typeof window !== "undefined") {
  const preloadAvatar = new Image();
  preloadAvatar.decoding = "sync";
  preloadAvatar.src = FACE.ava;
}

/* ═══════════════════════════════════════════════════════════
   CONFIGURATION
   ═══════════════════════════════════════════════════════════ */

const AMBER = "#C8883A";
const CREAM = "#E5D6B8";
const DEEP = "#04060A";

const DOWNLOAD_HREF =
  "https://pub-a90950bf9f0a4b059174e3a9cba7a1c9.r2.dev/Orbital.apk";

const UI_SPRING = { type: "spring", stiffness: 520, damping: 36 } as const;
const CINEMATIC_SPRING = {
  type: "spring",
  stiffness: 240,
  damping: 28,
  mass: 0.5,
} as const;

const TAU = Math.PI * 2;
const FOV = 50;
const TAN_HALF = Math.tan((FOV * Math.PI) / 360);

/* ═══════════════════════════════════════════════════════════
   FRAME-RATE INDEPENDENT MATH
   ═══════════════════════════════════════════════════════════ */

function damp(c: number, t: number, lambda: number, dt: number) {
  return c + (t - c) * (1 - Math.exp(-lambda * dt));
}

function dampVec3(
  c: THREE.Vector3,
  t: THREE.Vector3,
  lambda: number,
  dt: number,
) {
  const a = 1 - Math.exp(-lambda * dt);
  c.x += (t.x - c.x) * a;
  c.y += (t.y - c.y) * a;
  c.z += (t.z - c.z) * a;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampN = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ═══════════════════════════════════════════════════════════
   DEVICE TIER & REFRESH RATE
   ═══════════════════════════════════════════════════════════ */

type Tier = "low" | "mid" | "high";

function useDeviceTier() {
  const [tier, setTier] = useState<Tier>("high");
  useEffect(() => {
    const cores = (navigator as any).hardwareConcurrency ?? 4;
    const mem = (navigator as any).deviceMemory ?? 4;
    const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const dpr = window.devicePixelRatio || 1;
    if (mobile || cores <= 4 || mem <= 3 || dpr > 2.5) setTier("low");
    else if (cores <= 6 || mem <= 6) setTier("mid");
  }, []);
  return tier;
}

function useIsMobile() {
  const [m] = useState(() => {
    if (typeof navigator === "undefined") return false;
    const ua = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const coarse =
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches;
    const narrow = typeof window !== "undefined" && window.innerWidth < 900;
    return ua || (coarse && narrow);
  });
  return m;
}

const REFRESH_STEPS = [60, 75, 90, 100, 120, 144, 165, 240];

function useRefreshRate() {
  const [hz, setHz] = useState(120);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let start = 0;
    const loop = (t: number) => {
      if (frames === 0) start = t;
      frames += 1;
      const span = t - start;
      if (span >= 360 && frames > 10) {
        const measured = (frames * 1000) / span;
        if (measured >= 50) {
          setHz(
            REFRESH_STEPS.reduce(
              (best, v) =>
                Math.abs(v - measured) < Math.abs(best - measured) ? v : best,
              60,
            ),
          );
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return hz;
}

/* ═══════════════════════════════════════════════════════════
   SCROLL STORE
   ═══════════════════════════════════════════════════════════ */

type Store = {
  raw: number;
  smooth: number;
  velocity: number;
  lag: number;
  head: number;
  beatIndex: number;
  beatProgress: number;
};

const store: Store = {
  raw: 0,
  smooth: 0,
  velocity: 0,
  lag: 0,
  head: 0.04,
  beatIndex: 0,
  beatProgress: 0,
};

const SHARED = {
  uTime: { value: 0 },
  uTint: { value: 0 },
  uHead: { value: 0.04 },
};

const beatListeners: Array<(i: number) => void> = [];
let lastBeatIndex = -1;
let _fast = 0;
let _slow = 0;

let lenisInstance: Lenis | null = null;
let maxScrollCache = 1;

/**
 * Lenis strategy (v18.3):
 *   Native app (Capacitor)  → no Lenis. Native compositor scroll.
 *   Everywhere else          → Lenis with autoRaf:true. Its own loop is
 *                              decoupled from WebGL FPS — a 45 fps 3D
 *                              frame can't stall the wheel anymore.
 */
function useSmoothScroll(enabled: boolean, skipLenis: boolean) {
  useEffect(() => {
    if (!enabled || skipLenis) return;
    const lenis = new Lenis({
      lerp: 0.15,
      wheelMultiplier: 1,
      touchMultiplier: 1.5,
      smoothWheel: true,
      autoRaf: true,
    });
    lenisInstance = lenis;
    return () => {
      lenis.destroy();
      lenisInstance = null;
    };
  }, [enabled, skipLenis]);
}

function ScrollDriver() {
  const prev = useRef(0);

  useEffect(() => {
    let lastW = window.innerWidth;

    const measure = () => {
      maxScrollCache = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const y = lenisInstance ? lenisInstance.scroll : window.scrollY;
      store.raw = clamp01(y / maxScrollCache);
    };
    const read = () => {
      const y = lenisInstance ? lenisInstance.scroll : window.scrollY;
      store.raw = clamp01(y / maxScrollCache);
    };
    const onResize = () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      measure();
    };

    measure();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            maxScrollCache = Math.max(
              1,
              document.documentElement.scrollHeight - window.innerHeight,
            );
          })
        : null;
    ro?.observe(document.documentElement);

    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", measure, { passive: true });
    window.addEventListener("load", measure);

    return () => {
      ro?.disconnect();
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", measure);
      window.removeEventListener("load", measure);
    };
  }, []);

  useFrame((state, delta) => {
    if (lenisInstance) {
      store.raw = clamp01(lenisInstance.scroll / maxScrollCache);
    } else {
      store.raw = clamp01(window.scrollY / maxScrollCache);
    }

    // v18.3: lambda 60 (was 28). Lenis already handles smoothing on web;
    // a second aggressive-damp stage just adds perceived lag. Native
    // scroll on mobile is already smooth; we track it tightly.
    const dt = Math.min(delta, 0.05);
    store.smooth = damp(store.smooth, store.raw, 60, dt);
    if (Math.abs(store.raw - store.smooth) < 0.00005) store.smooth = store.raw;

    const raw = (store.smooth - prev.current) / Math.max(dt, 1e-5);
    prev.current = store.smooth;
    store.velocity = damp(store.velocity, raw, 14, dt);

    _fast = damp(_fast, store.velocity, 16, dt);
    _slow = damp(_slow, store.velocity, 4.5, dt);
    store.lag = clampN(_fast - _slow, -0.35, 0.35);

    const beatF = store.smooth * 5;
    const idx = Math.min(5, Math.max(0, Math.floor(beatF + 0.001)));
    store.beatIndex = idx;
    store.beatProgress = beatF - idx;

    SHARED.uTime.value = state.clock.elapsedTime;
    SHARED.uTint.value = store.smooth;
    SHARED.uHead.value = Math.min(1, store.head + 0.035);

    if (idx !== lastBeatIndex) {
      lastBeatIndex = idx;
      for (let k = 0; k < beatListeners.length; k++) beatListeners[k](idx);
    }
  }, -100);

  return null;
}

/* ═══════════════════════════════════════════════════════════
   ADAPTIVE RESOLUTION — v18.3: starts at MIN, ramps up
   ═══════════════════════════════════════════════════════════ */

function AdaptiveResolution({
  min,
  max,
  targetFps,
  mobile,
}: {
  min: number;
  max: number;
  targetFps: number;
  mobile: boolean;
}) {
  const setDpr = useThree((s) => s.setDpr);
  const cur = useRef(min);
  const acc = useRef(0);
  const frames = useRef(0);
  const cooldown = useRef(mobile ? 2 : 3);
  const low = useRef(0);
  const high = useRef(0);

  useEffect(() => {
    // v18.3: start at MIN (not max). Previously started at max → the
    // first ~2 seconds stuttered at full DPR while shaders compiled.
    cur.current = min;
    low.current = 0;
    high.current = 0;
    cooldown.current = mobile ? 2 : 3;
    acc.current = 0;
    frames.current = 0;
    setDpr(min);
  }, [min, setDpr, mobile]);

  useFrame((_, delta) => {
    acc.current += Math.min(delta, 0.1);
    frames.current += 1;
    if (acc.current < 0.5) return;

    const fps = frames.current / acc.current;
    acc.current = 0;
    frames.current = 0;

    if (cooldown.current > 0) {
      cooldown.current -= 1;
      return;
    }

    const target = targetFps * 0.92;
    if (fps < target * (mobile ? 0.86 : 0.85)) {
      low.current += 1;
      high.current = 0;
    } else if (fps > target * 0.96) {
      high.current += 1;
      low.current = 0;
    } else {
      low.current = 0;
      high.current = 0;
    }

    const dropStep = mobile ? 0.08 : 0.1;
    const upStep = mobile ? 0.06 : 0.08;
    const lowNeed = mobile ? 1 : 2;
    const highNeed = mobile ? 4 : 4;

    if (low.current >= lowNeed && cur.current > min + 1e-3) {
      cur.current = Math.max(
        min,
        Math.round((cur.current - dropStep) * 100) / 100,
      );
      setDpr(cur.current);
      low.current = 0;
      cooldown.current = mobile ? 4 : 4;
    } else if (high.current >= highNeed && cur.current < max - 1e-3) {
      cur.current = Math.min(
        max,
        Math.round((cur.current + upStep) * 100) / 100,
      );
      setDpr(cur.current);
      high.current = 0;
      cooldown.current = mobile ? 6 : 5;
    }
  });

  return null;
}

/* ═══════════════════════════════════════════════════════════
   THE PATH + O(1) PRECOMPUTED SPLINE LUT (v18.3: halved size)
   ═══════════════════════════════════════════════════════════ */

const PATH = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(3.2, 0.8, -20),
    new THREE.Vector3(-3.4, -0.6, -42),
    new THREE.Vector3(3.0, 0.9, -64),
    new THREE.Vector3(-2.8, -0.2, -86),
    new THREE.Vector3(0.6, 0.6, -108),
    new THREE.Vector3(0, 0, -128),
  ],
  false,
  "centripetal",
);
PATH.arcLengthDivisions = 360; // v18.3: was 600

const LUT_STEPS = 1024; // v18.3: was 2048
const LUT_POS = new Float32Array((LUT_STEPS + 1) * 3);
const LUT_TAN = new Float32Array((LUT_STEPS + 1) * 3);
{
  const tmpP = new THREE.Vector3();
  const tmpT = new THREE.Vector3();
  for (let i = 0; i <= LUT_STEPS; i++) {
    const u = i / LUT_STEPS;
    PATH.getPointAt(u, tmpP);
    PATH.getTangentAt(u, tmpT);
    const k = i * 3;
    LUT_POS[k] = tmpP.x;
    LUT_POS[k + 1] = tmpP.y;
    LUT_POS[k + 2] = tmpP.z;
    LUT_TAN[k] = tmpT.x;
    LUT_TAN[k + 1] = tmpT.y;
    LUT_TAN[k + 2] = tmpT.z;
  }
}

function samplePointFast(u: number, out: THREE.Vector3) {
  const c = clamp01(u) * LUT_STEPS;
  const i0 = Math.min(LUT_STEPS - 1, c | 0);
  const f = c - i0;
  const k0 = i0 * 3;
  const k1 = k0 + 3;
  out.set(
    LUT_POS[k0] + (LUT_POS[k1] - LUT_POS[k0]) * f,
    LUT_POS[k0 + 1] + (LUT_POS[k1 + 1] - LUT_POS[k0 + 1]) * f,
    LUT_POS[k0 + 2] + (LUT_POS[k1 + 2] - LUT_POS[k0 + 2]) * f,
  );
}

function sampleTangentFast(u: number, out: THREE.Vector3) {
  const c = clamp01(u) * LUT_STEPS;
  const i0 = Math.min(LUT_STEPS - 1, c | 0);
  const f = c - i0;
  const k0 = i0 * 3;
  const k1 = k0 + 3;
  out
    .set(
      LUT_TAN[k0] + (LUT_TAN[k1] - LUT_TAN[k0]) * f,
      LUT_TAN[k0 + 1] + (LUT_TAN[k1 + 1] - LUT_TAN[k0 + 1]) * f,
      LUT_TAN[k0 + 2] + (LUT_TAN[k1 + 2] - LUT_TAN[k0 + 2]) * f,
    )
    .normalize();
}

const UP = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);

const BEAT_U = [0.04, 0.22, 0.4, 0.58, 0.76, 0.94];
const BEAT_SHIFT = [-1.6, 2.0, 0.0, 2.0, -0.8, 0.0];
const U_LOOK = 0.06;

type Basis = {
  p: THREE.Vector3;
  t: THREE.Vector3;
  r: THREE.Vector3;
  up: THREE.Vector3;
};

function basisAt(uu: number): Basis {
  const p = PATH.getPointAt(uu);
  const t = PATH.getTangentAt(uu).normalize();
  const r = new THREE.Vector3().crossVectors(t, UP).normalize();
  const up = new THREE.Vector3().crossVectors(r, t).normalize();
  return { p, t, r, up };
}

/* ═══════════════════════════════════════════════════════════
   CAMERA RIG — v18.3: much tighter damping
   ═══════════════════════════════════════════════════════════ */

const _P = new THREE.Vector3();
const _T = new THREE.Vector3();
const _T2 = new THREE.Vector3();
const _L = new THREE.Vector3();
const _R = new THREE.Vector3();

function CameraRig({
  mobile,
  isNative,
}: {
  mobile: boolean;
  isNative: boolean;
}) {
  const { camera } = useThree();
  const pos = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());
  const tPos = useRef(new THREE.Vector3());
  const tLook = useRef(new THREE.Vector3());
  const snapped = useRef(false);
  const fov = useRef(FOV);
  const roll = useRef(0);

  // Native app: no Lenis smoothing at all → track native scroll tightly.
  // Web (Lenis): Lenis already smoothed → we barely need to add anything.
  const posLambda = isNative ? 45 : 20;
  const lookLambda = isNative ? 45 : 20;

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const cam = camera as THREE.PerspectiveCamera;

    const f = store.smooth * 5;
    const lo = Math.min(5, Math.max(0, Math.floor(f)));
    const hi = Math.min(5, lo + 1);
    const lin = f - lo;
    const frac = lin * 0.35 + easeInOutCubic(lin) * 0.65;
    const c = BEAT_U[lo] + (BEAT_U[hi] - BEAT_U[lo]) * frac;
    store.head = c;

    samplePointFast(c, _P);
    sampleTangentFast(c, _T);
    samplePointFast(Math.min(1, c + U_LOOK), _L);
    sampleTangentFast(Math.min(1, c + 0.02), _T2);
    _R.crossVectors(_T, UP).normalize();

    const shift = BEAT_SHIFT[lo] + (BEAT_SHIFT[hi] - BEAT_SHIFT[lo]) * frac;
    const t = state.clock.elapsedTime;
    const sx = Math.sin(t * 0.34) * 0.1 + Math.sin(t * 0.17) * 0.06;
    const sy = Math.cos(t * 0.27) * 0.08 + Math.sin(t * 0.11) * 0.05;
    const px = state.pointer.x;
    const py = state.pointer.y;

    const ox = sx + px * 0.25;
    const oy = sy + py * 0.15 - 0.45;
    tPos.current.set(_P.x + _R.x * ox, _P.y + oy, _P.z + _R.z * ox);
    const lx = shift + px * 0.9;
    const ly = py * 0.5 + sy * 0.5 + 0.2;
    tLook.current.set(_L.x + _R.x * lx, _L.y + ly, _L.z + _R.z * lx);

    if (!snapped.current) {
      snapped.current = true;
      pos.current.copy(tPos.current);
      look.current.copy(tLook.current);
    }

    dampVec3(pos.current, tPos.current, posLambda, dt);
    dampVec3(look.current, tLook.current, lookLambda, dt);

    const lat = _T2.dot(_R);
    roll.current = damp(roll.current, clampN(-lat * 1.6, -0.14, 0.14), 4.0, dt);

    cam.position.copy(pos.current);
    cam.up.set(Math.sin(roll.current), Math.cos(roll.current), 0);
    cam.lookAt(look.current);

    if (!mobile) {
      fov.current = damp(
        fov.current,
        FOV + Math.min(12, Math.abs(store.velocity) * 16),
        8,
        dt,
      );
      if (Math.abs(cam.fov - fov.current) > 0.01) {
        cam.fov = fov.current;
        cam.updateProjectionMatrix();
      }
    }
  }, -90);

  return null;
}

/* ═══════════════════════════════════════════════════════════
   BACKDROP — v18.3 mobile gets 2-octave fbm texture
   ═══════════════════════════════════════════════════════════ */

const BG_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.9999, 1.0);
  }
`;

const BG_COMMON = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uScroll;
  uniform vec2  uRes;
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y);
  }
`;

const BG_FBM_HIGH = /* glsl */ `
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = rot * p * 2.02;
      a *= 0.5;
    }
    return v;
  }
`;

const BG_BODY_HIGH = /* glsl */ `
  void main() {
    vec2 uv = vUv - 0.5;
    uv.x *= uRes.x / uRes.y;
    float t = uTime * 0.018;
    vec2 q = vec2(
      fbm(uv * 1.5 + vec2(0.0, t)),
      fbm(uv * 1.5 + vec2(5.2, 1.3) - t * 0.8));
    vec2 r = vec2(
      fbm(uv * 1.3 + 2.8 * q + vec2(1.7, 9.2) + t * 0.44),
      fbm(uv * 1.3 + 2.8 * q + vec2(8.3, 2.8) - t * 0.32));
    float f = fbm(uv * 1.15 + 2.5 * r);
    vec3 obsidian = vec3(0.012, 0.014, 0.024);
    vec3 ember = vec3(0.784, 0.502, 0.235);
    vec3 steel = vec3(0.439, 0.588, 0.706);
    vec3 accent = mix(ember, steel, clamp(uScroll, 0.0, 1.0));
    float cloudFar  = smoothstep(0.22, 0.94, f + uScroll * 0.10);
    float cloudMid  = smoothstep(0.60, 1.02, length(r));
    float dustLane  = smoothstep(0.55, 0.15, f * 0.8 + cloudMid * 0.4);
    vec3 col = obsidian;
    col = mix(col, accent * 0.10, cloudFar  * 0.65);
    col = mix(col, accent * 0.22, cloudMid  * 0.42);
    col *= mix(0.45, 1.0, dustLane);
    float vig = 1.0 - smoothstep(0.36, 1.30, length(vUv - 0.5) * 1.62);
    col *= mix(0.55, 1.0, vig);
    col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const BG_FRAG_HIGH = BG_COMMON + BG_FBM_HIGH + BG_BODY_HIGH;

/* Mobile: 2-octave fbm — cheap enough on mid-range Androids, and
   replaces the flat radial gradient that read as "cheap". */
const BG_FRAG_MOBILE = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uScroll;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y);
  }
  float fbm2(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 2; i++) {
      v += a * vnoise(p);
      p = p * 2.02;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 obsidian = vec3(0.016, 0.018, 0.028);
    vec3 ember    = vec3(0.784, 0.502, 0.235);
    vec3 steel    = vec3(0.439, 0.588, 0.706);
    vec3 accent   = mix(ember, steel, clamp(uScroll, 0.0, 1.0));

    vec2 c = vUv - 0.5;
    c.x *= 1.777;
    float d = length(c);
    float t = uTime * 0.02;

    float n = fbm2(vUv * 3.0 + vec2(t * 0.5, t * 0.3));

    float pulse = 0.85 + 0.15 * sin(uTime * 0.35);
    vec3 col = obsidian;
    col += accent * 0.10 * pulse * (1.0 - smoothstep(0.10, 0.85, d));
    col += accent * 0.07 * n * (1.0 - smoothstep(0.0, 1.15, d));
    col *= 1.0 - smoothstep(0.55, 1.20, d) * 0.55;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function Backdrop({ mobile }: { mobile: boolean }) {
  const { size } = useThree();
  const uniforms = useMemo(
    () => ({
      uTime: SHARED.uTime,
      uScroll: { value: 0 },
      uRes: { value: new THREE.Vector2(1920, 1080) },
    }),
    [],
  );
  useEffect(() => {
    uniforms.uRes.value.set(size.width, size.height);
  }, [size, uniforms]);
  useFrame(() => {
    uniforms.uScroll.value = store.smooth;
  });
  return (
    <mesh frustumCulled={false} renderOrder={-20} matrixAutoUpdate={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        key={mobile ? "bg-mob" : "bg-high"}
        vertexShader={BG_VERT}
        fragmentShader={mobile ? BG_FRAG_MOBILE : BG_FRAG_HIGH}
        uniforms={uniforms}
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/* ═══════════════════════════════════════════════════════════
   THE THREAD — v18.3: thicker on mobile, lighter on desktop
   ═══════════════════════════════════════════════════════════ */

const THREAD_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vW;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const THREAD_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vW;
  uniform float uTime;
  uniform float uHead;
  uniform float uPhase;
  uniform float uGain;
  void main() {
    float s = vUv.x;
    float d = s - uHead;
    float packets = pow(0.5 + 0.5 * sin(s * 180.0 - uTime * 3.2 + uPhase), 7.0);
    float behind = 1.0 - smoothstep(0.0, 0.46, -d);
    float lit   = d < 0.0 ? mix(0.30, 1.0, behind) : 0.0;
    float ghost = d >= 0.0 ? 0.08 + 0.22 * packets * exp(-d * 5.0) : 0.0;
    float head  = exp(-pow(d * 70.0, 2.0)) * 2.4;
    float inten = lit * (0.5 + 1.25 * packets) + ghost + head;
    vec3 ember = vec3(0.784, 0.502, 0.235);
    vec3 steel = vec3(0.50, 0.70, 0.90);
    vec3 col = mix(ember, steel, clamp(s, 0.0, 1.0));
    col = mix(col, vec3(1.0, 0.93, 0.78), clamp(head * 0.3, 0.0, 1.0));
    float nearF = smoothstep(1.2, 5.0, distance(cameraPosition, vW));
    gl_FragColor = vec4(col * inten * uGain * nearF, 1.0);
  }
`;

function Thread({ mobile }: { mobile: boolean }) {
  const parts = useMemo(() => {
    const mainTubular   = mobile ? 240 : 720;
    const mainRadial    = mobile ? 6   : 12;
    const N             = mobile ? 96  : 400;
    const strandTubular = mobile ? 260 : 1000; // v18.3: 1600 → 1000
    const strandRadial  = mobile ? 4   : 8;
    const turns         = mobile ? 20  : 40;

    // v18.3: thicker on mobile so the spine actually reads on a phone.
    const mainRadius   = mobile ? 0.045 : 0.03;
    const strandRadius = mobile ? 0.018 : 0.013;

    const main = new THREE.TubeGeometry(
      PATH,
      mainTubular,
      mainRadius,
      mainRadial,
      false,
    );

    const frames = PATH.computeFrenetFrames(N, false);
    const strands: THREE.TubeGeometry[] = [];
    for (let s = 0; s < 2; s++) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= N; i++) {
        const k = i / N;
        const p = PATH.getPoint(k);
        const th = k * turns * TAU + s * Math.PI;
        const rad = 0.34 + 0.12 * Math.sin(k * 38 + s * 2.0);
        const n = frames.normals[i];
        const b = frames.binormals[i];
        pts.push(
          new THREE.Vector3(
            p.x + (n.x * Math.cos(th) + b.x * Math.sin(th)) * rad,
            p.y + (n.y * Math.cos(th) + b.y * Math.sin(th)) * rad,
            p.z + (n.z * Math.cos(th) + b.z * Math.sin(th)) * rad,
          ),
        );
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
      curve.arcLengthDivisions = mobile ? 500 : 1400;
      strands.push(
        new THREE.TubeGeometry(
          curve,
          strandTubular,
          strandRadius,
          strandRadial,
          false,
        ),
      );
    }

    const mk = (phase: number, gain: number) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: SHARED.uTime,
          uHead: SHARED.uHead,
          uPhase: { value: phase },
          uGain: { value: gain },
        },
        vertexShader: THREAD_VERT,
        fragmentShader: THREAD_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });

    return {
      main,
      strands,
      mats: [mk(0, 1.0), mk(1.7, 0.8), mk(3.4, 0.8)],
    };
  }, [mobile]);

  useEffect(
    () => () => {
      parts.main.dispose();
      parts.strands.forEach((g) => g.dispose());
      parts.mats.forEach((m) => m.dispose());
    },
    [parts],
  );

  return (
    <group matrixAutoUpdate={false}>
      <mesh
        geometry={parts.main}
        material={parts.mats[0]}
        frustumCulled={false}
        matrixAutoUpdate={false}
      />
      <mesh
        geometry={parts.strands[0]}
        material={parts.mats[1]}
        frustumCulled={false}
        matrixAutoUpdate={false}
      />
      <mesh
        geometry={parts.strands[1]}
        material={parts.mats[2]}
        frustumCulled={false}
        matrixAutoUpdate={false}
      />
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════
   DUST
   ═══════════════════════════════════════════════════════════ */

const DUST_VERT = /* glsl */ `
  attribute vec3 aSeed;
  uniform float uTime;
  uniform float uPx;
  varying float vTw;
  varying float vK;
  void main() {
    vec3 p = position;
    p.y += sin(uTime * 0.12 * aSeed.y + aSeed.x * 6.2831) * 0.35;
    p.x += cos(uTime * 0.09 * aSeed.y + aSeed.x * 3.0) * 0.30;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float d = -mv.z;
    vTw = 0.55 + 0.45 * sin(uTime * 6.2831 * aSeed.y + aSeed.x * 6.2831);
    gl_PointSize = clamp(aSeed.z * uPx / max(d, 0.5), 1.0, 14.0);
    vK = smoothstep(1.0, 4.0, d) * (1.0 - smoothstep(30.0, 60.0, d));
  }
`;

const DUST_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTint;
  varying float vTw;
  varying float vK;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a *= a;
    vec3 c = mix(vec3(1.0, 0.84, 0.60), vec3(0.65, 0.80, 1.0), uTint);
    gl_FragColor = vec4(c * a * vTw * vK * 1.25, 1.0);
  }
`;

function Dust({ tier, mobile }: { tier: Tier; mobile: boolean }) {
  const { size, gl } = useThree();
  const count = mobile ? 70 : tier === "low" ? 200 : tier === "mid" ? 380 : 550;
  const geo = useMemo(() => {
    const rng = mulberry32(99);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const b = basisAt(rng());
      const th = rng() * TAU;
      const rad = 1.3 + Math.sqrt(rng()) * 10;
      const ca = Math.cos(th) * rad;
      const sa = Math.sin(th) * rad * 0.8;
      pos[i * 3] = b.p.x + b.r.x * ca + b.up.x * sa;
      pos[i * 3 + 1] = b.p.y + b.r.y * ca + b.up.y * sa;
      pos[i * 3 + 2] = b.p.z + b.r.z * ca + b.up.z * sa;
      seed[i * 3] = rng();
      seed[i * 3 + 1] = 0.55 + rng() * 1.15;
      seed[i * 3 + 2] = 0.018 + rng() * 0.05;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    return g;
  }, [count]);

  const uniforms = useMemo(
    () => ({
      uTime: SHARED.uTime,
      uTint: SHARED.uTint,
      uPx: { value: 600 },
    }),
    [],
  );

  useEffect(() => {
    uniforms.uPx.value = (size.height * gl.getPixelRatio()) / (2 * TAN_HALF);
  }, [size, gl, uniforms]);

  return (
    <points geometry={geo} frustumCulled={false} matrixAutoUpdate={false}>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={DUST_VERT}
        fragmentShader={DUST_FRAG}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

/* ═══════════════════════════════════════════════════════════
   PHOTO CARDS
   ═══════════════════════════════════════════════════════════ */

const SHARED_CARD_GEO = new THREE.PlaneGeometry(1, 1);

type CardSpec = {
  tex: number;
  w: number;
  h: number;
  cx: number; cy: number; cz: number;
  rx: number; ry: number; rz: number;
  ux: number; uy: number; uz: number;
  tx: number; ty: number; tz: number;
  radius: number;
  squash: number;
  phase: number;
  speed: number;
  fx: number; fy: number; fz: number;
  tilt: number;
  seed: number;
  par: number;
  pulse: number;
};

type CardOpts = {
  radius: number;
  phase: number;
  speed: number;
  w: number;
  h: number;
  dz?: number;
  squash?: number;
  faceBack?: number;
  tilt?: number;
  par?: number;
  pulse?: number;
};

function makeCard(
  rng: () => number,
  tex: number,
  uu: number,
  o: CardOpts,
): CardSpec {
  const b = basisAt(uu);
  const dz = o.dz ?? 0;
  const fb = o.faceBack ?? 6;
  return {
    tex,
    w: o.w,
    h: o.h,
    cx: b.p.x + b.t.x * dz,
    cy: b.p.y + b.t.y * dz,
    cz: b.p.z + b.t.z * dz,
    rx: b.r.x, ry: b.r.y, rz: b.r.z,
    ux: b.up.x, uy: b.up.y, uz: b.up.z,
    tx: b.t.x, ty: b.t.y, tz: b.t.z,
    radius: o.radius,
    squash: o.squash ?? 0.85,
    phase: o.phase,
    speed: o.speed,
    fx: b.p.x + b.t.x * (dz - fb),
    fy: b.p.y + b.t.y * (dz - fb),
    fz: b.p.z + b.t.z * (dz - fb),
    tilt: o.tilt ?? (rng() - 0.5) * 0.25,
    seed: rng() * 100,
    par: o.par ?? 0.3 + rng() * 0.5,
    pulse: o.pulse ?? 0,
  };
}

const faceT = (k: number) => k % 12;
const sceneT = (k: number) => 12 + (k % 12);

function buildCards(): CardSpec[] {
  const rng = mulberry32(20261016);
  const out: CardSpec[] = [];
  for (let k = 0; k < 12; k++) {
    const h = 1.5 + rng() * 1.0;
    out.push(
      makeCard(rng, faceT(k * 5 + 1), 0.07 + rng() * 0.09, {
        radius: 2.4 + rng() * 2.9,
        phase: rng() * TAU,
        speed: (0.05 + rng() * 0.09) * (rng() < 0.5 ? -1 : 1),
        w: h * 0.78,
        h,
        faceBack: 7,
      }),
    );
  }
  for (let k = 0; k < 7; k++) {
    const w = 2.5 + rng() * 1.0;
    const left = k % 2 === 0;
    out.push(
      makeCard(rng, sceneT(6 + k), 0.185 + k * 0.0165, {
        radius: 3.1 + rng() * 1.2,
        phase: (left ? Math.PI : 0) + (rng() - 0.5) * 0.6,
        speed: 0.012 * (left ? 1 : -1),
        w,
        h: w / 1.5,
        squash: 0.55,
        faceBack: 5,
      }),
    );
  }
  const vault = [faceT(4), sceneT(2), faceT(8), sceneT(3)];
  for (let k = 0; k < 4; k++) {
    out.push(
      makeCard(rng, vault[k], 0.4, {
        radius: 3.7,
        phase: k * (TAU / 4) + 0.5,
        speed: 0.04,
        dz: (k - 1.5) * 1.9,
        w: 2.0,
        h: 2.9,
        faceBack: 3,
      }),
    );
  }
  for (let k = 0; k < 11; k++) {
    out.push(
      makeCard(rng, faceT(k * 7 + 2), 0.505 + k * 0.0135, {
        radius: 2.7 + 0.35 * Math.sin(k * 0.9),
        phase: k * 0.95,
        speed: 0.06,
        w: 1.45,
        h: 1.95,
        faceBack: 6,
      }),
    );
  }
  for (let k = 0; k < 5; k++) {
    out.push(
      makeCard(rng, sceneT(k * 2 + 4), 0.7 + k * 0.032, {
        radius: 4.4 + rng() * 0.8,
        phase: k * 1.9,
        speed: 0,
        w: 2.5,
        h: 1.65,
        pulse: 0.05,
        faceBack: 6,
      }),
    );
  }
  for (let k = 0; k < 10; k++) {
    out.push(
      makeCard(rng, faceT(k * 5 + 3), 1.0, {
        radius: 5.6,
        phase: (k * TAU) / 10,
        speed: 0.012,
        w: 1.7,
        h: 2.25,
        squash: 0.8,
        faceBack: 40,
        tilt: 0,
        par: 0.2,
      }),
    );
  }
  for (let k = 0; k < 6; k++) {
    out.push(
      makeCard(rng, sceneT(k * 2 + 1), 1.0, {
        radius: 9.2,
        phase: (k * TAU) / 6 + 0.3,
        speed: -0.01,
        w: 3.2,
        h: 2.1,
        squash: 0.7,
        faceBack: 40,
        tilt: 0,
        par: 0.15,
      }),
    );
  }
  return out;
}

const ALL_CARDS = buildCards();

function fallbackTexture(idx: number) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 160;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createLinearGradient(0, 0, 128, 160);
    const hue = 24 + ((idx * 17) % 40);
    grad.addColorStop(0, `hsl(${hue} 42% 34%)`);
    grad.addColorStop(1, "hsl(215 30% 16%)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 160);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * v18.3: batched uploads (3/rAF) + bump per batch → progressive card
 * appearance instead of one giant re-render at the end.
 */
function useGallery(wanted: number[]) {
  const [, bump] = useState(0);
  const ref = useRef<Record<number, THREE.Texture>>({});
  const { gl } = useThree();

  useEffect(() => {
    let alive = true;
    const store_ = ref.current;
    const maxAniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    const uploadQueue: Array<{ idx: number; tex: THREE.Texture }> = [];
    let rafId = 0;

    const drainUploadQueue = () => {
      if (!alive) return;
      let batch = 0;
      while (uploadQueue.length > 0 && batch < 3) {
        const next = uploadQueue.shift()!;
        gl.initTexture(next.tex);
        store_[next.idx] = next.tex;
        batch++;
      }
      if (batch > 0) bump((v) => v + 1);
      if (uploadQueue.length > 0) {
        rafId = requestAnimationFrame(drainUploadQueue);
      } else {
        rafId = 0;
      }
    };

    const enqueue = (idx: number, tex: THREE.Texture) => {
      if (!alive) {
        tex.dispose();
        return;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAniso;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      uploadQueue.push({ idx, tex });
      if (!rafId) rafId = requestAnimationFrame(drainUploadQueue);
    };

    wanted.forEach((idx) => {
      const url = GALLERY[idx];
      if (typeof createImageBitmap === "function") {
        fetch(url, { mode: "cors" })
          .then((r) => {
            if (!r.ok) throw new Error("fetch failed");
            return r.blob();
          })
          .then((blob) =>
            createImageBitmap(blob, {
              imageOrientation: "flipY",
              premultiplyAlpha: "none",
              colorSpaceConversion: "none",
            }),
          )
          .then((bmp) => {
            if (!alive) {
              bmp.close();
              return;
            }
            const tex = new THREE.Texture(bmp as any);
            tex.flipY = false;
            enqueue(idx, tex);
          })
          .catch(() => enqueue(idx, fallbackTexture(idx)));
      } else {
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin("anonymous");
        loader.load(
          url,
          (t) => enqueue(idx, t),
          undefined,
          () => enqueue(idx, fallbackTexture(idx)),
        );
      }
    });

    return () => {
      alive = false;
      if (rafId) cancelAnimationFrame(rafId);
      uploadQueue.forEach((q) => q.tex.dispose());
      Object.values(store_).forEach((t) => t.dispose());
      ref.current = {};
    };
  }, [wanted, gl]);

  return ref.current;
}

function makeCardMaterial(
  tex: THREE.Texture,
  aspect: number,
  texAspect: number,
) {
  const uniforms = {
    uAspect: { value: aspect },
    uTexAspect: { value: texAspect },
    uAppear: { value: 0 },
    uTint: SHARED.uTint,
  };
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
  });
  mat.customProgramCacheKey = () => "orbital-card-v18";
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vCW;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vCW = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vCW;
         uniform float uAspect;
         uniform float uTexAspect;
         uniform float uAppear;
         uniform float uTint;`,
      )
      .replace(
        "#include <map_fragment>",
        /* glsl */ `
          vec2 cuv = vMapUv - 0.5;
          if (uAspect > uTexAspect) { cuv.y *= uTexAspect / uAspect; }
          else                      { cuv.x *= uAspect / uTexAspect; }
          cuv = cuv * 0.98 + 0.5;

          vec4 texel = texture2D(map, cuv);
          vec2 hs = vec2(uAspect, 1.0) * 0.5;
          vec2 pp = (vMapUv - 0.5) * vec2(uAspect, 1.0);
          float rr = 0.07;
          vec2 qq = abs(pp) - (hs - rr);
          float sd = length(max(qq, 0.0)) + min(max(qq.x, qq.y), 0.0) - rr;
          float edge = 1.0 - smoothstep(-0.004, 0.004, sd);
          float rim = smoothstep(-0.016, -0.002, sd);
          float dcam = distance(cameraPosition, vCW);
          float fade =
  smoothstep(1.4, 2.4, dcam) *
  (1.0 - smoothstep(38.0, 46.0, dcam));
          vec3 grade = mix(vec3(1.06, 0.95, 0.84), vec3(0.86, 0.95, 1.08), uTint);
          vec3 col = texel.rgb * grade * 0.94;
          col += vec3(0.78, 0.53, 0.23) * rim * 0.45;
          diffuseColor = vec4(col, edge * fade * uAppear);
        `,
      );
  };
  return { mat, uniforms };
}

const PhotoCard = memo(function PhotoCard({
  spec,
  tex,
}: {
  spec: CardSpec;
  tex: THREE.Texture;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const built = useMemo(() => {
    const img = tex.image as { width?: number; height?: number } | undefined;
    const ta = img && img.width && img.height ? img.width / img.height : 0.8;
    return makeCardMaterial(tex, spec.w / spec.h, ta);
  }, [tex, spec]);

  useEffect(() => () => built.mat.dispose(), [built]);

  useFrame((state, delta) => {
    const m = ref.current;
    if (!m) return;

    const camPos = state.camera.position;
    const cdx = spec.cx - camPos.x;
    const cdy = spec.cy - camPos.y;
    const cdz = spec.cz - camPos.z;
    const approxDistSq = cdx * cdx + cdy * cdy + cdz * cdz;
    if (approxDistSq > 3025) {
      if (m.visible) m.visible = false;
      return;
    }
    if (!m.visible) m.visible = true;

    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;
    built.uniforms.uAppear.value = damp(
      built.uniforms.uAppear.value,
      1,
      2.5,
      dt,
    );
    const a = spec.phase + t * spec.speed;
    const ca = Math.cos(a) * spec.radius;
    const sa = Math.sin(a) * spec.radius * spec.squash;
    const lag = store.lag * spec.par * 14;
    const dx = Math.sin(t * 0.31 + spec.seed) * 0.16;
    const dy = Math.cos(t * 0.27 + spec.seed * 1.3) * 0.2;
    m.position.set(
      spec.cx + spec.rx * ca + spec.ux * sa + dx + spec.tx * lag,
      spec.cy + spec.ry * ca + spec.uy * sa + dy + spec.ty * lag,
      spec.cz + spec.rz * ca + spec.uz * sa + spec.tz * lag,
    );
    const s = 1 + spec.pulse * Math.max(0, Math.sin(t * 5.2 + spec.seed));
    m.scale.set(spec.w * s, spec.h * s, 1);
    m.lookAt(spec.fx, spec.fy, spec.fz);
    m.rotateZ(spec.tilt);
    m.updateMatrix();
  });

  return (
    <mesh
      ref={ref}
      geometry={SHARED_CARD_GEO}
      material={built.mat}
      frustumCulled={false}
      matrixAutoUpdate={false}
    />
  );
});

function Gallery({ tier, mobile }: { tier: Tier; mobile: boolean }) {
  const specs = useMemo(() => {
    if (mobile) return ALL_CARDS.filter((_, i) => i % 5 === 0);
    if (tier === "low") return ALL_CARDS.filter((_, i) => i % 2 === 0);
    return ALL_CARDS;
  }, [tier, mobile]);
  const wanted = useMemo(
    () => Array.from(new Set(specs.map((s) => s.tex))),
    [specs],
  );
  const tex = useGallery(wanted);
  return (
    <>
      {specs.map((s, i) =>
        tex[s.tex] ? <PhotoCard key={i} spec={s} tex={tex[s.tex]} /> : null,
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   SIGNAL — GATES  (v18.3: alive on mobile)
   ═══════════════════════════════════════════════════════════ */

const _m4 = new THREE.Matrix4();
const _v3 = new THREE.Vector3();
const _q4 = new THREE.Quaternion();
const _s3 = new THREE.Vector3();
const _tiltQ = new THREE.Quaternion();

const GATE_N = 12;

function Gates({ mobile }: { mobile: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const ghostRef = useRef<THREE.InstancedMesh>(null);

  const data = useMemo(() => {
    const pos = new Float32Array(GATE_N * 3);
    const quat = new Float32Array(GATE_N * 4);
    const uu = new Float32Array(GATE_N);
    for (let i = 0; i < GATE_N; i++) {
      const k = 0.17 + i * 0.0109;
      const b = basisAt(k);
      const q = new THREE.Quaternion().setFromUnitVectors(AXIS_Z, b.t);
      pos[i * 3] = b.p.x;
      pos[i * 3 + 1] = b.p.y;
      pos[i * 3 + 2] = b.p.z;
      quat[i * 4] = q.x;
      quat[i * 4 + 1] = q.y;
      quat[i * 4 + 2] = q.z;
      quat[i * 4 + 3] = q.w;
      uu[i] = k;
    }
    return { pos, quat, uu };
  }, []);

  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const gm = ghostRef.current;
    const t = state.clock.elapsedTime;
    const vel = Math.min(1, Math.abs(store.velocity) * 2);

    for (let i = 0; i < GATE_N; i++) {
      const near = Math.exp(-Math.pow((data.uu[i] - store.head) * 38, 2));
      const phase = (i / GATE_N) * TAU;
      // v18.3: bigger amplitude so it reads at low fps.
      const wobble = Math.sin(t * 2.5 + phase) * 0.06;
      const tilt = Math.sin(t * 0.9 + phase * 1.3) * 0.12;
      const s =
        0.8 +
        (i % 3) * 0.12 +
        wobble +
        near * 0.28 +
        vel * 0.12;

      _v3.set(data.pos[i * 3], data.pos[i * 3 + 1], data.pos[i * 3 + 2]);
      _q4.set(
        data.quat[i * 4],
        data.quat[i * 4 + 1],
        data.quat[i * 4 + 2],
        data.quat[i * 4 + 3],
      );
      // Tilt in local frame (post-multiply) — visible wobble.
      _tiltQ.setFromAxisAngle(AXIS_X, tilt);
      _q4.multiply(_tiltQ);
      _s3.set(s, s, s);
      _m4.compose(_v3, _q4, _s3);
      m.setMatrixAt(i, _m4);
      if (gm) gm.setMatrixAt(i, _m4);
    }
    m.instanceMatrix.needsUpdate = true;
    if (gm) {
      gm.instanceMatrix.needsUpdate = true;
      const gmat = gm.material as THREE.MeshBasicMaterial;
      gmat.opacity = 0.10 + vel * 0.15;
    }
  });

  // v18.3: thicker tubes + more segments so circles don't alias into noise.
  const tubeRadius = mobile ? 0.07 : 0.035;
  const tubeSeg = mobile ? 8 : 10;
  const ringSeg = mobile ? 96 : 128;

  return (
    <>
      <instancedMesh
        ref={ref}
        args={[undefined, undefined, GATE_N]}
        frustumCulled={false}
        matrixAutoUpdate={false}
      >
        <torusGeometry args={[3.3, tubeRadius, tubeSeg, ringSeg]} />
        <meshBasicMaterial
          color={AMBER}
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      {/* Ghost halo — fake bloom for cheap additive glow */}
      <instancedMesh
        ref={ghostRef}
        args={[undefined, undefined, GATE_N]}
        frustumCulled={false}
        matrixAutoUpdate={false}
      >
        <torusGeometry
          args={[3.3, tubeRadius * 3.2, mobile ? 6 : 8, ringSeg]}
        />
        <meshBasicMaterial
          color={AMBER}
          transparent
          opacity={0.14}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   VAULT
   ═══════════════════════════════════════════════════════════ */

const SHARD_VERT = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SHARD_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTint;
  varying vec3 vW;
  void main() {
    vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
    vec3 V = normalize(cameraPosition - vW);
    float f = pow(1.0 - abs(dot(n, V)), 2.0);
    vec3 ember = vec3(0.784, 0.502, 0.235);
    vec3 steel = vec3(0.44, 0.59, 0.71);
    vec3 tint = mix(ember, steel, uTint);
    vec3 col = tint * (0.10 + f * 1.25) + vec3(0.9, 0.85, 0.75) * pow(f, 6.0) * 0.8;
    float far = 1.0 - smoothstep(14.0, 48.0, distance(cameraPosition, vW));
    gl_FragColor = vec4(col * far, (0.28 + f * 0.62) * far);
  }
`;

const GLOW_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const GLOW_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uI;
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vP))), 2.4);
    float far = 1.0 - smoothstep(14.0, 48.0, distance(cameraPosition, vP));
    gl_FragColor = vec4(uColor * f * uI * far, 1.0);
  }
`;

function VaultCrystal({ mobile }: { mobile: boolean }) {
  const SHARD_N = mobile ? 10 : 22;
  const cageRef = useRef<THREE.LineSegments>(null);
  const shardRef = useRef<THREE.InstancedMesh>(null);
  const coreRef = useRef<THREE.Group>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const B = useMemo(() => basisAt(0.4), []);

  const cage = useMemo(() => {
    const g = new THREE.EdgesGeometry(
      new THREE.IcosahedronGeometry(6.4, mobile ? 0 : 1),
    );
    const m = new THREE.LineBasicMaterial({
      color: AMBER,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    return { g, m };
  }, [mobile]);

  const shardMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTint: SHARED.uTint },
        vertexShader: SHARD_VERT,
        fragmentShader: SHARD_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  );

  const glowUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(AMBER) },
      uI: { value: 1.7 },
    }),
    [],
  );

  const shards = useMemo(() => {
    const rng = mulberry32(4242);
    const list: {
      x: number; y: number; z: number;
      rx: number; ry: number; rz: number;
      v: number; w: number; l: number; seed: number;
    }[] = [];
    for (let i = 0; i < SHARD_N; i++) {
      const ang = rng() * TAU;
      const rad = 2.2 + rng() * 3.2;
      const z = (rng() - 0.5) * 9;
      const ca = Math.cos(ang) * rad;
      const sa = Math.sin(ang) * rad * 0.85;
      list.push({
        x: B.p.x + B.r.x * ca + B.up.x * sa + B.t.x * z,
        y: B.p.y + B.r.y * ca + B.up.y * sa + B.t.y * z,
        z: B.p.z + B.r.z * ca + B.up.z * sa + B.t.z * z,
        rx: rng() * TAU,
        ry: rng() * TAU,
        rz: rng() * TAU,
        v: 0.05 + rng() * 0.12,
        w: 0.16 + rng() * 0.2,
        l: 0.9 + rng() * 1.2,
        seed: rng() * 50,
      });
    }
    return list;
  }, [B, SHARD_N]);

  const corePos = useMemo(
    () =>
      new THREE.Vector3(
        B.p.x - B.r.x * 2.3 + B.up.x * 0.9,
        B.p.y - B.r.y * 2.3 + B.up.y * 0.9,
        B.p.z - B.r.z * 2.3 + B.up.z * 0.9,
      ),
    [B],
  );

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;
    if (cageRef.current) {
      cageRef.current.rotation.y = t * 0.03;
      cageRef.current.rotation.x = t * 0.017;
    }
    const sm = shardRef.current;
    if (sm) {
      for (let i = 0; i < SHARD_N; i++) {
        const s = shards[i];
        dummy.position.set(
          s.x + Math.sin(t * 0.2 + s.seed) * 0.25,
          s.y + Math.cos(t * 0.17 + s.seed) * 0.3,
          s.z,
        );
        dummy.rotation.set(s.rx + t * s.v, s.ry + t * s.v * 0.7, s.rz);
        dummy.scale.set(s.w, s.l, s.w);
        dummy.updateMatrix();
        sm.setMatrixAt(i, dummy.matrix);
      }
      sm.instanceMatrix.needsUpdate = true;
    }
    const c = coreRef.current;
    if (c) {
      c.rotation.y += dt * 0.25;
      c.rotation.x += dt * 0.11;
      c.scale.setScalar(1 + 0.04 * Math.sin(t * TAU * 0.6));
    }
  });

  return (
    <group>
      <lineSegments
        ref={cageRef}
        geometry={cage.g}
        material={cage.m}
        position={B.p}
        frustumCulled={false}
      />
      <instancedMesh
        ref={shardRef}
        args={[undefined, undefined, SHARD_N]}
        material={shardMat}
        frustumCulled={false}
      >
        <octahedronGeometry args={[1, 0]} />
      </instancedMesh>
      <group ref={coreRef} position={corePos}>
        <mesh>
          <icosahedronGeometry args={[0.42, mobile ? 0 : 1]} />
          <meshBasicMaterial color="#F6DDAE" wireframe toneMapped={false} />
        </mesh>
        <mesh>
          <octahedronGeometry args={[0.2, 0]} />
          <meshBasicMaterial color="#FFF1D2" toneMapped={false} />
        </mesh>
        <mesh>
          <sphereGeometry
            args={[0.95, mobile ? 20 : 28, mobile ? 20 : 28]}
          />
          <shaderMaterial
            uniforms={glowUniforms}
            vertexShader={GLOW_VERT}
            fragmentShader={GLOW_FRAG}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════
   RESONANCE
   ═══════════════════════════════════════════════════════════ */

function SoundRings({ mobile }: { mobile: boolean }) {
  const RINGS = mobile ? 4 : 6;
  const PER = mobile ? 28 : 40;
  const N = RINGS * PER;
  const ref = useRef<THREE.InstancedMesh>(null);

  const data = useMemo(() => {
    const pos = new Float32Array(N * 3);
    const quat = new Float32Array(N * 4);
    const ph = new Float32Array(N);
    const ring = new Float32Array(N);
    const radial = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (let k = 0; k < RINGS; k++) {
      const uu = 0.705 + k * (0.135 / Math.max(1, RINGS - 1));
      const b = basisAt(uu);
      const R = 3.1 + 0.25 * (k % 2);
      for (let j = 0; j < PER; j++) {
        const a = (j / PER) * TAU;
        radial
          .set(0, 0, 0)
          .addScaledVector(b.r, Math.cos(a))
          .addScaledVector(b.up, Math.sin(a))
          .normalize();
        q.setFromUnitVectors(AXIS_Y, radial);
        const i = k * PER + j;
        pos[i * 3] = b.p.x + radial.x * R;
        pos[i * 3 + 1] = b.p.y + radial.y * R;
        pos[i * 3 + 2] = b.p.z + radial.z * R;
        quat[i * 4] = q.x;
        quat[i * 4 + 1] = q.y;
        quat[i * 4 + 2] = q.z;
        quat[i * 4 + 3] = q.w;
        ph[i] = a;
        ring[i] = uu;
      }
    }
    return { pos, quat, ph, ring };
  }, [RINGS, PER, N]);

  const geo = useMemo(() => {
    const g = new THREE.BoxGeometry(0.05, 1, 0.05);
    g.translate(0, 0.5, 0);
    return g;
  }, []);

  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    const vel = Math.min(1, Math.abs(store.velocity) * 1.5);
    for (let i = 0; i < N; i++) {
      const near = Math.exp(-Math.pow((data.ring[i] - store.head) * 14, 2));
      const wave =
        0.5 + 0.5 * Math.sin(t * 2.6 + data.ph[i] * 3.0 + data.ring[i] * 90.0);
      const h = 0.14 + (0.3 + 1.3 * near + 0.7 * vel) * wave;
      _v3.set(data.pos[i * 3], data.pos[i * 3 + 1], data.pos[i * 3 + 2]);
      _q4.set(
        data.quat[i * 4],
        data.quat[i * 4 + 1],
        data.quat[i * 4 + 2],
        data.quat[i * 4 + 3],
      );
      _s3.set(1, h, 1);
      _m4.compose(_v3, _q4, _s3);
      m.setMatrixAt(i, _m4);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, N]}
      geometry={geo}
      frustumCulled={false}
    >
      <meshBasicMaterial
        color="#E8C890"
        transparent
        opacity={0.9}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

/* ═══════════════════════════════════════════════════════════
   ARRIVAL — portal
   ═══════════════════════════════════════════════════════════ */

const PORTAL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PORTAL_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uHead;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    float open = smoothstep(0.80, 0.97, uHead);
    float rays = 0.5 + 0.5 * sin(a * 14.0 + uTime * 0.35 + r * 5.0);
    float glow = pow(max(0.0, 1.0 - r), 1.6);
    float edge = smoothstep(1.0, 0.82, r);
    vec3 col = mix(vec3(1.0, 0.93, 0.78), vec3(0.50, 0.70, 0.90), r)
              * (glow * (0.45 + 0.55 * rays) + 0.06);
    gl_FragColor = vec4(col * edge * (0.12 + 0.7 * open), 1.0);
  }
`;

function Portal({ mobile }: { mobile: boolean }) {
  const ringRef = useRef<THREE.Group>(null);
  const { p, q } = useMemo(() => {
    const b = basisAt(1.0);
    return {
      p: b.p,
      q: new THREE.Quaternion().setFromUnitVectors(AXIS_Z, b.t),
    };
  }, []);
  const uniforms = useMemo(
    () => ({ uTime: SHARED.uTime, uHead: SHARED.uHead }),
    [],
  );
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    if (ringRef.current) ringRef.current.rotation.z += dt * 0.05;
  });
  return (
    <group position={p} quaternion={q}>
      <group ref={ringRef}>
        <mesh matrixAutoUpdate={false}>
          <torusGeometry args={[3.4, 0.07, mobile ? 8 : 12, mobile ? 64 : 96]} />
          <meshBasicMaterial color={AMBER} toneMapped={false} />
        </mesh>
        <mesh matrixAutoUpdate={false}>
          <torusGeometry args={[3.95, 0.02, mobile ? 6 : 8, mobile ? 64 : 96]} />
          <meshBasicMaterial
            color={CREAM}
            transparent
            opacity={0.55}
            toneMapped={false}
          />
        </mesh>
      </group>
      <mesh matrixAutoUpdate={false}>
        <circleGeometry args={[3.4, mobile ? 48 : 72]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={PORTAL_VERT}
          fragmentShader={PORTAL_FRAG}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════
   POST FX — v18.3: SMAA on high tier
   ═══════════════════════════════════════════════════════════ */

function PostFX({
  tier,
  hz,
  mobile,
}: {
  tier: Tier;
  hz: number;
  mobile: boolean;
}) {
  if (mobile || tier === "low") return null;
  const highHz = hz >= 120;
  if (tier === "mid") {
    return (
      <EffectComposer multisampling={0} enableNormalPass={false}>
        <Bloom
          intensity={0.55}
          luminanceThreshold={0.55}
          luminanceSmoothing={0.25}
          mipmapBlur
          kernelSize={highHz ? KernelSize.SMALL : KernelSize.MEDIUM}
          resolutionScale={highHz ? 0.35 : 0.5}
        />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <SMAA />
      <Bloom
        intensity={0.7}
        luminanceThreshold={0.55}
        luminanceSmoothing={0.25}
        mipmapBlur
        kernelSize={highHz ? KernelSize.SMALL : KernelSize.MEDIUM}
        resolutionScale={highHz ? 0.45 : 0.6}
      />
      <Vignette
        offset={0.28}
        darkness={0.55}
        blendFunction={BlendFunction.NORMAL}
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}

/* ═══════════════════════════════════════════════════════════
   WORLD — v18.3: defers heavy mounts by 2 rAF
   ═══════════════════════════════════════════════════════════ */

function OrbitalWorld({
  tier,
  hz,
  mobile,
  isNative,
}: {
  tier: Tier;
  hz: number;
  mobile: boolean;
  isNative: boolean;
}) {
  const [heavyReady, setHeavyReady] = useState(false);

  useEffect(() => {
    let r1 = 0;
    let r2 = 0;
    r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setHeavyReady(true));
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, []);

  return (
    <>
      <ScrollDriver />
      <CameraRig mobile={mobile} isNative={isNative} />
      <color attach="background" args={[DEEP]} />
      <fog attach="fog" args={[DEEP, 8, 42]} />
      <Backdrop mobile={mobile} />
      <Dust tier={tier} mobile={mobile} />
      {heavyReady && (
        <>
          <Thread mobile={mobile} />
          <Gates mobile={mobile} />
          <Portal mobile={mobile} />
          <Gallery tier={tier} mobile={mobile} />
          <PostFX tier={tier} hz={hz} mobile={mobile} />
        </>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   PHONE MOCKUP
   ═══════════════════════════════════════════════════════════ */
function PhoneMockup({
  children,
  mobile,
}: {
  children?: React.ReactNode;
  mobile: boolean;
}) {
  return (
    <div
      className="relative mx-auto select-none"
      style={{
        width: "clamp(264px, 24vw, 356px)",
        aspectRatio: "9 / 19",
        transform: "translate3d(0,0,0)",
        backfaceVisibility: "hidden",
        overflowAnchor: "none",
      }}
    >
      <div
        className="absolute inset-0 rounded-[44px] sm:rounded-[52px]"
        style={{
          background: `linear-gradient(155deg,
            #4A4A52 0%,
            #31313A 22%,
            #222228 45%,
            #1A1A20 62%,
            #2A2A32 82%,
            #46464E 100%)`,
          boxShadow: mobile
            ? `inset 0 0 0 1.5px rgba(255,255,255,0.16),
               0 24px 60px -18px rgba(0,0,0,0.92)`
            : `inset 0 0 0 1.5px rgba(255,255,255,0.14),
               inset 0 0 0 3px rgba(0,0,0,0.55),
               0 0 0 1px rgba(0,0,0,0.75),
               0 44px 130px -28px rgba(0,0,0,0.96),
               0 0 150px -45px rgba(200,136,58,0.28),
               0 90px 190px -55px rgba(0,0,0,0.80)`,
        }}
      />
      <div
        className="absolute inset-[4px] rounded-[40px] sm:inset-[6px] sm:rounded-[46px]"
        style={{
          background: "#08080A",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
        }}
      />
      <div
        className="absolute inset-[8px] overflow-hidden rounded-[36px] sm:inset-[10px] sm:rounded-[42px]"
        style={{
          background: "#08080B",
          transform: "translate3d(0,0,0)",
          backfaceVisibility: "hidden",
          WebkitMaskImage: "-webkit-radial-gradient(white, black)",
          isolation: "isolate",
          overflowAnchor: "none",
        }}
      >
        {children}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[16px] z-40 h-[24px] w-[88px] -translate-x-1/2 rounded-full bg-black sm:top-[20px] sm:h-[28px] sm:w-[104px]"
        style={{
          boxShadow:
            "inset 0 1px 1px rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.5)",
        }}
      >
        <span
          className="absolute right-[10px] top-1/2 h-[6px] w-[6px] -translate-y-1/2 rounded-full bg-[#0e0e0e]"
          style={{
            boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.06)",
            backgroundImage:
              "linear-gradient(135deg, #1a1a1a 0%, #050505 100%)",
          }}
        />
      </div>
      <div
        className="absolute -right-[2.5px] top-[28%] h-[11%] w-[2.5px] rounded-r-[2px]"
        style={{ background: "linear-gradient(180deg, #45454D, #26262C)" }}
      />
      <div
        className="absolute -left-[2.5px] top-[22%] h-[6%] w-[2.5px] rounded-l-[2px]"
        style={{ background: "linear-gradient(180deg, #45454D, #26262C)" }}
      />
      <div
        className="absolute -left-[2.5px] top-[32%] h-[10%] w-[2.5px] rounded-l-[2px]"
        style={{ background: "linear-gradient(180deg, #45454D, #26262C)" }}
      />
      <div
        className="pointer-events-none absolute inset-[8px] z-20 rounded-[36px] sm:inset-[10px] sm:rounded-[42px]"
        style={{
          background: `linear-gradient(140deg,
            rgba(255,255,255,0.07) 0%,
            rgba(255,255,255,0.015) 18%,
            transparent 34%,
            transparent 66%,
            rgba(255,255,255,0.015) 84%,
            rgba(255,255,255,0.04) 100%)`,
        }}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   STATUS BAR
   ═══════════════════════════════════════════════════════════ */

const StatusBar = memo(function StatusBar() {
  const now = useNow();
  const clock = useMemo(() => formatClock(now), [now]);

  return (
    <div
      className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-6 pt-2.5 text-[10px] font-semibold tabular-nums tracking-tight text-[#F0E4CC]"
      style={{
        isolation: "isolate",
        transform: "translate3d(0,0,0)",
        backfaceVisibility: "hidden",
        contain: "layout paint",
        pointerEvents: "none",
        overflowAnchor: "none",
      }}
    >
      <span className="ml-1 min-w-[32px]">{clock}</span>
      <div className="flex items-center gap-1.5">
        <Wifi size={9} className="text-[#F0E4CC]" />
        <span className="text-[8px]">5G</span>
        <div className="flex h-2.5 w-5 items-center rounded-[3px] border border-[#F0E4CC]/60 px-[1px] py-[1px]">
          <div className="h-full w-[78%] rounded-[1px] bg-[#F0E4CC]" />
        </div>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════
   LIVE CLOCK — pinned to IST
   ═══════════════════════════════════════════════════════════ */

function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      const d = new Date();
      const msToNextMinute = (60 - d.getSeconds()) * 1000 - d.getMilliseconds();
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, Math.min(intervalMs, msToNextMinute));
    };

    schedule();
    return () => clearTimeout(timer);
  }, [intervalMs]);

  return now;
}

const IST_FORMATTER = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function formatClock(d?: Date | null): string {
  const date = d instanceof Date && !isNaN(d.getTime()) ? d : new Date();
  return IST_FORMATTER.format(date).replace(/\s?(am|pm)$/i, "").trim();
}

/* ═══════════════════════════════════════════════════════════
   CHAT SCRIPT
   ═══════════════════════════════════════════════════════════ */

type ChatFrom = "ava" | "me";

type ChatLine = {
  from: ChatFrom;
  text: string;
  hold: number;
  typing: number;
};

type LiveChatLine = ChatLine & { at?: Date };

const HOLD_DELTA_MS = 890;

const RAW_CHAT_SCRIPT: ChatLine[] = [
  { from: "ava", text: "Geneva just adjourned. The board accepted our counter-offer.",       hold: 1150, typing: 750 },
  { from: "me",  text: "Unanimous?",                                                         hold: 850,  typing: 450 },
  { from: "ava", text: "7 to 0. Full creative control stays with us.",                       hold: 1100, typing: 650 },
  { from: "me",  text: "Good. We weren't walking into that room for anything less.",         hold: 1150, typing: 750 },
  { from: "ava", text: "Did the press catch wind of the Zurich meeting?",                    hold: 1100, typing: 700 },
  { from: "me",  text: "Not a whisper. Keeping the entire negotiation off email paid off.",  hold: 1250, typing: 850 },
  { from: "ava", text: "Only four people in this circle even know the term sheet exists.",   hold: 1200, typing: 800 },
  { from: "me",  text: "Let's keep it that way until Monday's bell.",                        hold: 1050, typing: 650 },
  { from: "ava", text: "I'm reviewing the final acquisition dossier on the train now.",      hold: 1150, typing: 750 },
  { from: "me",  text: "Check Clause 14. I had legal strip the non-compete.",                hold: 1150, typing: 700 },
  { from: "ava", text: "Saw that. Cleanest structuring I've seen all year.",                 hold: 1100, typing: 650 },
  { from: "me",  text: "Wire clears at 08:00 CET. Escrow is already funded.",                hold: 1150, typing: 750 },
  { from: "ava", text: "What about the Paris studio? Are we retaining the lead architects?", hold: 1200, typing: 850 },
  { from: "me",  text: "Spoke to them on voice twenty minutes ago. Everyone's in.",          hold: 1150, typing: 750 },
  { from: "ava", text: "That saves us six months of ramp-up.",                               hold: 1000, typing: 600 },
  { from: "me",  text: "Exactly. We hit the ground running in Q1.",                          hold: 1050, typing: 650 },
  { from: "ava", text: "I'm countersigning the master charter right now.",                   hold: 1100, typing: 700 },
  { from: "me",  text: "Send the sealed copy back here once your key signs it.",             hold: 1150, typing: 750 },
  { from: "ava", text: "Done. One last field on the founding colophon—",                     hold: 1100, typing: 700 },
  { from: "me",  text: "Which line?",                                                        hold: 850,  typing: 450 },
  { from: "ava", text: "The principal imprint on the cover page.",                           hold: 1100, typing: 650 },
  { from: "me",  text: "Put the official credit.",                                           hold: 950,  typing: 550 },
  { from: "ava", text: "Designed and created by?",                                           hold: 1100, typing: 600 },
  { from: "me",  text: "Designed and created by MAYANK",                                     hold: 2000, typing: 650 },
];

const CHAT_SCRIPT: ChatLine[] = RAW_CHAT_SCRIPT.map((l) => ({
  ...l,
  hold: l.hold + HOLD_DELTA_MS,
}));

const CHAT_VISIBLE = 11;

/* ═══════════════════════════════════════════════════════════
   STABLE AVATAR
   ═══════════════════════════════════════════════════════════ */

const ThreadAvatar = memo(function ThreadAvatar({
  className,
}: {
  className: string;
}) {
  return (
    <div
      className={`shrink-0 overflow-hidden rounded-full ring-1 ring-white/15 bg-[#16151D] ${className}`}
      style={{
        transform: "translate3d(0,0,0)",
        backfaceVisibility: "hidden",
      }}
    >
      <img
        src={FACE.ava}
        alt=""
        width={24}
        height={24}
        className="h-full w-full object-cover"
        decoding="sync"
        draggable={false}
      />
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════
   CHAT BUBBLE
   ═══════════════════════════════════════════════════════════ */
const ChatBubble = memo(function ChatBubble({ line }: { line: LiveChatLine }) {
  const mine = line.from === "me";
  const stamp = useMemo(() => formatClock(line.at), [line.at]);

  if (mine) {
    return (
      <div className="orbital-bubble-me flex w-full justify-end">
        <div className="flex max-w-[82%] flex-col items-end">
          <div className="rounded-[18px] rounded-br-[5px] border border-white/[0.14] bg-gradient-to-b from-[#18181F] to-[#0C0C10] px-3.5 py-2 text-[12px] font-medium leading-[1.45] text-[#F5EFE6] shadow-[0_6px_18px_-6px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.08)]">
            {line.text}
          </div>
          <div className="mt-0.5 flex items-center gap-1 pr-1.5">
            <span className="text-[8px] tabular-nums text-[#F0E4CC]/45">
              {stamp}
            </span>
            <CheckCheck size={10} className="text-amber-300" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="orbital-bubble-ava flex w-full items-end gap-2">
      <ThreadAvatar className="mb-4 h-6 w-6" />
      <div className="flex max-w-[78%] flex-col items-start">
        <div className="rounded-[18px] rounded-bl-[5px] border border-white/[0.08] bg-white/[0.05] px-3.5 py-2 text-[12px] leading-[1.45] text-[#F0E4CC]">
          {line.text}
        </div>
        <div className="mt-0.5 pl-1.5">
          <span className="text-[8px] tabular-nums text-[#F0E4CC]/45">
            {stamp}
          </span>
        </div>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════
   TYPING INDICATOR
   ═══════════════════════════════════════════════════════════ */

const TypingIndicator = memo(function TypingIndicator({
  from,
}: {
  from: ChatFrom;
}) {
  const mine = from === "me";

  const bubble = (
    <div className="flex items-center gap-1 rounded-[18px] border border-white/[0.10] bg-white/[0.075] px-3 py-2.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="orbital-typing-dot h-1.5 w-1.5 rounded-full bg-[#F0E4CC]/85"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );

  if (mine) {
    return (
      <div className="orbital-typing flex w-full justify-end">{bubble}</div>
    );
  }

  return (
    <div className="orbital-typing flex w-full items-end gap-2">
      <ThreadAvatar className="mb-0.5 h-6 w-6" />
      {bubble}
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════
   PHONE HEADER
   ═══════════════════════════════════════════════════════════ */

const PhoneHeader = memo(function PhoneHeader({
  isAvaTyping,
}: {
  isAvaTyping: boolean;
}) {
  return (
    <div
      className="relative z-30 shrink-0 px-4 pb-2.5 pt-12"
      style={{
        transform: "translate3d(0,0,0)",
        backfaceVisibility: "hidden",
        contain: "layout paint style",
        borderBottom: "1px solid rgba(255, 255, 255, 0.07)",
        background: "#08080B",
      }}
    >
      <div className="flex items-center gap-2.5">
        <ChevronLeft size={15} className="shrink-0 text-amber-300" />
        <div
          className="relative flex h-10 w-10 shrink-0 rounded-full ring-1 ring-amber-300/35 bg-[#16151D]"
          style={{
            transform: "translate3d(0,0,0)",
            backfaceVisibility: "hidden",
          }}
        >
          <img
            src={FACE.ava}
            alt="Élise Laurent"
            width={40}
            height={40}
            className="h-full w-full rounded-full object-cover"
            decoding="sync"
            draggable={false}
          />
          <span className="absolute -bottom-[1px] -right-[1px] h-3 w-3 rounded-full border-2 border-[#08080B] bg-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p className="truncate text-[12.5px] font-semibold leading-tight text-[#F0E4CC]">
              Élise Laurent
            </p>
          </div>
          <div className="relative mt-[1px] h-[14px] w-full overflow-hidden">
            <span
              className={`
                absolute left-0 top-0 text-[9px] leading-[14px] text-emerald-300
                transition-opacity duration-150 ease-out
                ${isAvaTyping ? "opacity-0" : "opacity-100"}
              `}
            >
              Active now
            </span>
            <span
              className={`
                absolute left-0 top-0 text-[9px] leading-[14px] text-amber-300
                transition-opacity duration-150 ease-out
                ${isAvaTyping ? "opacity-100" : "opacity-0"}
              `}
            >
              typing…
            </span>
          </div>
        </div>
        <button
          aria-label="Video"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08]"
        >
          <Video size={13} className="text-[#F0E4CC]/85" />
        </button>
        <button
          aria-label="Voice"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08]"
        >
          <Phone size={12} className="text-[#F0E4CC]/85" />
        </button>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════
   PANEL
   ═══════════════════════════════════════════════════════════ */

function PhoneChat() {
  const [messages, setMessages] = useState<
    { line: LiveChatLine; key: number }[]
  >([]);
  const [typing, setTyping] = useState<ChatFrom | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRaf = useRef(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) {
      const now = new Date();
      setMessages(
        CHAT_SCRIPT.slice(0, CHAT_VISIBLE).map((line, idx) => ({
          line: { ...line, at: now },
          key: idx,
        })),
      );
      return;
    }
    let cancelled = false;
    const timers: number[] = [];

    const step = (i: number) => {
      if (cancelled) return;
      const baseLine = CHAT_SCRIPT[i % CHAT_SCRIPT.length];

      timers.push(
        window.setTimeout(() => {
          if (!cancelled) setTyping(baseLine.from);
        }, 0),
      );

      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          const stamped: LiveChatLine = { ...baseLine, at: new Date() };
          setTyping(null);
          setMessages((prev) => {
            const next = [...prev, { line: stamped, key: i }];
            return next.length > CHAT_VISIBLE
              ? next.slice(next.length - CHAT_VISIBLE)
              : next;
          });
          timers.push(window.setTimeout(() => step(i + 1), baseLine.hold));
        }, baseLine.typing),
      );
    };

    timers.push(window.setTimeout(() => step(0), 400));

    return () => {
      cancelled = true;
      for (const t of timers) window.clearTimeout(t);
    };
  }, [reduce]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);

    const target = el.scrollHeight - el.clientHeight;
    const from = el.scrollTop;
    const dist = target - from;

    if (Math.abs(dist) < 1) return;

    if (reduce) {
      el.scrollTop = target;
      return;
    }

    const dur = 280;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      el.scrollTop = from + dist * e;
      if (t < 1) scrollRaf.current = requestAnimationFrame(tick);
    };
    scrollRaf.current = requestAnimationFrame(tick);

    return () => {
      if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    };
  }, [messages.length, typing, reduce]);

  return (
    <div
      className="relative flex h-full w-full flex-col bg-[#08080B]"
      style={{
        transform: "translate3d(0,0,0)",
        backfaceVisibility: "hidden",
      }}
    >
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_-8%,rgba(200,136,58,0.16),transparent_56%)]" />

      <StatusBar />

      <PhoneHeader isAvaTyping={typing === "ava"} />

      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          className="h-full overflow-y-auto overflow-x-hidden px-4 pt-3"
          style={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            contain: "layout paint style",
            transform: "translate3d(0,0,0)",
            backfaceVisibility: "hidden",
            overflowAnchor: "none",
          }}
        >
          <div className="flex justify-center pb-3">
            <span className="rounded-full bg-white/[0.05] px-2.5 py-[3px] text-[8px] uppercase tracking-[0.16em] tabular-nums text-[#F0E4CC]/60">
              Today · Encrypted
            </span>
          </div>

          <div className="flex flex-col gap-2 pb-3">
            {messages.map(({ line, key }) => (
              <ChatBubble key={key} line={line} />
            ))}

            {typing && <TypingIndicator key={`t-${typing}`} from={typing} />}
          </div>
        </div>

        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-4 bg-gradient-to-b from-[#08080B] to-transparent"
          style={{ transform: "translate3d(0,0,0)" }}
        />
      </div>

      <div className="relative z-20 shrink-0 rounded-b-[36px] border-t border-white/[0.07] bg-[#08080B] px-3 pb-5 pt-2 sm:rounded-b-[42px] sm:pb-6 sm:pt-2.5">
        <div className="flex items-center gap-1.5">
          <button
            aria-label="Add"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] sm:h-9 sm:w-9"
          >
            <Plus size={14} className="text-[#F0E4CC]/80" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.06] px-3 py-2 sm:gap-2 sm:px-3.5 sm:py-2.5">
            <span className="truncate text-[11px] text-[#F0E4CC]/45 sm:text-[11.5px]">
              Message…
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              <Smile size={12} className="text-[#F0E4CC]/50" />
              <Paperclip size={12} className="text-[#F0E4CC]/50" />
              <Camera size={12} className="text-[#F0E4CC]/50" />
            </div>
          </div>
          <button
            aria-label="Send"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-gradient-to-b from-[#1E1E26] to-[#0D0D12] shadow-[0_4px_14px_-4px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.1)] sm:h-9 sm:w-9"
          >
            <Send size={11} className="text-[#F0E4CC]" />
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-1.5 left-1/2 z-30 h-[3px] w-24 -translate-x-1/2 rounded-full bg-[#F0E4CC]/45" />
    </div>
  );
}

const TabbedPhoneUI = memo(PhoneChat);

/* ═══════════════════════════════════════════════════════════
   SCROLL RAIL
   ═══════════════════════════════════════════════════════════ */

const BEAT_LABELS = [
  "Origin",
  "Signal",
  "Vault",
  "Circle",
  "Resonance",
  "Arrival",
];

function ScrollRail() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const cb = (i: number) => setActive(i);
    beatListeners.push(cb);
    return () => {
      const k = beatListeners.indexOf(cb);
      if (k >= 0) beatListeners.splice(k, 1);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 lg:block">
      <ul className="pointer-events-auto space-y-3.5">
        {BEAT_LABELS.map((label, i) => (
          <li key={label} className="group flex items-center justify-end gap-3">
            <span
              className={`pointer-events-none text-right text-[10px] uppercase tracking-[0.24em] transition-all duration-500 ${
                active === i
                  ? "translate-x-0 text-amber-200 opacity-100"
                  : "translate-x-3 text-stone-300 opacity-0 group-hover:translate-x-0 group-hover:opacity-90"
              }`}
            >
              {label}
            </span>
            <a
              href={`#beat-${i}`}
              onClick={(e) => {
                if (!lenisInstance) return;
                e.preventDefault();
                lenisInstance.scrollTo(`#beat-${i}`, { duration: 1.4 });
              }}
              aria-label={label}
              className="flex h-3 w-3 items-center justify-center"
            >
              <span
                className={`block rounded-full transition-all duration-500 ${
                  active === i
                    ? "h-2.5 w-2.5 bg-[#C8883A] shadow-[0_0_12px_#C8883A]"
                    : "h-1.5 w-1.5 bg-[#555] group-hover:bg-stone-300"
                }`}
              />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SHARED UI
   ═══════════════════════════════════════════════════════════ */

const PrimaryButton = memo(function PrimaryButton({
  children,
  to,
  href,
  download,
  external,
}: {
  children: React.ReactNode;
  to?: string;
  href?: string;
  download?: boolean;
  external?: boolean;
}) {
  const cls =
    "group inline-flex items-center justify-center gap-2.5 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-6 py-3.5 text-[13.5px] font-semibold tracking-[-0.01em] text-[#150E03] shadow-[0_10px_36px_-14px_rgba(200,136,58,0.85),inset_0_1px_0_rgba(255,255,255,0.30)] transition-[transform,box-shadow] duration-300 ease-out will-change-transform hover:-translate-y-0.5 hover:shadow-[0_18px_50px_-14px_rgba(200,136,58,1),inset_0_1px_0_rgba(255,255,255,0.40)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70";
  const content = (
    <>
      {children}
      <ArrowRight
        size={16}
        className="transition-transform duration-300 ease-out group-hover:translate-x-1"
      />
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cls}>
        {content}
      </Link>
    );
  }
  return (
    <a
      href={href}
      download={download || undefined}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={cls}
    >
      {content}
    </a>
  );
});

const GhostButton = memo(function GhostButton({
  children,
  to,
  href,
}: {
  children: React.ReactNode;
  to?: string;
  href?: string;
}) {
  const cls =
    "group inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.02] px-6 py-3.5 text-[13.5px] text-stone-100 transition-all duration-300 hover:border-white/35 hover:bg-white/[0.06] hover:text-white";
  const content = (
    <>
      {children}
      <ArrowRight
        size={15}
        className="transition-transform duration-300 group-hover:translate-x-0.5"
      />
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cls}>
        {content}
      </Link>
    );
  }
  return (
    <a href={href} className={cls}>
      {content}
    </a>
  );
});

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 inline-flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.28em] text-amber-300">
      <span className="h-px w-8 bg-gradient-to-r from-transparent to-amber-400" />
      {children}
    </div>
  );
}

function Reveal({
  children,
  className = "",
  delay = 0,
  y = 28,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y, scale: 0.985 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ ...CINEMATIC_SPRING, delay: reduce ? 0 : delay }}
      className={`will-change-transform ${className}`}
    >
      {children}
    </motion.div>
  );
}

function Section({
  id,
  children,
  align = "left",
}: {
  id: string;
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  const justify =
    align === "left"
      ? "justify-start"
      : align === "right"
        ? "justify-end"
        : "justify-center";
  const textAlign = align === "center" ? "text-center" : "";
  return (
    <section
      id={id}
      className={`section-safe relative flex w-full items-center ${justify} px-5 sm:px-8 lg:px-14`}
      style={{ contain: "layout paint" }}
    >
      <div
        className={`relative z-10 w-full max-w-[560px] ${textAlign} ${
          align === "center" ? "mx-auto" : ""
        }`}
      >
        {children}
      </div>
    </section>
  );
}

const SERIF = { fontFamily: '"Instrument Serif", Georgia, serif' } as const;
const H2 =
  "text-[clamp(36px,5.2vw,68px)] font-medium leading-[1] tracking-[-0.055em] text-white";
const ACCENT = "font-normal italic tracking-[-0.03em] text-amber-300";
const BODY = "mt-7 max-w-[440px] text-[15px] leading-[1.85] text-stone-200";

/* ═══════════════════════════════════════════════════════════
   BEAT 0 — ORIGIN
   ═══════════════════════════════════════════════════════════ */

function Words({ text }: { text: string }) {
  const reduce = useReducedMotion();
  return (
    <>
      {text.split(" ").map((w, i) => (
        <span
          key={i}
          className="inline-block overflow-hidden pb-[0.08em] align-bottom"
        >
          <motion.span
            className="inline-block will-change-transform"
            initial={reduce ? false : { y: "110%" }}
            animate={{ y: 0 }}
            transition={{ ...CINEMATIC_SPRING, delay: 0.08 + i * 0.07 }}
          >
            {w}&nbsp;
          </motion.span>
        </span>
      ))}
    </>
  );
}

function BeatOrigin({ mobile }: { mobile: boolean }) {
  return (
    <section
      id="beat-0"
      className="section-safe relative flex w-full items-center px-5 sm:px-8 lg:px-14"
      style={{ contain: "layout paint" }}
    >
      <div className="relative z-10 grid w-full max-w-[1440px] items-center gap-12 lg:grid-cols-[1fr_0.9fr] lg:gap-20">
        <div className="mx-auto max-w-[640px] text-center lg:mx-0 lg:text-left">
          <Reveal>
            <div className="mb-8 inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 backdrop-blur-md">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-50" />
                <span className="relative h-2 w-2 rounded-full bg-amber-400" />
              </span>
              <span className="text-[10px] uppercase tracking-[0.22em] text-stone-100">
                A conversation, rebuilt
              </span>
            </div>
          </Reveal>

          <Reveal delay={0.06}>
            <h1 className="text-[clamp(46px,9vw,110px)] font-medium leading-[0.94] tracking-[-0.055em] text-white">
              <Words text="Where it all" />
              <br />
              <span className={ACCENT} style={SERIF}>
                begins.
              </span>
            </h1>
          </Reveal>

          <Reveal delay={0.12}>
            <p className="mx-auto mt-8 max-w-[460px] text-[15px] leading-[1.85] text-stone-200 lg:mx-0">
              Every message starts somewhere. Orbital gives it a place built
              only for the people inside it.
            </p>
          </Reveal>

          <Reveal delay={0.18}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <PrimaryButton to="/register">Create account</PrimaryButton>
              <GhostButton to="/login">Sign in</GhostButton>
            </div>
          </Reveal>

          <Reveal delay={0.26}>
            <div className="mt-12 flex flex-wrap justify-center gap-x-8 gap-y-3 text-[12px] text-stone-300 lg:justify-start">
              <span className="flex items-center gap-2">
                <LockKeyhole size={13} className="text-amber-300" />
                End-to-end encrypted
              </span>
              <span className="flex items-center gap-2">
                <ShieldCheck size={13} className="text-amber-300" />
                No ads, ever
              </span>
              <span className="flex items-center gap-2">
                <Video size={13} className="text-amber-300" />
                Voice &amp; video
              </span>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.14}>
          <div className="relative mx-auto w-full max-w-[420px]">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[140%] w-[140%] -translate-x-1/2 -translate-y-1/2"
              style={{
                background:
                  "radial-gradient(circle, rgba(200,136,58,0.26) 0%, rgba(200,136,58,0.07) 35%, transparent 68%)",
              }}
            />
            <div className="orbital-float">
              <PhoneMockup mobile={mobile}>
                <TabbedPhoneUI />
              </PhoneMockup>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   BEAT 1 — SIGNAL
   ═══════════════════════════════════════════════════════════ */

function Filmstrip() {
  const frames = [SCENE.tokyo, SCENE.paris, SCENE.aurora];
  return (
    <div className="mt-9 flex gap-3">
      {frames.map((src, i) => (
        <motion.div
          key={src}
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ ...CINEMATIC_SPRING, delay: 0.08 * i }}
          className="relative h-[128px] flex-1 overflow-hidden rounded-[14px] border border-white/15 bg-[#0C0C10]"
        >
          <img
            src={src}
            alt=""
            className="h-full w-full object-cover object-center brightness-90"
            loading="lazy"
            decoding="async"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 to-transparent" />
          <span className="absolute bottom-1.5 left-2 text-[8.5px] uppercase tabular-nums tracking-[0.2em] text-[#F0E4CC]">
            0{i + 1}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

function BeatSignal() {
  return (
    <Section id="beat-1" align="right">
      <Reveal>
        <Eyebrow> Signal</Eyebrow>
      </Reveal>
      <Reveal delay={0.06}>
        <h2 className={H2}>
          A message leaves
          <br />
          <span className={ACCENT} style={SERIF}>
            already sealed.
          </span>
        </h2>
      </Reveal>
      <Reveal delay={0.12}>
        <p
          className={`${BODY} !text-white !opacity-100 mx-auto max-w-xl rounded-2xl bg-black/60 px-6 py-4 backdrop-blur-md ring-1 ring-white/25 shadow-[0_0_40px_rgba(255,255,255,0.18)] [text-shadow:0_2px_12px_rgba(0,0,0,0.8)]`}
        >
          Encrypted on your device before it touches the network — a cipher
          only your circle can open.
        </p>
      </Reveal>
      <Reveal delay={0.18}>
        <div className="mt-9 grid grid-cols-3 gap-3">
          {[
            { label: "On device", value: "AES-256" },
            { label: "In transit", value: "X25519" },
            { label: "Keys", value: "Never shared" },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-white/12 bg-white/[0.04] p-4 backdrop-blur-md"
            >
              <p className="text-[9.5px] uppercase tracking-[0.2em] text-stone-300">
                {item.label}
              </p>
              <p className="mt-2 text-[13px] font-semibold text-amber-300">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </Reveal>
      <Reveal delay={0.24}>
        <Filmstrip />
      </Reveal>
    </Section>
  );
}

/* ═══════════════════════════════════════════════════════════
   BEAT 2 — VAULT
   ═══════════════════════════════════════════════════════════ */

function BeatVault() {
  return (
    <section
      id="beat-2"
      className="section-safe relative flex w-full items-center px-5 sm:px-8 lg:px-14"
      style={{ contain: "layout paint" }}
    >
      <div className="relative z-10 grid w-full max-w-[1440px] items-center gap-14 lg:grid-cols-[0.9fr_1fr] lg:gap-20">
        <Reveal delay={0.06}>
          <div className="relative overflow-hidden rounded-[28px] border border-white/15 bg-[#0B0A0D]/92 shadow-[0_50px_140px_-70px_rgba(200,136,58,0.55)] backdrop-blur-md">
            <div className="p-6 sm:p-9">
              <div className="flex items-center justify-between border-b border-white/[0.10] pb-5">
                <div className="flex items-center gap-3">
                  <img
                    src={FACE.sienna}
                    alt=""
                    className="h-11 w-11 rounded-full object-cover ring-1 ring-white/15"
                    loading="lazy"
                    decoding="async"
                  />
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.24em] text-stone-300">
                      Secure thread
                    </p>
                    <p className="mt-1 text-[14px] text-stone-100">
                      Sienna Vale
                    </p>
                  </div>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-amber-400/30 bg-amber-400/[0.12]">
                  <Fingerprint size={17} className="text-amber-300" />
                </div>
              </div>

              <div className="mt-7 space-y-4">
                <motion.div
                  initial={{ opacity: 0, scale: 0.94, x: -6 }}
                  whileInView={{ opacity: 1, scale: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={UI_SPRING}
                  className="max-w-[82%] rounded-[20px] rounded-tl-[6px] border border-white/[0.10] bg-white/[0.06] px-4 py-3.5 text-[13.5px] leading-[1.55] text-stone-100"
                >
                  Are we still on for the keynote review tomorrow?
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, scale: 0.94, x: 6 }}
                  whileInView={{ opacity: 1, scale: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ ...UI_SPRING, delay: 0.14 }}
                  className="ml-auto max-w-[82%] rounded-[20px] rounded-tr-[6px] border border-amber-400/30 bg-amber-400/[0.14] px-4 py-3.5 text-[13.5px] leading-[1.55] text-amber-50"
                >
                  Confirmed — deck is locked ✦
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, scale: 0.94, y: 6 }}
                  whileInView={{ opacity: 1, scale: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ ...UI_SPRING, delay: 0.28 }}
                  className="overflow-hidden rounded-[16px] border border-white/[0.10] bg-white/[0.05]"
                >
                  <img
                    src={SCENE.nyfw}
                    alt=""
                    className="h-[150px] w-full object-cover object-center brightness-90"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-[11px] text-stone-200">
                      Studio Pavilion · Zurich
                    </span>
                    <Check size={13} className="text-amber-300" />
                  </div>
                </motion.div>
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-white/[0.10] bg-white/[0.03] px-6 py-4 text-[10px] uppercase tracking-[0.2em] text-stone-200 sm:px-9">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_10px_#C8883A]" />
              Sealed before transmission
            </div>
          </div>
        </Reveal>

        <div>
          <Reveal>
            <Eyebrow> Vault</Eyebrow>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className={H2}>
              The keys stay
              <br />
              <span className={ACCENT} style={SERIF}>
                in your hands.
              </span>
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className={BODY}>
              Keys are generated on your device and never leave it. Not to a
              server, not to a backup, not to us.
            </p>
          </Reveal>
          <Reveal delay={0.18}>
            <div className="mt-9 space-y-3.5">
              {[
                "Keys generated locally, never transmitted",
                "Independent, verifiable encryption",
                "Zero-knowledge architecture by design",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 text-[13.5px] text-stone-100"
                >
                  <Check size={15} className="shrink-0 text-amber-300" />
                  {item}
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   BEAT 3 — ORBIT
   ═══════════════════════════════════════════════════════════ */

function BeatOrbit() {
  return (
    <Section id="beat-3" align="right">
      <Reveal>
        <Eyebrow> Circle</Eyebrow>
      </Reveal>
      <Reveal delay={0.06}>
        <h2 className={H2}>
          Small circles,
          <br />
          <span className={ACCENT} style={SERIF}>
            kept close.
          </span>
        </h2>
      </Reveal>
      <Reveal delay={0.12}>
        <p className={BODY}>
          No feeds. No followers. Just the rooms you chose, capped at fifty
          people and sized for real conversation.
        </p>
      </Reveal>
      <Reveal delay={0.18}>
        <div className="mt-9 flex -space-x-3">
          {[
            FACE.ava,
            FACE.sienna,
            FACE.john,
            FACE.anita,
            FACE.finn,
            FACE.iris,
            FACE.lyra,
          ].map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              className="h-11 w-11 rounded-full border-2 border-[#04060A] object-cover"
              loading="lazy"
              decoding="async"
            />
          ))}
          <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#04060A] bg-white/[0.08] text-[10px] tabular-nums text-stone-200">
            +43
          </div>
        </div>
      </Reveal>
      <Reveal delay={0.24}>
        <div className="mt-9">
          <PrimaryButton to="/register">Create account</PrimaryButton>
        </div>
      </Reveal>
    </Section>
  );
}

/* ═══════════════════════════════════════════════════════════
   BEAT 4 — RESONANCE
   ═══════════════════════════════════════════════════════════ */

function BeatResonance() {
  return (
    <section
      id="beat-4"
      className="section-safe relative flex w-full items-center px-5 sm:px-8 lg:px-14"
      style={{ contain: "layout paint" }}
    >
      <div className="relative z-10 grid w-full max-w-[1440px] items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <div>
          <Reveal>
            <Eyebrow> Resonance</Eyebrow>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className={H2}>
              Some things are
              <br />
              <span className={ACCENT} style={SERIF}>
                better heard.
              </span>
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className={BODY}>
              Spatial audio, noise suppression, and low-latency calls that
              hold up on a bad connection.
            </p>
          </Reveal>
          <Reveal delay={0.18}>
            <div className="mt-9 grid grid-cols-2 gap-3">
              {[
                { icon: Mic, label: "Spatial audio" },
                { icon: MessageCircle, label: "Low latency" },
                { icon: Video, label: "Crisp 1080p" },
                { icon: Sparkles, label: "Noise suppression" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-3 rounded-2xl border border-white/12 bg-white/[0.04] p-3.5 backdrop-blur-md"
                >
                  <item.icon size={16} className="shrink-0 text-amber-300" />
                  <span className="text-[12px] text-stone-100">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.1}>
          <div className="relative overflow-hidden rounded-[28px] border border-white/12 bg-[#0B0A0D]/92 backdrop-blur-md">
            <div className="relative aspect-[4/5] w-full overflow-hidden bg-black">
              <img
                src={SCENE.manCall}
                alt=""
                className="h-full w-full object-cover object-center opacity-80 brightness-90"
                loading="lazy"
                decoding="async"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B0A0D] via-[#0B0A0D]/40 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-6">
                <div className="rounded-[20px] border border-white/[0.12] bg-black/65 p-4 backdrop-blur-md">
                  <div className="flex items-center gap-3">
                    <img
                      src={FACE.john}
                      alt=""
                      className="h-11 w-11 rounded-full object-cover ring-1 ring-white/15"
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="flex-1">
                      <p className="text-[13px] font-medium text-white">
                        John Reeves
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                        <span className="text-[10px] tabular-nums text-emerald-200">
                          02:47
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        aria-label="Mic"
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"
                      >
                        <Mic size={14} className="text-stone-100" />
                      </button>
                      <button
                        aria-label="Video"
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"
                      >
                        <Video size={14} className="text-stone-100" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   BEAT 5 — ARRIVAL
   ═══════════════════════════════════════════════════════════ */
function BeatArrival() {
  return (
    <Section id="beat-5" align="center">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-24 -inset-y-24 -z-10"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(4,6,10,0.72), transparent 70%)",
        }}
      />
      <Reveal>
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] border border-amber-400/35 bg-black/55 shadow-[0_0_70px_rgba(200,136,58,0.20)] backdrop-blur-md">
          <ArrowRight
            size={26}
            className="text-amber-300"
            style={{ transform: "rotate(45deg)" }}
          />
        </div>
      </Reveal>

      <Reveal delay={0.06}>
        <div className="mt-8">
          <Eyebrow> Arrival</Eyebrow>
        </div>
      </Reveal>

      <Reveal delay={0.12}>
        <h2 className="text-[clamp(40px,7.2vw,96px)] font-medium leading-[0.96] tracking-[-0.055em] text-white">
          Your world.
          <br />
          <span className={ACCENT} style={SERIF}>
            In your pocket.
          </span>
        </h2>
      </Reveal>

      <Reveal delay={0.18}>
        <p className="mx-auto mt-7 max-w-[480px] text-[15px] leading-[1.85] text-stone-200">
          The Orbital Android app keeps your circles, your calls, and your
          keys right where they belong — with you.
        </p>
      </Reveal>

      <Reveal delay={0.24}>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <PrimaryButton to="/register">Create account</PrimaryButton>
          <GhostButton to="/login">Sign in</GhostButton>
        </div>
      </Reveal>

      {!Capacitor.isNativePlatform() && (
        <Reveal delay={0.3}>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href={DOWNLOAD_HREF}
              download="Orbital.apk"
              className="group relative inline-flex items-center gap-3 overflow-hidden rounded-full border border-white/20 bg-white/[0.06] py-2.5 pl-3 pr-5 text-left backdrop-blur-md transition-all duration-300 ease-out will-change-transform hover:-translate-y-0.5 hover:border-amber-400/60 hover:bg-white/[0.10] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-amber-300 to-amber-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_6px_20px_-8px_rgba(200,136,58,0.9)]">
                <svg
                  viewBox="0 0 24 24"
                  className="h-[18px] w-[18px] text-[#150E03]"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M6 9.5C6 7.57 7.57 6 9.5 6h5C16.43 6 18 7.57 18 9.5V15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9.5Z" />
                  <circle cx="10" cy="10.2" r="0.9" fill="#F0E4CC" />
                  <circle cx="14" cy="10.2" r="0.9" fill="#F0E4CC" />
                  <path
                    d="M8.5 5.3 7.6 3.8M15.5 5.3l.9-1.5"
                    stroke="currentColor"
                    strokeWidth="1.1"
                    strokeLinecap="round"
                    fill="none"
                  />
                  <path
                    d="M4.4 11.4v4.2M19.6 11.4v4.2"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    fill="none"
                  />
                  <path
                    d="M9.5 18v2M14.5 18v2"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              </span>

              <span className="flex flex-col leading-tight">
                <span className="text-[9px] font-medium uppercase tracking-[0.22em] text-stone-300 transition-colors duration-300 group-hover:text-amber-200">
                  Download for
                </span>
                <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-white">
                  Android
                </span>
              </span>

              <ArrowRight
                size={15}
                className="ml-1 text-stone-300 transition-all duration-300 ease-out group-hover:translate-x-0.5 group-hover:text-amber-200"
              />
            </a>
          </div>
        </Reveal>
      )}

      <Reveal delay={0.36}>
        <div className="mx-auto mt-14 mb-8 h-px w-24 bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />
        <p className="text-[11px] uppercase tracking-[0.32em] text-stone-400">
          Orbital — for the people who matter
        </p>
      </Reveal>
    </Section>
  );
}
/* ═══════════════════════════════════════════════════════════
   STORY CHROME
   ═══════════════════════════════════════════════════════════ */

const BEAT_LINES = [
  "A message is born.",
  "The cipher travels, sealed.",
  "Only your key opens it.",
  "Many orbits, one thread.",
  "Voice becomes light.",
  "It lands. Your phone wakes.",
];

function ChapterTag() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const cb = (n: number) => setI(n);
    beatListeners.push(cb);
    return () => {
      const k = beatListeners.indexOf(cb);
      if (k >= 0) beatListeners.splice(k, 1);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-6 left-5 z-40 hidden sm:block lg:left-14">
      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={UI_SPRING}
          className="flex items-baseline gap-3"
        >
          <span className="text-[10px] uppercase tabular-nums tracking-[0.28em] text-amber-300">
            0{i + 1} / 06
          </span>
          <span className="text-[10px] uppercase tracking-[0.28em] text-stone-300">
            {BEAT_LABELS[i]}
          </span>
          <span className="text-[11px] text-stone-200">{BEAT_LINES[i]}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function ProgressLine() {
  const { scrollYProgress } = useScroll();
  const sx = useSpring(scrollYProgress, {
    stiffness: 280,
    damping: 30,
    mass: 0.4,
  });
  return (
    <motion.div
      aria-hidden="true"
      style={{ scaleX: sx, willChange: "transform" }}
      className="pointer-events-none fixed left-0 top-0 z-50 h-[2px] w-full origin-left bg-gradient-to-r from-[#C8883A] to-[#7096B4]"
    />
  );
}

/* ═══════════════════════════════════════════════════════════
   ROOT
   ═══════════════════════════════════════════════════════════ */

export function Landing() {
  const reduce = useReducedMotion();
  const [webGLAvailable, setWebGLAvailable] = useState(true);
  const tier = useDeviceTier();
  const mobile = useIsMobile();
  const hz = useRefreshRate();

  // isNative → inside the Capacitor Android/iOS shell. Only there we
  // skip Lenis and use native compositor scroll.
  // mobile → phone/tablet/touch-laptop for the perf pass; still gets
  // Lenis on the web.
  const isNative = Capacitor.isNativePlatform();

  // v18.3: Lenis autoRaf everywhere on web — decoupled from WebGL fps.
  useSmoothScroll(!reduce, isNative);

  useEffect(() => {
    if (typeof console !== "undefined") {
      console.info(
        `[Orbital] mobile=${mobile} native=${isNative} tier=${tier} hz=${hz}`,
      );
    }
  }, [mobile, isNative, tier, hz]);

  useEffect(() => {
    const h = (e: Event) => {
      const el = e.target;
      if (el instanceof HTMLImageElement && !el.dataset.fb) {
        el.dataset.fb = "1";
        el.removeAttribute("src");
        el.style.background = "linear-gradient(135deg,#6b4a22,#141a26)";
      }
    };
    document.addEventListener("error", h, true);
    return () => document.removeEventListener("error", h, true);
  }, []);

  const { maxDpr, minDpr } = useMemo(() => {
    // v18.3: mobile max 1.05 (was hard-pinned 1.0), min 0.65 so we can
    // actually recover under load. Desktop unchanged shape.
    if (mobile)
      return { maxDpr: 1.05, minDpr: 0.65 };
    const native =
      typeof window === "undefined"
        ? 1
        : Math.min(window.devicePixelRatio || 1, 2.0);
    const headroom = hz >= 144 ? 0.92 : hz >= 120 ? 0.96 : 1;
    const tierCap = tier === "low" ? 1.25 : tier === "mid" ? 1.65 : 1.9;
    const hi = Math.max(1.25, Math.min(native, tierCap) * headroom);
    return {
      maxDpr: Math.round(hi * 100) / 100,
      minDpr: Math.max(1.0, Math.round(hi * 0.8 * 100) / 100),
    };
  }, [tier, hz, mobile]);

  return (
    <main
      className="relative min-h-screen overflow-clip bg-[#04060A] tabular-nums text-stone-100 selection:bg-amber-400/30 selection:text-amber-100"
      style={{
        fontFamily:
          '"Plus Jakarta Sans", "SF Pro Text", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
      data-mobile={mobile}
      data-native={isNative}
      data-tier={tier}
      data-hz={hz}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&family=Instrument+Serif:ital@0;1&display=swap');

        :root {
          --font-display: "Instrument Serif", Georgia, serif;
          --font-sans: "Plus Jakarta Sans", "SF Pro Text", system-ui;
        }
        html {
          scroll-behavior: auto;
          -webkit-text-size-adjust: 100%;
        }
        body {
          margin: 0;
          background: #04060A;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
          overflow-x: hidden;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
          -webkit-overflow-scrolling: touch;
        }
        .orbital-content {
          font-family: var(--font-sans);
          font-feature-settings: 'ss01' 1, 'cv11' 1, 'tnum' 1;
        }
        .orbital-content canvas { display: block; }
        html.lenis, html.lenis body { height: auto; }
        .lenis.lenis-smooth { scroll-behavior: auto !important; }
        img { image-rendering: -webkit-optimize-contrast; }

        .section-safe {
          min-height: 100vh;
          min-height: 100svh;
          padding-top: calc(4rem + env(safe-area-inset-top, 0px));
          padding-bottom: calc(3.75rem + env(safe-area-inset-bottom, 0px));
        }
        @media (min-width: 1024px) {
          .section-safe {
            min-height: 0;
            height: 100vh;
            padding-top: 0;
            padding-bottom: 0;
          }
        }

        @keyframes orbital-phone-float {
          0%, 100% { transform: translate3d(0, 0px, 0); }
          50%      { transform: translate3d(0, -10px, 0); }
        }
        .orbital-float {
          animation: orbital-phone-float 6s ease-in-out infinite;
          will-change: transform;
          backface-visibility: hidden;
          transform: translate3d(0,0,0);
        }

        /* v18.3: fake bloom for mobile (no PostFX there) */
        @keyframes orbital-bloom {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 0.85; }
        }
        .orbital-bloom {
          animation: orbital-bloom 9s ease-in-out infinite;
          will-change: opacity;
          pointer-events: none;
        }

        @keyframes orbital-bubble-in-me {
          from { opacity: 0; transform: translate3d(8px, 10px, 0) scale(0.94); }
          to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
        }
        @keyframes orbital-bubble-in-ava {
          from { opacity: 0; transform: translate3d(-8px, 10px, 0) scale(0.94); }
          to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
        }
        .orbital-bubble-me  {
          animation: orbital-bubble-in-me 0.28s cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: transform, opacity;
          backface-visibility: hidden;
        }
        .orbital-bubble-ava {
          animation: orbital-bubble-in-ava 0.28s cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: transform, opacity;
          backface-visibility: hidden;
        }

        @keyframes orbital-typing-in {
          from { opacity: 0; transform: translate3d(0, 6px, 0) scale(0.94); }
          to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
        }
        .orbital-typing {
          animation: orbital-typing-in 0.16s ease-out both;
          will-change: transform, opacity;
          backface-visibility: hidden;
        }

        @keyframes orbital-typing-dot {
          0%, 60%, 100% { opacity: 0.3; transform: translate3d(0, 0, 0); }
          30%           { opacity: 1;   transform: translate3d(0, -2px, 0); }
        }
        .orbital-typing-dot {
          animation: orbital-typing-dot 1.1s ease-in-out infinite;
          backface-visibility: hidden;
        }

        @media (hover: none) and (pointer: coarse) {
          * {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
          }
          html, body {
            overscroll-behavior: none;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          html { scroll-behavior: auto; }
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>

      {!reduce && webGLAvailable && (
        <div
          className="pointer-events-none fixed inset-0 z-0"
          aria-hidden="true"
          style={{
            transform: "translate3d(0,0,0)",
            backfaceVisibility: "hidden",
            contain: "strict",
          }}
        >
          <Canvas
            /* v18.3: starts at MIN. AdaptiveResolution ramps up from there. */
            dpr={minDpr}
            camera={{ position: [0, 0.05, 7.2], fov: FOV, near: 0.1, far: 260 }}
            gl={
              {
                antialias: mobile ? false : tier === "low",
                alpha: false,
                powerPreference: mobile ? "default" : "high-performance",
                stencil: false,
                depth: true,
                desynchronized: !mobile,
                preserveDrawingBuffer: false,
              } as any
            }
            onCreated={({ gl }) => {
              gl.setClearColor(DEEP, 1);
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 1.05;
              const canvas = gl.domElement;
              canvas.addEventListener(
                "webglcontextlost",
                () => setWebGLAvailable(false),
                { once: true },
              );
            }}
            fallback={<div className="absolute inset-0 bg-[#04060A]" />}
          >
            <Suspense fallback={null}>
              <OrbitalWorld
                tier={tier}
                hz={hz}
                mobile={mobile}
                isNative={isNative}
              />
              <AdaptiveResolution
                min={minDpr}
                max={maxDpr}
                targetFps={hz}
                mobile={mobile}
              />
            </Suspense>
          </Canvas>

          <div className="absolute inset-0 bg-gradient-to-b from-[#04060A]/25 via-transparent to-[#04060A]/90" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#04060A]/70 via-[#04060A]/15 to-transparent" />

          {/* v18.3: fake bloom on mobile (they don't get PostFX) */}
          {mobile && (
            <div
              className="orbital-bloom absolute inset-0"
              style={{
                background:
                  "radial-gradient(circle at 50% 42%, rgba(200,136,58,0.11) 0%, transparent 46%), radial-gradient(circle at 18% 78%, rgba(200,136,58,0.06) 0%, transparent 40%)",
                mixBlendMode: "screen",
              }}
            />
          )}
        </div>
      )}

      {(reduce || !webGLAvailable) && (
        <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_30%,rgba(200,136,58,0.12),transparent_45%)]" />
        </div>
      )}

      <ScrollRail />
      <ProgressLine />
      <ChapterTag />

      <div className="orbital-content relative z-10">
        <BeatOrigin mobile={mobile} />
        <BeatSignal />
        <BeatVault />
        <BeatOrbit />
        <BeatResonance />
        <BeatArrival />
      </div>
    </main>
  );
}

export default Landing;