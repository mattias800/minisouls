import { describe, expect, it } from 'vitest';
import { angleDiff, forwardFromYaw, mulberry32, rotateTowards, weightedPick, wrapAngle, yawFromDir } from '../src/core/math';

describe('angles', () => {
  it('wraps into [-PI, PI)', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(2 * Math.PI + 1)).toBeCloseTo(1);
    expect(wrapAngle((-3 * Math.PI) / 2)).toBeCloseTo(Math.PI / 2);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5);
  });

  it('takes the short way round', () => {
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
  });

  it('rotates towards a target without overshooting', () => {
    expect(rotateTowards(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(rotateTowards(0, 0.1, 0.25)).toBeCloseTo(0.1);
  });

  it('keeps yaw and forward vectors consistent', () => {
    for (const yaw of [0, 0.7, -2.1, 3]) {
      const f = forwardFromYaw(yaw);
      expect(wrapAngle(yawFromDir(f.x, f.z) - yaw)).toBeCloseTo(0);
    }
  });
});

describe('random helpers', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('weightedPick respects weights and ignores zero weight', () => {
    const items = [
      { id: 'a', w: 0 },
      { id: 'b', w: 1 },
    ];
    for (let i = 0; i < 20; i++) expect(weightedPick(items, (x) => x.w)?.id).toBe('b');
    expect(weightedPick([], () => 1)).toBeUndefined();
  });
});
