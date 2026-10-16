/**
 * @file src/pages/Landing.tsx
 * Orbital — cinematic 3D journey with live chat.
 *
 * v14 · high-refresh native · smoother + faster
 *
 *   · Runs natively at 60 / 90 / 120 / 144 Hz — pure delta-time, no frame locks.
 *   · Post-processing pass removed; ACES tone mapping moved onto the renderer
 *     (one less full-screen pass + no half-res render target = big GPU win).
 *   · Adaptive DPR: resolution scales itself to hold your display's refresh rate.
 *   · Snappier damping + spring constants across scroll, camera and chat.
 *   · Chat hero floaters memoised so the chat tick never re-renders static DOM.
 *   · Phone never overflows the viewport — sized from height.
 *   · Android-safe: dvh units, tap-highlight reset, touch-action.
 */

import React, {
  Suspense,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Timer } from "three/src/core/Timer.js";

import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Camera,
  Check,
  CheckCheck,
  LockKeyhole,
  MessageCircle,
  Mic,
  Phone,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Video,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════
   IMAGE ASSETS
   ═══════════════════════════════════════════════════════════ */

const u = (id: string, w: number, q = 92) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&q=${q}&auto=format&fit=crop`;

const PORTRAIT = {
  alexa:   u("1517841905240-472988babdf9", 1600),
  maya:    u("1531123897727-8f129e1688ce", 1600),
  jamie:   u("1494790108377-be9c29b29330", 1600),
  river:   u("1524253482453-3fed8d2fe12b", 1600),
  aisha:   u("1573496359142-b8d87734a5a2", 1600),
  iris:    u("1524504388940-b1c1722653e1", 1600),
  nova:    u("1521119989659-a83eee488004", 1600),
  theo:    u("1519085360753-af0119f7cbe7", 1600),
  blake:   u("1500648767791-00dcc994a43e", 1600),
  finn:    u("1531746020798-e6953c6e8e04", 1600),
  camille: u("1531746020798-e6953c6e8e04", 1600),
} as const;

const MEDIA = {
  twoFriends:   u("1543269865-cbf427effbad", 2400),
  friendsLaugh: u("1529156069898-49953e39b3ac", 2400),
  womanSmile:   u("1494790108377-be9c29b29330", 2400),
  groupDusk:    u("1522071820081-009f0129c71c", 2400),
  cafe:         u("1517245386807-bb43f82c33c4", 2400),
  hug:          u("1523301343968-6a6ebf63c672", 2400),
  womanCall:    u("1519389950473-47ba0277781c", 2400),
  dinner:       u("1543007630-9710e4a00a20", 2400),
  coupleWalk:   u("1518199266791-5375a83190b7", 2400),
  carRide:      u("1469854523086-cc02fe5d8800", 2400),
  rooftop:      u("1499750310107-5fef28a66643", 2400),
} as const;

/* ═══════════════════════════════════════════════════════════
   PLANET TEXTURES
   ═══════════════════════════════════════════════════════════ */

const PLANET_TEX = {
  mars:    "/textures/mars.jpg",
  jupiter: "/textures/jupiter.jpg",
  saturn:  "/textures/saturn.jpg",
  moon:    "/textures/moon.jpg",
  titan:   "/textures/titan.jpg",
  uranus:  "/textures/uranus.jpg",
} as const;

const DEEP = "#07070A";
const AMBER = "#F59E0B";
const GOLD = "#FCD34D";
const DOWNLOAD_HREF = "/downloads/orbital.apk";

/**
 * Slow-frame guard. Everything is driven by real delta-time, so at 60 / 90 /
 * 120 / 144 Hz the motion is bit-for-bit identical in *speed* — this only
 * stops a single 400 ms hitch from teleporting the camera across the scene.
 */
const MAX_DT = 1 / 30;

/* ═══════════════════════════════════════════════════════════
   TIMER
   ═══════════════════════════════════════════════════════════ */

const timer = new Timer();
timer.connect(document);

/* ═══════════════════════════════════════════════════════════
   MATH
   ═══════════════════════════════════════════════════════════ */

/** Frame-rate independent exponential smoothing. */
function damp(c: number, t: number, λ: number, dt: number) {
  return c + (t - c) * (1 - Math.exp(-λ * dt));
}

function dampVec3(c: THREE.Vector3, t: THREE.Vector3, λ: number, dt: number) {
  const a = 1 - Math.exp(-λ * dt);
  c.x += (t.x - c.x) * a;
  c.y += (t.y - c.y) * a;
  c.z += (t.z - c.z) * a;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Seconds since the last frame, clamped. `Timer.getDelta()` is memoised
 *  per `update()`, so every component reads the exact same value. */
const frameDelta = () => Math.min(timer.getDelta(), MAX_DT);

/* ═══════════════════════════════════════════════════════════
   DEVICE TIER — resolved synchronously so the GL context is
   created once with the right settings (no tier flicker).
   ═══════════════════════════════════════════════════════════ */

type Tier = "low" | "mid" | "high";

function detectTier(): Tier {
  if (typeof navigator === "undefined") return "mid";
  const cores = (navigator as any).hardwareConcurrency ?? 4;
  const mem = (navigator as any).deviceMemory ?? 4;
  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile || cores <= 4 || mem <= 3) return "low";
  if (cores >= 8 && mem >= 8) return "high";
  return "mid";
}

const useDeviceTier = () => useState<Tier>(detectTier)[0];

/* ═══════════════════════════════════════════════════════════
   REFRESH RATE — measured from rAF, so it reflects what the
   browser will *actually* give us (60 / 90 / 120 / 144 …).
   ═══════════════════════════════════════════════════════════ */

const REFRESH_STEPS = [60, 75, 90, 100, 120, 144, 165, 240];

function useRefreshRate() {
  const [hz, setHz] = useState(60);

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let start = 0;

    const loop = (t: number) => {
      if (frames === 0) start = t;
      frames += 1;
      const span = t - start;

      if (span >= 420 && frames > 8) {
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

const store = { raw: 0, smooth: 0, velocity: 0 };
const beatListeners = new Set<(i: number) => void>();
let lastBeat = -1;

function ScrollDriver() {
  const prev = useRef(0);

  useEffect(() => {
    let raf = 0;

    const read = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      store.raw = max > 0 ? clamp01(window.scrollY / max) : 0;
    };

    // rAF-throttled: never do layout reads more than once per frame.
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(read);
    };

    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useFrame(() => {
    timer.update();

    const dt = frameDelta();

    // Tighter follow → the scene tracks your finger almost 1:1, but the
    // exponential still rounds off the rough edges of wheel/trackpad input.
    store.smooth = damp(store.smooth, store.raw, 26, dt);

    const v = (store.smooth - prev.current) / Math.max(dt, 1e-4);
    prev.current = store.smooth;
    store.velocity = damp(store.velocity, v, 20, dt);

    const beat = Math.min(5, Math.floor(store.smooth * 5 + 1e-6));
    if (beat !== lastBeat) {
      lastBeat = beat;
      beatListeners.forEach((fn) => fn(beat));
    }
  });

  return null;
}

/* ═══════════════════════════════════════════════════════════
   ADAPTIVE RESOLUTION
   Keeps the render loop glued to the panel's refresh rate by
   trading pixels, never frames.
   ═══════════════════════════════════════════════════════════ */

function AdaptiveResolution({
  min,
  max,
  targetFps,
}: {
  min: number;
  max: number;
  targetFps: number;
}) {
  const setDpr = useThree((s) => s.setDpr);

  const cur = useRef(max);
  const acc = useRef(0);
  const frames = useRef(0);
  const cooldown = useRef(3);
  const low = useRef(0);
  const high = useRef(0);

  useEffect(() => {
    cur.current = max;
    low.current = 0;
    high.current = 0;
    cooldown.current = 3;
    acc.current = 0;
    frames.current = 0;
    setDpr(max);
  }, [max, setDpr]);

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

    const target = targetFps * 0.95;

    if (fps < target * 0.85) {
      low.current += 1;
      high.current = 0;
    } else if (fps > target * 0.97) {
      high.current += 1;
      low.current = 0;
    } else {
      low.current = 0;
      high.current = 0;
    }

    if (low.current >= 2 && cur.current > min + 1e-3) {
      cur.current = Math.max(min, Math.round((cur.current - 0.15) * 1000) / 1000);
      setDpr(cur.current);
      low.current = 0;
      cooldown.current = 4;
    } else if (high.current >= 6 && cur.current < max - 1e-3) {
      cur.current = Math.min(max, Math.round((cur.current + 0.1) * 1000) / 1000);
      setDpr(cur.current);
      high.current = 0;
      cooldown.current = 8;
    }
  });

  return null;
}

/* ═══════════════════════════════════════════════════════════
   CAMERA RIG
   ═══════════════════════════════════════════════════════════ */

type Key = { pos: [number, number, number]; look: [number, number, number] };

const KEYS: Key[] = [
  { pos: [0, 0.6, 9],      look: [0, 0, 0] },
  { pos: [2.8, 1.0, -5],   look: [0, 0, -14] },
  { pos: [-2.6, 1.3, -19], look: [0, 0, -28] },
  { pos: [2.6, 0.7, -33],  look: [0, 0, -42] },
  { pos: [-2.4, 1.0, -47], look: [0, 0, -56] },
  { pos: [0, 0.5, -61],    look: [0, 0, -70] },
];

function CameraRig() {
  const { camera } = useThree();
  const reduce = useReducedMotion();

  const curPos = useRef(new THREE.Vector3(0, 0.6, 9));
  const curLook = useRef(new THREE.Vector3(0, 0, 0));
  const tgtPos = useRef(new THREE.Vector3());
  const tgtLook = useRef(new THREE.Vector3());

  useFrame(() => {
    const dt = frameDelta();
    const t = store.smooth;

    const f = t * (KEYS.length - 1);
    const lo = Math.min(KEYS.length - 1, Math.max(0, Math.floor(f)));
    const hi = Math.min(KEYS.length - 1, lo + 1);
    const frac = f - lo;

    const A = KEYS[lo];
    const B = KEYS[hi];

    const time = timer.getElapsed();
    const swayX = reduce ? 0 : Math.sin(time * 0.26) * 0.06;
    const swayY = reduce ? 0 : Math.cos(time * 0.20) * 0.045;

    const baseX = A.pos[0] + (B.pos[0] - A.pos[0]) * frac;
    const baseY = A.pos[1] + (B.pos[1] - A.pos[1]) * frac;
    const baseZ = A.pos[2] + (B.pos[2] - A.pos[2]) * frac;

    tgtPos.current.set(baseX + swayX, baseY + swayY, baseZ);

    const lookX = A.look[0] + (B.look[0] - A.look[0]) * frac;
    const lookY = A.look[1] + (B.look[1] - A.look[1]) * frac;
    const lookZ = A.look[2] + (B.look[2] - A.look[2]) * frac;
    tgtLook.current.set(lookX, lookY, lookZ);

    // 18 / 22 — fast enough to feel welded to the scroll, damped enough
    // that a 144 Hz panel gets a perfectly smooth glide instead of steps.
    dampVec3(curPos.current, tgtPos.current, 18, dt);
    dampVec3(curLook.current, tgtLook.current, 22, dt);

    camera.position.copy(curPos.current);
    camera.lookAt(curLook.current);
  });

  return null;
}

/* ═══════════════════════════════════════════════════════════
   TEXTURE CACHE
   ═══════════════════════════════════════════════════════════ */

const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
const MAX_ANISO = typeof navigator === "undefined" ? 4 : 8;

function usePlanetTexture(url: string, isColor = true): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(
    () => texCache.get(url) ?? null,
  );

  useLayoutEffect(() => {
    if (texCache.has(url)) {
      setTex(texCache.get(url)!);
      return;
    }

    let cancelled = false;
    texLoader.load(
      url,
      (t) => {
        if (cancelled) return;

        t.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.anisotropy = MAX_ANISO;
        t.generateMipmaps = true;
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        t.needsUpdate = true;

        texCache.set(url, t);
        setTex(t);
      },
      undefined,
      () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 128;
        const ctx = canvas.getContext("2d")!;
        const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, "#B08A52");
        grad.addColorStop(1, "#3A2A12");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 128);

        const fallback = new THREE.CanvasTexture(canvas);
        fallback.colorSpace = THREE.SRGBColorSpace;
        fallback.wrapS = THREE.RepeatWrapping;
        texCache.set(url, fallback);
        if (!cancelled) setTex(fallback);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [url, isColor]);

  return tex;
}

/* ═══════════════════════════════════════════════════════════
   ATMOSPHERE SHELL
   ═══════════════════════════════════════════════════════════ */

const ATMO_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vP;
  varying vec3 vLocal;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = wp.xyz;
    vLocal = position;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const ATMO_FRAG = /* glsl */ `
  precision mediump float;
  varying vec3 vN;
  varying vec3 vP;
  varying vec3 vLocal;
  uniform vec3  uColor;
  uniform vec3  uSunDir;
  uniform float uIntensity;
  uniform float uPower;

  void main() {
    vec3 V = normalize(cameraPosition - vP);
    vec3 N = normalize(vN);
    float fres = pow(1.0 - abs(dot(N, V)), uPower);

    vec3 sp = normalize(vLocal);
    float sun = dot(sp, normalize(uSunDir));
    float lit = smoothstep(-0.35, 0.55, sun);

    float a = fres * lit * uIntensity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

function AtmosphereShell({
  radius,
  color,
  intensity,
  sunDir = [0.7, 0.4, 0.55],
  power = 3.0,
}: {
  radius: number;
  color: string;
  intensity: number;
  sunDir?: [number, number, number];
  power?: number;
}) {
  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(color) },
      uSunDir: { value: new THREE.Vector3(...sunDir) },
      uIntensity: { value: intensity },
      uPower: { value: power },
    }),
    [color, intensity, sunDir, power],
  );

  return (
    <mesh>
      <sphereGeometry args={[radius, 32, 32]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={ATMO_VERT}
        fragmentShader={ATMO_FRAG}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
        side={THREE.FrontSide}
      />
    </mesh>
  );
}

/* ═══════════════════════════════════════════════════════════
   GENERIC PLANET
   ═══════════════════════════════════════════════════════════ */

type PlanetProps = {
  texture: string;
  radius: number;
  position: [number, number, number];
  rotationSpeed?: number;
  tilt?: number;
  atmosphereColor?: string;
  atmosphereIntensity?: number;
  hasRing?: boolean;
  ringColors?: [string, string];
  segments?: number;
  roughness?: number;
  tint?: string;
  tintStrength?: number;
};

function Planet({
  texture,
  radius,
  position,
  rotationSpeed = 0.1,
  tilt = 0,
  atmosphereColor = AMBER,
  atmosphereIntensity = 0.35,
  hasRing = false,
  ringColors = ["#D4B47A", "#9C7A45"],
  segments = 48,
  roughness = 0.92,
  tint = "#ffffff",
  tintStrength = 1,
}: PlanetProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const reduce = useReducedMotion();

  const mainTex = usePlanetTexture(texture);
  const colour = useMemo(() => new THREE.Color(tint), [tint]);

  useFrame(() => {
    if (reduce || rotationSpeed === 0) return;
    if (meshRef.current) {
      meshRef.current.rotation.y += frameDelta() * rotationSpeed;
    }
  });

  return (
    <group position={position} rotation={[tilt, 0, 0]}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[radius, segments, Math.round(segments * 0.6)]} />
        <meshStandardMaterial
          map={mainTex ?? undefined}
          color={mainTex ? colour : "#8B6A32"}
          roughness={roughness}
          metalness={0.02}
          emissive={colour}
          emissiveIntensity={mainTex ? (1 - tintStrength) * 0.15 : 0}
        />
      </mesh>

      <AtmosphereShell
        radius={radius * 1.045}
        color={atmosphereColor}
        intensity={atmosphereIntensity}
      />

      <mesh position={[0, 0, -0.01]}>
        <circleGeometry args={[radius * 1.9, 32]} />
        <meshBasicMaterial
          color={atmosphereColor}
          transparent
          opacity={0.05}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {hasRing && (
        <>
          <mesh rotation={[Math.PI / 2.35, 0, 0.28]}>
            <ringGeometry args={[radius * 1.4, radius * 2.15, 96]} />
            <meshBasicMaterial
              color={ringColors[0]}
              transparent
              opacity={0.55}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh rotation={[Math.PI / 2.35, 0, 0.28]}>
            <ringGeometry args={[radius * 2.2, radius * 2.5, 96]} />
            <meshBasicMaterial
              color={ringColors[1]}
              transparent
              opacity={0.32}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          <mesh rotation={[Math.PI / 2.35, 0, 0.28]}>
            <ringGeometry args={[radius * 2.55, radius * 2.85, 96]} />
            <meshBasicMaterial
              color={ringColors[0]}
              transparent
              opacity={0.18}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        </>
      )}
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════
   OBSIDIAN PLANET
   ═══════════════════════════════════════════════════════════ */

function ObsidianPlanet({
  position,
  radius = 1.65,
  tilt = 0.22,
}: {
  position: [number, number, number];
  radius?: number;
  tilt?: number;
}) {
  const crustRef = useRef<THREE.Mesh>(null);
  const reduce = useReducedMotion();

  const rockTexture = useMemo(() => {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#0A0806";
    ctx.fillRect(0, 0, size, size);

    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * 0.8));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.6));
    }
    ctx.putImageData(img, 0, 0);

    for (let i = 0; i < 60; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 20 + Math.random() * 90;
      const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
      const warm = Math.random() < 0.4;
      grd.addColorStop(
        0,
        warm ? "rgba(60, 34, 16, 0.10)" : "rgba(20, 20, 26, 0.12)",
      );
      grd.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = MAX_ANISO;
    return tex;
  }, []);

  useFrame(() => {
    if (reduce || !crustRef.current) return;
    crustRef.current.rotation.y += frameDelta() * 0.14;
  });

  return (
    <group position={position} rotation={[tilt, 0, 0]}>
      <mesh ref={crustRef}>
        <sphereGeometry args={[radius, 64, 64]} />
        <meshStandardMaterial
          map={rockTexture}
          color="#ffffff"
          roughness={0.95}
          metalness={0.08}
          envMapIntensity={0.7}
        />
      </mesh>

      <AtmosphereShell
        radius={radius * 1.045}
        color={AMBER}
        intensity={0.5}
        power={2.6}
      />

      <mesh position={[0, 0, -0.01]}>
        <circleGeometry args={[radius * 1.9, 32]} />
        <meshBasicMaterial
          color={AMBER}
          transparent
          opacity={0.05}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════
   BLACK HOLE
   ═══════════════════════════════════════════════════════════ */

function BlackHole({
  position,
  radius = 1.35,
  tilt = 0.42,
}: {
  position: [number, number, number];
  radius?: number;
  tilt?: number;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const photonRef = useRef<THREE.Mesh>(null);
  const primaryRef = useRef<THREE.Mesh>(null);
  const primaryInnerRef = useRef<THREE.Mesh>(null);
  const lensedRef = useRef<THREE.Mesh>(null);
  const coolRef = useRef<THREE.Mesh>(null);
  const einsteinRef = useRef<THREE.Mesh>(null);
  const reduce = useReducedMotion();

  useFrame(() => {
    if (reduce) return;
    const dt = frameDelta();
    const t = timer.getElapsed();

    if (primaryRef.current) primaryRef.current.rotation.z += dt * 0.28;
    if (primaryInnerRef.current) primaryInnerRef.current.rotation.z -= dt * 0.42;
    if (coolRef.current) coolRef.current.rotation.z += dt * 0.18;
    if (lensedRef.current) lensedRef.current.rotation.z -= dt * 0.08;

    if (photonRef.current) {
      photonRef.current.scale.setScalar(1 + Math.sin(t * 1.6) * 0.01);
    }
    if (einsteinRef.current) {
      einsteinRef.current.scale.setScalar(1 + Math.sin(t * 0.6) * 0.045);
    }
    if (rootRef.current) rootRef.current.rotation.y += dt * 0.04;
  });

  return (
    <group ref={rootRef} position={position} rotation={[tilt, 0, 0.12]}>
      <mesh>
        <sphereGeometry args={[radius, 48, 48]} />
        <meshBasicMaterial color="#000000" />
      </mesh>

      <mesh ref={photonRef}>
        <sphereGeometry args={[radius * 1.02, 32, 32]} />
        <meshBasicMaterial
          color="#FFF4CE"
          transparent
          opacity={0.95}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh ref={primaryInnerRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 1.14, radius * 1.55, 128, 1]} />
        <meshBasicMaterial
          color="#FFF1C4"
          transparent
          opacity={0.92}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh ref={primaryRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 1.65, radius * 2.55, 128, 1]} />
        <meshBasicMaterial
          color={GOLD}
          transparent
          opacity={0.72}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh ref={coolRef} rotation={[Math.PI / 2 + 0.06, 0.08, 0]}>
        <ringGeometry args={[radius * 1.5, radius * 2.15, 96, 1]} />
        <meshBasicMaterial
          color="#3E6FA8"
          transparent
          opacity={0.24}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh ref={lensedRef} rotation={[0, Math.PI / 2, 0]}>
        <ringGeometry args={[radius * 1.08, radius * 1.22, 128, 1]} />
        <meshBasicMaterial
          color="#FFE9A8"
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <mesh ref={einsteinRef}>
        <sphereGeometry args={[radius * 2.6, 24, 24]} />
        <meshBasicMaterial
          color={AMBER}
          transparent
          opacity={0.07}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════
   MOON
   ═══════════════════════════════════════════════════════════ */

function Moon({
  texture,
  radius,
  position,
  orbitRadius,
  orbitSpeed,
  tilt = 0,
}: {
  texture: string;
  radius: number;
  position: [number, number, number];
  orbitRadius: number;
  orbitSpeed: number;
  tilt?: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const reduce = useReducedMotion();
  const tex = usePlanetTexture(texture);

  useFrame(() => {
    if (!groupRef.current || reduce) return;
    const dt = frameDelta();
    const t = timer.getElapsed();
    const angle = t * orbitSpeed;
    groupRef.current.position.x = Math.cos(angle) * orbitRadius;
    groupRef.current.position.z = Math.sin(angle) * orbitRadius;
    groupRef.current.position.y = Math.sin(t * 0.5) * 0.12;
    if (meshRef.current) meshRef.current.rotation.y += dt * 0.25;
  });

  return (
    <group position={position} rotation={[tilt, 0, 0]}>
      <group ref={groupRef}>
        <mesh ref={meshRef}>
          <sphereGeometry args={[radius, 20, 14]} />
          <meshStandardMaterial
            map={tex ?? undefined}
            color={tex ? "#ffffff" : "#888"}
            roughness={0.95}
            metalness={0}
          />
        </mesh>
      </group>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════
   STARFIELD
   ═══════════════════════════════════════════════════════════ */

function Starfield({ count = 180 }: { count?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!ref.current) return;
    for (let i = 0; i < count; i++) {
      const r = 30 + Math.random() * 60;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      dummy.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        -20 - r * Math.cos(phi),
      );
      dummy.scale.setScalar(0.05 + Math.random() * 0.12);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  }, [count, dummy]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, count]}
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 4, 4]} />
      <meshBasicMaterial
        color="#C8B9A3"
        transparent
        opacity={0.6}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

/* ═══════════════════════════════════════════════════════════
   SYSTEM
   ═══════════════════════════════════════════════════════════ */

function OrbitalSystem({ tier }: { tier: Tier }) {
  const seg = tier === "low" ? 28 : 48;

  return (
    <>
      <ScrollDriver />
      <CameraRig />

      <color attach="background" args={[DEEP]} />
      <fog attach="fog" args={[DEEP, 12, 70]} />

      <directionalLight position={[6, 3.5, 4]} intensity={2.6} color="#FFE9C0" />
      <directionalLight position={[-5, -2, -8]} intensity={0.35} color="#4A5B8C" />
      <ambientLight intensity={0.08} color="#2A2A38" />

      <Starfield count={tier === "low" ? 90 : 180} />

      <ObsidianPlanet position={[2.7, 0, -2]} radius={1.65} tilt={0.22} />
      <Moon
        texture={PLANET_TEX.moon}
        radius={0.22}
        position={[2.7, 0, -2]}
        orbitRadius={2.4}
        orbitSpeed={0.5}
        tilt={0.35}
      />

      <Planet
        texture={PLANET_TEX.mars}
        radius={1.15}
        position={[-2.7, 0.3, -16]}
        rotationSpeed={0.16}
        tilt={0.18}
        tint="#D9A94E"
        tintStrength={0.72}
        atmosphereColor="#E8C77A"
        atmosphereIntensity={0.38}
        segments={seg}
        roughness={0.96}
      />

      <Planet
        texture={PLANET_TEX.jupiter}
        radius={2.15}
        position={[2.5, 0, -30]}
        rotationSpeed={0.09}
        tilt={0.08}
        tint="#F2D9A8"
        tintStrength={0.68}
        atmosphereColor="#E8B27A"
        atmosphereIntensity={0.28}
        segments={seg}
        roughness={0.78}
      />

      <Planet
        texture={PLANET_TEX.saturn}
        radius={1.85}
        position={[-2.5, 0.4, -44]}
        rotationSpeed={0.11}
        tilt={0.24}
        tint="#E8D2A0"
        tintStrength={0.72}
        atmosphereColor="#E8D2A8"
        atmosphereIntensity={0.32}
        hasRing
        ringColors={["#F2DCA8", "#9E8258"]}
        segments={seg}
        roughness={0.80}
      />
      <Moon
        texture={PLANET_TEX.titan}
        radius={0.18}
        position={[-2.5, 0.4, -44]}
        orbitRadius={3.4}
        orbitSpeed={0.35}
      />

      <Planet
        texture={PLANET_TEX.uranus}
        radius={1.2}
        position={[2.2, 0, -58]}
        rotationSpeed={0.11}
        tilt={0.92}
        tint="#A8DCEC"
        tintStrength={0.68}
        atmosphereColor="#9BDCEC"
        atmosphereIntensity={0.55}
        segments={seg}
        roughness={0.65}
      />

      <BlackHole position={[0, 0, -72]} radius={1.35} tilt={0.42} />
      <Moon
        texture={PLANET_TEX.moon}
        radius={0.14}
        position={[0, 0, -72]}
        orbitRadius={3.1}
        orbitSpeed={0.42}
      />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   PHONE MOCKUP — height-constrained, never overflows
   ═══════════════════════════════════════════════════════════ */

function PhoneMockup({ children }: { children?: React.ReactNode }) {
  return (
    <div
      className="relative mx-auto select-none"
      style={{
        height: "min(72dvh, 620px, 82vw * 2.0926)",
        aspectRatio: "0.4779",
        maxWidth: "100%",
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          borderRadius: "clamp(32px, 3.2vw, 54px)",
          background: `linear-gradient(155deg,
            #5A5A62 0%, #3A3A42 22%, #232328 45%,
            #1A1A1F 62%, #2F2F36 82%, #4F4F58 100%)`,
          boxShadow: `
            inset 0 0 0 1.5px rgba(255,255,255,0.18),
            inset 0 0 0 3px rgba(0,0,0,0.5),
            0 0 0 1px rgba(0,0,0,0.7),
            0 30px 90px -20px rgba(0,0,0,0.95),
            0 0 160px -40px rgba(245,158,11,0.42),
            0 70px 160px -40px rgba(0,0,0,0.75)`,
        }}
      />
      <div
        className="absolute"
        style={{
          inset: "clamp(4px, 0.5vw, 8px)",
          borderRadius: "clamp(28px, 2.8vw, 48px)",
          background: "#08080A",
        }}
      />
      <div
        className="absolute overflow-hidden"
        style={{
          inset: "clamp(5px, 0.8vw, 12px)",
          borderRadius: "clamp(26px, 2.6vw, 44px)",
          background: "#000",
        }}
      >
        {children}
      </div>
      <div
        className="absolute left-1/2 z-30 -translate-x-1/2"
        style={{
          top: "clamp(12px, 1.5vw, 24px)",
          width: "clamp(64px, 6.4vw, 104px)",
          height: "clamp(18px, 1.9vw, 30px)",
          borderRadius: "999px",
          background: "#000",
        }}
      />
      <div
        className="pointer-events-none absolute z-20"
        style={{
          inset: "clamp(5px, 0.8vw, 12px)",
          borderRadius: "clamp(26px, 2.6vw, 44px)",
          background: `linear-gradient(140deg,
            rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 18%,
            transparent 34%, transparent 66%,
            rgba(255,255,255,0.02) 84%, rgba(255,255,255,0.06) 100%)`,
        }}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   LIVE CHAT — text-only, continuous, logical
   ═══════════════════════════════════════════════════════════ */

type Message = {
  id: number;
  from: "me" | "alexa";
  text: string;
  time: string;
  status: "sent" | "delivered" | "read";
};

/* A single natural back-and-forth between two people. */
const CHAT_SCRIPT: Omit<Message, "id" | "time" | "status">[] = [
  { from: "me",    text: "hey, just landed" },
  { from: "alexa", text: "already? how was the flight" },
  { from: "me",    text: "quiet. window seat. finished the book" },
  { from: "alexa", text: "which one" },
  { from: "me",    text: "the one you gave me for my birthday" },
  { from: "alexa", text: "did you cry at the end" },
  { from: "me",    text: "obviously" },
  { from: "alexa", text: "told you" },
  { from: "me",    text: "walking to the hotel now" },
  { from: "alexa", text: "how's the city" },
  { from: "me",    text: "loud. warm. exactly how you described it" },
  { from: "alexa", text: "i miss it" },
  { from: "me",    text: "come with me next time" },
  { from: "alexa", text: "is that an invitation" },
  { from: "me",    text: "it is" },
  { from: "alexa", text: "then yes" },
  { from: "me",    text: "good. i'll book it tonight" },
  { from: "alexa", text: "text me when you're in the room" },
  { from: "me",    text: "will do" },
  { from: "alexa", text: "night ✦" },
  { from: "me",    text: "night" },
];

function useLiveChat(enabled: boolean) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [typingFrom, setTypingFrom] = useState<"me" | "alexa" | null>(null);
  const nextIndex = useRef(0);
  const timersRef = useRef<number[]>([]);

  const clearAll = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }, []);

  useEffect(() => {
    if (!enabled) {
      clearAll();
      return;
    }
    if (nextIndex.current !== 0) return;

    const schedule = (delay: number, fn: () => void) => {
      const t = window.setTimeout(fn, delay);
      timersRef.current.push(t);
    };

    const pushMessage = (m: Omit<Message, "id" | "time" | "status">) => {
      const now = new Date();
      const time = `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, "0")} ${now.getHours() >= 12 ? "PM" : "AM"}`;
      setMessages((prev) => {
        const msg: Message = { ...m, id: prev.length + 1, time, status: "sent" };
        const out = [...prev, msg];
        for (let j = out.length - 2; j >= 0; j--) {
          if (out[j].from === "me" && out[j].status === "sent") {
            out[j] = { ...out[j], status: "delivered" };
          }
        }
        return out;
      });

      schedule(300, () => {
        setMessages((prev) =>
          prev.map((p, idx) =>
            idx === prev.length - 1 && p.from === "me"
              ? { ...p, status: "delivered" }
              : p,
          ),
        );
      });
      schedule(760, () => {
        setMessages((prev) =>
          prev.map((p, idx) =>
            idx === prev.length - 1 && p.from === "me"
              ? { ...p, status: "read" }
              : p,
          ),
        );
      });
    };

    const tick = () => {
      const i = nextIndex.current;
      if (i >= CHAT_SCRIPT.length) {
        schedule(3200, () => {
          nextIndex.current = 0;
          setMessages([]);
          setTypingFrom(null);
          schedule(480, tick);
        });
        return;
      }

      const next = CHAT_SCRIPT[i];

      if (next.from === "alexa") {
        setTypingFrom("alexa");
        schedule(520, () => {
          setTypingFrom(null);
          pushMessage(next);
          nextIndex.current++;
          schedule(520 + Math.random() * 260, tick);
        });
      } else {
        pushMessage(next);
        nextIndex.current++;
        schedule(560 + Math.random() * 300, tick);
      }
    };

    schedule(360, tick);
    return clearAll;
  }, [enabled, clearAll]);

  return { messages, typingFrom };
}

/* ═══════════════════════════════════════════════════════════
   PHONE SCREEN — text-only chat
   ═══════════════════════════════════════════════════════════ */

function PhoneScreen({
  messages,
  typingFrom,
}: {
  messages: Message[];
  typingFrom: "me" | "alexa" | null;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, typingFrom]);

  return (
    <div className="relative flex h-full w-full flex-col bg-[#08080B]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(245,158,11,0.20),transparent_55%)]" />

      {/* Status bar */}
      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 pt-2 text-[9px] font-semibold tracking-tight text-white sm:px-5 sm:pt-2.5 sm:text-[10px]">
        <span className="ml-1">9:41</span>
        <div className="flex items-center gap-1.5">
          <div className="flex items-end gap-[2px]">
            <span className="block h-1 w-[2px] rounded-sm bg-white" />
            <span className="block h-1.5 w-[2px] rounded-sm bg-white" />
            <span className="block h-2 w-[2px] rounded-sm bg-white" />
            <span className="block h-2.5 w-[2px] rounded-sm bg-white/40" />
          </div>
          <span className="text-[8px]">5G</span>
          <div className="flex h-2.5 w-5 items-center rounded-[3px] border border-white/50 px-[1px] py-[1px]">
            <div className="h-full w-[78%] rounded-[1px] bg-white" />
          </div>
        </div>
      </div>

      {/* Thread header */}
      <div className="relative z-10 flex items-center gap-2 px-3 pb-2 pt-10 sm:gap-2.5 sm:px-4 sm:pb-2.5 sm:pt-11">
        <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full ring-1 ring-amber-400/30 sm:h-8 sm:w-8">
          <img
            src={PORTRAIT.alexa}
            alt=""
            className="h-full w-full object-cover"
            loading="eager"
            decoding="async"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium tracking-[-0.01em] text-white sm:text-[12px]">
            alexa
          </p>
          <div className="mt-[1px] flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
            <span className="text-[8.5px] text-emerald-300/90 sm:text-[9px]">
              online
            </span>
            <span className="text-[8.5px] text-white/25 sm:text-[9px]">·</span>
            <LockKeyhole size={7} className="text-white/35" />
            <span className="text-[8.5px] text-white/35 sm:text-[9px]">
              encrypted
            </span>
          </div>
        </div>
        <button
          type="button"
          aria-label="Video call"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.06] transition-colors hover:bg-white/[0.1] sm:h-7 sm:w-7"
        >
          <Video size={11} className="text-white/70" />
        </button>
        <button
          type="button"
          aria-label="Voice call"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.06] transition-colors hover:bg-white/[0.1] sm:h-7 sm:w-7"
        >
          <Phone size={11} className="text-white/70" />
        </button>
      </div>

      <div className="mx-3 h-px bg-white/[0.05] sm:mx-4" />

      {/* Message thread */}
      <div
        ref={scrollRef}
        className="relative z-10 mt-2 flex-1 space-y-1.5 overflow-y-auto px-3 pb-2 scrollbar-hide sm:mt-2.5 sm:space-y-2 sm:px-3.5"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <div className="flex justify-center">
          <span className="rounded-full bg-white/[0.04] px-2 py-[2px] text-[7.5px] uppercase tracking-[0.16em] text-white/40 sm:px-2.5 sm:py-[3px] sm:text-[8px]">
            Today
          </span>
        </div>

        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} />
        ))}

        {typingFrom === "alexa" && <TypingIndicator />}
      </div>

      {/* Composer */}
      <div className="relative z-10 border-t border-white/[0.05] px-2.5 pb-4 pt-2 sm:px-3 sm:pb-5 sm:pt-2.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Add"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] transition-colors hover:bg-white/[0.1] sm:h-8 sm:w-8"
          >
            <Plus size={12} className="text-white/60" />
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.045] px-3 py-1.5 sm:py-2">
            <span className="text-[10px] text-white/35 sm:text-[10.5px]">
              Message…
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Camera size={10} className="text-white/35 sm:h-3 sm:w-3" />
              <Mic size={10} className="text-white/35 sm:h-3 sm:w-3" />
            </div>
          </div>
          <button
            type="button"
            aria-label="Send"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#F59E0B] to-[#D97706] shadow-[0_6px_16px_-6px_rgba(245,158,11,0.8)] transition-transform active:scale-95 sm:h-8 sm:w-8"
          >
            <Send size={10} className="text-[#1A1105] sm:h-3 sm:w-3" />
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-1 left-1/2 z-30 h-[3px] w-16 -translate-x-1/2 rounded-full bg-white/40 sm:w-20" />
    </div>
  );
}

/* Message bubbles are cheap to reconcile but expensive to *animate* —
   keep the spring tight so a burst of messages never queues up. */
const BUBBLE_SPRING = {
  type: "spring" as const,
  stiffness: 480,
  damping: 30,
  mass: 0.55,
};

const ChatBubble = memo(function ChatBubble({ message }: { message: Message }) {
  const isMe = message.from === "me";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={BUBBLE_SPRING}
      className={`flex ${isMe ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`flex max-w-[82%] flex-col ${isMe ? "items-end" : "items-start"}`}
      >
        <div
          className={`rounded-[13px] px-2.5 py-[6px] text-[9.5px] leading-[1.4] sm:rounded-[14px] sm:px-3 sm:py-[7px] sm:text-[10px] ${
            isMe
              ? "rounded-br-[3px] bg-gradient-to-br from-[#F59E0B] to-[#D97706] font-medium text-[#1A1105] shadow-[0_4px_14px_-6px_rgba(245,158,11,0.8)]"
              : "rounded-bl-[3px] border border-white/[0.06] bg-white/[0.06] text-white/90"
          }`}
        >
          {message.text}
        </div>

        <div className="mt-0.5 flex items-center gap-1 px-1">
          <span className="text-[7.5px] text-white/30">{message.time}</span>
          {isMe && (
            <span className="text-white/40">
              {message.status === "sent" && <Check size={8} />}
              {message.status === "delivered" && <CheckCheck size={8} />}
              {message.status === "read" && (
                <CheckCheck size={8} className="text-amber-300" />
              )}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
});

const TypingIndicator = memo(function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-start gap-2"
    >
      <div className="h-4 w-4 shrink-0 overflow-hidden rounded-full ring-1 ring-white/10 sm:h-5 sm:w-5">
        <img
          src={PORTRAIT.alexa}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      </div>
      <div className="flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.05] px-2 py-1 sm:px-2.5 sm:py-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -1, 0] }}
            transition={{
              duration: 1.1,
              repeat: Infinity,
              delay: i * 0.15,
              ease: "easeInOut",
            }}
            className="h-1 w-1 rounded-full bg-white/60"
          />
        ))}
      </div>
    </motion.div>
  );
});

/* ═══════════════════════════════════════════════════════════
   FLOATING CARDS — softer motion
   ═══════════════════════════════════════════════════════════ */

const FloatCard = memo(function FloatCard({
  className,
  delay = 0,
  duration = 9,
  offset = 7,
  children,
}: {
  className?: string;
  delay?: number;
  duration?: number;
  offset?: number;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12, scale: 0.96 }}
      animate={
        reduce ? { opacity: 1 } : { opacity: 1, y: [0, -offset, 0], scale: 1 }
      }
      transition={{
        opacity: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] },
        scale: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] },
        y: { duration, delay, repeat: Infinity, ease: "easeInOut" },
      }}
      className={`pointer-events-none absolute z-20 ${className ?? ""}`}
      aria-hidden="true"
    >
      {children}
    </motion.div>
  );
});

/* ═══════════════════════════════════════════════════════════
   SCROLL RAIL
   ═══════════════════════════════════════════════════════════ */

const BEAT_LABELS = [
  { id: "beat-0", label: "Origin"    },
  { id: "beat-1", label: "Signal"    },
  { id: "beat-2", label: "Vault"     },
  { id: "beat-3", label: "Orbit"     },
  { id: "beat-4", label: "Resonance" },
  { id: "beat-5", label: "Arrival"   },
];

function ScrollRail() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const cb = (i: number) => setActive(i);
    beatListeners.add(cb);
    return () => {
      beatListeners.delete(cb);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed right-3 top-1/2 z-40 hidden -translate-y-1/2 sm:right-5 lg:block">
      <ul className="pointer-events-auto space-y-3.5">
        {BEAT_LABELS.map((b, i) => (
          <li key={b.id} className="group flex items-center justify-end gap-3">
            <span
              className={`pointer-events-none text-right text-[10px] uppercase tracking-[0.24em] transition-all duration-300 ${
                active === i
                  ? "translate-x-0 text-amber-300 opacity-100"
                  : "translate-x-3 text-stone-500 opacity-0 group-hover:translate-x-0 group-hover:opacity-70"
              }`}
            >
              {b.label}
            </span>
            <a
              href={`#${b.id}`}
              aria-label={b.label}
              className="flex h-3 w-3 items-center justify-center"
            >
              <span
                className={`block rounded-full transition-all duration-300 ${
                  active === i
                    ? "h-2.5 w-2.5 bg-amber-400 shadow-[0_0_10px_#F59E0B]"
                    : "h-1.5 w-1.5 bg-stone-600 group-hover:bg-stone-400"
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
  variant = "primary",
}: {
  children: React.ReactNode;
  to?: string;
  href?: string;
  download?: boolean;
  external?: boolean;
  variant?: "primary" | "secondary";
}) {
  const base =
    "group inline-flex items-center justify-center gap-2.5 rounded-full px-5 py-3 text-[13px] font-semibold tracking-[-0.01em] transition-[transform,box-shadow,background,border-color] duration-200 ease-out will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 active:scale-[0.98] sm:px-6 sm:py-3.5 sm:text-[13.5px]";

  const primary =
    "bg-gradient-to-b from-amber-300 to-amber-500 text-[#150E03] shadow-[0_10px_36px_-14px_rgba(245,158,11,0.9),inset_0_1px_0_rgba(255,255,255,0.35)] hover:-translate-y-0.5 hover:shadow-[0_18px_50px_-14px_rgba(245,158,11,1),inset_0_1px_0_rgba(255,255,255,0.45)]";

  const secondary =
    "border border-white/[0.14] bg-white/[0.04] text-stone-100 backdrop-blur-xl hover:-translate-y-0.5 hover:border-white/[0.28] hover:bg-white/[0.08]";

  const cls = `${base} ${variant === "primary" ? primary : secondary}`;

  const content = (
    <>
      {children}
      <ArrowRight
        size={15}
        className="transition-transform duration-200 ease-out group-hover:translate-x-1"
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

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 inline-flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.28em] text-amber-400/90 sm:mb-6 sm:text-[11px]">
      <span className="h-px w-8 bg-gradient-to-r from-transparent to-amber-500/80" />
      {children}
    </div>
  );
}

function Reveal({
  children,
  className = "",
  delay = 0,
  y = 24,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15, margin: "0px 0px -60px 0px" }}
      transition={{
        duration: reduce ? 0 : 0.62,
        delay: reduce ? 0 : delay * 0.8,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={`will-change-transform ${className}`}
    >
      {children}
    </motion.div>
  );
}

const DISPLAY_FONT = {
  fontFamily: '"Fraunces", Georgia, serif',
  fontVariationSettings: '"opsz" 144, "SOFT" 40',
} as const;

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
  return (
    <section
      id={id}
      className={`relative flex min-h-screen w-full items-center ${justify} px-5 py-20 sm:px-8 sm:py-24 lg:h-screen lg:px-14 lg:py-0`}
    >
      <div
        className={`relative z-10 w-full max-w-[560px] ${
          align === "center" ? "mx-auto text-center" : ""
        }`}
      >
        {children}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   HERO FLOATERS — static, memoised, never re-rendered by chat
   ═══════════════════════════════════════════════════════════ */

const HeroFloatCards = memo(function HeroFloatCards() {
  return (
    <>
      <FloatCard
        className="hidden left-[-88px] top-[12%] xl:block"
        delay={0.75}
        duration={8}
        offset={7}
      >
        <div className="flex w-[200px] items-center gap-2.5 rounded-2xl border border-white/[0.08] bg-black/60 p-2.5 backdrop-blur-xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)]">
          <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full ring-1 ring-white/15">
            <img
              src={PORTRAIT.maya}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <p className="truncate text-[10px] font-medium text-white">
                Sophie
              </p>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
            </div>
            <p className="mt-[1px] truncate text-[9px] text-white/55">
              sending a photo…
            </p>
          </div>
        </div>
      </FloatCard>

      <FloatCard
        className="hidden right-[-88px] top-[38%] xl:block"
        delay={0.95}
        duration={9}
        offset={9}
      >
        <div className="overflow-hidden rounded-2xl border border-white/[0.1] bg-black/60 backdrop-blur-xl shadow-[0_24px_70px_-24px_rgba(0,0,0,0.9)]">
          <div className="relative h-[110px] w-[142px]">
            <img
              src={MEDIA.twoFriends}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            <div className="absolute bottom-1.5 left-2">
              <span className="text-[8.5px] font-medium text-white/85">
                With an old friend
              </span>
            </div>
          </div>
        </div>
      </FloatCard>

      <FloatCard
        className="hidden bottom-[22%] left-[-72px] xl:block"
        delay={1.15}
        duration={7}
        offset={6}
      >
        <div className="flex items-center gap-2 rounded-full border border-amber-400/25 bg-black/65 py-1.5 pl-2 pr-3 backdrop-blur-xl shadow-[0_16px_44px_-18px_rgba(245,158,11,0.5)]">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400/15">
            <LockKeyhole size={9} className="text-amber-400" />
          </div>
          <span className="text-[9.5px] font-medium text-amber-200/90">
            Keys sealed on device
          </span>
        </div>
      </FloatCard>

      <FloatCard
        className="hidden bottom-[8%] right-[-68px] xl:block"
        delay={1.35}
        duration={8}
        offset={8}
      >
        <div className="flex items-center gap-2 rounded-2xl border border-white/[0.09] bg-black/65 p-2 pr-3 backdrop-blur-xl shadow-[0_20px_60px_-22px_rgba(0,0,0,0.9)]">
          <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg ring-1 ring-emerald-400/40">
            <img
              src={PORTRAIT.jamie}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              decoding="async"
            />
            <span className="absolute -bottom-[1px] -right-[1px] h-2 w-2 rounded-full border border-black bg-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[9.5px] font-medium text-white">Jamie · live</p>
            <div className="mt-[2px] flex items-end gap-[2px]">
              {[3, 6, 4, 8, 5, 7, 3, 6, 9, 4, 5].map((h, i) => (
                <motion.span
                  key={i}
                  animate={{ height: [`${h}px`, `${h + 4}px`, `${h}px`] }}
                  transition={{
                    duration: 0.9 + (i % 3) * 0.15,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                  className="block w-[2px] rounded-full bg-amber-400/80"
                />
              ))}
            </div>
          </div>
        </div>
      </FloatCard>

      {/* Mobile inline badge */}
      <div className="pointer-events-none absolute -bottom-10 left-1/2 flex -translate-x-1/2 flex-nowrap justify-center gap-2 lg:hidden">
        <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-amber-400/25 bg-black/60 px-3 py-1.5 backdrop-blur-xl">
          <LockKeyhole size={10} className="text-amber-400" />
          <span className="text-[10px] font-medium text-amber-200/90">
            Keys sealed on device
          </span>
        </div>
      </div>
    </>
  );
});

/* ═══════════════════════════════════════════════════════════
   BEAT 0 — ORIGIN
   ═══════════════════════════════════════════════════════════ */

const TRUST_FACES = [
  PORTRAIT.alexa,
  PORTRAIT.maya,
  PORTRAIT.jamie,
  PORTRAIT.river,
  PORTRAIT.aisha,
  PORTRAIT.blake,
  PORTRAIT.iris,
  PORTRAIT.nova,
];

const BeatOrigin = memo(function BeatOrigin({
  messages,
  typingFrom,
}: {
  messages: Message[];
  typingFrom: "me" | "alexa" | null;
}) {
  return (
    <section
      id="beat-0"
      className="relative flex min-h-screen w-full items-center overflow-hidden px-5 pb-14 pt-20 sm:px-8 sm:pb-16 sm:pt-24 lg:h-screen lg:px-14 lg:pb-0 lg:pt-0"
    >
      <div className="relative z-10 mx-auto grid w-full max-w-[1440px] grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,440px)] lg:gap-14">
        {/* ── TEXT ── */}
        <div className="mx-auto max-w-[620px] text-center lg:mx-0 lg:translate-y-16 lg:text-left">
          <Reveal>
            <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-white/[0.09] bg-white/[0.03] py-1.5 pl-1.5 pr-3.5 backdrop-blur-xl sm:mb-8 sm:gap-3 sm:pr-4">
              <div className="flex -space-x-2">
                {TRUST_FACES.slice(0, 5).map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt=""
                    className="h-5 w-5 rounded-full border border-[#0A0A0E] object-cover sm:h-6 sm:w-6"
                    loading="eager"
                    decoding="async"
                  />
                ))}
              </div>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[9px] uppercase tracking-[0.18em] text-stone-300 sm:text-[10px] sm:tracking-[0.22em]">
                A conversation, rebuilt
              </span>
            </div>
          </Reveal>

          <Reveal delay={0.06}>
            <h1 className="text-[clamp(38px,10.5vw,110px)] font-medium leading-[0.94] tracking-[-0.05em] text-stone-100">
              Where it all
              <br />
              <span
                className="font-normal italic tracking-[-0.02em] text-amber-400"
                style={DISPLAY_FONT}
              >
                begins.
              </span>
            </h1>
          </Reveal>

          <Reveal delay={0.12}>
            <p className="mx-auto mt-6 max-w-[470px] text-[14.5px] leading-[1.7] text-stone-400 sm:mt-8 sm:text-[16px] sm:leading-[1.85] lg:mx-0">
              Every message starts somewhere — a glance, a laugh, a moment
              worth keeping. Orbital gives those moments a place built only
              for the people inside them.
            </p>
          </Reveal>

          <Reveal delay={0.18}>
            <div className="mt-8 flex flex-col items-stretch gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center lg:justify-start">
              <PrimaryButton to="/register">Create account</PrimaryButton>
              <PrimaryButton to="/login" variant="secondary">
                Sign in
              </PrimaryButton>
            </div>
          </Reveal>

          <Reveal delay={0.24}>
            <div className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2.5 text-[11px] text-stone-500 sm:mt-12 sm:gap-x-8 sm:text-[11.5px] lg:justify-start">
              <span className="flex items-center gap-2">
                <LockKeyhole size={13} className="text-amber-400" />
                End-to-end encrypted
              </span>
              <span className="flex items-center gap-2">
                <ShieldCheck size={13} className="text-amber-400" />
                No ads, ever
              </span>
              <span className="flex items-center gap-2">
                <Video size={13} className="text-amber-400" />
                Voice &amp; video
              </span>
            </div>
          </Reveal>
        </div>

        {/* ── PHONE ── */}
        <Reveal delay={0.14}>
          <div className="relative mx-auto flex w-full max-w-[400px] items-center justify-center">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[110%] w-[110%] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(245,158,11,0.18) 0%, rgba(245,158,11,0.04) 40%, transparent 70%)",
                filter: "blur(40px)",
              }}
            />

            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="will-change-transform"
            >
              <PhoneMockup>
                <PhoneScreen messages={messages} typingFrom={typingFrom} />
              </PhoneMockup>
            </motion.div>

            <HeroFloatCards />
          </div>
        </Reveal>
      </div>
    </section>
  );
});

/* ═══════════════════════════════════════════════════════════
   BEAT 1 — SIGNAL
   ═══════════════════════════════════════════════════════════ */

function BeatSignal() {
  return (
    <Section id="beat-1" align="right">
      <Reveal>
        <Eyebrow>Beat 01 · Signal</Eyebrow>
      </Reveal>
      <Reveal delay={0.06}>
        <h2 className="text-[clamp(32px,7.5vw,68px)] font-light leading-[1.05] tracking-[-0.05em] text-stone-100 sm:leading-[1]">
          A message leaves
          <br />
          <span
            className="font-normal italic tracking-[-0.02em] text-amber-400"
            style={DISPLAY_FONT}
          >
            already sealed.
          </span>
        </h2>
      </Reveal>
      <Reveal delay={0.12}>
        <p className="mt-6 max-w-[440px] text-[14.5px] leading-[1.75] text-stone-400 sm:mt-7 sm:text-[15px] sm:leading-[1.9]">
          Your message is encrypted on your device before it ever touches
          the network. What travels is a cipher that only your circle can
          open — unreadable to anyone else, including us.
        </p>
      </Reveal>
      <Reveal delay={0.18}>
        <div className="mt-8 grid grid-cols-3 gap-2.5 sm:mt-9 sm:gap-3">
          {[
            { label: "On device", value: "AES-256" },
            { label: "In transit", value: "X25519" },
            { label: "Keys", value: "Never share" },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 backdrop-blur-xl sm:p-4"
            >
              <p className="text-[9px] uppercase tracking-[0.18em] text-stone-500 sm:text-[9.5px] sm:tracking-[0.2em]">
                {item.label}
              </p>
              <p className="mt-1.5 text-[11.5px] font-medium text-amber-300 sm:mt-2 sm:text-[13px]">
                {item.value}
              </p>
            </div>
          ))}
        </div>
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
      className="relative flex min-h-screen w-full items-center px-5 py-20 sm:px-8 sm:py-24 lg:h-screen lg:px-14 lg:py-0"
    >
      <div className="relative z-10 grid w-full max-w-[1440px] grid-cols-1 items-center gap-10 lg:grid-cols-[0.9fr_1fr] lg:gap-20">
        <Reveal delay={0.06}>
          <div className="relative overflow-hidden rounded-[24px] border border-white/[0.09] bg-[#0B0A0D]/90 shadow-[0_50px_140px_-70px_rgba(245,158,11,0.5)] backdrop-blur-2xl sm:rounded-[28px]">
            <div className="p-5 sm:p-7 lg:p-9">
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-4 sm:pb-5">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 overflow-hidden rounded-full ring-1 ring-white/10 sm:h-11 sm:w-11">
                    <img
                      src={PORTRAIT.nova}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <div>
                    <p className="text-[9.5px] uppercase tracking-[0.22em] text-stone-500 sm:text-[10px] sm:tracking-[0.24em]">
                      Secure thread
                    </p>
                    <p className="mt-0.5 text-[13px] text-stone-200 sm:mt-1 sm:text-[14px]">
                      Sienna Vale
                    </p>
                  </div>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-amber-400/20 bg-amber-400/[0.08] sm:h-10 sm:w-10">
                  <LockKeyhole size={16} className="text-amber-400" />
                </div>
              </div>

              <div className="mt-5 space-y-3.5 sm:mt-7 sm:space-y-4">
                <motion.div
                  initial={{ opacity: 0, x: -14 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  className="max-w-[82%] rounded-[18px] rounded-tl-[6px] border border-white/[0.07] bg-white/[0.04] px-3.5 py-3 text-[12.5px] leading-[1.55] text-stone-300 sm:rounded-[20px] sm:px-4 sm:py-3.5 sm:text-[13.5px]"
                >
                  Are we still on for the shoot tomorrow?
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, x: 14 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    duration: 0.45,
                    delay: 0.1,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="ml-auto max-w-[82%] rounded-[18px] rounded-tr-[6px] border border-amber-400/20 bg-amber-400/[0.09] px-3.5 py-3 text-[12.5px] leading-[1.55] text-amber-100 sm:rounded-[20px] sm:px-4 sm:py-3.5 sm:text-[13.5px]"
                >
                  Wouldn't miss it ✦
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    duration: 0.45,
                    delay: 0.2,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.035] sm:rounded-[16px]"
                >
                  <img
                    src={MEDIA.cafe}
                    alt=""
                    className="h-[130px] w-full object-cover sm:h-[150px]"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="flex items-center justify-between px-3.5 py-2 sm:px-4 sm:py-2.5">
                    <span className="text-[10.5px] text-stone-400 sm:text-[11px]">
                      Where we met · years ago
                    </span>
                    <Check size={12} className="text-amber-400" />
                  </div>
                </motion.div>
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-white/[0.07] bg-white/[0.015] px-5 py-3.5 text-[9.5px] uppercase tracking-[0.18em] text-stone-500 sm:px-7 sm:py-4 sm:text-[10px] sm:tracking-[0.2em]">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_10px_#F59E0B]" />
              Sealed before transmission
            </div>
          </div>
        </Reveal>

        <div>
          <Reveal>
            <Eyebrow>Beat 02 · Vault</Eyebrow>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className="text-[clamp(32px,7.5vw,68px)] font-light leading-[1.05] tracking-[-0.05em] text-stone-100 sm:leading-[1]">
              The keys stay
              <br />
              <span
                className="font-normal italic tracking-[-0.02em] text-amber-400"
                style={DISPLAY_FONT}
              >
                in your hands.
              </span>
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="mt-6 max-w-[440px] text-[14.5px] leading-[1.75] text-stone-400 sm:mt-7 sm:text-[15px] sm:leading-[1.9]">
              Encryption keys are generated on your device and never leave
              it. Not to a server, not to a backup, not to us. What you
              send is yours to keep.
            </p>
          </Reveal>
          <Reveal delay={0.18}>
            <div className="mt-7 space-y-3 sm:mt-9 sm:space-y-3.5">
              {[
                "Keys generated locally, never transmitted",
                "Independent, verifiable encryption",
                "Zero-knowledge architecture by design",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 text-[13px] text-stone-300 sm:text-[13.5px]"
                >
                  <Check size={15} className="shrink-0 text-amber-400" />
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

const ORBIT_FACES = [
  PORTRAIT.alexa,
  PORTRAIT.maya,
  PORTRAIT.jamie,
  PORTRAIT.river,
  PORTRAIT.aisha,
  PORTRAIT.blake,
  PORTRAIT.iris,
  PORTRAIT.nova,
  PORTRAIT.theo,
  PORTRAIT.finn,
];

function BeatOrbit() {
  return (
    <Section id="beat-3" align="right">
      <Reveal>
        <Eyebrow>Beat 03 · Orbit</Eyebrow>
      </Reveal>
      <Reveal delay={0.06}>
        <h2 className="text-[clamp(32px,7.5vw,68px)] font-light leading-[1.05] tracking-[-0.05em] text-stone-100 sm:leading-[1]">
          Small circles,
          <br />
          <span
            className="font-normal italic tracking-[-0.02em] text-amber-400"
            style={DISPLAY_FONT}
          >
            kept close.
          </span>
        </h2>
      </Reveal>
      <Reveal delay={0.12}>
        <p className="mt-6 max-w-[440px] text-[14.5px] leading-[1.75] text-stone-400 sm:mt-7 sm:text-[15px] sm:leading-[1.9]">
          No feeds. No followers. Just the rooms you chose — capped at
          fifty people, sized for real conversation. Messages, photos,
          files, voice notes — all in one place.
        </p>
      </Reveal>
      <Reveal delay={0.18}>
        <div className="mt-7 flex -space-x-2.5 sm:mt-9 sm:-space-x-3">
          {ORBIT_FACES.map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              className="h-9 w-9 rounded-full border-2 border-[#07070A] object-cover sm:h-11 sm:w-11"
              loading="lazy"
              decoding="async"
            />
          ))}
          <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-[#07070A] bg-white/[0.06] text-[9px] text-stone-400 sm:h-11 sm:w-11 sm:text-[10px]">
            +40
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.22}>
        <div className="mt-5 flex gap-2 sm:mt-6">
          {[MEDIA.dinner, MEDIA.carRide, MEDIA.rooftop, MEDIA.coupleWalk].map(
            (src, i) => (
              <div
                key={i}
                className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/[0.08] sm:h-16 sm:w-16 sm:rounded-2xl"
              >
                <img
                  src={src}
                  alt=""
                  className="h-full w-full object-cover opacity-85"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            ),
          )}
        </div>
      </Reveal>

      <Reveal delay={0.26}>
        <div className="mt-7 sm:mt-9">
          <PrimaryButton to="/register">Find your orbit</PrimaryButton>
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
      className="relative flex min-h-screen w-full items-center px-5 py-20 sm:px-8 sm:py-24 lg:h-screen lg:px-14 lg:py-0"
    >
      <div className="relative z-10 grid w-full max-w-[1440px] grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20">
        <div>
          <Reveal>
            <Eyebrow>Beat 04 · Resonance</Eyebrow>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className="text-[clamp(32px,7.5vw,68px)] font-light leading-[1.05] tracking-[-0.05em] text-stone-100 sm:leading-[1]">
              Some things are
              <br />
              <span
                className="font-normal italic tracking-[-0.02em] text-amber-400"
                style={DISPLAY_FONT}
              >
                better heard.
              </span>
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="mt-6 max-w-[440px] text-[14.5px] leading-[1.75] text-stone-400 sm:mt-7 sm:text-[15px] sm:leading-[1.9]">
              When a text isn't enough, move into voice or video. Spatial
              audio, noise suppression, and low-latency calls that hold up
              on a bad connection.
            </p>
          </Reveal>
          <Reveal delay={0.18}>
            <div className="mt-7 grid grid-cols-2 gap-2.5 sm:mt-9 sm:gap-3">
              {[
                { icon: Mic, label: "Spatial audio" },
                { icon: MessageCircle, label: "Low latency" },
                { icon: Video, label: "Crisp 1080p" },
                { icon: Sparkles, label: "Noise suppression" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 backdrop-blur-xl sm:gap-3 sm:p-3.5"
                >
                  <item.icon
                    size={15}
                    className="shrink-0 text-amber-400 sm:h-4 sm:w-4"
                  />
                  <span className="text-[11.5px] text-stone-300 sm:text-[12px]">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.1}>
          <div className="relative overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#0B0A0D]/90 backdrop-blur-2xl sm:rounded-[28px]">
            <div className="relative aspect-[4/5] w-full overflow-hidden bg-black">
              <img
                src={MEDIA.womanCall}
                alt=""
                className="h-full w-full object-cover opacity-65"
                loading="lazy"
                decoding="async"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B0A0D] via-[#0B0A0D]/40 to-transparent" />

              <div className="absolute right-2.5 top-2.5 flex flex-col gap-1.5 sm:right-3 sm:top-3">
                {[PORTRAIT.iris, PORTRAIT.theo, PORTRAIT.nova].map((src, i) => (
                  <div
                    key={i}
                    className="h-9 w-9 overflow-hidden rounded-xl border border-white/20 ring-1 ring-black/40 sm:h-10 sm:w-10"
                  >
                    <img
                      src={src}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                ))}
              </div>

              <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
                <div className="rounded-[18px] border border-white/[0.08] bg-black/60 p-3.5 backdrop-blur-xl sm:rounded-[20px] sm:p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 overflow-hidden rounded-full ring-1 ring-white/10 sm:h-11 sm:w-11">
                      <img
                        src={PORTRAIT.blake}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                    <div className="flex-1">
                      <p className="text-[12.5px] text-white sm:text-[13px]">
                        John Reeves
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5 sm:mt-1">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                        <span className="text-[9.5px] text-emerald-300/90 sm:text-[10px]">
                          02:47
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <button className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 sm:h-9 sm:w-9">
                        <Mic size={13} className="text-white/80" />
                      </button>
                      <button className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 sm:h-9 sm:w-9">
                        <Video size={13} className="text-white/80" />
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
    <section
      id="beat-5"
      className="relative flex min-h-screen w-full items-center px-5 py-20 sm:px-8 sm:py-24 lg:h-screen lg:px-14 lg:py-0"
    >
      <div className="relative z-10 mx-auto grid w-full max-w-[1280px] grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] lg:gap-16">
        <div className="mx-auto max-w-[560px] text-center lg:mx-0 lg:text-left">
          <Reveal>
            <div className="mb-5 inline-flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.28em] text-amber-400/90 sm:mb-6 sm:text-[11px]">
              <span className="h-px w-8 bg-gradient-to-r from-transparent to-amber-500/80" />
              Beat 05 · Arrival
            </div>
          </Reveal>

          <Reveal delay={0.06}>
            <h2 className="text-[clamp(38px,10vw,96px)] font-light leading-[0.98] tracking-[-0.05em] text-stone-100 sm:leading-[0.96]">
              Your world.
              <br />
              <span
                className="font-normal italic tracking-[-0.02em] text-amber-400"
                style={DISPLAY_FONT}
              >
                In your pocket.
              </span>
            </h2>
          </Reveal>

          <Reveal delay={0.12}>
            <p className="mx-auto mt-6 max-w-[460px] text-[14px] leading-[1.75] text-stone-400 sm:mt-8 sm:text-[15.5px] sm:leading-[1.9] lg:mx-0">
              Bring your conversations along. The Orbital Android app keeps
              your circles, your calls, and your keys right where they
              belong — with you.
            </p>
          </Reveal>

          <Reveal delay={0.18}>
            <div className="mt-8 flex flex-col items-stretch gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center lg:justify-start">
              <PrimaryButton to="/register">Create account</PrimaryButton>
              <PrimaryButton to="/login" variant="secondary">
                Sign in
              </PrimaryButton>
            </div>
          </Reveal>

          <Reveal delay={0.24}>
            <div className="mt-5 flex items-center justify-center gap-3 sm:mt-6 lg:justify-start">
              <a
                href={DOWNLOAD_HREF}
                download
                className="group inline-flex items-center gap-2.5 text-[13px] text-stone-400 transition-colors duration-200 hover:text-amber-300"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] transition-colors duration-200 group-hover:border-amber-400/40 group-hover:bg-amber-400/[0.08]">
                  <ArrowRight size={13} className="rotate-90" />
                </span>
                <span className="border-b border-transparent pb-[1px] transition-colors duration-200 group-hover:border-amber-400/40">
                  Download for Android
                </span>
              </a>
            </div>
          </Reveal>

          <Reveal delay={0.3}>
            <div className="mt-10 flex items-center justify-center gap-3 sm:mt-14 lg:justify-start">
              <span className="h-px w-12 bg-gradient-to-r from-transparent to-amber-500/40" />
              <p className="text-[10px] uppercase tracking-[0.28em] text-stone-600 sm:tracking-[0.32em]">
                For the people who matter
              </p>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.16}>
          <div className="relative mx-auto w-full max-w-[380px]">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[130%] w-[130%] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(245,158,11,0.20) 0%, rgba(245,158,11,0.05) 40%, transparent 70%)",
                filter: "blur(48px)",
              }}
            />

            <motion.div
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
              className="relative overflow-hidden rounded-[24px] border border-white/[0.09] bg-[#0B0A0D]/85 p-5 backdrop-blur-2xl shadow-[0_50px_140px_-70px_rgba(245,158,11,0.6)] sm:rounded-[28px] sm:p-6"
            >
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-3.5 sm:pb-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                  <span className="text-[9.5px] uppercase tracking-[0.22em] text-stone-400 sm:text-[10px] sm:tracking-[0.24em]">
                    Ready to install
                  </span>
                </div>
                <span className="text-[9.5px] uppercase tracking-[0.22em] text-amber-400/80 sm:text-[10px] sm:tracking-[0.24em]">
                  Android
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-2.5">
                {[MEDIA.twoFriends, MEDIA.cafe, MEDIA.hug, MEDIA.groupDusk].map(
                  (src, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{
                        duration: 0.45,
                        delay: 0.16 + i * 0.05,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      className="relative aspect-[4/5] overflow-hidden rounded-[14px] border border-white/[0.06] sm:rounded-[18px]"
                    >
                      <img
                        src={src}
                        alt=""
                        className="h-full w-full object-cover opacity-85"
                        loading="lazy"
                        decoding="async"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                    </motion.div>
                  ),
                )}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3.5 sm:mt-5 sm:pt-4">
                {[
                  { label: "Circles", value: "Kept" },
                  { label: "Calls", value: "Kept" },
                  { label: "Keys", value: "Yours" },
                ].map((item) => (
                  <div key={item.label} className="text-center">
                    <p className="text-[9px] uppercase tracking-[0.18em] text-stone-500 sm:tracking-[0.2em]">
                      {item.label}
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium text-amber-300 sm:mt-1">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   ROOT
   ═══════════════════════════════════════════════════════════ */

export function Landing() {
  const reduce = useReducedMotion();
  const [webGLAvailable, setWebGLAvailable] = useState(true);
  const tier = useDeviceTier();
  const hz = useRefreshRate();

  const [heroOnScreen, setHeroOnScreen] = useState(true);
  useEffect(() => {
    const cb = (i: number) => setHeroOnScreen(i === 0);
    beatListeners.add(cb);
    return () => {
      beatListeners.delete(cb);
    };
  }, []);

  const { messages, typingFrom } = useLiveChat(heroOnScreen);

  /**
   * Resolution budget.
   *  · Higher refresh → fewer pixels, so the GPU can actually finish inside
   *    a 6.9 ms (144 Hz) or 8.3 ms (120 Hz) frame.
   *  · Never render above 2× native — beyond that it's pure cost.
   */
  const { maxDpr, minDpr } = useMemo(() => {
    const native =
      typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const headroom = hz >= 120 ? 0.72 : hz >= 90 ? 0.85 : 1;
    const tierCap = tier === "low" ? 1 : tier === "mid" ? 1.35 : 1.6;
    const hi = Math.max(0.75, Math.min(native, tierCap) * headroom);
    return { maxDpr: Math.round(hi * 100) / 100, minDpr: Math.max(0.6, Math.round(hi * 0.55 * 100) / 100) };
  }, [tier, hz]);

  return (
    <main
      className="relative min-h-screen overflow-clip bg-[#07070A] text-stone-100 selection:bg-amber-400/30 selection:text-amber-100"
      style={{
        fontFamily:
          '"Inter Tight", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter+Tight:ital,wght@0,200..800;1,200..800&family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&display=swap');

        html {
          scroll-behavior: smooth;
          scrollbar-gutter: stable;
          overscroll-behavior-y: none;
          -webkit-text-size-adjust: 100%;
        }

        body {
          margin: 0;
          background: #07070A;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
          overflow-x: hidden;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }

        .orbital-content {
          font-family: 'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          font-feature-settings: 'ss01' 1, 'cv11' 1, 'cv02' 1;
          letter-spacing: -0.01em;
        }

        .orbital-content h1,
        .orbital-content h2 {
          font-feature-settings: 'ss01' 1, 'ss02' 1, 'cv11' 1, 'cv02' 1, 'cv03' 1;
        }

        .scrollbar-hide::-webkit-scrollbar { display: none; }

        .orbital-content section {
          will-change: transform;
          transform: translateZ(0);
          backface-visibility: hidden;
        }

        /* Keep compositor-only animations GPU-resident on high-refresh panels. */
        .orbital-content canvas { display: block; }

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
        <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
          <Canvas
            dpr={maxDpr}
            camera={{ position: [0, 0.6, 9], fov: 50, near: 0.1, far: 220 }}
            gl={{
              antialias: tier !== "low",
              alpha: false,
              powerPreference: "high-performance",
              stencil: false,
              depth: true,
              desynchronized: true,
              preserveDrawingBuffer: false,
            }}
            onCreated={({ gl }) => {
              gl.setClearColor(DEEP, 1);
              // ACES applied by the renderer itself — no post-processing pass.
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 1.08;
              gl.outputColorSpace = THREE.SRGBColorSpace;
              const canvas = gl.domElement;
              canvas.addEventListener(
                "webglcontextlost",
                () => setWebGLAvailable(false),
                { once: true },
              );
            }}
            fallback={<div className="absolute inset-0 bg-[#07070A]" />}
          >
            <Suspense fallback={null}>
              <OrbitalSystem tier={tier} />
              <AdaptiveResolution min={minDpr} max={maxDpr} targetFps={hz} />
            </Suspense>
          </Canvas>

          <div className="absolute inset-0 bg-gradient-to-b from-[#07070A]/25 via-transparent to-[#07070A]/85" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#07070A]/65 via-[#07070A]/10 to-transparent" />
        </div>
      )}

      {(reduce || !webGLAvailable) && (
        <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_30%,rgba(245,158,11,0.1),transparent_45%)]" />
        </div>
      )}

      <ScrollRail />

      <div className="orbital-content relative z-10">
        <BeatOrigin messages={messages} typingFrom={typingFrom} />
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