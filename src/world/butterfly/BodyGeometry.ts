import * as THREE from "three";

export interface BodyParts {
  root: THREE.Group;
  thorax: THREE.Mesh;
  head: THREE.Group;
  abdomen: THREE.Group;
  abdomenSegments: THREE.Group[];
}

/**
 * BodyGeometry creates high-resolution procedural geometry for the fantasy creature's body:
 * - Refined cranial capsule with twin faceted compound eyes
 * - Aerodynamic sculpted thoracic carapace with wing root articulation
 * - 7-segment tapered spindle abdomen with sculpted inter-segmental seams
 */
export class BodyGeometry {
  /**
   * Generates the complete body mesh hierarchy as a typed BodyParts structure.
   * @param material Material to assign to all body components.
   */
  public static createBody(material: THREE.Material, eyeMaterial?: THREE.Material): BodyParts {
    const bodyGroup = new THREE.Group();
    bodyGroup.name = "CreatureBody";

    // 1. Thorax (Carapace)
    const thoraxMesh = this.createThorax(material);
    bodyGroup.add(thoraxMesh);

    // 2. Head & Compound Eyes
    const headGroup = this.createHead(material, eyeMaterial ?? material);
    bodyGroup.add(headGroup);

    // 3. Segmented Articulated Abdomen
    const { abdomenGroup, segments } = this.createAbdomen(material);
    bodyGroup.add(abdomenGroup);

    return {
      root: bodyGroup,
      thorax: thoraxMesh,
      head: headGroup,
      abdomen: abdomenGroup,
      abdomenSegments: segments
    };
  }

  /**
   * Sculpted aerodynamic thorax with dorsal ridge and narrow abdominal waist.
   */
  private static createThorax(material: THREE.Material): THREE.Mesh {
    // Revolved lathed profile for an organic, sculpted aerodynamic thorax
    const points: THREE.Vector2[] = [];
    const segments = 40;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments; // 0 at anterior (neck), 1 at posterior (waist)
      const y = THREE.MathUtils.lerp(0.16, -0.16, t);

      // Width profile: slender anterior neck, muscular center chest, tapered waist
      const widthProfile = Math.sin(Math.PI * Math.pow(t, 0.75));
      const radius = 0.05 + 0.055 * widthProfile;
      points.push(new THREE.Vector2(radius, y));
    }

    const geometry = new THREE.LatheGeometry(points, 32);

    // Subtle lateral flattening and dorsal crest sculpt
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);

      // Slightly wider in X than deep in Z (elliptical cross-section)
      const scaledX = x * 1.15;
      // Slight dorsal ridge on top (+Z)
      const dorsalBoost = z > 0 ? 1.0 + 0.15 * Math.sin(Math.PI * ((y + 0.16) / 0.32)) : 0.95;
      const scaledZ = z * dorsalBoost;

      pos.setXYZ(i, scaledX, y, scaledZ);
    }
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "Thorax";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Head assembly featuring smooth rounded cranial dome and twin lateral compound eyes.
   */
  private static createHead(material: THREE.Material, eyeMaterial: THREE.Material): THREE.Group {
    const headGroup = new THREE.Group();
    headGroup.name = "HeadGroup";
    headGroup.position.set(0, 0.22, 0.03);

    // Cranium
    const craniumGeo = new THREE.SphereGeometry(0.065, 32, 24);
    craniumGeo.scale(0.9, 1.15, 0.95);
    const craniumMesh = new THREE.Mesh(craniumGeo, material);
    craniumMesh.name = "Cranium";
    headGroup.add(craniumMesh);

    // Compound Eyes (left & right)
    const eyeGeo = new THREE.SphereGeometry(0.032, 24, 20);
    eyeGeo.scale(0.8, 1.3, 1.1);

    const leftEye = new THREE.Mesh(eyeGeo, eyeMaterial);
    leftEye.name = "LeftEye";
    leftEye.position.set(-0.048, 0.02, 0.015);
    leftEye.rotation.set(-0.2, -0.4, 0.3);
    headGroup.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeo.clone(), eyeMaterial);
    rightEye.name = "RightEye";
    rightEye.position.set(0.048, 0.02, 0.015);
    rightEye.rotation.set(-0.2, 0.4, -0.3);
    headGroup.add(rightEye);

    // Subtle proboscis curl tucked beneath the mouth
    const proboscisCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.04, -0.01),
      new THREE.Vector3(0, -0.07, 0.01),
      new THREE.Vector3(0, -0.08, -0.02),
      new THREE.Vector3(0, -0.065, -0.035),
      new THREE.Vector3(0, -0.05, -0.025)
    ]);
    const proboscisGeo = new THREE.TubeGeometry(proboscisCurve, 24, 0.007, 12, false);
    const proboscisMesh = new THREE.Mesh(proboscisGeo, material);
    proboscisMesh.name = "Proboscis";
    headGroup.add(proboscisMesh);

    return headGroup;
  }

  /**
   * 7-segment articulated abdomen with sculpted inter-segmental seams and progressive spinal flex.
   */
  private static createAbdomen(material: THREE.Material): { abdomenGroup: THREE.Group; segments: THREE.Group[] } {
    const abdomenGroup = new THREE.Group();
    abdomenGroup.name = "AbdomenGroup";
    abdomenGroup.position.set(0, -0.16, 0.0);

    const segmentCount = 7;
    const totalLength = 0.72;
    const segLength = totalLength / segmentCount;
    const segments: THREE.Group[] = [];

    let parentGroup: THREE.Group = abdomenGroup;

    for (let s = 0; s < segmentCount; s++) {
      const t0 = s / segmentCount;
      const t1 = (s + 1) / segmentCount;

      // Radius profile: slender waist at start, swelling slightly at segment 2, tapering to fine tip
      const r0 = this.getAbdomenRadius(t0);
      const r1 = this.getAbdomenRadius(t1);
      const rMid = Math.max(r0, r1) * 1.05; // Barrel swelling per segment

      // Subtle downward sagittal curve
      const zOffset0 = -Math.pow(t0, 1.4) * 0.08;
      const zOffset1 = -Math.pow(t1, 1.4) * 0.08;
      const dz = zOffset1 - zOffset0;

      // Articulated joint group
      const jointGroup = new THREE.Group();
      jointGroup.name = `AbdomenJoint_${s + 1}`;
      if (s === 0) {
        jointGroup.position.set(0, 0, zOffset0);
      } else {
        jointGroup.position.set(0, -segLength, dz);
      }
      parentGroup.add(jointGroup);
      segments.push(jointGroup);
      parentGroup = jointGroup;

      // Construct individual segment geometry relative to its joint origin (y from 0 to -segLength)
      const points: THREE.Vector2[] = [
        new THREE.Vector2(0.001, 0),
        new THREE.Vector2(r0 * 0.95, -segLength * 0.08),
        new THREE.Vector2(rMid, -segLength * 0.5),
        new THREE.Vector2(r1 * 0.95, -segLength + segLength * 0.08),
        new THREE.Vector2(0.001, -segLength)
      ];

      const segGeo = new THREE.LatheGeometry(points, 28);
      // Apply slight sagittal Z curve and slight lateral compression
      const pos = segGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const ratio = THREE.MathUtils.clamp(-y / segLength, 0.0, 1.0);
        const localZ = pos.getZ(i);
        const curveZ = THREE.MathUtils.lerp(0, dz, ratio);
        pos.setZ(i, localZ * 0.92 + curveZ);
      }
      segGeo.computeVertexNormals();

      const segMesh = new THREE.Mesh(segGeo, material);
      segMesh.name = `AbdomenSegment_${s + 1}`;
      segMesh.castShadow = true;
      segMesh.receiveShadow = true;
      jointGroup.add(segMesh);
    }

    return { abdomenGroup, segments };
  }

  /**
   * Evaluates the continuous diameter curve of the abdomen from base (0) to tip (1).
   */
  private static getAbdomenRadius(t: number): number {
    // Starts at waist (0.052), swells to max at t ~ 0.25 (0.068), tapers to tip (0.012)
    if (t < 0.25) {
      return THREE.MathUtils.lerp(0.052, 0.068, t / 0.25);
    }
    const rem = (t - 0.25) / 0.75;
    return THREE.MathUtils.lerp(0.068, 0.012, Math.pow(rem, 0.85));
  }
}
