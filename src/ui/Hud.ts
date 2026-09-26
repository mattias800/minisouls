import { el, setText, setVisible } from './dom';

const PX_PER_HP = 2.4;
const PX_PER_STAMINA = 2.4;

class ResourceBar {
  readonly root: HTMLElement;
  private readonly trail: HTMLElement;
  private readonly fill: HTMLElement;
  private trailRatio = 1;
  private shown = 1;
  private holdTimer = 0;

  constructor(parent: HTMLElement, className: string) {
    this.root = el('div', `bar ${className}`, parent);
    this.trail = el('div', 'trail', this.root);
    this.fill = el('div', 'fill', this.root);
  }

  /** The pale trail lingers after damage, then drains — a series staple. */
  set(ratio: number, dt: number): void {
    if (ratio < this.shown) this.holdTimer = 0.6;
    this.shown = ratio;
    if (ratio >= this.trailRatio) this.trailRatio = ratio;
    else if ((this.holdTimer -= dt) <= 0) this.trailRatio = Math.max(ratio, this.trailRatio - dt * 0.6);
    this.fill.style.width = `${(ratio * 100).toFixed(2)}%`;
    this.trail.style.width = `${(this.trailRatio * 100).toFixed(2)}%`;
  }

  setWidth(px: number): void {
    this.root.style.width = `${Math.round(px)}px`;
  }
}

export interface EnemyBarData {
  id: number;
  x: number;
  y: number;
  ratio: number;
  damage: number;
}

export type BannerStyle = 'death' | 'gold' | 'victory';

/** The in-game heads-up display and transient overlays. */
export class Hud {
  readonly root: HTMLElement;
  private readonly hp: ResourceBar;
  private readonly stamina: ResourceBar;
  private readonly flask: HTMLElement;
  private readonly estusCount: HTMLElement;
  private readonly soulsValue: HTMLElement;
  private readonly soulsGain: HTMLElement;
  private readonly boss: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossBar: ResourceBar;
  private readonly prompt: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly toastTitle: HTMLElement;
  private readonly toastSub: HTMLElement;
  private readonly reticle: HTMLElement;
  private readonly enemyLayer: HTMLElement;
  private readonly enemyBars = new Map<number, { root: HTMLElement; fill: HTMLElement; dmg: HTMLElement }>();
  private readonly banner: HTMLElement;
  private readonly bannerText: HTMLElement;
  private readonly bannerSub: HTMLElement;
  private readonly fadeEl: HTMLElement;
  private readonly messagePanel: HTMLElement;
  private readonly messageText: HTMLElement;

  private displayedSouls = 0;
  private gainTimer = 0;
  private gainAmount = 0;
  private toastTimer = 0;
  private bannerTimer: number | undefined;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud hidden', parent);
    const vitals = el('div', 'vitals', this.root);
    this.hp = new ResourceBar(vitals, 'hp');
    this.stamina = new ResourceBar(vitals, 'stamina');

    const estus = el('div', 'estus', this.root);
    this.flask = el('div', 'flask', estus);
    el('div', 'neck', this.flask);
    el('div', 'body', this.flask);
    this.estusCount = el('div', 'count', estus, '3');

    const souls = el('div', 'souls', this.root);
    this.soulsGain = el('div', 'gain', souls);
    this.soulsValue = el('span', 'value', souls, '0');

    this.boss = el('div', 'boss hidden', this.root);
    this.bossName = el('div', 'name', this.boss);
    this.bossBar = new ResourceBar(this.boss, 'hp');

    this.prompt = el('div', 'prompt hidden', this.root);
    this.toastEl = el('div', 'toast', this.root);
    this.toastTitle = el('div', 'title', this.toastEl);
    this.toastSub = el('div', 'sub', this.toastEl);
    this.enemyLayer = el('div', 'enemies', this.root);
    this.reticle = el('div', 'reticle hidden', this.root);

    this.banner = el('div', 'banner', parent);
    this.bannerText = el('div', 'text', this.banner);
    this.bannerSub = el('div', 'sub', this.banner);
    this.fadeEl = el('div', 'fade', parent);

    this.messagePanel = el('div', 'message-panel hidden', parent);
    this.messageText = el('div', 'text', this.messagePanel);
    el('div', 'rating', this.messagePanel, 'Appraisals: ∞   ·   E to close');
  }

  setVisible(visible: boolean): void {
    setVisible(this.root, visible);
  }

  update(dt: number): void {
    if (this.gainTimer > 0) {
      this.gainTimer -= dt;
      if (this.gainTimer <= 0) {
        this.soulsGain.classList.remove('show');
        this.gainAmount = 0;
      }
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }

  setVitals(hp: number, maxHp: number, stamina: number, maxStamina: number, dt: number): void {
    this.hp.setWidth(maxHp * PX_PER_HP);
    this.stamina.setWidth(maxStamina * PX_PER_STAMINA);
    this.hp.set(maxHp > 0 ? hp / maxHp : 0, dt);
    this.stamina.set(maxStamina > 0 ? stamina / maxStamina : 0, dt);
  }

  setEstus(count: number): void {
    setText(this.estusCount, String(count));
    this.flask.classList.toggle('empty', count <= 0);
  }

  /** Souls tick up towards the real value rather than jumping. */
  setSouls(souls: number, dt: number, instant = false): void {
    if (instant || souls < this.displayedSouls) this.displayedSouls = souls;
    else this.displayedSouls = Math.min(souls, this.displayedSouls + Math.max(1, (souls - this.displayedSouls) * dt * 4));
    setText(this.soulsValue, String(Math.floor(this.displayedSouls)));
  }

  soulsGained(amount: number): void {
    this.gainAmount += amount;
    setText(this.soulsGain, `+${this.gainAmount}`);
    this.soulsGain.classList.add('show');
    this.gainTimer = 2.5;
  }

  showBoss(name: string): void {
    setText(this.bossName, name);
    setVisible(this.boss, true);
  }

  hideBoss(): void {
    setVisible(this.boss, false);
  }

  setBossHealth(ratio: number, dt: number): void {
    this.bossBar.set(ratio, dt);
  }

  setPrompt(html: string | null): void {
    setVisible(this.prompt, html !== null);
    if (html !== null && this.prompt.innerHTML !== html) this.prompt.innerHTML = html;
  }

  toast(title: string, sub = '', seconds = 3.5): void {
    setText(this.toastTitle, title);
    setText(this.toastSub, sub);
    this.toastEl.classList.add('show');
    this.toastTimer = seconds;
  }

  setReticle(pos: { x: number; y: number } | null): void {
    setVisible(this.reticle, pos !== null);
    if (pos) this.reticle.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`;
  }

  setEnemyBars(bars: readonly EnemyBarData[]): void {
    const seen = new Set<number>();
    for (const b of bars) {
      seen.add(b.id);
      let entry = this.enemyBars.get(b.id);
      if (!entry) {
        const root = el('div', 'enemy-bar', this.enemyLayer);
        entry = { root, fill: el('div', 'fill', root), dmg: el('div', 'dmg', root) };
        this.enemyBars.set(b.id, entry);
      }
      entry.root.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px)`;
      entry.fill.style.width = `${(b.ratio * 100).toFixed(1)}%`;
      setText(entry.dmg, b.damage > 0 ? String(Math.round(b.damage)) : '');
    }
    for (const [id, entry] of this.enemyBars) {
      if (!seen.has(id)) {
        entry.root.remove();
        this.enemyBars.delete(id);
      }
    }
  }

  showBanner(text: string, style: BannerStyle, seconds: number, sub = ''): void {
    window.clearTimeout(this.bannerTimer);
    this.banner.className = `banner ${style}`;
    setText(this.bannerText, text);
    setText(this.bannerSub, sub);
    // Force a reflow so the transition restarts.
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), seconds * 1000);
  }

  hideBanner(): void {
    window.clearTimeout(this.bannerTimer);
    this.banner.classList.remove('show');
  }

  /** Fades the screen to black (or white). Resolves when the fade completes. */
  fade(opacity: number, seconds = 1.2, white = false): Promise<void> {
    this.fadeEl.classList.toggle('white', white);
    this.fadeEl.style.transition = `opacity ${seconds}s ease`;
    this.fadeEl.style.opacity = String(opacity);
    return new Promise((resolve) => window.setTimeout(resolve, seconds * 1000));
  }

  showMessage(text: string | null): void {
    setVisible(this.messagePanel, text !== null);
    if (text !== null) setText(this.messageText, text);
  }

  get messageOpen(): boolean {
    return !this.messagePanel.classList.contains('hidden');
  }
}
