import * as THREE from "three";

/**
 * AntennaSystem manages the twin sweeping antennae:
 * - Proud, sweeping 3D Catmull-Rom crescent arcs curving forward and outward
 * - Tapered tube geometry with terminal apical teardrop droplets
 * - Independent left and right antenna groups for secondary motion integration
 */
export interface AntennaMotionConfig {
  /** Critically damped settling rate (default: 6.5) */
  damping?: number;
  /** Forward acceleration reaction scale (default: 1.0) */
  accelResponse?: number;
  /** Wing downwash impulse reaction scale (default: 1.0) */
  downwashResponse?: number;
  /** Angular turning lag scale (default: 1.0) */
  turnResponse?: number;
  /** Ambient desynchronized micro-motion scale (default: 0.005) */
  microMotionScale?: number;
  /** Whether antennae are mounted directly to the head frame (default: true) */
  isMountedOnHead?: boolean;
}

/**
 * AntennaSystem manages the twin sweeping antennae:
 * - Proud, sweeping 3D Catmull-Rom crescent arcs curving forward and outward
 * - Tapered tube geometry with terminal apical teardrop droplets
 * - Independent left and right antenna groups for secondary motion integration
 * - Cranial attachment with damped inertia reacting to flight acceleration, turning, and wing downwash
 */
export class AntennaSystem {
  public readonly group: THREE.Group;
  public readonly leftAntennaGroup: THREE.Group;
  public readonly rightAntennaGroup: THREE.Group;

  // Tunable configuration
  public damping: number;
  public accelResponse: number;
  public downwashResponse: number;
  public turnResponse: number;
  public microMotionScale: number;

  // Inertial tracking state
  private leftPitch: number = 0;
  private leftYaw: number = 0;
  private leftRoll: number = 0;
  private rightPitch: number = 0;
  private rightYaw: number = 0;
  private rightRoll: number = 0;

  // Environmental micro-tremor timeline
  private microTimeline: number = 0;

  constructor(
    material: THREE.Material,
    beadMaterial?: THREE.Material,
    config: AntennaMotionConfig = {}
  ) {
    this.group = new THREE.Group();
    this.group.name = "AntennaSystem";

    this.damping = config.damping ?? 6.5;
    this.accelResponse = config.accelResponse ?? 1.0;
    this.downwashResponse = config.downwashResponse ?? 1.0;
    this.turnResponse = config.turnResponse ?? 1.0;
    this.microMotionScale = config.microMotionScale ?? 0.005;

    const isMountedOnHead = config.isMountedOnHead ?? true;

    this.leftAntennaGroup = new THREE.Group();
    this.leftAntennaGroup.name = "LeftAntennaGroup";
    this.rightAntennaGroup = new THREE.Group();
    this.rightAntennaGroup.name = "RightAntennaGroup";

    if (isMountedOnHead) {
      // Anchored to cranium in headGroup local frame: cranium center is at (0, 0, 0), apex is at y ~ 0.06, z ~ 0.02
      this.leftAntennaGroup.position.set(-0.038, 0.06, 0.02);
      this.rightAntennaGroup.position.set(0.038, 0.06, 0.02);
    } else {
      // Standalone coordinates relative to body root
      this.leftAntennaGroup.position.set(-0.038, 0.28, 0.05);
      this.rightAntennaGroup.position.set(0.038, 0.28, 0.05);
    }

    const leftMesh = this.buildAntennaMesh(false, material, beadMaterial ?? material);
    const rightMesh = this.buildAntennaMesh(true, material, beadMaterial ?? material);

    this.leftAntennaGroup.add(leftMesh);
    this.rightAntennaGroup.add(rightMesh);

    this.group.add(this.leftAntennaGroup);
    this.group.add(this.rightAntennaGroup);
  }

  /**
   * Applies secondary inertial response:
   * Antennae lag behind acceleration, turning, body pitch, and wing flap downwash vortices.
   */
  public update(
    delta: number,
    flapVelocity: number,
    downstrokeImpulse: number = 0,
    bodyPitch: number = 0,
    bank: number = 0,
    accelForward: number = 0,
    angularYaw: number = 0
  ): void {
    this.microTimeline += delta;

    // 1. Aerodynamic downwash impulse from wing downstroke + body pitch lag
    const downwash = (-downstrokeImpulse * 0.016 - flapVelocity * 0.012) * this.downwashResponse;
    const accelPitchLag = -accelForward * 0.024 * this.accelResponse;
    const targetPitch = -bodyPitch * 0.70 + downwash + accelPitchLag;

    // 2. Turning drag and centripetal yaw lag
    const turnLag = -angularYaw * 0.035 * this.turnResponse;
    const bankDrag = bank * 0.20;

    // 3. Ethereal ambient micro-tremor (desynchronized frequencies break symmetry)
    const t = this.microTimeline;
    const microPitchL = (Math.sin(t * 2.7) * 0.7 + Math.cos(t * 4.3 + 0.5) * 0.3) * this.microMotionScale;
    const microPitchR = (Math.sin(t * 2.9 + 1.1) * 0.7 + Math.cos(t * 4.1 + 1.8) * 0.3) * this.microMotionScale;
    const microYawL = Math.sin(t * 3.3 + 0.7) * this.microMotionScale * 0.8;
    const microYawR = Math.sin(t * 3.1 + 2.2) * this.microMotionScale * 0.8;

    const targetLeftPitch = targetPitch + microPitchL;
    const targetRightPitch = targetPitch + microPitchR;

    const targetLeftYaw = bankDrag + turnLag + microYawL;
    const targetRightYaw = bankDrag + turnLag + microYawR;

    // 4. Critically damped settling: smooth, organic, zero jitter
    const decay = 1 - Math.exp(-this.damping * delta);

    this.leftPitch += (targetLeftPitch - this.leftPitch) * decay;
    this.rightPitch += (targetRightPitch - this.rightPitch) * decay;
    this.leftYaw += (targetLeftYaw - this.leftYaw) * decay;
    this.rightYaw += (targetRightYaw - this.rightYaw) * decay;

    // Subtle axial twist responding to turn
    const targetRoll = -bank * 0.08;
    this.leftRoll += (targetRoll - this.leftRoll) * decay;
    this.rightRoll += (targetRoll - this.rightRoll) * decay;

    this.leftAntennaGroup.rotation.set(this.leftPitch, this.leftRoll, this.leftYaw);
    this.rightAntennaGroup.rotation.set(this.rightPitch, -this.rightRoll, -this.rightYaw);
  }

  /**
   * Generates a tapered curved tube for one antenna.
   */
  private buildAntennaMesh(
    isRight: boolean,
    material: THREE.Material,
    beadMaterial: THREE.Material
  ): THREE.Group {
    const sign = isRight ? 1 : -1;
    const antennaGroup = new THREE.Group();

    // 5-point spline defining the sweeping antenna trajectory
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.06 * sign, 0.15, 0.035),
      new THREE.Vector3(0.22 * sign, 0.36, 0.075),
      new THREE.Vector3(0.44 * sign, 0.54, 0.095),
      new THREE.Vector3(0.62 * sign, 0.68, 0.055)
    ]);

    const tubularSegments = 56;
    const radialSegments = 12;
    const baseRadius = 0.013;
    const tipRadius = 0.0035;

    const tubeGeo = new THREE.BufferGeometry();
    const numVerts = (tubularSegments + 1) * radialSegments;
    const positions = new Float32Array(numVerts * 3);
    const normals = new Float32Array(numVerts * 3);
    const uvs = new Float32Array(numVerts * 2);

    const frames = curve.computeFrenetFrames(tubularSegments, false);

    let vIdx = 0;
    let uvIdx = 0;

    for (let i = 0; i <= tubularSegments; i++) {
      const u = i / tubularSegments;
      const point = curve.getPointAt(u);
      const N = frames.normals[i];
      const B = frames.binormals[i];

      const currentRadius = THREE.MathUtils.lerp(baseRadius, tipRadius, Math.pow(u, 0.60));

      for (let j = 0; j < radialSegments; j++) {
        const v = j / radialSegments;
        const theta = v * Math.PI * 2.0;

        const sinT = Math.sin(theta);
        const cosT = Math.cos(theta);

        const normal = new THREE.Vector3()
          .copy(N)
          .multiplyScalar(cosT)
          .addScaledVector(B, sinT)
          .normalize();

        const px = point.x + normal.x * currentRadius;
        const py = point.y + normal.y * currentRadius;
        const pz = point.z + normal.z * currentRadius;

        positions[vIdx * 3] = px;
        positions[vIdx * 3 + 1] = py;
        positions[vIdx * 3 + 2] = pz;

        normals[vIdx * 3] = normal.x;
        normals[vIdx * 3 + 1] = normal.y;
        normals[vIdx * 3 + 2] = normal.z;

        uvs[uvIdx * 2] = v;
        uvs[uvIdx * 2 + 1] = u;

        vIdx++;
        uvIdx++;
      }
    }

    const indices: number[] = [];
    for (let i = 0; i < tubularSegments; i++) {
      for (let j = 0; j < radialSegments; j++) {
        const nextJ = (j + 1) % radialSegments;
        const a = i * radialSegments + j;
        const b = (i + 1) * radialSegments + j;
        const c = (i + 1) * radialSegments + nextJ;
        const d = i * radialSegments + nextJ;

        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    tubeGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    tubeGeo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    tubeGeo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    tubeGeo.setIndex(indices);

    const tubeMesh = new THREE.Mesh(tubeGeo, material);
    tubeMesh.name = isRight ? "RightAntennaShaft" : "LeftAntennaShaft";
    antennaGroup.add(tubeMesh);

    // Terminal droplet bead at the apex
    const tipPoint = curve.getPointAt(1.0);
    const beadGeo = new THREE.SphereGeometry(0.0125, 16, 12);
    beadGeo.scale(0.8, 1.4, 0.8);
    const beadMesh = new THREE.Mesh(beadGeo, beadMaterial);
    beadMesh.name = isRight ? "RightAntennaBead" : "LeftAntennaBead";
    beadMesh.position.copy(tipPoint);
    beadMesh.position.addScaledVector(frames.tangents[tubularSegments], 0.006);
    antennaGroup.add(beadMesh);

    return antennaGroup;
  }
}
