/** Character stats and levelling formulas. Pure functions only. */

export type StatName = 'vigor' | 'endurance' | 'strength';

export type Stats = Record<StatName, number>;

export const STAT_INFO: Record<StatName, { label: string; description: string }> = {
  vigor: { label: 'Vigor', description: 'Raises maximum HP.' },
  endurance: { label: 'Endurance', description: 'Raises maximum stamina.' },
  strength: { label: 'Strength', description: 'Raises weapon damage.' },
};

export const STAT_NAMES: readonly StatName[] = ['vigor', 'endurance', 'strength'];

export const BASE_STATS: Stats = { vigor: 10, endurance: 10, strength: 10 };

export const MAX_STAT = 40;

/** Soul level: every stat point above the base adds one level, starting at level 1. */
export function soulLevel(stats: Stats): number {
  let level = 1;
  for (const name of STAT_NAMES) level += stats[name] - BASE_STATS[name];
  return level;
}

/** Souls needed to go from `level` to `level + 1`. Grows about 12% per level. */
export function levelUpCost(level: number): number {
  return Math.round((120 * Math.pow(1.12, level - 1)) / 10) * 10;
}

export const maxHp = (stats: Stats): number => 100 + (stats.vigor - BASE_STATS.vigor) * 12;

export const maxStamina = (stats: Stats): number => 90 + (stats.endurance - BASE_STATS.endurance) * 6;

/** Multiplier applied to the player's weapon damage. */
export const damageMultiplier = (stats: Stats): number => 1 + (stats.strength - BASE_STATS.strength) * 0.06;
