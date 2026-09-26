import * as THREE from 'three';
import { ATTACKS, getAttack } from '../combat/attacks';
import { PLAYER, WORLD } from '../config/balance';
import { clamp01, easeOutQuad, yawFromDir, type Vec2 } from '../core/math';
import { damageMultiplier, maxHp, maxStamina, type Stats } from '../game/stats';
import { Actor, type ScriptedAnim } from './Actor';
import type { WorldContext } from './context';

/** Per-frame commands for the player, already converted to world space. */
export interface PlayerIntent {
  /** Desired move direction in world XZ, magnitude 0..1. */
  moveX: number;
  moveZ: number;
  sprint: boolean;
  block: boolean;
  roll: boolean;
  light: boolean;
  heavy: boolean;
  drink: boolean;
  lockTarget: Actor | null;
}

type BufferedAction = 'roll' | 'light' | 'heavy' | 'drink';

export const PLAYER_LOOK = {
  scale: 1,
  bulk: 1,
  skin: 0xc9a58a,
  armor: 0x565a61,
  cloth: 0x2e2620,
  metal: 0xa3a8b0,
  leather: 0x3a2a1d,
  helmet: 'knight',
  weapon: 'sword',
  shield: 'kite',
  cape: 0x4d1717,
  plated: true,
} as const;

export class Player extends Actor {
  estus = 3;
  estusMax = 3;
  damageMult = 1;
  /** Last position comfortably on solid ground; where souls drop after a fall. */
  readonly lastSafe = { x: 0, z: 0 };

  private buffered: { action: BufferedAction; age: number } | null = null;
  private blockHeld = false;
  private sprinting = false;
  private readonly velocity = { x: 0, z: 0 };

  constructor() {
    super({
      name: 'Ashen One',
      team: 'player',
      look: PLAYER_LOOK,
      radius: PLAYER.radius,
      mass: PLAYER.mass,
      maxHp: 100,
      maxStamina: 90,
      maxPoise: PLAYER.maxPoise,
      poiseResetDelay: PLAYER.poiseResetDelay,
      blockStaminaFactor: PLAYER.blockStaminaFactor,
      walkSpeed: PLAYER.walkSpeed,
      trailColor: 0xcfd8ff,
    });
  }

  get isSprinting(): boolean {
    return this.sprinting;
  }

  applyStats(stats: Stats, estusMax: number): void {
    const hpRatio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    this.maxHp = maxHp(stats);
    this.maxStamina = maxStamina(stats);
    this.hp = Math.round(this.maxHp * hpRatio);
    this.stamina = this.maxStamina;
    this.damageMult = damageMultiplier(stats);
    this.estusMax = estusMax;
  }

  /** Full restore, as when resting at a bonfire or respawning. */
  restore(): void {
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.poise = this.maxPoise;
    this.estus = this.estusMax;
    this.impulse.x = this.impulse.z = 0;
    this.velocity.x = this.velocity.z = 0;
  }

  placeAt(x: number, z: number, facing: number): void {
    this.position.set(x, 0, z);
    this.lastSafe.x = x;
    this.lastSafe.z = z;
    this.facing = facing;
  }

  playScripted(anim: ScriptedAnim, duration: number, onDone?: () => void, walk?: Vec2): void {
    this.action = { kind: 'scripted', t: 0, duration, anim, onDone, walk };
    this.buffered = null;
  }

  /** Stand still in the resting pose until `rise()` is called. */
  sitDown(): void {
    this.action = { kind: 'scripted', t: 0, duration: Infinity, anim: 'rest' };
  }

  rise(onDone?: () => void): void {
    this.playScripted('rise', 1.0, onDone);
  }

  get isResting(): boolean {
    return this.action.kind === 'scripted' && this.action.anim === 'rest';
  }

  override isBlocking(): boolean {
    return this.action.kind === 'free' && this.blockHeld;
  }

  override isInvulnerable(): boolean {
    const a = this.action;
    if (a.kind === 'roll') return a.t >= PLAYER.roll.iframeStart && a.t <= PLAYER.roll.iframeEnd;
    if (a.kind === 'scripted') return true;
    return super.isInvulnerable();
  }

  protected override rollDuration(): number {
    return PLAYER.roll.duration;
  }

  protected override drinkDuration(): number {
    return PLAYER.estus.duration;
  }

  override outgoingDamageMultiplier(): number {
    return this.damageMult;
  }

  override die(ctx: WorldContext): void {
    super.die(ctx);
    this.buffered = null;
    ctx.events.emit('playerDied', { cause: 'combat' });
  }

  protected override onFootstep(): void {
    this.footstepPending = true;
  }

  /** Set on the frame a foot lands; Game plays the (non-positional) step sound. */
  footstepPending = false;

  update(dt: number, ctx: WorldContext, intent?: PlayerIntent): void {
    const input = intent ?? NO_INTENT;
    this.blockHeld = input.block;
    this.recordBuffer(input, dt);
    this.sprinting = false;

    const a = this.action;
    switch (a.kind) {
      case 'free':
        this.updateFree(dt, ctx, input);
        break;
      case 'attack': {
        const target = input.lockTarget?.alive ? input.lockTarget.position : this.steerPoint(input);
        const done = this.advanceAttack(a, dt, ctx, target, 1.2);
        const recoveryT = a.t - (a.def.windup + a.def.active);
        if (recoveryT >= 0 && this.buffered) {
          const next = this.buffered.action;
          if ((next === 'light' || next === 'heavy') && this.stamina > 0) {
            const chain = next === 'light' && a.def.next ? getAttack(a.def.next) : next === 'heavy' ? ATTACKS.playerHeavy : undefined;
            if (chain && a.def.id !== 'playerBackstab') {
              this.consumeBuffer();
              this.faceInput(input);
              this.startAttack(chain);
              break;
            }
          } else if (next === 'roll' && a.def.rollCancelAfter !== undefined && recoveryT >= a.def.rollCancelAfter && this.stamina > 0) {
            this.consumeBuffer();
            this.startRoll(input, ctx);
            break;
          }
        }
        if (done) this.action = { kind: 'free' };
        break;
      }
      case 'roll': {
        const prev = a.t;
        a.t += dt;
        const r = PLAYER.roll;
        const step = r.distance * (easeOutQuad(clamp01(a.t / r.duration)) - easeOutQuad(clamp01(prev / r.duration)));
        this.move(a.dirX * step, a.dirZ * step, ctx);
        if (a.t >= r.actionableAfter && this.buffered) {
          this.action = { kind: 'free' };
          this.updateFree(0, ctx, input);
        } else if (a.t >= r.duration) {
          this.action = { kind: 'free' };
        }
        break;
      }
      case 'stagger':
        a.t += dt;
        if (a.t >= a.duration) this.action = { kind: 'free' };
        break;
      case 'drink': {
        a.t += dt;
        const e = PLAYER.estus;
        this.moveWithInput(input, PLAYER.drinkSpeed, dt, ctx);
        if (!a.healed && a.t >= e.healAt) {
          a.healed = true;
          if (this.estus > 0) {
            this.estus--;
            this.hp = Math.min(this.maxHp, this.hp + e.heal);
            ctx.fx.sound('drink', this.position);
            ctx.fx.embers(new THREE.Vector3(this.position.x, 1.0, this.position.z), 30, 0.5);
          }
        }
        this.rig.flask.visible = a.t < e.duration * 0.85;
        if (a.t >= e.duration) {
          this.action = { kind: 'free' };
          this.rig.flask.visible = false;
        }
        break;
      }
      case 'fall':
        a.t += dt;
        a.vy -= WORLD.gravity * dt;
        this.position.y += a.vy * dt;
        this.position.x += this.velocity.x * dt * 0.5;
        this.position.z += this.velocity.z * dt * 0.5;
        if (this.position.y < WORLD.killY && this.hp > 0) {
          this.hp = 0;
          ctx.events.emit('playerDied', { cause: 'fall' });
        }
        break;
      case 'dead':
        a.t += dt;
        break;
      case 'scripted':
        a.t += dt;
        if (a.walk) this.move(a.walk.x * dt, a.walk.z * dt, ctx);
        if (a.t >= a.duration) {
          this.action = { kind: 'free' };
          a.onDone?.();
        }
        break;
      case 'backstabbed':
        this.action = { kind: 'free' };
        break;
    }

    if (this.alive) {
      this.applyImpulse(dt, ctx);
      this.checkGround(ctx);
    }
    this.rig.flask.visible &&= this.action.kind === 'drink';

    const regen = this.sprinting ? 0 : this.blockHeld && this.action.kind === 'free' ? PLAYER.staminaRegen * PLAYER.blockRegenFactor : PLAYER.staminaRegen;
    if (this.action.kind === 'attack' || this.action.kind === 'roll') this.staminaDelay = Math.max(this.staminaDelay, 0.2);
    this.updateResources(dt, regen);
    this.trackGait(dt);
    this.syncRig(dt, ctx.time);
  }

  // --- Internals ----------------------------------------------------------------

  private updateFree(dt: number, ctx: WorldContext, input: PlayerIntent): void {
    if (this.tryBufferedAction(input, ctx)) return;

    const moving = Math.hypot(input.moveX, input.moveZ) > 0.1;
    const wantsSprint = input.sprint && moving && !input.block && this.stamina > 1;
    const speed = input.block ? PLAYER.blockSpeed : wantsSprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    this.sprinting = wantsSprint;
    if (wantsSprint) {
      this.stamina = Math.max(0, this.stamina - PLAYER.sprintCostPerSecond * dt);
      this.staminaDelay = PLAYER.staminaRegenDelay;
    }
    this.moveWithInput(input, speed, dt, ctx);

    const lock = input.lockTarget?.alive ? input.lockTarget : null;
    if (lock && !wantsSprint) {
      this.turnTowards(this.yawTo(lock.position), PLAYER.turnRate, dt);
    } else if (moving) {
      this.turnTowards(yawFromDir(input.moveX, input.moveZ), PLAYER.turnRate, dt);
    }
  }

  private moveWithInput(input: PlayerIntent, speed: number, dt: number, ctx: WorldContext): void {
    const k = 1 - Math.exp(-16 * dt);
    this.velocity.x += (input.moveX * speed - this.velocity.x) * k;
    this.velocity.z += (input.moveZ * speed - this.velocity.z) * k;
    this.move(this.velocity.x * dt, this.velocity.z * dt, ctx);
  }

  private tryBufferedAction(input: PlayerIntent, ctx: WorldContext): boolean {
    const b = this.buffered;
    if (!b) return false;
    if (this.stamina <= 0 && b.action !== 'drink') return false;
    this.consumeBuffer();
    switch (b.action) {
      case 'roll':
        this.startRoll(input, ctx);
        return true;
      case 'light': {
        const victim = this.findBackstabTarget(ctx);
        if (victim) {
          this.startBackstab(victim);
          return true;
        }
        this.faceInput(input);
        this.startAttack(ATTACKS.playerLight1);
        return true;
      }
      case 'heavy':
        this.faceInput(input);
        this.startAttack(ATTACKS.playerHeavy);
        return true;
      case 'drink':
        this.action = { kind: 'drink', t: 0, healed: false };
        this.rig.flask.visible = true;
        return true;
    }
  }

  private startRoll(input: PlayerIntent, ctx: WorldContext): void {
    let dx = input.moveX;
    let dz = input.moveZ;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) {
      // No direction held: hop backwards.
      const f = this.forward;
      dx = -f.x;
      dz = -f.z;
    } else {
      dx /= len;
      dz /= len;
    }
    this.facing = yawFromDir(dx, dz);
    this.action = { kind: 'roll', t: 0, dirX: dx, dirZ: dz };
    this.stamina = Math.max(0, this.stamina - PLAYER.roll.cost);
    this.staminaDelay = PLAYER.staminaRegenDelay;
    this.velocity.x = this.velocity.z = 0;
    ctx.fx.sound('roll', this.position);
  }

  private findBackstabTarget(ctx: WorldContext): Actor | null {
    for (const e of ctx.enemies) {
      if (!e.canBeBackstabbed()) continue;
      const dx = this.position.x - e.position.x;
      const dz = this.position.z - e.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1.6 || dist < 0.01) continue;
      const ef = e.forward;
      // We must be behind them...
      if ((ef.x * dx + ef.z * dz) / dist > -0.55) continue;
      // ...and facing roughly the same way they are.
      const pf = this.forward;
      if (pf.x * ef.x + pf.z * ef.z < 0.3) continue;
      return e;
    }
    return null;
  }

  private startBackstab(victim: Actor): void {
    const f = victim.forward;
    this.position.x = victim.position.x - f.x * 0.95;
    this.position.z = victim.position.z - f.z * 0.95;
    this.facing = victim.facing;
    victim.action = { kind: 'backstabbed', t: 0, duration: 2.6 };
    this.startAttack(ATTACKS.playerBackstab, victim);
  }

  private faceInput(input: PlayerIntent): void {
    const lock = input.lockTarget?.alive ? input.lockTarget : null;
    if (lock) this.facing = this.yawTo(lock.position);
    else if (Math.hypot(input.moveX, input.moveZ) > 0.2) this.facing = yawFromDir(input.moveX, input.moveZ);
  }

  private steerPoint(input: PlayerIntent): Vec2 | null {
    if (Math.hypot(input.moveX, input.moveZ) < 0.2) return null;
    return { x: this.position.x + input.moveX * 3, z: this.position.z + input.moveZ * 3 };
  }

  private recordBuffer(input: PlayerIntent, dt: number): void {
    if (this.buffered) {
      this.buffered.age += dt;
      if (this.buffered.age > PLAYER.inputBuffer) this.buffered = null;
    }
    const pressed: BufferedAction | null = input.roll ? 'roll' : input.light ? 'light' : input.heavy ? 'heavy' : input.drink ? 'drink' : null;
    if (pressed) this.buffered = { action: pressed, age: 0 };
  }

  private consumeBuffer(): void {
    this.buffered = null;
  }

  private checkGround(ctx: WorldContext): void {
    const { x, z } = this.position;
    if (ctx.collision.isOnGround(x, z)) {
      if (ctx.collision.isOnGround(x, z, 0.7)) {
        this.lastSafe.x = x;
        this.lastSafe.z = z;
      }
      return;
    }
    if (this.action.kind === 'fall') return;
    if (this.action.kind === 'roll') {
      // Keep the roll's momentum as we tumble over the edge.
      this.velocity.x = this.action.dirX * 6;
      this.velocity.z = this.action.dirZ * 6;
    }
    this.action = { kind: 'fall', t: 0, vy: 0 };
    this.buffered = null;
    ctx.fx.sound('fall', this.position);
  }
}

const NO_INTENT: PlayerIntent = {
  moveX: 0,
  moveZ: 0,
  sprint: false,
  block: false,
  roll: false,
  light: false,
  heavy: false,
  drink: false,
  lockTarget: null,
};
