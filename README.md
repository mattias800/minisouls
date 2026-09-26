# Minisouls

**The world's smallest Souls-like.** One bonfire, one bridge, one boss. Many deaths.

▶ **Play it in your browser: https://mattias800.github.io/minisouls/**

The whole world fits in about 20 × 70 metres: a ruined shrine with a bonfire, a hollow-infested
path, a broken bridge over the abyss, a gatehouse guarded by a fallen knight, a cliffside shortcut
back to the fire, and behind the white fog, the arena of **the Ashen Warden**.

## What makes it a Souls-like

- **Stamina-driven combat.** Attacking, rolling, sprinting and blocking all drain stamina.
- **Rolls with i-frames**, light/heavy attacks with combos, a shield that can be guard-broken,
  and **backstabs** on unaware enemies.
- **Poise and stagger.** Hollows flinch from every hit; the knight and the boss don't.
- **Bonfires.** Resting refills HP and Estus, lets you level up, and brings every enemy back.
- **Souls are currency and XP.** Die and you drop them as a bloodstain. Die again before you
  get back to it and they're gone for good.
- **Estus Flask** with limited charges (and an Estus Shard hidden somewhere).
- **Lock-on**, a fog gate you can't walk back through, a telegraphed two-phase boss with delayed
  swings, a gap-closing leap and fire shockwaves you have to roll through.
- **A shortcut** that opens from the other side, **messages** on the ground from other
  "players", falling to your death, **YOU DIED**, and **New Game+**.

## Controls

| Action                     | Keyboard & mouse    | Controller  |
| -------------------------- | ------------------- | ----------- |
| Move                       | W A S D             | Left stick  |
| Camera                     | Mouse               | Right stick |
| Light attack               | Left click          | RB          |
| Heavy attack               | Shift + Left click  | RT          |
| Block                      | Right click / F     | LB          |
| Roll (tap) · Sprint (hold) | Space               | B           |
| Lock on / switch target    | Q / Middle click    | R3          |
| Drink Estus                | R                   | X           |
| Interact                   | E                   | A           |
| Pause                      | Esc                 | Start       |

Progress is saved automatically in your browser's local storage.

## Running locally

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest)
npm run build    # type-check + production build into dist/
```

Pushing to `main` runs the tests and deploys to GitHub Pages via `.github/workflows/deploy.yml`.

## How it's built

TypeScript, [Three.js](https://threejs.org/) and Vite. There are **no asset files**: every model
is built from primitives in code, the textures are drawn onto canvases at startup, and all sound
effects and the boss music are synthesised with the Web Audio API.

```
src/
  main.ts                 entry point
  game/                   Game (state machine + rules), Progress (saves), stats & levelling
  entities/               Actor base class, Player, Enemy AI, Boss, enemy roster
  combat/                 attack data, pure hit resolution, hit detection, shockwaves
  physics/                2D collision world on the XZ plane (walls, pillars, ground/pits)
  world/                  the level layout, bonfire, fog gate, props (bloodstain, messages, items)
  render/                 renderer & post-processing, camera rig, procedural humanoid rig,
                          pose-based animation, particles, weapon trails, textures
  audio/                  Web Audio synth: sound recipes, ambience, generative boss music
  input/                  keyboard/mouse/gamepad mapped to abstract actions
  ui/                     HUD, menus and overlays (plain DOM + CSS)
tests/                    Vitest unit tests for the rules and simulation
```

A few design notes for extending it:

- **Attacks are data** (`combat/attacks.ts`): timings, damage, poise damage, hitbox, lunge,
  tracking and combo links. New moves rarely need new code.
- **Hit resolution is a pure function** (`combat/damage.ts`) covering i-frames, blocking, guard
  breaks, poise and death, so the rules are unit-testable.
- **Characters are one rig** (`render/Humanoid.ts`) with different proportions and gear.
  Animations are keyframed poses (`render/poses.ts`) layered over a procedural walk cycle.
- **Enemies are profiles** (`entities/roster.ts`): stats plus a weighted attack table for the
  shared chase/strafe/attack/leash AI in `entities/Enemy.ts`.
- **The level is code** (`world/Level.ts`): each area is a few calls to `ground`, `wall`,
  `parapet`, `pillar`. Anything outside a ground zone is a pit.

## License

MIT
