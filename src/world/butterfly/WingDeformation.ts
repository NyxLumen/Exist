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

    // Stage 3: Semi-translucent dual-sided bioluminescent membrane
    this.material = new THREE.MeshStandardMaterial({
      color: 0x050d1a,
      roughness: 0.32,
      metalness: 0.18,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide
    });
    this.material.defines = { USE_UV: "" };

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

        varying float vDistanceToRoot;
        varying float vDistanceToEdge;
        varying float vWingPart;
        varying float vChordU;

        ${shader.vertexShader}
      `;

      // Inject GPU vertex deformation inside #include <begin_vertex>
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `
        #include <begin_vertex>

        // Pass varyings to fragment shader
        vDistanceToRoot = aDistanceToRoot;
        vDistanceToEdge = aDistanceToEdge;
        vWingPart = aWingPart;
        vChordU = uv.x;

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

      // =======================================================================
      // STAGE 3 FRAGMENT SHADER EXTENSIONS: BIOLUMINESCENT WING SHADER
      // =======================================================================
      shader.fragmentShader = `
        uniform float uTime;
        uniform float uFlapPhase;
        uniform float uFlapVelocity;
        uniform float uSign;

        varying float vDistanceToRoot;
        varying float vDistanceToEdge;
        varying float vWingPart;
        varying float vChordU;

        // Fast analytical distance to 2D line segment in scaled coordinates
        float f_seg(vec2 p, vec2 a, vec2 b) {
          vec2 pa = p - a, ba = b - a;
          float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          return length(pa - ba * h);
        }

        ${shader.fragmentShader}
      `;

      // 1. Modulate Base Diffuse Color & Semi-Translucent Membrane Opacity
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>

        float u = vChordU;
        float v = vDistanceToRoot;
        float edge = vDistanceToEdge;
        bool isHind = vWingPart > 0.5;

        // View vector and surface normal
        vec3 N_surf = normalize(vNormal);
        if (!gl_FrontFacing) N_surf = -N_surf;
        vec3 V_view = normalize(-vViewPosition);
        float NdotV = clamp(abs(dot(N_surf, V_view)), 0.001, 1.0);
        float fresnel = pow(1.0 - NdotV, 3.2);

        // Thin-film spectral iridescence shift (view-dependent angle phase)
        vec3 iriPhase = vec3(0.68, 0.42, 0.15) + 1.25 * (1.0 - NdotV) + v * 0.22;
        vec3 iriShift = vec3(0.5) + 0.5 * cos(6.2831853 * iriPhase);
        vec3 iridescence = mix(vec3(0.04, 0.38, 0.88), iriShift, 0.65) * (0.35 + 0.65 * fresnel);

        // Base cell albedo: deep celestial indigo
        vec3 baseCellColor = mix(vec3(0.010, 0.015, 0.048), vec3(0.005, 0.038, 0.075), v);
        diffuseColor.rgb = baseCellColor + iridescence * 0.22;

        // Semi-translucent membrane alpha
        float cellAlpha = mix(0.38, 0.52, 1.0 - v);
        `
      );

      // 2. Modulate Micro-roughness for high specular definition
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(0.35, 0.12, clamp(vDistanceToEdge * 0.8, 0.0, 1.0));
        `
      );

      // 3. Inject Multi-Layer Emissive Bioluminescence: Veins, Ocelli, Edge Glow, Pulse
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `
        #include <emissivemap_fragment>

        // Scaled coordinate space matching physical wing span/chord proportions
        vec2 P = vec2(u * 1.45, v * 2.35);

        // -------------------------------------------------------------
        // LAYER 1: MATHEMATICAL CONTINUOUS WING VENATION
        // -------------------------------------------------------------
        float d_pri = 100.0;
        float d_sec = 100.0;

        if (!isHind) {
          // --- FOREWING VENATION ---
          // 1. Costa Trunk (Leading edge anterior margin)
          d_pri = min(d_pri, f_seg(P, vec2(0.02 * 1.45, 0.00 * 2.35), vec2(0.035 * 1.45, 0.42 * 2.35)));
          d_pri = min(d_pri, f_seg(P, vec2(0.035 * 1.45, 0.42 * 2.35), vec2(0.055 * 1.45, 0.80 * 2.35)));
          d_pri = min(d_pri, f_seg(P, vec2(0.055 * 1.45, 0.80 * 2.35), vec2(0.100 * 1.45, 0.98 * 2.35)));

          // 2. Radial Trunk (Upper structural spine)
          d_pri = min(d_pri, f_seg(P, vec2(0.05 * 1.45, 0.00 * 2.35), vec2(0.10 * 1.45, 0.22 * 2.35)));
          d_pri = min(d_pri, f_seg(P, vec2(0.10 * 1.45, 0.22 * 2.35), vec2(0.17 * 1.45, 0.46 * 2.35)));

          // 3. Cubital Trunk (Lower structural spine)
          d_pri = min(d_pri, f_seg(P, vec2(0.08 * 1.45, 0.00 * 2.35), vec2(0.20 * 1.45, 0.20 * 2.35)));
          d_pri = min(d_pri, f_seg(P, vec2(0.20 * 1.45, 0.20 * 2.35), vec2(0.34 * 1.45, 0.42 * 2.35)));

          // 4. Anal Trunk (Inner dorsal margin)
          d_pri = min(d_pri, f_seg(P, vec2(0.10 * 1.45, 0.00 * 2.35), vec2(0.35 * 1.45, 0.12 * 2.35)));
          d_pri = min(d_pri, f_seg(P, vec2(0.35 * 1.45, 0.12 * 2.35), vec2(0.72 * 1.45, 0.22 * 2.35)));

          // 5. Discocellular Cross-Veins (Closes the Discal Cell loop)
          d_sec = min(d_sec, f_seg(P, vec2(0.17 * 1.45, 0.46 * 2.35), vec2(0.25 * 1.45, 0.47 * 2.35)));
          d_sec = min(d_sec, f_seg(P, vec2(0.25 * 1.45, 0.47 * 2.35), vec2(0.34 * 1.45, 0.42 * 2.35)));

          // 6. Radiating Sector Veins across cathedral sail to Termen scallops (u -> 1.0)
          // CuA2 (to tornus)
          d_sec = min(d_sec, f_seg(P, vec2(0.20 * 1.45, 0.20 * 2.35), vec2(0.55 * 1.45, 0.25 * 2.35)));
          d_sec = min(d_sec, f_seg(P, vec2(0.55 * 1.45, 0.25 * 2.35), vec2(0.96 * 1.45, 0.30 * 2.35)));

          // CuA1 (to lower termen scallop)
          d_sec = min(d_sec, f_seg(P, vec2(0.34 * 1.45, 0.42 * 2.35), vec2(0.65 * 1.45, 0.44 * 2.35)));
          d_sec = min(d_sec, f_seg(P, vec2(0.65 * 1.45, 0.44 * 2.35), vec2(0.97 * 1.45, 0.46 * 2.35)));

          // M3 (to mid-lower termen scallop)
          d_sec = min(d_sec, f_seg(P, vec2(0.30 * 1.45, 0.44 * 2.35), vec2(0.63 * 1.45, 0.51 * 2.35)));
          d_sec = min(d_sec, f_seg(P, vec2(0.63 * 1.45, 0.51 * 2.35), vec2(0.97 * 1.45, 0.58 * 2.35)));

          // M2 (to mid-upper termen scallop)
          d_sec = min(d_sec, f_seg(P, vec2(0.25 * 1.45, 0.47 * 2.35), vec2(0.60 * 1.45, 0.59 * 2.35)));
          d_sec = min(d_sec, f_seg(P, vec2(0.60 * 1.45, 0.59 * 2.35), vec2(0.96 * 1.45, 0.71 * 2.35)));

          // M1 (to upper termen scallop)
          d_sec = min(d_sec, f_seg(P, vec2(0.17 * 1.45, 0.46 * 2.35), vec2(0.54 * 1.45, 0.65 * 2.35)));
          d_sec = min(d_sec, f_seg(P, vec2(0.54 * 1.45, 0.65 * 2.35), vec2(0.92 * 1.45, 0.83 * 2.35)));

          // R5 (to subapical scoop)
          d_sec = min(d_sec, f_seg(P, vec2(0.16 * 1.45, 0.58 * 2.35), vec2(0.42 * 1.45, 0.74 * 2.35)));
          d_sec = min(d_sec, f_seg(P, vec2(0.42 * 1.45, 0.74 * 2.35), vec2(0.70 * 1.45, 0.90 * 2.35)));

          // R4 / R3 (into sickle hook apex)
          d_sec = min(d_sec, f_seg(P, vec2(0.14 * 1.45, 0.58 * 2.35), vec2(0.16 * 1.45, 0.78 * 2.35)));
          d_sec = min(d_sec, f_seg(P, vec2(0.16 * 1.45, 0.78 * 2.35), vec2(0.10 * 1.45, 0.97 * 2.35)));
        } else {
          // --- HINDWING VENATION ---
          // 1. Central Swallowtail Structural Spine
          d_pri = min(d_pri, f_seg(P, vec2(0.08 * 1.45, 0.00 * 2.35), vec2(0.22 * 1.45, 0.25 * 2.35)));
          d_pri = min(d_pri, f_seg(P, vec2(0.22 * 1.45, 0.25 * 2.35), vec2(0.45 * 1.45, 0.52 * 2.35)));
          d_pri = min(d_pri, f_seg(P, vec2(0.45 * 1.45, 0.52 * 2.35), vec2(0.70 * 1.45, 0.80 * 2.35)));
          d_pri = min(d_pri, f_seg(P, vec2(0.70 * 1.45, 0.80 * 2.35), vec2(0.86 * 1.45, 0.98 * 2.35)));

          // 2. Leading Edge Spine
          d_pri = min(d_pri, f_seg(P, vec2(0.05 * 1.45, 0.00 * 2.35), vec2(0.10 * 1.45, 0.35 * 2.35)));
          d_pri = min(d_pri, f_seg(P, vec2(0.10 * 1.45, 0.35 * 2.35), vec2(0.20 * 1.45, 0.65 * 2.35)));

          // 3. Inner Margin Spine
          d_pri = min(d_pri, f_seg(P, vec2(0.10 * 1.45, 0.00 * 2.35), vec2(0.30 * 1.45, 0.15 * 2.35)));
          d_pri = min(d_pri, f_seg(P, vec2(0.30 * 1.45, 0.15 * 2.35), vec2(0.60 * 1.45, 0.22 * 2.35)));

          // 4. Radiating Sector Veins into 4 Petal Lobes
          // Lobe 1 (upper outer lobe)
          d_sec = min(d_sec, f_seg(P, vec2(0.16 * 1.45, 0.28 * 2.35), vec2(0.55 * 1.45, 0.32 * 2.35)));
          d_sec = min(d_sec, f_seg(P, vec2(0.55 * 1.45, 0.32 * 2.35), vec2(0.96 * 1.45, 0.35 * 2.35)));

          // Lobe 2 (mid outer lobe)
          d_sec = min(d_sec, f_seg(P, vec2(0.22 * 1.45, 0.25 * 2.35), vec2(0.60 * 1.45, 0.40 * 2.35)));
          d_sec = min(d_sec, f_seg(P, vec2(0.60 * 1.45, 0.40 * 2.35), vec2(0.98 * 1.45, 0.51 * 2.35)));

          // Lobe 3 (lower outer lobe)
          d_sec = min(d_sec, f_seg(P, vec2(0.38 * 1.45, 0.44 * 2.35), vec2(0.68 * 1.45, 0.56 * 2.35)));
          d_sec = min(d_sec, f_seg(P, vec2(0.68 * 1.45, 0.56 * 2.35), vec2(0.96 * 1.45, 0.67 * 2.35)));

          // Lobe 4 (supratail lobe)
          d_sec = min(d_sec, f_seg(P, vec2(0.48 * 1.45, 0.56 * 2.35), vec2(0.74 * 1.45, 0.68 * 2.35)));
          d_sec = min(d_sec, f_seg(P, vec2(0.74 * 1.45, 0.68 * 2.35), vec2(0.94 * 1.45, 0.79 * 2.35)));
        }

        // Vein Luminescence Profiles
        float w_pri = 0.024 * (1.0 - 0.30 * v);
        float V_pri = exp(-pow(d_pri / max(w_pri, 0.004), 2.0));

        float w_sec = 0.015 * (1.0 - 0.22 * v);
        float V_sec = exp(-pow(d_sec / max(w_sec, 0.003), 2.0));

        // Tertiary delicate micro-mesh lattice in outer membrane cells (interlocking gossamer reticulum)
        float grid1 = abs(sin(v * 38.0 - u * 20.0));
        float grid2 = abs(sin(v * 24.0 + u * 30.0));
        float microMesh = exp(-pow(min(grid1, grid2) / 0.20, 2.0));
        float V_lattice = microMesh * 0.24 * smoothstep(0.20, 0.82, v) * (1.0 - smoothstep(0.65, 0.95, edge));

        float V_total = clamp(V_pri * 1.35 + V_sec * 0.95 + V_lattice, 0.0, 1.0);

        // Vein Luminescence Color: Deep Azure to Brilliant Cyan
        vec3 veinBaseColor = mix(vec3(0.0, 0.62, 0.98), vec3(0.0, 0.95, 1.0), v);
        vec3 veinEmission = veinBaseColor * V_total * 2.4;

        // -------------------------------------------------------------
        // LAYER 2: DELIBERATE OCELLI & ORNAMENTAL JEWELS
        // -------------------------------------------------------------
        vec3 ocellusEmission = vec3(0.0);

        if (!isHind) {
          // Forewing Subapical Jewel (u=0.26, v=0.80 cradled between radial rays)
          vec2 P_jewel = vec2(0.26 * 1.45, 0.80 * 2.35);
          float d_jewel = length(P - P_jewel);

          float oc_core = exp(-pow(d_jewel / 0.038, 2.0)) * 5.2;
          float oc_iris = exp(-pow((d_jewel - 0.085) / 0.022, 2.0)) * 3.6;
          float oc_corona = exp(-pow((d_jewel - 0.145) / 0.030, 2.0)) * 2.4;
          float oc_aura = smoothstep(0.28, 0.0, d_jewel) * 0.70;

          ocellusEmission += oc_core * vec3(0.98, 1.0, 1.0)
                           + oc_iris * vec3(0.0, 0.92, 1.0)
                           + oc_corona * vec3(0.22, 0.10, 0.72)
                           + oc_aura * vec3(0.05, 0.45, 0.98);

          // Forewing Discal Luminous Crescent (inside discal cell at u=0.22, v=0.28)
          vec2 P_cres = vec2(0.22 * 1.45, 0.28 * 2.35);
          float d_cres = length(P - P_cres);
          float cres_ring = exp(-pow((d_cres - 0.085) / 0.022, 2.0));
          float cres_mask = smoothstep(0.24, 0.18, u);
          float cres_star = exp(-pow(d_cres / 0.026, 2.0)) * 2.2;
          ocellusEmission += (cres_ring * cres_mask * 2.4 * vec3(0.0, 0.88, 1.0))
                           + (cres_star * vec3(0.92, 0.99, 1.0));
        } else {
          // Hindwing Marginal Satellite Jewels (3 satellites along outer petal lobes)
          float d_s1 = length(P - vec2(0.86 * 1.45, 0.35 * 2.35));
          float d_s2 = length(P - vec2(0.88 * 1.45, 0.51 * 2.35));
          float d_s3 = length(P - vec2(0.84 * 1.45, 0.67 * 2.35));
          float d_sat = min(d_s1, min(d_s2, d_s3));

          float sat_core = exp(-pow(d_sat / 0.030, 2.0)) * 4.0;
          float sat_ring = exp(-pow((d_sat - 0.068) / 0.018, 2.0)) * 2.8;
          float sat_aura = smoothstep(0.16, 0.0, d_sat) * 0.65;

          ocellusEmission += sat_core * vec3(0.96, 0.99, 1.0)
                           + sat_ring * vec3(0.0, 0.88, 1.0)
                           + sat_aura * vec3(0.22, 0.08, 0.70);
        }

        // -------------------------------------------------------------
        // LAYER 3: SILHOUETTE EDGE EMISSION (Crisp inner + soft outer halo)
        // -------------------------------------------------------------
        float edgeSharp = pow(smoothstep(0.88, 0.998, edge), 2.6);
        vec3 innerEdge = edgeSharp * vec3(0.96, 0.99, 1.0) * 4.5;

        float edgeSoft = pow(smoothstep(0.55, 0.98, edge), 1.5);
        vec3 outerEdge = edgeSoft * vec3(0.36, 0.10, 0.92) * 2.0;

        // Soften edge glow at thoracic hinge to merge seamlessly into the body
        float hingeFade = smoothstep(0.02, 0.10, v);
        vec3 edgeEmission = (innerEdge + outerEdge) * hingeFade;

        // -------------------------------------------------------------
        // LAYER 4: BIOLOGICAL ENERGY PULSE ALONG VEINS
        // -------------------------------------------------------------
        float pulse1 = sin(v * 9.5 - uTime * 1.35) * 0.5 + 0.5;
        float pulse2 = cos(v * 5.2 - uTime * 0.80 + 1.1) * 0.5 + 0.5;
        float bioPulse = pow(pulse1 * 0.65 + pulse2 * 0.35, 3.2);
        vec3 veinPulse = V_total * bioPulse * vec3(0.20, 0.96, 1.0) * 1.3;

        // -------------------------------------------------------------
        // LAYER 5: TRANSLUCENCY / BACKLIGHTING APPROXIMATION
        // -------------------------------------------------------------
        vec3 L_key = normalize(vec3(0.40, 0.60, 0.70));
        float transKey = pow(clamp(dot(-V_view, L_key), 0.0, 1.0), 2.5) * 1.2;
        float backScatter = pow(clamp(dot(V_view, -N_surf), 0.0, 1.0), 2.2) * 0.50;
        vec3 translucency = (transKey + backScatter) * vec3(0.12, 0.88, 1.0)
                          * (1.0 - edge * 0.42) * (1.0 - V_total * 0.30);

        // -------------------------------------------------------------
        // COMPOSITE EMISSION & ALPHA OPACITY
        // -------------------------------------------------------------
        totalEmissiveRadiance += veinEmission
                              + veinPulse
                              + ocellusEmission
                              + edgeEmission
                              + iridescence * 0.40
                              + translucency * 0.35;

        // Final alpha blending: inter-vein cells are semi-transparent; structural features are denser
        float featureAlpha = max(V_total * 0.85, max(edgeSharp * 0.95, step(0.12, length(ocellusEmission))));
        diffuseColor.a = clamp(cellAlpha + featureAlpha * 0.45, 0.36, 0.96);
        `
      );
    };

    // Cache key for shader compilation uniqueness
    this.material.customProgramCacheKey = () =>
      `WingShader_v3_${isRight ? "R" : "L"}_${isHindwing ? "Hind" : "Fore"}`;
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
