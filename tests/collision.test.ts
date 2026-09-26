import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../src/physics/Collision';

describe('CollisionWorld', () => {
  it('pushes a circle out of a box', () => {
    const world = new CollisionWorld();
    world.addBox(0, 2, 0, 2);
    const p = { x: -0.2, z: 1 };
    expect(world.resolve(p, 0.5)).toBe(true);
    expect(p.x).toBeCloseTo(-0.5);
  });

  it('ejects a circle whose centre is inside a box along the shallowest axis', () => {
    const world = new CollisionWorld();
    world.addBox(0, 10, 0, 1);
    const p = { x: 5, z: 0.9 };
    world.resolve(p, 0.3);
    expect(p.z).toBeCloseTo(1.3);
  });

  it('ignores disabled boxes', () => {
    const world = new CollisionWorld();
    const gate = world.addBox(0, 1, 0, 1);
    gate.enabled = false;
    const p = { x: 0.5, z: 0.5 };
    expect(world.resolve(p, 0.3)).toBe(false);
  });

  it('separates from circle colliders', () => {
    const world = new CollisionWorld();
    world.addCircle(0, 0, 1);
    const p = { x: 1.2, z: 0 };
    world.resolve(p, 0.5);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(1.5);
  });

  it('knows where the ground ends', () => {
    const world = new CollisionWorld();
    world.addGroundRect(-1, 1, 0, 10);
    world.addGroundCircle(0, 20, 5);
    expect(world.isOnGround(0, 5)).toBe(true);
    expect(world.isOnGround(0.9, 5, 0.2)).toBe(false);
    expect(world.isOnGround(0, 12)).toBe(false);
    expect(world.isOnGround(3, 20)).toBe(true);
  });

  it('blocks line of sight through walls only', () => {
    const world = new CollisionWorld();
    world.addBox(-1, 1, 4, 5);
    expect(world.segmentBlocked({ x: 0, z: 0 }, { x: 0, z: 10 })).toBe(true);
    expect(world.segmentBlocked({ x: 3, z: 0 }, { x: 3, z: 10 })).toBe(false);
  });
});
