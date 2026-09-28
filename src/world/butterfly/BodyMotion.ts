import * as THREE from "three";

/**
 * BodyMotion coordinates the restrained, stable biomechanical response of the creature's body:
 * - Small counter-pitch against wing stroke (Newton's 3rd law: downstroke produces slight nose-up lift)
 * - Micro vertical heave synchronized with the flap cycle
 * - Subtle abdominal curl reacting to flight velocity vectors
 * - Extremely stable: ZERO unnatural bouncing
 */
export class BodyMotion {
  private readonly bodyGroup: THREE.Group;
  private currentPitch: number = 0;
  private currentBob: number = 0;
  private currentAbdomenCurl: number = 0;

  constructor(bodyGroup: THREE.Group) {
    this.bodyGroup = bodyGroup;
  }

  public update(
    delta: number,
    targetBob: number,
    targetPitch: number,
    _speed: number = 0,
    bank: number = 0
  ): void {
    // Critically damped settling: ultra-smooth, zero jitter
    const decay = 1 - Math.exp(-7.0 * delta);

    this.currentBob += (targetBob - this.currentBob) * decay;
    this.currentPitch += (targetPitch - this.currentPitch) * decay;
    this.currentAbdomenCurl += (-bank * 0.18 - this.currentAbdomenCurl) * decay;

    // Apply micro vertical heave and counter-pitch to main body group
    this.bodyGroup.position.y = this.currentBob;
    this.bodyGroup.rotation.x = this.currentPitch;
    this.bodyGroup.rotation.z = this.currentAbdomenCurl * 0.4;
  }
}
