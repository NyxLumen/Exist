import * as THREE from "three";

export type FlightState = "IDLE" | "CRUISING" | "TURNING" | "APPROACHING_TARGET";

export interface FlightBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * Procedural 3D flight steering controller for EXIST.
 * Operates strictly on ButterflyController to produce organic, living movement
 * with momentum, smooth quaternion orientation, natural banking, and soft boundary steering.
 */
export class FlightController {
  // Target root object being moved
  private readonly root: THREE.Group;

  // Flight states
  public state: FlightState = "IDLE";
  private flightTime: number = 0;
  private readonly idleDuration: number = 1.8; // Initial resting period in seconds

  // Kinematics
  public readonly position: THREE.Vector3 = new THREE.Vector3();
  public readonly velocity: THREE.Vector3 = new THREE.Vector3();
  public readonly target: THREE.Vector3 = new THREE.Vector3();
  public speed: number = 0;
  public bank: number = 0;

  // Steering parameters
  private readonly maxSpeed: number = 1.25; // Units / sec (delicate, graceful)
  private readonly minCruiseSpeed: number = 0.35;
  private readonly maxForce: number = 1.8; // Steering responsiveness / momentum
  private readonly arrivalRadius: number = 0.55;
  private readonly slowRadius: number = 1.3;
  private readonly maxBankAngle: number = 0.32; // ~18 degrees max roll
  private readonly rotationDamping: number = 3.6;
  private readonly bankDamping: number = 4.2;

  // Soft composition bounds (centered around "EXIST")
  private bounds: FlightBounds = {
    minX: -1.7,
    maxX: 1.7,
    minY: -1.3,
    maxY: 0.7,
    minZ: -1.1,
    maxZ: 1.1
  };
  private readonly margin = { x: 0.45, y: 0.35, z: 0.35 };
  private readonly softSpringK = 2.4;

  // Initial resting pose
  private readonly initialPosition = new THREE.Vector3(0.68, -0.94, 0.1);
  private readonly initialRotation = new THREE.Euler(0.46, -0.14, 0.04);
  private readonly initialQuat = new THREE.Quaternion().setFromEuler(this.initialRotation);

  // Pre-allocated scratch objects (strictly ZERO allocations per tick)
  private readonly _desiredVel = new THREE.Vector3();
  private readonly _steerForce = new THREE.Vector3();
  private readonly _softBias = new THREE.Vector3();
  private readonly _forwardDir = new THREE.Vector3(0, 0, 1);
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
    this.state = "IDLE";
    this.root.position.copy(this.position);
    this.root.quaternion.copy(this.initialQuat);
  }

  public setInitialPosition(x: number, y: number, z: number): void {
    this.initialPosition.set(x, y, z);
    if (this.state === "IDLE") {
      this.position.copy(this.initialPosition);
      this.root.position.copy(this.position);
    }
  }

  public resize(width: number, height: number): void {
    const aspect = width / height;
    if (aspect < 0.65) {
      // Narrow mobile
      this.bounds.minX = -0.85;
      this.bounds.maxX = 0.85;
      this.bounds.minY = -1.6;
      this.bounds.maxY = 0.4;
      this.setInitialPosition(0.10, -1.40, 0.1);
    } else if (aspect < 1.0) {
      // Portrait tablet
      this.bounds.minX = -1.2;
      this.bounds.maxX = 1.2;
      this.bounds.minY = -1.4;
      this.bounds.maxY = 0.55;
      this.setInitialPosition(0.30, -1.10, 0.1);
    } else if (aspect < 1.4) {
      // Landscape tablet / square desktop
      this.bounds.minX = -1.5;
      this.bounds.maxX = 1.5;
      this.bounds.minY = -1.35;
      this.bounds.maxY = 0.65;
      this.setInitialPosition(0.50, -0.98, 0.1);
    } else {
      // Standard desktop
      this.bounds.minX = -1.75;
      this.bounds.maxX = 1.75;
      this.bounds.minY = -1.3;
      this.bounds.maxY = 0.7;
      this.setInitialPosition(0.68, -0.94, 0.1);
    }
  }

  public update(delta: number): void {
    this.flightTime += delta;

    // 1. Initial Rest Period (IDLE)
    if (this.flightTime < this.idleDuration) {
      this.state = "IDLE";
      // Subtle stationary micro-hover breathing (< 0.015 unit drift)
      const hoverY = Math.sin(this.flightTime * 2.2) * 0.012;
      const hoverX = Math.cos(this.flightTime * 1.5) * 0.008;
      this.root.position.set(
        this.position.x + hoverX,
        this.position.y + hoverY,
        this.position.z
      );
      this.root.quaternion.copy(this.initialQuat);
      return;
    }

    // First transition from IDLE to active flight
    if (this.state === "IDLE") {
      this.pickNewTarget();
      this.state = "CRUISING";
    }

    // 2. Target Distance & Arrival Check
    const distToTarget = this.position.distanceTo(this.target);
    if (distToTarget < this.arrivalRadius) {
      this.pickNewTarget();
    }

    // 3. Desired Velocity Calculation (Arrival Steering)
    this._desiredVel.subVectors(this.target, this.position);
    const toTargetDist = this._desiredVel.length();

    let desiredSpeed = this.maxSpeed;
    if (toTargetDist < this.slowRadius) {
      // Smooth deceleration near waypoint
      const factor = toTargetDist / this.slowRadius;
      desiredSpeed = THREE.MathUtils.lerp(this.minCruiseSpeed, this.maxSpeed, factor);
      this.state = "APPROACHING_TARGET";
    } else {
      this.state = "CRUISING";
    }

    if (toTargetDist > 0.0001) {
      this._desiredVel.multiplyScalar(desiredSpeed / toTargetDist);
    } else {
      this._desiredVel.set(0, 0, 0);
    }

    // 4. Soft Boundary Steering Bias (curves naturally before touching limits)
    this.computeSoftBoundaryBias(this._softBias);

    // 5. Reynolds Steering Force
    this._steerForce.subVectors(this._desiredVel, this.velocity);
    this._steerForce.add(this._softBias);
    this._steerForce.clampLength(0, this.maxForce);

    // 6. Integrate Velocity & Position
    this.velocity.addScaledVector(this._steerForce, delta);
    this.speed = this.velocity.length();

    if (this.speed > this.maxSpeed) {
      this.velocity.multiplyScalar(this.maxSpeed / this.speed);
      this.speed = this.maxSpeed;
    }

    this.position.addScaledVector(this.velocity, delta);

    // 7. Turning & Banking Detection
    if (this.speed > 0.08) {
      this._forwardDir.copy(this.velocity).normalize();

      // Horizontal turn rate (yaw cross product)
      const turnRate = this.velocity.x * this._desiredVel.z - this.velocity.z * this._desiredVel.x;
      const turnMagnitude = Math.abs(turnRate);

      if (turnMagnitude > 0.12 && this.state !== "APPROACHING_TARGET") {
        this.state = "TURNING";
      }

      // Bank roll: inside wing dips into the turn
      const targetBank = -Math.sign(turnRate) * Math.min(turnMagnitude * 0.4, this.maxBankAngle);
      this.bank += (targetBank - this.bank) * (1 - Math.exp(-this.bankDamping * delta));

      // 8. Base Orientation from Forward Heading (+Z model axis)
      this._targetQuat.setFromUnitVectors(this._forwardAxis, this._forwardDir);

      // Apply banking around local Z (flight axis)
      this._bankQuat.setFromAxisAngle(this._forwardAxis, this.bank);
      this._targetQuat.multiply(this._bankQuat);

      // Smooth orientation slerp (no snapping, no gimbal lock)
      this.root.quaternion.slerp(this._targetQuat, 1 - Math.exp(-this.rotationDamping * delta));
    }

    // 9. Organic Micro-Movement (multi-harmonic low-frequency breathing)
    const t = this.flightTime;
    const microX = Math.sin(t * 1.7) * 0.025 + Math.cos(t * 3.1) * 0.012;
    const microY = Math.sin(t * 2.3 + 0.5) * 0.035 + Math.sin(t * 4.2) * 0.015;
    const microZ = Math.cos(t * 1.3) * 0.02;

    this._microOffset.set(microX, microY, microZ);

    // 10. Update Root Transform
    this.root.position.copy(this.position).add(this._microOffset);
  }

  /**
   * Computes a gentle, quadratic repulsion force away from boundaries.
   * Completely avoids sharp turns or hard-box bounces.
   */
  private computeSoftBoundaryBias(out: THREE.Vector3): void {
    out.set(0, 0, 0);

    // X axis soft boundary
    if (this.position.x > this.bounds.maxX - this.margin.x) {
      const pen = (this.position.x - (this.bounds.maxX - this.margin.x)) / this.margin.x;
      out.x -= pen * pen * this.softSpringK;
    } else if (this.position.x < this.bounds.minX + this.margin.x) {
      const pen = ((this.bounds.minX + this.margin.x) - this.position.x) / this.margin.x;
      out.x += pen * pen * this.softSpringK;
    }

    // Y axis soft boundary
    if (this.position.y > this.bounds.maxY - this.margin.y) {
      const pen = (this.position.y - (this.bounds.maxY - this.margin.y)) / this.margin.y;
      out.y -= pen * pen * this.softSpringK;
    } else if (this.position.y < this.bounds.minY + this.margin.y) {
      const pen = ((this.bounds.minY + this.margin.y) - this.position.y) / this.margin.y;
      out.y += pen * pen * this.softSpringK;
    }

    // Z axis soft boundary (depth)
    if (this.position.z > this.bounds.maxZ - this.margin.z) {
      const pen = (this.position.z - (this.bounds.maxZ - this.margin.z)) / this.margin.z;
      out.z -= pen * pen * this.softSpringK;
    } else if (this.position.z < this.bounds.minZ + this.margin.z) {
      const pen = ((this.bounds.minZ + this.margin.z) - this.position.z) / this.margin.z;
      out.z += pen * pen * this.softSpringK;
    }
  }

  /**
   * Selects an interior-weighted 3D target point within the flight volume.
   * Ensures the new waypoint has sufficient separation from current position.
   */
  private pickNewTarget(): void {
    const b = this.bounds;
    let attempts = 0;

    while (attempts < 10) {
      attempts++;
      // Interior-weighted sampling using average of two random values (triangular distribution)
      const tx = (Math.random() + Math.random()) * 0.5;
      const ty = (Math.random() + Math.random()) * 0.5;
      const tz = (Math.random() + Math.random()) * 0.5;

      const candX = THREE.MathUtils.lerp(b.minX + this.margin.x * 0.5, b.maxX - this.margin.x * 0.5, tx);
      const candY = THREE.MathUtils.lerp(b.minY + this.margin.y * 0.5, b.maxY - this.margin.y * 0.5, ty);
      const candZ = THREE.MathUtils.lerp(b.minZ + this.margin.z * 0.5, b.maxZ - this.margin.z * 0.5, tz);

      const dist = this.position.distanceToSquared(this._desiredVel.set(candX, candY, candZ));
      // Ensure target is at least 0.9 units away so flight has meaningful distance
      if (dist > 0.81 || attempts === 10) {
        this.target.set(candX, candY, candZ);
        break;
      }
    }
  }
}
