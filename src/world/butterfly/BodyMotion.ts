import * as THREE from "three";
import { BodyParts } from "./BodyGeometry.ts";

export interface BodyMotionConfig {
  /** Vertical heave scale synchronized with wingbeat lift (default: 1.0) */
  heaveScale?: number;
  /** Counter-pitch scale reacting to wing downstroke (default: 1.0) */
  pitchCounterScale?: number;
  /** Longitudinal surge reacting to acceleration/thrust (default: 0.008) */
  surgeScale?: number;
  /** Abdomen inertial lag strength (default: 1.0) */
  abdomenInertia?: number;
  /** Abdomen critically damped settling rate (default: 5.5) */
  abdomenDamping?: number;
  /** Secondary orientation damping rate (default: 6.0) */
  orientationDamping?: number;
  /** Baseline breathing frequency in Hz (default: 0.34) */
  pulseFrequency?: number;
  /** Breathing volumetric scale amplitude (default: 0.012) */
  pulseAmplitude?: number;
  /** Biological pulse exertion frequency gain (default: 0.25) */
  pulseExertionGain?: number;
}

/**
 * BodyMotion coordinates the physical secondary creature motion:
 * - Thorax response: micro vertical heave, longitudinal surge, and downstroke counter-pitch
 * - Secondary orientation: critically damped pitch, yaw, and roll responding to flight state
 * - Abdomen inertia: progressive 7-segment spinal flex lagging thorax motion without pendulum swinging
 * - Biological pulse: slow, irregular, subconscious respiration with volume preservation
 * - Strictly zero per-frame heap allocations
 */
export class BodyMotion {
  public readonly parts: BodyParts | null;
  public readonly bodyGroup: THREE.Group;

  // Tunable configuration
  public heaveScale: number;
  public pitchCounterScale: number;
  public surgeScale: number;
  public abdomenInertia: number;
  public abdomenDamping: number;
  public orientationDamping: number;
  public pulseFrequency: number;
  public pulseAmplitude: number;
  public pulseExertionGain: number;

  // Dynamic state tracking
  private currentBob: number = 0;
  private currentSurge: number = 0;
  private currentPitch: number = 0;
  private currentYaw: number = 0;
  private currentRoll: number = 0;

  // Abdomen inertial state
  private currentAbdomenPitch: number = 0;
  private currentAbdomenYaw: number = 0;
  private currentAbdomenRoll: number = 0;

  // Biological pulse state
  private pulseTimeline: number = 0;

  // Precomputed weights for 7-segment progressive spinal curvature (sums to 1.0)
  private readonly segmentWeights: number[] = [
    0.06, 0.09, 0.13, 0.16, 0.18, 0.19, 0.19
  ];

  constructor(target: BodyParts | THREE.Group, config: BodyMotionConfig = {}) {
    if ("thorax" in target && "abdomenSegments" in target) {
      this.parts = target as BodyParts;
      this.bodyGroup = target.root;
    } else {
      this.parts = null;
      this.bodyGroup = target as THREE.Group;
    }

    this.heaveScale = config.heaveScale ?? 1.0;
    this.pitchCounterScale = config.pitchCounterScale ?? 1.0;
    this.surgeScale = config.surgeScale ?? 0.008;
    this.abdomenInertia = config.abdomenInertia ?? 1.0;
    this.abdomenDamping = config.abdomenDamping ?? 5.5;
    this.orientationDamping = config.orientationDamping ?? 6.0;
    this.pulseFrequency = config.pulseFrequency ?? 0.34;
    this.pulseAmplitude = config.pulseAmplitude ?? 0.012;
    this.pulseExertionGain = config.pulseExertionGain ?? 0.25;
  }

  /**
   * Main secondary motion update tick.
   * Coordinates thorax heave, abdomen spinal inertia, orientation settling, and biological pulse.
   */
  public update(
    delta: number,
    targetBob: number,
    targetPitch: number,
    speed: number = 0,
    bank: number = 0,
    accelForward: number = 0,
    accelLateral: number = 0,
    angularPitch: number = 0,
    angularYaw: number = 0,
    downstrokeImpulse: number = 0
  ): void {
    // 1. Damping factors
    const decayOrientation = 1 - Math.exp(-this.orientationDamping * delta);
    const decayAbdomen = 1 - Math.exp(-this.abdomenDamping * delta);

    // 2. Thorax Dynamic Response
    // Vertical heave from wing downstroke lift
    const desiredBob = targetBob * this.heaveScale;
    this.currentBob += (desiredBob - this.currentBob) * decayOrientation;

    // Longitudinal surge from forward acceleration and wing stroke thrust impulse
    const targetSurge = (accelForward * 0.012 + downstrokeImpulse * 0.003) * this.surgeScale * 100.0;
    this.currentSurge += (targetSurge - this.currentSurge) * decayOrientation;

    // 3. Secondary Body Orientation Response
    // Damped pitch reacting to downstroke counter-pitch, forward acceleration, and rotational rates
    const targetPitchTotal =
      targetPitch * this.pitchCounterScale -
      accelForward * 0.018 -
      angularPitch * 0.05;
    this.currentPitch += (targetPitchTotal - this.currentPitch) * decayOrientation;

    // Subtle yaw lag reacting to angular turning and lateral acceleration
    const targetYaw = -angularYaw * 0.04 - accelLateral * 0.02;
    this.currentYaw += (targetYaw - this.currentYaw) * decayOrientation;

    // Subtle banking roll reaction
    const targetRoll = -bank * 0.14;
    this.currentRoll += (targetRoll - this.currentRoll) * decayOrientation;

    // Apply primary secondary transforms to body group
    this.bodyGroup.position.set(0, this.currentBob, this.currentSurge);
    this.bodyGroup.rotation.set(this.currentPitch, this.currentYaw, this.currentRoll);

    // 4. Abdomen Inertial Response (Progressive Spinal Flex)
    // Abdomen lags behind thorax pitch and flight turns without pendulum oscillation
    const targetAbdomenPitch =
      -this.currentPitch * 0.65 * this.abdomenInertia -
      accelForward * 0.035 * this.abdomenInertia +
      speed * 0.035 -
      downstrokeImpulse * 0.010;

    const targetAbdomenYaw =
      -bank * 0.22 * this.abdomenInertia -
      angularYaw * 0.08 * this.abdomenInertia;

    const targetAbdomenRoll = -bank * 0.10 * this.abdomenInertia;

    this.currentAbdomenPitch += (targetAbdomenPitch - this.currentAbdomenPitch) * decayAbdomen;
    this.currentAbdomenYaw += (targetAbdomenYaw - this.currentAbdomenYaw) * decayAbdomen;
    this.currentAbdomenRoll += (targetAbdomenRoll - this.currentAbdomenRoll) * decayAbdomen;

    // Distribute curvature progressively along the 7 articulated segments
    if (this.parts && this.parts.abdomenSegments.length > 0) {
      const segs = this.parts.abdomenSegments;
      const count = segs.length;
      for (let s = 0; s < count; s++) {
        const w = s < this.segmentWeights.length ? this.segmentWeights[s] : 1.0 / count;
        segs[s].rotation.set(
          this.currentAbdomenPitch * w,
          this.currentAbdomenRoll * w * 0.5,
          this.currentAbdomenYaw * w
        );
      }
    }

    // 5. Biological Pulse (Slow, Irregular, Subconscious Respiration)
    // Exertion slightly quickens respiration cadence
    const exertion = THREE.MathUtils.clamp(speed / 0.6, 0.0, 1.0);
    const effectiveFreq = this.pulseFrequency * (1.0 + exertion * this.pulseExertionGain);
    this.pulseTimeline += delta * effectiveFreq * Math.PI * 2.0;

    // Dual incommensurate frequencies prevent mechanical metronomic repetition
    const wave1 = Math.sin(this.pulseTimeline);
    const wave2 = Math.sin(this.pulseTimeline * 0.618 + 1.25) * 0.42;
    const breathSignal = (wave1 + wave2) * 0.70;
    const breath = breathSignal * this.pulseAmplitude;

    // Apply volumetric breathing with biological cross-sectional expansion / axial balance
    if (this.parts) {
      const breathXZ = 1.0 + breath;
      const breathY = 1.0 - breath * 0.35; // Slight axial contraction preserving volume
      this.parts.abdomen.scale.set(breathXZ, breathY, breathXZ);

      // Micro thoracic expansion (more rigid carapace, lower amplitude)
      const thoraxBreath = 1.0 + breath * 0.4;
      this.parts.thorax.scale.set(thoraxBreath, 1.0, thoraxBreath);
    }
  }

  public reset(): void {
    this.currentBob = 0;
    this.currentSurge = 0;
    this.currentPitch = 0;
    this.currentYaw = 0;
    this.currentRoll = 0;
    this.currentAbdomenPitch = 0;
    this.currentAbdomenYaw = 0;
    this.currentAbdomenRoll = 0;
    this.pulseTimeline = 0;

    this.bodyGroup.position.set(0, 0, 0);
    this.bodyGroup.rotation.set(0, 0, 0);

    if (this.parts) {
      this.parts.abdomen.scale.set(1, 1, 1);
      this.parts.thorax.scale.set(1, 1, 1);
      for (const seg of this.parts.abdomenSegments) {
        seg.rotation.set(0, 0, 0);
      }
    }
  }
}
