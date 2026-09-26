import * as THREE from 'three';

const MAX_SAMPLES = 24;
const LIFETIME = 0.16;

interface Sample {
  base: THREE.Vector3;
  tip: THREE.Vector3;
  age: number;
}

/**
 * A ribbon traced by the blade while an attack is live. Samples are taken
 * from two points on the weapon each frame and fade out over a short time.
 */
export class WeaponTrail {
  readonly mesh: THREE.Mesh;
  private readonly samples: Sample[] = [];
  private readonly geometry = new THREE.BufferGeometry();
  private readonly positions = new Float32Array(MAX_SAMPLES * 2 * 3);
  private readonly alphas = new Float32Array(MAX_SAMPLES * 2);
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();

  constructor(
    private readonly base: THREE.Object3D,
    private readonly tip: THREE.Object3D,
    color: number,
  ) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < MAX_SAMPLES - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(index);

    const material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() { gl_FragColor = vec4(uColor * vAlpha, vAlpha); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  update(dt: number, emitting: boolean): void {
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[0].age > LIFETIME) this.samples.shift();

    if (emitting) {
      this.base.getWorldPosition(this.tmpA);
      this.tip.getWorldPosition(this.tmpB);
      const recycled = this.samples.length >= MAX_SAMPLES ? this.samples.shift()! : null;
      const sample = recycled ?? { base: new THREE.Vector3(), tip: new THREE.Vector3(), age: 0 };
      sample.base.copy(this.tmpA);
      sample.tip.copy(this.tmpB);
      sample.age = 0;
      this.samples.push(sample);
    }

    const count = this.samples.length;
    this.mesh.visible = count >= 2;
    if (!this.mesh.visible) return;
    for (let i = 0; i < MAX_SAMPLES; i++) {
      const s = this.samples[Math.min(i, count - 1)];
      const alpha = i < count ? (1 - s.age / LIFETIME) * 0.4 : 0;
      this.positions.set([s.base.x, s.base.y, s.base.z], i * 6);
      this.positions.set([s.tip.x, s.tip.y, s.tip.z], i * 6 + 3);
      this.alphas[i * 2] = 0;
      this.alphas[i * 2 + 1] = alpha;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.alpha.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
