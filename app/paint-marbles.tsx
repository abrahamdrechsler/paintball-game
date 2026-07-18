"use client";

/* eslint-disable react-hooks/immutability -- the animation loop intentionally keeps mutable physics bodies in refs */

import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };
type Side = "top" | "right" | "bottom" | "left";

type SurfaceMark = {
  v: Vec3;
  color: string;
  size: number;
  seed: number;
  paint?: boolean;
};

type Ball = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  baseR: number;
  sizeSeed: number;
  base: string;
  accent: string;
  highlight: string;
  q: Quat;
  marks: SurfaceMark[];
  squashX: number;
  squashY: number;
  squashVX: number;
  squashVY: number;
  dragging: boolean;
};

type Spike = { side: Side; pos: number };
type Particle = { x: number; y: number; vx: number; vy: number; r: number; color: string; life: number; maxLife: number };

const RAIL = 18;
const TAU = Math.PI * 2;
const PALETTES = [
  ["#ff4d73", "#ffe36e", "#a42f57"],
  ["#4c7dff", "#82f0dc", "#2442a8"],
  ["#ff9f43", "#ffed78", "#dc3f66"],
  ["#7a5cff", "#ff77bd", "#34d6c8"],
  ["#28c987", "#e8ff79", "#197f72"],
] as const;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const identityQ = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });

function mulQ(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function rotateVec(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

function inverseRotateVec(q: Quat, v: Vec3): Vec3 {
  return rotateVec({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
}

function rollBall(ball: Ball, dx: number, dy: number) {
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) return;
  const ax = -dy / distance;
  const ay = dx / distance;
  const half = distance / ball.r / 2;
  const s = Math.sin(half);
  ball.q = mulQ({ x: ax * s, y: ay * s, z: 0, w: Math.cos(half) }, ball.q);
}

function createTextureMarks(accent: string, highlight: string, seed: number): SurfaceMark[] {
  const marks: SurfaceMark[] = [];
  for (let i = 0; i < 34; i++) {
    const golden = i * 2.399963 + seed;
    const y = 1 - ((i + 0.5) / 34) * 2;
    const rr = Math.sqrt(1 - y * y);
    marks.push({
      v: { x: Math.cos(golden) * rr, y, z: Math.sin(golden) * rr },
      color: i % 3 === 0 ? highlight : accent,
      size: i % 3 === 0 ? 0.095 : 0.065,
      seed: seed * 100 + i,
    });
  }
  return marks;
}

function makeBall(id: number, width: number, height: number): Ball {
  const palette = PALETTES[id % PALETTES.length];
  const r = clamp(Math.min(width, height) * 0.075, 38, 66);
  const sizeSeed = Math.abs(Math.sin((id + 1) * 12.9898) * 43758.5453) % 1;
  const angle = id * 2.19 + 0.8;
  const speed = 120 + (id % 3) * 32;
  return {
    id,
    x: clamp(width * (0.28 + ((id * 0.27) % 0.48)), RAIL + r, width - RAIL - r),
    y: clamp(height * (0.28 + ((id * 0.21) % 0.44)), RAIL + r, height - RAIL - r),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r,
    baseR: r,
    sizeSeed,
    base: palette[0],
    accent: palette[1],
    highlight: palette[2],
    q: identityQ(),
    marks: createTextureMarks(palette[1], palette[2], id + 1),
    squashX: 0,
    squashY: 0,
    squashVX: 0,
    squashVY: 0,
    dragging: false,
  };
}

function applyBallSize(ball: Ball, enabled: boolean, variability: number, minScale: number, maxScale: number, width: number, height: number) {
  const spreadTarget = ball.sizeSeed < 0.5
    ? minScale + (1 - minScale) * ball.sizeSeed * 2
    : 1 + (maxScale - 1) * (ball.sizeSeed - 0.5) * 2;
  const scale = enabled ? 1 + (spreadTarget - 1) * variability : 1;
  ball.r = clamp(ball.baseR * scale, ball.baseR * 0.75, Math.min(width, height) * 0.42);
  ball.x = clamp(ball.x, RAIL + ball.r, width - RAIL - ball.r);
  ball.y = clamp(ball.y, RAIL + ball.r, height - RAIL - ball.r);
}

function kickSquash(ball: Ball, nx: number, ny: number, strength: number) {
  const amount = clamp(strength / 850, 0.05, 0.23);
  ball.squashX -= Math.abs(nx) * amount;
  ball.squashY -= Math.abs(ny) * amount;
}

function updateSquash(ball: Ball, dt: number) {
  const stiffness = 190;
  const damping = 14;
  ball.squashVX += (-stiffness * ball.squashX - damping * ball.squashVX) * dt;
  ball.squashVY += (-stiffness * ball.squashY - damping * ball.squashVY) * dt;
  ball.squashX += ball.squashVX * dt;
  ball.squashY += ball.squashVY * dt;
}

function localizePaint(ball: Ball, worldNormal: Vec3, color: string, intensity: number) {
  const rawCenter = inverseRotateVec(ball.q, worldNormal);
  const centerLength = Math.hypot(rawCenter.x, rawCenter.y, rawCenter.z) || 1;
  const center = { x: rawCenter.x / centerLength, y: rawCenter.y / centerLength, z: rawCenter.z / centerLength };
  const reference = Math.abs(center.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const tangentRaw = {
    x: center.y * reference.z - center.z * reference.y,
    y: center.z * reference.x - center.x * reference.z,
    z: center.x * reference.y - center.y * reference.x,
  };
  const tangentLength = Math.hypot(tangentRaw.x, tangentRaw.y, tangentRaw.z) || 1;
  const tangent = { x: tangentRaw.x / tangentLength, y: tangentRaw.y / tangentLength, z: tangentRaw.z / tangentLength };
  const bitangent = {
    x: center.y * tangent.z - center.z * tangent.y,
    y: center.z * tangent.x - center.x * tangent.z,
    z: center.x * tangent.y - center.y * tangent.x,
  };
  const capAngle = 1.08 + 0.16 * intensity;
  const count = Math.round(38 + intensity * 18);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * TAU;
    const edgeBias = i < 7 ? Math.random() * 0.22 : Math.sqrt(Math.random());
    const theta = capAngle * edgeBias * (0.92 + Math.random() * 0.12);
    const around = {
      x: tangent.x * Math.cos(angle) + bitangent.x * Math.sin(angle),
      y: tangent.y * Math.cos(angle) + bitangent.y * Math.sin(angle),
      z: tangent.z * Math.cos(angle) + bitangent.z * Math.sin(angle),
    };
    ball.marks.push({
      v: {
        x: center.x * Math.cos(theta) + around.x * Math.sin(theta),
        y: center.y * Math.cos(theta) + around.y * Math.sin(theta),
        z: center.z * Math.cos(theta) + around.z * Math.sin(theta),
      },
      color,
      size: i < 7 ? 0.25 + Math.random() * 0.12 : 0.13 + Math.random() * 0.13,
      seed: Math.random() * 10000,
      paint: true,
    });
  }
  if (ball.marks.length > 280) ball.marks.splice(34, ball.marks.length - 280);
}

function drawSplat(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, radius: number) {
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = color;
  ctx.beginPath();
  const lobes = 28;
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * TAU;
    const wobble = radius * (0.48 + Math.random() * 0.46 + (i % 4 === 0 ? Math.random() * 0.4 : 0));
    const px = x + Math.cos(a) * wobble;
    const py = y + Math.sin(a) * wobble;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 42; i++) {
    const a = Math.random() * TAU;
    const d = radius * (0.5 + Math.pow(Math.random(), 0.42) * 1.65);
    const rr = radius * (0.018 + Math.random() * 0.075);
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, rr * (0.5 + Math.random()), rr, a, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawSpike(ctx: CanvasRenderingContext2D, spike: Spike, width: number, height: number) {
  const half = 13;
  const depth = 25;
  ctx.save();
  ctx.fillStyle = "#252323";
  ctx.beginPath();
  if (spike.side === "top") {
    ctx.moveTo(spike.pos - half, RAIL); ctx.lineTo(spike.pos + half, RAIL); ctx.lineTo(spike.pos, RAIL + depth);
  } else if (spike.side === "bottom") {
    ctx.moveTo(spike.pos - half, height - RAIL); ctx.lineTo(spike.pos + half, height - RAIL); ctx.lineTo(spike.pos, height - RAIL - depth);
  } else if (spike.side === "left") {
    ctx.moveTo(RAIL, spike.pos - half); ctx.lineTo(RAIL, spike.pos + half); ctx.lineTo(RAIL + depth, spike.pos);
  } else {
    ctx.moveTo(width - RAIL, spike.pos - half); ctx.lineTo(width - RAIL, spike.pos + half); ctx.lineTo(width - RAIL - depth, spike.pos);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawBall(ctx: CanvasRenderingContext2D, ball: Ball) {
  const sx = clamp(1 + ball.squashX - ball.squashY * 0.38, 0.72, 1.25);
  const sy = clamp(1 + ball.squashY - ball.squashX * 0.38, 0.72, 1.25);
  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.scale(sx, sy);

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, ball.r, 0, TAU);
  ctx.clip();
  const gradient = ctx.createRadialGradient(-ball.r * 0.34, -ball.r * 0.42, ball.r * 0.06, 0, 0, ball.r * 1.12);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.08, ball.base);
  gradient.addColorStop(0.72, ball.base);
  gradient.addColorStop(1, "#272238");
  ctx.fillStyle = gradient;
  ctx.fillRect(-ball.r, -ball.r, ball.r * 2, ball.r * 2);

  const visible = ball.marks
    .map((mark) => ({ mark, p: rotateVec(ball.q, mark.v) }))
    .filter(({ p }) => p.z > -0.03)
    .sort((a, b) => a.p.z - b.p.z);

  for (const { mark, p } of visible) {
    const edge = clamp((p.z + 0.05) / 0.5, 0, 1);
    const rr = ball.r * mark.size * (0.45 + p.z * 0.55) * edge;
    if (rr < 0.35) continue;
    const px = p.x * ball.r;
    const py = -p.y * ball.r;
    ctx.globalAlpha = mark.paint ? 0.9 : 0.82;
    ctx.fillStyle = mark.color;
    ctx.beginPath();
    ctx.ellipse(px, py, rr * (mark.paint ? 1.4 : 1), rr, mark.seed % Math.PI, 0, TAU);
    ctx.fill();
    if (mark.paint && rr > 2) {
      ctx.beginPath();
      ctx.arc(px + rr * 1.55, py - rr * 0.5, rr * 0.28, 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  const shine = ctx.createRadialGradient(-ball.r * 0.38, -ball.r * 0.45, 0, -ball.r * 0.38, -ball.r * 0.45, ball.r * 0.52);
  shine.addColorStop(0, "rgba(255,255,255,.55)");
  shine.addColorStop(0.25, "rgba(255,255,255,.18)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shine;
  ctx.fillRect(-ball.r, -ball.r, ball.r * 2, ball.r * 2);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(0, 0, ball.r, 0, TAU);
  ctx.strokeStyle = "rgba(35,31,45,.75)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}

function railSide(x: number, y: number, width: number, height: number): Side | null {
  if (y <= RAIL + 8) return "top";
  if (y >= height - RAIL - 8) return "bottom";
  if (x <= RAIL + 8) return "left";
  if (x >= width - RAIL - 8) return "right";
  return null;
}

export default function PaintMarbles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintRef = useRef<HTMLCanvasElement | null>(null);
  const ballsRef = useRef<Ball[]>([]);
  const spikesRef = useRef<Spike[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const sizeRef = useRef({ width: 800, height: 600 });
  const nextIdRef = useRef(0);
  const dragRef = useRef<{ id: number; lastX: number; lastY: number; lastTime: number } | null>(null);
  const energyRef = useRef(0.78);
  const blastPowerRef = useRef(0.5);
  const soundEnabledRef = useRef(true);
  const sizeMixRef = useRef(true);
  const sizeVariabilityRef = useRef(0.6);
  const minSizeRef = useRef(0.85);
  const maxSizeRef = useRef(2.2);
  const audioRef = useRef<AudioContext | null>(null);
  const pausedRef = useRef(false);
  const [score, setScore] = useState(0);
  const [count, setCount] = useState(0);
  const [energy, setEnergy] = useState(78);
  const [blastPower, setBlastPower] = useState(50);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [sizeMix, setSizeMix] = useState(true);
  const [sizePanelOpen, setSizePanelOpen] = useState(false);
  const [sizeVariability, setSizeVariability] = useState(60);
  const [minSize, setMinSize] = useState(85);
  const [maxSize, setMaxSize] = useState(220);
  const [paused, setPaused] = useState(false);
  const [hint, setHint] = useState("Tap a rail to plant a spike");

  const syncCount = useCallback(() => setCount(ballsRef.current.length), []);

  const applyCurrentSizes = useCallback(() => {
    const { width, height } = sizeRef.current;
    for (const ball of ballsRef.current) {
      applyBallSize(ball, sizeMixRef.current, sizeVariabilityRef.current, minSizeRef.current, maxSizeRef.current, width, height);
    }
  }, []);

  const ensureAudio = () => {
    if (!soundEnabledRef.current) return null;
    if (!audioRef.current) audioRef.current = new AudioContext();
    if (audioRef.current.state === "suspended") void audioRef.current.resume();
    return audioRef.current;
  };

  const playPop = useCallback((power: number) => {
    if (!soundEnabledRef.current) return;
    const audio = audioRef.current;
    if (!audio || audio.state !== "running") return;
    const now = audio.currentTime;
    const variation = 0.84 + Math.random() * 0.34;
    const master = audio.createGain();
    master.gain.setValueAtTime(0.72, now);
    master.connect(audio.destination);

    const body = audio.createOscillator();
    const bodyGain = audio.createGain();
    body.type = Math.random() > 0.45 ? "sine" : "triangle";
    body.frequency.setValueAtTime((215 - power * 80) * variation, now);
    body.frequency.exponentialRampToValueAtTime((68 - power * 30) * variation, now + 0.13 + power * 0.1);
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.42 + power * 0.2, now + 0.006);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17 + power * 0.14);
    body.connect(bodyGain).connect(master);
    body.start(now);
    body.stop(now + 0.26);

    const snap = audio.createOscillator();
    const snapGain = audio.createGain();
    snap.type = "square";
    snap.frequency.setValueAtTime((520 + Math.random() * 310) * variation, now);
    snap.frequency.exponentialRampToValueAtTime(130 * variation, now + 0.045);
    snapGain.gain.setValueAtTime(0.16 + Math.random() * 0.1, now);
    snapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055 + Math.random() * 0.025);
    snap.connect(snapGain).connect(master);
    snap.start(now);
    snap.stop(now + 0.09);

    const noiseLength = Math.floor(audio.sampleRate * (0.19 + power * 0.18));
    const noiseBuffer = audio.createBuffer(1, noiseLength, audio.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / noise.length, 1.7);
    const splatter = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const noiseGain = audio.createGain();
    splatter.buffer = noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.value = (620 + Math.random() * 880) * variation;
    filter.Q.value = 0.55 + Math.random() * 0.85;
    noiseGain.gain.setValueAtTime(0.2 + power * 0.16, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18 + power * 0.18);
    splatter.connect(filter).connect(noiseGain).connect(master);
    splatter.start(now + Math.random() * 0.012);
  }, []);

  const addBall = useCallback(() => {
    const { width, height } = sizeRef.current;
    const ball = makeBall(nextIdRef.current++, width, height);
    applyBallSize(ball, sizeMixRef.current, sizeVariabilityRef.current, minSizeRef.current, maxSizeRef.current, width, height);
    for (let attempts = 0; attempts < 24; attempts++) {
      const overlap = ballsRef.current.some((other) => Math.hypot(ball.x - other.x, ball.y - other.y) < ball.r + other.r + 10);
      if (!overlap) break;
      ball.x = RAIL + ball.r + Math.random() * Math.max(1, width - 2 * (RAIL + ball.r));
      ball.y = RAIL + ball.r + Math.random() * Math.max(1, height - 2 * (RAIL + ball.r));
    }
    ballsRef.current.push(ball);
    syncCount();
    setHint("Drag a marble and give it a fling");
  }, [syncCount]);

  const clearPaint = useCallback(() => {
    const paint = paintRef.current;
    if (paint) paint.getContext("2d")?.clearRect(0, 0, paint.width, paint.height);
    for (const ball of ballsRef.current) ball.marks = ball.marks.filter((mark) => !mark.paint);
    setHint("Fresh canvas, same chaos");
  }, []);

  const resetGame = useCallback(() => {
    ballsRef.current = [];
    spikesRef.current = [];
    particlesRef.current = [];
    nextIdRef.current = 0;
    setScore(0);
    clearPaint();
    const { width, height } = sizeRef.current;
    ballsRef.current = [makeBall(nextIdRef.current++, width, height), makeBall(nextIdRef.current++, width, height), makeBall(nextIdRef.current++, width, height)];
    applyCurrentSizes();
    syncCount();
    setHint("Tap a rail to plant a spike");
  }, [applyCurrentSizes, clearPaint, syncCount]);

  const explodeBall = useCallback((ball: Ball) => {
    const blastScale = 0.75 + blastPowerRef.current * 2.06;
    playPop(blastPowerRef.current);
    const paint = paintRef.current;
    const pctx = paint?.getContext("2d");
    if (pctx) {
      const scaleX = paint!.width / sizeRef.current.width;
      const scaleY = paint!.height / sizeRef.current.height;
      pctx.save();
      pctx.scale(scaleX, scaleY);
      drawSplat(pctx, ball.x, ball.y, ball.base, ball.r * 1.55 * blastScale);
      pctx.restore();
    }

    for (const other of ballsRef.current) {
      if (other.id === ball.id) continue;
      const dx = other.x - ball.x;
      const dy = other.y - ball.y;
      const dist = Math.hypot(dx, dy);
      const reach = ball.r * 3.8 * blastScale + other.r;
      if (dist < reach) {
        const intensity = clamp(1 - dist / reach, 0.18, 1);
        const len = dist || 1;
        localizePaint(other, { x: -dx / len, y: dy / len, z: 0.55 }, ball.base, intensity);
        other.vx += (dx / len) * 190 * intensity * blastScale;
        other.vy += (dy / len) * 190 * intensity * blastScale;
      }
    }

    const particleCount = Math.round(44 + blastPowerRef.current * 92);
    for (let i = 0; i < particleCount; i++) {
      const a = Math.random() * TAU;
      const speed = (80 + Math.random() * 380) * Math.sqrt(blastScale);
      particlesRef.current.push({
        x: ball.x,
        y: ball.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        r: 2 + Math.random() * 7,
        color: i % 5 === 0 ? ball.accent : ball.base,
        life: 0.55 + Math.random() * 0.65,
        maxLife: 1.2,
      });
    }
    ballsRef.current = ballsRef.current.filter((item) => item.id !== ball.id);
    setScore((value) => value + 1);
    syncCount();
    setHint(ballsRef.current.length ? "SPLAT! Keep going" : "All splatted — add another marble");
  }, [playPop, syncCount]);

  useEffect(() => {
    energyRef.current = energy / 100;
  }, [energy]);

  useEffect(() => {
    blastPowerRef.current = blastPower / 100;
  }, [blastPower]);

  useEffect(() => {
    sizeMixRef.current = sizeMix;
    sizeVariabilityRef.current = sizeVariability / 100;
    minSizeRef.current = minSize / 100;
    maxSizeRef.current = maxSize / 100;
    applyCurrentSizes();
  }, [applyCurrentSizes, maxSize, minSize, sizeMix, sizeVariability]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paintRef.current = document.createElement("canvas");

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const oldWidth = sizeRef.current.width;
      const oldHeight = sizeRef.current.height;
      sizeRef.current = { width: Math.max(320, rect.width), height: Math.max(300, rect.height) };
      canvas.width = Math.round(sizeRef.current.width * dpr);
      canvas.height = Math.round(sizeRef.current.height * dpr);

      const oldPaint = paintRef.current!;
      const copy = document.createElement("canvas");
      copy.width = oldPaint.width;
      copy.height = oldPaint.height;
      copy.getContext("2d")?.drawImage(oldPaint, 0, 0);
      oldPaint.width = canvas.width;
      oldPaint.height = canvas.height;
      if (copy.width && copy.height) oldPaint.getContext("2d")?.drawImage(copy, 0, 0, copy.width, copy.height, 0, 0, oldPaint.width, oldPaint.height);

      const sx = sizeRef.current.width / oldWidth;
      const sy = sizeRef.current.height / oldHeight;
      for (const ball of ballsRef.current) {
        ball.x *= Number.isFinite(sx) ? sx : 1;
        ball.y *= Number.isFinite(sy) ? sy : 1;
        ball.baseR = clamp(Math.min(sizeRef.current.width, sizeRef.current.height) * 0.075, 38, 66);
        applyBallSize(ball, sizeMixRef.current, sizeVariabilityRef.current, minSizeRef.current, maxSizeRef.current, sizeRef.current.width, sizeRef.current.height);
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    if (!ballsRef.current.length) {
      const { width, height } = sizeRef.current;
      ballsRef.current = [makeBall(nextIdRef.current++, width, height), makeBall(nextIdRef.current++, width, height), makeBall(nextIdRef.current++, width, height)];
      applyCurrentSizes();
      syncCount();
    }

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const elapsed = Math.min(0.033, Math.max(0.001, (now - last) / 1000));
      last = now;
      const { width, height } = sizeRef.current;
      const dpr = canvas.width / width;

      if (!pausedRef.current) {
        const substeps = 2;
        const dt = elapsed / substeps;
        for (let step = 0; step < substeps; step++) {
          const damping = energyRef.current > 0.96 ? 1 : Math.pow(0.982 + energyRef.current * 0.0175, dt * 60);
          const exploded = new Set<number>();
          for (const ball of ballsRef.current) {
            if (ball.dragging) { updateSquash(ball, dt); continue; }
            if (energyRef.current > 0.9 && Math.hypot(ball.vx, ball.vy) < 95) {
              const speed = Math.hypot(ball.vx, ball.vy) || 1;
              ball.vx = (ball.vx / speed) * 95;
              ball.vy = (ball.vy / speed) * 95;
            }
            ball.vx *= damping;
            ball.vy *= damping;
            const dx = ball.vx * dt;
            const dy = ball.vy * dt;
            ball.x += dx;
            ball.y += dy;
            rollBall(ball, dx, dy);

            let hitSide: Side | null = null;
            if (ball.x - ball.r < RAIL) { ball.x = RAIL + ball.r; ball.vx = Math.abs(ball.vx) * 0.88; hitSide = "left"; kickSquash(ball, 1, 0, Math.abs(ball.vx)); }
            else if (ball.x + ball.r > width - RAIL) { ball.x = width - RAIL - ball.r; ball.vx = -Math.abs(ball.vx) * 0.88; hitSide = "right"; kickSquash(ball, 1, 0, Math.abs(ball.vx)); }
            if (ball.y - ball.r < RAIL) { ball.y = RAIL + ball.r; ball.vy = Math.abs(ball.vy) * 0.88; hitSide = "top"; kickSquash(ball, 0, 1, Math.abs(ball.vy)); }
            else if (ball.y + ball.r > height - RAIL) { ball.y = height - RAIL - ball.r; ball.vy = -Math.abs(ball.vy) * 0.88; hitSide = "bottom"; kickSquash(ball, 0, 1, Math.abs(ball.vy)); }

            if (hitSide) {
              const along = hitSide === "top" || hitSide === "bottom" ? ball.x : ball.y;
              if (spikesRef.current.some((spike) => spike.side === hitSide && Math.abs(spike.pos - along) < ball.r * 0.62 + 13)) exploded.add(ball.id);
            }
            updateSquash(ball, dt);
          }

          const balls = ballsRef.current;
          for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
              const a = balls[i];
              const b = balls[j];
              if (a.dragging && b.dragging) continue;
              let dx = b.x - a.x;
              let dy = b.y - a.y;
              let dist = Math.hypot(dx, dy);
              const minDist = a.r + b.r;
              if (dist >= minDist) continue;
              if (dist < 0.001) { dx = 1; dy = 0; dist = 1; }
              const nx = dx / dist;
              const ny = dy / dist;
              const overlap = minDist - dist;
              const moveA = b.dragging ? 1 : 0.5;
              const moveB = a.dragging ? 1 : 0.5;
              if (!a.dragging) { a.x -= nx * overlap * moveA; a.y -= ny * overlap * moveA; }
              if (!b.dragging) { b.x += nx * overlap * moveB; b.y += ny * overlap * moveB; }
              const rvx = b.vx - a.vx;
              const rvy = b.vy - a.vy;
              const normalSpeed = rvx * nx + rvy * ny;
              if (normalSpeed < 0) {
                const impulse = (-(1 + 0.94) * normalSpeed) / 2;
                if (!a.dragging) { a.vx -= impulse * nx; a.vy -= impulse * ny; }
                if (!b.dragging) { b.vx += impulse * nx; b.vy += impulse * ny; }
                kickSquash(a, nx, ny, Math.abs(normalSpeed));
                kickSquash(b, nx, ny, Math.abs(normalSpeed));
              }
            }
          }
          if (exploded.size) {
            for (const id of exploded) {
              const ball = ballsRef.current.find((item) => item.id === id);
              if (ball) explodeBall(ball);
            }
          }
        }

        for (const particle of particlesRef.current) {
          particle.life -= elapsed;
          particle.x += particle.vx * elapsed;
          particle.y += particle.vy * elapsed;
          particle.vx *= Math.pow(0.96, elapsed * 60);
          particle.vy = particle.vy * Math.pow(0.96, elapsed * 60) + 90 * elapsed;
        }
        particlesRef.current = particlesRef.current.filter((p) => p.life > 0);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const bg = ctx.createLinearGradient(0, 0, width, height);
      bg.addColorStop(0, "#fffaf0");
      bg.addColorStop(1, "#f1eadf");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.globalAlpha = 0.97;
      if (paintRef.current?.width) ctx.drawImage(paintRef.current, 0, 0, width, height);
      ctx.restore();

      ctx.fillStyle = "#3a3634";
      ctx.fillRect(0, 0, width, RAIL);
      ctx.fillRect(0, height - RAIL, width, RAIL);
      ctx.fillRect(0, 0, RAIL, height);
      ctx.fillRect(width - RAIL, 0, RAIL, height);
      ctx.strokeStyle = "rgba(255,255,255,.22)";
      ctx.lineWidth = 2;
      ctx.strokeRect(RAIL + 1, RAIL + 1, width - RAIL * 2 - 2, height - RAIL * 2 - 2);

      for (const spike of spikesRef.current) drawSpike(ctx, spike, width, height);

      const sortedBalls = [...ballsRef.current].sort((a, b) => a.y - b.y);
      for (const ball of sortedBalls) {
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = "#1b1730";
        ctx.beginPath();
        ctx.ellipse(ball.x + 7, ball.y + ball.r * 0.78, ball.r * 0.78, ball.r * 0.22, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
        drawBall(ctx, ball);
      }

      for (const p of particlesRef.current) {
        ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [applyCurrentSizes, explodeBall, syncCount]);

  const pointerPosition = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    ensureAudio();
    const { x, y } = pointerPosition(event);
    const { width, height } = sizeRef.current;
    const side = railSide(x, y, width, height);
    if (side) {
      const pos = side === "top" || side === "bottom" ? clamp(x, 42, width - 42) : clamp(y, 42, height - 42);
      const existing = spikesRef.current.findIndex((spike) => spike.side === side && Math.abs(spike.pos - pos) < 28);
      if (existing >= 0) spikesRef.current.splice(existing, 1);
      else spikesRef.current.push({ side, pos });
      setHint(existing >= 0 ? "Spike removed" : "Spike planted — aim a marble at it");
      return;
    }

    const ball = [...ballsRef.current].reverse().find((item) => Math.hypot(item.x - x, item.y - y) <= item.r * 1.08);
    if (!ball) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    ball.dragging = true;
    ball.vx = 0;
    ball.vy = 0;
    dragRef.current = { id: ball.id, lastX: x, lastY: y, lastTime: performance.now() };
    setHint("Release to fling");
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    const { x, y } = pointerPosition(event);
    const ball = ballsRef.current.find((item) => item.id === drag.id);
    if (!ball) return;
    const now = performance.now();
    const dt = Math.max(8, now - drag.lastTime) / 1000;
    const dx = x - drag.lastX;
    const dy = y - drag.lastY;
    const { width, height } = sizeRef.current;
    ball.x = clamp(ball.x + dx, RAIL + ball.r, width - RAIL - ball.r);
    ball.y = clamp(ball.y + dy, RAIL + ball.r, height - RAIL - ball.r);
    rollBall(ball, dx, dy);
    const maxSpeed = 1350;
    ball.vx = clamp(ball.vx * 0.38 + (dx / dt) * 0.62, -maxSpeed, maxSpeed);
    ball.vy = clamp(ball.vy * 0.38 + (dy / dt) * 0.62, -maxSpeed, maxSpeed);
    drag.lastX = x;
    drag.lastY = y;
    drag.lastTime = now;
  };

  const releasePointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const ball = ballsRef.current.find((item) => item.id === drag.id);
    if (ball) ball.dragging = false;
    dragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* pointer capture may already be gone */ }
    setHint("Tap a rail to plant another spike");
  };

  const togglePaused = () => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  };

  const toggleSound = () => {
    soundEnabledRef.current = !soundEnabledRef.current;
    setSoundEnabled(soundEnabledRef.current);
    if (soundEnabledRef.current) {
      ensureAudio();
      setHint("Popping sounds are on");
    } else {
      setHint("Popping sounds are off");
    }
  };

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div>
            <h1>Paint Pop</h1>
            <p>{hint}</p>
          </div>
        </div>

        <div className="score-card" aria-live="polite">
          <span className="score-label">SPLATS</span>
          <strong>{String(score).padStart(2, "0")}</strong>
        </div>

        <div className="controls" aria-label="Game controls">
          <button className="primary-control" onClick={addBall} aria-label="Add a paint marble">
            <span aria-hidden="true">＋</span> Marble <b>{count}</b>
          </button>
          <label className="motion-control">
            <span>Motion</span>
            <input
              aria-label="Motion level"
              type="range"
              min="0"
              max="100"
              value={energy}
              onChange={(event) => setEnergy(Number(event.target.value))}
            />
          </label>
          <label className="blast-range-control">
            <span>Blast</span>
            <input
              aria-label="Explosion blast power"
              type="range"
              min="0"
              max="100"
              value={blastPower}
              onChange={(event) => setBlastPower(Number(event.target.value))}
            />
            <output>{blastPower}</output>
          </label>
          <button
            className={`sound-control${soundEnabled ? " is-active" : ""}`}
            onClick={toggleSound}
            aria-pressed={soundEnabled}
            aria-label={soundEnabled ? "Mute popping sounds" : "Enable popping sounds"}
          >
            <span aria-hidden="true">♪</span> Sound
          </button>
          <div className="size-menu">
            <button
              className={`size-control${sizeMix ? " is-active" : ""}`}
              onClick={() => setSizePanelOpen((open) => !open)}
              aria-expanded={sizePanelOpen}
              aria-controls="size-mix-panel"
            >
              <span aria-hidden="true">◉</span> Sizes
            </button>
            {sizePanelOpen && (
              <div className="size-panel" id="size-mix-panel">
                <div className="size-panel-head">
                  <div><strong>Size Mix</strong><small>Changes every marble</small></div>
                  <label className="size-switch">
                    <input type="checkbox" checked={sizeMix} onChange={(event) => setSizeMix(event.target.checked)} />
                    <span aria-hidden="true" />
                    <b>{sizeMix ? "On" : "Off"}</b>
                  </label>
                </div>
                <label className="size-slider">
                  <span>Variability <output>{sizeVariability}%</output></span>
                  <input type="range" min="0" max="100" value={sizeVariability} disabled={!sizeMix} onChange={(event) => setSizeVariability(Number(event.target.value))} />
                </label>
                <label className="size-slider">
                  <span>Smallest <output>{minSize}%</output></span>
                  <input type="range" min="75" max="100" value={minSize} disabled={!sizeMix} onChange={(event) => setMinSize(Number(event.target.value))} />
                </label>
                <label className="size-slider">
                  <span>Largest <output>{(maxSize / 100).toFixed(1)}×</output></span>
                  <input type="range" min="100" max="300" step="10" value={maxSize} disabled={!sizeMix} onChange={(event) => setMaxSize(Number(event.target.value))} />
                </label>
                <p>At 0% variability, every marble returns to the standard size.</p>
              </div>
            )}
          </div>
          <button className="icon-control" onClick={togglePaused} aria-label={paused ? "Resume game" : "Pause game"}>{paused ? "▶" : "Ⅱ"}</button>
          <button className="text-control" onClick={clearPaint}>Wipe paint</button>
          <button className="text-control" onClick={resetGame}>Reset</button>
        </div>
      </header>

      <section className="board-wrap" aria-label="Paint Pop play area">
        <canvas
          ref={canvasRef}
          className="game-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
          aria-label="Interactive board. Drag marbles to throw them. Tap the dark rails to add or remove spikes."
        />
        <div className="board-note" aria-hidden="true">TAP RAILS · DRAG MARBLES · MAKE A MESS</div>
      </section>
    </main>
  );
}
