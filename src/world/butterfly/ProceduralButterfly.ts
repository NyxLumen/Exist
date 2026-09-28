import * as THREE from "three";
import { BodyGeometry, BodyParts } from "./BodyGeometry.ts";
import { AntennaSystem } from "./AntennaSystem.ts";
import { WingGeometry } from "./WingGeometry.ts";
import { TrailingStreamers } from "./TrailingStreamers.ts";
import { WingAnimation } from "./WingAnimation.ts";
import { WingDeformation } from "./WingDeformation.ts";
import { StreamerDeformation } from "./StreamerDeformation.ts";
import { BodyMotion } from "./BodyMotion.ts";
import { FlightMotionState } from "../FlightController.ts";

export interface ProceduralButterflyConfig {
  neutralMaterial?: boolean;
}

/**
 * ProceduralButterfly is the master modular coordinator for the procedural creature:
 * - Decoupled modular subsystems (Body, Antenna, Wings, Streamers, Animation, Deformation)
 * - Stage 2: GPU-side aeroelastic wing deformation, asymmetric flap kinematics,
 *   subtle bilateral asymmetry, secondary antenna inertia, and fluid streamer wave dynamics.
 * - Stage 3: Bioluminescent chitin, luminous eye facets, glowing antenna beads, ocelli.
 * - Stage 4: Secondary creature motion: dynamic thorax reaction, progressive 7-segment abdomen inertia,
 *   cranial-anchored antennae lag, velocity-trailing streamers, and subconscious biological pulse.
 */
export class ProceduralButterfly {
  public readonly group: THREE.Group;

  // Subsystem instances & groups
  public readonly bodyParts: BodyParts;
  public readonly bodyGroup: THREE.Group;
  public readonly antennaSystem: AntennaSystem;
  public readonly bodyMotion: BodyMotion;
  public readonly wingAnimation: WingAnimation;

  // Wing pivots (hinges aligned along thoracic carapace)
  public readonly leftForewingPivot: THREE.Group;
  public readonly rightForewingPivot: THREE.Group;
  public readonly leftHindwingPivot: THREE.Group;
  public readonly rightHindwingPivot: THREE.Group;

  // Wing meshes
  public readonly leftForewingMesh: THREE.Mesh;
  public readonly rightForewingMesh: THREE.Mesh;
  public readonly leftHindwingMesh: THREE.Mesh;
  public readonly rightHindwingMesh: THREE.Mesh;

  // GPU Wing Deformations
  public readonly leftForewingDeform: WingDeformation;
  public readonly rightForewingDeform: WingDeformation;
  public readonly leftHindwingDeform: WingDeformation;
  public readonly rightHindwingDeform: WingDeformation;

  // Streamers & Deformation
  public readonly streamersGroup: THREE.Group;
  public readonly streamerMeshes: THREE.Mesh[] = [];
  public readonly streamerDeform: StreamerDeformation;

  // Internal timeline
  private elapsedTime: number = 0;

  // Reusable scratch feedback for zero-allocation locomotion coupling
  private readonly _wingbeatFeedback = {
    flapPhase: 0,
    flapVelocity: 0,
    downstrokeImpulse: 0,
    isDownstroke: false
  };

  // Geometry and material registries for clean lifecycle disposal
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(_config: ProceduralButterflyConfig = {}) {
    this.group = new THREE.Group();
    this.group.name = "ProceduralButterflyRoot";

    // 1. Initialize Kinematics & Secondary Motion Subsystems
    this.wingAnimation = new WingAnimation();

    // 2. Stage 3: Bioluminescent body materials (iridescent chitin, luminous eye facets, glowing antenna beads)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x070815,
      roughness: 0.28,
      metalness: 0.38,
      emissive: 0x020718,
      emissiveIntensity: 0.85,
      side: THREE.DoubleSide
    });
    this.materials.push(bodyMat);

    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x021626,
      roughness: 0.12,
      metalness: 0.45,
      emissive: 0x00d4ff,
      emissiveIntensity: 1.6
    });
    this.materials.push(eyeMat);

    const beadMat = new THREE.MeshStandardMaterial({
      color: 0x08283a,
      roughness: 0.10,
      metalness: 0.25,
      emissive: 0x00f0ff,
      emissiveIntensity: 3.2
    });
    this.materials.push(beadMat);

    // 3. Build Procedural Body & Articulated Motion
    this.bodyParts = BodyGeometry.createBody(bodyMat, eyeMat);
    this.bodyGroup = this.bodyParts.root;
    this.bodyMotion = new BodyMotion(this.bodyParts);
    this.group.add(this.bodyGroup);

    // 4. Build Antenna System & Anchor to Cranial Head Frame
    this.antennaSystem = new AntennaSystem(bodyMat, beadMat, { isMountedOnHead: true });
    this.bodyParts.head.add(this.antennaSystem.group);

    // 5. Configure Wing Pivots at thoracic hinge sockets
    this.leftForewingPivot = new THREE.Group();
    this.leftForewingPivot.name = "LeftForewingPivot";
    this.leftForewingPivot.position.set(-0.06, 0.04, 0.035);

    this.rightForewingPivot = new THREE.Group();
    this.rightForewingPivot.name = "RightForewingPivot";
    this.rightForewingPivot.position.set(0.06, 0.04, 0.035);

    this.leftHindwingPivot = new THREE.Group();
    this.leftHindwingPivot.name = "LeftHindwingPivot";
    this.leftHindwingPivot.position.set(-0.05, -0.06, 0.02);

    this.rightHindwingPivot = new THREE.Group();
    this.rightHindwingPivot.name = "RightHindwingPivot";
    this.rightHindwingPivot.position.set(0.05, -0.06, 0.02);

    // 6. Instantiate GPU Wing Deformation Materials
    this.leftForewingDeform = new WingDeformation(false, false);
    this.rightForewingDeform = new WingDeformation(true, false);
    this.leftHindwingDeform = new WingDeformation(false, true);
    this.rightHindwingDeform = new WingDeformation(true, true);

    this.materials.push(
      this.leftForewingDeform.material,
      this.rightForewingDeform.material,
      this.leftHindwingDeform.material,
      this.rightHindwingDeform.material
    );

    // 7. Generate Procedural Wing Geometries & Meshes
    const leftForewingGeo = WingGeometry.createForewing(false);
    const rightForewingGeo = WingGeometry.createForewing(true);
    const leftHindwingGeo = WingGeometry.createHindwing(false);
    const rightHindwingGeo = WingGeometry.createHindwing(true);

    this.geometries.push(leftForewingGeo, rightForewingGeo, leftHindwingGeo, rightHindwingGeo);

    this.leftForewingMesh = new THREE.Mesh(leftForewingGeo, this.leftForewingDeform.material);
    this.leftForewingMesh.name = "LeftForewing";
    this.leftForewingMesh.castShadow = true;
    this.leftForewingMesh.receiveShadow = true;
    this.leftForewingPivot.add(this.leftForewingMesh);

    this.rightForewingMesh = new THREE.Mesh(rightForewingGeo, this.rightForewingDeform.material);
    this.rightForewingMesh.name = "RightForewing";
    this.rightForewingMesh.castShadow = true;
    this.rightForewingMesh.receiveShadow = true;
    this.rightForewingPivot.add(this.rightForewingMesh);

    this.leftHindwingMesh = new THREE.Mesh(leftHindwingGeo, this.leftHindwingDeform.material);
    this.leftHindwingMesh.name = "LeftHindwing";
    this.leftHindwingMesh.castShadow = true;
    this.leftHindwingMesh.receiveShadow = true;
    this.leftHindwingPivot.add(this.leftHindwingMesh);

    this.rightHindwingMesh = new THREE.Mesh(rightHindwingGeo, this.rightHindwingDeform.material);
    this.rightHindwingMesh.name = "RightHindwing";
    this.rightHindwingMesh.castShadow = true;
    this.rightHindwingMesh.receiveShadow = true;
    this.rightHindwingPivot.add(this.rightHindwingMesh);

    this.group.add(this.leftForewingPivot);
    this.group.add(this.rightForewingPivot);
    this.group.add(this.leftHindwingPivot);
    this.group.add(this.rightHindwingPivot);

    // 8. Generate Trailing Streamers with GPU Wave Deformation
    this.streamersGroup = new THREE.Group();
    this.streamersGroup.name = "TrailingStreamersGroup";

    this.streamerDeform = new StreamerDeformation();
    this.materials.push(this.streamerDeform.material);

    const allStreamers = TrailingStreamers.createAllStreamers();
    const streamerGeos = [
      { geo: allStreamers.innerLeft, name: "Streamer_InnerLeft" },
      { geo: allStreamers.innerRight, name: "Streamer_InnerRight" },
      { geo: allStreamers.outerLeft, name: "Streamer_OuterLeft" },
      { geo: allStreamers.outerRight, name: "Streamer_OuterRight" }
    ];

    for (const item of streamerGeos) {
      this.geometries.push(item.geo);
      const mesh = new THREE.Mesh(item.geo, this.streamerDeform.material);
      mesh.name = item.name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.streamerMeshes.push(mesh);
      this.streamersGroup.add(mesh);
    }

    this.group.add(this.streamersGroup);
  }

  /**
   * Main procedural animation update:
   * Coordinates Primary Wingbeat -> Secondary Body & Orientation -> Tertiary Antennae, Streamers & Biological Pulse.
   */
  public update(delta: number, motionOrSpeed: number | FlightMotionState = 0, bank: number = 0): void {
    this.elapsedTime += delta;

    let speed = 0;
    let bankVal = bank;
    let accelForward = 0;
    let accelLateral = 0;
    let angularPitch = 0;
    let angularYaw = 0;

    if (typeof motionOrSpeed === "object" && motionOrSpeed !== null) {
      speed = motionOrSpeed.speed;
      bankVal = motionOrSpeed.bank;

      // Longitudinal acceleration
      accelForward = motionOrSpeed.acceleration.dot(motionOrSpeed.direction);

      // Lateral acceleration along right vector
      const rx = -motionOrSpeed.direction.z;
      const rz = motionOrSpeed.direction.x;
      const rLen = Math.hypot(rx, rz);
      if (rLen > 0.001) {
        accelLateral = (motionOrSpeed.acceleration.x * rx + motionOrSpeed.acceleration.z * rz) / rLen;
      }

      angularPitch = motionOrSpeed.angularVelocity.x;
      angularYaw = motionOrSpeed.angularVelocity.y;
    } else {
      speed = motionOrSpeed;
      bankVal = bank;
    }

    // 1. PRIMARY: Evaluate asymmetric flapping kinematics & stroke signals
    const stroke = this.wingAnimation.update(delta, speed, bankVal);

    // 2. PRIMARY: Update GPU vertex deformation uniforms for each wing (Locked Stage 2)
    this.leftForewingDeform.update(stroke.leftForewing, this.elapsedTime);
    this.rightForewingDeform.update(stroke.rightForewing, this.elapsedTime);
    this.leftHindwingDeform.update(stroke.leftHindwing, this.elapsedTime);
    this.rightHindwingDeform.update(stroke.rightHindwing, this.elapsedTime);

    // 3. SECONDARY: Dynamic thorax response, secondary orientation, and articulated 7-segment abdomen inertia
    this.bodyMotion.update(
      delta,
      stroke.bodyBob,
      stroke.bodyPitch,
      speed,
      bankVal,
      accelForward,
      accelLateral,
      angularPitch,
      angularYaw,
      stroke.downstrokeImpulse
    );

    // 4. TERTIARY: Antennae cranial damped inertia responding to flight acceleration, turning, and wing downwash
    this.antennaSystem.update(
      delta,
      stroke.leftForewing.flapVelocity,
      stroke.downstrokeImpulse,
      stroke.bodyPitch,
      bankVal,
      accelForward,
      angularYaw
    );

    // 5. TERTIARY: Trailing streamers fluid wave dynamics, velocity drag, and turning lag
    this.streamerDeform.update(
      this.elapsedTime,
      stroke.leftForewing.flapPhase,
      stroke.leftForewing.flapVelocity,
      speed,
      bankVal,
      delta,
      angularYaw,
      accelForward,
      stroke.downstrokeImpulse
    );
  }

  /**
   * Evaluates creature at an exact phase for visual stage inspection.
   */
  public evaluateAtPhase(phase: number, time: number = 0, speed: number = 0, bank: number = 0): void {
    const stroke = this.wingAnimation.evaluateAtPhase(phase, speed, bank);

    this.leftForewingDeform.update(stroke.leftForewing, time);
    this.rightForewingDeform.update(stroke.rightForewing, time);
    this.leftHindwingDeform.update(stroke.leftHindwing, time);
    this.rightHindwingDeform.update(stroke.rightHindwing, time);

    this.bodyMotion.update(0.016, stroke.bodyBob, stroke.bodyPitch, speed, bank, 0, 0, 0, 0, stroke.downstrokeImpulse);
    this.antennaSystem.update(0.016, stroke.leftForewing.flapVelocity, stroke.downstrokeImpulse, stroke.bodyPitch, bank);
    this.streamerDeform.update(
      time,
      stroke.leftForewing.flapPhase,
      stroke.leftForewing.flapVelocity,
      speed,
      bank,
      0.016,
      0,
      0,
      stroke.downstrokeImpulse
    );
  }

  /**
   * Returns current wingbeat telemetry for flight propulsion/lift coupling with zero allocations.
   */
  public getWingbeatFeedback(): { flapPhase: number; flapVelocity: number; downstrokeImpulse: number; isDownstroke: boolean } {
    const last = this.wingAnimation.lastOutputs;
    if (last) {
      this._wingbeatFeedback.flapPhase = last.leftForewing.flapPhase;
      this._wingbeatFeedback.flapVelocity = last.leftForewing.flapVelocity;
      this._wingbeatFeedback.downstrokeImpulse = last.downstrokeImpulse;
      this._wingbeatFeedback.isDownstroke = last.leftForewing.isDownstroke;
    }
    return this._wingbeatFeedback;
  }

  public dispose(): void {
    for (const geo of this.geometries) {
      geo.dispose();
    }
    this.geometries.length = 0;

    this.leftForewingDeform.dispose();
    this.rightForewingDeform.dispose();
    this.leftHindwingDeform.dispose();
    this.rightHindwingDeform.dispose();
    this.streamerDeform.dispose();

    for (const mat of this.materials) {
      mat.dispose();
    }
    this.materials.length = 0;

    this.group.clear();
  }
}
