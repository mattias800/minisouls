import * as THREE from 'three';
import { angleDiff, yawFromDir } from '../core/math';
import type { Actor, HitboxWorld } from '../entities/Actor';
import type { WorldContext } from '../entities/context';
import type { HitResolution } from './damage';
import type { AttackDef } from './types';

/** Tests live hitboxes against opposing actors and applies the results. */
export class CombatSystem {
  private readonly tmp = new THREE.Vector3();

  update(actors: readonly Actor[], ctx: WorldContext): void {
    for (const attacker of actors) {
      const hitbox = attacker.activeHitbox();
      const attack = attacker.currentAttack;
      if (!hitbox || !attack) continue;
      for (const target of actors) {
        if (target.team === attacker.team || !target.alive || attack.hits.has(target.id)) continue;
        if (attack.only && attack.only !== target) continue;
        if (Math.abs(attacker.position.y - target.position.y) > 1.4) continue;
        if (!overlaps(hitbox, target)) continue;
        attack.hits.add(target.id);
        this.applyHit(attacker, attack.def, target, ctx);
      }
    }
  }

  private applyHit(attacker: Actor, def: AttackDef, target: Actor, ctx: WorldContext): void {
    const damage = def.damage * attacker.outgoingDamageMultiplier();
    const shieldBounce = !!def.bouncesOffShields && target.team === 'enemy' && target.wouldBlock(attacker.position);
    const result = target.takeHit({ damage, poiseDamage: def.poiseDamage }, attacker.position, def.knockback, ctx.time, ctx);
    if (result.outcome === 'blocked' && shieldBounce) attacker.recoil();
    this.feedback(attacker, target, result, damage, ctx);
  }

  /** Sound, particles, hitstop and shake for a resolved hit. */
  feedback(attacker: Actor | null, target: Actor, result: HitResolution, damage: number, ctx: WorldContext): void {
    const at = this.tmp.set(target.position.x, target.position.y + target.chestHeight, target.position.z).clone();
    const playerInvolved = target.team === 'player' || attacker?.team === 'player';
    switch (result.outcome) {
      case 'dodged':
        return;
      case 'blocked':
        ctx.fx.sound('block', at);
        ctx.fx.sparks(at, 0xffd28a, 16);
        if (playerInvolved) ctx.fx.shake(0.15);
        return;
      case 'guardBreak':
        ctx.fx.sound('guardBreak', at);
        ctx.fx.sparks(at, 0xffd28a, 28);
        ctx.fx.shake(0.35);
        return;
      case 'hit':
      case 'killed': {
        const heavy = damage >= 30 || result.outcome === 'killed';
        ctx.fx.sound(heavy ? 'hitHeavy' : 'hit', at);
        ctx.fx.blood(at);
        if (target.team === 'player') {
          ctx.fx.sound('playerHurt', at);
          ctx.fx.shake(0.45);
          ctx.fx.hitstop(0.05);
        } else if (attacker?.team === 'player') {
          ctx.fx.shake(heavy ? 0.22 : 0.1);
          ctx.fx.hitstop(heavy ? 0.09 : 0.055);
        }
      }
    }
  }
}

/** Does a hitbox touch an actor's collision circle? */
export function overlaps(hb: HitboxWorld, target: Actor): boolean {
  const dx = target.position.x - hb.x;
  const dz = target.position.z - hb.z;
  const dist = Math.hypot(dx, dz);
  if (hb.kind === 'circle') return dist <= hb.range + target.radius;
  if (dist - target.radius > hb.range) return false;
  if (dist <= target.radius + 0.2) return true;
  // Widen the wedge by the angle the target's body subtends.
  const slack = Math.asin(Math.min(1, target.radius / dist));
  return Math.abs(angleDiff(hb.facing, yawFromDir(dx, dz))) <= hb.halfAngle + slack;
}
