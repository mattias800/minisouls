import { describe, expect, it } from 'vitest';
import { freshProgress, newGamePlus, parseProgress } from '../src/game/Progress';
import { BASE_STATS, levelUpCost, maxHp, soulLevel } from '../src/game/stats';

describe('stats', () => {
  it('starts at level 1 and counts each point', () => {
    expect(soulLevel(BASE_STATS)).toBe(1);
    expect(soulLevel({ ...BASE_STATS, vigor: 12, strength: 11 })).toBe(4);
  });

  it('makes levelling steadily more expensive', () => {
    for (let l = 1; l < 30; l++) expect(levelUpCost(l + 1)).toBeGreaterThanOrEqual(levelUpCost(l));
    expect(levelUpCost(1)).toBe(120);
  });

  it('raises max hp with vigor', () => {
    expect(maxHp({ ...BASE_STATS, vigor: 11 })).toBeGreaterThan(maxHp(BASE_STATS));
  });
});

describe('progress', () => {
  it('round-trips through JSON', () => {
    const p = { ...freshProgress(), souls: 321, bloodstain: { x: 1, z: 2, souls: 50 } };
    expect(parseProgress(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('rejects garbage and repairs partial saves', () => {
    expect(parseProgress(null)).toBeNull();
    expect(parseProgress({ version: 2 })).toBeNull();
    const repaired = parseProgress({ version: 1, souls: 'lots', stats: { vigor: 15 } });
    expect(repaired?.souls).toBe(0);
    expect(repaired?.stats.vigor).toBe(15);
    expect(repaired?.stats.endurance).toBe(BASE_STATS.endurance);
  });

  it('keeps the character but resets the world for New Game+', () => {
    const done = { ...freshProgress(), souls: 5000, bossDefeated: true, shortcutOpen: true, estusMax: 4, stats: { ...BASE_STATS, vigor: 20 } };
    const next = newGamePlus(done);
    expect(next.cycle).toBe(1);
    expect(next.souls).toBe(5000);
    expect(next.stats.vigor).toBe(20);
    expect(next.estusMax).toBe(4);
    expect(next.bossDefeated).toBe(false);
    expect(next.shortcutOpen).toBe(false);
  });
});
