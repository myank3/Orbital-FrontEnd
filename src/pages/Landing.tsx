/**
 * @file src/pages/Landing.tsx
 * Orbital — cinematic 3D journey with live chat.
 *
 * v11 · local textures · Timer · people-first chat imagery
 *
 *   · Textures load from /public/textures/*.jpg (downloaded).
 *   · THREE.Clock replaced with THREE.Timer throughout.
 *   · Chat script now uses people-forward imagery — candid
 *     portraits, friends, moments — not cities or landscapes.
 *   · Every planet keeps its distinct palette and atmosphere.
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

import { EffectComposer, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Camera,
  Check,
  CheckCheck,
  Image as ImageIcon,
  LockKeyhole,
  MessageCircle,
  Mic,
  Phone,
  Play,
  Plus,
  Send,
  ShieldCheck,
  Sparkles,
  Video,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════
   IMAGE ASSETS — people-forward editorial
   ═══════════════════════════════════════════════════════════ */

const u = (id: string, w: number, q = 92) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&q=${q}&auto=format&fit=crop`;

/* Portraits: 20 real faces — diverse, editorial, warm. */
const PORTRAIT = {
  /* Women */
  alexa:   u("1517841905240-472988babdf9", 1600),
  maya:    u("1531123897727-8f129e1688ce", 1600),
  jamie:   u("1494790108377-be9c29b29330", 1600),
  river:   u("1524253482453-3fed8d2fe12b", 1600),
  aisha:   u("1573496359142-b8d87734a5a2", 1600),
  aria:    u("1544005313-94ddf0286df2", 1600),
  lena:    u("1488426862026-3ee34a7d66df", 1600),
  iris:    u("1524504388940-b1c1722653e1", 1600),
  nova:    u("1521119989659-a83eee488004", 1600),
  camille: u("1531746020798-e6953c6e8e04", 1600),

  /* Men */
  sam:     u("1506794778202-cad84cf45f1d", 1600),
  blake:   u("1500648767791-00dcc994a43e", 1600),
  noah:    u("1507591064344-4c6ce005b128", 1600),
  kai:     u("1502823403499-6ccfcf4fb453", 1600),
  theo:    u("1519085360753-af0119f7cbe7", 1600),
  ezra:    u("1534528741775-53994a69daeb", 1600),
  finn:    u("1531746020798-e6953c6e8e04", 1600),
  rowan:   u("1492562080023-ab3db95bfbce", 1600),
  emery:   u("1521119989659-a83eee488004", 1600),
  ellis:   u("1463453091185-61582044d556", 1600),
} as const;

/* Media: shared moments — people first, places second. */
const MEDIA = {
  /* Two friends, close */
  twoFriends:   u("1543269865-cbf427effbad", 2400),
  /* Friends laughing outdoors */
  friendsLaugh: u("1529156069898-49953e39b3ac", 2400),
  /* Woman smiling — editorial */
  womanSmile:   u("1494790108377-be9c29b29330", 2400),
  /* Man smiling — editorial */
  manSmile:     u("1500648767791-00dcc994a43e", 2400),
  /* Group of friends at dusk */
  groupDusk:    u("1522071820081-009f0129c71c", 2400),
  /* Two people at a cafe */
  cafe:         u("1517245386807-bb43f82c33c4", 2400),
  /* Best friends hugging */
  hug:          u("1523301343968-6a6ebf63c672", 2400),
  /* Woman on call — remote living */
  womanCall:    u("1519389950473-47ba0277781c", 2400),
  /* Man on call — casual */
  manCall:      u("1512428559087-560fa5ceab42", 2400),
  /* Mother and daughter */
  family:       u("1511895426328-dc8714191300", 2400),
  /* Friends at dinner, warm */
  dinner:       u("1543007630-9710e4a00a20", 2400),
  /* Couple walking */
  coupleWalk:   u("1518199266791-5375a83190b7", 2400),
  /* Two friends in a car */
  carRide:      u("1469854523086-cc02fe5d8800", 2400),
  /* Woman with flowers — warm */
  womanFlowers: u("1487412720507-e7ab37603c6f", 2400),
  /* Man walking dog */
  manDog:       u("1518712038649-a96c9d2f8a56", 2400),
  /* Friends on a rooftop */
  rooftop:      u("1499750310107-5fef28a66643", 2400),
} as const;

const LIFESTYLE = {
  friendsSunset: u("1529156069898-49953e39b3ac", 2800),
  dinner:        u("1543269865-cbf427effbad", 2800),
  womanCall:     u("1519389950473-47ba0277781c", 2800),
  editorialCity: u("1493663284031-b7e3aefcae8e", 2800),
  minimal:       u("1550684376-efcbd6e3f031", 2800),
} as const;

/* ═══════════════════════════════════════════════════════════
   PLANET TEXTURES — local files
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

/* ═══════════════════════════════════════════════════════════
   TIMER
   ═══════════════════════════════════════════════════════════ */

const timer = new Timer();
timer.connect(document);

/* ═══════════════════════════════════════════════════════════
   MATH
   ═══════════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════════
   DEVICE TIER
   ═══════════════════════════════════════════════════════════ */

function useDeviceTier() {
  const [tier, setTier] = useState<"low" | "mid" | "high">("mid");
  useEffect(() => {
    const cores = (navigator as any).hardwareConcurrency ?? 4;
    const mem = (navigator as any).deviceMemory ?? 4;
    const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (mobile || cores <= 4 || mem <= 3) setTier("low");
    else if (cores >= 8 && mem >= 8) setTier("high");
  }, []);
  return tier;
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
    const read = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      store.raw = max > 0 ? clamp01(window.scrollY / max) : 0;
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    return () => {
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, []);

  useFrame(() => {
    // Timer.update must be called ONCE per frame, before anything
    // reads getElapsed / getDelta. ScrollDriver runs first.
    timer.update();

    const dt = Math.min(timer.getDelta(), 1 / 60);
    store.smooth = damp(store.smooth, store.raw, 20, dt);
    const v = (store.smooth - prev.current) / Math.max(dt, 1e-4);
    prev.current = store.smooth;
    store.velocity = damp(store.velocity, v, 14, dt);

    const beat = Math.min(5, Math.floor(store.smooth * 5 + 0.0001));
    if (beat !== lastBeat) {
      lastBeat = beat;
      beatListeners.forEach((fn) => fn(beat));
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
    const dt = Math.min(timer.getDelta(), 1 / 60);
    const t = store.smooth;

    const f = t * (KEYS.length - 1);
    const lo = Math.min(KEYS.length - 1, Math.max(0, Math.floor(f)));
    const hi = Math.min(KEYS.length - 1, lo + 1);
    const frac = f - lo;

    const A = KEYS[lo];
    const B = KEYS[hi];

    const time = timer.getElapsed();
    const swayX = reduce ? 0 : Math.sin(time * 0.26) * 0.07;
    const swayY = reduce ? 0 : Math.cos(time * 0.20) * 0.05;

    const baseX = A.pos[0] + (B.pos[0] - A.pos[0]) * frac;
    const baseY = A.pos[1] + (B.pos[1] - A.pos[1]) * frac;
    const baseZ = A.pos[2] + (B.pos[2] - A.pos[2]) * frac;

    tgtPos.current.set(baseX + swayX, baseY + swayY, baseZ);

    const lookX = A.look[0] + (B.look[0] - A.look[0]) * frac;
    const lookY = A.look[1] + (B.look[1] - A.look[1]) * frac;
    const lookZ = A.look[2] + (B.look[2] - A.look[2]) * frac;
    tgtLook.current.set(lookX, lookY, lookZ);

    dampVec3(curPos.current, tgtPos.current, 12, dt);
    dampVec3(curLook.current, tgtLook.current, 14, dt);

    camera.position.copy(curPos.current);
    camera.lookAt(curLook.current);
  });

  return null;
}

/* ═══════════════════════════════════════════════════════════
   TEXTURE CACHE — tuned for local files
   ═══════════════════════════════════════════════════════════ */

const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();

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

        t.colorSpace = isColor
          ? THREE.SRGBColorSpace
          : THREE.NoColorSpace;

        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.anisotropy = 8;
        t.generateMipmaps = true;

        // Longitude wraps; latitude clamps.
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;

        t.needsUpdate = true;
        texCache.set(url, t);
        setTex(t);
      },
      undefined,
      (err) => {
        // eslint-disable-next-line no-console
        console.warn(`[Orbital] texture failed: ${url}`, err);

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
    if (reduce) return;
    const dt = Math.min(timer.getDelta(), 1 / 60);
    if (meshRef.current) meshRef.current.rotation.y += dt * rotationSpeed;
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
    tex.anisotropy = 8;
    return tex;
  }, []);

  useFrame(() => {
    if (reduce) return;
    const dt = Math.min(timer.getDelta(), 1 / 60);
    if (crustRef.current) crustRef.current.rotation.y += dt * 0.14;
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
   INTERSTELLAR BLACK HOLE
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
    const dt = Math.min(timer.getDelta(), 1 / 60);
    const t = timer.getElapsed();

    if (primaryRef.current) primaryRef.current.rotation.z += dt * 0.28;
    if (primaryInnerRef.current)
      primaryInnerRef.current.rotation.z -= dt * 0.42;
    if (coolRef.current) coolRef.current.rotation.z += dt * 0.18;
    if (lensedRef.current) lensedRef.current.rotation.z -= dt * 0.08;

    if (photonRef.current) {
      const s = 1 + Math.sin(t * 1.6) * 0.010;
      photonRef.current.scale.setScalar(s);
    }
    if (einsteinRef.current) {
      const s = 1 + Math.sin(t * 0.6) * 0.045;
      einsteinRef.current.scale.setScalar(s);
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
    const dt = Math.min(timer.getDelta(), 1 / 60);
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

function OrbitalSystem({ tier }: { tier: "low" | "mid" | "high" }) {
  const seg = tier === "low" ? 32 : 48;

  return (
    <>
      <ScrollDriver />
      <CameraRig />

      <color attach="background" args={[DEEP]} />
      <fog attach="fog" args={[DEEP, 12, 70]} />

      <directionalLight
        position={[6, 3.5, 4]}
        intensity={2.6}
        color="#FFE9C0"
      />
      <directionalLight
        position={[-5, -2, -8]}
        intensity={0.35}
        color="#4A5B8C"
      />
      <ambientLight intensity={0.08} color="#2A2A38" />

      <Starfield count={tier === "low" ? 100 : 180} />

      {/* Beat 0 — Obsidian */}
      <ObsidianPlanet position={[2.7, 0, -2]} radius={1.65} tilt={0.22} />
      <Moon
        texture={PLANET_TEX.moon}
        radius={0.22}
        position={[2.7, 0, -2]}
        orbitRadius={2.4}
        orbitSpeed={0.5}
        tilt={0.35}
      />

      {/* Beat 1 — Mars: mustard ochre, thin pale-yellow atmosphere */}
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

      {/* Beat 2 — Jupiter: cream & coral banded giant */}
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

      {/* Beat 3 — Saturn: pale gold, full rings */}
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

      {/* Beat 4 — Uranus: icy cyan, tilted ~90° */}
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

      {/* Beat 5 — Gargantua */}
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
   POST-PROCESSING
   ═══════════════════════════════════════════════════════════ */

function PostFX({ tier }: { tier: "low" | "mid" | "high" }) {
  if (tier === "low") return null;
  return (
    <EffectComposer
      multisampling={0}
      resolutionScale={tier === "high" ? 0.85 : 0.7}
      enableNormalPass={false}
    >
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}

/* ═══════════════════════════════════════════════════════════
   PHONE MOCKUP
   ═══════════════════════════════════════════════════════════ */

function PhoneMockup({ children }: { children?: React.ReactNode }) {
  return (
    <div
      className="relative mx-auto select-none"
      style={{ width: "clamp(250px, 24vw, 340px)", aspectRatio: "0.4779" }}
    >
      <div
        className="absolute inset-0"
        style={{
          borderRadius: "clamp(38px, 3.6vw, 54px)",
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
          borderRadius: "clamp(32px, 3.2vw, 48px)",
          background: "#08080A",
        }}
      />
      <div
        className="absolute overflow-hidden"
        style={{
          inset: "clamp(6px, 0.9vw, 12px)",
          borderRadius: "clamp(30px, 2.9vw, 44px)",
          background: "#000",
        }}
      >
        {children}
      </div>
      <div
        className="absolute left-1/2 z-30 -translate-x-1/2"
        style={{
          top: "clamp(14px, 1.7vw, 24px)",
          width: "clamp(76px, 7.4vw, 104px)",
          height: "clamp(20px, 2.1vw, 30px)",
          borderRadius: "999px",
          background: "#000",
        }}
      />
      <div
        className="pointer-events-none absolute z-20"
        style={{
          inset: "clamp(6px, 0.9vw, 12px)",
          borderRadius: "clamp(30px, 2.9vw, 44px)",
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
   LIVE CHAT — people-forward script
   ═══════════════════════════════════════════════════════════ */

type MsgKind = "text" | "image" | "voice";
type Message = {
  id: number;
  from: "me" | "alexa";
  kind: MsgKind;
  text?: string;
  image?: string;
  duration?: string;
  time: string;
  status: "sent" | "delivered" | "read";
};

const CHAT_SCRIPT: Omit<Message, "id" | "time" | "status">[] = [
  { from: "me",    kind: "text",  text: "just landed" },
  { from: "alexa", kind: "text",  text: "already? how was the flight" },
  { from: "me",    kind: "text",  text: "quiet. window seat. finished the book" },
  { from: "me",    kind: "image", image: MEDIA.twoFriends },
  { from: "alexa", kind: "text",  text: "who's that with you" },
  { from: "me",    kind: "text",  text: "old friend from school. surprised me at the gate" },
  { from: "me",    kind: "image", image: MEDIA.friendsLaugh },
  { from: "alexa", kind: "voice", duration: "0:14" },
  { from: "me",    kind: "text",  text: "listening now. you sound happy" },
  { from: "alexa", kind: "text",  text: "i am. i miss that" },
  { from: "alexa", kind: "image", image: MEDIA.cafe },
  { from: "alexa", kind: "text",  text: "remember this place" },
  { from: "me",    kind: "text",  text: "still my favourite afternoon" },
  { from: "me",    kind: "image", image: MEDIA.womanSmile },
  { from: "alexa", kind: "text",  text: "that's me on the left. obviously" },
  { from: "me",    kind: "text",  text: "obviously" },
  { from: "alexa", kind: "image", image: MEDIA.groupDusk },
  { from: "me",    kind: "text",  text: "we should get everyone together again" },
  { from: "alexa", kind: "text",  text: "sending the address" },
  { from: "alexa", kind: "image", image: MEDIA.hug },
  { from: "me",    kind: "text",  text: "walking there now. see you at 8" },
  { from: "alexa", kind: "text",  text: "don't be late" },
  { from: "me",    kind: "text",  text: "never" },
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

      schedule(380, () => {
        setMessages((prev) =>
          prev.map((p, idx) =>
            idx === prev.length - 1 && p.from === "me"
              ? { ...p, status: "delivered" }
              : p,
          ),
        );
      });
      schedule(950, () => {
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
        schedule(4200, () => {
          nextIndex.current = 0;
          setMessages([]);
          setTypingFrom(null);
          schedule(600, tick);
        });
        return;
      }

      const next = CHAT_SCRIPT[i];

      if (next.from === "alexa") {
        setTypingFrom("alexa");
        schedule(700, () => {
          setTypingFrom(null);
          pushMessage(next);
          nextIndex.current++;
          schedule(750 + Math.random() * 400, tick);
        });
      } else {
        pushMessage(next);
        nextIndex.current++;
        schedule(850 + Math.random() * 500, tick);
      }
    };

    schedule(500, tick);
    return clearAll;
  }, [enabled, clearAll]);

  return { messages, typingFrom };
}

/* ═══════════════════════════════════════════════════════════
   PHONE SCREEN
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

      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-6 pt-3 text-[10px] font-semibold tracking-tight text-white">
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

      <div className="relative z-10 flex items-center gap-2.5 px-4 pb-3 pt-12">
        <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full ring-1 ring-amber-400/30">
          <img
            src={PORTRAIT.alexa}
            alt=""
            className="h-full w-full object-cover"
            loading="eager"
            decoding="async"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium tracking-[-0.01em] text-white">
            alexa
          </p>
          <div className="mt-[2px] flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
            <span className="text-[9.5px] text-emerald-300/90">online</span>
            <span className="text-[9.5px] text-white/25">·</span>
            <LockKeyhole size={8} className="text-white/35" />
            <span className="text-[9.5px] text-white/35">encrypted</span>
          </div>
        </div>
        <button
          type="button"
          aria-label="Video call"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] transition-colors hover:bg-white/[0.1]"
        >
          <Video size={13} className="text-white/70" />
        </button>
        <button
          type="button"
          aria-label="Voice call"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] transition-colors hover:bg-white/[0.1]"
        >
          <Phone size={13} className="text-white/70" />
        </button>
      </div>

      <div className="mx-4 h-px bg-white/[0.05]" />

      <div
        ref={scrollRef}
        className="relative z-10 mt-3 flex-1 space-y-2 overflow-y-auto px-3.5 pb-3 scrollbar-hide"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <div className="flex justify-center">
          <span className="rounded-full bg-white/[0.04] px-2.5 py-[3px] text-[8.5px] uppercase tracking-[0.16em] text-white/40">
            Today
          </span>
        </div>

        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} />
        ))}

        {typingFrom === "alexa" && <TypingIndicator />}
      </div>

      <div className="relative z-10 border-t border-white/[0.05] px-3 pb-6 pt-2.5">
        <div className="flex items-center gap-1.5">
          <button className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06]">
            <Plus size={13} className="text-white/60" />
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.045] px-3 py-2">
            <span className="text-[10.5px] text-white/35">Message…</span>
            <div className="ml-auto flex items-center gap-1.5">
              <Camera size={11} className="text-white/35" />
              <Mic size={11} className="text-white/35" />
            </div>
          </div>
          <button className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#F59E0B] to-[#D97706]">
            <Send size={11} className="text-[#1A1105]" />
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-1.5 left-1/2 z-30 h-[3px] w-20 -translate-x-1/2 rounded-full bg-white/40" />
    </div>
  );
}

function ChatBubble({ message }: { message: Message }) {
  const isMe = message.from === "me";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        type: "spring",
        stiffness: 420,
        damping: 32,
        mass: 0.7,
      }}
      className={`flex ${isMe ? "justify-end" : "justify-start"}`}
    >
      <div className={`flex max-w-[78%] flex-col ${isMe ? "items-end" : "items-start"}`}>
        {message.kind === "text" && (
          <div
            className={`rounded-[14px] px-3 py-[7px] text-[10px] leading-[1.4] ${
              isMe
                ? "rounded-br-[4px] bg-gradient-to-br from-[#F59E0B] to-[#D97706] font-medium text-[#1A1105] shadow-[0_6px_18px_-8px_rgba(245,158,11,0.8)]"
                : "rounded-bl-[4px] border border-white/[0.06] bg-white/[0.06] text-white/90"
            }`}
          >
            {message.text}
          </div>
        )}

        {message.kind === "image" && (
          <div className="overflow-hidden rounded-[14px] border border-white/[0.07] bg-white/[0.04]">
            <img
              src={message.image}
              alt=""
              className="h-[100px] w-full object-cover"
              loading="lazy"
              decoding="async"
            />
          </div>
        )}

        {message.kind === "voice" && (
          <div
            className={`flex items-center gap-2 rounded-[14px] px-3 py-2 ${
              isMe
                ? "bg-gradient-to-br from-[#F59E0B] to-[#D97706] text-[#1A1105]"
                : "border border-white/[0.06] bg-white/[0.06] text-white/90"
            }`}
          >
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-black/15">
              <Play size={8} fill="currentColor" />
            </div>
            <div className="flex items-center gap-[2px]">
              {[3, 5, 8, 6, 9, 4, 7, 5, 3, 6, 8, 4].map((h, i) => (
                <span
                  key={i}
                  className="block w-[2px] rounded-full bg-current opacity-70"
                  style={{ height: `${h}px` }}
                />
              ))}
            </div>
            <span className="text-[9px] font-medium">{message.duration}</span>
          </div>
        )}

        <div className="mt-1 flex items-center gap-1 px-1">
          <span className="text-[8px] text-white/30">{message.time}</span>
          {isMe && (
            <span className="text-white/40">
              {message.status === "sent" && <Check size={9} />}
              {message.status === "delivered" && <CheckCheck size={9} />}
              {message.status === "read" && (
                <CheckCheck size={9} className="text-amber-300" />
              )}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-2"
    >
      <div className="h-5 w-5 shrink-0 overflow-hidden rounded-full ring-1 ring-white/10">
        <img
          src={PORTRAIT.alexa}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      </div>
      <div className="flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.05] px-2.5 py-1.5">
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
}

/* ═══════════════════════════════════════════════════════════
   HERO FLOATING CARDS
   ═══════════════════════════════════════════════════════════ */

const FloatCard = memo(function FloatCard({
  className,
  delay = 0,
  duration = 8,
  offset = 10,
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
      initial={reduce ? false : { opacity: 0, y: 14, scale: 0.94 }}
      animate={
        reduce
          ? { opacity: 1 }
          : { opacity: 1, y: [0, -offset, 0], scale: 1 }
      }
      transition={{
        opacity: { duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] },
        scale: { duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] },
        y: { duration, delay, repeat: Infinity, ease: "easeInOut" },
      }}
      className={`pointer-events-none absolute z-20 hidden lg:block ${className ?? ""}`}
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
  { id: "beat-0", label: "Obsidian" },
  { id: "beat-1", label: "Mars" },
  { id: "beat-2", label: "Jupiter" },
  { id: "beat-3", label: "Saturn" },
  { id: "beat-4", label: "Uranus" },
  { id: "beat-5", label: "Gargantua" },
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
    <div className="pointer-events-none fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 lg:block">
      <ul className="pointer-events-auto space-y-3.5">
        {BEAT_LABELS.map((b, i) => (
          <li key={b.id} className="group flex items-center justify-end gap-3">
            <span
              className={`pointer-events-none text-right text-[10px] uppercase tracking-[0.24em] transition-all duration-500 ${
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
                className={`block rounded-full transition-all duration-500 ${
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
    "group inline-flex items-center justify-center gap-2.5 rounded-full px-6 py-3.5 text-[13.5px] font-semibold tracking-[-0.01em] transition-[transform,box-shadow,background,border-color] duration-300 ease-out will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70";

  const primary =
    "bg-gradient-to-b from-amber-300 to-amber-500 text-[#150E03] shadow-[0_10px_36px_-14px_rgba(245,158,11,0.9),inset_0_1px_0_rgba(255,255,255,0.35)] hover:-translate-y-0.5 hover:shadow-[0_18px_50px_-14px_rgba(245,158,11,1),inset_0_1px_0_rgba(255,255,255,0.45)]";

  const secondary =
    "border border-white/[0.14] bg-white/[0.04] text-stone-100 backdrop-blur-xl hover:-translate-y-0.5 hover:border-white/[0.28] hover:bg-white/[0.08]";

  const cls = `${base} ${variant === "primary" ? primary : secondary}`;

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

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 inline-flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.28em] text-amber-400/90 sm:text-[11px]">
      <span className="h-px w-8 bg-gradient-to-r from-transparent to-amber-500/80" />
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
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15, margin: "0px 0px -60px 0px" }}
      transition={{
        duration: reduce ? 0 : 0.9,
        delay: reduce ? 0 : delay,
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
      className={`relative flex h-screen w-full items-center ${justify} px-5 sm:px-8 lg:px-14`}
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
   BEAT 0 — ORIGIN
   ═══════════════════════════════════════════════════════════ */

function BeatOrigin({
  messages,
  typingFrom,
}: {
  messages: Message[];
  typingFrom: "me" | "alexa" | null;
}) {
  const trustFaces = [
    PORTRAIT.alexa,
    PORTRAIT.maya,
    PORTRAIT.jamie,
    PORTRAIT.sam,
    PORTRAIT.river,
    PORTRAIT.blake,
    PORTRAIT.aisha,
    PORTRAIT.noah,
  ];

  return (
    <section
      id="beat-0"
      className="relative flex h-screen w-full items-center overflow-hidden px-5 pt-20 sm:px-8 lg:px-14 lg:pt-0"
    >
      <div className="relative z-10 mx-auto grid w-full max-w-[1440px] grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(320px,440px)] lg:gap-14">
        <div className="mx-auto max-w-[620px] lg:mx-0 lg:translate-y-20">
          <Reveal>
            <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-white/[0.09] bg-white/[0.03] py-1.5 pl-1.5 pr-4 backdrop-blur-xl">
              <div className="flex -space-x-2">
                {trustFaces.slice(0, 5).map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt=""
                    className="h-6 w-6 rounded-full border border-[#0A0A0E] object-cover"
                    loading="eager"
                    decoding="async"
                  />
                ))}
              </div>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[10px] uppercase tracking-[0.22em] text-stone-300">
                A conversation, rebuilt
              </span>
            </div>
          </Reveal>

          <Reveal delay={0.06}>
            <h1 className="text-[clamp(46px,7vw,110px)] font-medium leading-[0.92] tracking-[-0.055em] text-stone-100">
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
            <p className="mt-8 max-w-[470px] text-[15px] leading-[1.85] text-stone-400 sm:text-[16px]">
              Every message starts somewhere — a glance, a laugh, a
              moment worth keeping. Orbital gives those moments a place
              built only for the people inside them.
            </p>
          </Reveal>

          <Reveal delay={0.18}>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <PrimaryButton to="/register">Create account</PrimaryButton>
              <PrimaryButton to="/login" variant="secondary">
                Sign in
              </PrimaryButton>
            </div>
          </Reveal>

          <Reveal delay={0.24}>
            <div className="mt-12 flex flex-wrap gap-x-8 gap-y-3 text-[11.5px] text-stone-500">
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

        <Reveal delay={0.14}>
          <div className="relative mx-auto w-full max-w-[420px]">
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
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="will-change-transform"
            >
              <PhoneMockup>
                <PhoneScreen messages={messages} typingFrom={typingFrom} />
              </PhoneMockup>
            </motion.div>

            <FloatCard
              className="left-[-92px] top-[14%]"
              delay={0.9}
              duration={8}
              offset={10}
            >
              <div className="flex w-[210px] items-center gap-2.5 rounded-2xl border border-white/[0.08] bg-black/60 p-2.5 backdrop-blur-xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)]">
                <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full ring-1 ring-white/15">
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
                    <p className="truncate text-[10.5px] font-medium text-white">
                      Maya Chen
                    </p>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                  </div>
                  <p className="mt-[1px] truncate text-[9.5px] text-white/55">
                    sending a photo…
                  </p>
                </div>
                <span className="text-[8px] text-white/35">now</span>
              </div>
            </FloatCard>

            <FloatCard
              className="right-[-88px] top-[36%]"
              delay={1.15}
              duration={9}
              offset={14}
            >
              <div className="overflow-hidden rounded-2xl border border-white/[0.1] bg-black/60 backdrop-blur-xl shadow-[0_24px_70px_-24px_rgba(0,0,0,0.9)]">
                <div className="relative h-[116px] w-[150px]">
                  <img
                    src={MEDIA.twoFriends}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <div className="absolute bottom-1.5 left-2 flex items-center gap-1.5">
                    <ImageIcon size={9} className="text-white/80" />
                    <span className="text-[8.5px] font-medium text-white/85">
                      With an old friend
                    </span>
                  </div>
                </div>
              </div>
            </FloatCard>

            <FloatCard
              className="bottom-[20%] left-[-76px]"
              delay={1.4}
              duration={7.5}
              offset={9}
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
              className="bottom-[6%] right-[-64px]"
              delay={1.6}
              duration={8.5}
              offset={12}
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
                  <p className="text-[9.5px] font-medium text-white">
                    Jamie · live
                  </p>
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

            <FloatCard
              className="right-[-100px] top-[6%]"
              delay={1.9}
              duration={9.5}
              offset={10}
            >
              <div className="flex items-center gap-2 rounded-full border border-white/[0.09] bg-black/60 py-1.5 pl-1.5 pr-3.5 backdrop-blur-xl shadow-[0_18px_54px_-20px_rgba(0,0,0,0.9)]">
                <div className="flex -space-x-2">
                  {[PORTRAIT.iris, PORTRAIT.theo, PORTRAIT.nova, PORTRAIT.finn].map(
                    (src, i) => (
                      <img
                        key={i}
                        src={src}
                        alt=""
                        className="h-6 w-6 rounded-full border border-[#0A0A0E] object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ),
                  )}
                </div>
                <span className="text-[9.5px] font-medium text-white/75">
                  4 friends online
                </span>
              </div>
            </FloatCard>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

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
        <h2 className="text-[clamp(36px,5.2vw,68px)] font-light leading-[1] tracking-[-0.055em] text-stone-100">
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
        <p className="mt-7 max-w-[440px] text-[15px] leading-[1.9] text-stone-400">
          Your message is encrypted on your device before it ever touches
          the network. What travels is a cipher that only your circle can
          open — unreadable to anyone else, including us.
        </p>
      </Reveal>
      <Reveal delay={0.18}>
        <div className="mt-9 grid grid-cols-3 gap-3">
          {[
            { label: "On device", value: "AES-256" },
            { label: "In transit", value: "X25519" },
            { label: "Keys", value: "Never share" },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 backdrop-blur-xl"
            >
              <p className="text-[9.5px] uppercase tracking-[0.2em] text-stone-500">
                {item.label}
              </p>
              <p className="mt-2 text-[13px] font-medium text-amber-300">
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
      className="relative flex h-screen w-full items-center px-5 sm:px-8 lg:px-14"
    >
      <div className="relative z-10 grid w-full max-w-[1440px] items-center gap-14 lg:grid-cols-[0.9fr_1fr] lg:gap-20">
        <Reveal delay={0.06}>
          <div className="relative overflow-hidden rounded-[28px] border border-white/[0.09] bg-[#0B0A0D]/90 shadow-[0_50px_140px_-70px_rgba(245,158,11,0.5)] backdrop-blur-2xl">
            <div className="p-7 sm:p-9">
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-5">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 overflow-hidden rounded-full ring-1 ring-white/10">
                    <img
                      src={PORTRAIT.nova}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500">
                      Secure thread
                    </p>
                    <p className="mt-1 text-[14px] text-stone-200">
                      Sienna Vale
                    </p>
                  </div>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-amber-400/20 bg-amber-400/[0.08]">
                  <LockKeyhole size={17} className="text-amber-400" />
                </div>
              </div>

              <div className="mt-7 space-y-4">
                <motion.div
                  initial={{ opacity: 0, x: -14 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    duration: 0.6,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="max-w-[82%] rounded-[20px] rounded-tl-[6px] border border-white/[0.07] bg-white/[0.04] px-4 py-3.5 text-[13.5px] leading-[1.55] text-stone-300"
                >
                  Are we still on for the shoot tomorrow?
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, x: 14 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    duration: 0.6,
                    delay: 0.12,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="ml-auto max-w-[82%] rounded-[20px] rounded-tr-[6px] border border-amber-400/20 bg-amber-400/[0.09] px-4 py-3.5 text-[13.5px] leading-[1.55] text-amber-100"
                >
                  Wouldn't miss it ✦
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    duration: 0.6,
                    delay: 0.24,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="overflow-hidden rounded-[16px] border border-white/[0.08] bg-white/[0.035]"
                >
                  <img
                    src={MEDIA.cafe}
                    alt=""
                    className="h-[150px] w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-[11px] text-stone-400">
                      Where we met · years ago
                    </span>
                    <Check size={13} className="text-amber-400" />
                  </div>
                </motion.div>
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-white/[0.07] bg-white/[0.015] px-7 py-4 text-[10px] uppercase tracking-[0.2em] text-stone-500">
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
            <h2 className="text-[clamp(36px,5.2vw,68px)] font-light leading-[1] tracking-[-0.055em] text-stone-100">
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
            <p className="mt-7 max-w-[440px] text-[15px] leading-[1.9] text-stone-400">
              Encryption keys are generated on your device and never leave
              it. Not to a server, not to a backup, not to us. What you
              send is yours to keep.
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
                  className="flex items-center gap-3 text-[13.5px] text-stone-300"
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

function BeatOrbit() {
  const orbitFaces = [
    PORTRAIT.alexa,
    PORTRAIT.maya,
    PORTRAIT.jamie,
    PORTRAIT.sam,
    PORTRAIT.river,
    PORTRAIT.blake,
    PORTRAIT.aisha,
    PORTRAIT.noah,
    PORTRAIT.iris,
    PORTRAIT.theo,
  ];

  return (
    <Section id="beat-3" align="right">
      <Reveal>
        <Eyebrow>Beat 03 · Orbit</Eyebrow>
      </Reveal>
      <Reveal delay={0.06}>
        <h2 className="text-[clamp(36px,5.2vw,68px)] font-light leading-[1] tracking-[-0.055em] text-stone-100">
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
        <p className="mt-7 max-w-[440px] text-[15px] leading-[1.9] text-stone-400">
          No feeds. No followers. Just the rooms you chose — capped at
          fifty people, sized for real conversation. Messages, photos,
          files, voice notes — all in one place.
        </p>
      </Reveal>
      <Reveal delay={0.18}>
        <div className="mt-9 flex -space-x-3">
          {orbitFaces.map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              className="h-11 w-11 rounded-full border-2 border-[#07070A] object-cover"
              loading="lazy"
              decoding="async"
            />
          ))}
          <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#07070A] bg-white/[0.06] text-[10px] text-stone-400">
            +40
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.22}>
        <div className="mt-6 flex gap-2">
          {[MEDIA.dinner, MEDIA.carRide, MEDIA.rooftop, MEDIA.coupleWalk].map(
            (src, i) => (
              <div
                key={i}
                className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/[0.08]"
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
        <div className="mt-9">
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
      className="relative flex h-screen w-full items-center px-5 sm:px-8 lg:px-14"
    >
      <div className="relative z-10 grid w-full max-w-[1440px] items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <div>
          <Reveal>
            <Eyebrow>Beat 04 · Resonance</Eyebrow>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className="text-[clamp(36px,5.2vw,68px)] font-light leading-[1] tracking-[-0.055em] text-stone-100">
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
            <p className="mt-7 max-w-[440px] text-[15px] leading-[1.9] text-stone-400">
              When a text isn't enough, move into voice or video. Spatial
              audio, noise suppression, and low-latency calls that hold up
              on a bad connection.
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
                  className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3.5 backdrop-blur-xl"
                >
                  <item.icon size={16} className="shrink-0 text-amber-400" />
                  <span className="text-[12px] text-stone-300">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.1}>
          <div className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#0B0A0D]/90 backdrop-blur-2xl">
            <div className="relative aspect-[4/5] w-full overflow-hidden bg-black">
              <img
                src={MEDIA.womanCall}
                alt=""
                className="h-full w-full object-cover opacity-65"
                loading="lazy"
                decoding="async"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0B0A0D] via-[#0B0A0D]/40 to-transparent" />

              <div className="absolute right-3 top-3 flex flex-col gap-1.5">
                {[PORTRAIT.iris, PORTRAIT.theo, PORTRAIT.nova].map((src, i) => (
                  <div
                    key={i}
                    className="h-10 w-10 overflow-hidden rounded-xl border border-white/20 ring-1 ring-black/40"
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

              <div className="absolute inset-x-0 bottom-0 p-6">
                <div className="rounded-[20px] border border-white/[0.08] bg-black/60 p-4 backdrop-blur-xl">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 overflow-hidden rounded-full ring-1 ring-white/10">
                      <img
                        src={PORTRAIT.blake}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                    <div className="flex-1">
                      <p className="text-[13px] text-white">John Reeves</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                        <span className="text-[10px] text-emerald-300/90">
                          02:47
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <button className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
                        <Mic size={14} className="text-white/80" />
                      </button>
                      <button className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
                        <Video size={14} className="text-white/80" />
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
      className="relative flex h-screen w-full items-center px-5 sm:px-8 lg:px-14"
    >
      <div className="relative z-10 mx-auto grid w-full max-w-[1280px] grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] lg:gap-16">
        <div className="mx-auto max-w-[560px] text-center lg:mx-0 lg:text-left">
          <Reveal>
            <div className="mb-6 inline-flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.28em] text-amber-400/90 sm:text-[11px]">
              <span className="h-px w-8 bg-gradient-to-r from-transparent to-amber-500/80" />
              Beat 05 · Arrival
            </div>
          </Reveal>

          <Reveal delay={0.06}>
            <h2 className="text-[clamp(40px,7.2vw,96px)] font-light leading-[0.96] tracking-[-0.06em] text-stone-100">
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
            <p className="mt-8 max-w-[460px] text-[14.5px] leading-[1.9] text-stone-400 sm:text-[15.5px] lg:mx-0">
              Bring your conversations along. The Orbital Android app
              keeps your circles, your calls, and your keys right where
              they belong — with you.
            </p>
          </Reveal>

          <Reveal delay={0.18}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <PrimaryButton to="/register">Create account</PrimaryButton>
              <PrimaryButton to="/login" variant="secondary">
                Sign in
              </PrimaryButton>
            </div>
          </Reveal>

          <Reveal delay={0.24}>
            <div className="mt-6 flex items-center justify-center gap-3 lg:justify-start">
              <a
                href={DOWNLOAD_HREF}
                download
                className="group inline-flex items-center gap-2.5 text-[13px] text-stone-400 transition-colors duration-300 hover:text-amber-300"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] transition-colors duration-300 group-hover:border-amber-400/40 group-hover:bg-amber-400/[0.08]">
                  <ArrowRight size={13} className="rotate-90" />
                </span>
                <span className="border-b border-transparent pb-[1px] transition-colors duration-300 group-hover:border-amber-400/40">
                  Download for Android
                </span>
              </a>
            </div>
          </Reveal>

          <Reveal delay={0.3}>
            <div className="mt-14 flex items-center justify-center gap-3 lg:justify-start">
              <span className="h-px w-12 bg-gradient-to-r from-transparent to-amber-500/40" />
              <p className="text-[10px] uppercase tracking-[0.32em] text-stone-600">
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
              animate={{ y: [0, -8, 0] }}
              transition={{
                duration: 7,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="relative overflow-hidden rounded-[28px] border border-white/[0.09] bg-[#0B0A0D]/85 p-6 backdrop-blur-2xl shadow-[0_50px_140px_-70px_rgba(245,158,11,0.6)]"
            >
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                  <span className="text-[10px] uppercase tracking-[0.24em] text-stone-400">
                    Ready to install
                  </span>
                </div>
                <span className="text-[10px] uppercase tracking-[0.24em] text-amber-400/80">
                  Android
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2.5">
                {[MEDIA.twoFriends, MEDIA.cafe, MEDIA.hug, MEDIA.groupDusk].map(
                  (src, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{
                        duration: 0.6,
                        delay: 0.2 + i * 0.06,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      className="relative aspect-[4/5] overflow-hidden rounded-[18px] border border-white/[0.06]"
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

              <div className="mt-5 flex items-center justify-between border-t border-white/[0.06] pt-4">
                {[
                  { label: "Circles", value: "Kept" },
                  { label: "Calls", value: "Kept" },
                  { label: "Keys", value: "Yours" },
                ].map((item) => (
                  <div key={item.label} className="text-center">
                    <p className="text-[9px] uppercase tracking-[0.2em] text-stone-500">
                      {item.label}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-amber-300">
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

  const [heroOnScreen, setHeroOnScreen] = useState(true);
  useEffect(() => {
    const cb = (i: number) => setHeroOnScreen(i === 0);
    beatListeners.add(cb);
    return () => {
      beatListeners.delete(cb);
    };
  }, []);

  const { messages, typingFrom } = useLiveChat(heroOnScreen);

  const dpr: [number, number] = useMemo(() => {
    if (tier === "low") return [1, 1];
    if (tier === "mid") return [1, 1.1];
    return [1, 1.2];
  }, [tier]);

  return (
    <main
      className="relative min-h-screen overflow-clip bg-[#07070A] text-stone-100 selection:bg-amber-400/30 selection:text-amber-100"
      style={{
        fontFamily:
          '"Inter Tight", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter+Tight:ital,wght@0,200..800;1,200..800&family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&display=swap');

        html {
          scroll-behavior: smooth;
          scrollbar-gutter: stable;
          overscroll-behavior-y: none;
        }

        body {
          margin: 0;
          background: #07070A;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
          overflow-x: hidden;
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
            dpr={dpr}
            camera={{ position: [0, 0.6, 9], fov: 50, near: 0.1, far: 220 }}
            gl={{
              antialias: false,
              alpha: false,
              powerPreference: "high-performance",
              stencil: false,
              depth: true,
            }}
            onCreated={({ gl }) => {
              gl.setClearColor(DEEP, 1);
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 1.08;
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
              <PostFX tier={tier} />
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