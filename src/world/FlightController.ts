import * as THREE from "three";

/**
 * Inertial Butterfly Flight Controller.
 *
 * Simulates a curious, living creature casually wandering through 3D space:
 * - Slowly evolving directional intention driven by desynchronized low-frequency drift
 * - Natural fluid acceleration, momentum, and air drag
 * - Orientation derived strictly from ACTUAL VELOCITY with natural rotational lag
 * - Very subtle banking (max ~8-9 degrees)
 * - Ultra-weak soft center bias (never visibly turns toward center)
 * - Strictly zero per-frame memory allocations
 */
export class FlightController {
  private readonly root: THREE.Group;

  // Time tracking
  private flightTime: number = 0;
  private readonly idleDuration: number = 1.8; // Initial resting period
  private readonly liftoffDuration: number = 2.5; // Smooth gradual awakening

  // Kinematics
  public readonly position: THREE.Vector3 = new THREE.Vector3();
  public readonly velocity: THREE.Vector3 = new THREE.Vector3();
  public speed: number = 0;
  public bank: number = 0;

  // Physical parameters
  private readonly minSpeed: number = 0.14; // Near-hover wander speed
  private readonly maxCruiseSpeed: number = 0.60; // Normal effortless glide speed
  private readonly accelerationRate: number = 1.35; // Gentle responsiveness to intent
  private readonly maxForce: number = 1.1; // Gentle acceleration limit
  private readonly drag: number = 0.75; // Atmospheric fluid damping
  private readonly maxBankAngle: number = 0.15; // ~8.6 degrees max roll
  private readonly bankDamping: number = 2.6; // Heavy bank smoothing
  private readonly rotationDamping: number = 2.2; // Rotational lag settling rate

  // Soft composition envelope around "EXIST"
  private center = new THREE.Vector3(0.15, -0.35, 0.0);
  private safeSpan = { x: 1.45, y: 0.80, z: 0.60 };
  private margin = { x: 0.50, y: 0.40, z: 0.30 };
  private readonly restoringK: number = 0.38; // Ultra-weak restoring nudge

  // Initial resting pose near "ST"
  private readonly initialPosition = new THREE.Vector3(0.68, -0.94, 0.1);
  private readonly initialRotation = new THREE.Euler(0.46, -0.14, 0.04);
  private readonly initialQuat = new THREE.Quaternion().setFromEuler(this.initialRotation);

  // Pre-allocated scratch objects (strictly ZERO allocations per tick)
  private readonly _desiredDir = new THREE.Vector3();
  private readonly _desiredVel = new THREE.Vector3();
  private readonly _accel = new THREE.Vector3();
  private readonly _centerBias = new THREE.Vector3();
  private readonly _actualForward = new THREE.Vector3(0, 0, 1);
  private readonly _forwardAxis = new THREE.Vector3(0, 0, 1);
  private readonly _targetQuat = new THREE.Quaternion();
  private readonly _bankQuat = new THREE.Quaternion();
  private readonly _microOffset = new THREE.Vector3();

  constructor(root: THREE.Group) {
    this.root = root;
    this.resetToInitialPose();
  }

  public resetToInitialPose(): void {
    this.position.copy(this.initialPosition);
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.bank = 0;
    this.flightTime = 0;
    this.root.position.copy(this.position);
    this.root.quaternion.copy(this.initialQuat);
  }

  public setInitialPosition(x: number, y: number, z: number): void {
    this.initialPosition.set(x, y, z);
    if (this.flightTime < this.idleDuration) {
      this.position.copy(this.initialPosition);
      this.root.position.copy(this.position);
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

  public update(delta: number): void {
    this.flightTime += delta;

    // 1. Initial Resting Phase (~1.8s)
    if (this.flightTime < this.idleDuration) {
      // Very faint breathing hover (< 0.007 unit)
      const hoverY = Math.sin(this.flightTime * 2.1) * 0.006;
      const hoverX = Math.cos(this.flightTime * 1.4) * 0.004;
      this.root.position.set(
        this.position.x + hoverX,
        this.position.y + hoverY,
        this.position.z
      );
      this.root.quaternion.copy(this.initialQuat);
      return;
    }

    // 2. Smooth Liftoff Awakening Ramp (ramps from 0 to 1 over ~2.5s)
    const timeSinceAwake = this.flightTime - this.idleDuration;
    const rawRamp = Math.min(timeSinceAwake / this.liftoffDuration, 1.0);
    const liftoffRamp = rawRamp * rawRamp * (3.0 - 2.0 * rawRamp); // Smoothstep

    // 3. Desynchronized Multi-Harmonic Movement Energy
    // Combines 4 incommensurate, slow frequencies so no single periodic cycle is discernible
    const t = this.flightTime;
    const wave1 = Math.sin(t * 0.082) * 0.22;       // ~76.6s cycle
    const wave2 = Math.cos(t * 0.170 + 1.2) * 0.18; // ~37.0s cycle
    const wave3 = Math.sin(t * 0.270 + 2.7) * 0.14; // ~23.3s cycle
    const wave4 = Math.cos(t * 0.383 + 0.5) * 0.10; // ~16.4s cycle
    const baseEnergy = THREE.MathUtils.clamp(0.48 + wave1 + wave2 + wave3 + wave4, 0.0, 1.0);
    const effectiveEnergy = baseEnergy * liftoffRamp;

    // 4. Low-Frequency 3D Directional Drift Field (Continuous Intention)
    // Dominant wandering in the screen visual plane (X & Y) around the "EXIST" typography
    // Organic depth wander in Z (in front of / behind the typography plane)
    // Phase offsets ensure graceful liftoff ascending up and left toward center at t ~ 1.8s
    const wanderX =
      Math.sin(t * 0.073 + 4.2) * 0.70 +
      Math.cos(t * 0.031 + 2.6) * 0.45 +
      Math.sin(t * 0.137 + 0.9) * 0.25;

    const wanderY =
      Math.sin(t * 0.061 + 0.9) * 0.55 +
      Math.cos(t * 0.027 + 0.3) * 0.35 +
      Math.sin(t * 0.119 + 1.6) * 0.20;

    const wanderZ =
      Math.sin(t * 0.047 + 0.1) * 0.35 +
      Math.cos(t * 0.079 + 1.5) * 0.22 +
      Math.sin(t * 0.021 + 2.8) * 0.15;

    this._desiredDir.set(wanderX, wanderY, wanderZ);

    // Soft Intention Bias:
    // If the creature wanders away from the comfort volume, its intention naturally tilts back
    const dx = this.position.x - this.center.x;
    const dy = this.position.y - this.center.y;
    const dz = this.position.z - this.center.z;

    const normDx = dx / this.safeSpan.x;
    const normDy = dy / this.safeSpan.y;
    const normDz = dz / this.safeSpan.z;

    if (Math.abs(normDx) > 0.62) {
      const pen = Math.sign(normDx) * Math.pow(Math.abs(normDx) - 0.62, 1.5);
      this._desiredDir.x -= pen * 0.95;
    }
    if (Math.abs(normDy) > 0.62) {
      const pen = Math.sign(normDy) * Math.pow(Math.abs(normDy) - 0.62, 1.5);
      this._desiredDir.y -= pen * 0.95;
    }
    if (Math.abs(normDz) > 0.62) {
      const pen = Math.sign(normDz) * Math.pow(Math.abs(normDz) - 0.62, 1.5);
      this._desiredDir.z -= pen * 1.05;
    }

    this._desiredDir.normalize();

    // 5. Target Desired Velocity
    const targetSpeed = THREE.MathUtils.lerp(this.minSpeed, this.maxCruiseSpeed, effectiveEnergy);
    this._desiredVel.copy(this._desiredDir).multiplyScalar(targetSpeed);

    // 6. Ultra-Weak Soft Center Bias
    // Only activates softly when drifting beyond the comfort volume; never snaps or visibly turns toward center
    this.computeUltraWeakCenterBias(this._centerBias);

    // 7. Acceleration & Inertial Integration
    this._accel.subVectors(this._desiredVel, this.velocity).multiplyScalar(this.accelerationRate);
    this._accel.add(this._centerBias);
    this._accel.clampLength(0, this.maxForce);

    // Velocity update with atmospheric fluid drag
    this.velocity.addScaledVector(this._accel, delta);
    this.velocity.multiplyScalar(Math.exp(-this.drag * delta));
    this.speed = this.velocity.length();

    // Position integration
    this.position.addScaledVector(this.velocity, delta);

    // 8. Orientation Derived from ACTUAL VELOCITY with Rotational Lag
    if (this.speed > 0.025) {
      this._actualForward.copy(this.velocity).normalize();

      // Heading rotation aligning model's local +Z with actual forward velocity
      this._targetQuat.setFromUnitVectors(this._forwardAxis, this._actualForward);

      // Compute local right axis = actualForward x worldUp (0, 1, 0)
      const rx = -this._actualForward.z;
      const rz = this._actualForward.x;
      const rLen = Math.hypot(rx, rz);
      let lateralAccel = 0;
      if (rLen > 0.001) {
        lateralAccel = (this._accel.x * rx + this._accel.z * rz) / rLen;
      }

      // Very subtle banking (max ~8-9 degrees = 0.15 rad)
      const targetBank = -THREE.MathUtils.clamp(lateralAccel * 0.22, -this.maxBankAngle, this.maxBankAngle);
      this.bank += (targetBank - this.bank) * (1 - Math.exp(-this.bankDamping * delta));

      // Apply subtle roll along flight axis
      this._bankQuat.setFromAxisAngle(this._forwardAxis, this.bank);
      this._targetQuat.multiply(this._bankQuat);

      // Rotational lag: critically damped slerp so the creature takes a fraction of a second to settle into turns
      this.root.quaternion.slerp(this._targetQuat, 1 - Math.exp(-this.rotationDamping * delta));
    } else if (liftoffRamp < 0.1) {
      this.root.quaternion.copy(this.initialQuat);
    }

    // 9. Very Subtle Organic Micro-Movement (air-current floatiness)
    const microX = Math.sin(t * 1.3) * 0.010 + Math.cos(t * 2.7) * 0.005;
    const microY = Math.sin(t * 1.8 + 0.4) * 0.012; // Extremely conservative vertical lift
    const microZ = Math.cos(t * 1.1) * 0.008;
    this._microOffset.set(microX, microY, microZ);

    // 10. Update ButterflyController Transform
    this.root.position.copy(this.position).add(this._microOffset);
  }

  /**
   * Ultra-weak quadratic restoring bias.
   * Never forces a turn; simply applies an imperceptible nudge back towards the EXIST composition envelope.
   */
  private computeUltraWeakCenterBias(out: THREE.Vector3): void {
    out.set(0, 0, 0);

    const dx = this.position.x - this.center.x;
    const dy = this.position.y - this.center.y;
    const dz = this.position.z - this.center.z;

    const absDx = Math.abs(dx);
    if (absDx > this.safeSpan.x) {
      const pen = (absDx - this.safeSpan.x) / this.margin.x;
      out.x -= Math.sign(dx) * pen * pen * this.restoringK;
    }

    const absDy = Math.abs(dy);
    if (absDy > this.safeSpan.y) {
      const pen = (absDy - this.safeSpan.y) / this.margin.y;
      out.y -= Math.sign(dy) * pen * pen * this.restoringK;
    }

    const absDz = Math.abs(dz);
    if (absDz > this.safeSpan.z) {
      const pen = (absDz - this.safeSpan.z) / this.margin.z;
      out.z -= Math.sign(dz) * pen * pen * this.restoringK;
    }

    // Gentle maximum nudge: enough to overcome deep drift while remaining completely invisible
    out.clampLength(0, 0.65);
  }
}
