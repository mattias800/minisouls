import { describe, expect, it } from 'vitest';
import { resolveHit, type DefenderSnapshot } from '../src/combat/damage';

const defender = (over: Partial<DefenderSnapshot> = {}): DefenderSnapshot => ({
  hp: 100,
  stamina: 90,
  poise: 20,
  invulnerable: false,
  blocking: false,
  facingDot: 1,
  hyperArmor: false,
  blockStaminaFactor: 0.75,
  ...over,
});

describe('resolveHit', () => {
  it('whiffs against i-frames', () => {
    expect(resolveHit(defender({ invulnerable: true }), { damage: 50, poiseDamage: 50 }).outcome).toBe('dodged');
  });

  it('blocks frontal hits at a stamina cost', () => {
    const r = resolveHit(defender({ blocking: true }), { damage: 40, poiseDamage: 50 });
    expect(r.outcome).toBe('blocked');
    expect(r.hpDamage).toBe(0);
    expect(r.staminaDamage).toBeCloseTo(30);
  });

  it('does not block hits from behind', () => {
    expect(resolveHit(defender({ blocking: true, facingDot: -1 }), { damage: 40, poiseDamage: 10 }).outcome).toBe('hit');
  });

  it('breaks the guard when stamina runs out', () => {
    const r = resolveHit(defender({ blocking: true, stamina: 10 }), { damage: 40, poiseDamage: 10 });
    expect(r.outcome).toBe('guardBreak');
    expect(r.staggered).toBe(true);
  });

  it('cannot shield against unblockable attacks', () => {
    expect(resolveHit(defender({ blocking: true }), { damage: 20, poiseDamage: 10, unblockable: true }).outcome).toBe('hit');
  });

  it('staggers when poise breaks, unless hyper-armoured', () => {
    expect(resolveHit(defender(), { damage: 10, poiseDamage: 25 }).staggered).toBe(true);
    expect(resolveHit(defender(), { damage: 10, poiseDamage: 5 }).staggered).toBe(false);
    expect(resolveHit(defender({ hyperArmor: true }), { damage: 10, poiseDamage: 25 }).staggered).toBe(false);
  });

  it('kills and never deals more than the remaining hp', () => {
    const r = resolveHit(defender({ hp: 15 }), { damage: 40, poiseDamage: 0 });
    expect(r.outcome).toBe('killed');
    expect(r.hpDamage).toBe(15);
  });
});
