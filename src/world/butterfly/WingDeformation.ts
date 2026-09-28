import * as THREE from "three";
import { WingStrokeState } from "./WingAnimation.ts";

export interface WingDeformationConfig {
  lagScale?: number;
  chordFlexScale?: number;
  camberScale?: number;
  twistScale?: number;
  microFlexScale?: number;
}

/**
 * WingDeformation implements GPU-side procedural aeroelastic deformation:
 * - Injected into MeshStandardMaterial via onBeforeCompile for full PBR neutral clay evaluation
 * - Spanwise lag: pow(distanceToRoot, 1.45) causing wingtips to visibly lag behind wing roots
 * - Chordwise flex: trailing edge lags behind leading edge creating a traveling S-curve wave
 * - Aerodynamic camber: downstroke develops subtle air-scoop cup; upstroke feathers/flattens
 * - Spanwise twist: dynamic angle-of-attack pitch along the span
 * - Normal perturbation: normals update dynamically on GPU for realistic specular roll-off
 */
export class WingDeformation {
  public readonly material: THREE.MeshStandardMaterial;

  public uniforms: {
    uFlapAngle: { value: number };
    uFlapVelocity: { value: number };
    uFlapPhase: { value: number };
    uSign: { value: number };
    uTime: { value: number };
    uLagScale: { value: number };
    uChordFlexScale: { value: number };
    uCamberScale: { value: number };
    uTwistScale: { value: number };
    uMicroFlexScale: { value: number };
  };

  constructor(isRight: boolean, isHindwing: boolean, config: WingDeformationConfig = {}) {
    this.uniforms = {
      uFlapAngle: { value: 0 },
      uFlapVelocity: { value: 0 },
      uFlapPhase: { value: 0 },
      uSign: { value: isRight ? 1.0 : -1.0 },
      uTime: { value: 0 },
      uLagScale: { value: config.lagScale ?? (isHindwing ? 0.035 : 0.048) },
      uChordFlexScale: { value: config.chordFlexScale ?? (isHindwing ? 0.012 : 0.018) },
      uCamberScale: { value: config.camberScale ?? (isHindwing ? 0.008 : 0.012) },
      uTwistScale: { value: config.twistScale ?? (isHindwing ? 0.015 : 0.022) },
      uMicroFlexScale: { value: config.microFlexScale ?? 0.012 }
    };

    // Base neutral studio clay material
    this.material = new THREE.MeshStandardMaterial({
      color: 0x95a2b0,
      roughness: 0.45,
      metalness: 0.08,
      side: THREE.DoubleSide
    });

    this.material.onBeforeCompile = (shader) => {
      // Inject uniforms
      shader.uniforms.uFlapAngle = this.uniforms.uFlapAngle;
      shader.uniforms.uFlapVelocity = this.uniforms.uFlapVelocity;
      shader.uniforms.uFlapPhase = this.uniforms.uFlapPhase;
      shader.uniforms.uSign = this.uniforms.uSign;
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uLagScale = this.uniforms.uLagScale;
      shader.uniforms.uChordFlexScale = this.uniforms.uChordFlexScale;
      shader.uniforms.uCamberScale = this.uniforms.uCamberScale;
      shader.uniforms.uTwistScale = this.uniforms.uTwistScale;
      shader.uniforms.uMicroFlexScale = this.uniforms.uMicroFlexScale;

      // Vertex shader uniform declarations & vertex attributes
      shader.vertexShader = `
        uniform float uFlapAngle;
        uniform float uFlapVelocity;
        uniform float uFlapPhase;
        uniform float uSign;
        uniform float uTime;
        uniform float uLagScale;
        uniform float uChordFlexScale;
        uniform float uCamberScale;
        uniform float uTwistScale;
        uniform float uMicroFlexScale;

        attribute float aDistanceToRoot;
        attribute float aDistanceToEdge;
        attribute float aWingPart;

        ${shader.vertexShader}
      `;

      // Inject GPU vertex deformation inside #include <begin_vertex>
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `
        #include <begin_vertex>

        // Distance attributes
        float spanDist = aDistanceToRoot; // 0 at root, 1 at tip
        float chordU = uv.x;              // 0 at leading edge, 1 at trailing edge

        // 1. Spanwise Flap Lag:
        // Progressive lag increases toward tip via pow(spanDist, 1.45)
        float lagExponent = pow(spanDist, 1.45);
        float localLag = -uLagScale * uFlapVelocity * lagExponent;
        float localFlapAngle = uFlapAngle + localLag;

        // 2. Chordwise S-Curve Flexure:
        // Trailing edge lags behind leading edge under aerodynamic resistance
        float chordFlex = -uChordFlexScale * uFlapVelocity * pow(chordU, 1.35) * pow(spanDist, 0.75);

        // 3. Dynamic Aeroelastic Camber:
        // Downstroke cups the membrane; upstroke flattens/feathers
        float camberArch = 4.0 * chordU * (1.0 - chordU);
        float camberFlex = -uCamberScale * uFlapVelocity * camberArch * sin(3.14159265 * spanDist * 0.85);

        // 4. Spanwise Twist (Angle of attack / feathering):
        float twistAngle = uTwistScale * uFlapVelocity * pow(spanDist, 1.25);

        // 5. Subtle Traveling Membrane Wave:
        float wavePhase = uFlapPhase * 6.2831853 - spanDist * 3.2 + chordU * 1.4;
        float waveFlex = uMicroFlexScale * sin(wavePhase) * pow(spanDist, 1.5);

        // Combined vertical displacement before hinge rotation
        float totalZDisp = chordFlex + camberFlex + waveFlex;

        // Apply spanwise twist around local chord leading edge
        vec3 p = transformed;
        float cosTwist = cos(twistAngle);
        float sinTwist = sin(twistAngle);
        p.z = p.z * cosTwist + totalZDisp;

        // Apply primary flap rotation around thoracic hinge axis (Y-axis):
        // Rotation in local XZ plane with spanwise lag
        float cosFlap = cos(localFlapAngle);
        float sinFlap = sin(localFlapAngle);

        // Root anchor offset: hinge is near x = 0.08 (forewing) or 0.06 (hindwing) * uSign
        float rootX = (aWingPart > 0.5 ? 0.06 : 0.08) * uSign;
        float dx = p.x - rootX;

        // Flap rotation: right wing (+X) flaps up into +Z; left wing (-X) flaps up into +Z
        float rotatedX = rootX + (dx * cosFlap - p.z * sinFlap * uSign);
        float rotatedZ = dx * sinFlap * uSign + p.z * cosFlap;

        transformed.x = rotatedX;
        transformed.z = rotatedZ;
        `
      );

      // Inject normal perturbation so lighting reflects the deformed membrane curvature
      shader.vertexShader = shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        `
        #include <beginnormal_vertex>

        // Perturb normal by local flap rotation and lag gradient
        float normSpanDist = aDistanceToRoot;
        float normLocalLag = -uLagScale * uFlapVelocity * pow(normSpanDist, 1.45);
        float normAngle = uFlapAngle + normLocalLag;

        float cF = cos(normAngle);
        float sF = sin(normAngle);

        float nX = objectNormal.x * cF - objectNormal.z * sF * uSign;
        float nZ = objectNormal.x * sF * uSign + objectNormal.z * cF;

        objectNormal.x = nX;
        objectNormal.z = nZ;
        `
      );
    };

    // Cache key for shader compilation uniqueness
    this.material.customProgramCacheKey = () =>
      `WingDeform_${isRight ? "R" : "L"}_${isHindwing ? "Hind" : "Fore"}`;
  }

  /**
   * Updates uniforms from the wing animation stroke state.
   */
  public update(stroke: WingStrokeState, time: number): void {
    this.uniforms.uFlapAngle.value = stroke.flapAngle;
    this.uniforms.uFlapVelocity.value = stroke.flapVelocity;
    this.uniforms.uFlapPhase.value = stroke.flapPhase;
    this.uniforms.uTime.value = time;
  }

  public dispose(): void {
    this.material.dispose();
  }
}
