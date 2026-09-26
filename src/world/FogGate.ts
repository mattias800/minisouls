import * as THREE from 'three';
import type { Box } from '../physics/Collision';

/** A wall of swirling white fog. Walk through deliberately; there is no walking back. */
export class FogGate {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private fade = 1;
  private targetFade = 1;

  constructor(
    readonly x: number,
    readonly z: number,
    width: number,
    height: number,
    private readonly collider: Box,
  ) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uFade;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
          return v;
        }
        void main() {
          vec2 p = vUv * vec2(3.0, 2.5);
          float t = uTime * 0.25;
          vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, -t * 1.3)));
          float n = fbm(p + 2.5 * q + vec2(t * 0.6, -t));
          float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x) * smoothstep(1.0, 0.8, vUv.y) * smoothstep(0.0, 0.05, vUv.y);
          float alpha = (0.25 + n * 0.6) * edge * uFade;
          vec3 col = mix(vec3(0.55, 0.6, 0.66), vec3(0.95), n * n);
          gl_FragColor = vec4(col * 0.85, alpha * 0.8);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.material);
    this.mesh.position.set(x, height / 2, z);
  }

  get active(): boolean {
    return this.targetFade > 0;
  }

  /** Show or hide the fog. Dissolving fades it out over a couple of seconds. */
  setActive(active: boolean, instant = false): void {
    this.targetFade = active ? 1 : 0;
    this.collider.enabled = active;
    if (instant) this.fade = this.targetFade;
  }

  update(dt: number, time: number): void {
    this.fade += (this.targetFade - this.fade) * Math.min(1, dt * 1.2);
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uFade.value = this.fade;
    this.mesh.visible = this.fade > 0.01;
  }
}
