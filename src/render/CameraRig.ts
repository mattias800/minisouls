import * as THREE from 'three';
import { angleDiff, clamp, damp, dampAngle, forwardFromYaw, type Vec2, yawFromDir } from '../core/math';
import type { Actor } from '../entities/Actor';
import type { Input } from '../input/Input';

const MOUSE_SENSITIVITY = 0.0026;
const STICK_SPEED = 2.8;
const MIN_PITCH = -0.3;
const MAX_PITCH = 1.1;
const LOCK_RANGE = 17;
const LOCK_BREAK_RANGE = 24;
const SWITCH_THRESHOLD = 110;

/** Third-person orbit camera with lock-on, wall avoidance and screen shake. */
export class CameraRig {
  yaw = 0;
  pitch = 0.3;
  lockTarget: Actor | null = null;

  private readonly pivot = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private distance = 4.6;
  private currentDist = 4.6;
  private trauma = 0;
  private switchAccum = 0;
  private stickSwitchReady = true;
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmp = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private time = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly blockers: THREE.Object3D[],
  ) {}

  /** Planar forward direction of the camera, for camera-relative movement. */
  get forward(): Vec2 {
    return forwardFromYaw(this.yaw);
  }

  get focus(): THREE.Vector3 {
    return this.pivot;
  }

  /** Instantly place the camera behind a point, e.g. on respawn. */
  snap(position: THREE.Vector3, yaw: number): void {
    this.yaw = yaw;
    this.pitch = 0.3;
    this.pivot.set(position.x, position.y + 1.45, position.z);
    this.lockTarget = null;
    this.currentDist = this.distance;
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  toggleLock(player: Actor, candidates: readonly Actor[]): void {
    if (this.lockTarget) {
      this.lockTarget = null;
      return;
    }
    this.lockTarget = this.bestTarget(player, candidates, null, 0);
    if (!this.lockTarget) {
      // No one to lock on to: recentre behind the player instead.
      this.yaw = player.facing;
    }
  }

  update(dt: number, player: Actor, input: Input | null, candidates: readonly Actor[]): void {
    this.time += dt;
    const target = this.lockTarget;
    if (target && (!target.alive || target.distanceTo(player.position) > LOCK_BREAK_RANGE || !player.alive)) {
      this.lockTarget = null;
    }

    const py = Math.max(player.position.y, -4);
    this.pivot.x = damp(this.pivot.x, player.position.x, 14, dt);
    this.pivot.z = damp(this.pivot.z, player.position.z, 14, dt);
    this.pivot.y = damp(this.pivot.y, py + 1.45, 8, dt);

    const lock = this.lockTarget;
    if (lock) {
      const desired = yawFromDir(lock.position.x - player.position.x, lock.position.z - player.position.z);
      this.yaw = dampAngle(this.yaw, desired, 8, dt);
      const big = lock.rig.look.scale > 1.5;
      this.pitch = damp(this.pitch, big ? 0.34 : 0.24, 4, dt);
      if (input) this.handleTargetSwitch(input, player, candidates);
    } else if (input) {
      this.yaw -= input.lookX * MOUSE_SENSITIVITY + input.stickLookX * STICK_SPEED * dt;
      this.pitch += input.lookY * MOUSE_SENSITIVITY * 0.8 + input.stickLookY * STICK_SPEED * 0.7 * dt;
      this.pitch = clamp(this.pitch, MIN_PITCH, MAX_PITCH);
    }

    // Orbit offset, pulled in when a wall is in the way.
    const cp = Math.cos(this.pitch);
    this.dir.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).normalize();
    const wanted = lock && lock.rig.look.scale > 1.5 ? this.distance + 1.2 : this.distance;
    this.raycaster.set(this.pivot, this.dir);
    this.raycaster.far = wanted;
    const hit = this.raycaster.intersectObjects(this.blockers.filter((o) => o.visible), false)[0];
    const allowed = hit ? Math.max(0.8, hit.distance - 0.3) : wanted;
    this.currentDist = allowed < this.currentDist ? allowed : damp(this.currentDist, allowed, 3, dt);

    this.camera.position.copy(this.pivot).addScaledVector(this.dir, this.currentDist);
    if (this.camera.position.y < 0.3 && player.position.y > -0.5) this.camera.position.y = 0.3;

    if (lock) {
      this.tmp.set(lock.position.x, lock.position.y + lock.chestHeight * 0.8, lock.position.z);
      this.lookAt.copy(this.pivot).lerp(this.tmp, 0.35);
    } else {
      this.lookAt.copy(this.pivot);
    }

    // Trauma-based shake: squared for a punchy falloff.
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const s = this.trauma * this.trauma * 0.3;
    if (s > 0) {
      const t = this.time * 40;
      this.camera.position.x += Math.sin(t * 1.1) * s;
      this.camera.position.y += Math.sin(t * 1.7 + 1) * s;
      this.camera.position.z += Math.sin(t * 1.3 + 2) * s;
    }
    this.camera.lookAt(this.lookAt);
  }

  private handleTargetSwitch(input: Input, player: Actor, candidates: readonly Actor[]): void {
    this.switchAccum += input.lookX;
    this.switchAccum *= 0.9;
    let side = 0;
    if (Math.abs(this.switchAccum) > SWITCH_THRESHOLD) {
      side = Math.sign(this.switchAccum);
      this.switchAccum = 0;
    }
    if (Math.abs(input.stickLookX) > 0.75) {
      if (this.stickSwitchReady) side = Math.sign(input.stickLookX);
      this.stickSwitchReady = false;
    } else if (Math.abs(input.stickLookX) < 0.3) {
      this.stickSwitchReady = true;
    }
    if (side !== 0) {
      const next = this.bestTarget(player, candidates, this.lockTarget, side);
      if (next) this.lockTarget = next;
    }
  }

  /**
   * Picks a lock-on target. With `side` = 0 prefers whatever is closest to the
   * centre of view; with ±1 picks the nearest one to the right/left of `current`.
   */
  private bestTarget(player: Actor, candidates: readonly Actor[], current: Actor | null, side: number): Actor | null {
    let best: Actor | null = null;
    let bestScore = Infinity;
    const refYaw = current ? player.yawTo(current.position) : this.yaw;
    for (const c of candidates) {
      if (!c.alive || c === current) continue;
      const dist = c.distanceTo(player.position);
      if (dist > LOCK_RANGE) continue;
      const rel = angleDiff(refYaw, player.yawTo(c.position));
      if (side !== 0) {
        // Negative yaw delta is to the right with our conventions.
        if (Math.sign(-rel) !== side) continue;
        const score = Math.abs(rel);
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
        continue;
      }
      if (Math.abs(rel) > 1.3 && dist > 4) continue;
      const score = dist + Math.abs(rel) * 8;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }
}
