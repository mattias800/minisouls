import { clamp } from '../core/math';
import type { SoundName } from './sounds';

interface Point {
  x: number;
  y: number;
  z: number;
}

const HEARING_RANGE = 32;

/**
 * All sound is synthesised with WebAudio at runtime: no audio files.
 * Positional sounds are attenuated and panned relative to a listener.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private ambience!: GainNode;
  private crackleGain!: GainNode;
  private noise!: AudioBuffer;
  private readonly listener = { x: 0, y: 0, z: 0, rightX: 1, rightZ: 0 };
  private music: BossMusic | null = null;
  private crackleTimer = 0;

  /** Must be called from a user gesture before anything is audible. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = this.bus(0.9);
    this.musicBus = this.bus(0.55);
    this.ambience = this.bus(0.5);
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0;
    this.crackleGain.connect(this.ambience);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.startWind();
  }

  setListener(pos: Point, rightX: number, rightZ: number): void {
    this.listener.x = pos.x;
    this.listener.y = pos.y;
    this.listener.z = pos.z;
    this.listener.rightX = rightX;
    this.listener.rightZ = rightZ;
  }

  /** 0..1, how close the listener is to a lit bonfire. Drives the crackle. */
  setFireProximity(amount: number, dt: number): void {
    if (!this.ctx) return;
    this.crackleGain.gain.value = amount * 0.6;
    this.crackleTimer -= dt;
    if (amount > 0.02 && this.crackleTimer <= 0) {
      this.crackleTimer = 0.03 + Math.random() * 0.18;
      const t = this.ctx.currentTime;
      this.noiseBurst(this.crackleGain, t, 0.012 + Math.random() * 0.02, 1500 + Math.random() * 3000, 'bandpass', 0.3 + Math.random() * 0.7, 1.2);
    }
  }

  play(name: SoundName, at?: Point, volume = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    let gain = volume;
    let pan = 0;
    if (at) {
      const dx = at.x - this.listener.x;
      const dz = at.z - this.listener.z;
      const dist = Math.hypot(dx, at.y - this.listener.y, dz);
      gain *= Math.pow(clamp(1 - dist / HEARING_RANGE, 0, 1), 1.6);
      if (gain < 0.01) return;
      pan = dist > 0.5 ? clamp((dx * this.listener.rightX + dz * this.listener.rightZ) / dist, -0.8, 0.8) : 0;
    }
    const out = ctx.createGain();
    out.gain.value = gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner).connect(this.sfx);
    const t = ctx.currentTime + 0.005;
    RECIPES[name](this, out, t);
    setTimeout(() => out.disconnect(), 6000);
  }

  startBossMusic(): void {
    if (!this.ctx || this.music) return;
    this.music = new BossMusic(this, this.ctx, this.musicBus);
  }

  setBossPhase(phase: number): void {
    this.music?.setPhase(phase);
  }

  stopBossMusic(fade = 2): void {
    this.music?.stop(fade);
    this.music = null;
  }

  // --- Building blocks (used by recipes and music) --------------------------------

  get context(): AudioContext | null {
    return this.ctx;
  }

  tone(
    out: AudioNode,
    t: number,
    opts: { type?: OscillatorType; freq: number; freqEnd?: number; dur: number; gain: number; attack?: number; detune?: number; filter?: number },
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), t + opts.dur);
    if (opts.detune) osc.detune.value = opts.detune;
    const g = ctx.createGain();
    const attack = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    let node: AudioNode = osc;
    if (opts.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.filter;
      osc.connect(f);
      node = f;
    }
    node.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + opts.dur + 0.05);
  }

  noiseBurst(
    out: AudioNode,
    t: number,
    dur: number,
    freq: number,
    type: BiquadFilterType,
    gain: number,
    q = 1,
    freqEnd?: number,
    attack = 0.004,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private bus(gain: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = gain;
    g.connect(this.master);
    return g;
  }

  private startWind(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 380;
    f.Q.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(f.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.22;
    const gustLfo = ctx.createOscillator();
    gustLfo.frequency.value = 0.13;
    const gustGain = ctx.createGain();
    gustGain.gain.value = 0.1;
    gustLfo.connect(gustGain).connect(g.gain);
    src.connect(f).connect(g).connect(this.ambience);
    src.start();
    lfo.start();
    gustLfo.start();
  }
}

type Recipe = (a: AudioEngine, out: AudioNode, t: number) => void;

const RECIPES: Record<SoundName, Recipe> = {
  swingLight: (a, o, t) => a.noiseBurst(o, t, 0.2, 700, 'bandpass', 0.5, 1.4, 2600, 0.06),
  swingHeavy: (a, o, t) => a.noiseBurst(o, t, 0.32, 400, 'bandpass', 0.7, 1.2, 1500, 0.1),
  swingSlam: (a, o, t) => a.noiseBurst(o, t, 0.4, 250, 'bandpass', 0.8, 1, 900, 0.12),
  bash: (a, o, t) => {
    a.tone(o, t, { freq: 140, freqEnd: 60, dur: 0.2, gain: 0.7 });
    a.noiseBurst(o, t, 0.12, 900, 'lowpass', 0.5);
  },
  hit: (a, o, t) => {
    a.noiseBurst(o, t, 0.12, 2200, 'lowpass', 0.8);
    a.noiseBurst(o, t, 0.06, 1200, 'bandpass', 0.6, 3);
    a.tone(o, t, { freq: 190, freqEnd: 60, dur: 0.16, gain: 0.8 });
  },
  hitHeavy: (a, o, t) => {
    a.noiseBurst(o, t, 0.2, 1600, 'lowpass', 1);
    a.noiseBurst(o, t, 0.08, 900, 'bandpass', 0.7, 3);
    a.tone(o, t, { freq: 140, freqEnd: 40, dur: 0.3, gain: 1 });
  },
  block: (a, o, t) => {
    for (const [f, d] of [
      [620, 0.6],
      [1480, 0.45],
      [2330, 0.35],
      [3150, 0.25],
    ] as const) {
      a.tone(o, t, { freq: f * (0.97 + Math.random() * 0.06), dur: d, gain: 0.18 });
    }
    a.noiseBurst(o, t, 0.05, 4000, 'highpass', 0.5);
  },
  guardBreak: (a, o, t) => {
    RECIPES.block(a, o, t);
    a.tone(o, t, { freq: 300, freqEnd: 120, dur: 0.5, gain: 0.5, type: 'triangle' });
    a.noiseBurst(o, t, 0.3, 800, 'lowpass', 0.6);
  },
  roll: (a, o, t) => {
    a.noiseBurst(o, t, 0.25, 900, 'lowpass', 0.35, 1, 300, 0.04);
    a.noiseBurst(o, t + 0.2, 0.15, 300, 'lowpass', 0.4);
  },
  step: (a, o, t) => a.noiseBurst(o, t, 0.07, 350 + Math.random() * 150, 'lowpass', 0.18),
  drink: (a, o, t) => {
    for (let i = 0; i < 3; i++) a.tone(o, t + i * 0.13, { freq: 260, freqEnd: 420, dur: 0.1, gain: 0.25 });
    a.tone(o, t + 0.35, { freq: 880, dur: 1.2, gain: 0.12, attack: 0.05 });
    a.tone(o, t + 0.35, { freq: 1318, dur: 1.4, gain: 0.08, attack: 0.08 });
  },
  enemyDeath: (a, o, t) => {
    a.tone(o, t, { type: 'sawtooth', freq: 120, freqEnd: 45, dur: 0.8, gain: 0.35, filter: 500 });
    a.noiseBurst(o, t + 0.1, 0.9, 1200, 'bandpass', 0.25, 0.8, 300, 0.2);
  },
  playerHurt: (a, o, t) => {
    a.tone(o, t, { type: 'sawtooth', freq: 170, freqEnd: 105, dur: 0.22, gain: 0.35, filter: 900 });
  },
  souls: (a, o, t) => {
    [660, 880, 1320, 1760].forEach((f, i) => a.tone(o, t + i * 0.07, { freq: f, dur: 0.9, gain: 0.1, attack: 0.02 }));
  },
  bonfireLit: (a, o, t) => {
    a.noiseBurst(o, t, 1.4, 200, 'lowpass', 0.7, 0.7, 3200, 0.5);
    [196, 293.7, 392, 587.3].forEach((f, i) => a.tone(o, t + 0.3 + i * 0.05, { freq: f, dur: 3, gain: 0.12, attack: 0.6, type: 'triangle' }));
  },
  rest: (a, o, t) => {
    [220, 329.6, 440].forEach((f) => a.tone(o, t, { freq: f, dur: 2.5, gain: 0.08, attack: 0.8, type: 'triangle' }));
  },
  fog: (a, o, t) => a.noiseBurst(o, t, 1.6, 900, 'bandpass', 0.5, 0.6, 2400, 0.6),
  roar: (a, o, t) => {
    a.tone(o, t, { type: 'sawtooth', freq: 75, freqEnd: 58, dur: 2.2, gain: 0.8, attack: 0.15, filter: 700 });
    a.tone(o, t, { type: 'sawtooth', freq: 79, freqEnd: 60, dur: 2.2, gain: 0.6, attack: 0.15, filter: 500 });
    a.noiseBurst(o, t, 2, 600, 'bandpass', 0.6, 0.8, 250, 0.2);
  },
  slamImpact: (a, o, t) => {
    a.tone(o, t, { freq: 75, freqEnd: 28, dur: 1.1, gain: 1 });
    a.noiseBurst(o, t, 0.6, 500, 'lowpass', 0.9);
    a.noiseBurst(o, t, 0.1, 3000, 'bandpass', 0.4, 1);
  },
  gate: (a, o, t) => {
    a.tone(o, t, { type: 'sawtooth', freq: 70, freqEnd: 95, dur: 2.2, gain: 0.25, attack: 0.1, filter: 400 });
    a.noiseBurst(o, t, 2.2, 1100, 'bandpass', 0.25, 2, 700, 0.2);
    a.tone(o, t + 2.2, { freq: 90, freqEnd: 40, dur: 0.4, gain: 0.6 });
  },
  pickup: (a, o, t) => {
    a.tone(o, t, { freq: 1046.5, dur: 1, gain: 0.12, attack: 0.02 });
    a.tone(o, t + 0.09, { freq: 1568, dur: 1.2, gain: 0.1, attack: 0.02 });
  },
  menuMove: (a, o, t) => a.tone(o, t, { freq: 1400, dur: 0.05, gain: 0.06 }),
  menuConfirm: (a, o, t) => {
    a.tone(o, t, { freq: 880, dur: 0.18, gain: 0.1 });
    a.tone(o, t + 0.06, { freq: 1320, dur: 0.25, gain: 0.08 });
  },
  youDied: (a, o, t) => {
    a.tone(o, t, { freq: 55, dur: 5, gain: 0.7, attack: 0.3 });
    a.tone(o, t, { freq: 58.3, dur: 5, gain: 0.5, attack: 0.5, type: 'triangle' });
    a.tone(o, t, { freq: 82.4, dur: 4.5, gain: 0.35, attack: 0.8, type: 'sawtooth', filter: 300 });
    a.tone(o, t + 0.1, { freq: 116.5, dur: 4, gain: 0.2, attack: 1.2, type: 'sawtooth', filter: 400 });
  },
  victory: (a, o, t) => {
    [146.8, 220, 293.7, 370, 440, 587.3].forEach((f, i) =>
      a.tone(o, t + i * 0.08, { freq: f, dur: 5.5, gain: 0.12, attack: 1.2, type: 'sawtooth', filter: 1400 }),
    );
    a.tone(o, t, { freq: 73.4, dur: 6, gain: 0.4, attack: 0.5 });
  },
  alert: (a, o, t) => a.tone(o, t, { type: 'sawtooth', freq: 210, freqEnd: 140, dur: 0.35, gain: 0.25, filter: 700, attack: 0.03 }),
  fall: (a, o, t) => {
    a.tone(o, t, { type: 'sawtooth', freq: 420, freqEnd: 150, dur: 1.4, gain: 0.25, filter: 1200, attack: 0.05 });
    a.noiseBurst(o, t, 1.6, 1500, 'bandpass', 0.35, 0.8, 400, 0.3);
  },
};

const CHORDS: number[][] = [
  // D minor, Bb major, G minor, A major — i, VI, iv, V.
  [146.83, 174.61, 220.0],
  [116.54, 146.83, 174.61],
  [98.0, 116.54, 146.83],
  [110.0, 138.59, 164.81],
];

/**
 * Generative boss music: a slow, ominous string-and-choir progression with
 * timpani. Phase two adds a driving ostinato.
 */
class BossMusic {
  private readonly out: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly timer: number;
  private nextBar: number;
  private bar = 0;
  private phase = 1;
  private readonly barLength = 3.4;

  constructor(
    private readonly audio: AudioEngine,
    private readonly ctx: AudioContext,
    bus: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.out.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 1.5);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1300;
    this.filter.connect(this.out).connect(bus);
    this.nextBar = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 100);
    this.schedule();
  }

  setPhase(phase: number): void {
    this.phase = phase;
    this.filter.frequency.setTargetAtTime(phase >= 2 ? 2600 : 1300, this.ctx.currentTime, 1);
  }

  stop(fade: number): void {
    window.clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    setTimeout(() => this.out.disconnect(), (fade + 4) * 1000);
  }

  private schedule(): void {
    while (this.nextBar < this.ctx.currentTime + 0.5) {
      this.playBar(this.nextBar, this.bar);
      this.nextBar += this.barLength / (this.phase >= 2 ? 1.25 : 1);
      this.bar++;
    }
  }

  private playBar(t: number, bar: number): void {
    const a = this.audio;
    const chord = CHORDS[bar % CHORDS.length];
    const len = this.barLength / (this.phase >= 2 ? 1.25 : 1);

    // Strings: detuned saws with slow attack.
    for (const f of chord) {
      for (const detune of [-8, 7]) {
        a.tone(this.filter, t, { type: 'sawtooth', freq: f, dur: len + 0.4, gain: 0.05, attack: 0.5, detune });
      }
      // Choir: an octave up, through a vowel-ish band.
      a.tone(this.filter, t, { type: 'triangle', freq: f * 2, dur: len + 0.3, gain: 0.035, attack: 0.9 });
    }
    // Bass.
    a.tone(this.filter, t, { type: 'sawtooth', freq: chord[0] / 2, dur: len, gain: 0.12, attack: 0.1, filter: 300 });
    // Timpani on the downbeat and the third beat.
    this.timpani(t, chord[0] / 2);
    this.timpani(t + len / 2, chord[0] / 2, 0.6);

    if (this.phase >= 2) {
      const steps = 8;
      for (let i = 0; i < steps; i++) {
        const f = i % 4 === 3 ? chord[2] : i % 2 === 0 ? chord[0] : chord[1];
        a.tone(this.filter, t + (i * len) / steps, { type: 'square', freq: f, dur: 0.22, gain: 0.04, filter: 1800 });
      }
    }
  }

  private timpani(t: number, freq: number, gain = 1): void {
    this.audio.tone(this.out, t, { freq: freq * 0.9, freqEnd: freq * 0.7, dur: 0.9, gain: 0.45 * gain });
    this.audio.noiseBurst(this.out, t, 0.15, 400, 'lowpass', 0.25 * gain);
  }
}
