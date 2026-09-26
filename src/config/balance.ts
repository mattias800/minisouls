/** Tunable numbers for the player and the global rules. Attacks live in combat/attacks.ts. */

export const PLAYER = {
  radius: 0.38,
  mass: 1,
  walkSpeed: 3.4,
  sprintSpeed: 6.2,
  blockSpeed: 1.7,
  drinkSpeed: 1.0,
  turnRate: 14,
  maxPoise: 20,
  poiseResetDelay: 2.5,

  staminaRegen: 48,
  staminaRegenDelay: 0.55,
  blockRegenFactor: 0.3,
  sprintCostPerSecond: 16,
  blockStaminaFactor: 0.75,

  roll: {
    cost: 22,
    duration: 0.62,
    distance: 4.4,
    iframeStart: 0.04,
    iframeEnd: 0.42,
    /** After this long the rest of the roll can be cancelled into another action. */
    actionableAfter: 0.5,
  },

  estus: {
    heal: 55,
    duration: 1.15,
    healAt: 0.6,
  },

  /** How long a pressed button is remembered while the player is busy. */
  inputBuffer: 0.32,
  /** Holding dodge longer than this turns it into a sprint instead of a roll. */
  dodgeHoldThreshold: 0.26,

  stagger: { light: 0.42, heavy: 0.95, bounce: 0.5 },
} as const;

export const WORLD = {
  /** Falling below this height is death. */
  killY: -8,
  gravity: 24,
  /** Enemies this far from home give up the chase and walk back. */
  defaultLeash: 16,
} as const;

/** Enemy health and damage multiplier per New Game+ cycle. */
export const NG_PLUS_SCALING = 1.4;
