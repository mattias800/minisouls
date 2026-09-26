import * as THREE from 'three';
import type { HitResolution } from '../combat/damage';
import { Enemy, type EnemyProfile } from './Enemy';
import type { WorldContext } from './context';
import type { Vec2 } from '../core/math';

const PHASE_TWO_AT = 0.5;
const PHASE_TWO_TEMPO = 1.15;

/**
 * The Ashen Warden. Sleeps until the player crosses the fog, never leashes,
 * and at half health roars into a faster second phase that adds fire.
 */
export class Boss extends Enemy {
  private awake = false;

  constructor(profile: EnemyProfile, home: Vec2, homeFacing: number) {
    super(profile, home, homeFacing);
  }

  override get isBoss(): boolean {
    return true;
  }

  get currentPhase(): number {
    return this.phase;
  }

  get isAwake(): boolean {
    return this.awake;
  }

  awaken(): void {
    this.awake = true;
    this.brain = 'chase';
    this.cooldown = 1.4;
  }

  override reset(): void {
    super.reset();
    this.awake = false;
    this.phase = 1;
  }

  override canBeBackstabbed(): boolean {
    return false;
  }

  override isInvulnerable(): boolean {
    return (this.action.kind === 'scripted' && this.action.anim === 'roar') || super.isInvulnerable();
  }

  protected override canAggro(ctx: WorldContext): boolean {
    return this.awake && ctx.player.alive;
  }

  protected override think(dt: number, ctx: WorldContext): void {
    if (!this.awake) return;
    if (this.brain !== 'chase' && ctx.player.alive) this.brain = 'chase';
    super.think(dt, ctx);
  }

  protected override speedMultiplier(): number {
    return this.phase >= 2 ? 1.25 : 1;
  }

  protected override nextCooldown(): number {
    return super.nextCooldown() * (this.phase >= 2 ? 0.6 : 1);
  }

  protected override onHitTaken(result: HitResolution, ctx: WorldContext): void {
    super.onHitTaken(result, ctx);
    if (this.phase === 1 && this.alive && this.hp <= this.maxHp * PHASE_TWO_AT) this.enterPhaseTwo(ctx);
  }

  private enterPhaseTwo(ctx: WorldContext): void {
    this.phase = 2;
    this.action = { kind: 'scripted', t: 0, duration: 2.1, anim: 'roar' };
    ctx.fx.sound('roar', this.position);
    ctx.fx.shake(0.8);
    ctx.fx.embers(new THREE.Vector3(this.position.x, 2.5, this.position.z), 120, 2.5);
    ctx.events.emit('bossPhase', { phase: 2 });
    // The roar blasts the player away.
    const p = ctx.player;
    const dx = p.position.x - this.position.x;
    const dz = p.position.z - this.position.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < 7) p.push((dx / d) * 9, (dz / d) * 9);
  }

  override update(dt: number, ctx: WorldContext): void {
    const tempo = this.phase >= 2 && this.action.kind === 'attack' ? PHASE_TWO_TEMPO : 1;
    super.update(dt * tempo, ctx);
    if (this.phase >= 2 && this.alive && Math.random() < dt * 30) {
      // Smouldering embers rise off the Warden in phase two.
      ctx.fx.embers(new THREE.Vector3(this.position.x, 1 + Math.random() * 3, this.position.z), 1, 0.9);
    }
  }
}
