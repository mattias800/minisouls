import * as THREE from 'three';
import { AudioEngine } from '../audio/Audio';
import { CombatSystem } from '../combat/CombatSystem';
import { Shockwave } from '../combat/Shockwave';
import { NG_PLUS_SCALING, PLAYER } from '../config/balance';
import { Emitter } from '../core/Emitter';
import { clamp, distXZ, rightFromYaw, forwardFromYaw } from '../core/math';
import type { Actor } from '../entities/Actor';
import { Boss } from '../entities/Boss';
import type { GameEvents, GameFx, WorldContext } from '../entities/context';
import { Enemy } from '../entities/Enemy';
import { Player, type PlayerIntent } from '../entities/Player';
import { Input } from '../input/Input';
import { CameraRig } from '../render/CameraRig';
import { Effects } from '../render/Effects';
import { Renderer } from '../render/Renderer';
import { Hud, type EnemyBarData } from '../ui/Hud';
import { Menu } from '../ui/Menu';
import { controlsTable, footer, hintLine, titleHeader } from '../ui/screens';
import { ITEMS, Level, type ItemId } from '../world/Level';
import { Bloodstain } from '../world/props';
import { freshProgress, newGamePlus, ProgressStore, type ProgressData } from './Progress';
import { levelUpCost, MAX_STAT, soulLevel, STAT_INFO, STAT_NAMES, type StatName } from './stats';

type GameState = 'title' | 'playing' | 'paused' | 'bonfire' | 'dead' | 'ending';

interface Interaction {
  label: string;
  run: () => void;
}

const MAX_DT = 1 / 30;

/**
 * Top-level orchestration: owns the world, the game state machine, and the
 * rules that tie entities together (souls, bonfires, death, the boss fight).
 */
export class Game {
  private readonly renderer: Renderer;
  private readonly input: Input;
  private readonly audio = new AudioEngine();
  private readonly effects = new Effects();
  private readonly hud: Hud;
  private readonly combat = new CombatSystem();
  private readonly events = new Emitter<GameEvents>();
  private readonly level = new Level();
  private readonly camera: CameraRig;
  private readonly player = new Player();
  private readonly enemies: Enemy[] = [];
  private readonly boss: Boss;
  private readonly bloodstain = new Bloodstain();
  private readonly ctx: WorldContext;
  private readonly fx: GameFx;
  private shockwaves: Shockwave[] = [];

  private progress: ProgressData = freshProgress();
  private state: GameState = 'title';
  private time = 0;
  private hitstop = 0;
  private bossFight = false;
  private dodgeHeld = 0;
  private saveTimer = 0;
  private timers: { at: number; fn: () => void }[] = [];
  private readonly menus: { title: Menu; controls: Menu; pause: Menu; bonfire: Menu; levelUp: Menu; ending: Menu };
  private activeMenu: Menu | null = null;
  private readonly clickHint: HTMLElement;
  private readonly tmp = new THREE.Vector3();
  private lastFrame = performance.now();

  constructor(container: HTMLElement) {
    this.renderer = new Renderer(container);
    this.input = new Input(this.renderer.canvas);
    this.camera = new CameraRig(this.renderer.camera, this.level.cameraBlockers);
    const ui = document.createElement('div');
    document.body.appendChild(ui);
    this.hud = new Hud(ui);
    this.clickHint = document.createElement('div');
    this.clickHint.className = 'click-hint hidden';
    this.clickHint.textContent = 'Click to capture the mouse';
    ui.appendChild(this.clickHint);

    const scene = this.renderer.scene;
    scene.add(this.level.root, this.bloodstain.group);
    this.effects.addTo(scene);
    this.renderer.onResize((_, h) => this.effects.setViewportHeight(h));

    this.player.addTo(scene);
    for (const spawn of this.level.enemySpawns) {
      const enemy = spawn.boss ? new Boss(spawn.profile, spawn, spawn.facing) : new Enemy(spawn.profile, spawn, spawn.facing);
      enemy.addTo(scene);
      this.enemies.push(enemy);
    }
    this.boss = this.enemies.find((e): e is Boss => e instanceof Boss)!;

    this.fx = {
      sound: (name, at, volume) => this.audio.play(name, at, volume),
      sparks: (at, color, count) => this.effects.sparks(at, color, count),
      blood: (at) => this.effects.blood(at),
      dust: (at, count) => this.effects.dust(at, count),
      embers: (at, count, spread) => this.effects.embers(at, count, spread),
      shake: (amount) => this.camera.shake(amount),
      hitstop: (seconds) => (this.hitstop = Math.max(this.hitstop, seconds)),
    };
    const game = this;
    this.ctx = {
      collision: this.level.collision,
      get player() {
        return game.player;
      },
      enemies: this.enemies,
      fx: this.fx,
      get time() {
        return game.time;
      },
      events: this.events,
      spawnShockwave: (owner, x, z, def) => this.spawnShockwave(owner, x, z, def),
    };

    this.events.on('playerDied', ({ cause }) => this.onPlayerDied(cause));
    this.events.on('enemyKilled', ({ enemy, souls }) => this.onEnemyKilled(enemy, souls));
    this.events.on('bossPhase', ({ phase }) => this.audio.setBossPhase(phase));

    this.menus = this.buildMenus(ui);
    this.bindWindowEvents();
    this.enterTitle();
  }

  start(): void {
    const loop = (now: number) => {
      const dt = Math.min(MAX_DT, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // =============================================================================
  // Frame
  // =============================================================================

  private frame(dt: number): void {
    const input = this.input;
    input.update();

    if (this.activeMenu) this.activeMenu.handleInput(input);
    if (this.state === 'playing' && input.pressed('pause') && !this.hud.messageOpen) this.openPause();

    const simulate = this.state !== 'paused' && this.state !== 'title' && this.state !== 'ending';
    if (simulate) {
      this.time += dt;
      this.runTimers();
      if (this.state === 'playing') this.progress.playTime += dt;
      const simDt = this.hitstop > 0 ? dt * 0.06 : dt;
      this.hitstop = Math.max(0, this.hitstop - dt);
      this.simulate(simDt, dt);
    } else {
      this.effects.update(dt);
      this.level.update(dt, this.time, this.effects);
    }

    if (this.state === 'title' || this.state === 'ending') this.updateTitleCamera(dt);
    else this.camera.update(dt, this.player, this.state === 'playing' && !this.hud.messageOpen ? input : null, this.enemies);

    this.updateHud(dt);
    const cam = this.renderer.camera;
    const right = rightFromYaw(this.camera.yaw);
    this.audio.setListener(this.state === 'title' ? cam.position : this.player.position, right.x, right.z);
    this.renderer.setFocus(this.state === 'title' ? this.tmp.set(0, 0, 2) : this.player.position);
    this.renderer.render();

    this.saveTimer += dt;
    if (this.saveTimer > 10 && this.state === 'playing') this.save();
    input.endFrame();
  }

  private simulate(dt: number, realDt: number): void {
    const intent = this.state === 'playing' && !this.hud.messageOpen ? this.buildIntent(realDt) : undefined;
    if (this.state === 'playing' && this.input.pressed('lock') && !this.hud.messageOpen) {
      this.camera.toggleLock(this.player, this.enemies);
    }

    this.player.update(dt, this.ctx, intent);
    if (this.player.footstepPending) {
      this.player.footstepPending = false;
      this.audio.play('step', undefined, this.player.isSprinting ? 0.8 : 0.5);
    }
    for (const e of this.enemies) e.update(dt, this.ctx);
    this.separateActors();
    this.combat.update([this.player, ...this.enemies], this.ctx);
    this.updateShockwaves(dt);

    this.level.update(realDt, this.time, this.effects);
    this.bloodstain.update(realDt, this.time, this.effects);
    this.effects.update(dt);
    this.effects.ash(this.renderer.camera.position, realDt);

    const lit = this.level.bonfire.lit ? distXZ(this.player.position, this.level.bonfire) : Infinity;
    this.audio.setFireProximity(clamp(1 - lit / 9, 0, 1), realDt);

    if (this.state === 'playing') {
      this.checkBloodstain();
      this.updateInteraction();
    }
  }

  private buildIntent(dt: number): PlayerIntent {
    const input = this.input;
    const f = forwardFromYaw(this.camera.yaw);
    const r = rightFromYaw(this.camera.yaw);
    const moveX = f.x * input.moveY + r.x * input.moveX;
    const moveZ = f.z * input.moveY + r.z * input.moveX;

    // Dodge button: tap to roll, hold to sprint.
    let roll = false;
    if (input.isDown('dodge')) {
      this.dodgeHeld += dt;
    } else {
      if (input.released('dodge') && this.dodgeHeld < PLAYER.dodgeHoldThreshold) roll = true;
      this.dodgeHeld = 0;
    }
    return {
      moveX,
      moveZ,
      sprint: input.isDown('dodge') && this.dodgeHeld >= PLAYER.dodgeHoldThreshold,
      block: input.isDown('block'),
      roll,
      light: input.pressed('light'),
      heavy: input.pressed('heavy'),
      drink: input.pressed('drink'),
      lockTarget: this.camera.lockTarget,
    };
  }

  /** Soft collisions between actors so nobody walks through anybody. */
  private separateActors(): void {
    const actors: Actor[] = [this.player, ...this.enemies].filter((a) => a.alive && a.rig.root.visible);
    for (let i = 0; i < actors.length; i++) {
      for (let j = i + 1; j < actors.length; j++) {
        const a = actors[i];
        const b = actors[j];
        if (Math.abs(a.position.y - b.position.y) > 1.5) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d = Math.hypot(dx, dz);
        const overlap = a.radius + b.radius - d;
        if (overlap <= 0 || d < 1e-4) continue;
        const nx = dx / d;
        const nz = dz / d;
        const total = a.mass + b.mass;
        a.move(-nx * overlap * (b.mass / total), -nz * overlap * (b.mass / total), this.ctx);
        b.move(nx * overlap * (a.mass / total), nz * overlap * (a.mass / total), this.ctx);
      }
    }
  }

  private spawnShockwave(owner: Actor, x: number, z: number, def: { maxRadius: number; speed: number; damage: number }): void {
    const wave = new Shockwave(owner, x, z, def.maxRadius, def.speed, def.damage * owner.outgoingDamageMultiplier());
    this.renderer.scene.add(wave.mesh);
    this.shockwaves.push(wave);
  }

  private updateShockwaves(dt: number): void {
    for (const wave of this.shockwaves) {
      wave.update(dt, this.ctx, (target) => {
        const result = target.takeHit({ damage: wave.hitDamage, poiseDamage: 40, unblockable: true }, wave.origin, 4, this.time, this.ctx);
        this.combat.feedback(null, target, result, wave.hitDamage, this.ctx);
      });
    }
    const [done, alive] = partition(this.shockwaves, (w) => w.finished);
    for (const w of done) w.dispose();
    this.shockwaves = alive;
  }

  // =============================================================================
  // Interactions
  // =============================================================================

  private updateInteraction(): void {
    const interaction = this.player.action.kind === 'free' && !this.hud.messageOpen ? this.findInteraction() : null;
    const key = this.input.usingGamepad ? 'A' : 'E';
    if (this.hud.messageOpen) {
      if (this.input.pressed('interact') || this.input.pressed('back') || Math.hypot(this.input.moveX, this.input.moveY) > 0.5) {
        this.hud.showMessage(null);
      }
      this.hud.setPrompt(null);
      return;
    }
    this.hud.setPrompt(interaction ? `<kbd>${key}</kbd>${interaction.label}` : null);
    if (interaction && this.input.pressed('interact')) interaction.run();
  }

  private findInteraction(): Interaction | null {
    const p = this.player.position;
    const lv = this.level;
    const near = (x: number, z: number, r: number) => Math.hypot(p.x - x, p.z - z) < r;

    if (near(lv.bonfire.x, lv.bonfire.z, 1.9)) {
      return lv.bonfire.lit ? { label: 'Rest at bonfire', run: () => this.rest() } : { label: 'Light bonfire', run: () => this.lightBonfire() };
    }
    if (lv.finalBonfire.group.visible && near(lv.finalBonfire.x, lv.finalBonfire.z, 1.9)) {
      return { label: 'Link the fire', run: () => this.linkTheFire() };
    }
    if (lv.fogGate.active && !this.bossFight && p.z < 44 && near(lv.fogEntry.x, lv.fogEntry.z, 1.7)) {
      return { label: 'Traverse the white fog', run: () => this.enterFog() };
    }
    for (const item of lv.pickups) {
      if (!item.taken && near(item.x, item.z, 1.5)) return { label: 'Pick up', run: () => this.pickUp(item.id as ItemId) };
    }
    const gate = lv.shortcut;
    if (!gate.open && near(gate.x, gate.z, 1.9)) {
      return p.x < gate.x
        ? { label: 'Open gate', run: () => this.openShortcut() }
        : { label: 'Examine', run: () => this.hud.showMessage('It will not open from this side.') };
    }
    for (const m of lv.messages) {
      if (near(m.x, m.z, 1.1)) return { label: 'Read message', run: () => this.hud.showMessage(m.text) };
    }
    return null;
  }

  private lightBonfire(): void {
    this.progress.bonfireLit = true;
    this.player.playScripted('kneel', 1.8);
    this.faceBonfire();
    this.later(0.6, () => {
      this.level.bonfire.setLit(true);
      this.audio.play('bonfireLit', this.player.position);
      this.hud.showBanner('BONFIRE LIT', 'gold', 3);
    });
    this.save();
  }

  private rest(): void {
    this.faceBonfire();
    this.player.sitDown();
    this.player.restore();
    this.camera.lockTarget = null;
    this.audio.play('rest', this.player.position);
    this.resetWorld();
    this.save();
    this.state = 'bonfire';
    this.hud.setPrompt(null);
    this.later(0.5, () => this.openMenu(this.menus.bonfire));
  }

  private leaveBonfire(): void {
    this.closeMenu();
    this.state = 'playing';
    this.player.rise();
    this.input.requestPointerLock();
  }

  private faceBonfire(): void {
    const b = this.level.bonfire;
    this.player.facing = this.player.yawTo(b);
  }

  private enterFog(): void {
    const fog = this.level.fogGate;
    this.player.position.x = clamp(this.player.position.x, -1.2, 1.2);
    this.player.facing = 0;
    this.camera.lockTarget = null;
    this.audio.play('fog', this.player.position);
    // Let the player pass while the walk-through plays, then seal it behind them.
    fog.setActive(false, true);
    const distance = this.level.fogExit.z - this.player.position.z;
    this.player.playScripted('walk', 1.6, () => {
      fog.setActive(true, true);
      if (!this.progress.bossDefeated && !this.bossFight) this.startBossFight();
    }, { x: 0, z: distance / 1.6 });
  }

  private startBossFight(): void {
    this.bossFight = true;
    this.boss.awaken();
    this.hud.showBoss(this.boss.name);
    this.audio.startBossMusic();
  }

  private pickUp(id: ItemId): void {
    const item = this.level.pickups.find((p) => p.id === id);
    if (!item || item.taken) return;
    item.taken = true;
    this.progress.pickupsTaken.push(id);
    this.player.playScripted('interact', 0.9);
    this.audio.play('pickup', this.player.position);
    if (id === 'estusShard') {
      this.progress.estusMax += 1;
      this.player.estusMax = this.progress.estusMax;
      this.player.estus += 1;
    } else if (id === 'knightSoul') {
      this.addSouls(400);
    }
    this.hud.toast(ITEMS[id].name, ITEMS[id].description, 4);
    this.save();
  }

  private openShortcut(): void {
    this.progress.shortcutOpen = true;
    this.level.shortcut.setOpen(true);
    this.player.playScripted('interact', 1.3);
    this.audio.play('gate', this.level.shortcut.group.position);
    this.save();
  }

  private checkBloodstain(): void {
    const stain = this.bloodstain;
    if (!stain.active || !this.player.alive) return;
    if (Math.hypot(this.player.position.x - stain.x, this.player.position.z - stain.z) > 1.0) return;
    const souls = stain.souls;
    stain.clear();
    this.progress.bloodstain = null;
    this.addSouls(souls);
    this.audio.play('souls');
    this.hud.toast('Souls retrieved', `${souls} souls`, 2.5);
    this.save();
  }

  private addSouls(amount: number): void {
    this.progress.souls += amount;
    this.hud.soulsGained(amount);
  }

  // =============================================================================
  // Death, rebirth, victory
  // =============================================================================

  private onEnemyKilled(enemy: Actor, souls: number): void {
    const from = this.tmp.set(enemy.position.x, enemy.position.y + enemy.chestHeight, enemy.position.z).clone();
    this.later(0.5, () => {
      this.effects.soulStream(from, this.player.position, enemy === this.boss ? 160 : 36);
      this.addSouls(souls);
    });
    this.later(1.1, () => this.audio.play('souls', undefined, 0.8));
    if (enemy === this.boss) this.onBossDefeated();
  }

  private onBossDefeated(): void {
    this.progress.bossDefeated = true;
    this.bossFight = false;
    this.camera.lockTarget = null;
    this.audio.stopBossMusic(3);
    this.fx.hitstop(0.25);
    this.camera.shake(0.6);
    this.later(1.8, () => {
      this.hud.hideBoss();
      this.hud.showBanner('GREAT ENEMY FELLED', 'victory', 5);
      this.audio.play('victory');
    });
    this.later(4.5, () => {
      this.level.fogGate.setActive(false);
      const fire = this.level.finalBonfire;
      fire.group.visible = true;
      fire.setLit(true);
      this.audio.play('bonfireLit', fire.group.position);
    });
    this.save();
  }

  private onPlayerDied(cause: 'combat' | 'fall'): void {
    if (this.state !== 'playing' && this.state !== 'bonfire') return;
    this.state = 'dead';
    this.closeMenu();
    this.hud.setPrompt(null);
    this.hud.showMessage(null);
    this.camera.lockTarget = null;
    const p = this.progress;
    p.deaths++;
    const spot = cause === 'fall' ? this.player.lastSafe : this.player.position;
    // Dying again forfeits the previous bloodstain for good.
    p.bloodstain = p.souls > 0 ? { x: spot.x, z: spot.z, souls: p.souls } : null;
    p.souls = 0;
    this.bloodstain.clear();
    this.save();

    this.later(cause === 'fall' ? 0.2 : 0.9, () => {
      this.audio.play('youDied');
      this.hud.showBanner('YOU DIED', 'death', 4.2);
    });
    this.later(5.4, () => void this.hud.fade(1, 1.0));
    this.later(6.5, () => {
      this.respawn();
      void this.hud.fade(0, 1.4);
    });
  }

  private respawn(): void {
    this.resetWorld();
    this.placeAtBonfire(true);
    this.state = 'playing';
  }

  /** Enemies return, the boss resets, bloodstains and gates reflect saved progress. */
  private resetWorld(): void {
    const p = this.progress;
    const difficulty = Math.pow(NG_PLUS_SCALING, p.cycle);
    for (const e of this.enemies) {
      e.setDifficulty(difficulty);
      e.reset();
    }
    if (p.bossDefeated) {
      this.boss.action = { kind: 'dead', t: 99 };
      this.boss.rig.root.visible = false;
    }
    for (const w of this.shockwaves) w.dispose();
    this.shockwaves = [];
    if (this.bossFight) {
      this.bossFight = false;
      this.audio.stopBossMusic(1);
    }
    this.hud.hideBoss();
    this.level.fogGate.setActive(!p.bossDefeated, true);
    const fire = this.level.finalBonfire;
    fire.group.visible = p.bossDefeated;
    fire.setLit(p.bossDefeated, true);
    if (p.bloodstain) this.bloodstain.place(p.bloodstain.x, p.bloodstain.z, p.bloodstain.souls);
    else this.bloodstain.clear();
  }

  private placeAtBonfire(rise: boolean): void {
    const s = this.level.spawn;
    this.player.applyStats(this.progress.stats, this.progress.estusMax);
    this.player.placeAt(s.x, s.z, s.facing);
    this.player.restore();
    this.player.sitDown();
    this.camera.snap(this.player.position, s.facing + 0.35);
    if (rise) this.later(0.9, () => this.player.rise());
  }

  private async linkTheFire(): Promise<void> {
    this.state = 'ending';
    this.hud.setPrompt(null);
    this.player.playScripted('kneel', 99);
    this.audio.play('bonfireLit', this.player.position);
    await this.hud.fade(1, 3, true);
    this.hud.setVisible(false);
    this.openMenu(this.menus.ending);
    await this.hud.fade(0, 1.5, true);
  }

  // =============================================================================
  // Flow & menus
  // =============================================================================

  private enterTitle(): void {
    this.state = 'title';
    this.hud.setVisible(false);
    this.hud.hideBanner();
    this.input.exitPointerLock();
    this.progress = ProgressStore.load() ?? freshProgress();
    this.applyProgressToWorld();
    this.resetWorld();
    this.placeAtBonfire(false);
    this.level.bonfire.setLit(true, true);
    this.openMenu(this.menus.title);
  }

  private async beginGame(fresh: boolean): Promise<void> {
    this.audio.unlock();
    this.closeMenu();
    await this.hud.fade(1, 0.8);
    this.progress = fresh ? freshProgress() : (ProgressStore.load() ?? freshProgress());
    if (fresh) ProgressStore.save(this.progress);
    this.startRun();
    await this.hud.fade(0, 1.6);
  }

  private startRun(): void {
    this.effects.clear();
    this.applyProgressToWorld();
    this.resetWorld();
    this.placeAtBonfire(true);
    this.hud.setVisible(true);
    this.hud.setSouls(this.progress.souls, 0, true);
    this.state = 'playing';
    this.input.requestPointerLock();
    if (!this.progress.bonfireLit) this.later(2, () => this.hud.toast('The fire has faded', 'Light the bonfire to rest and level up.', 4));
  }

  private applyProgressToWorld(): void {
    const p = this.progress;
    this.level.bonfire.setLit(p.bonfireLit, true);
    this.level.shortcut.setOpen(p.shortcutOpen, true);
    for (const item of this.level.pickups) item.taken = p.pickupsTaken.includes(item.id);
    this.player.applyStats(p.stats, p.estusMax);
  }

  private openPause(): void {
    this.state = 'paused';
    this.input.exitPointerLock();
    this.openMenu(this.menus.pause);
  }

  private resume(): void {
    this.closeMenu();
    this.state = 'playing';
    this.input.requestPointerLock();
  }

  private openMenu(menu: Menu): void {
    this.activeMenu?.close();
    this.activeMenu = menu;
    this.input.exitPointerLock();
    menu.open();
  }

  private closeMenu(): void {
    this.activeMenu?.close();
    this.activeMenu = null;
  }

  private buildMenus(ui: HTMLElement) {
    const audio = this.audio;
    const hasSave = () => ProgressStore.load() !== null;

    const title = new Menu(ui, {
      className: 'title',
      header: titleHeader(),
      items: [
        { label: 'Continue', disabled: () => !hasSave(), action: () => void this.beginGame(false) },
        { label: 'New Game', action: () => void this.beginGame(true) },
        { label: 'Controls', action: () => this.openMenu(this.menus.controls) },
      ],
      footer: footer(hintLine('Sound on. Mouse and keyboard or a controller.'), hintLine('Your progress is saved in this browser.')),
    }, audio);

    const controls = new Menu(ui, {
      title: 'Controls',
      items: [{ label: 'Back', action: () => this.openMenu(this.menus.title) }],
      onBack: () => this.openMenu(this.menus.title),
      footer: footer(controlsTable()),
    }, audio);

    const pause = new Menu(ui, {
      title: 'Paused',
      subtitle: () => `Deaths: ${this.progress.deaths}   ·   Level ${soulLevel(this.progress.stats)}`,
      items: [
        { label: 'Resume', action: () => this.resume() },
        {
          label: 'Quit to title',
          action: () => {
            this.save();
            this.closeMenu();
            this.enterTitle();
          },
        },
      ],
      onBack: () => this.resume(),
      footer: footer(controlsTable()),
    }, audio);

    const bonfire = new Menu(ui, {
      title: 'Bonfire',
      subtitle: () => 'Rested. HP and Estus restored.\nThe hollows have returned.',
      items: [
        { label: 'Level up', action: () => this.openMenu(this.menus.levelUp) },
        { label: 'Leave', action: () => this.leaveBonfire() },
      ],
      onBack: () => this.leaveBonfire(),
    }, audio);

    const statItem = (stat: StatName) => ({
      label: () => `${STAT_INFO[stat].label}   ${this.progress.stats[stat]}`,
      detail: () => STAT_INFO[stat].description,
      disabled: () => this.progress.souls < levelUpCost(soulLevel(this.progress.stats)) || this.progress.stats[stat] >= MAX_STAT,
      action: () => this.levelUp(stat),
    });
    const levelUp = new Menu(ui, {
      title: 'Level Up',
      subtitle: () => {
        const level = soulLevel(this.progress.stats);
        return `Level ${level}   ·   Souls ${this.progress.souls}   ·   Cost ${levelUpCost(level)}\nHP ${this.player.maxHp}   ·   Stamina ${this.player.maxStamina}   ·   Damage ×${this.player.damageMult.toFixed(2)}`;
      },
      items: [...STAT_NAMES.map(statItem), { label: 'Back', action: () => this.openMenu(this.menus.bonfire) }],
      onBack: () => this.openMenu(this.menus.bonfire),
    }, audio);

    const ending = new Menu(ui, {
      className: 'ending',
      header: (() => {
        const h = document.createElement('div');
        h.innerHTML = '<div class="logo">THE EMBER BURNS ANEW</div>';
        return h;
      })(),
      subtitle: () => {
        const minutes = Math.floor(this.progress.playTime / 60);
        const seconds = Math.floor(this.progress.playTime % 60).toString().padStart(2, '0');
        return `You linked the fire of the smallest world.\nDeaths: ${this.progress.deaths}   ·   Time: ${minutes}:${seconds}   ·   Level ${soulLevel(this.progress.stats)}`;
      },
      items: [
        { label: () => `Journey onwards (NG+${this.progress.cycle + 1})`, action: () => void this.startNewGamePlus() },
        {
          label: 'Return to title',
          action: () => {
            this.closeMenu();
            this.enterTitle();
          },
        },
      ],
    }, audio);

    return { title, controls, pause, bonfire, levelUp, ending };
  }

  private levelUp(stat: StatName): void {
    const p = this.progress;
    const cost = levelUpCost(soulLevel(p.stats));
    if (p.souls < cost || p.stats[stat] >= MAX_STAT) return;
    p.souls -= cost;
    p.stats[stat]++;
    this.player.applyStats(p.stats, p.estusMax);
    this.player.restore();
    this.hud.setSouls(p.souls, 0, true);
    this.audio.play('souls');
    this.save();
  }

  private async startNewGamePlus(): Promise<void> {
    this.closeMenu();
    await this.hud.fade(1, 1.2);
    this.progress = newGamePlus(this.progress);
    this.save();
    this.startRun();
    this.hud.toast(`New Game+${this.progress.cycle}`, 'The world grows crueler.', 4);
    await this.hud.fade(0, 1.6);
  }

  private save(): void {
    this.saveTimer = 0;
    ProgressStore.save(this.progress);
  }

  private later(seconds: number, fn: () => void): void {
    this.timers.push({ at: this.time + seconds, fn });
  }

  private runTimers(): void {
    const due = this.timers.filter((t) => t.at <= this.time);
    if (due.length === 0) return;
    this.timers = this.timers.filter((t) => t.at > this.time);
    for (const t of due) t.fn();
  }

  private bindWindowEvents(): void {
    this.renderer.canvas.addEventListener('click', () => {
      this.audio.unlock();
      if (this.state === 'playing') this.input.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      // Browsers release the pointer on Escape; treat that as pausing.
      if (!this.input.pointerLocked && this.state === 'playing' && !this.input.usingGamepad) this.openPause();
    });
    window.addEventListener('keydown', () => this.audio.unlock(), { once: true });
    window.addEventListener('beforeunload', () => {
      if (this.state !== 'title') this.save();
    });
  }

  // =============================================================================
  // Presentation
  // =============================================================================

  private updateTitleCamera(dt: number): void {
    const cam = this.renderer.camera;
    const t = performance.now() / 1000;
    const a = t * 0.05 + 2.2;
    cam.position.set(Math.sin(a) * 5.5, 2.1 + Math.sin(t * 0.2) * 0.2, 0.6 + Math.cos(a) * 5.5);
    cam.lookAt(0, 0.9, 0.6);
    this.effects.ash(cam.position, dt);
    this.player.update(dt, this.ctx);
  }

  private updateHud(dt: number): void {
    const hud = this.hud;
    hud.update(dt);
    const p = this.player;
    this.clickHint.classList.toggle('hidden', !(this.state === 'playing' && !this.input.pointerLocked && !this.input.usingGamepad));
    if (this.state === 'title' || this.state === 'ending') return;

    hud.setVitals(p.hp, p.maxHp, p.stamina, p.maxStamina, dt);
    hud.setEstus(p.estus);
    hud.setSouls(this.progress.souls, dt);
    if (this.bossFight) hud.setBossHealth(this.boss.hp / this.boss.maxHp, dt);
    if (this.activeMenu === this.menus.levelUp) this.menus.levelUp.refresh();

    const lock = this.camera.lockTarget;
    hud.setReticle(lock ? this.project(lock.position.x, lock.position.y + lock.chestHeight * 0.85, lock.position.z) : null);

    const bars: EnemyBarData[] = [];
    for (const e of this.enemies) {
      if (e.isBoss || !e.alive || this.time - e.lastDamagedAt > 4) continue;
      const s = this.project(e.position.x, e.position.y + 2.15 * e.rig.look.scale, e.position.z);
      if (!s) continue;
      bars.push({ id: e.id, x: s.x, y: s.y, ratio: e.hp / e.maxHp, damage: this.time - e.lastDamagedAt < 2 ? e.recentDamage : 0 });
    }
    hud.setEnemyBars(bars);
  }

  private project(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = this.tmp.set(x, y, z).project(this.renderer.camera);
    if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }
}

function partition<T>(items: readonly T[], predicate: (item: T) => boolean): [T[], T[]] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const item of items) (predicate(item) ? yes : no).push(item);
  return [yes, no];
}
