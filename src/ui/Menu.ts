import type { AudioEngine } from '../audio/Audio';
import type { Input } from '../input/Input';
import { el, setText } from './dom';

export interface MenuItem {
  label: string | (() => string);
  detail?: string | (() => string);
  disabled?: () => boolean;
  action: () => void;
}

export interface MenuOptions {
  title?: string;
  subtitle?: () => string;
  items: MenuItem[];
  onBack?: () => void;
  className?: string;
  /** Extra content appended below the items (hints, controls). */
  footer?: HTMLElement;
  /** Content placed above the title (e.g. a logo). */
  header?: HTMLElement;
}

const resolve = (v: string | (() => string) | undefined): string => (typeof v === 'function' ? v() : (v ?? ''));

/** A full-screen, keyboard/gamepad/mouse navigable list menu. */
export class Menu {
  readonly root: HTMLElement;
  private readonly subtitle: HTMLElement | null;
  private readonly rows: { item: MenuItem; node: HTMLElement; label: HTMLElement; detail: HTMLElement }[] = [];
  private selected = 0;
  private opened = false;
  private openedAt = 0;

  constructor(
    parent: HTMLElement,
    private readonly options: MenuOptions,
    private readonly audio: AudioEngine,
  ) {
    this.root = el('div', `screen hidden ${options.className ?? ''}`, parent);
    if (options.header) this.root.appendChild(options.header);
    const list = el('div', 'menu', this.root);
    if (options.title) el('div', 'menu-title', list, options.title);
    this.subtitle = options.subtitle ? el('div', 'menu-subtitle', list) : null;
    options.items.forEach((item, index) => {
      const node = el('div', 'menu-item', list);
      const label = el('span', 'label', node);
      const detail = el('span', 'detail', node);
      node.addEventListener('mouseenter', () => this.select(index, false));
      node.addEventListener('click', () => {
        this.select(index, false);
        this.activate();
      });
      this.rows.push({ item, node, label, detail });
    });
    if (options.footer) this.root.appendChild(options.footer);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    this.opened = true;
    this.openedAt = performance.now();
    this.root.classList.remove('hidden');
    this.selected = Math.max(0, this.rows.findIndex((r) => !r.item.disabled?.()));
    this.refresh();
  }

  close(): void {
    this.opened = false;
    this.root.classList.add('hidden');
  }

  refresh(): void {
    if (this.subtitle && this.options.subtitle) setText(this.subtitle, this.options.subtitle());
    this.rows.forEach((row, i) => {
      setText(row.label, resolve(row.item.label));
      setText(row.detail, resolve(row.item.detail));
      row.node.classList.toggle('selected', i === this.selected);
      row.node.classList.toggle('disabled', !!row.item.disabled?.());
    });
  }

  handleInput(input: Input): void {
    // Ignore the tail of whatever press opened this menu.
    if (!this.opened || performance.now() - this.openedAt < 200) return;
    if (input.pressed('menuUp')) this.move(-1);
    if (input.pressed('menuDown')) this.move(1);
    if (input.pressed('confirm')) this.activate();
    else if (input.pressed('back') && this.options.onBack) {
      this.audio.play('menuMove');
      this.options.onBack();
    }
  }

  private move(delta: number): void {
    const n = this.rows.length;
    this.select((this.selected + delta + n) % n, true);
  }

  private select(index: number, sound: boolean): void {
    if (index === this.selected) return;
    this.selected = index;
    if (sound) this.audio.play('menuMove');
    this.refresh();
  }

  private activate(): void {
    const row = this.rows[this.selected];
    if (!row || row.item.disabled?.()) return;
    this.audio.play('menuConfirm');
    row.item.action();
    if (this.opened) this.refresh();
  }
}
