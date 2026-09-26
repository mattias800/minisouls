import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const FOG_COLOR = 0x12151c;

/**
 * Owns the WebGL renderer, the scene's atmosphere (sky, moon, fog, lights)
 * and post-processing. The moonlight shadow follows a focus point so it stays
 * crisp around the player.
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 400);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly moonLight: THREE.DirectionalLight;
  private readonly moonDir = new THREE.Vector3(-0.45, 0.8, 0.4).normalize();
  private readonly sky: THREE.Mesh;
  private readonly resizeListeners: Array<(w: number, h: number) => void> = [];

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    const scene = this.scene;
    scene.background = new THREE.Color(FOG_COLOR);
    scene.fog = new THREE.FogExp2(FOG_COLOR, 0.028);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.12;

    scene.add(new THREE.HemisphereLight(0x7d8cb0, 0x2a2018, 1.5));
    scene.add(new THREE.AmbientLight(0x404a5c, 0.5));

    this.moonLight = new THREE.DirectionalLight(0xb4c2e2, 2.2);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(2048, 2048);
    const cam = this.moonLight.shadow.camera;
    cam.left = cam.bottom = -20;
    cam.right = cam.top = 20;
    cam.near = 1;
    cam.far = 90;
    this.moonLight.shadow.bias = -0.0006;
    this.moonLight.shadow.normalBias = 0.03;
    scene.add(this.moonLight, this.moonLight.target);

    this.sky = this.createSky();
    scene.add(this.sky);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.5, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  onResize(listener: (w: number, h: number) => void): void {
    this.resizeListeners.push(listener);
    listener(window.innerWidth, window.innerHeight);
  }

  /** Keeps the shadow frustum and sky centred on what the camera is looking at. */
  setFocus(point: THREE.Vector3): void {
    this.moonLight.target.position.copy(point);
    this.moonLight.position.copy(point).addScaledVector(this.moonDir, 45);
    this.sky.position.copy(this.camera.position);
  }

  render(): void {
    this.composer.render();
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const l of this.resizeListeners) l(w, h);
  }

  private createSky(): THREE.Mesh {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMoonDir: { value: this.moonDir.clone().setY(0.35).normalize() },
        uFog: { value: new THREE.Color(FOG_COLOR) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uMoonDir;
        uniform vec3 uFog;
        varying vec3 vDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -1.0, 1.0);
          vec3 zenith = vec3(0.03, 0.035, 0.06);
          vec3 col = mix(uFog * 1.15, zenith, smoothstep(0.0, 0.6, h));
          col = mix(col, uFog * 0.7, smoothstep(0.0, -0.3, h));
          float m = dot(d, uMoonDir);
          col += vec3(0.75, 0.8, 0.9) * smoothstep(0.9985, 0.9992, m) * 1.8;
          col += vec3(0.25, 0.3, 0.42) * pow(max(m, 0.0), 60.0) * 0.8;
          col += vec3(0.15, 0.17, 0.25) * pow(max(m, 0.0), 6.0) * 0.25;
          float star = step(0.9975, hash(floor(d * 300.0))) * smoothstep(0.15, 0.5, h);
          col += vec3(star) * 0.5;
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), material);
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    return mesh;
  }
}
