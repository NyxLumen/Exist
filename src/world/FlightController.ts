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
export class FlightController {
  private readonly root: THREE.Group;

  // Time & Lifecycle
  private flightTime: number = 0;
  private readonly idleDuration: number = 1.8;
  private readonly liftoffDuration: number = 2.5;

  // Authoritative Flight Kinematics
  public readonly position: THREE.Vector3 = new THREE.Vector3();
  public readonly velocity: THREE.Vector3 = new THREE.Vector3();
  public readonly acceleration: THREE.Vector3 = new THREE.Vector3();
  public readonly angularVelocity: THREE.Vector3 = new THREE.Vector3();
  public readonly direction: THREE.Vector3 = new THREE.Vector3(0, 0, 1);
  public readonly desiredDirection: THREE.Vector3 = new THREE.Vector3(0, 0, 1);
  public readonly steeringForce: THREE.Vector3 = new THREE.Vector3();
  public readonly containmentForce: THREE.Vector3 = new THREE.Vector3();

  public speed: number = 0;
  public bank: number = 0;
  public energy: number = 1.0;
  public flightPhase: FlightPhase = FlightPhase.RESTING;
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

  // Initial resting pose near "ST"
  private readonly initialPosition = new THREE.Vector3(0.68, -0.94, 0.1);
  private readonly initialRotation = new THREE.Euler(0.46, -0.14, 0.04);
  private readonly initialQuat = new THREE.Quaternion().setFromEuler(this.initialRotation);

  // Behavioral Wandering Intent State (Correlated Stochastic Drift)
  private intentPlaneAngle: number = 2.35; // Heading in visual plane (rad)
  private intentDepthAngle: number = 0.05; // Elevation in depth Z (rad)
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
  private readonly _actualForward = new THREE.Vector3(0, 0, 1);
  private readonly _forwardAxis = new THREE.Vector3(0, 0, 1);
  private readonly _worldUp = new THREE.Vector3(0, 1, 0);
  private readonly _rightAxis = new THREE.Vector3(1, 0, 0);
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
      propulsionStrength: config.propulsionStrength ?? 1.25,
      steeringResponse: config.steeringResponse ?? 2.2,
      maxSteeringForce: config.maxSteeringForce ?? 1.15,
      dragCoefficient: config.dragCoefficient ?? 0.72,
      liftRatio: config.liftRatio ?? 0.85,
      bankStrength: config.bankStrength ?? 0.24,
      maxBankAngle: config.maxBankAngle ?? 0.16,
      bankDamping: config.bankDamping ?? 2.8,
      rotationInertiaDamping: config.rotationInertiaDamping ?? 2.4,
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
      speed: 0,
      bank: 0,
      flightTime: 0,
      flightPhase: FlightPhase.RESTING,
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
    this.velocity.set(0, 0, 0);
    this.acceleration.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.direction.set(0, 0, 1);
    this.desiredDirection.set(-0.7, 0.7, 0.1).normalize();
    this.steeringForce.set(0, 0, 0);
    this.containmentForce.set(0, 0, 0);

    this.speed = 0;
    this.bank = 0;
    this.energy = 1.0;
    this.flightTime = 0;
    this.flightPhase = FlightPhase.RESTING;
    this.isGliding = false;
    this.glideTimer = 0;
    this.timeSinceLastGlide = 0;

    this.intentPlaneAngle = 2.35; // Facing up and left towards center
    this.intentDepthAngle = 0.05;
    this.intentPlaneRate = 0.0;
    this.intentDepthRate = 0.0;
    this.targetSpeed = this.config.cruiseSpeed;
    this.rngState = 0x89abcdef;

    this.root.position.copy(this.position);
    this.root.quaternion.copy(this.initialQuat);
    this._prevQuat.copy(this.initialQuat);
    this.syncMotionState();
  }

  public setInitialPosition(x: number, y: number, z: number): void {
    this.initialPosition.set(x, y, z);
    if (this.flightTime < this.idleDuration) {
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

    // 1. Initial Resting Phase (~1.8s)
    if (this.flightTime < this.idleDuration) {
      const hoverY = Math.sin(this.flightTime * 2.1) * 0.005;
      const hoverX = Math.cos(this.flightTime * 1.4) * 0.003;
      this.root.position.set(
        this.position.x + hoverX,
        this.position.y + hoverY,
        this.position.z
      );
      this.root.quaternion.copy(this.initialQuat);
      this._prevQuat.copy(this.initialQuat);

      this.velocity.set(0, 0, 0);
      this.acceleration.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
      this.direction.set(0, 0, 1);
      this.speed = 0;
      this.bank = 0;
      this.energy = 1.0;
      this.flightPhase = FlightPhase.RESTING;
      this.isGliding = false;

      this.syncMotionState();
      return;
    }

    // 2. Smooth Liftoff Awakening Ramp (0 to 1 over ~2.5s)
    const timeSinceAwake = this.flightTime - this.idleDuration;
    const rawRamp = Math.min(timeSinceAwake / this.liftoffDuration, 1.0);
    const liftoffRamp = rawRamp * rawRamp * (3.0 - 2.0 * rawRamp); // Smoothstep

    // 3. Update Correlated Stochastic Directional Intent
    this.updateDirectionalIntent(delta, liftoffRamp);

    // 4. Update Energy and Glide State Dynamics
    this.updateEnergyAndGlide(delta, liftoffRamp);

    // 5. Compute Flight Forces & Net Acceleration
    this.computeFlightForces(delta, liftoffRamp, wingFeedback);

    // 6. Integrate Velocity & Position (Physical Momentum)
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

    // 7. Authoritative Orientation Derived from Velocity with Rotational Inertia & Banking
    this.updateAuthoritativeOrientation(delta, liftoffRamp);

    // 8. Classify Current Flight Phase
    this.classifyFlightPhase(liftoffRamp);

    // 9. Synchronize Telemetry State
    this.syncMotionState();
  }

  /**
   * Correlated stochastic drift:
   * Heading intention evolves continuously with persistence rather than picking random targets.
   */
  private updateDirectionalIntent(delta: number, liftoffRamp: number): void {
    if (liftoffRamp < 0.05) {
      // Initial intent points upward and leftward into the EXIST composition
      this.desiredDirection.set(-0.65, 0.70, 0.28).normalize();
      return;
    }

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
  private updateEnergyAndGlide(delta: number, liftoffRamp: number): void {
    if (liftoffRamp < 0.2) {
      this.energy = 1.0;
      this.isGliding = false;
      return;
    }

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
  private computeFlightForces(_delta: number, liftoffRamp: number, wingFeedback?: WingbeatFeedback): void {
    const downstrokeImpulse = wingFeedback ? wingFeedback.downstrokeImpulse : 0;

    // 1. Propulsion Force (forward along current orientation)
    let propMag = this.config.propulsionStrength * liftoffRamp;
    if (this.isGliding) {
      propMag *= 0.10; // Glide has minimal active thrust
    } else {
      // Downstroke coupling: wing push produces subtle forward thrust modulation
      propMag *= (1.0 + 0.18 * downstrokeImpulse);
      propMag *= (0.65 + 0.35 * this.energy);
    }
    this._propulsionForce.copy(this.direction).multiplyScalar(propMag);

    // 2. Steering Force (Reynolds autonomous vehicle steering towards desired velocity)
    this._desiredVel.copy(this.desiredDirection).multiplyScalar(this.targetSpeed * liftoffRamp);
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
   */
  private updateAuthoritativeOrientation(delta: number, liftoffRamp: number): void {
    this._prevQuat.copy(this.root.quaternion);

    if (this.speed > 0.02) {
      this._actualForward.copy(this.velocity).normalize();

      // Heading rotation aligning model local +Z with actual forward velocity
      this._targetQuat.setFromUnitVectors(this._forwardAxis, this._actualForward);

      // Compute local lateral right axis = actualForward x worldUp
      this._rightAxis.crossVectors(this._actualForward, this._worldUp).normalize();
      let lateralAccel = 0;
      if (this._rightAxis.lengthSq() > 0.001) {
        lateralAccel = this.acceleration.dot(this._rightAxis);
      }

      // Dynamic banking proportional to lateral turning acceleration
      const targetBank = -THREE.MathUtils.clamp(
        lateralAccel * this.config.bankStrength,
        -this.config.maxBankAngle,
        this.config.maxBankAngle
      );
      this.bank += (targetBank - this.bank) * (1 - Math.exp(-this.config.bankDamping * delta));

      // Apply roll along flight axis
      this._bankQuat.setFromAxisAngle(this._forwardAxis, this.bank);
      this._targetQuat.multiply(this._bankQuat);

      // Rotational inertia: critically damped slerp so the creature carves naturally through turns
      this.root.quaternion.slerp(
        this._targetQuat,
        1 - Math.exp(-this.config.rotationInertiaDamping * delta)
      );
    } else if (liftoffRamp < 0.1) {
      this.root.quaternion.copy(this.initialQuat);
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
  private classifyFlightPhase(liftoffRamp: number): void {
    if (this.flightTime < this.idleDuration) {
      this.flightPhase = FlightPhase.RESTING;
    } else if (liftoffRamp < 0.95) {
      this.flightPhase = FlightPhase.AWAKENING;
    } else if (this.isGliding) {
      this.flightPhase = FlightPhase.GLIDING;
    } else if (this.energy < 0.22) {
      this.flightPhase = FlightPhase.RECOVERING;
    } else if (Math.abs(this.bank) > 0.10 && this.angularVelocity.length() > 0.55) {
      this.flightPhase = FlightPhase.TURNING;
    } else if (this.acceleration.dot(this.direction) > 0.35) {
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
      accelMag: this.acceleration.length(),
      steerMag: this.steeringForce.length(),
      containMag: this.containmentForce.length()
    };
  }
}
