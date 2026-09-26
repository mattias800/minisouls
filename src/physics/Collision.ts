import { clamp, type Vec2 } from '../core/math';

/**
 * The game is 3D to look at but 2D to collide in: every actor is a circle on the
 * XZ ground plane. Static geometry is made of axis-aligned boxes and circles,
 * and the walkable floor is a union of "ground zones". Anything outside the
 * ground zones is a bottomless pit.
 */

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Disabled boxes (an opened gate, a dissolved fog wall) are ignored. */
  enabled: boolean;
}

export interface CircleCollider {
  x: number;
  z: number;
  r: number;
}

export type GroundZone =
  | { kind: 'rect'; minX: number; maxX: number; minZ: number; maxZ: number }
  | { kind: 'circle'; x: number; z: number; r: number };

const EPSILON = 1e-9;

export class CollisionWorld {
  readonly boxes: Box[] = [];
  readonly circles: CircleCollider[] = [];
  readonly ground: GroundZone[] = [];

  addBox(minX: number, maxX: number, minZ: number, maxZ: number): Box {
    const box: Box = {
      minX: Math.min(minX, maxX),
      maxX: Math.max(minX, maxX),
      minZ: Math.min(minZ, maxZ),
      maxZ: Math.max(minZ, maxZ),
      enabled: true,
    };
    this.boxes.push(box);
    return box;
  }

  addCircle(x: number, z: number, r: number): CircleCollider {
    const c = { x, z, r };
    this.circles.push(c);
    return c;
  }

  addGroundRect(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.ground.push({ kind: 'rect', minX, maxX, minZ, maxZ });
  }

  addGroundCircle(x: number, z: number, r: number): void {
    this.ground.push({ kind: 'circle', x, z, r });
  }

  /**
   * Pushes a circle of `radius` at `p` out of all static colliders. Mutates `p`.
   * Returns true if any correction was applied.
   */
  resolve(p: Vec2, radius: number): boolean {
    let corrected = false;
    for (let iteration = 0; iteration < 3; iteration++) {
      let moved = false;
      for (const box of this.boxes) {
        if (box.enabled && pushOutOfBox(p, radius, box)) moved = true;
      }
      for (const c of this.circles) {
        if (pushOutOfCircle(p, radius, c)) moved = true;
      }
      if (!moved) break;
      corrected = true;
    }
    return corrected;
  }

  /** True if the point is at least `margin` inside some ground zone. */
  isOnGround(x: number, z: number, margin = 0): boolean {
    for (const zone of this.ground) {
      if (zone.kind === 'rect') {
        if (x >= zone.minX + margin && x <= zone.maxX - margin && z >= zone.minZ + margin && z <= zone.maxZ - margin) {
          return true;
        }
      } else {
        const dx = x - zone.x;
        const dz = z - zone.z;
        const r = zone.r - margin;
        if (r > 0 && dx * dx + dz * dz <= r * r) return true;
      }
    }
    return false;
  }

  /** True if the straight segment a→b passes through any enabled box (used for line of sight). */
  segmentBlocked(a: Vec2, b: Vec2): boolean {
    for (const box of this.boxes) {
      if (box.enabled && segmentIntersectsBox(a, b, box)) return true;
    }
    return false;
  }
}

function pushOutOfBox(p: Vec2, radius: number, box: Box): boolean {
  const cx = clamp(p.x, box.minX, box.maxX);
  const cz = clamp(p.z, box.minZ, box.maxZ);
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return false;

  if (d2 > EPSILON) {
    const d = Math.sqrt(d2);
    const push = radius - d;
    p.x += (dx / d) * push;
    p.z += (dz / d) * push;
    return true;
  }

  // Centre is inside the box: leave along the axis of least penetration.
  const left = p.x - box.minX;
  const right = box.maxX - p.x;
  const back = p.z - box.minZ;
  const front = box.maxZ - p.z;
  const min = Math.min(left, right, back, front);
  if (min === left) p.x = box.minX - radius;
  else if (min === right) p.x = box.maxX + radius;
  else if (min === back) p.z = box.minZ - radius;
  else p.z = box.maxZ + radius;
  return true;
}

function pushOutOfCircle(p: Vec2, radius: number, c: CircleCollider): boolean {
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const min = radius + c.r;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return false;
  const d = Math.sqrt(d2);
  if (d < EPSILON) {
    p.x = c.x + min;
    return true;
  }
  const push = min - d;
  p.x += (dx / d) * push;
  p.z += (dz / d) * push;
  return true;
}

/** Slab test for a segment against an AABB on the XZ plane. */
export function segmentIntersectsBox(a: Vec2, b: Vec2, box: Box): boolean {
  let tMin = 0;
  let tMax = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;

  const axes: Array<[number, number, number, number]> = [
    [a.x, dx, box.minX, box.maxX],
    [a.z, dz, box.minZ, box.maxZ],
  ];
  for (const [origin, delta, min, max] of axes) {
    if (Math.abs(delta) < EPSILON) {
      if (origin < min || origin > max) return false;
      continue;
    }
    let t1 = (min - origin) / delta;
    let t2 = (max - origin) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return true;
}
