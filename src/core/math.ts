/** Small, dependency-free math helpers used across simulation and rendering. */

export const TAU = Math.PI * 2;

/** A point or direction on the ground plane. Y is always "up" in this game. */
export interface Vec2 {
  x: number;
  z: number;
}

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const clamp01 = (v: number): number => clamp(v, 0, 1);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const inverseLerp = (a: number, b: number, v: number): number =>
  a === b ? 0 : clamp01((v - a) / (b - a));

/** Frame-rate independent exponential smoothing towards a target. */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Wraps an angle to the range [-PI, PI). */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed difference from one angle to another. */
export const angleDiff = (from: number, to: number): number => wrapAngle(to - from);

export const dampAngle = (current: number, target: number, lambda: number, dt: number): number =>
  current + angleDiff(current, target) * (1 - Math.exp(-lambda * dt));

/** Rotates `current` towards `target` by at most `maxDelta` radians. */
export function rotateTowards(current: number, target: number, maxDelta: number): number {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxDelta) return wrapAngle(target);
  return wrapAngle(current + Math.sign(d) * maxDelta);
}

/**
 * Yaw convention: yaw 0 faces +Z, and the forward vector is (sin(yaw), cos(yaw)).
 * This matches how models are authored (facing +Z).
 */
export const yawFromDir = (x: number, z: number): number => Math.atan2(x, z);

export const forwardFromYaw = (yaw: number): Vec2 => ({ x: Math.sin(yaw), z: Math.cos(yaw) });

/** Right-hand vector for a yaw (forward x up). */
export const rightFromYaw = (yaw: number): Vec2 => ({ x: -Math.cos(yaw), z: Math.sin(yaw) });

export const distXZ = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number): number => t * t * t;
export const easeInQuad = (t: number): number => t * t;
export const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);

/** Deterministic PRNG so procedural decoration looks the same every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randRange = (rng: () => number, min: number, max: number): number =>
  min + (max - min) * rng();

/** Picks an item from a list using per-item weights. Returns undefined for an empty list. */
export function weightedPick<T>(items: readonly T[], weight: (item: T) => number, rng: () => number = Math.random): T | undefined {
  let total = 0;
  for (const item of items) total += Math.max(0, weight(item));
  if (total <= 0) return undefined;
  let roll = rng() * total;
  for (const item of items) {
    roll -= Math.max(0, weight(item));
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}
