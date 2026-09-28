import * as THREE from "three";

export interface WingStrokeState {
  flapAngle: number;
  flapVelocity: number;
  flapPhase: number; // 0 to 1
  isDownstroke: boolean;
}

export interface WingAnimationOutputs {
  leftForewing: WingStrokeState;
  rightForewing: WingStrokeState;
  leftHindwing: WingStrokeState;
  rightHindwing: WingStrokeState;
  bodyBob: number;
  bodyPitch: number;
}

/**
 * WingAnimation manages the biomechanical flapping kinematics:
 * - Asymmetric flap cycle: ~38% downstroke (decisive power) / ~62% upstroke (light, feathered)
 * - Relaxed ethereal cadence: ~1.22 Hz (0.82s per cycle)
 * - C2 continuous transitions: zero angular acceleration spikes or visible snaps
 * - Bilateral organic asymmetry: subtle left/right phase and amplitude desynchronization
 * - Upper vs. lower wing coordination: hindwings follow with reduced amplitude and phase delay
 */
export class WingAnimation {
  // Master animation timeline
  private masterTime: number = 0;

  // Base cadence (1.22 Hz = 0.82s period)
  public baseFrequency: number = 1.22;
  public currentFrequency: number = 1.22;

  // Flap amplitude parameters (in radians)
  // Forewing: flap range from -0.38 rad (down) to +0.65 rad (up) = total span ~1.03 rad (~59 deg)
  public forewingMaxAngle: number = 0.62;
  public forewingMinAngle: number = -0.38;

  // Hindwing: reduced amplitude, range -0.28 to +0.48
  public hindwingMaxAngle: number = 0.46;
  public hindwingMinAngle: number = -0.26;

  // Cycle asymmetry: downstroke fraction
  public readonly downstrokeFraction: number = 0.38;

  // Bilateral asymmetry constants
  private readonly rightAmplitudeScale: number = 0.982; // 1.8% amplitude offset
  private readonly rightPhaseOffset: number = 0.038; // ~2.2 degree phase lead
  private readonly hindwingPhaseDelay: number = 0.125; // Hindwings lag forewings by ~12.5% of cycle

  // Dynamic flight inputs
  private targetCadence: number = 1.22;
  private bankBias: number = 0;

  public update(delta: number, speed: number = 0, bank: number = 0): WingAnimationOutputs {
    // 1. Modulate cadence gently with flight speed: near-hover ~1.18 Hz, cruise ~1.32 Hz
    this.targetCadence = THREE.MathUtils.lerp(1.18, 1.34, THREE.MathUtils.clamp(speed / 0.6, 0.0, 1.0));
    this.currentFrequency += (this.targetCadence - this.currentFrequency) * (1 - Math.exp(-2.5 * delta));

    // Dynamic bank asymmetry: banking into a turn slightly increases outside wing amplitude
    this.bankBias += (bank - this.bankBias) * (1 - Math.exp(-4.0 * delta));

    this.masterTime += delta * this.currentFrequency;

    // 2. Evaluate Left Forewing (base reference)
    const leftForePhase = (this.masterTime) % 1.0;
    const leftFore = this.evaluateWingKinematics(
      leftForePhase,
      this.forewingMinAngle,
      this.forewingMaxAngle,
      1.0 + this.bankBias * 0.12
    );

    // 3. Evaluate Right Forewing (subtle organic bilateral difference)
    const rightForePhase = (this.masterTime + this.rightPhaseOffset) % 1.0;
    const rightFore = this.evaluateWingKinematics(
      rightForePhase,
      this.forewingMinAngle,
      this.forewingMaxAngle,
      this.rightAmplitudeScale - this.bankBias * 0.12
    );

    // 4. Evaluate Left Hindwing (reduced amplitude, phase delayed)
    const leftHindPhase = (this.masterTime - this.hindwingPhaseDelay + 1.0) % 1.0;
    const leftHind = this.evaluateWingKinematics(
      leftHindPhase,
      this.hindwingMinAngle,
      this.hindwingMaxAngle,
      0.82 + this.bankBias * 0.08
    );

    // 5. Evaluate Right Hindwing
    const rightHindPhase = (this.masterTime - this.hindwingPhaseDelay + this.rightPhaseOffset + 1.0) % 1.0;
    const rightHind = this.evaluateWingKinematics(
      rightHindPhase,
      this.hindwingMinAngle,
      this.hindwingMaxAngle,
      0.82 * this.rightAmplitudeScale - this.bankBias * 0.08
    );

    // 6. Restrained body counter-motion (Newton's 3rd law)
    // Downstroke generates slight upward body lift and subtle nose-up pitch
    const avgFlapVel = (leftFore.flapVelocity + rightFore.flapVelocity) * 0.5;
    const bodyBob = -avgFlapVel * 0.0035; // Gentle ~0.018 unit max heave
    const bodyPitch = -avgFlapVel * 0.0055; // Gentle ~0.028 rad (~1.6 deg) max counter-pitch

    return {
      leftForewing: leftFore,
      rightForewing: rightFore,
      leftHindwing: leftHind,
      rightHindwing: rightHind,
      bodyBob,
      bodyPitch
    };
  }

  /**
   * Deterministically evaluates kinematics at an exact phase in [0, 1] for visual auditing.
   */
  public evaluateAtPhase(phase: number, speed: number = 0, bank: number = 0): WingAnimationOutputs {
    this.targetCadence = THREE.MathUtils.lerp(1.18, 1.34, THREE.MathUtils.clamp(speed / 0.6, 0.0, 1.0));
    this.currentFrequency = this.targetCadence;
    this.bankBias = bank;
    this.masterTime = phase;

    const leftForePhase = (phase) % 1.0;
    const leftFore = this.evaluateWingKinematics(
      leftForePhase,
      this.forewingMinAngle,
      this.forewingMaxAngle,
      1.0 + this.bankBias * 0.12
    );

    const rightForePhase = (phase + this.rightPhaseOffset) % 1.0;
    const rightFore = this.evaluateWingKinematics(
      rightForePhase,
      this.forewingMinAngle,
      this.forewingMaxAngle,
      this.rightAmplitudeScale - this.bankBias * 0.12
    );

    const leftHindPhase = (phase - this.hindwingPhaseDelay + 1.0) % 1.0;
    const leftHind = this.evaluateWingKinematics(
      leftHindPhase,
      this.hindwingMinAngle,
      this.hindwingMaxAngle,
      0.82 + this.bankBias * 0.08
    );

    const rightHindPhase = (phase - this.hindwingPhaseDelay + this.rightPhaseOffset + 1.0) % 1.0;
    const rightHind = this.evaluateWingKinematics(
      rightHindPhase,
      this.hindwingMinAngle,
      this.hindwingMaxAngle,
      0.82 * this.rightAmplitudeScale - this.bankBias * 0.08
    );

    const avgFlapVel = (leftFore.flapVelocity + rightFore.flapVelocity) * 0.5;
    const bodyBob = -avgFlapVel * 0.0035;
    const bodyPitch = -avgFlapVel * 0.0055;

    return {
      leftForewing: leftFore,
      rightForewing: rightFore,
      leftHindwing: leftHind,
      rightHindwing: rightHind,
      bodyBob,
      bodyPitch
    };
  }

  /**
   * Evaluates asymmetric flap angle and angular velocity using C2-continuous sinusoidal phase warping.
   *
   * @param phase Normalized cycle phase in [0, 1]
   * @param minAngle Flap angle at bottom of downstroke
   * @param maxAngle Flap angle at top of upstroke
   * @param ampScale Amplitude multiplier
   */
  private evaluateWingKinematics(
    phase: number,
    minAngle: number,
    maxAngle: number,
    ampScale: number
  ): WingStrokeState {
    const dFrac = this.downstrokeFraction; // 0.38
    const uFrac = 1.0 - dFrac; // 0.62

    let normalizedPos: number; // 0 at top, 1 at bottom
    let phaseRate: number; // d(normalizedPos)/d(phase)
    const isDownstroke = phase < dFrac;

    if (isDownstroke) {
      // Downstroke: phase runs from 0 to dFrac
      const t = phase / dFrac; // 0 to 1
      // Smooth half-cosine transition from 0 to 1
      normalizedPos = 0.5 * (1.0 - Math.cos(Math.PI * t));
      phaseRate = (0.5 * Math.PI * Math.sin(Math.PI * t)) / dFrac;
    } else {
      // Upstroke: phase runs from dFrac to 1.0
      const t = (phase - dFrac) / uFrac; // 0 to 1
      // Smooth half-cosine transition from 1 back to 0
      normalizedPos = 0.5 * (1.0 + Math.cos(Math.PI * t));
      phaseRate = (-0.5 * Math.PI * Math.sin(Math.PI * t)) / uFrac;
    }

    // Flap angle interpolation: 0 maps to maxAngle, 1 maps to minAngle
    const angleRange = maxAngle - minAngle;
    const baseAngle = maxAngle - normalizedPos * angleRange;
    const flapAngle = baseAngle * ampScale;

    // Angular velocity: d(angle)/dt = d(angle)/d(phase) * d(phase)/dt
    // phaseRate is d(normalizedPos)/d(phase)
    // d(baseAngle)/d(phase) = -phaseRate * angleRange
    const flapVelocity = -phaseRate * angleRange * ampScale * this.currentFrequency;

    return {
      flapAngle,
      flapVelocity,
      flapPhase: phase,
      isDownstroke
    };
  }
}
