import * as THREE from 'three';
import { mulberry32 } from '../core/math';

/** Procedural canvas textures, so the game ships with zero image assets. */

export type StonePattern = 'flagstone' | 'brick' | 'rock';

interface StoneTextures {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

const cache = new Map<string, StoneTextures>();

export function stoneTextures(pattern: StonePattern, seed = 1): StoneTextures {
  const key = `${pattern}:${seed}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const size = 512;
  const rng = mulberry32(seed);
  const color = document.createElement('canvas');
  const height = document.createElement('canvas');
  color.width = color.height = height.width = height.height = size;
  const c = color.getContext('2d')!;
  const h = height.getContext('2d')!;

  c.fillStyle = '#6d665e';
  c.fillRect(0, 0, size, size);
  h.fillStyle = '#808080';
  h.fillRect(0, 0, size, size);

  const drawBlock = (x: number, y: number, w: number, bh: number) => {
    const shade = 90 + Math.floor(rng() * 40);
    const tint = Math.floor(rng() * 10);
    c.fillStyle = `rgb(${shade + tint}, ${shade + tint * 0.5}, ${shade - 4})`;
    c.fillRect(x + 2, y + 2, w - 4, bh - 4);
    const hv = 150 + Math.floor(rng() * 60);
    h.fillStyle = `rgb(${hv},${hv},${hv})`;
    h.fillRect(x + 3, y + 3, w - 6, bh - 6);
  };

  if (pattern === 'brick') {
    const rows = 10;
    const bh = size / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 === 0 ? 0 : -size / 8;
      while (x < size) {
        const w = size / 5 + rng() * (size / 6);
        drawBlock(x, r * bh, w, bh);
        if (x + w > size) drawBlock(x - size, r * bh, w, bh);
        x += w;
      }
    }
  } else if (pattern === 'flagstone') {
    // Irregular slabs from a jittered grid.
    const n = 5;
    const cell = size / n;
    for (let gy = 0; gy < n; gy++) {
      for (let gx = 0; gx < n; gx++) {
        if (rng() < 0.25 && gx < n - 1) {
          drawBlock(gx * cell, gy * cell, cell * 2, cell);
          gx++;
        } else {
          drawBlock(gx * cell, gy * cell, cell, cell);
        }
      }
    }
  }

  // Grime blotches.
  for (let i = 0; i < 70; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 10 + rng() * 60;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const dark = rng() < 0.6;
    g.addColorStop(0, dark ? 'rgba(20,18,16,0.22)' : 'rgba(170,160,145,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Speckle noise.
  const img = c.getImageData(0, 0, size, size);
  const himg = h.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng() - 0.5) * (pattern === 'rock' ? 46 : 26);
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
    himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = himg.data[i] + n * 1.4;
  }
  c.putImageData(img, 0, 0);
  h.putImageData(himg, 0, 0);

  // Cracks.
  c.strokeStyle = 'rgba(15,12,10,0.55)';
  h.strokeStyle = 'rgba(0,0,0,0.9)';
  for (let i = 0; i < (pattern === 'rock' ? 26 : 12); i++) {
    let x = rng() * size;
    let y = rng() * size;
    c.lineWidth = h.lineWidth = 1 + rng() * 1.5;
    c.beginPath();
    h.beginPath();
    c.moveTo(x, y);
    h.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (rng() - 0.5) * 50;
      y += (rng() - 0.5) * 50;
      c.lineTo(x, y);
      h.lineTo(x, y);
    }
    c.stroke();
    h.stroke();
  }

  const make = (canvas: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const result = { map: make(color, true), bump: make(height, false) };
  cache.set(key, result);
  return result;
}

/** Glowing orange scrawl for player messages on the ground. */
export function runeTexture(seed: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!;
  const rng = mulberry32(seed);
  c.strokeStyle = 'rgba(255,150,60,0.95)';
  c.shadowColor = 'rgba(255,120,40,1)';
  c.shadowBlur = 12;
  c.lineCap = 'round';
  for (let line = 0; line < 3; line++) {
    const y = 80 + line * 48;
    let x = 30 + rng() * 20;
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(x, y);
    while (x < 220) {
      x += 8 + rng() * 14;
      c.lineTo(x, y + (rng() - 0.5) * 34);
      if (rng() < 0.2) {
        c.stroke();
        x += 10;
        c.beginPath();
        c.moveTo(x, y);
      }
    }
    c.stroke();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
