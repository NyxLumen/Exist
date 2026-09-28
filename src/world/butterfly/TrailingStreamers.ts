import * as THREE from "three";

export interface StreamerConfig {
  rootPosition: THREE.Vector3;
  targetLength: number;
  baseWidth: number;
  tipWidth: number;
  curveBiasX: number;
  curveBiasZ: number;
  segments?: number;
}

/**
 * TrailingStreamers generates fluid, silk-like ribbon tendrils trailing from the
 * hindwings and abdomen, echoing the siphonophore/fantasy moth aesthetic.
 */
export class TrailingStreamers {
  /**
   * Generates a single ribbon streamer BufferGeometry.
   */
  public static createStreamerGeometry(config: StreamerConfig): THREE.BufferGeometry {
    const lengthSegs = config.segments ?? 120;
    const widthSegs = 4;

    const numVerts = (lengthSegs + 1) * (widthSegs + 1);
    const positions = new Float32Array(numVerts * 3);
    const normals = new Float32Array(numVerts * 3);
    const uvs = new Float32Array(numVerts * 2);
    const distanceToEdge = new Float32Array(numVerts);
    const distanceToRoot = new Float32Array(numVerts);
    const wingPart = new Float32Array(numVerts);

    const sign = Math.sign(config.rootPosition.x) || 1;

    // Compute spine curve points
    const spinePoints: THREE.Vector3[] = [];
    const spineTangents: THREE.Vector3[] = [];

    for (let j = 0; j <= lengthSegs; j++) {
      const s = j / lengthSegs; // 0 at root, 1 at tip

      // Graceful flowing catenary drape:
      // Drops downward in Y, spreads and recurves in X, sweeps backwards in Z
      const y = config.rootPosition.y - s * config.targetLength;

      // Multi-harmonic S-curve wave sway in X
      const waveX = (Math.sin(s * Math.PI * 1.35) * 0.75 + Math.sin(s * Math.PI * 2.8) * 0.25) * config.curveBiasX;
      const x = config.rootPosition.x + waveX;

      // Backward float in Z
      const sagZ = Math.sin(Math.PI * Math.pow(s, 0.85)) * config.curveBiasZ * 0.55 + s * 0.25;
      const z = config.rootPosition.z - sagZ;

      spinePoints.push(new THREE.Vector3(x, y, z));
    }

    // Compute tangents along the spine
    for (let j = 0; j <= lengthSegs; j++) {
      const prev = spinePoints[Math.max(0, j - 1)];
      const next = spinePoints[Math.min(lengthSegs, j + 1)];
      const tangent = new THREE.Vector3().subVectors(next, prev).normalize();
      spineTangents.push(tangent);
    }

    const worldUp = new THREE.Vector3(0, 0, 1);
    let vIdx = 0;
    let uvIdx = 0;
    let attrIdx = 0;

    for (let j = 0; j <= lengthSegs; j++) {
      const s = j / lengthSegs;
      const center = spinePoints[j];
      const tangent = spineTangents[j];

      // Binormal perpendicular to tangent and up vector
      const binormal = new THREE.Vector3().crossVectors(tangent, worldUp).normalize();
      if (binormal.lengthSq() < 0.001) {
        binormal.set(sign, 0, 0);
      }

      // Smooth taper along length: slender base, delicate feathering tip
      const halfWidth = THREE.MathUtils.lerp(config.baseWidth, config.tipWidth, Math.pow(s, 0.60)) * 0.5;

      for (let i = 0; i <= widthSegs; i++) {
        const u = i / widthSegs;
        const offset = (u - 0.5) * 2.0 * halfWidth;

        const px = center.x + binormal.x * offset;
        const py = center.y + binormal.y * offset;
        const pz = center.z + binormal.z * offset;

        positions[vIdx * 3] = px;
        positions[vIdx * 3 + 1] = py;
        positions[vIdx * 3 + 2] = pz;

        uvs[uvIdx * 2] = u;
        uvs[uvIdx * 2 + 1] = s;

        const edgeU = Math.abs(u - 0.5) * 2.0;
        distanceToEdge[attrIdx] = edgeU;
        distanceToRoot[attrIdx] = s;
        wingPart[attrIdx] = 2.0;

        vIdx++;
        uvIdx++;
        attrIdx++;
      }
    }

    const indices: number[] = [];
    for (let j = 0; j < lengthSegs; j++) {
      for (let i = 0; i < widthSegs; i++) {
        const a = j * (widthSegs + 1) + i;
        const b = (j + 1) * (widthSegs + 1) + i;
        const c = (j + 1) * (widthSegs + 1) + (i + 1);
        const d = j * (widthSegs + 1) + (i + 1);

        indices.push(a, b, d);
        indices.push(b, c, d);
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
   * Generates a complete set of 4 trailing streamer geometries:
   * 2 primary long inner streamers + 2 secondary hindwing-tail streamers.
   */
  public static createAllStreamers(): {
    innerLeft: THREE.BufferGeometry;
    innerRight: THREE.BufferGeometry;
    outerLeft: THREE.BufferGeometry;
    outerRight: THREE.BufferGeometry;
  } {
    // 1. Primary Inner Streamers (long, graceful, descending from abdominal posterior tip)
    const innerLeft = this.createStreamerGeometry({
      rootPosition: new THREE.Vector3(-0.045, -0.88, -0.06),
      targetLength: 2.9,
      baseWidth: 0.045,
      tipWidth: 0.007,
      curveBiasX: -0.42,
      curveBiasZ: 0.65,
      segments: 120
    });

    const innerRight = this.createStreamerGeometry({
      rootPosition: new THREE.Vector3(0.045, -0.88, -0.06),
      targetLength: 2.9,
      baseWidth: 0.045,
      tipWidth: 0.007,
      curveBiasX: 0.42,
      curveBiasZ: 0.65,
      segments: 120
    });

    // 2. Secondary Outer Streamers (descending seamlessly from the hindwing swallowtail tail tips)
    const outerLeft = this.createStreamerGeometry({
      rootPosition: new THREE.Vector3(-0.86, -1.72, -0.05),
      targetLength: 2.1,
      baseWidth: 0.038,
      tipWidth: 0.006,
      curveBiasX: -0.52,
      curveBiasZ: 0.55,
      segments: 100
    });

    const outerRight = this.createStreamerGeometry({
      rootPosition: new THREE.Vector3(0.86, -1.72, -0.05),
      targetLength: 2.1,
      baseWidth: 0.038,
      tipWidth: 0.006,
      curveBiasX: 0.52,
      curveBiasZ: 0.55,
      segments: 100
    });

    return { innerLeft, innerRight, outerLeft, outerRight };
  }
}
