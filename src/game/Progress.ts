import { BASE_STATS, type Stats } from './stats';

/**
 * Everything that survives death and page reloads. Souls games save
 * constantly, so reloading the page is not an escape from a lost bloodstain.
 */
export interface ProgressData {
  version: 1;
  souls: number;
  stats: Stats;
  estusMax: number;
  bonfireLit: boolean;
  shortcutOpen: boolean;
  bossDefeated: boolean;
  pickupsTaken: string[];
  bloodstain: { x: number; z: number; souls: number } | null;
  deaths: number;
  /** New Game+ cycle, 0 for the first playthrough. */
  cycle: number;
  playTime: number;
}

const STORAGE_KEY = 'minisouls.save.v1';

export function freshProgress(): ProgressData {
  return {
    version: 1,
    souls: 0,
    stats: { ...BASE_STATS },
    estusMax: 3,
    bonfireLit: false,
    shortcutOpen: false,
    bossDefeated: false,
    pickupsTaken: [],
    bloodstain: null,
    deaths: 0,
    cycle: 0,
    playTime: 0,
  };
}

/** Carries the character into the next cycle while resetting the world. */
export function newGamePlus(prev: ProgressData): ProgressData {
  return {
    ...freshProgress(),
    souls: prev.souls,
    stats: { ...prev.stats },
    estusMax: prev.estusMax,
    deaths: prev.deaths,
    cycle: prev.cycle + 1,
    playTime: prev.playTime,
  };
}

/** Validates untrusted JSON, falling back to defaults for anything missing or malformed. */
export function parseProgress(raw: unknown): ProgressData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<ProgressData>;
  if (r.version !== 1) return null;
  const base = freshProgress();
  const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  const stats: Stats = { ...base.stats };
  if (r.stats && typeof r.stats === 'object') {
    for (const key of Object.keys(stats) as (keyof Stats)[]) stats[key] = num(r.stats[key], stats[key]);
  }
  const stain = r.bloodstain;
  return {
    version: 1,
    souls: num(r.souls, 0),
    stats,
    estusMax: num(r.estusMax, base.estusMax),
    bonfireLit: bool(r.bonfireLit, false),
    shortcutOpen: bool(r.shortcutOpen, false),
    bossDefeated: bool(r.bossDefeated, false),
    pickupsTaken: Array.isArray(r.pickupsTaken) ? r.pickupsTaken.filter((p): p is string => typeof p === 'string') : [],
    bloodstain:
      stain && typeof stain === 'object' && typeof stain.x === 'number' && typeof stain.z === 'number' && typeof stain.souls === 'number'
        ? { x: stain.x, z: stain.z, souls: stain.souls }
        : null,
    deaths: num(r.deaths, 0),
    cycle: num(r.cycle, 0),
    playTime: num(r.playTime, 0),
  };
}

export const ProgressStore = {
  load(): ProgressData | null {
    try {
      const text = localStorage.getItem(STORAGE_KEY);
      return text ? parseProgress(JSON.parse(text)) : null;
    } catch {
      return null;
    }
  },
  save(data: ProgressData): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Private mode or storage full: the run simply won't persist.
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  },
};
