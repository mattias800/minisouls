import * as THREE from 'three';

/**
 * A procedurally built, low-poly humanoid made of primitives arranged in a
 * joint hierarchy. Every character in the game (player, hollows, knight,
 * boss) is one of these with different proportions, colours and gear.
 *
 * Conventions: the model faces +Z, right hand is on -X. Joints use Euler
 * order YXZ so that for limbs X = pitch forward/back, Z = raise sideways,
 * Y = swing horizontally.
 */

export const JOINTS = [
  'body',
  'torso',
  'head',
  'lShoulder',
  'rShoulder',
  'lElbow',
  'rElbow',
  'lHand',
  'rHand',
  'lHip',
  'rHip',
  'lKnee',
  'rKnee',
] as const;

export type JointName = (typeof JOINTS)[number];

export type HelmetStyle = 'knight' | 'hollow' | 'hood' | 'warden';
export type WeaponStyle = 'sword' | 'broken' | 'greatsword';
export type ShieldStyle = 'kite' | 'tower' | 'none';

export interface HumanoidLook {
  scale: number;
  /** Width multiplier for torso and limbs. */
  bulk: number;
  skin: number;
  armor: number;
  cloth: number;
  metal: number;
  leather: number;
  helmet: HelmetStyle;
  weapon: WeaponStyle;
  shield: ShieldStyle;
  /** Glowing eye colour, if any. */
  eyes?: number;
  cape?: number;
  /** Whether the chest and shoulders get plate armour. */
  plated: boolean;
}

/** Height of the hip pivot above the feet at scale 1. */
export const HIP_HEIGHT = 0.95;

export class Humanoid {
  readonly root = new THREE.Group();
  readonly joints: Record<JointName, THREE.Group>;
  /** Points along the blade used for weapon trails and sparks. */
  readonly weaponBase = new THREE.Object3D();
  readonly weaponTip = new THREE.Object3D();
  readonly flask: THREE.Mesh;
  readonly cape: THREE.Group | null = null;
  readonly look: HumanoidLook;

  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private opacity = 1;

  constructor(look: HumanoidLook) {
    this.look = look;
    const j = {} as Record<JointName, THREE.Group>;
    for (const name of JOINTS) {
      const g = new THREE.Group();
      g.name = name;
      g.rotation.order = 'YXZ';
      j[name] = g;
    }
    this.joints = j;

    const b = look.bulk;
    const mSkin = this.material(look.skin, 0.85, 0);
    const mArmor = this.material(look.armor, 0.55, 0.35);
    const mCloth = this.material(look.cloth, 0.95, 0);
    const mMetal = this.material(look.metal, 0.35, 0.8);
    const mLeather = this.material(look.leather, 0.8, 0.05);
    const torsoMat = look.plated ? mArmor : mCloth;
    const limbMat = look.plated ? mArmor : mSkin;

    // --- Hierarchy -----------------------------------------------------------
    this.root.add(j.body);
    j.body.position.y = HIP_HEIGHT;
    j.body.add(j.torso, j.lHip, j.rHip);
    j.torso.position.y = 0.08;
    j.torso.add(j.head, j.lShoulder, j.rShoulder);
    j.head.position.y = 0.56;
    j.lShoulder.position.set(0.25 * b, 0.46, 0);
    j.rShoulder.position.set(-0.25 * b, 0.46, 0);
    j.lShoulder.add(j.lElbow);
    j.rShoulder.add(j.rElbow);
    j.lElbow.position.y = -0.3;
    j.rElbow.position.y = -0.3;
    j.lElbow.add(j.lHand);
    j.rElbow.add(j.rHand);
    j.lHand.position.y = -0.27;
    j.rHand.position.y = -0.27;
    j.lHip.position.set(0.1 * b, -0.06, 0);
    j.rHip.position.set(-0.1 * b, -0.06, 0);
    j.lHip.add(j.lKnee);
    j.rHip.add(j.rKnee);
    j.lKnee.position.y = -0.42;
    j.rKnee.position.y = -0.42;

    // --- Pelvis & skirt -----------------------------------------------------
    this.mesh(new THREE.BoxGeometry(0.34 * b, 0.2, 0.22 * b), mCloth, j.body, [0, 0, 0]);
    this.mesh(new THREE.BoxGeometry(0.37 * b, 0.07, 0.25 * b), mLeather, j.body, [0, 0.09, 0]);
    const skirt = new THREE.CylinderGeometry(0.19 * b, 0.27 * b, 0.4, 8, 1, true);
    this.mesh(skirt, mCloth, j.body, [0, -0.14, 0]);

    // --- Torso: a tapered square prism reads as a heroic V shape ------------
    const chest = new THREE.CylinderGeometry(0.3 * b, 0.21 * b, 0.5, 4, 1);
    chest.rotateY(Math.PI / 4);
    chest.scale(1, 1, 0.62);
    this.mesh(chest, torsoMat, j.torso, [0, 0.27, 0]);
    if (look.plated) {
      // A raised breastplate ridge and a gorget.
      const ridge = new THREE.BoxGeometry(0.06 * b, 0.4, 0.05);
      this.mesh(ridge, mArmor, j.torso, [0, 0.27, 0.13 * b]);
      this.mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.08, 10), mArmor, j.torso, [0, 0.54, 0]);
    } else {
      // Ribs and a rope belt for the hollow look.
      this.mesh(new THREE.BoxGeometry(0.28 * b, 0.04, 0.2 * b), mLeather, j.torso, [0, 0.12, 0]);
    }

    // --- Head -----------------------------------------------------------------
    this.mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 8), mSkin, j.head, [0, 0.0, 0]);
    this.buildHead(look, j.head, { mSkin, mArmor, mCloth, mMetal });

    // --- Arms -----------------------------------------------------------------
    for (const side of [1, -1] as const) {
      const shoulder = side === 1 ? j.lShoulder : j.rShoulder;
      const elbow = side === 1 ? j.lElbow : j.rElbow;
      const hand = side === 1 ? j.lHand : j.rHand;
      this.mesh(new THREE.CapsuleGeometry(0.058 * b, 0.2, 4, 8), limbMat, shoulder, [0, -0.14, 0]);
      if (look.plated) {
        const pauldron = new THREE.SphereGeometry(0.11 * b, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6);
        this.mesh(pauldron, mArmor, shoulder, [0.02 * side, 0.02, 0]);
      }
      this.mesh(new THREE.CapsuleGeometry(0.052 * b, 0.17, 4, 8), limbMat, elbow, [0, -0.13, 0]);
      this.mesh(new THREE.CylinderGeometry(0.066 * b, 0.058 * b, 0.12, 8), look.plated ? mMetal : mLeather, elbow, [0, -0.2, 0]);
      this.mesh(new THREE.BoxGeometry(0.085, 0.09, 0.09), look.plated ? mMetal : mSkin, hand, [0, -0.02, 0]);
    }

    // --- Legs -----------------------------------------------------------------
    for (const side of [1, -1] as const) {
      const hip = side === 1 ? j.lHip : j.rHip;
      const knee = side === 1 ? j.lKnee : j.rKnee;
      this.mesh(new THREE.CapsuleGeometry(0.075 * b, 0.26, 4, 8), look.plated ? mCloth : mSkin, hip, [0, -0.21, 0]);
      this.mesh(new THREE.CapsuleGeometry(0.063 * b, 0.27, 4, 8), limbMat, knee, [0, -0.21, 0]);
      this.mesh(new THREE.BoxGeometry(0.11 * b, 0.07, 0.24), mLeather, knee, [0, -0.44, 0.04]);
      if (look.plated) this.mesh(new THREE.SphereGeometry(0.075 * b, 8, 6), mMetal, knee, [0, 0, 0.03]);
    }

    // --- Gear -----------------------------------------------------------------
    this.buildWeapon(look.weapon, j.rHand, mMetal, mLeather);
    this.buildShield(look.shield, j.lHand, mArmor, mMetal, mLeather);

    const flaskMat = new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7a1a, emissiveIntensity: 2.2 });
    this.materials.push(flaskMat);
    this.flask = this.mesh(new THREE.SphereGeometry(0.055, 10, 8), flaskMat, j.lHand, [0, -0.05, 0.06]);
    this.flask.visible = false;

    if (look.cape !== undefined) {
      const cape = new THREE.Group();
      cape.position.set(0, 0.5, -0.12 * b);
      j.torso.add(cape);
      const capeMat = this.material(look.cape, 1, 0);
      capeMat.side = THREE.DoubleSide;
      const geo = new THREE.PlaneGeometry(0.4 * b, 0.82, 1, 4);
      geo.translate(0, -0.41, 0);
      this.mesh(geo, capeMat, cape, [0, 0, 0]);
      this.cape = cape;
    }

    this.root.scale.setScalar(look.scale);
  }

  setOpacity(opacity: number): void {
    if (opacity === this.opacity) return;
    this.opacity = opacity;
    for (const m of this.materials) {
      m.transparent = opacity < 1;
      m.opacity = opacity;
      m.depthWrite = opacity >= 1;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }

  // --- Construction helpers ---------------------------------------------------

  private material(color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
    this.materials.push(m);
    return m;
  }

  private emissive(color: number, intensity: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity });
    this.materials.push(m);
    return m;
  }

  private mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Object3D,
    position: [number, number, number],
    rotation?: [number, number, number],
  ): THREE.Mesh {
    this.geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private buildHead(
    look: HumanoidLook,
    head: THREE.Group,
    m: Record<'mSkin' | 'mArmor' | 'mCloth' | 'mMetal', THREE.MeshStandardMaterial>,
  ): void {
    const eyeMat = look.eyes !== undefined ? this.emissive(look.eyes, 4) : null;
    const dark = this.material(0x050505, 1, 0);
    switch (look.helmet) {
      case 'knight':
      case 'warden': {
        this.mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.27, 12), m.mMetal, head, [0, 0.16, 0]);
        this.mesh(new THREE.SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), m.mMetal, head, [0, 0.29, 0]);
        this.mesh(new THREE.BoxGeometry(0.2, 0.028, 0.03), dark, head, [0, 0.19, 0.13]);
        if (eyeMat) {
          this.mesh(new THREE.SphereGeometry(0.018, 6, 4), eyeMat, head, [0.045, 0.19, 0.13]);
          this.mesh(new THREE.SphereGeometry(0.018, 6, 4), eyeMat, head, [-0.045, 0.19, 0.13]);
        }
        if (look.helmet === 'warden') {
          // Horns sweeping back, and a jagged crown.
          for (const side of [1, -1]) {
            const horn = new THREE.ConeGeometry(0.035, 0.34, 6);
            this.mesh(horn, m.mArmor, head, [0.12 * side, 0.36, -0.03], [-0.5, 0, -0.7 * side]);
          }
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            this.mesh(new THREE.ConeGeometry(0.02, 0.1, 4), m.mArmor, head, [Math.sin(a) * 0.12, 0.37, Math.cos(a) * 0.12]);
          }
        } else {
          // A short crest on the knight's helm.
          this.mesh(new THREE.BoxGeometry(0.025, 0.08, 0.24), m.mArmor, head, [0, 0.36, -0.01]);
        }
        break;
      }
      case 'hood': {
        const hood = new THREE.SphereGeometry(0.155, 12, 10);
        hood.scale(1, 1.12, 1.08);
        this.mesh(hood, m.mCloth, head, [0, 0.15, -0.015]);
        const face = new THREE.SphereGeometry(0.11, 10, 8);
        face.scale(1, 1.1, 0.6);
        this.mesh(face, dark, head, [0, 0.14, 0.085]);
        if (eyeMat) {
          this.mesh(new THREE.SphereGeometry(0.014, 6, 4), eyeMat, head, [0.035, 0.155, 0.14]);
          this.mesh(new THREE.SphereGeometry(0.014, 6, 4), eyeMat, head, [-0.035, 0.155, 0.14]);
        }
        break;
      }
      case 'hollow': {
        const skull = new THREE.SphereGeometry(0.12, 10, 8);
        skull.scale(0.92, 1.12, 1);
        this.mesh(skull, m.mSkin, head, [0, 0.14, 0.01]);
        this.mesh(new THREE.SphereGeometry(0.03, 6, 4), dark, head, [0.042, 0.15, 0.1]);
        this.mesh(new THREE.SphereGeometry(0.03, 6, 4), dark, head, [-0.042, 0.15, 0.1]);
        if (eyeMat) {
          this.mesh(new THREE.SphereGeometry(0.012, 6, 4), eyeMat, head, [0.042, 0.15, 0.118]);
          this.mesh(new THREE.SphereGeometry(0.012, 6, 4), eyeMat, head, [-0.042, 0.15, 0.118]);
        }
        this.mesh(new THREE.BoxGeometry(0.07, 0.015, 0.02), dark, head, [0, 0.07, 0.1]);
        break;
      }
    }
  }

  private buildWeapon(style: WeaponStyle, hand: THREE.Group, metal: THREE.Material, leather: THREE.Material): void {
    // Blade runs along the hand's local +Z. The hand grips at the origin.
    const length = style === 'greatsword' ? 1.45 : style === 'broken' ? 0.48 : 0.86;
    const width = style === 'greatsword' ? 0.13 : 0.06;
    const guardZ = style === 'greatsword' ? 0.16 : 0.1;
    const grip = new THREE.CylinderGeometry(0.022, 0.022, guardZ * 2 + 0.05, 6);
    grip.rotateX(Math.PI / 2);
    this.mesh(grip, leather, hand, [0, -0.03, 0]);
    this.mesh(new THREE.SphereGeometry(0.035, 6, 5), metal, hand, [0, -0.03, -guardZ - 0.02]);
    this.mesh(new THREE.BoxGeometry(width * 3.4, 0.035, 0.035), metal, hand, [0, -0.03, guardZ]);

    const blade = new THREE.BoxGeometry(width, 0.014, length);
    if (style === 'broken') {
      // Jagged end: skew the far vertices.
      const pos = blade.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getZ(i) > 0 && pos.getX(i) > 0) pos.setZ(i, pos.getZ(i) - 0.12);
      }
    } else {
      // Taper to a point.
      const pos = blade.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) if (pos.getZ(i) > 0) pos.setX(i, pos.getX(i) * 0.25);
    }
    blade.computeVertexNormals();
    this.mesh(blade, metal, hand, [0, -0.03, guardZ + length / 2]);
    if (style === 'greatsword') {
      // A fuller of embers down the blade of the Warden's sword.
      const ember = this.emissive(0xff5a1a, 1.6);
      this.mesh(new THREE.BoxGeometry(width * 0.3, 0.02, length * 0.8), ember, hand, [0, -0.03, guardZ + length * 0.45]);
    }

    hand.add(this.weaponBase, this.weaponTip);
    this.weaponBase.position.set(0, -0.03, guardZ + length * 0.55);
    this.weaponTip.position.set(0, -0.03, guardZ + length);
  }

  private buildShield(style: ShieldStyle, hand: THREE.Group, face: THREE.Material, rim: THREE.Material, back: THREE.Material): void {
    if (style === 'none') return;
    const s = style === 'tower' ? 1.35 : 1;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.3 * s);
    shape.lineTo(0.21 * s, 0.2 * s);
    shape.lineTo(0.19 * s, -0.08 * s);
    shape.lineTo(0, -0.36 * s);
    shape.lineTo(-0.19 * s, -0.08 * s);
    shape.lineTo(-0.21 * s, 0.2 * s);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 });
    // Shape lies in XY facing +Z; turn it so it faces outward (+X) along the forearm.
    geo.rotateY(Math.PI / 2);
    this.mesh(geo, face, hand, [0.07, 0.15, 0]);
    const boss = new THREE.SphereGeometry(0.05 * s, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    boss.rotateZ(-Math.PI / 2);
    this.mesh(boss, rim, hand, [0.12, 0.17, 0]);
    this.mesh(new THREE.BoxGeometry(0.02, 0.2, 0.04), back, hand, [0.05, 0.1, 0]);
  }
}
