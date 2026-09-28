import * as THREE from "three";

/**
 * AntennaSystem manages the twin sweeping antennae:
 * - Proud, sweeping 3D Catmull-Rom crescent arcs curving forward and outward
 * - Tapered tube geometry with terminal apical teardrop droplets
 * - Independent left and right antenna groups for secondary motion integration
 */
export class AntennaSystem {
  public readonly group: THREE.Group;
  public readonly leftAntennaGroup: THREE.Group;
  public readonly rightAntennaGroup: THREE.Group;

  constructor(material: THREE.Material) {
    this.group = new THREE.Group();
    this.group.name = "AntennaSystem";

    this.leftAntennaGroup = new THREE.Group();
    this.leftAntennaGroup.name = "LeftAntennaGroup";
    this.leftAntennaGroup.position.set(-0.038, 0.28, 0.05);

    this.rightAntennaGroup = new THREE.Group();
    this.rightAntennaGroup.name = "RightAntennaGroup";
    this.rightAntennaGroup.position.set(0.038, 0.28, 0.05);

    const leftMesh = this.buildAntennaMesh(false, material);
    const rightMesh = this.buildAntennaMesh(true, material);

    this.leftAntennaGroup.add(leftMesh);
    this.rightAntennaGroup.add(rightMesh);

    this.group.add(this.leftAntennaGroup);
    this.group.add(this.rightAntennaGroup);
  }

  /**
   * Generates a tapered curved tube for one antenna.
   */
  private buildAntennaMesh(isRight: boolean, material: THREE.Material): THREE.Group {
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
    const beadMesh = new THREE.Mesh(beadGeo, material);
    beadMesh.name = isRight ? "RightAntennaBead" : "LeftAntennaBead";
    beadMesh.position.copy(tipPoint);
    beadMesh.position.addScaledVector(frames.tangents[tubularSegments], 0.006);
    antennaGroup.add(beadMesh);

    return antennaGroup;
  }
}
