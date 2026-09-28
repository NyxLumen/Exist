import * as THREE from "three";
import { BodyGeometry } from "./BodyGeometry.ts";
import { AntennaSystem } from "./AntennaSystem.ts";
import { WingGeometry } from "./WingGeometry.ts";
import { TrailingStreamers } from "./TrailingStreamers.ts";

export interface ProceduralButterflyConfig {
  neutralMaterial?: boolean;
}

/**
 * ProceduralButterfly is the master modular coordinator for the procedural creature:
 * - Decoupled modular subsystems (Body, Antenna, Wings, Streamers)
 * - Stage 1: Evaluated in unlit/studio neutral clay material to guarantee pristine silhouette & proportions
 */
export class ProceduralButterfly {
  public readonly group: THREE.Group;

  // Subsystem instances & groups
  public readonly bodyGroup: THREE.Group;
  public readonly antennaSystem: AntennaSystem;

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

  // Streamers
  public readonly streamersGroup: THREE.Group;
  public readonly streamerMeshes: THREE.Mesh[] = [];

  // Material registry for clean lifecycle disposal
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(_config: ProceduralButterflyConfig = {}) {
    this.group = new THREE.Group();
    this.group.name = "ProceduralButterflyRoot";

    // STAGE 1: Pristine neutral studio clay material
    // Double-sided, smooth roughness (0.42), subtle micro-specular to inspect curvature and edge silhouette
    const neutralMaterial = new THREE.MeshStandardMaterial({
      color: 0x95a2b0,
      roughness: 0.45,
      metalness: 0.08,
      side: THREE.DoubleSide
    });
    this.materials.push(neutralMaterial);

    // 1. Build Procedural Body & Append
    this.bodyGroup = BodyGeometry.createBody(neutralMaterial);
    this.group.add(this.bodyGroup);

    // 2. Build Antenna System & Append
    this.antennaSystem = new AntennaSystem(neutralMaterial);
    this.group.add(this.antennaSystem.group);

    // 3. Configure Wing Pivots at thoracic hinge sockets
    // Forewing hinges: positioned at anterior dorsal thorax
    this.leftForewingPivot = new THREE.Group();
    this.leftForewingPivot.name = "LeftForewingPivot";
    this.leftForewingPivot.position.set(-0.06, 0.04, 0.035);

    this.rightForewingPivot = new THREE.Group();
    this.rightForewingPivot.name = "RightForewingPivot";
    this.rightForewingPivot.position.set(0.06, 0.04, 0.035);

    // Hindwing hinges: positioned at mid-posterior thorax
    this.leftHindwingPivot = new THREE.Group();
    this.leftHindwingPivot.name = "LeftHindwingPivot";
    this.leftHindwingPivot.position.set(-0.05, -0.06, 0.02);

    this.rightHindwingPivot = new THREE.Group();
    this.rightHindwingPivot.name = "RightHindwingPivot";
    this.rightHindwingPivot.position.set(0.05, -0.06, 0.02);

    // 4. Generate Procedural Wing Geometries & Meshes
    const leftForewingGeo = WingGeometry.createForewing(false);
    const rightForewingGeo = WingGeometry.createForewing(true);
    const leftHindwingGeo = WingGeometry.createHindwing(false);
    const rightHindwingGeo = WingGeometry.createHindwing(true);

    this.geometries.push(leftForewingGeo, rightForewingGeo, leftHindwingGeo, rightHindwingGeo);

    this.leftForewingMesh = new THREE.Mesh(leftForewingGeo, neutralMaterial);
    this.leftForewingMesh.name = "LeftForewing";
    this.leftForewingMesh.castShadow = true;
    this.leftForewingMesh.receiveShadow = true;
    this.leftForewingPivot.add(this.leftForewingMesh);

    this.rightForewingMesh = new THREE.Mesh(rightForewingGeo, neutralMaterial);
    this.rightForewingMesh.name = "RightForewing";
    this.rightForewingMesh.castShadow = true;
    this.rightForewingMesh.receiveShadow = true;
    this.rightForewingPivot.add(this.rightForewingMesh);

    this.leftHindwingMesh = new THREE.Mesh(leftHindwingGeo, neutralMaterial);
    this.leftHindwingMesh.name = "LeftHindwing";
    this.leftHindwingMesh.castShadow = true;
    this.leftHindwingMesh.receiveShadow = true;
    this.leftHindwingPivot.add(this.leftHindwingMesh);

    this.rightHindwingMesh = new THREE.Mesh(rightHindwingGeo, neutralMaterial);
    this.rightHindwingMesh.name = "RightHindwing";
    this.rightHindwingMesh.castShadow = true;
    this.rightHindwingMesh.receiveShadow = true;
    this.rightHindwingPivot.add(this.rightHindwingMesh);

    this.group.add(this.leftForewingPivot);
    this.group.add(this.rightForewingPivot);
    this.group.add(this.leftHindwingPivot);
    this.group.add(this.rightHindwingPivot);

    // 5. Generate Trailing Streamers
    this.streamersGroup = new THREE.Group();
    this.streamersGroup.name = "TrailingStreamersGroup";

    const allStreamers = TrailingStreamers.createAllStreamers();
    const streamerGeos = [
      { geo: allStreamers.innerLeft, name: "Streamer_InnerLeft" },
      { geo: allStreamers.innerRight, name: "Streamer_InnerRight" },
      { geo: allStreamers.outerLeft, name: "Streamer_OuterLeft" },
      { geo: allStreamers.outerRight, name: "Streamer_OuterRight" }
    ];

    for (const item of streamerGeos) {
      this.geometries.push(item.geo);
      const mesh = new THREE.Mesh(item.geo, neutralMaterial);
      mesh.name = item.name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.streamerMeshes.push(mesh);
      this.streamersGroup.add(mesh);
    }

    this.group.add(this.streamersGroup);
  }

  public update(_delta: number): void {
    // Stage 1: Static neutral rest pose for silhouette inspection
  }

  public dispose(): void {
    for (const geo of this.geometries) {
      geo.dispose();
    }
    this.geometries.length = 0;

    for (const mat of this.materials) {
      mat.dispose();
    }
    this.materials.length = 0;

    this.group.clear();
  }
}
