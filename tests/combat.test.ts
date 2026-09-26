import { beforeEach, describe, expect, it } from 'vitest';
import { ATTACKS } from '../src/combat/attacks';
import { CombatSystem } from '../src/combat/CombatSystem';
import type { AttackDef } from '../src/combat/types';
import { Emitter } from '../src/core/Emitter';
import type { GameEvents, GameFx, WorldContext } from '../src/entities/context';
import { Enemy } from '../src/entities/Enemy';
import { Player, type PlayerIntent } from '../src/entities/Player';
import { HOLLOW } from '../src/entities/roster';
import { CollisionWorld } from '../src/physics/Collision';

const noop = () => {};
const fx: GameFx = { sound: noop, sparks: noop, blood: noop, dust: noop, embers: noop, shake: noop, hitstop: noop };

const idle: PlayerIntent = { moveX: 0, moveZ: 0, sprint: false, block: false, roll: false, light: false, heavy: false, drink: false, lockTarget: null };

/** Lets tests trigger an enemy attack directly instead of waiting on its AI. */
const forceAttack = (enemy: Enemy, def: AttackDef) => (enemy as unknown as { startAttack(d: AttackDef): void }).startAttack(def);

describe('combat between entities', () => {
  let ctx: WorldContext & { time: number };
  let player: Player;
  let hollow: Enemy;
  let events: Emitter<GameEvents>;
  const combat = new CombatSystem();

  const run = (seconds: number, intent: (frame: number) => Partial<PlayerIntent> = () => ({})) => {
    const dt = 1 / 60;
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      player.update(dt, ctx, { ...idle, ...intent(i) });
      hollow.update(dt, ctx);
      combat.update([player, hollow], ctx);
      ctx.time += dt;
    }
  };

  beforeEach(() => {
    const collision = new CollisionWorld();
    collision.addGroundRect(-20, 20, -20, 20);
    events = new Emitter<GameEvents>();
    player = new Player();
    player.placeAt(0, 0, 0);
    hollow = new Enemy(HOLLOW, { x: 0, z: 1.6 }, Math.PI);
    ctx = { collision, player, enemies: [hollow], fx, time: 0, events, spawnShockwave: noop };
  });

  it('a light attack damages the enemy in front', () => {
    run(1, (i) => ({ light: i === 0 }));
    expect(hollow.hp).toBeLessThan(hollow.maxHp);
  });

  it('rolling grants invulnerability frames', () => {
    run(0.1, (i) => ({ roll: i === 0 }));
    expect(player.action.kind).toBe('roll');
    expect(player.isInvulnerable()).toBe(true);
    run(0.6);
    expect(player.isInvulnerable()).toBe(false);
  });

  it('a raised shield turns damage into stamina loss', () => {
    run(0.1, () => ({ block: true }));
    forceAttack(hollow, ATTACKS.hollowSlash);
    run(1.2, () => ({ block: true }));
    expect(player.hp).toBe(player.maxHp);
    expect(player.stamina).toBeLessThan(player.maxStamina);
  });

  it('an unguarded player takes the hit', () => {
    forceAttack(hollow, ATTACKS.hollowSlash);
    run(1.2);
    expect(player.hp).toBeLessThan(player.maxHp);
  });

  it('killing an enemy pays out souls', () => {
    let souls = 0;
    events.on('enemyKilled', (e) => (souls += e.souls));
    hollow.hp = 1;
    run(1, (i) => ({ light: i === 0 }));
    expect(hollow.alive).toBe(false);
    expect(souls).toBe(HOLLOW.souls);
  });

  it('walking off the edge is a death by falling', () => {
    let cause: string | null = null;
    events.on('playerDied', (e) => (cause = e.cause));
    player.placeAt(19.5, 0, Math.PI / 2);
    run(4, () => ({ moveX: 1 }));
    expect(cause).toBe('fall');
  });

  it('attacks chain into their combo follow-up', () => {
    run(0.05, (i) => ({ light: i === 0 }));
    expect(player.currentAttack?.def.id).toBe('playerLight1');
    // Press again just as the first swing finishes its active frames.
    const def = ATTACKS.playerLight1;
    run(def.windup + def.active + 0.05, (i) => ({ light: i === Math.round((def.windup + def.active) * 60) - 3 }));
    expect(player.currentAttack?.def.id).toBe('playerLight2');
  });
});
