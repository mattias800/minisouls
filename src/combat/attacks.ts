import type { AttackDef } from './types';

const deg = (d: number): number => (d * Math.PI) / 180;

/**
 * Every attack in the game. Tuning lives here so balance changes never need to
 * touch behaviour code. Player damage is scaled by Strength at hit time.
 */
export const ATTACKS = {
  // ---- The Ashen One (player) -------------------------------------------
  playerLight1: {
    id: 'playerLight1', anim: 'slash',
    windup: 0.2, active: 0.13, recovery: 0.38,
    damage: 20, poiseDamage: 16, staminaCost: 16,
    hitbox: { kind: 'arc', range: 2.2, halfAngle: deg(65) },
    lunge: 0.45, knockback: 1.2, tracking: 5,
    next: 'playerLight2', rollCancelAfter: 0.18, sound: 'light', bouncesOffShields: true,
  },
  playerLight2: {
    id: 'playerLight2', anim: 'backslash',
    windup: 0.18, active: 0.13, recovery: 0.4,
    damage: 22, poiseDamage: 16, staminaCost: 16,
    hitbox: { kind: 'arc', range: 2.2, halfAngle: deg(65) },
    lunge: 0.45, knockback: 1.2, tracking: 5,
    next: 'playerLight1', rollCancelAfter: 0.18, sound: 'light', bouncesOffShields: true,
  },
  playerHeavy: {
    id: 'playerHeavy', anim: 'overhead',
    windup: 0.52, active: 0.14, recovery: 0.5,
    damage: 38, poiseDamage: 34, staminaCost: 30,
    hitbox: { kind: 'arc', range: 2.4, halfAngle: deg(35) },
    lunge: 0.7, knockback: 3, tracking: 3.5,
    rollCancelAfter: 0.3, sound: 'heavy',
  },
  playerBackstab: {
    id: 'playerBackstab', anim: 'backstab',
    windup: 0.45, active: 0.1, recovery: 0.95,
    damage: 75, poiseDamage: 999, staminaCost: 0,
    hitbox: { kind: 'arc', range: 1.8, halfAngle: deg(40) },
    lunge: 0, knockback: 0, tracking: 0, sound: 'heavy',
  },

  // ---- Hollows ------------------------------------------------------------
  hollowSlash: {
    id: 'hollowSlash', anim: 'slash',
    windup: 0.55, active: 0.14, recovery: 0.65,
    damage: 17, poiseDamage: 22, staminaCost: 0,
    hitbox: { kind: 'arc', range: 1.9, halfAngle: deg(55) },
    lunge: 0.6, knockback: 1.5, tracking: 4, sound: 'light',
  },
  hollowFlurry: {
    id: 'hollowFlurry', anim: 'backslash',
    windup: 0.3, active: 0.13, recovery: 0.9,
    damage: 14, poiseDamage: 22, staminaCost: 0,
    hitbox: { kind: 'arc', range: 1.9, halfAngle: deg(55) },
    lunge: 0.5, knockback: 1.5, tracking: 3, sound: 'light',
  },
  hollowOverhead: {
    id: 'hollowOverhead', anim: 'overhead',
    windup: 0.85, active: 0.14, recovery: 0.8,
    damage: 24, poiseDamage: 30, staminaCost: 0,
    hitbox: { kind: 'arc', range: 2.0, halfAngle: deg(35) },
    lunge: 0.9, knockback: 2.5, tracking: 3, sound: 'heavy',
  },

  // ---- Gate Knight ------------------------------------------------------
  knightSlash: {
    id: 'knightSlash', anim: 'slash',
    windup: 0.45, active: 0.14, recovery: 0.55,
    damage: 24, poiseDamage: 25, staminaCost: 0,
    hitbox: { kind: 'arc', range: 2.3, halfAngle: deg(60) },
    lunge: 0.6, knockback: 2, tracking: 4.5, sound: 'light', next: 'knightBackslash',
  },
  knightBackslash: {
    id: 'knightBackslash', anim: 'backslash',
    windup: 0.32, active: 0.14, recovery: 0.8,
    damage: 24, poiseDamage: 25, staminaCost: 0,
    hitbox: { kind: 'arc', range: 2.3, halfAngle: deg(60) },
    lunge: 0.6, knockback: 2, tracking: 3, sound: 'light',
  },
  knightThrust: {
    id: 'knightThrust', anim: 'thrust',
    windup: 0.7, active: 0.16, recovery: 0.75,
    damage: 30, poiseDamage: 30, staminaCost: 0,
    hitbox: { kind: 'arc', range: 2.9, halfAngle: deg(22) },
    lunge: 1.8, knockback: 3, tracking: 3.5, sound: 'heavy',
  },
  knightBash: {
    id: 'knightBash', anim: 'shieldBash',
    windup: 0.35, active: 0.12, recovery: 0.6,
    damage: 10, poiseDamage: 60, staminaCost: 0,
    hitbox: { kind: 'arc', range: 1.6, halfAngle: deg(50) },
    lunge: 0.7, knockback: 4, tracking: 5, sound: 'bash',
  },

  // ---- The Ashen Warden (boss) --------------------------------------------
  wardenSweep: {
    id: 'wardenSweep', anim: 'sweep',
    windup: 0.85, active: 0.2, recovery: 0.85,
    damage: 32, poiseDamage: 60, staminaCost: 0,
    hitbox: { kind: 'arc', range: 4.4, halfAngle: deg(100) },
    lunge: 0.8, knockback: 5, tracking: 2.6, sound: 'heavy', hyperArmor: true,
  },
  wardenSlam: {
    id: 'wardenSlam', anim: 'slam',
    // The famous delayed swing: a long, slow windup that punishes panic rolling.
    windup: 1.25, active: 0.14, recovery: 1.1,
    damage: 48, poiseDamage: 80, staminaCost: 0,
    hitbox: { kind: 'circle', offset: 2.9, radius: 1.9 },
    lunge: 1.0, knockback: 6, tracking: 2.2, sound: 'slam', hyperArmor: true,
  },
  wardenCombo1: {
    id: 'wardenCombo1', anim: 'slash',
    windup: 0.6, active: 0.18, recovery: 0.25,
    damage: 28, poiseDamage: 50, staminaCost: 0,
    hitbox: { kind: 'arc', range: 4.1, halfAngle: deg(70) },
    lunge: 1.2, knockback: 3, tracking: 3.2, sound: 'heavy', hyperArmor: true, next: 'wardenCombo2',
  },
  wardenCombo2: {
    id: 'wardenCombo2', anim: 'backslash',
    windup: 0.42, active: 0.18, recovery: 1.0,
    damage: 30, poiseDamage: 50, staminaCost: 0,
    hitbox: { kind: 'arc', range: 4.1, halfAngle: deg(70) },
    lunge: 1.4, knockback: 4, tracking: 2.8, sound: 'heavy', hyperArmor: true,
  },
  wardenLeap: {
    id: 'wardenLeap', anim: 'leap',
    windup: 0.95, active: 0.16, recovery: 1.0,
    damage: 44, poiseDamage: 80, staminaCost: 0,
    hitbox: { kind: 'circle', offset: 1.6, radius: 2.4 },
    lunge: 9, knockback: 6, tracking: 4.5, sound: 'slam', hyperArmor: true, leapHeight: 3.2,
  },
  wardenFlameSlam: {
    id: 'wardenFlameSlam', anim: 'slam',
    windup: 1.0, active: 0.14, recovery: 1.2,
    damage: 42, poiseDamage: 80, staminaCost: 0,
    hitbox: { kind: 'circle', offset: 2.9, radius: 2.0 },
    lunge: 0.8, knockback: 6, tracking: 2.5, sound: 'slam', hyperArmor: true,
    shockwave: { maxRadius: 11, speed: 9, damage: 26 },
  },
} satisfies Record<string, AttackDef>;

export type AttackId = keyof typeof ATTACKS;

export function getAttack(id: string): AttackDef | undefined {
  return (ATTACKS as Record<string, AttackDef>)[id];
}
