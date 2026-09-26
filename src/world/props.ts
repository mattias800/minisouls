import * as THREE from 'three';
import type { Box } from '../physics/Collision';
import type { Effects } from '../render/Effects';
import { Humanoid, type HumanoidLook } from '../render/Humanoid';
import { Animator } from '../render/Animator';
import { SLUMPED_POSE } from '../render/poses';
import { runeTexture } from '../render/textures';

/** The souls you dropped when you died. Touch it before dying again. */
export class Bloodstain {
  readonly group = new THREE.Group();
  private readonly point = new THREE.Vector3();
  private readonly core: THREE.Mesh;

  constructor() {
    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x8affc0, emissive: 0x5affa0, emissiveIntensity: 3 }),
    );
    this.core.position.y = 0.25;
    this.group.add(this.core);
    this.group.visible = false;
  }

  souls = 0;

  place(x: number, z: number, souls: number): void {
    this.group.position.set(x, 0, z);
    this.point.set(x, 0.15, z);
    this.souls = souls;
    this.group.visible = souls > 0;
  }

  clear(): void {
    this.souls = 0;
    this.group.visible = false;
  }

  get active(): boolean {
    return this.group.visible;
  }

  get x(): number {
    return this.group.position.x;
  }

  get z(): number {
    return this.group.position.z;
  }

  update(dt: number, time: number, fx: Effects): void {
    if (!this.group.visible) return;
    this.core.position.y = 0.25 + Math.sin(time * 2.5) * 0.05;
    fx.wisp(this.point, dt, 0x7affb8, 22);
  }
}

/** A scrawled note on the floor left by another (imaginary) player. */
export class GroundMessage {
  readonly mesh: THREE.Mesh;

  constructor(
    readonly x: number,
    readonly z: number,
    readonly text: string,
    seed: number,
  ) {
    const material = new THREE.MeshBasicMaterial({
      map: runeTexture(seed),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: 0xffb070,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.rotation.z = seed * 1.3;
    this.mesh.position.set(x, 0.03, z);
  }

  update(time: number): void {
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(time * 1.7 + this.x) * 0.25;
  }
}

/** A glowing item on a slumped corpse. */
export class ItemPickup {
  readonly group = new THREE.Group();
  taken = false;
  private readonly point: THREE.Vector3;

  constructor(
    readonly id: string,
    readonly x: number,
    readonly z: number,
    facing: number,
    corpseLook: HumanoidLook,
  ) {
    const corpse = new Humanoid(corpseLook);
    corpse.root.rotation.y = facing;
    new Animator(corpse).apply(SLUMPED_POSE, 1, { rate: 1000 });
    corpse.root.position.set(0, 0, 0);
    this.group.add(corpse.root);
    this.group.position.set(x, 0, z);
    const f = { x: Math.sin(facing), z: Math.cos(facing) };
    this.point = new THREE.Vector3(x + f.x * 0.35, 0.35, z + f.z * 0.35);
  }

  update(dt: number, fx: Effects): void {
    if (!this.taken) fx.wisp(this.point, dt, 0xfff2d0, 18);
  }
}

/** Iron bars across a doorway that can only be lifted from one side. */
export class ShortcutGate {
  readonly group = new THREE.Group();
  private readonly bars = new THREE.Group();
  private openness = 0;
  open = false;

  constructor(
    readonly x: number,
    readonly z: number,
    width: number,
    height: number,
    alongZ: boolean,
    private readonly collider: Box,
  ) {
    const iron = new THREE.MeshStandardMaterial({ color: 0x2d2b2a, roughness: 0.6, metalness: 0.7 });
    const count = Math.round(width / 0.22);
    for (let i = 0; i <= count; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, height, 6), iron);
      const offset = -width / 2 + (i / count) * width;
      bar.position.set(alongZ ? 0 : offset, height / 2, alongZ ? offset : 0);
      bar.castShadow = true;
      this.bars.add(bar);
    }
    for (const y of [0.4, height - 0.3]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(alongZ ? 0.06 : width, 0.08, alongZ ? width : 0.06), iron);
      rail.position.y = y;
      this.bars.add(rail);
    }
    this.group.add(this.bars);
    this.group.position.set(x, 0, z);
  }

  setOpen(open: boolean, instant = false): void {
    this.open = open;
    this.collider.enabled = !open;
    if (instant) this.openness = open ? 1 : 0;
  }

  update(dt: number): void {
    const target = this.open ? 1 : 0;
    this.openness += Math.sign(target - this.openness) * Math.min(Math.abs(target - this.openness), dt * 0.6);
    this.bars.position.y = this.openness * 2.9;
  }
}
