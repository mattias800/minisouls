/**
 * Pure hit resolution. Given a snapshot of the defender and the incoming hit,
 * decide what happens. Keeping this free of rendering/entity code makes the
 * core combat rules easy to unit test and reason about.
 */

export interface DefenderSnapshot {
  hp: number;
  stamina: number;
  poise: number;
  /** Inside roll i-frames, or otherwise untouchable. */
  invulnerable: boolean;
  blocking: boolean;
  /** Dot product of the defender's forward vector with the direction to the attacker. */
  facingDot: number;
  hyperArmor: boolean;
  /** Stamina lost per point of blocked damage. Lower is a better shield. */
  blockStaminaFactor: number;
}

export interface IncomingHit {
  damage: number;
  poiseDamage: number;
  /** Fire shockwaves and grabs ignore shields. */
  unblockable?: boolean;
}

export type HitOutcome = 'dodged' | 'blocked' | 'guardBreak' | 'hit' | 'killed';

export interface HitResolution {
  outcome: HitOutcome;
  hpDamage: number;
  staminaDamage: number;
  poiseDamage: number;
  staggered: boolean;
}

/** Shields cover roughly the front 150 degrees. */
export const BLOCK_COS = Math.cos((75 * Math.PI) / 180);

export function resolveHit(defender: DefenderSnapshot, hit: IncomingHit): HitResolution {
  if (defender.invulnerable) {
    return { outcome: 'dodged', hpDamage: 0, staminaDamage: 0, poiseDamage: 0, staggered: false };
  }

  if (defender.blocking && !hit.unblockable && defender.facingDot >= BLOCK_COS) {
    const cost = hit.damage * defender.blockStaminaFactor;
    if (cost <= defender.stamina) {
      return { outcome: 'blocked', hpDamage: 0, staminaDamage: cost, poiseDamage: 0, staggered: false };
    }
    // Guard broken: the shield is knocked aside, leaving the defender open.
    return {
      outcome: 'guardBreak',
      hpDamage: 0,
      staminaDamage: defender.stamina,
      poiseDamage: 0,
      staggered: true,
    };
  }

  const hpDamage = Math.max(0, hit.damage);
  if (hpDamage >= defender.hp) {
    return { outcome: 'killed', hpDamage: defender.hp, staminaDamage: 0, poiseDamage: hit.poiseDamage, staggered: true };
  }
  const poiseAfter = defender.poise - hit.poiseDamage;
  return {
    outcome: 'hit',
    hpDamage,
    staminaDamage: 0,
    poiseDamage: hit.poiseDamage,
    staggered: poiseAfter <= 0 && !defender.hyperArmor,
  };
}
