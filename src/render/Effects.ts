import * as THREE from 'three';
import { ParticleSystem } from './Particles';

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** Named particle effects built on two particle pools. */
export class Effects {
  private readonly glow = new ParticleSystem(5000, true);
  private readonly murk = new ParticleSystem(2000, false);

  addTo(scene: THREE.Scene): void {
    scene.add(this.glow.points, this.murk.points);
  }

  setViewportHeight(h: number): void {
    this.glow.setViewportHeight(h);
    this.murk.setViewportHeight(h);
  }

  update(dt: number): void {
    this.glow.update(dt);
    this.murk.update(dt);
  }

  clear(): void {
    this.glow.clear();
    this.murk.clear();
  }

  sparks(at: THREE.Vector3, color: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(2, 7);
      this.glow.spawn({
        x: at.x, y: at.y, z: at.z,
        vx: Math.cos(a) * s, vy: rand(0, 5), vz: Math.sin(a) * s,
        life: rand(0.15, 0.4), size: rand(0.04, 0.08), sizeEnd: 0.3,
        color, gravity: 14, drag: 3,
      });
    }
  }

  blood(at: THREE.Vector3): void {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(1, 4);
      this.murk.spawn({
        x: at.x, y: at.y, z: at.z,
        vx: Math.cos(a) * s, vy: rand(0.5, 3.5), vz: Math.sin(a) * s,
        life: rand(0.35, 0.7), size: rand(0.08, 0.16), sizeEnd: 0.6,
        color: 0x5a0808, alpha: 0.9, gravity: 12, drag: 1.5,
      });
    }
  }

  dust(at: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.5, 3.5);
      this.murk.spawn({
        x: at.x + Math.cos(a) * 0.3, y: at.y + 0.1, z: at.z + Math.sin(a) * 0.3,
        vx: Math.cos(a) * s, vy: rand(0.2, 1.4), vz: Math.sin(a) * s,
        life: rand(0.6, 1.2), size: rand(0.3, 0.6), sizeEnd: 2,
        color: 0x6b6258, alpha: 0.2, drag: 2.5,
      });
    }
  }

  embers(at: THREE.Vector3, count: number, spread: number): void {
    for (let i = 0; i < count; i++) {
      this.glow.spawn({
        x: at.x + rand(-spread, spread), y: at.y + rand(-0.2, 0.2), z: at.z + rand(-spread, spread),
        vx: rand(-0.6, 0.6), vy: rand(0.8, 2.6), vz: rand(-0.6, 0.6),
        life: rand(0.8, 1.8), size: rand(0.03, 0.07), sizeEnd: 0.4,
        color: Math.random() < 0.5 ? 0xff7a2a : 0xffb347, drag: 0.8,
      });
    }
  }

  /** Souls flowing out of a slain enemy into the player. */
  soulStream(from: THREE.Vector3, to: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      this.glow.spawn({
        x: from.x + rand(-0.3, 0.3), y: from.y + rand(-0.4, 0.4), z: from.z + rand(-0.3, 0.3),
        vx: rand(-1.5, 1.5), vy: rand(1, 3), vz: rand(-1.5, 1.5),
        life: 2.5, size: rand(0.06, 0.12), sizeEnd: 0.5,
        color: Math.random() < 0.6 ? 0xd8ffe8 : 0x9fd8ff, drag: 1.4,
        attractor: to, attractStrength: 26,
      });
    }
  }

  /** Continuous flame for a bonfire; call every frame. */
  fire(at: THREE.Vector3, dt: number, intensity = 1): void {
    const n = Math.floor(dt * 90 * intensity + Math.random());
    for (let i = 0; i < n; i++) {
      const r = Math.random() * 0.22;
      const a = Math.random() * Math.PI * 2;
      const hot = Math.random();
      this.glow.spawn({
        x: at.x + Math.cos(a) * r, y: at.y + rand(0, 0.15), z: at.z + Math.sin(a) * r,
        vx: rand(-0.15, 0.15), vy: rand(1.0, 2.2), vz: rand(-0.15, 0.15),
        life: rand(0.35, 0.8), size: rand(0.18, 0.34) * intensity, sizeEnd: 0.15,
        color: hot < 0.3 ? 0xffd27a : hot < 0.75 ? 0xff7a1e : 0xd8401a, alpha: 0.75, drag: 0.5,
      });
    }
    if (Math.random() < dt * 8 * intensity) {
      this.glow.spawn({
        x: at.x + rand(-0.2, 0.2), y: at.y + 0.4, z: at.z + rand(-0.2, 0.2),
        vx: rand(-0.4, 0.4), vy: rand(1.5, 3), vz: rand(-0.4, 0.4),
        life: rand(1.5, 3), size: rand(0.03, 0.05), sizeEnd: 0.5, color: 0xffa040, drag: 0.4,
      });
    }
  }

  /** A pulsing wisp, for bloodstains, items and the like; call every frame. */
  wisp(at: THREE.Vector3, dt: number, color: number, rate = 14): void {
    if (Math.random() > dt * rate) return;
    this.glow.spawn({
      x: at.x + rand(-0.12, 0.12), y: at.y + rand(0, 0.1), z: at.z + rand(-0.12, 0.12),
      vx: rand(-0.1, 0.1), vy: rand(0.2, 0.7), vz: rand(-0.1, 0.1),
      life: rand(0.8, 1.4), size: rand(0.08, 0.16), sizeEnd: 0.3, color, alpha: 0.8, drag: 0.5,
    });
  }

  /** Drifting ash around a point (the camera); call every frame. */
  ash(around: THREE.Vector3, dt: number): void {
    const n = Math.floor(dt * 25 + Math.random());
    for (let i = 0; i < n; i++) {
      this.glow.spawn({
        x: around.x + rand(-14, 14), y: around.y + rand(-2, 8), z: around.z + rand(-14, 14),
        vx: rand(0.1, 0.5), vy: rand(-0.35, -0.1), vz: rand(-0.2, 0.2),
        life: rand(4, 7), size: rand(0.025, 0.05), color: 0x9a8f86, alpha: 0.5,
      });
    }
  }

  /** A ring of fire embers, used along boss shockwaves. */
  ring(center: THREE.Vector3, radius: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      this.glow.spawn({
        x: center.x + Math.cos(a) * radius, y: 0.15, z: center.z + Math.sin(a) * radius,
        vx: Math.cos(a) * 0.8, vy: rand(1, 3), vz: Math.sin(a) * 0.8,
        life: rand(0.3, 0.6), size: rand(0.12, 0.22), sizeEnd: 0.3,
        color: Math.random() < 0.5 ? 0xff6a1a : 0xffb040, drag: 1,
      });
    }
  }
}
