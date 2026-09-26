import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import type { Effects } from '../render/Effects';

/** A coiled sword in a heap of ash. The heart of every Souls-like. */
export class Bonfire {
  readonly group = new THREE.Group();
  readonly light: THREE.PointLight;
  lit = false;
  private kindle = 0;
  private readonly firePoint: THREE.Vector3;
  private readonly swordMaterial: THREE.MeshStandardMaterial;

  constructor(readonly x: number, readonly z: number, seed = 7) {
    const rng = mulberry32(seed);
    this.group.position.set(x, 0, z);
    this.firePoint = new THREE.Vector3(x, 0.25, z);

    const ashMat = new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 1, flatShading: true });
    const ash = new THREE.ConeGeometry(0.75, 0.35, 12, 1);
    const ashMesh = new THREE.Mesh(ash, ashMat);
    ashMesh.position.y = 0.17;
    ashMesh.receiveShadow = true;
    this.group.add(ashMesh);

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x57524c, roughness: 0.95, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rng() * 0.3;
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14 + rng() * 0.06, 0), stoneMat);
      stone.position.set(Math.cos(a) * 0.85, 0.08, Math.sin(a) * 0.85);
      stone.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      stone.castShadow = true;
      this.group.add(stone);
    }

    const charMat = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 1, emissive: 0x1a0600, emissiveIntensity: 1 });
    for (let i = 0; i < 5; i++) {
      // Charred logs leaning together like a small teepee.
      const holder = new THREE.Group();
      holder.rotation.y = (i / 5) * Math.PI * 2 + rng() * 0.4;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.55, 6), charMat);
      log.position.set(0, 0.36, 0.17);
      log.rotation.x = -0.55;
      log.castShadow = true;
      holder.add(log);
      this.group.add(holder);
    }

    // The coiled sword: a blade twisted along its length.
    this.swordMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.6, metalness: 0.6, emissive: 0xff5a10, emissiveIntensity: 0 });
    const blade = new THREE.BoxGeometry(0.07, 1.1, 0.018, 1, 24, 1);
    const pos = blade.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const twist = (v.y + 0.55) * 7;
      const cx = v.x * Math.cos(twist) - v.z * Math.sin(twist);
      const cz = v.x * Math.sin(twist) + v.z * Math.cos(twist);
      pos.setXYZ(i, cx + Math.sin(twist) * 0.02, v.y, cz + Math.cos(twist) * 0.02);
    }
    blade.computeVertexNormals();
    const sword = new THREE.Group();
    const bladeMesh = new THREE.Mesh(blade, this.swordMaterial);
    bladeMesh.castShadow = true;
    sword.add(bladeMesh);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.05), this.swordMaterial);
    guard.position.y = 0.55;
    sword.add(guard);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 6), charMat);
    grip.position.y = 0.67;
    sword.add(grip);
    sword.position.y = 0.45;
    sword.rotation.set(0.12, 0.4, -0.08);
    this.group.add(sword);

    this.light = new THREE.PointLight(0xff8a3a, 0, 16, 1.6);
    this.light.position.set(0, 1.0, 0);
    this.group.add(this.light);
  }

  setLit(lit: boolean, instant = false): void {
    this.lit = lit;
    if (instant) this.kindle = lit ? 1 : 0;
  }

  update(dt: number, time: number, fx: Effects): void {
    this.kindle += ((this.lit ? 1 : 0) - this.kindle) * Math.min(1, dt * 2);
    const flicker = 0.85 + Math.sin(time * 11) * 0.06 + Math.sin(time * 23.7) * 0.05 + Math.random() * 0.06;
    this.light.intensity = (0.1 + this.kindle * 14) * flicker;
    this.swordMaterial.emissiveIntensity = 0.03 + this.kindle * 0.8 * flicker;
    if (this.kindle > 0.05) fx.fire(this.firePoint, dt, this.kindle);
    else fx.wisp(this.firePoint, dt, 0xff7a2a, 4);
  }
}
