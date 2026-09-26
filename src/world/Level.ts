import * as THREE from 'three';
import { mulberry32, randRange } from '../core/math';
import { ASHEN_WARDEN, FALLEN_KNIGHT, HOLLOW } from '../entities/roster';
import type { EnemyProfile } from '../entities/Enemy';
import { CollisionWorld, type Box } from '../physics/Collision';
import type { Effects } from '../render/Effects';
import { Humanoid } from '../render/Humanoid';
import { Animator } from '../render/Animator';
import { KNEEL_POSE } from '../render/poses';
import { stoneTextures } from '../render/textures';
import { Bonfire } from './Bonfire';
import { FogGate } from './FogGate';
import { GroundMessage, ItemPickup, ShortcutGate } from './props';

/**
 * The entire world, which is very small:
 *
 *   Shrine (bonfire) → Hollow Path (+ ambush alcove) → Broken Bridge over the
 *   abyss → Gatehouse (knight, fog) → Arena of the Ashen Warden.
 *   A cliffside ledge loops from the Gatehouse back to a locked gate in the
 *   Shrine: the shortcut.
 *
 * Coordinates are metres on the XZ plane; the path runs towards +Z.
 */

export interface EnemySpawn {
  profile: EnemyProfile;
  x: number;
  z: number;
  facing: number;
  boss?: boolean;
}

export type ItemId = 'estusShard' | 'knightSoul';

export const ITEMS: Record<ItemId, { name: string; description: string }> = {
  estusShard: { name: 'Estus Shard', description: 'Maximum Estus charges increased by one.' },
  knightSoul: { name: 'Soul of a Lost Knight', description: '400 souls. Some warrior wandered too far from the fire.' },
};

class Torch {
  readonly light: THREE.PointLight;
  readonly flame: THREE.Vector3;
  private readonly seed = Math.random() * 100;

  constructor(parent: THREE.Object3D, x: number, y: number, z: number) {
    const iron = new THREE.MeshStandardMaterial({ color: 0x1e1c1a, metalness: 0.6, roughness: 0.6 });
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.07, 0.2, 8), iron);
    cup.position.set(x, y, z);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), iron);
    stem.position.set(x, y - 0.3, z);
    parent.add(cup, stem);
    this.flame = new THREE.Vector3(x, y + 0.1, z);
    this.light = new THREE.PointLight(0xff8a3a, 5, 11, 1.7);
    this.light.position.set(x, y + 0.5, z);
    parent.add(this.light);
  }

  update(dt: number, time: number, fx: Effects): void {
    const t = time + this.seed;
    this.light.intensity = 5 * (0.85 + Math.sin(t * 13) * 0.07 + Math.sin(t * 29) * 0.05 + Math.random() * 0.05);
    fx.fire(this.flame, dt, 0.45);
  }
}

export class Level {
  readonly root = new THREE.Group();
  readonly collision = new CollisionWorld();
  /** Solid meshes the camera must not clip through. */
  readonly cameraBlockers: THREE.Object3D[] = [];

  readonly spawn = { x: 0, z: -0.7, facing: 0 };
  readonly arenaCenter = { x: 0, z: 57 };
  readonly arenaRadius = 12.5;
  readonly fogEntry = { x: 0, z: 43.4 };
  readonly fogExit = { x: 0, z: 46.3 };

  readonly bonfire: Bonfire;
  readonly finalBonfire: Bonfire;
  readonly fogGate: FogGate;
  readonly shortcut: ShortcutGate;
  readonly messages: GroundMessage[] = [];
  readonly pickups: ItemPickup[] = [];
  readonly enemySpawns: EnemySpawn[] = [
    { profile: HOLLOW, x: 0.4, z: 16.5, facing: Math.PI },
    { profile: HOLLOW, x: -4.6, z: 13.6, facing: Math.PI / 2 },
    { profile: HOLLOW, x: 0, z: 29, facing: Math.PI },
    { profile: FALLEN_KNIGHT, x: 0, z: 40.2, facing: Math.PI },
    { profile: ASHEN_WARDEN, x: 0, z: 62, facing: Math.PI, boss: true },
  ];

  private readonly torches: Torch[] = [];
  private readonly rng = mulberry32(1337);
  private readonly floorMat: THREE.MeshStandardMaterial;
  private readonly wallMat: THREE.MeshStandardMaterial;
  private readonly rockMat: THREE.MeshStandardMaterial;
  private groundLayer = 0;

  constructor() {
    const floor = stoneTextures('flagstone', 3);
    const wall = stoneTextures('brick', 5);
    const rock = stoneTextures('rock', 9);
    this.floorMat = new THREE.MeshStandardMaterial({ map: floor.map, bumpMap: floor.bump, bumpScale: 2.5, color: 0x8d877f, roughness: 0.95 });
    this.wallMat = new THREE.MeshStandardMaterial({ map: wall.map, bumpMap: wall.bump, bumpScale: 3, color: 0x847c73, roughness: 0.92 });
    this.rockMat = new THREE.MeshStandardMaterial({ map: rock.map, bumpMap: rock.bump, bumpScale: 4, color: 0x5f5a55, roughness: 1 });

    this.buildShrine();
    this.buildPath();
    this.buildBridge();
    this.buildGatehouse();
    this.buildLedge();
    this.buildArena();
    this.buildScenery();

    this.bonfire = new Bonfire(0, 0.6);
    this.root.add(this.bonfire.group);
    this.collision.addCircle(0, 0.6, 0.55);

    this.finalBonfire = new Bonfire(this.arenaCenter.x, this.arenaCenter.z, 11);
    this.finalBonfire.group.visible = false;
    this.root.add(this.finalBonfire.group);

    const fogBox = this.collision.addBox(-2, 2, 44, 45);
    this.fogGate = new FogGate(0, 44.5, 4, 4.2, fogBox);
    this.root.add(this.fogGate.mesh);
    // Keep the camera on the near side of the fog while it stands.
    this.cameraBlockers.push(this.fogGate.mesh);

    const gateBox = this.collision.addBox(-8, -7, -1.2, 1.2);
    this.shortcut = new ShortcutGate(-7.5, 0, 2.4, 3.2, true, gateBox);
    this.root.add(this.shortcut.group);

    this.addMessage(0.6, 9.6, 'Be wary of right', 1);
    this.addMessage(-0.3, 21.3, 'Abyss ahead. Therefore, try rolling', 2);
    this.addMessage(1.8, 42.6, 'Fog ahead. Therefore, courage', 3);
    this.addMessage(-9.2, 36, 'Shortcut ahead', 4);

    const corpseLook = { ...HOLLOW.look, eyes: undefined, skin: 0x5a534a };
    this.addPickup(new ItemPickup('estusShard', -10.05, 20, Math.PI / 2, corpseLook));
    this.addPickup(new ItemPickup('knightSoul', -5.55, 15.0, Math.PI * 0.75, { ...FALLEN_KNIGHT.look, eyes: undefined, scale: 1 }));
  }

  update(dt: number, time: number, fx: Effects): void {
    this.bonfire.update(dt, time, fx);
    if (this.finalBonfire.group.visible) this.finalBonfire.update(dt, time, fx);
    this.fogGate.update(dt, time);
    this.shortcut.update(dt);
    for (const t of this.torches) t.update(dt, time, fx);
    for (const m of this.messages) m.update(time);
    for (const p of this.pickups) p.update(dt, fx);
  }

  // --- Areas ------------------------------------------------------------------

  private buildShrine(): void {
    this.ground(-7, 7, -7, 7);
    this.wall(-8, 8, -8, -7, 3.6);
    this.wall(7, 8, -8, 8, 3.2);
    this.wall(-8, -7, -8, -1.2, 3.4);
    this.wall(-8, -7, 1.2, 8, 3.4);
    this.lintel(-8, -7, -1.2, 1.2, 3.3);
    this.wall(-8, -2.5, 7, 8, 3.8);
    this.wall(2.5, 8, 7, 8, 3.8);
    this.lintel(-2.5, 2.5, 7, 8, 3.6);

    for (const [x, z, h] of [
      [-5.8, -5.8, 3.4],
      [5.8, -5.8, 1.6],
      [5.8, 5.8, 3.0],
      [-5.8, 5.8, 1.1],
    ] as const) {
      this.pillar(x, z, 0.42, h);
    }

    // Swords of the fallen, planted around the fire.
    const steel = new THREE.MeshStandardMaterial({ color: 0x57595c, metalness: 0.7, roughness: 0.5 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const r = 2.3 + this.rng() * 0.8;
      const sword = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.015), steel);
      blade.position.y = 0.3;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.04), steel);
      guard.position.y = 0.7;
      sword.add(blade, guard);
      sword.position.set(Math.cos(a) * r, 0, 0.6 + Math.sin(a) * r);
      sword.rotation.set(randRange(this.rng, -0.3, 0.3), this.rng() * 3, randRange(this.rng, -0.3, 0.3));
      blade.castShadow = true;
      this.root.add(sword);
    }

    // Graves along the south wall.
    const graveMat = this.rockMat;
    for (let i = 0; i < 5; i++) {
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9 + this.rng() * 0.4, 0.14), graveMat);
      g.position.set(-4 + i * 2, 0.45, -6.2);
      g.rotation.set(randRange(this.rng, -0.15, 0.15), randRange(this.rng, -0.2, 0.2), randRange(this.rng, -0.15, 0.15));
      g.castShadow = true;
      this.root.add(g);
      this.collision.addBox(g.position.x - 0.35, g.position.x + 0.35, -6.35, -6.05);
    }
    this.rubble(-7, 7, -7, 7, 14);
  }

  private buildPath(): void {
    this.ground(-2.5, 2.5, 7, 20);
    this.wall(2.5, 3.5, 8, 20, 4.6);
    this.wall(-3.5, -2.5, 8, 12, 4.6);
    this.wall(-3.5, -2.5, 15.5, 20, 4.6);
    this.parapet(-2.5, -1.5, 19.6, 20);
    this.parapet(1.5, 2.5, 19.6, 20);

    // Ambush alcove to the right.
    this.ground(-6, -2.5, 12, 15.5);
    this.wall(-7, -6, 11, 16.5, 4.2);
    this.wall(-7, -3.5, 11, 12, 4.2);
    this.wall(-7, -3.5, 15.5, 16.5, 4.2);

    this.torches.push(new Torch(this.root, 2.35, 2.3, 14));
    this.rubble(-2.5, 2.5, 8, 19, 10);
  }

  private buildBridge(): void {
    const deck = new THREE.Mesh(this.boxGeo(3, 0.8, 14, 2), this.floorMat);
    deck.position.set(0, -0.4, 27);
    deck.receiveShadow = true;
    deck.castShadow = true;
    this.root.add(deck);
    this.collision.addGroundRect(-1.5, 1.5, 20, 34);

    // Parapets with missing sections: the abyss is always an option.
    this.parapet(-1.75, -1.5, 20, 24);
    this.parapet(-1.75, -1.5, 26.5, 34);
    this.parapet(1.5, 1.75, 20, 27);
    this.parapet(1.5, 1.75, 29.5, 34);

    // Supports plunging into the dark.
    for (const z of [23, 31]) {
      const pier = new THREE.Mesh(this.boxGeo(2.4, 40, 2.4, 3), this.wallMat);
      pier.position.set(0, -20.8, z);
      this.root.add(pier);
    }
    const arch = new THREE.Mesh(this.boxGeo(3, 1.2, 6, 3), this.wallMat);
    arch.position.set(0, -1.4, 27);
    this.root.add(arch);
  }

  private buildGatehouse(): void {
    this.ground(-5, 5, 34, 44);
    this.wall(5, 6, 34, 45, 5.2);
    this.wall(-6, -5, 34, 37, 5.2);
    this.wall(-6, -5, 39.5, 45, 5.2);
    this.lintel(-6, -5, 37, 39.5, 3.4);
    this.wall(-6, -2, 44, 45, 6.5);
    this.wall(2, 6, 44, 45, 6.5);
    this.lintel(-2, 2, 44, 45, 4.4);
    this.parapet(-5, -1.5, 34, 34.35);
    this.parapet(1.5, 5, 34, 34.35);

    this.torches.push(new Torch(this.root, -2.8, 2.6, 43.85));
    this.torches.push(new Torch(this.root, 2.8, 2.6, 43.85));
    this.rubble(-5, 5, 35, 43, 12);
  }

  private buildLedge(): void {
    this.ground(-10.5, -8, -3, 39.5);
    this.ground(-8, -5, 37, 39.5);
    this.ground(-8, -7, -1.2, 1.2);
    this.cliff(-13, -10.5, -4, 41, 14);
    this.wall(-13, -8, -4, -3, 4);
    this.wall(-13, -5, 39.5, 40.5, 5);
    this.parapet(-8, -6, 36.7, 37);
    this.torches.push(new Torch(this.root, -10.35, 2.4, 24));
    for (const [z0, z1] of [
      [8.5, 13],
      [17, 21.5],
      [25, 30],
      [33, 36.7],
    ] as const) {
      this.parapet(-8.2, -8, z0, z1);
    }
  }

  private buildArena(): void {
    const { x: cx, z: cz } = this.arenaCenter;
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(this.arenaRadius + 1, this.arenaRadius + 1, 1, 48), this.floorMat);
    this.scaleCylinderUVs(floor.geometry as THREE.CylinderGeometry, this.arenaRadius / 2);
    floor.position.set(cx, -0.5 + this.nextGroundOffset(), cz);
    floor.receiveShadow = true;
    this.root.add(floor);
    this.collision.addGroundCircle(cx, cz, this.arenaRadius);
    this.ground(-2, 2, 43.9, 45.6);

    // Ring wall: many overlapping circles make a smooth round boundary.
    const ringR = 13.3;
    const steps = 84;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = cx + Math.cos(a) * ringR;
      const z = cz + Math.sin(a) * ringR;
      if (Math.abs(x - cx) < 2.9 && z < cz) continue;
      this.collision.addCircle(x, z, 1.0);
    }
    // Visible wall segments with buttresses.
    const segs = 28;
    for (let i = 0; i < segs; i++) {
      const a = ((i + 0.5) / segs) * Math.PI * 2;
      const x = cx + Math.cos(a) * (ringR + 0.4);
      const z = cz + Math.sin(a) * (ringR + 0.4);
      if (Math.abs(x - cx) < 3.2 && z < cz) continue;
      const h = 6.5 + this.rng() * 2.5;
      const seg = new THREE.Mesh(this.boxGeo(3.2, h, 1.6, 3), this.wallMat);
      seg.position.set(x, h / 2, z);
      seg.rotation.y = -a + Math.PI / 2;
      seg.castShadow = true;
      seg.receiveShadow = true;
      this.root.add(seg);
      this.cameraBlockers.push(seg);
    }

    const pillarAngles = [-20, 30, 90, 150, 200];
    pillarAngles.forEach((deg, i) => {
      const a = (deg * Math.PI) / 180;
      const broken = i % 2 === 1;
      this.pillar(cx + Math.cos(a) * 9.4, cz + Math.sin(a) * 9.4, 0.62, broken ? 1.4 + this.rng() : 7);
    });

    // A kneeling stone statue watches over the arena.
    const statue = new Humanoid({ ...ASHEN_WARDEN.look, skin: 0x6a655f, armor: 0x6a655f, cloth: 0x5f5a55, metal: 0x77726b, leather: 0x5a5550, eyes: undefined, cape: 0x5f5a55, scale: 2.6 });
    new Animator(statue).apply(KNEEL_POSE, 1, { rate: 1000 });
    statue.root.position.set(cx, 0, cz + 10.6);
    this.collision.addCircle(cx, cz + 10.6, 1.3);
    statue.root.rotation.y = Math.PI;
    this.root.add(statue.root);

    this.torches.push(new Torch(this.root, cx - 3.9, 2.9, 45.9));
    this.torches.push(new Torch(this.root, cx + 3.9, 2.9, 45.9));
    this.rubble(-9, 9, 48, 66, 16);
  }

  private buildScenery(): void {
    // The abyss floor, lost in fog.
    const abyss = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x07080b }));
    abyss.rotation.x = -Math.PI / 2;
    abyss.position.y = -30;
    this.root.add(abyss);

    // Distant spires and ruined towers on the horizon.
    const spireMat = new THREE.MeshStandardMaterial({ color: 0x25262b, roughness: 1, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = 45 + this.rng() * 35;
      const h = 15 + this.rng() * 40;
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.5 + this.rng() * 1.5, 2 + this.rng() * 3, h, 6), spireMat);
      tower.position.set(Math.cos(a) * r, h / 2 - 25, 28 + Math.sin(a) * r);
      this.root.add(tower);
    }
    // Rocks jutting out of the chasm around the bridge.
    for (let i = 0; i < 14; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.5 + this.rng() * 3, 0), this.rockMat);
      const side = i % 2 === 0 ? 1 : -1;
      rock.position.set(side * (7 + this.rng() * 12), -6 - this.rng() * 14, 16 + this.rng() * 22);
      rock.rotation.set(this.rng() * 3, this.rng() * 3, this.rng() * 3);
      this.root.add(rock);
    }
  }

  // --- Builders -----------------------------------------------------------------

  private addMessage(x: number, z: number, text: string, seed: number): void {
    const m = new GroundMessage(x, z, text, seed);
    this.messages.push(m);
    this.root.add(m.mesh);
  }

  private addPickup(p: ItemPickup): void {
    this.pickups.push(p);
    this.root.add(p.group);
  }

  private nextGroundOffset(): number {
    // Tiny offsets stop overlapping floors from z-fighting.
    return (this.groundLayer++ % 8) * 0.003;
  }

  private ground(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.collision.addGroundRect(minX, maxX, minZ, maxZ);
    const w = maxX - minX;
    const d = maxZ - minZ;
    const mesh = new THREE.Mesh(this.boxGeo(w, 1, d, 2), this.floorMat);
    mesh.position.set((minX + maxX) / 2, -0.5 + this.nextGroundOffset(), (minZ + maxZ) / 2);
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  /** A solid wall with a ruined, uneven top. */
  private wall(minX: number, maxX: number, minZ: number, maxZ: number, height: number): Box {
    const box = this.collision.addBox(minX, maxX, minZ, maxZ);
    const w = maxX - minX;
    const d = maxZ - minZ;
    const mesh = new THREE.Mesh(this.boxGeo(w, height, d, 2.5), this.wallMat);
    mesh.position.set((minX + maxX) / 2, height / 2, (minZ + maxZ) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.cameraBlockers.push(mesh);

    // Jagged crenellations along the top.
    const long = Math.max(w, d);
    const alongX = w >= d;
    const pieces = Math.floor(long / 1.4);
    for (let i = 0; i < pieces; i++) {
      if (this.rng() < 0.45) continue;
      const ph = 0.3 + this.rng() * 1.3;
      const len = 0.6 + this.rng() * 0.9;
      const t = (i + 0.5) / pieces;
      const piece = new THREE.Mesh(this.boxGeo(alongX ? len : w, ph, alongX ? d : len, 2.5), this.wallMat);
      piece.position.set(alongX ? minX + t * w : (minX + maxX) / 2, height + ph / 2, alongX ? (minZ + maxZ) / 2 : minZ + t * d);
      piece.castShadow = true;
      this.root.add(piece);
    }
    return box;
  }

  /** A beam across an opening, above head height (visual only). */
  private lintel(minX: number, maxX: number, minZ: number, maxZ: number, bottom: number): void {
    const w = maxX - minX;
    const d = maxZ - minZ;
    const mesh = new THREE.Mesh(this.boxGeo(w + 0.4, 0.9, d, 2.5), this.wallMat);
    mesh.position.set((minX + maxX) / 2, bottom + 0.45, (minZ + maxZ) / 2);
    mesh.castShadow = true;
    this.root.add(mesh);
  }

  private parapet(minX: number, maxX: number, minZ: number, maxZ: number): void {
    this.collision.addBox(minX, maxX, minZ, maxZ);
    const w = maxX - minX;
    const d = maxZ - minZ;
    const h = 0.7 + this.rng() * 0.25;
    const mesh = new THREE.Mesh(this.boxGeo(w, h, d, 2), this.wallMat);
    mesh.position.set((minX + maxX) / 2, h / 2, (minZ + maxZ) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  private cliff(minX: number, maxX: number, minZ: number, maxZ: number, height: number): void {
    this.collision.addBox(minX, maxX, minZ, maxZ);
    const segs = Math.ceil((maxZ - minZ) / 4);
    for (let i = 0; i < segs; i++) {
      const z0 = minZ + (i / segs) * (maxZ - minZ);
      const z1 = minZ + ((i + 1) / segs) * (maxZ - minZ);
      const h = height * (0.8 + this.rng() * 0.5);
      const mesh = new THREE.Mesh(this.boxGeo(maxX - minX + this.rng(), h + 30, z1 - z0 + 0.5, 4), this.rockMat);
      mesh.position.set((minX + maxX) / 2 - this.rng() * 0.5, h / 2 - 15, (z0 + z1) / 2);
      mesh.rotation.y = randRange(this.rng, -0.05, 0.05);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.cameraBlockers.push(mesh);
    }
  }

  private pillar(x: number, z: number, r: number, height: number): void {
    this.collision.addCircle(x, z, r);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, height, 10), this.wallMat);
    this.scaleCylinderUVs(mesh.geometry as THREE.CylinderGeometry, 1);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.cameraBlockers.push(mesh);
    const base = new THREE.Mesh(new THREE.BoxGeometry(r * 2.4, 0.35, r * 2.4), this.wallMat);
    base.position.set(x, 0.17, z);
    base.receiveShadow = true;
    this.root.add(base);
    if (height > 4) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(r * 2.5, 0.4, r * 2.5), this.wallMat);
      cap.position.set(x, height, z);
      this.root.add(cap);
    }
  }

  private rubble(minX: number, maxX: number, minZ: number, maxZ: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const s = 0.08 + this.rng() * 0.22;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), this.rockMat);
      rock.position.set(randRange(this.rng, minX + 0.3, maxX - 0.3), s * 0.4, randRange(this.rng, minZ + 0.3, maxZ - 0.3));
      rock.rotation.set(this.rng() * 3, this.rng() * 3, this.rng() * 3);
      rock.castShadow = true;
      rock.receiveShadow = true;
      this.root.add(rock);
    }
  }

  /** A box whose UVs are in world units / `tile`, so textures keep a consistent scale. */
  private boxGeo(w: number, h: number, d: number, tile: number): THREE.BoxGeometry {
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    // Faces in order: +x, -x, +y, -y, +z, -z (4 vertices each).
    const dims: Array<[number, number]> = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ];
    for (let face = 0; face < 6; face++) {
      const [su, sv] = dims[face];
      for (let v = 0; v < 4; v++) {
        const i = face * 4 + v;
        uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
      }
    }
    return geo;
  }

  private scaleCylinderUVs(geo: THREE.CylinderGeometry, repeat: number): void {
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repeat * 3, uv.getY(i) * repeat);
  }
}
