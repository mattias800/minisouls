import * as THREE from 'three';
import { getAttack } from '../combat/attacks';
import type { HitResolution } from '../combat/damage';
import type { AttackDef } from '../combat/types';
import { angleDiff, randRange, weightedPick, type Vec2 } from '../core/math';
import type { HumanoidLook } from '../render/Humanoid';
import { Actor, type AttackAction } from './Actor';
import type { WorldContext } from './context';

export interface EnemyAttackOption {
  attack: AttackDef;
  minRange: number;
  maxRange: number;
  weight: number;
  /** Only used from this boss phase onwards. */
  minPhase?: number;
}

export interface EnemyProfile {
  name: string;
  look: HumanoidLook;
  maxHp: number;
  maxPoise: number;
  souls: number;
  radius: number;
  mass: number;
  walkSpeed: number;
  runSpeed: number;
  turnRate: number;
  aggroRange: number;
  leash: number;
  /** Distance the enemy likes to keep while waiting for its next attack. */
  holdRange: number;
  attacks: readonly EnemyAttackOption[];
  cooldown: readonly [number, number];
  /** Chance to follow an attack with its `next` combo attack. */
  chainChance: number;
  blocks: boolean;
  maxStamina: number;
  blockStaminaFactor: number;
  backstabbable: boolean;
  trailColor: number;
}

type Brain = 'idle' | 'chase' | 'return';

/** A melee enemy with a simple aggro/chase/strafe/attack/leash brain. */
export class Enemy extends Actor {
  readonly profile: EnemyProfile;
  readonly home: Vec2;
  readonly homeFacing: number;
  protected brain: Brain = 'idle';
  protected cooldown = 0;
  protected phase = 1;
  private strafeDir = 1;
  private strafeTimer = 0;
  private shieldUp = false;
  private difficulty = 1;
  private readonly baseMaxHp: number;

  constructor(profile: EnemyProfile, home: Vec2, homeFacing: number) {
    super({
      name: profile.name,
      team: 'enemy',
      look: profile.look,
      radius: profile.radius,
      mass: profile.mass,
      maxHp: profile.maxHp,
      maxStamina: profile.maxStamina,
      maxPoise: profile.maxPoise,
      poiseResetDelay: 3,
      blockStaminaFactor: profile.blockStaminaFactor,
      walkSpeed: profile.walkSpeed,
      trailColor: profile.trailColor,
    });
    this.profile = profile;
    this.home = { ...home };
    this.homeFacing = homeFacing;
    this.baseMaxHp = profile.maxHp;
    this.reset();
  }

  get isBoss(): boolean {
    return false;
  }

  get isAggressive(): boolean {
    return this.brain === 'chase';
  }

  /** Scales health and damage for New Game+. */
  setDifficulty(multiplier: number): void {
    this.difficulty = multiplier;
    this.maxHp = Math.round(this.baseMaxHp * multiplier);
    this.hp = this.maxHp;
  }

  override outgoingDamageMultiplier(): number {
    return this.difficulty;
  }

  /** Back to the starting post, fully healed. Called when the player rests or dies. */
  reset(): void {
    this.position.set(this.home.x, 0, this.home.z);
    this.facing = this.homeFacing;
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.poise = this.maxPoise;
    this.action = { kind: 'free' };
    this.brain = 'idle';
    this.cooldown = randRange(Math.random, 0.3, 1);
    this.impulse.x = this.impulse.z = 0;
    this.lastDamagedAt = -Infinity;
    this.rig.root.visible = true;
    this.rig.setOpacity(1);
  }

  /** Fully faded out after death. */
  get gone(): boolean {
    return this.action.kind === 'dead' && !this.rig.root.visible;
  }

  override isBlocking(): boolean {
    return this.profile.blocks && this.shieldUp && this.action.kind === 'free' && this.brain === 'chase' && this.stamina > 0;
  }

  override canBeBackstabbed(): boolean {
    return this.profile.backstabbable && (this.action.kind === 'free' || this.action.kind === 'stagger');
  }

  protected override canStandAt(x: number, z: number, ctx: WorldContext): boolean {
    return ctx.collision.isOnGround(x, z, this.radius * 0.6);
  }

  protected override onHitTaken(result: HitResolution, ctx: WorldContext): void {
    // Getting hit from out of nowhere wakes an enemy up.
    if (result.outcome !== 'dodged' && this.brain !== 'chase' && this.alive) {
      this.brain = 'chase';
      ctx.fx.sound('alert', this.position, 0.6);
    }
  }

  override die(ctx: WorldContext): void {
    super.die(ctx);
    ctx.fx.sound('enemyDeath', this.position);
    ctx.events.emit('enemyKilled', { enemy: this, souls: Math.round(this.profile.souls * this.difficulty) });
  }

  update(dt: number, ctx: WorldContext): void {
    const a = this.action;
    switch (a.kind) {
      case 'free':
        this.think(dt, ctx);
        break;
      case 'attack':
        this.updateAttack(a, dt, ctx);
        break;
      case 'stagger':
      case 'backstabbed':
        a.t += dt;
        if (a.t >= a.duration) this.action = { kind: 'free' };
        break;
      case 'scripted':
        a.t += dt;
        if (a.t >= a.duration) {
          this.action = { kind: 'free' };
          a.onDone?.();
        }
        break;
      case 'dead': {
        a.t += dt;
        const fadeStart = this.isBoss ? 2.5 : 1.6;
        const opacity = 1 - (a.t - fadeStart) / 1.2;
        this.rig.setOpacity(Math.max(0, Math.min(1, opacity)));
        if (opacity <= 0) this.rig.root.visible = false;
        break;
      }
      case 'roll':
      case 'drink':
      case 'fall':
        this.action = { kind: 'free' };
        break;
    }

    if (this.alive) this.applyImpulse(dt, ctx);
    this.updateResources(dt, 22);
    this.trackGait(dt);
    if (this.rig.root.visible) this.syncRig(dt, ctx.time);
  }

  protected updateAttack(a: AttackAction, dt: number, ctx: WorldContext): void {
    const target = ctx.player.alive ? ctx.player.position : null;
    const desired = a.def.hitbox.kind === 'circle' ? a.def.hitbox.offset : a.def.hitbox.range * 0.55;
    if (!this.advanceAttack(a, dt, ctx, target, desired)) return;
    const next = a.def.next ? getAttack(a.def.next) : undefined;
    if (next && Math.random() < this.profile.chainChance && ctx.player.alive) {
      this.startAttack(next);
    } else {
      this.action = { kind: 'free' };
      this.cooldown = this.nextCooldown();
    }
  }

  protected nextCooldown(): number {
    return randRange(Math.random, this.profile.cooldown[0], this.profile.cooldown[1]);
  }

  protected speedMultiplier(): number {
    return 1;
  }

  /** Whether this enemy notices the player at all right now. */
  protected canAggro(ctx: WorldContext, dist: number): boolean {
    const p = ctx.player;
    return p.alive && dist < this.profile.aggroRange && !ctx.collision.segmentBlocked(this.position, p.position);
  }

  protected think(dt: number, ctx: WorldContext): void {
    const player = ctx.player;
    const dist = this.distanceTo(player.position);
    const pr = this.profile;

    if (this.brain === 'idle') {
      this.shieldUp = false;
      this.turnTowards(this.homeFacing, 2, dt);
      if (this.canAggro(ctx, dist)) {
        this.brain = 'chase';
        this.cooldown = Math.max(this.cooldown, 0.4);
        ctx.fx.sound('alert', this.position, 0.6);
      }
      return;
    }

    if (this.brain === 'return') {
      this.shieldUp = false;
      const d = this.distanceTo(this.home);
      if (d < 0.4) {
        this.brain = 'idle';
        this.hp = this.maxHp;
        return;
      }
      this.walkTowards(this.home, pr.walkSpeed, dt, ctx);
      if (this.canAggro(ctx, dist) && dist < pr.aggroRange * 0.6) this.brain = 'chase';
      return;
    }

    // Chasing.
    if (!player.alive || this.distanceTo(this.home) > pr.leash) {
      this.brain = 'return';
      return;
    }

    this.turnTowards(this.yawTo(player.position), pr.turnRate, dt);
    this.cooldown -= dt;
    this.shieldUp = pr.blocks && dist < 5;

    const facingPlayer = Math.abs(this.angleToPlayer(player.position)) < 0.6;
    if (this.cooldown <= 0 && facingPlayer) {
      const options = pr.attacks.filter((o) => dist >= o.minRange && dist <= o.maxRange && (o.minPhase ?? 1) <= this.phase);
      const choice = weightedPick(options, (o) => o.weight);
      if (choice) {
        this.startAttack(choice.attack);
        this.shieldUp = false;
        return;
      }
    }

    const speedMul = this.speedMultiplier();
    if (dist > pr.holdRange + 0.4) {
      const speed = (dist > 5 ? pr.runSpeed : pr.walkSpeed) * speedMul;
      this.walkTowards(player.position, speed * (this.shieldUp ? 0.7 : 1), dt, ctx);
    } else if (dist < pr.holdRange - 0.7) {
      const away = { x: this.position.x * 2 - player.position.x, z: this.position.z * 2 - player.position.z };
      this.walkTowards(away, pr.walkSpeed * 0.5, dt, ctx, false);
    } else {
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.strafeTimer = randRange(Math.random, 1.2, 2.8);
      }
      const dx = player.position.x - this.position.x;
      const dz = player.position.z - this.position.z;
      const len = Math.hypot(dx, dz) || 1;
      const sx = (-dz / len) * this.strafeDir;
      const sz = (dx / len) * this.strafeDir;
      const speed = pr.walkSpeed * 0.45 * speedMul;
      this.move(sx * speed * dt, sz * speed * dt, ctx);
    }
  }

  private angleToPlayer(p: Vec2): number {
    return angleDiff(this.facing, this.yawTo(p));
  }

  protected walkTowards(target: Vec2, speed: number, dt: number, ctx: WorldContext, face = true): void {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    const step = Math.min(len, speed * dt);
    this.move((dx / len) * step, (dz / len) * step, ctx);
    if (face) this.turnTowards(Math.atan2(dx, dz), this.profile.turnRate, dt);
  }

  /** World position of the chest, for effects and markers. */
  chestPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + this.chestHeight, this.position.z);
  }
}
