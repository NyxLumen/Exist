import * as THREE from "three";

export enum FlightPhase {
  RESTING = "RESTING",
  AWAKENING = "AWAKENING",
  CRUISE = "CRUISE",
  ACCELERATING = "ACCELERATING",
  TURNING = "TURNING",
  CLIMBING = "CLIMBING",
  DESCENDING = "DESCENDING",
  GLIDING = "GLIDING",
  RECOVERING = "RECOVERING"
}

export interface FlightMotionState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  acceleration: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  direction: THREE.Vector3;
  speed: number;
  bank: number;
  flightTime: number;
  flightPhase: FlightPhase;
  energy: number;
  isGliding: boolean;
  desiredDirection: THREE.Vector3;
  steeringForce: THREE.Vector3;
  containmentForce: THREE.Vector3;
}

export interface WingbeatFeedback {
  flapPhase: number;
  flapVelocity: number;
  downstrokeImpulse: number;
  isDownstroke: boolean;
}

export interface FlightConfig {
  minSpeed?: number;
  maxSpeed?: number;
  cruiseSpeed?: number;
  propulsionStrength?: number;
  steeringResponse?: number;
  maxSteeringForce?: number;
  dragCoefficient?: number;
  liftRatio?: number;
  bankStrength?: number;
  maxBankAngle?: number;
  bankDamping?: number;
  rotationInertiaDamping?: number;
  wanderRate?: number;
  wanderPersistence?: number;
  energyBurnRate?: number;
  energyRecoveryRate?: number;
  glideProbability?: number;
  glideDurationMin?: number;
  glideDurationMax?: number;
  containmentStiffness?: number;
  safeSpan?: { x: number; y: number; z: number };
  margin?: { x: number; y: number; z: number };
}

/**
 * State-driven Real Flight / Locomotion Rebuild (Stage 5):
 * - Movement and trajectory emerge strictly from physics integration (Forces -> Acceleration -> Velocity -> Position).
 * - Correlated stochastic steering with behavioral memory (no authored paths or periodic sine wander).
 * - Dynamic energy regulation and opportunistic glide phases.
 * - Biophysical wingbeat downstroke coupling (thrust & lift impulses).
 * - Soft quadratic composition containment around "EXIST".
 * - Authoritative orientation with rotational inertia and lateral-acceleration banking.
 * - Strictly zero per-frame heap allocations.
 */
/**
 * Authoritative Canonical Forward and Reference Axes for the Procedural Butterfly creature:
 * - BUTTERFLY_CANONICAL_FORWARD = (0, 1, 0) [+Y]: Head, cranial capsule, antennae, leading edges.
 * - BUTTERFLY_CANONICAL_UP      = (0, 0, 1) [+Z]: Dorsal thoracic crest, upper wing camber (camera facing).
 * - BUTTERFLY_CANONICAL_RIGHT   = (1, 0, 0) [+X]: Right forewing and hindwing span.
 */
export const BUTTERFLY_CANONICAL_FORWARD = new THREE.Vector3(0, 1, 0);
export const BUTTERFLY_CANONICAL_UP = new THREE.Vector3(0, 0, 1);
export const BUTTERFLY_CANONICAL_RIGHT = new THREE.Vector3(1, 0, 0);

export class FlightController {
  private readonly root: THREE.Group;

  // Time & Lifecycle
  private flightTime: number = 0;

  // Authoritative Flight Kinematics
  public readonly position: THREE.Vector3 = new THREE.Vector3();
  public readonly velocity: THREE.Vector3 = new THREE.Vector3();
  public readonly acceleration: THREE.Vector3 = new THREE.Vector3();
  public readonly angularVelocity: THREE.Vector3 = new THREE.Vector3();
  public readonly direction: THREE.Vector3 = new THREE.Vector3(-0.55, 0.75, 0.35).normalize();
  public readonly desiredDirection: THREE.Vector3 = new THREE.Vector3(-0.55, 0.75, 0.35).normalize();
  public readonly steeringForce: THREE.Vector3 = new THREE.Vector3();
  public readonly containmentForce: THREE.Vector3 = new THREE.Vector3();

  public speed: number = 0.22;
  public bank: number = 0;
  public energy: number = 1.0;
  public flightPhase: FlightPhase = FlightPhase.CRUISE;
  public isGliding: boolean = false;
  public enabled: boolean = true;

  // Complete Telemetry Interface (consumed by Stage 4 secondary motion)
  public readonly motionState: FlightMotionState;

  // Tunable Configuration
  public config: Required<FlightConfig>;

  // Composition envelope
  private center = new THREE.Vector3(0.15, -0.35, 0.0);
  private safeSpan = { x: 1.45, y: 0.80, z: 0.60 };
  private margin = { x: 0.50, y: 0.40, z: 0.30 };

  // Initial active flight pose near "ST"
  private readonly initialPosition = new THREE.Vector3(0.68, -0.94, 0.1);
  private readonly initialQuat = new THREE.Quaternion();

  // Behavioral Wandering Intent State (Correlated Stochastic Drift)
  private intentPlaneAngle: number = 2.35; // Heading in visual plane (rad)
  private intentDepthAngle: number = 0.15; // Elevation in depth Z (rad)
  private intentPlaneRate: number = 0.0;
  private intentDepthRate: number = 0.0;
  private targetSpeed: number = 0.38;

  // Glide state timer
  private glideTimer: number = 0;
  private timeSinceLastGlide: number = 0;

  // Deterministic PRNG state (XorShift32)
  private rngState: number = 0x89abcdef;

  // Pre-allocated scratch objects (strictly ZERO allocations per tick)
  private readonly _desiredVel = new THREE.Vector3();
  private readonly _propulsionForce = new THREE.Vector3();
  private readonly _liftForce = new THREE.Vector3();
  private readonly _dragForce = new THREE.Vector3();
  private readonly _netAccel = new THREE.Vector3();
  private readonly _actualForward = new THREE.Vector3(0, 1, 0);
  private readonly _worldUp = BUTTERFLY_CANONICAL_UP.clone();
  private readonly _fallbackUp = new THREE.Vector3(0, 1, 0);
  private readonly _orthoUp = new THREE.Vector3(0, 0, 1);
  private readonly _orthoRight = new THREE.Vector3(1, 0, 0);
  private readonly _basisMatrix = new THREE.Matrix4();
  private readonly _targetQuat = new THREE.Quaternion();
  private readonly _bankQuat = new THREE.Quaternion();
  private readonly _prevQuat = new THREE.Quaternion();
  private readonly _deltaQuat = new THREE.Quaternion();
  private readonly _deltaEuler = new THREE.Euler(0, 0, 0, "XYZ");

  constructor(root: THREE.Group, config: FlightConfig = {}) {
    this.root = root;

    this.config = {
      minSpeed: config.minSpeed ?? 0.12,
      maxSpeed: config.maxSpeed ?? 0.65,
      cruiseSpeed: config.cruiseSpeed ?? 0.38,
      propulsionStrength: config.propulsionStrength ?? 0.95,
      steeringResponse: config.steeringResponse ?? 2.4,
      maxSteeringForce: config.maxSteeringForce ?? 1.15,
      dragCoefficient: config.dragCoefficient ?? 0.82,
      liftRatio: config.liftRatio ?? 0.85,
      bankStrength: config.bankStrength ?? 0.26,
      maxBankAngle: config.maxBankAngle ?? 0.22,
      bankDamping: config.bankDamping ?? 3.5,
      rotationInertiaDamping: config.rotationInertiaDamping ?? 6.2,
      wanderRate: config.wanderRate ?? 0.45,
      wanderPersistence: config.wanderPersistence ?? 1.2,
      energyBurnRate: config.energyBurnRate ?? 0.035,
      energyRecoveryRate: config.energyRecoveryRate ?? 0.05,
      glideProbability: config.glideProbability ?? 0.18,
      glideDurationMin: config.glideDurationMin ?? 0.9,
      glideDurationMax: config.glideDurationMax ?? 2.2,
      containmentStiffness: config.containmentStiffness ?? 0.42,
      safeSpan: config.safeSpan ?? { x: 1.45, y: 0.80, z: 0.60 },
      margin: config.margin ?? { x: 0.50, y: 0.40, z: 0.30 }
    };

    this.motionState = {
      position: this.position,
      velocity: this.velocity,
      acceleration: this.acceleration,
      angularVelocity: this.angularVelocity,
      direction: this.direction,
      speed: 0.24,
      bank: 0,
      flightTime: 0,
      flightPhase: FlightPhase.CRUISE,
      energy: 1.0,
      isGliding: false,
      desiredDirection: this.desiredDirection,
      steeringForce: this.steeringForce,
      containmentForce: this.containmentForce
    };

    this.resetToInitialPose();
  }

  /**
   * Deterministic pseudo-random number generator in [-1, 1] using XorShift32.
   */
  private nextRandom(): number {
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return (this.rngState / 0xffffffff) * 2.0 - 1.0;
  }

  public resetToInitialPose(): void {
    this.position.copy(this.initialPosition);
    this.direction.set(-0.55, 0.75, 0.35).normalize();
    this.desiredDirection.copy(this.direction);
    this.steeringForce.set(0, 0, 0);
    this.containmentForce.set(0, 0, 0);

    // Immediate active flight: creature is alive and moving smoothly from frame 0
    this.speed = 0.24;
    this.velocity.copy(this.direction).multiplyScalar(this.speed);
    this.acceleration.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.bank = 0;
    this.flightTime = 0;
    this.flightPhase = FlightPhase.CRUISE;
    this.energy = 1.0;
    this.isGliding = false;
    this.glideTimer = 0;
    this.timeSinceLastGlide = 0;

    this.intentPlaneAngle = Math.atan2(this.direction.y, this.direction.x);
    this.intentDepthAngle = Math.asin(this.direction.z);
    this.intentPlaneRate = 0.0;
    this.intentDepthRate = 0.0;
    this.targetSpeed = this.config.cruiseSpeed;
    this.rngState = 0x89abcdef;

    // Immediately compute coherent initial orientation from velocity
    this._actualForward.copy(this.direction);
    this._orthoUp.copy(this._worldUp).addScaledVector(this._actualForward, -this._worldUp.dot(this._actualForward)).normalize();
    this._orthoRight.crossVectors(this._actualForward, this._orthoUp).normalize();
    this._basisMatrix.makeBasis(this._orthoRight, this._actualForward, this._orthoUp);
    this.initialQuat.setFromRotationMatrix(this._basisMatrix);

    this.root.position.copy(this.position);
    this.root.quaternion.copy(this.initialQuat);
    this._prevQuat.copy(this.initialQuat);
    this.syncMotionState();
  }

  public setInitialPosition(x: number, y: number, z: number): void {
    this.initialPosition.set(x, y, z);
    if (this.flightTime < 0.1) {
      this.position.copy(this.initialPosition);
      this.root.position.copy(this.position);
      this.syncMotionState();
    }
  }

  public resize(width: number, height: number): void {
    const aspect = width / height;
    if (aspect < 0.65) {
      // Narrow mobile
      this.safeSpan = { x: 0.80, y: 1.05, z: 0.55 };
      this.margin = { x: 0.35, y: 0.40, z: 0.30 };
      this.center.set(0.05, -0.45, 0.0);
      this.setInitialPosition(0.10, -1.35, 0.1);
    } else if (aspect < 1.0) {
      // Portrait tablet
      this.safeSpan = { x: 1.05, y: 0.95, z: 0.60 };
      this.margin = { x: 0.40, y: 0.40, z: 0.30 };
      this.center.set(0.12, -0.4, 0.0);
      this.setInitialPosition(0.30, -1.10, 0.1);
    } else if (aspect < 1.4) {
      // Landscape tablet / square desktop
      this.safeSpan = { x: 1.25, y: 0.85, z: 0.65 };
      this.margin = { x: 0.45, y: 0.40, z: 0.30 };
      this.center.set(0.15, -0.35, 0.0);
      this.setInitialPosition(0.50, -0.98, 0.1);
    } else {
      // Standard desktop
      this.safeSpan = { x: 1.45, y: 0.80, z: 0.60 };
      this.margin = { x: 0.50, y: 0.40, z: 0.30 };
      this.center.set(0.15, -0.35, 0.0);
      this.setInitialPosition(0.68, -0.94, 0.1);
    }
  }

  /**
   * Main physics flight update tick:
   * Evaluates intent, computes forces, integrates velocity & position, updates authoritative orientation.
   * Strictly zero heap allocations.
   */
  public update(delta: number, wingFeedback?: WingbeatFeedback): void {
    if (!this.enabled) return;
    this.flightTime += delta;

    // 1. Update Correlated Stochastic Directional Intent
    this.updateDirectionalIntent(delta);

    // 2. Update Energy and Glide State Dynamics
    this.updateEnergyAndGlide(delta);

    // 3. Compute Flight Forces & Net Acceleration
    this.computeFlightForces(delta, wingFeedback);

    // 4. Integrate Velocity & Position (Physical Momentum)
    this.velocity.addScaledVector(this._netAccel, delta);
    this.speed = this.velocity.length();

    // Enforce physiological speed bounds
    if (this.speed > this.config.maxSpeed) {
      this.velocity.multiplyScalar(this.config.maxSpeed / this.speed);
      this.speed = this.config.maxSpeed;
    }

    // Update actual movement direction
    if (this.speed > 0.001) {
      this.direction.copy(this.velocity).multiplyScalar(1 / this.speed);
    }

    // Position integration: position strictly emerges from velocity!
    this.position.addScaledVector(this.velocity, delta);
    this.root.position.copy(this.position);

    // 5. Authoritative Orientation Derived from Velocity with Rotational Inertia & Banking
    this.updateAuthoritativeOrientation(delta);

    // 6. Classify Current Flight Phase
    this.classifyFlightPhase();

    // 7. Synchronize Telemetry State
    this.syncMotionState();
  }

  /**
   * Correlated stochastic drift:
   * Heading intention evolves continuously with persistence rather than picking random targets.
   */
  private updateDirectionalIntent(delta: number): void {
    // Ornstein-Uhlenbeck continuous angular drift with mean reversion
    const lambda = this.config.wanderPersistence;
    const noisePlane = this.nextRandom() * this.config.wanderRate;
    const noiseDepth = this.nextRandom() * (this.config.wanderRate * 0.45);

    this.intentPlaneRate += (-lambda * this.intentPlaneRate + noisePlane) * delta;
    this.intentDepthRate += (-lambda * 1.5 * this.intentDepthRate + noiseDepth) * delta;

    this.intentPlaneAngle += this.intentPlaneRate * delta;
    this.intentDepthAngle += this.intentDepthRate * delta;

    // Constrain depth angle to prevent extreme pitch flips
    this.intentDepthAngle = THREE.MathUtils.clamp(this.intentDepthAngle, -0.45, 0.45);

    // Reconstruct 3D intent unit vector
    const cosDepth = Math.cos(this.intentDepthAngle);
    let dirX = Math.cos(this.intentPlaneAngle) * cosDepth;
    let dirY = Math.sin(this.intentPlaneAngle) * cosDepth;
    let dirZ = Math.sin(this.intentDepthAngle);

    // Soft Intent Bias: if drifting towards boundary, intent gently turns back towards center
    const dx = this.position.x - this.center.x;
    const dy = this.position.y - this.center.y;
    const dz = this.position.z - this.center.z;

    const normDx = dx / this.safeSpan.x;
    const normDy = dy / this.safeSpan.y;
    const normDz = dz / this.safeSpan.z;

    if (Math.abs(normDx) > 0.65) {
      const pen = Math.sign(normDx) * Math.pow(Math.abs(normDx) - 0.65, 1.4);
      dirX -= pen * 0.85;
    }
    if (Math.abs(normDy) > 0.65) {
      const pen = Math.sign(normDy) * Math.pow(Math.abs(normDy) - 0.65, 1.4);
      dirY -= pen * 0.85;
    }
    if (Math.abs(normDz) > 0.65) {
      const pen = Math.sign(normDz) * Math.pow(Math.abs(normDz) - 0.65, 1.4);
      dirZ -= pen * 0.95;
    }

    this.desiredDirection.set(dirX, dirY, dirZ).normalize();

    // Modulate desired speed with energy and flight rhythm
    const baseCruise = THREE.MathUtils.lerp(this.config.minSpeed, this.config.cruiseSpeed, this.energy);
    this.targetSpeed = this.isGliding ? this.config.minSpeed * 0.95 : baseCruise;
  }

  /**
   * Biological energy dynamics and opportunistic glide phase management.
   */
  private updateEnergyAndGlide(delta: number): void {
    this.timeSinceLastGlide += delta;

    // Glide state timer update
    if (this.isGliding) {
      this.glideTimer -= delta;
      // Energy recovers smoothly during effortless glide
      this.energy += this.config.energyRecoveryRate * delta;
      this.energy = Math.min(1.0, this.energy);

      if (this.glideTimer <= 0 || this.speed < this.config.minSpeed * 1.05) {
        this.isGliding = false;
        this.timeSinceLastGlide = 0;
      }
    } else {
      // Energy expends proportionally to speed and vertical climb
      const climbCost = Math.max(0, this.velocity.y) * 0.06;
      const speedCost = (this.speed / this.config.cruiseSpeed) * this.config.energyBurnRate;
      this.energy -= (speedCost + climbCost) * delta;
      this.energy = Math.max(0.18, this.energy);

      // Opportunistic glide trigger: after climbing burst, high speed, or cruising ease
      const canGlide = this.timeSinceLastGlide > 4.5 && this.energy > 0.45;
      if (canGlide && this.velocity.y < 0.08) {
        const roll = Math.abs(this.nextRandom());
        if (roll < this.config.glideProbability * delta * 5.0) {
          this.isGliding = true;
          this.glideTimer = THREE.MathUtils.lerp(
            this.config.glideDurationMin,
            this.config.glideDurationMax,
            Math.abs(this.nextRandom())
          );
        }
      }
    }
  }

  /**
   * Computes all flight forces:
   * Propulsion + Steering + Lift + Containment + Quadratic Fluid Drag.
   */
  private computeFlightForces(_delta: number, wingFeedback?: WingbeatFeedback): void {
    const downstrokeImpulse = wingFeedback ? wingFeedback.downstrokeImpulse : 0;

    // 1. Propulsion Force (forward along current movement direction)
    // Dynamic throttling maintains biological cruise rhythm without pegging to maxSpeed
    const speedRatio = this.speed / Math.max(0.1, this.targetSpeed);
    const throttle = THREE.MathUtils.clamp(1.35 - 0.65 * speedRatio, 0.25, 1.4);
    let propMag = this.config.propulsionStrength * throttle;
    if (this.isGliding) {
      propMag *= 0.08; // Glide has minimal active thrust
    } else {
      // Downstroke coupling: wing push produces subtle forward thrust modulation
      propMag *= (1.0 + 0.18 * downstrokeImpulse);
      propMag *= (0.65 + 0.35 * this.energy);
    }
    this._propulsionForce.copy(this.direction).multiplyScalar(propMag);

    // 2. Steering Force (Reynolds autonomous vehicle steering towards desired velocity)
    this._desiredVel.copy(this.desiredDirection).multiplyScalar(this.targetSpeed);
    this.steeringForce.subVectors(this._desiredVel, this.velocity).multiplyScalar(this.config.steeringResponse);
    this.steeringForce.clampLength(0, this.config.maxSteeringForce);

    // 3. Aerodynamic Lift & Vertical Control
    let liftMag = 0;
    if (!this.isGliding) {
      // Downstroke lift pulse
      liftMag = downstrokeImpulse * 0.12 * this.config.liftRatio;
    } else {
      // Aerodynamic glide lift scaling with speed squared
      liftMag = Math.min(0.20, (this.speed * this.speed) * 0.45);
    }
    this._liftForce.set(0, liftMag, 0);

    // 4. Soft Composition Containment Force (never hits a wall; gently steers back)
    this.computeSoftContainmentForce(this.containmentForce);

    // 5. Quadratic Fluid Drag: F_drag = -k * |v| * v
    // Prevents runaway speed and creates natural deceleration/coasting
    const dragMag = this.config.dragCoefficient * (1.0 + this.speed * 0.45);
    this._dragForce.copy(this.velocity).multiplyScalar(-dragMag);

    // Net Acceleration sum
    this._netAccel.set(0, 0, 0);
    this._netAccel.add(this._propulsionForce);
    this._netAccel.add(this.steeringForce);
    this._netAccel.add(this._liftForce);
    this._netAccel.add(this.containmentForce);
    this._netAccel.add(this._dragForce);

    this.acceleration.copy(this._netAccel);
  }

  /**
   * Soft quadratic containment force keeping the creature naturally framed around EXIST.
   */
  private computeSoftContainmentForce(out: THREE.Vector3): void {
    out.set(0, 0, 0);

    const dx = this.position.x - this.center.x;
    const dy = this.position.y - this.center.y;
    const dz = this.position.z - this.center.z;

    const absDx = Math.abs(dx);
    if (absDx > this.safeSpan.x) {
      const pen = (absDx - this.safeSpan.x) / this.margin.x;
      out.x -= Math.sign(dx) * Math.min(pen * pen, 3.0) * this.config.containmentStiffness * 1.6;
    }

    const absDy = Math.abs(dy);
    if (absDy > this.safeSpan.y) {
      const pen = (absDy - this.safeSpan.y) / this.margin.y;
      out.y -= Math.sign(dy) * Math.min(pen * pen, 3.0) * this.config.containmentStiffness * 1.6;
    }

    const absDz = Math.abs(dz);
    if (absDz > this.safeSpan.z) {
      const pen = (absDz - this.safeSpan.z) / this.margin.z;
      out.z -= Math.sign(dz) * Math.min(pen * pen, 3.0) * this.config.containmentStiffness * 1.6;
    }

    // Limit maximum containment nudge so it never looks like a violent bounce
    out.clampLength(0, 1.8);
  }

  /**
   * Authoritative orientation derived from actual velocity with rotational inertia and lateral banking.
   * Uses an orthonormal Gram-Schmidt reference frame aligned with canonical model axes:
   * - Column 0 (X): Right
   * - Column 1 (Y): Forward (head)
   * - Column 2 (Z): Up (dorsal carapace)
   * Strictly zero heap allocations.
   */
  private updateAuthoritativeOrientation(delta: number): void {
    this._prevQuat.copy(this.root.quaternion);

    if (this.speed > 0.01) {
      this._actualForward.copy(this.velocity).normalize();

      // Gram-Schmidt orthonormalization: project reference up perpendicular to flight direction
      this._orthoUp.copy(this._worldUp).addScaledVector(this._actualForward, -this._worldUp.dot(this._actualForward));
      if (this._orthoUp.lengthSq() < 0.0001) {
        // Fallback when flying straight along camera depth axis
        this._orthoUp.copy(this._fallbackUp).addScaledVector(this._actualForward, -this._fallbackUp.dot(this._actualForward));
      }
      this._orthoUp.normalize();

      // Right = Forward x Up
      this._orthoRight.crossVectors(this._actualForward, this._orthoUp).normalize();

      // Dynamic banking proportional to lateral turning acceleration
      let lateralAccel = 0;
      if (this.acceleration.lengthSq() > 0.0001) {
        lateralAccel = this.acceleration.dot(this._orthoRight);
      }

      const targetBank = -THREE.MathUtils.clamp(
        lateralAccel * this.config.bankStrength,
        -this.config.maxBankAngle,
        this.config.maxBankAngle
      );
      this.bank += (targetBank - this.bank) * (1 - Math.exp(-this.config.bankDamping * delta));

      // Apply banking roll around flight axis (actualForward)
      if (Math.abs(this.bank) > 0.001) {
        this._bankQuat.setFromAxisAngle(this._actualForward, this.bank);
        this._orthoRight.applyQuaternion(this._bankQuat);
        this._orthoUp.applyQuaternion(this._bankQuat);
      }

      // Build target matrix: column 0 = Right (X), column 1 = Forward (Y, head), column 2 = Up (Z, dorsal)
      this._basisMatrix.makeBasis(this._orthoRight, this._actualForward, this._orthoUp);
      this._targetQuat.setFromRotationMatrix(this._basisMatrix);

      // Rotational inertia: critically damped slerp so the creature carves naturally through turns
      this.root.quaternion.slerp(
        this._targetQuat,
        1 - Math.exp(-this.config.rotationInertiaDamping * delta)
      );
    }

    // Compute angular velocity from quaternion delta
    if (delta > 0.0001) {
      this._deltaQuat.copy(this._prevQuat).invert().multiply(this.root.quaternion);
      this._deltaEuler.setFromQuaternion(this._deltaQuat, "XYZ");
      this.angularVelocity.set(
        THREE.MathUtils.clamp(this._deltaEuler.x / delta, -5, 5),
        THREE.MathUtils.clamp(this._deltaEuler.y / delta, -5, 5),
        THREE.MathUtils.clamp(this._deltaEuler.z / delta, -5, 5)
      );
    } else {
      this.angularVelocity.set(0, 0, 0);
    }
  }

  /**
   * Classifies current flight phase organically from flight state conditions.
   */
  private classifyFlightPhase(): void {
    if (this.isGliding) {
      this.flightPhase = FlightPhase.GLIDING;
    } else if (this.energy < 0.22) {
      this.flightPhase = FlightPhase.RECOVERING;
    } else if (Math.abs(this.bank) > 0.10 && this.angularVelocity.length() > 0.55) {
      this.flightPhase = FlightPhase.TURNING;
    } else if (this.acceleration.dot(this.direction) > 0.25) {
      this.flightPhase = FlightPhase.ACCELERATING;
    } else if (this.velocity.y > 0.18) {
      this.flightPhase = FlightPhase.CLIMBING;
    } else if (this.velocity.y < -0.18) {
      this.flightPhase = FlightPhase.DESCENDING;
    } else {
      this.flightPhase = FlightPhase.CRUISE;
    }
  }

  /**
   * Synchronizes public read-only motion telemetry state object.
   */
  private syncMotionState(): void {
    this.motionState.speed = this.speed;
    this.motionState.bank = this.bank;
    this.motionState.flightTime = this.flightTime;
    this.motionState.flightPhase = this.flightPhase;
    this.motionState.energy = this.energy;
    this.motionState.isGliding = this.isGliding;
  }

  /**
   * Telemetry snapshot for debug inspection and UI overlay.
   */
  public getDebugTelemetry() {
    this._actualForward.copy(BUTTERFLY_CANONICAL_FORWARD).applyQuaternion(this.root.quaternion);
    const headDotVel = this.speed > 0.001 ? this._actualForward.dot(this.direction) : 1;
    const headingErrorDeg = (Math.acos(Math.max(-1, Math.min(1, headDotVel))) * 180) / Math.PI;

    return {
      phase: this.flightPhase,
      speed: this.speed,
      energy: this.energy,
      bankDeg: (this.bank * 180) / Math.PI,
      isGliding: this.isGliding,
      posX: this.position.x,
      posY: this.position.y,
      posZ: this.position.z,
      velX: this.velocity.x,
      velY: this.velocity.y,
      velZ: this.velocity.z,
      headX: this._actualForward.x,
      headY: this._actualForward.y,
      headZ: this._actualForward.z,
      headingErrorDeg,
      accelMag: this.acceleration.length(),
      steerMag: this.steeringForce.length(),
      containMag: this.containmentForce.length()
    };
  }
}
