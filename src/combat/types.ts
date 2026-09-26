/** Which canned animation an attack plays. Poses live in render/poses.ts. */
export type AttackAnim =
  | 'slash'
  | 'backslash'
  | 'overhead'
  | 'thrust'
  | 'shieldBash'
  | 'sweep'
  | 'slam'
  | 'leap'
  | 'backstab';

export type AttackHitbox =
  /** A wedge in front of the attacker: reach from centre and half-angle in radians. */
  | { kind: 'arc'; range: number; halfAngle: number }
  /** A disc placed `offset` metres in front of the attacker. */
  | { kind: 'circle'; offset: number; radius: number };

export type SwingSound = 'light' | 'heavy' | 'slam' | 'bash';

/**
 * Pure data describing one attack. Timings are in seconds and run
 * windup → active (hitbox live) → recovery.
 */
export interface AttackDef {
  readonly id: string;
  readonly anim: AttackAnim;
  readonly windup: number;
  readonly active: number;
  readonly recovery: number;
  readonly damage: number;
  readonly poiseDamage: number;
  readonly staminaCost: number;
  readonly hitbox: AttackHitbox;
  /** Metres moved forward over the end of windup and the active window. */
  readonly lunge: number;
  readonly knockback: number;
  /** Max turn rate (rad/s) towards the target during windup. Enemies track, players steer. */
  readonly tracking: number;
  /** Cannot be staggered out of this attack. */
  readonly hyperArmor?: boolean;
  /** Attack that follows if chained (player: on input, enemies: automatically). */
  readonly next?: string;
  /** Seconds into recovery after which a roll may cancel the attack (players only). */
  readonly rollCancelAfter?: number;
  readonly sound: SwingSound;
  /** Spawns an expanding ring of fire when the hitbox activates. */
  readonly shockwave?: { readonly maxRadius: number; readonly speed: number; readonly damage: number };
  /** Vertical hop height during the attack (leaps). */
  readonly leapHeight?: number;
  /** Light attacks bounce off a sturdy shield; heavy ones push through. */
  readonly bouncesOffShields?: boolean;
}

export const attackDuration = (a: AttackDef): number => a.windup + a.active + a.recovery;

export type AttackPhase = 'windup' | 'active' | 'recovery' | 'done';

export function attackPhase(a: AttackDef, t: number): AttackPhase {
  if (t < a.windup) return 'windup';
  if (t < a.windup + a.active) return 'active';
  if (t < attackDuration(a)) return 'recovery';
  return 'done';
}
