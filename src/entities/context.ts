import type * as THREE from 'three';
import type { AttackDef } from '../combat/types';
import type { CollisionWorld } from '../physics/Collision';
import type { SoundName } from '../audio/sounds';
import type { Emitter } from '../core/Emitter';
import type { Actor } from './Actor';

/** Side effects entities may trigger without knowing about the renderer or audio engine. */
export interface GameFx {
  sound(name: SoundName, at?: THREE.Vector3, volume?: number): void;
  sparks(at: THREE.Vector3, color: number, count: number): void;
  blood(at: THREE.Vector3): void;
  dust(at: THREE.Vector3, count: number): void;
  embers(at: THREE.Vector3, count: number, spread: number): void;
  shake(amount: number): void;
  hitstop(seconds: number): void;
}

export interface GameEvents extends Record<string, unknown> {
  playerDied: { cause: 'combat' | 'fall' };
  enemyKilled: { enemy: Actor; souls: number };
  bossPhase: { phase: number };
}

/** What an entity can see of the world while it updates. */
export interface WorldContext {
  readonly collision: CollisionWorld;
  readonly player: Actor;
  readonly enemies: readonly Actor[];
  readonly fx: GameFx;
  readonly time: number;
  readonly events: Emitter<GameEvents>;
  spawnShockwave(owner: Actor, x: number, z: number, def: NonNullable<AttackDef['shockwave']>): void;
}
