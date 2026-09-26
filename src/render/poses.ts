import type { AttackAnim, AttackDef } from '../combat/types';
import { clamp01, easeInOutSine, easeInQuad, easeOutCubic, easeOutQuad, TAU } from '../core/math';
import type { JointName } from './Humanoid';

/**
 * Procedural animation as data: a Pose is a set of joint rotations plus a
 * vertical offset of the hips. Actions are expressed as keyframed poses and
 * layered over a procedural locomotion cycle.
 */

export type Euler3 = readonly [number, number, number];

export interface Pose {
  joints: Partial<Record<JointName, Euler3>>;
  /** Hip height offset in metres (negative crouches). */
  lift?: number;
}

const ZERO: Euler3 = [0, 0, 0];

export function mixPose(a: Pose, b: Pose, t: number): Pose {
  const joints: Partial<Record<JointName, Euler3>> = {};
  const names = new Set<JointName>([...(Object.keys(a.joints) as JointName[]), ...(Object.keys(b.joints) as JointName[])]);
  for (const name of names) {
    const ja = a.joints[name] ?? ZERO;
    const jb = b.joints[name] ?? ZERO;
    joints[name] = [ja[0] + (jb[0] - ja[0]) * t, ja[1] + (jb[1] - ja[1]) * t, ja[2] + (jb[2] - ja[2]) * t];
  }
  return { joints, lift: (a.lift ?? 0) + ((b.lift ?? 0) - (a.lift ?? 0)) * t };
}

/** Blends `over` onto `base`, touching only the joints `over` specifies. */
export function overlayPose(base: Pose, over: Pose, weight: number): Pose {
  if (weight <= 0) return base;
  const joints = { ...base.joints };
  for (const name of Object.keys(over.joints) as JointName[]) {
    const jb = base.joints[name] ?? ZERO;
    const jo = over.joints[name]!;
    joints[name] = [jb[0] + (jo[0] - jb[0]) * weight, jb[1] + (jo[1] - jb[1]) * weight, jb[2] + (jo[2] - jb[2]) * weight];
  }
  const lift = over.lift === undefined ? base.lift : (base.lift ?? 0) + (over.lift - (base.lift ?? 0)) * weight;
  return { joints, lift };
}

// ---------------------------------------------------------------------------
// Stances & locomotion
// ---------------------------------------------------------------------------

/** Guard stance: sword low and forward, shield at the side, knees soft. */
export const STANCE: Pose = {
  joints: {
    torso: [0.06, 0.12, 0],
    head: [0, -0.1, 0],
    rShoulder: [-0.25, 0, -0.12],
    rElbow: [-0.75, 0, 0],
    rHand: [0.95, 0, 0],
    lShoulder: [-0.3, 0.1, 0.18],
    lElbow: [-0.9, 0, 0],
    lHand: [0, 0.3, 0],
    lHip: [-0.12, 0, 0.02],
    rHip: [-0.05, 0, -0.02],
    lKnee: [0.22, 0, 0],
    rKnee: [0.18, 0, 0],
  },
  lift: -0.03,
};

export const BLOCK_ARM: Pose = {
  joints: {
    lShoulder: [-1.25, -0.95, 0.05],
    lElbow: [-1.05, 0, 0],
    lHand: [0, 0.1, 0],
    torso: [0.1, 0.25, 0],
  },
};

export interface LocomotionParams {
  /** Stride phase in radians, advanced by distance travelled. */
  phase: number;
  /** 0 = idle, 1 = walk, 2 = sprint. Fractions blend. */
  gait: number;
  time: number;
  blocking: boolean;
}

export function locomotionPose(p: LocomotionParams): Pose {
  const walk = clamp01(p.gait);
  const run = clamp01(p.gait - 1);
  const s = Math.sin(p.phase);
  const c = Math.cos(p.phase);
  const legAmp = 0.5 * walk + 0.35 * run;
  const kneeAmp = 0.55 * walk + 0.55 * run;
  const armAmp = 0.25 * walk + 0.55 * run;
  const breathe = Math.sin(p.time * 2.1) * 0.025 * (1 - walk);

  const base = STANCE.joints;
  const add = (j: Euler3 | undefined, dx: number, dy = 0, dz = 0): Euler3 => {
    const b = j ?? ZERO;
    return [b[0] + dx, b[1] + dy, b[2] + dz];
  };

  const pose: Pose = {
    joints: {
      torso: add(base.torso, breathe + 0.25 * run, -0.06 * s * walk),
      head: add(base.head, -breathe - 0.15 * run),
      lHip: add(base.lHip, -s * legAmp),
      rHip: add(base.rHip, s * legAmp),
      lKnee: add(base.lKnee, Math.max(0, c) * kneeAmp),
      rKnee: add(base.rKnee, Math.max(0, -c) * kneeAmp),
      rShoulder: add(base.rShoulder, -s * armAmp * 0.6 - 0.2 * run),
      rElbow: add(base.rElbow, -0.2 * run),
      rHand: base.rHand ?? ZERO,
      lShoulder: add(base.lShoulder, s * armAmp * 0.5),
      lElbow: add(base.lElbow, -0.2 * run),
      lHand: base.lHand ?? ZERO,
    },
    lift: (STANCE.lift ?? 0) - Math.abs(c) * 0.035 * walk - 0.04 * run,
  };
  return p.blocking ? overlayPose(pose, BLOCK_ARM, 1) : pose;
}

// ---------------------------------------------------------------------------
// Attacks
// ---------------------------------------------------------------------------

interface AttackKeys {
  raised: Pose;
  struck: Pose;
}

const ATTACK_KEYS: Record<AttackAnim, AttackKeys> = {
  slash: {
    raised: {
      joints: {
        torso: [0.05, -0.75, 0],
        rShoulder: [-1.35, -1.35, -0.1],
        rElbow: [-0.55, 0, 0],
        rHand: [1.35, 0, 0.4],
        lShoulder: [-0.5, 0.4, 0.3],
        lHip: [-0.35, 0, 0],
        rHip: [0.2, 0, 0],
      },
    },
    struck: {
      joints: {
        torso: [0.15, 0.8, 0],
        rShoulder: [-1.35, 1.2, 0],
        rElbow: [-0.2, 0, 0],
        rHand: [1.45, 0, 0.3],
        lShoulder: [-0.2, -0.2, 0.4],
        lHip: [-0.45, 0, 0],
        rHip: [0.3, 0, 0],
      },
      lift: -0.08,
    },
  },
  backslash: {
    raised: {
      joints: {
        torso: [0.1, 0.7, 0],
        rShoulder: [-1.2, 1.25, 0],
        rElbow: [-0.7, 0, 0],
        rHand: [1.3, 0, -0.4],
        lShoulder: [-0.2, -0.2, 0.4],
        lHip: [-0.3, 0, 0],
        rHip: [0.25, 0, 0],
      },
    },
    struck: {
      joints: {
        torso: [0.15, -0.8, 0],
        rShoulder: [-1.25, -1.3, -0.1],
        rElbow: [-0.2, 0, 0],
        rHand: [1.45, 0, -0.3],
        lShoulder: [-0.5, 0.4, 0.3],
        lHip: [-0.45, 0, 0],
        rHip: [0.35, 0, 0],
      },
      lift: -0.08,
    },
  },
  overhead: {
    raised: {
      joints: {
        torso: [-0.3, -0.15, 0],
        head: [-0.15, 0, 0],
        rShoulder: [-2.85, 0.15, -0.1],
        rElbow: [-1.1, 0, 0],
        rHand: [1.2, 0, 0],
        lShoulder: [-0.6, 0.2, 0.35],
        lHip: [-0.3, 0, 0],
        rHip: [0.2, 0, 0],
      },
    },
    struck: {
      joints: {
        torso: [0.55, 0.1, 0],
        head: [0.1, 0, 0],
        rShoulder: [-0.85, 0.2, 0],
        rElbow: [-0.1, 0, 0],
        rHand: [1.2, 0, 0],
        lShoulder: [0.3, 0.2, 0.4],
        lHip: [-0.65, 0, 0],
        rHip: [0.45, 0, 0],
        lKnee: [0.6, 0, 0],
      },
      lift: -0.18,
    },
  },
  thrust: {
    raised: {
      joints: {
        torso: [0, -0.5, 0],
        rShoulder: [-0.7, -0.45, -0.25],
        rElbow: [-1.9, 0, 0],
        rHand: [1.9, 0, 0],
        lShoulder: [-0.9, 0.3, 0.3],
        lHip: [-0.3, 0, 0],
        rHip: [0.25, 0, 0],
      },
      lift: -0.08,
    },
    struck: {
      joints: {
        torso: [0.3, 0.35, 0],
        rShoulder: [-1.5, 0.15, 0],
        rElbow: [-0.05, 0, 0],
        rHand: [1.55, 0, 0],
        lShoulder: [0.2, 0.2, 0.3],
        lHip: [-0.8, 0, 0],
        rHip: [0.5, 0, 0],
        lKnee: [0.5, 0, 0],
      },
      lift: -0.15,
    },
  },
  shieldBash: {
    raised: {
      joints: {
        torso: [0, 0.6, 0],
        lShoulder: [-1.0, -0.2, 0.4],
        lElbow: [-1.3, 0, 0],
        rShoulder: [-0.2, 0, -0.3],
        lHip: [-0.2, 0, 0],
      },
    },
    struck: {
      joints: {
        torso: [0.2, -0.45, 0],
        lShoulder: [-1.45, -0.7, 0],
        lElbow: [-0.7, 0, 0],
        rShoulder: [0.2, 0, -0.4],
        lHip: [-0.7, 0, 0],
        rHip: [0.4, 0, 0],
      },
      lift: -0.1,
    },
  },
  sweep: {
    raised: {
      joints: {
        torso: [0.15, -1.0, 0],
        rShoulder: [-1.05, -1.6, -0.2],
        rElbow: [-0.3, 0, 0],
        rHand: [1.5, 0, 0.7],
        lShoulder: [-1.2, -1.2, 0],
        lElbow: [-0.9, 0, 0],
        lHip: [-0.4, 0, 0.1],
        rHip: [0.3, 0, -0.1],
        lKnee: [0.5, 0, 0],
      },
      lift: -0.15,
    },
    struck: {
      joints: {
        torso: [0.2, 1.05, 0],
        rShoulder: [-1.0, 1.45, 0],
        rElbow: [-0.1, 0, 0],
        rHand: [1.55, 0, 0.5],
        lShoulder: [-0.6, 0.9, 0.3],
        lElbow: [-0.6, 0, 0],
        lHip: [-0.55, 0, 0],
        rHip: [0.4, 0, 0],
        lKnee: [0.6, 0, 0],
      },
      lift: -0.2,
    },
  },
  slam: {
    raised: {
      joints: {
        torso: [-0.4, 0, 0],
        head: [-0.2, 0, 0],
        rShoulder: [-3.0, 0.3, -0.1],
        rElbow: [-0.8, 0, 0],
        rHand: [1.1, 0, 0],
        lShoulder: [-3.0, -0.3, 0.1],
        lElbow: [-0.9, 0, 0],
        lHip: [-0.2, 0, 0],
        rHip: [0.1, 0, 0],
      },
      lift: 0.02,
    },
    struck: {
      joints: {
        torso: [0.8, 0, 0],
        head: [0.2, 0, 0],
        rShoulder: [-0.9, 0.35, 0],
        rElbow: [-0.1, 0, 0],
        rHand: [1.3, 0, 0],
        lShoulder: [-0.9, -0.3, 0],
        lElbow: [-0.3, 0, 0],
        lHip: [-1.0, 0, 0],
        rHip: [0.4, 0, 0],
        lKnee: [1.0, 0, 0],
        rKnee: [0.6, 0, 0],
      },
      lift: -0.32,
    },
  },
  leap: {
    raised: {
      joints: {
        torso: [-0.2, 0, 0],
        rShoulder: [-3.0, 0.2, -0.2],
        rElbow: [-0.9, 0, 0],
        rHand: [1.0, 0, 0],
        lShoulder: [-2.9, -0.2, 0.2],
        lElbow: [-0.9, 0, 0],
        lHip: [-0.9, 0, 0],
        rHip: [-0.4, 0, 0],
        lKnee: [1.4, 0, 0],
        rKnee: [1.2, 0, 0],
      },
    },
    struck: {
      joints: {
        torso: [0.85, 0, 0],
        rShoulder: [-0.8, 0.3, 0],
        rElbow: [0, 0, 0],
        rHand: [1.35, 0, 0],
        lShoulder: [-0.8, -0.3, 0],
        lElbow: [-0.3, 0, 0],
        lHip: [-1.1, 0, 0],
        rHip: [0.3, 0, 0],
        lKnee: [1.2, 0, 0],
        rKnee: [0.9, 0, 0],
      },
      lift: -0.4,
    },
  },
  backstab: {
    raised: {
      joints: {
        torso: [0.1, -0.4, 0],
        rShoulder: [-0.6, -0.3, -0.2],
        rElbow: [-2.0, 0, 0],
        rHand: [1.9, 0, 0],
        lShoulder: [-1.2, 0.4, 0.2],
        lElbow: [-0.6, 0, 0],
        lHip: [-0.3, 0, 0],
      },
      lift: -0.05,
    },
    struck: {
      joints: {
        torso: [0.45, 0.2, 0],
        rShoulder: [-1.3, 0.1, 0],
        rElbow: [-0.1, 0, 0],
        rHand: [1.7, 0, 0],
        lShoulder: [-1.0, 0.1, 0.2],
        lElbow: [-0.4, 0, 0],
        lHip: [-0.7, 0, 0],
        rHip: [0.4, 0, 0],
        lKnee: [0.5, 0, 0],
      },
      lift: -0.15,
    },
  },
};

/** Fills in joints a key pose leaves out with the guard stance, so keys blend consistently. */
function withStance(p: Pose, names: readonly JointName[]): Pose {
  const joints: Partial<Record<JointName, Euler3>> = {};
  for (const n of names) joints[n] = p.joints[n] ?? STANCE.joints[n] ?? ZERO;
  return { joints, lift: p.lift ?? STANCE.lift };
}

interface NormalisedKeys extends AttackKeys {
  from: Pose;
}

const NORMALISED_KEYS = Object.fromEntries(
  (Object.entries(ATTACK_KEYS) as [AttackAnim, AttackKeys][]).map(([anim, keys]) => {
    const names = [...new Set([...Object.keys(keys.raised.joints), ...Object.keys(keys.struck.joints)])] as JointName[];
    const normalised: NormalisedKeys = {
      from: withStance({ joints: {} }, names),
      raised: withStance(keys.raised, names),
      struck: withStance(keys.struck, names),
    };
    return [anim, normalised];
  }),
) as Record<AttackAnim, NormalisedKeys>;

/** The pose an attack wants at time `t`, and how strongly it should override locomotion. */
export function attackPose(def: AttackDef, t: number): { pose: Pose; weight: number } {
  const keys = NORMALISED_KEYS[def.anim];
  if (t < def.windup) {
    return { pose: mixPose(keys.from, keys.raised, easeOutQuad(clamp01(t / def.windup))), weight: 1 };
  }
  const tActive = t - def.windup;
  if (tActive < def.active) {
    return { pose: mixPose(keys.raised, keys.struck, easeOutCubic(clamp01(tActive / def.active))), weight: 1 };
  }
  const u = clamp01((tActive - def.active) / def.recovery);
  // Hold the follow-through briefly, then ease back to stance.
  return { pose: keys.struck, weight: 1 - easeInOutSine(clamp01((u - 0.25) / 0.75)) };
}

// ---------------------------------------------------------------------------
// Other actions (t01 = normalised progress through the action)
// ---------------------------------------------------------------------------

export function rollPose(t01: number): Pose {
  const k = Math.sin(Math.PI * clamp01(t01));
  return {
    joints: {
      body: [TAU * easeInOutSine(clamp01(t01)), 0, 0],
      torso: [1.0 * k, 0, 0],
      head: [0.6 * k, 0, 0],
      lHip: [-1.7 * k, 0, 0],
      rHip: [-1.6 * k, 0, 0],
      lKnee: [2.1 * k, 0, 0],
      rKnee: [2.1 * k, 0, 0],
      rShoulder: [-1.2 * k, 0, -0.2],
      lShoulder: [-1.3 * k, 0, 0.2],
      rElbow: [-1.2 * k, 0, 0],
      lElbow: [-1.4 * k, 0, 0],
    },
    lift: -0.5 * k,
  };
}

export function staggerPose(t01: number, heavy: boolean): Pose {
  const k = Math.sin(Math.PI * Math.min(1, clamp01(t01) * 1.6)) * (heavy ? 1.3 : 1);
  return {
    joints: {
      torso: [-0.35 * k, 0.2 * k, 0],
      head: [-0.35 * k, 0, 0],
      rShoulder: [-0.5 * k, 0, -0.7 * k],
      lShoulder: [-0.4 * k, 0, 0.7 * k],
      rElbow: [-0.4, 0, 0],
      lHip: [0.2 * k, 0, 0],
      rHip: [-0.3 * k, 0, 0],
      rKnee: [0.4 * k, 0, 0],
    },
    lift: -0.06 * k,
  };
}

export function deathPose(t01: number): Pose {
  const k = easeInQuad(clamp01(t01));
  return {
    joints: {
      body: [-1.45 * k, 0, 0.1 * k],
      torso: [-0.2 * k, 0.2, 0],
      head: [-0.4 * k, 0.4 * k, 0],
      rShoulder: [-1.5 * k, 0, -0.8 * k],
      lShoulder: [-1.2 * k, 0, 0.9 * k],
      rElbow: [-0.3, 0, 0],
      lElbow: [-0.5, 0, 0],
      lHip: [-0.5 * k, 0, 0.1],
      rHip: [-0.2 * k, 0, -0.1],
      lKnee: [0.7 * k, 0, 0],
      rKnee: [0.2, 0, 0],
    },
    lift: -0.82 * k,
  };
}

/** Face-down collapse used after being backstabbed. `rise` > 0 plays the get-up. */
export function collapsePose(t01: number, rise: number): Pose {
  const k = easeInQuad(clamp01(t01)) * (1 - easeInOutSine(clamp01(rise)));
  return {
    joints: {
      body: [1.35 * k, 0, 0],
      torso: [0.2 * k, 0, 0],
      rShoulder: [-2.2 * k, 0, -0.3],
      lShoulder: [-2.2 * k, 0, 0.3],
      lHip: [0.2 * k, 0, 0],
      rHip: [0.1 * k, 0, 0],
    },
    lift: -0.8 * k,
  };
}

export function drinkPose(t01: number): Pose {
  const k = Math.sin(Math.PI * clamp01(t01));
  const tilt = clamp01((t01 - 0.35) / 0.3) * k;
  return {
    joints: {
      lShoulder: [-1.55 * k, -0.75 * k, 0],
      lElbow: [-1.9 * k, 0, 0],
      lHand: [0.4 * k, 0, 0],
      head: [-0.45 * tilt, 0, 0],
      torso: [-0.1 * tilt, 0.1, 0],
    },
  };
}

export const REST_POSE: Pose = {
  joints: {
    body: [0, 0, 0],
    torso: [0.35, 0, 0],
    head: [0.3, 0, 0],
    lHip: [-1.55, 0.25, 0.15],
    rHip: [-1.55, -0.25, -0.15],
    lKnee: [2.05, 0, 0],
    rKnee: [2.05, 0, 0],
    rShoulder: [-0.9, 0, -0.1],
    rElbow: [-0.9, 0, 0],
    rHand: [0.2, 0, 0],
    lShoulder: [-0.9, 0, 0.1],
    lElbow: [-0.8, 0, 0],
  },
  lift: -0.62,
};

export const KNEEL_POSE: Pose = {
  joints: {
    torso: [0.3, 0, 0],
    head: [0.35, 0, 0],
    lHip: [-1.45, 0, 0.05],
    lKnee: [1.45, 0, 0],
    rHip: [0.2, 0, -0.05],
    rKnee: [1.75, 0, 0],
    rShoulder: [-1.3, 0.3, 0],
    rElbow: [-0.3, 0, 0],
    rHand: [1.4, 0, 0],
    lShoulder: [-0.3, 0, 0.2],
  },
  lift: -0.45,
};

export function roarPose(t01: number, time: number): Pose {
  const k = Math.sin(Math.PI * clamp01(t01));
  const shake = Math.sin(time * 40) * 0.03 * k;
  return {
    joints: {
      torso: [-0.45 * k + shake, 0, 0],
      head: [-0.5 * k, shake, 0],
      rShoulder: [-0.6 * k, 0, -1.3 * k],
      lShoulder: [-0.6 * k, 0, 1.3 * k],
      rElbow: [-0.6 * k, 0, 0],
      lElbow: [-0.6 * k, 0, 0],
      lHip: [-0.3 * k, 0, 0.2 * k],
      rHip: [0.1 * k, 0, -0.2 * k],
    },
    lift: -0.12 * k,
  };
}

export function fallPose(time: number): Pose {
  const w = Math.sin(time * 9);
  return {
    joints: {
      torso: [-0.3, 0, 0],
      head: [-0.5, 0, 0],
      rShoulder: [-2.6 + w * 0.4, 0, -0.5],
      lShoulder: [-2.6 - w * 0.4, 0, 0.5],
      lHip: [-0.6 + w * 0.5, 0, 0],
      rHip: [-0.6 - w * 0.5, 0, 0],
      lKnee: [0.8, 0, 0],
      rKnee: [0.8, 0, 0],
    },
  };
}

/** A corpse slumped against a wall, used for item pickups. */
export const SLUMPED_POSE: Pose = {
  joints: {
    torso: [0.5, 0.2, 0.15],
    head: [0.6, 0.3, 0.2],
    lHip: [-1.5, 0.3, 0.2],
    rHip: [-1.4, -0.4, -0.2],
    lKnee: [0.4, 0, 0],
    rKnee: [1.2, 0, 0],
    rShoulder: [0.1, 0, -0.3],
    lShoulder: [0.2, 0, 0.35],
    rElbow: [-0.3, 0, 0],
  },
  lift: -0.82,
};
