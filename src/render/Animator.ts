import { damp, wrapAngle } from '../core/math';
import { HIP_HEIGHT, JOINTS, type Humanoid, type JointName } from './Humanoid';
import type { Pose } from './poses';

export interface ApplyOptions {
  /** Higher is snappier. Attacks use a high rate so strikes read as sharp. */
  rate?: number;
  /** Joints that should jump straight to their target (e.g. the body during a roll). */
  snap?: readonly JointName[];
  /** Ground speed, used for secondary motion like the cape. */
  speed?: number;
}

/** Drives a Humanoid's joints towards a target Pose with exponential smoothing. */
export class Animator {
  private lift = 0;
  private time = 0;

  constructor(private readonly rig: Humanoid) {}

  apply(pose: Pose, dt: number, options: ApplyOptions = {}): void {
    const rate = options.rate ?? 18;
    const snap = options.snap;
    this.time += dt;

    // The body joint can spin a full turn in a roll; keep it in range so it never unwinds.
    const body = this.rig.joints.body.rotation;
    body.x = wrapAngle(body.x);

    for (const name of JOINTS) {
      const target = pose.joints[name];
      const r = this.rig.joints[name].rotation;
      const tx = target ? target[0] : 0;
      const ty = target ? target[1] : 0;
      const tz = target ? target[2] : 0;
      if (snap?.includes(name)) {
        r.set(tx, ty, tz);
      } else {
        r.x = damp(r.x, tx, rate, dt);
        r.y = damp(r.y, ty, rate, dt);
        r.z = damp(r.z, tz, rate, dt);
      }
    }

    this.lift = damp(this.lift, pose.lift ?? 0, rate, dt);
    this.rig.joints.body.position.y = HIP_HEIGHT + this.lift;

    const cape = this.rig.cape;
    if (cape) {
      const speed = options.speed ?? 0;
      const flutter = Math.sin(this.time * 7) * 0.04 * (0.3 + speed * 0.2);
      cape.rotation.x = damp(cape.rotation.x, 0.12 + Math.min(1.1, speed * 0.14) + flutter, 8, dt);
    }
  }
}
