import * as THREE from 'three';
import type { Actor } from '../entities/Actor';
import type { WorldContext } from '../entities/context';

const THICKNESS = 0.7;

/**
 * An expanding ring of fire on the ground. It hits once, can't be blocked,
 * and is dodged by rolling through it (i-frames) as it passes.
 */
export class Shockwave {
  readonly mesh: THREE.Mesh;
  private radius = 0.5;
  private hit = false;
  private readonly center: THREE.Vector3;

  constructor(
    private readonly owner: Actor,
    x: number,
    z: number,
    private readonly maxRadius: number,
    private readonly speed: number,
    private readonly damage: number,
  ) {
    this.center = new THREE.Vector3(x, 0, z);
    const geometry = new THREE.RingGeometry(0.85, 1, 64, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff6a1a,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(x, 0.06, z);
  }

  get finished(): boolean {
    return this.radius >= this.maxRadius;
  }

  update(dt: number, ctx: WorldContext, onHit: (target: Actor) => void): void {
    this.radius += this.speed * dt;
    this.mesh.scale.setScalar(this.radius);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - this.radius / this.maxRadius);
    this.spawnFlames(ctx);

    const target = ctx.player;
    if (this.hit || !target.alive || target.team === this.owner.team) return;
    const d = target.distanceTo(this.center);
    if (Math.abs(d - this.radius) < THICKNESS * 0.5 + target.radius * 0.5 && target.position.y < 0.6) {
      this.hit = true;
      onHit(target);
    }
  }

  private spawnFlames(ctx: WorldContext): void {
    const a = Math.random() * Math.PI * 2;
    ctx.fx.embers(new THREE.Vector3(this.center.x + Math.cos(a) * this.radius, 0.2, this.center.z + Math.sin(a) * this.radius), 3, 0.2);
  }

  get hitDamage(): number {
    return this.damage;
  }

  get origin(): THREE.Vector3 {
    return this.center;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
