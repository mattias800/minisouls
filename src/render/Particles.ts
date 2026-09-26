import * as THREE from 'three';

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  /** Size multiplier reached at end of life. */
  sizeEnd?: number;
  color: THREE.ColorRepresentation;
  alpha?: number;
  gravity?: number;
  /** Velocity damping per second. */
  drag?: number;
  /** If set, the particle is pulled towards this (live) point. */
  attractor?: THREE.Vector3;
  attractStrength?: number;
}

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number; life: number;
  size: number; sizeEnd: number;
  r: number; g: number; b: number;
  alpha: number;
  gravity: number;
  drag: number;
  attractor: THREE.Vector3 | null;
  attractStrength: number;
}

/**
 * CPU-simulated, GPU-drawn point sprites. One pool per blending mode; the
 * game uses an additive pool for embers, sparks and souls, and a normal pool
 * for blood and dust.
 */
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly particles: Particle[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly color = new THREE.Color();

  constructor(private readonly capacity: number, additive: boolean) {
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    const attr = (array: Float32Array, size: number) => new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', attr(this.positions, 3));
    this.geometry.setAttribute('color', attr(this.colors, 3));
    this.geometry.setAttribute('size', attr(this.sizes, 1));
    this.geometry.setAttribute('alpha', attr(this.alphas, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 color;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c) * 4.0;
          float falloff = exp(-d * 3.0) * (1.0 - smoothstep(0.8, 1.0, d));
          if (falloff < 0.01) discard;
          gl_FragColor = vec4(vColor, vAlpha * falloff);
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 10 : 9;
  }

  /** Point sprite size scale; should follow the viewport height. */
  setViewportHeight(height: number): void {
    this.material.uniforms.uScale.value = height * 0.6;
  }

  spawn(s: ParticleSpawn): void {
    if (this.particles.length >= this.capacity) this.particles.shift();
    this.color.set(s.color);
    this.particles.push({
      x: s.x, y: s.y, z: s.z,
      vx: s.vx ?? 0, vy: s.vy ?? 0, vz: s.vz ?? 0,
      age: 0, life: s.life,
      size: s.size, sizeEnd: s.sizeEnd ?? 1,
      r: this.color.r, g: this.color.g, b: this.color.b,
      alpha: s.alpha ?? 1,
      gravity: s.gravity ?? 0,
      drag: s.drag ?? 0,
      attractor: s.attractor ?? null,
      attractStrength: s.attractStrength ?? 0,
    });
  }

  update(dt: number): void {
    const list = this.particles;
    let write = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      if (p.attractor) {
        const dx = p.attractor.x - p.x;
        const dy = p.attractor.y + 1 - p.y;
        const dz = p.attractor.z - p.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        if (d < 0.35) continue; // absorbed
        const k = p.attractStrength * Math.min(1, p.age * 1.5);
        p.vx += (dx / d) * k * dt;
        p.vy += (dy / d) * k * dt;
        p.vz += (dz / d) * k * dt;
      }
      const damping = Math.exp(-p.drag * dt);
      p.vx *= damping;
      p.vy = p.vy * damping - p.gravity * dt;
      p.vz *= damping;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      list[write++] = p;
    }
    list.length = write;

    for (let i = 0; i < write; i++) {
      const p = list[i];
      const u = p.age / p.life;
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
      this.colors[i * 3] = p.r;
      this.colors[i * 3 + 1] = p.g;
      this.colors[i * 3 + 2] = p.b;
      this.sizes[i] = p.size * (1 + (p.sizeEnd - 1) * u);
      // Quick fade in, long fade out.
      this.alphas[i] = p.alpha * Math.min(1, u * 8) * (1 - u * u);
    }
    this.geometry.setDrawRange(0, write);
    for (const name of ['position', 'color', 'size', 'alpha']) this.geometry.attributes[name].needsUpdate = true;
  }

  clear(): void {
    this.particles.length = 0;
    this.geometry.setDrawRange(0, 0);
  }
}
