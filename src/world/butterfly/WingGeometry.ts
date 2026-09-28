import * as THREE from "three";

export interface WingGeometryOptions {
  spanSegments?: number;
  chordSegments?: number;
}

/**
 * WingGeometry creates high-resolution procedural geometries for the fantasy butterfly:
 * - Enormous soaring Forewings with expansive cathedral sail chord, steep upward arch,
 *   razor-sharp sickle apex hooks featuring a concave subapical scoop, and crenulated scalloped waves along the termen.
 * - Intricate ornamental Hindwings with multi-lobed petal scalloping and an elongated
 *   swallowtail teardrop tail.
 * - Parametric camber, dihedral arch, and full analytical vertex attributes.
 */
export class WingGeometry {
  /**
   * Generates a Forewing BufferGeometry.
   * @param isRight Whether to generate the right forewing (true) or left (false).
   * @param options Subdivision parameters.
   */
  public static createForewing(
    isRight: boolean = true,
    options: WingGeometryOptions = {}
  ): THREE.BufferGeometry {
    const spanSegs = options.spanSegments ?? 110;
    const chordSegs = options.chordSegments ?? 86;

    const numVertices = (spanSegs + 1) * (chordSegs + 1);
    const positions = new Float32Array(numVertices * 3);
    const normals = new Float32Array(numVertices * 3);
    const uvs = new Float32Array(numVertices * 2);
    const distanceToEdge = new Float32Array(numVertices);
    const distanceToRoot = new Float32Array(numVertices);
    const wingPart = new Float32Array(numVertices);

    const sign = isRight ? 1 : -1;
    let vIdx = 0;
    let uvIdx = 0;
    let attrIdx = 0;

    for (let j = 0; j <= spanSegs; j++) {
      const v = j / spanSegs; // 0 at hinge/root, 1 at apex/tip

      const lead = this.evaluateForewingLeadingEdge(v);
      const trail = this.evaluateForewingTrailingEdge(v);

      const chordDx = trail.x - lead.x;
      const chordDy = trail.y - lead.y;
      const chordDz = trail.z - lead.z;

      for (let i = 0; i <= chordSegs; i++) {
        const u = i / chordSegs; // 0 at leading edge, 1 at trailing edge

        // Point on flat chord
        let x = lead.x + u * chordDx;
        let y = lead.y + u * chordDy;
        let z = lead.z + u * chordDz;

        // Aerodynamic 3D camber: gentle convex arch peaking at u = 0.28
        const camberProfile = Math.sin(Math.PI * Math.pow(u, 0.68));
        const spanCamber = Math.sin(Math.PI * v * 0.92) * 0.055;
        z += camberProfile * spanCamber;

        // Dihedral arch: wings lift upward (+Z) along the span
        z += Math.sin(v * Math.PI * 0.75) * 0.065 * (1.0 - 0.25 * u);

        positions[vIdx * 3] = x * sign;
        positions[vIdx * 3 + 1] = y;
        positions[vIdx * 3 + 2] = z;

        // UV mapping
        uvs[uvIdx * 2] = u;
        uvs[uvIdx * 2 + 1] = v;

        // Distance to outer silhouette edge: 0 in deep interior, 1 at outer borders
        const edgeU = Math.min(u, 1.0 - u);
        const edgeV = 1.0 - v;
        const interiorDistance = Math.min(edgeU * 2.6, edgeV * 2.0);
        distanceToEdge[attrIdx] = THREE.MathUtils.clamp(1.0 - interiorDistance, 0.0, 1.0);

        distanceToRoot[attrIdx] = v;
        wingPart[attrIdx] = 0.0; // Forewing

        vIdx++;
        uvIdx++;
        attrIdx++;
      }
    }

    const indices: number[] = [];
    for (let j = 0; j < spanSegs; j++) {
      for (let i = 0; i < chordSegs; i++) {
        const a = j * (chordSegs + 1) + i;
        const b = (j + 1) * (chordSegs + 1) + i;
        const c = (j + 1) * (chordSegs + 1) + (i + 1);
        const d = j * (chordSegs + 1) + (i + 1);

        if (isRight) {
          indices.push(a, b, d);
          indices.push(b, c, d);
        } else {
          indices.push(a, d, b);
          indices.push(b, d, c);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute("aDistanceToEdge", new THREE.BufferAttribute(distanceToEdge, 1));
    geometry.setAttribute("aDistanceToRoot", new THREE.BufferAttribute(distanceToRoot, 1));
    geometry.setAttribute("aWingPart", new THREE.BufferAttribute(wingPart, 1));
    geometry.setIndex(indices);

    geometry.computeVertexNormals();
    return geometry;
  }

  /**
   * Generates a Hindwing BufferGeometry.
   * @param isRight Whether to generate the right hindwing (true) or left (false).
   * @param options Subdivision parameters.
   */
  public static createHindwing(
    isRight: boolean = true,
    options: WingGeometryOptions = {}
  ): THREE.BufferGeometry {
    const spanSegs = options.spanSegments ?? 96;
    const chordSegs = options.chordSegments ?? 76;

    const numVertices = (spanSegs + 1) * (chordSegs + 1);
    const positions = new Float32Array(numVertices * 3);
    const normals = new Float32Array(numVertices * 3);
    const uvs = new Float32Array(numVertices * 2);
    const distanceToEdge = new Float32Array(numVertices);
    const distanceToRoot = new Float32Array(numVertices);
    const wingPart = new Float32Array(numVertices);

    const sign = isRight ? 1 : -1;
    let vIdx = 0;
    let uvIdx = 0;
    let attrIdx = 0;

    for (let j = 0; j <= spanSegs; j++) {
      const v = j / spanSegs;

      const lead = this.evaluateHindwingLeadingEdge(v);
      const trail = this.evaluateHindwingTrailingEdge(v);

      const chordDx = trail.x - lead.x;
      const chordDy = trail.y - lead.y;
      const chordDz = trail.z - lead.z;

      for (let i = 0; i <= chordSegs; i++) {
        const u = i / chordSegs;

        let x = lead.x + u * chordDx;
        let y = lead.y + u * chordDy;
        let z = lead.z + u * chordDz;

        // Subtle bowl-like organic camber on hindwing
        const camberProfile = Math.sin(Math.PI * Math.pow(u, 0.72));
        const spanCamber = Math.sin(Math.PI * v) * 0.045;
        z += camberProfile * spanCamber;

        // Hindwings rest slightly behind forewings in Z
        z -= 0.025 + v * 0.02;

        positions[vIdx * 3] = x * sign;
        positions[vIdx * 3 + 1] = y;
        positions[vIdx * 3 + 2] = z;

        uvs[uvIdx * 2] = u;
        uvs[uvIdx * 2 + 1] = v;

        const edgeU = Math.min(u, 1.0 - u);
        const edgeV = 1.0 - v;
        const interiorDistance = Math.min(edgeU * 2.4, edgeV * 2.0);
        distanceToEdge[attrIdx] = THREE.MathUtils.clamp(1.0 - interiorDistance, 0.0, 1.0);

        distanceToRoot[attrIdx] = v;
        wingPart[attrIdx] = 1.0; // Hindwing

        vIdx++;
        uvIdx++;
        attrIdx++;
      }
    }

    const indices: number[] = [];
    for (let j = 0; j < spanSegs; j++) {
      for (let i = 0; i < chordSegs; i++) {
        const a = j * (chordSegs + 1) + i;
        const b = (j + 1) * (chordSegs + 1) + i;
        const c = (j + 1) * (chordSegs + 1) + (i + 1);
        const d = j * (chordSegs + 1) + (i + 1);

        if (isRight) {
          indices.push(a, b, d);
          indices.push(b, c, d);
        } else {
          indices.push(a, d, b);
          indices.push(b, d, c);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute("aDistanceToEdge", new THREE.BufferAttribute(distanceToEdge, 1));
    geometry.setAttribute("aDistanceToRoot", new THREE.BufferAttribute(distanceToRoot, 1));
    geometry.setAttribute("aWingPart", new THREE.BufferAttribute(wingPart, 1));
    geometry.setIndex(indices);

    geometry.computeVertexNormals();
    return geometry;
  }

  /**
   * Forewing leading edge:
   * Towering cathedral arch: climbs steeply in Y near the root, then sweeps out into the crest
   * at y ~ 2.40, x ~ 2.20, curling into an elegant sickle apex hook at v = 1.0 (x ~ 2.65, y ~ 2.08).
   */
  private static evaluateForewingLeadingEdge(v: number): THREE.Vector3 {
    // Steep initial climb: x expands gradually at first, then sweeps outward
    let x = 0.08 + 2.56 * (0.15 * v + 0.85 * Math.pow(v, 1.55));

    // Y profile: climbs steeply into high towering crest
    let y = 0.12 + 2.35 * Math.sin(0.58 * Math.PI * Math.pow(v, 0.85));

    // Sickle hook backward recurrence at apex
    if (v > 0.80) {
      const t = (v - 0.80) / 0.20;
      y -= 0.45 * Math.pow(t, 1.6);
      x += 0.10 * Math.sin(Math.PI * t);
    }

    const z = 0.03 * (1.0 - v);
    return new THREE.Vector3(x, y, z);
  }

  /**
   * Forewing trailing edge:
   * Broad cathedral sail membrane that stays low along the inner half to overlap the hindwing,
   * then ascends with 3 distinct rounded scalloped lobes along the mid-termen, followed by a
   * deep concave subapical crescent cutout directly below the apex that carves out the sickle hook.
   */
  private static evaluateForewingTrailingEdge(v: number): THREE.Vector3 {
    if (v <= 0.001) {
      return new THREE.Vector3(0.08, -0.16, 0.0);
    }

    const apex = this.evaluateForewingLeadingEdge(1.0);

    // Baseline trailing curve
    const xBase = 0.08 + 2.56 * Math.pow(v, 1.15);

    // Stays broad and low through v ~ 0.45, then sweeps upward into the termen
    let yBase = -0.16 + 0.35 * Math.pow(v, 1.2) - 0.06 * Math.sin(Math.PI * v * 0.9);
    if (v > 0.40) {
      const riseProgress = (v - 0.40) / 0.60;
      yBase += 1.95 * Math.pow(riseProgress, 2.0);
    }

    // 1. 3 distinct rounded scalloped waves along mid-termen (v from 0.28 to 0.78)
    let scallopOffset = 0.0;
    if (v >= 0.28 && v <= 0.78) {
      const midZone = Math.sin(Math.PI * (v - 0.28) / 0.50);
      scallopOffset = Math.sin(v * 26.0) * 0.095 * midZone;
    }

    // 2. Concave subapical crescent cutout directly below apex (v from 0.78 to 0.98)
    let subapicalScoopX = 0.0;
    let subapicalScoopY = 0.0;
    if (v > 0.76 && v < 0.99) {
      const scoopT = (v - 0.76) / 0.23;
      const scoopIntensity = Math.sin(Math.PI * scoopT);
      subapicalScoopX = -0.22 * Math.pow(scoopIntensity, 1.4);
      subapicalScoopY = -0.18 * Math.pow(scoopIntensity, 1.4);
    }

    // Razor-sharp convergence to apex at v = 1.0
    const blendToApex = Math.pow(v, 3.8);

    const x = THREE.MathUtils.lerp(xBase + scallopOffset * 0.4 + subapicalScoopX, apex.x, blendToApex);
    const y = THREE.MathUtils.lerp(yBase - scallopOffset * 1.2 + subapicalScoopY, apex.y, blendToApex);
    const z = 0.0;

    return new THREE.Vector3(x, y, z);
  }

  /**
   * Hindwing leading edge:
   * Expands outward from thoracic base, tucked neatly under forewing trailing edge.
   */
  private static evaluateHindwingLeadingEdge(v: number): THREE.Vector3 {
    const x = 0.06 + 1.70 * (0.35 * v + 0.65 * Math.pow(v, 1.12));
    const y = -0.06 + 0.38 * Math.sin(0.55 * Math.PI * v) - 0.12 * v;
    const z = -0.02 * v;
    return new THREE.Vector3(x, y, z);
  }

  /**
   * Hindwing trailing edge:
   * Features 4 ornamental petal lobes and an elongated swallowtail teardrop extension
   * reaching down to y ~ -1.82, x ~ 0.86.
   */
  private static evaluateHindwingTrailingEdge(v: number): THREE.Vector3 {
    if (v <= 0.001) {
      return new THREE.Vector3(0.05, -0.32, 0.0);
    }

    const xBase = 0.05 + 1.64 * Math.pow(v, 0.92);
    const yBase = -0.32 - 0.46 * Math.sin(Math.PI * v * 0.8) + 0.24 * Math.pow(v, 1.4);

    // Multi-lobed petal scalloping (distinct rounded petal lobes)
    const lobeZone = Math.sin(Math.PI * THREE.MathUtils.clamp(v, 0.06, 0.94));
    const lobeWave = Math.sin(v * 18.0) * 0.11 * lobeZone;

    // Swallowtail teardrop projection around v = 0.46 - 0.66
    const tailBell = Math.exp(-Math.pow((v - 0.52) / 0.08, 2.0));
    const tailY = -1.05 * tailBell;
    const tailX = -0.09 * tailBell;

    // Convergence to leading edge apex at v = 1.0
    const leadApex = this.evaluateHindwingLeadingEdge(1.0);
    const blendToApex = Math.pow(v, 3.2);

    const x = THREE.MathUtils.lerp(xBase + lobeWave * 0.4 + tailX, leadApex.x, blendToApex);
    const y = THREE.MathUtils.lerp(yBase + lobeWave + tailY, leadApex.y, blendToApex);
    const z = -0.01;

    return new THREE.Vector3(x, y, z);
  }
}
