import * as THREE from 'three';
import { BLOCK_COS, resolveHit, type DefenderSnapshot, type HitResolution, type IncomingHit } from '../combat/damage';
import { attackDuration, type AttackDef } from '../combat/types';
import { clamp01, easeOutQuad, forwardFromYaw, rotateTowards, yawFromDir, type Vec2 } from '../core/math';
import { Animator } from '../render/Animator';
import { Humanoid, type HumanoidLook, type JointName } from '../render/Humanoid';
import {
  attackPose,
  collapsePose,
  deathPose,
  drinkPose,
  fallPose,
  KNEEL_POSE,
  locomotionPose,
  overlayPose,
  REST_POSE,
  roarPose,
  rollPose,
  staggerPose,
  type Pose,
} from '../render/poses';
import { WeaponTrail } from '../render/WeaponTrail';
import type { WorldContext } from './context';

export type Team = 'player' | 'enemy';

export type ScriptedAnim = 'rest' | 'rise' | 'walk' | 'roar' | 'kneel' | 'interact';

export interface AttackAction {
  kind: 'attack';
  def: AttackDef;
  t: number;
  /** Actors already hit by this swing. */
  hits: Set<number>;
  /** Player pressed attack again: chain into `def.next`. */
  queued: boolean;
  /** Portion of the lunge to use, decided when the lunge begins. */
  lungeScale: number;
  /** If set, this attack can only hit this actor (backstabs). */
  only?: Actor;
}

/** What an actor is doing right now. Locomotion happens in 'free'. */
export type Action =
  | { kind: 'free' }
  | AttackAction
  | { kind: 'roll'; t: number; dirX: number; dirZ: number }
  | { kind: 'stagger'; t: number; duration: number; heavy: boolean }
  | { kind: 'drink'; t: number; healed: boolean }
  | { kind: 'backstabbed'; t: number; duration: number }
  | { kind: 'fall'; t: number; vy: number }
  | { kind: 'dead'; t: number }
  | {
      kind: 'scripted';
      t: number;
      duration: number;
      anim: ScriptedAnim;
      /** Metres per second to walk while scripted (e.g. through fog). */
      walk?: Vec2;
      onDone?: () => void;
    };

export interface ActorConfig {
  name: string;
  team: Team;
  look: HumanoidLook;
  radius: number;
  mass: number;
  maxHp: number;
  maxStamina: number;
  maxPoise: number;
  poiseResetDelay: number;
  blockStaminaFactor: number;
  /** Speed at which the walk cycle matches foot contact, used to derive gait. */
  walkSpeed: number;
  trailColor: number;
}

/** Where an attack's hitbox is, in world space. */
export interface HitboxWorld {
  kind: 'arc' | 'circle';
  x: number;
  z: number;
  range: number;
  halfAngle: number;
  facing: number;
}

/**
 * Shared behaviour for anything that fights: resources, the action state
 * machine, attacks with lunges, taking hits, knockback and animation.
 */
export abstract class Actor {
  private static nextId = 1;
  readonly id = Actor.nextId++;
  readonly name: string;
  readonly team: Team;
  readonly position = new THREE.Vector3();
  facing = 0;

  readonly radius: number;
  readonly mass: number;
  maxHp: number;
  hp: number;
  maxStamina: number;
  stamina: number;
  readonly maxPoise: number;
  poise: number;
  protected readonly blockStaminaFactor: number;

  action: Action = { kind: 'free' };
  /** Time of the last hit taken, for floating health bars. */
  lastDamagedAt = -Infinity;
  /** Damage accumulated recently, shown as a number over the health bar. */
  recentDamage = 0;

  readonly rig: Humanoid;
  readonly trail: WeaponTrail;
  protected readonly animator: Animator;

  protected staminaDelay = 0;
  protected poiseTimer = 0;
  protected readonly impulse = { x: 0, z: 0 };
  private readonly poiseResetDelay: number;
  private readonly walkSpeed: number;
  private readonly lastPos = new THREE.Vector3();
  protected groundSpeed = 0;
  private stridePhase = 0;
  private gait = 0;

  protected constructor(config: ActorConfig) {
    this.name = config.name;
    this.team = config.team;
    this.radius = config.radius;
    this.mass = config.mass;
    this.maxHp = this.hp = config.maxHp;
    this.maxStamina = this.stamina = config.maxStamina;
    this.maxPoise = this.poise = config.maxPoise;
    this.poiseResetDelay = config.poiseResetDelay;
    this.blockStaminaFactor = config.blockStaminaFactor;
    this.walkSpeed = config.walkSpeed;
    this.rig = new Humanoid(config.look);
    this.animator = new Animator(this.rig);
    this.trail = new WeaponTrail(this.rig.weaponBase, this.rig.weaponTip, config.trailColor);
  }

  get alive(): boolean {
    return this.action.kind !== 'dead' && this.action.kind !== 'fall';
  }

  get forward(): Vec2 {
    return forwardFromYaw(this.facing);
  }

  /** Height of the chest, for lock-on markers and effects. */
  get chestHeight(): number {
    return 1.25 * this.rig.look.scale;
  }

  get currentAttack(): AttackAction | null {
    return this.action.kind === 'attack' ? this.action : null;
  }

  isInvulnerable(): boolean {
    return this.action.kind === 'dead' || this.action.kind === 'fall';
  }

  isBlocking(): boolean {
    return false;
  }

  /** Can this actor be backstabbed right now? */
  canBeBackstabbed(): boolean {
    return false;
  }

  /** Scales the damage of this actor's attacks (Strength for the player, NG+ for enemies). */
  outgoingDamageMultiplier(): number {
    return 1;
  }

  abstract update(dt: number, ctx: WorldContext): void;

  // --- Hits -----------------------------------------------------------------

  /** World-space hitbox of the current attack, if it is in its active window. */
  activeHitbox(): HitboxWorld | null {
    const a = this.currentAttack;
    if (!a) return null;
    const { def } = a;
    if (a.t < def.windup || a.t >= def.windup + def.active) return null;
    // Hitboxes are authored in world metres, independent of model scale.
    if (def.hitbox.kind === 'arc') {
      return { kind: 'arc', x: this.position.x, z: this.position.z, range: def.hitbox.range, halfAngle: def.hitbox.halfAngle, facing: this.facing };
    }
    const f = this.forward;
    return {
      kind: 'circle',
      x: this.position.x + f.x * def.hitbox.offset,
      z: this.position.z + f.z * def.hitbox.offset,
      range: def.hitbox.radius,
      halfAngle: Math.PI,
      facing: this.facing,
    };
  }

  defenseSnapshot(from: Vec2): DefenderSnapshot {
    const dx = from.x - this.position.x;
    const dz = from.z - this.position.z;
    const len = Math.hypot(dx, dz) || 1;
    const f = this.forward;
    return {
      hp: this.hp,
      stamina: this.stamina,
      poise: this.poise,
      invulnerable: this.isInvulnerable(),
      blocking: this.isBlocking(),
      facingDot: (f.x * dx + f.z * dz) / len,
      hyperArmor: this.hasHyperArmor(),
      blockStaminaFactor: this.blockStaminaFactor,
    };
  }

  /** True if an attack from `from` would land on this actor's raised shield. */
  wouldBlock(from: Vec2): boolean {
    return this.isBlocking() && this.defenseSnapshot(from).facingDot >= BLOCK_COS;
  }

  protected hasHyperArmor(): boolean {
    const a = this.currentAttack;
    return !!a?.def.hyperArmor && a.t < a.def.windup + a.def.active + 0.1;
  }

  /** Resolves and applies an incoming hit. Returns the resolution for effects. */
  takeHit(hit: IncomingHit, from: Vec2, knockback: number, time: number, ctx: WorldContext): HitResolution {
    const result = resolveHit(this.defenseSnapshot(from), hit);
    if (result.outcome === 'dodged') return result;

    this.stamina = Math.max(0, this.stamina - result.staminaDamage);
    if (result.staminaDamage > 0) this.staminaDelay = 0.8;
    if (result.hpDamage > 0) {
      this.hp = Math.max(0, this.hp - result.hpDamage);
      this.recentDamage = time - this.lastDamagedAt < 2.5 ? this.recentDamage + result.hpDamage : result.hpDamage;
      this.lastDamagedAt = time;
    }
    if (result.poiseDamage > 0) {
      this.poise -= result.poiseDamage;
      this.poiseTimer = this.poiseResetDelay;
    }

    const away = { x: this.position.x - from.x, z: this.position.z - from.z };
    const len = Math.hypot(away.x, away.z) || 1;
    const push = (result.outcome === 'blocked' ? knockback * 0.4 : knockback) / this.mass;
    this.impulse.x += (away.x / len) * push * 3;
    this.impulse.z += (away.z / len) * push * 3;

    if (result.outcome === 'killed') {
      this.die(ctx);
    } else if (result.outcome === 'guardBreak') {
      this.stagger(1.1, true);
    } else if (result.staggered && this.action.kind !== 'backstabbed') {
      this.poise = this.maxPoise;
      this.stagger(hit.poiseDamage >= 50 ? 0.9 : 0.45, hit.poiseDamage >= 50);
    }
    this.onHitTaken(result, ctx);
    return result;
  }

  /** Adds a shove, in metres per second, that decays over a fraction of a second. */
  push(vx: number, vz: number): void {
    this.impulse.x += vx;
    this.impulse.z += vz;
  }

  /** Called on the attacker when its light attack bounces off a shield. */
  recoil(): void {
    if (this.alive) this.stagger(0.5, false);
  }

  protected onHitTaken(_result: HitResolution, _ctx: WorldContext): void {}

  stagger(duration: number, heavy: boolean): void {
    if (!this.alive) return;
    this.action = { kind: 'stagger', t: 0, duration, heavy };
  }

  die(_ctx: WorldContext): void {
    this.hp = 0;
    this.action = { kind: 'dead', t: 0 };
  }

  // --- Movement ---------------------------------------------------------------

  /** Whether this actor refuses to step onto a spot (enemies won't walk off ledges). */
  protected canStandAt(_x: number, _z: number, _ctx: WorldContext): boolean {
    return true;
  }

  move(dx: number, dz: number, ctx: WorldContext): void {
    if (dx === 0 && dz === 0) return;
    const p = { x: this.position.x + dx, z: this.position.z + dz };
    ctx.collision.resolve(p, this.radius);
    if (!this.canStandAt(p.x, p.z, ctx)) {
      // Try sliding along one axis before giving up.
      const px = { x: this.position.x + dx, z: this.position.z };
      const pz = { x: this.position.x, z: this.position.z + dz };
      ctx.collision.resolve(px, this.radius);
      ctx.collision.resolve(pz, this.radius);
      if (this.canStandAt(px.x, px.z, ctx)) Object.assign(p, px);
      else if (this.canStandAt(pz.x, pz.z, ctx)) Object.assign(p, pz);
      else return;
    }
    this.position.x = p.x;
    this.position.z = p.z;
  }

  turnTowards(yaw: number, rate: number, dt: number): void {
    this.facing = rotateTowards(this.facing, yaw, rate * dt);
  }

  yawTo(target: Vec2): number {
    return yawFromDir(target.x - this.position.x, target.z - this.position.z);
  }

  distanceTo(target: Vec2): number {
    return Math.hypot(target.x - this.position.x, target.z - this.position.z);
  }

  // --- Shared per-frame logic ---------------------------------------------------

  protected updateResources(dt: number, regenRate: number): void {
    if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else this.stamina = Math.min(this.maxStamina, this.stamina + regenRate * dt);
    if (this.poiseTimer > 0) {
      this.poiseTimer -= dt;
      if (this.poiseTimer <= 0) this.poise = this.maxPoise;
    }
  }

  protected applyImpulse(dt: number, ctx: WorldContext): void {
    if (Math.abs(this.impulse.x) + Math.abs(this.impulse.z) < 0.01) return;
    this.move(this.impulse.x * dt, this.impulse.z * dt, ctx);
    const decay = Math.exp(-9 * dt);
    this.impulse.x *= decay;
    this.impulse.z *= decay;
  }

  protected startAttack(def: AttackDef, only?: Actor): void {
    this.action = { kind: 'attack', def, t: 0, hits: new Set(), queued: false, lungeScale: 1, only };
    this.stamina = Math.max(0, this.stamina - def.staminaCost);
    this.staminaDelay = 0.6;
  }

  /**
   * Advances an attack: tracking during windup, lunge, leap arc and
   * shockwaves. Returns true once the attack has fully finished.
   */
  protected advanceAttack(a: AttackAction, dt: number, ctx: WorldContext, target: Vec2 | null, desiredRange: number): boolean {
    const def = a.def;
    const prevT = a.t;
    a.t += dt;

    if (a.t < def.windup && target) {
      this.turnTowards(this.yawTo(target), def.tracking, dt);
    }

    const lungeStart = def.leapHeight ? def.windup * 0.35 : def.windup * 0.6;
    const lungeEnd = def.windup + def.active;
    if (prevT < lungeStart && a.t >= lungeStart && target) {
      // Don't lunge straight through whoever we're swinging at.
      const dist = this.distanceTo(target);
      a.lungeScale = def.lunge > 0 ? clamp01((dist - desiredRange) / def.lunge) : 0;
    }
    const frac = (t: number) => easeOutQuad(clamp01((t - lungeStart) / (lungeEnd - lungeStart)));
    const step = def.lunge * a.lungeScale * (frac(a.t) - frac(prevT));
    if (step > 0) {
      const f = this.forward;
      this.move(f.x * step, f.z * step, ctx);
    }

    if (def.leapHeight) {
      const u = clamp01((a.t - lungeStart) / (lungeEnd - lungeStart));
      this.position.y = Math.sin(Math.PI * u) * def.leapHeight;
    }

    if (prevT < def.windup && a.t >= def.windup) this.onAttackActive(a, ctx);
    return a.t >= attackDuration(def);
  }

  protected onAttackActive(a: AttackAction, ctx: WorldContext): void {
    const def = a.def;
    ctx.fx.sound(def.sound === 'slam' ? 'swingSlam' : def.sound === 'heavy' ? 'swingHeavy' : def.sound === 'bash' ? 'bash' : 'swingLight', this.position);
    if (def.sound === 'slam') {
      this.position.y = 0;
      const f = this.forward;
      const at = new THREE.Vector3(this.position.x + f.x * 2.6, 0.1, this.position.z + f.z * 2.6);
      ctx.fx.sound('slamImpact', at);
      ctx.fx.dust(at, 18);
      ctx.fx.shake(0.55);
      if (def.shockwave) {
        ctx.spawnShockwave(this, at.x, at.z, def.shockwave);
        ctx.fx.embers(at, 50, 2);
      }
    }
  }

  // --- Rendering ------------------------------------------------------------------

  /** Measures how far we moved this frame to drive the walk cycle. Call after moving. */
  protected trackGait(dt: number): void {
    const moved = Math.hypot(this.position.x - this.lastPos.x, this.position.z - this.lastPos.z);
    this.lastPos.copy(this.position);
    const speed = dt > 0 ? Math.min(moved / dt, 12) : 0;
    this.groundSpeed = speed;
    const locomoting = this.action.kind === 'free' || this.action.kind === 'drink' || (this.action.kind === 'scripted' && this.action.anim === 'walk');
    const targetGait = locomoting ? (speed < 0.2 ? 0 : speed <= this.walkSpeed ? speed / this.walkSpeed : 1 + (speed - this.walkSpeed) / this.walkSpeed) : 0;
    this.gait += (targetGait - this.gait) * Math.min(1, dt * 10);
    const stride = 0.85 * this.rig.look.scale;
    const before = this.stridePhase;
    this.stridePhase += (speed * dt * Math.PI) / stride;
    if (locomoting && speed > 0.5 && Math.floor(before / Math.PI) !== Math.floor(this.stridePhase / Math.PI)) {
      this.onFootstep();
    }
  }

  protected onFootstep(): void {}

  protected buildPose(time: number): { pose: Pose; rate: number; snap?: readonly JointName[] } {
    const loco = locomotionPose({ phase: this.stridePhase, gait: this.gait, time, blocking: this.isBlocking() });
    const a = this.action;
    switch (a.kind) {
      case 'free':
        return { pose: loco, rate: 14 };
      case 'attack': {
        const { pose, weight } = attackPose(a.def, a.t);
        return { pose: overlayPose(loco, pose, weight), rate: 30 };
      }
      case 'roll':
        return { pose: overlayPose(loco, rollPose(a.t / this.rollDuration()), 1), rate: 30, snap: ['body'] };
      case 'stagger':
        return { pose: overlayPose(loco, staggerPose(a.t / a.duration, a.heavy), 1), rate: 22 };
      case 'drink':
        return { pose: overlayPose(loco, drinkPose(a.t / this.drinkDuration()), 1), rate: 16 };
      case 'backstabbed':
        return { pose: collapsePose(a.t / 0.5, (a.t - (a.duration - 0.9)) / 0.9), rate: 14 };
      case 'fall':
        return { pose: fallPose(time), rate: 10 };
      case 'dead':
        return { pose: deathPose(a.t / 0.75), rate: 14 };
      case 'scripted':
        switch (a.anim) {
          case 'rest':
            return { pose: REST_POSE, rate: 5 };
          case 'rise':
            return { pose: overlayPose(loco, REST_POSE, 1 - clamp01(a.t / a.duration)), rate: 8 };
          case 'kneel':
          case 'interact':
            return { pose: overlayPose(loco, KNEEL_POSE, Math.sin(Math.PI * clamp01(a.t / a.duration))), rate: 8 };
          case 'roar':
            return { pose: overlayPose(loco, roarPose(a.t / a.duration, time), 1), rate: 14 };
          case 'walk':
            return { pose: loco, rate: 12 };
        }
    }
  }

  protected rollDuration(): number {
    return 0.6;
  }

  protected drinkDuration(): number {
    return 1;
  }

  /** Copies simulation state onto the rig and animates it. */
  protected syncRig(dt: number, time: number): void {
    this.rig.root.position.copy(this.position);
    this.rig.root.rotation.y = this.facing;
    const { pose, rate, snap } = this.buildPose(time);
    this.animator.apply(pose, dt, { rate, snap, speed: this.groundSpeed });
    const a = this.currentAttack;
    const emitting = !!a && a.t > a.def.windup - 0.04 && a.t < a.def.windup + a.def.active + 0.05;
    this.trail.update(dt, emitting);
  }

  addTo(scene: THREE.Object3D): void {
    scene.add(this.rig.root, this.trail.mesh);
  }

  dispose(): void {
    this.rig.dispose();
    this.trail.dispose();
  }
}
