/**
 * Unified keyboard/mouse/gamepad input, exposed as abstract actions.
 * Call `update()` once at the start of every frame and `endFrame()` at the end.
 */

export type InputAction =
  | 'light'
  | 'heavyModifier'
  | 'heavy'
  | 'block'
  | 'dodge'
  | 'drink'
  | 'interact'
  | 'lock'
  | 'pause'
  | 'menuUp'
  | 'menuDown'
  | 'confirm'
  | 'back';

const KEY_BINDINGS: Record<string, InputAction[]> = {
  Space: ['dodge'],
  ShiftLeft: ['heavyModifier'],
  ShiftRight: ['heavyModifier'],
  KeyR: ['drink'],
  KeyE: ['interact', 'confirm'],
  Enter: ['confirm'],
  KeyQ: ['lock'],
  Tab: ['lock'],
  KeyF: ['block'],
  Escape: ['pause', 'back'],
  KeyP: ['pause'],
  ArrowUp: ['menuUp'],
  ArrowDown: ['menuDown'],
  KeyW: ['menuUp'],
  KeyS: ['menuDown'],
};

const MOUSE_BINDINGS: Record<number, InputAction[]> = {
  0: ['light'],
  1: ['lock'],
  2: ['block'],
};

// Standard gamepad mapping.
const PAD_BINDINGS: Record<number, InputAction[]> = {
  0: ['interact', 'confirm'],
  1: ['dodge', 'back'],
  2: ['drink'],
  4: ['block'],
  5: ['light'],
  7: ['heavy'],
  6: ['block'],
  9: ['pause'],
  11: ['lock'],
  12: ['menuUp'],
  13: ['menuDown'],
};

const STICK_DEADZONE = 0.18;

export class Input {
  /** Movement: x right, y forward, each -1..1. */
  moveX = 0;
  moveY = 0;
  /** Mouse look delta for this frame, in pixels. */
  lookX = 0;
  lookY = 0;
  /** Right stick deflection, -1..1. Integrate over time for camera speed. */
  stickLookX = 0;
  stickLookY = 0;
  usingGamepad = false;

  private readonly keys = new Set<string>();
  private readonly mouseButtons = new Set<number>();
  private padButtons = new Set<number>();
  private down = new Set<InputAction>();
  private prevDown = new Set<InputAction>();
  private mouseDX = 0;
  private mouseDY = 0;
  private padLookX = 0;
  private padLookY = 0;
  private wheel = 0;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
      this.usingGamepad = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons.clear();
    });
    target.addEventListener('mousedown', (e) => {
      this.mouseButtons.add(e.button);
      this.usingGamepad = false;
    });
    window.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.target) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    window.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  requestPointerLock(): void {
    if (this.pointerLocked) return;
    try {
      const result = this.target.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      // Some browsers refuse without a fresh user gesture; the next click retries.
    }
  }

  exitPointerLock(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  isDown(action: InputAction): boolean {
    return this.down.has(action);
  }

  pressed(action: InputAction): boolean {
    return this.down.has(action) && !this.prevDown.has(action);
  }

  released(action: InputAction): boolean {
    return !this.down.has(action) && this.prevDown.has(action);
  }

  /** Mouse wheel steps this frame. */
  get wheelDelta(): number {
    return this.wheel;
  }

  update(): void {
    this.prevDown = this.down;
    this.down = new Set();
    this.pollGamepad();

    for (const code of this.keys) for (const a of KEY_BINDINGS[code] ?? []) this.down.add(a);
    for (const b of this.mouseButtons) for (const a of MOUSE_BINDINGS[b] ?? []) this.down.add(a);
    for (const b of this.padButtons) for (const a of PAD_BINDINGS[b] ?? []) this.down.add(a);

    // Shift + left click is a heavy attack, like Elden Ring on PC.
    if (this.down.has('light') && this.down.has('heavyModifier') && !this.padButtons.has(5)) {
      this.down.delete('light');
      this.down.add('heavy');
    }

    let mx = 0;
    let my = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    if (this.usingGamepad && len === 0) {
      mx = this.padMoveX;
      my = this.padMoveY;
    }
    this.moveX = mx;
    this.moveY = my;

    this.lookX = this.mouseDX;
    this.lookY = this.mouseDY;
    this.stickLookX = this.padLookX;
    this.stickLookY = this.padLookY;
  }

  endFrame(): void {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  private padMoveX = 0;
  private padMoveY = 0;

  private pollGamepad(): void {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = [...pads].find((p): p is Gamepad => !!p && p.connected);
    this.padButtons = new Set();
    this.padMoveX = this.padMoveY = this.padLookX = this.padLookY = 0;
    if (!pad) return;

    pad.buttons.forEach((b, i) => {
      if (b.pressed || b.value > 0.5) this.padButtons.add(i);
    });
    const dz = (v: number) => (Math.abs(v) < STICK_DEADZONE ? 0 : (v - Math.sign(v) * STICK_DEADZONE) / (1 - STICK_DEADZONE));
    const lx = dz(pad.axes[0] ?? 0);
    const ly = dz(pad.axes[1] ?? 0);
    const rx = dz(pad.axes[2] ?? 0);
    const ry = dz(pad.axes[3] ?? 0);
    if (this.padButtons.size > 0 || lx || ly || rx || ry) this.usingGamepad = true;
    this.padMoveX = lx;
    this.padMoveY = -ly;
    this.padLookX = rx;
    this.padLookY = ry;
  }
}
