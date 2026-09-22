import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { FlightController } from "./FlightController.ts";

export interface AssetDiagnostics {
  clipNames: string[];
  durations: number[];
  trackCounts: number[];
  meshCount: number;
  materialCount: number;
  materials: Array<{
    name: string;
    type: string;
    transparent?: boolean;
    opacity?: number;
    roughness?: number;
    metalness?: number;
    hasBaseMap: boolean;
    hasNormalMap: boolean;
    hasRoughnessMap: boolean;
    hasEmissiveMap: boolean;
    emissiveIntensity?: number;
  }>;
  textureCount: number;
  boundingBox: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
    size: { x: number; y: number; z: number };
  };
  center: { x: number; y: number; z: number };
  originOffsetApplied: { x: number; y: number; z: number };
  modelScale: number;
}

export class Butterfly {
  /**
   * Root controller group for flight position, rotation, scale, and trajectory logic.
   * Internal GLB transforms should never be directly modified by flight behavior.
   */
  public readonly controller: THREE.Group;

  /**
   * Intermediate model group holding the centered/normalized GLB.
   */
  public readonly modelGroup: THREE.Group;

  /**
   * Procedural 3D flight steering controller.
   */
  public readonly flight: FlightController;

  public mixer: THREE.AnimationMixer | null = null;
  public clips: THREE.AnimationClip[] = [];
  public actions: THREE.AnimationAction[] = [];
  public diagnostics: AssetDiagnostics | null = null;
  public isLoaded: boolean = false;

  constructor() {
    this.controller = new THREE.Group();
    this.controller.name = "ButterflyController";

    this.modelGroup = new THREE.Group();
    this.modelGroup.name = "ModelGroup";
    this.controller.add(this.modelGroup);

    // Initialize dedicated procedural flight controller operating on ButterflyController
    this.flight = new FlightController(this.controller);
    this.resize(window.innerWidth, window.innerHeight);
  }

  public resize(width: number, height: number): void {
    this.flight.resize(width, height);
  }

  public async load(url: string = "/models/fantasy_butterfly_animation.glb"): Promise<void> {
    const loader = new GLTFLoader();

    const gltf: GLTF = await new Promise((resolve, reject) => {
      loader.load(
        url,
        (loadedGltf) => resolve(loadedGltf),
        undefined,
        (error) => reject(error)
      );
    });

    const model = gltf.scene;
    model.name = "GLBScene";

    // 1. Gather Asset Diagnostics
    this.diagnostics = this.runDiagnostics(gltf);
    this.printDiagnostics(this.diagnostics);

    // 2. Center the model within ModelGroup so Controller pivot is at the butterfly's geometric center
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Offset GLB scene by negative center
    model.position.set(-center.x, -center.y, -center.z);
    this.modelGroup.add(model);

    // Substantial focal presence: target span ~3.3 units so it feels living, intentional, and substantial
    const maxDimension = Math.max(size.x, size.y, size.z);
    const targetSpan = 3.3;
    const scaleFactor = maxDimension > 0 ? targetSpan / maxDimension : 1.0;
    this.modelGroup.scale.setScalar(scaleFactor);
    if (this.diagnostics) {
      this.diagnostics.modelScale = scaleFactor;
    }

    // 3. Configure Wing & Body Material Alpha Handling
    // The source GLB defines alphaMode: "MASK" and alphaCutoff: 1.0, but the bundled base-color PNG
    // is a 24-bit RGB texture (colorType 2) where the background is pure pitch black (0, 0, 0).
    // In WebGL, sampling RGB returns diffuseColor.a = 1.0 everywhere, so alphaTest < 1.0 is never true.
    // Consequently, the transparent quad cards of the wings render as opaque black surfaces,
    // writing depth and occluding overlapping wings, body, and tails.
    // By detecting transparent black pixels (max(r, g, b) < 0.02) and assigning diffuseColor.a = 0.0
    // with alphaTest = 0.5, Three.js discards the empty card regions at the fragment level.
    // This eliminates the black wing card cutout artifact while preserving double-sided depth writing
    // on the luminous artwork, emissive map glow, roughness (0.6), and metalness (0).
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat) => {
          if (mat instanceof THREE.MeshStandardMaterial) {
            mat.alphaTest = 0.5;
            mat.depthWrite = true;
            mat.depthTest = true;
            mat.side = THREE.DoubleSide;
            mat.onBeforeCompile = (shader) => {
              shader.fragmentShader = shader.fragmentShader.replace(
                "#include <map_fragment>",
                `
                #include <map_fragment>
                float maxDiffuse = max(max(sampledDiffuseColor.r, sampledDiffuseColor.g), sampledDiffuseColor.b);
                diffuseColor.a = step(0.02, maxDiffuse);
                `
              );
            };
            mat.customProgramCacheKey = () => "butterflyMAT_alpha_discard";
            mat.needsUpdate = true;
          }
        });
      }
    });

    // 4. AnimationMixer and playback
    this.clips = gltf.animations;
    if (this.clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(model);
      // Strictly keep authored animation playback speed
      this.mixer.timeScale = 1.0;

      for (const clip of this.clips) {
        const action = this.mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
        action.play();
        this.actions.push(action);
      }
    } else {
      console.warn("[Butterfly] No embedded animation clips found in GLB.");
    }

    this.isLoaded = true;
    // Ensure idle rest timer begins when creature is visually established on screen
    this.flight.resetToInitialPose();
  }

  public update(delta: number): void {
    // 1. Procedural 3D flight steering (updates world position, rotation, banking on controller)
    this.flight.update(delta);

    // 2. Independent embedded wing animation playback at authored speed (timeScale = 1.0)
    if (this.mixer) {
      this.mixer.update(delta);
    }
  }

  private runDiagnostics(gltf: GLTF): AssetDiagnostics {
    const model = gltf.scene;
    const clips = gltf.animations || [];

    // Bounding box & dimensions before positioning offsets
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Traverse scene for meshes, materials, and textures
    let meshCount = 0;
    const materialMap = new Map<string, THREE.Material>();
    const texturesSet = new Set<THREE.Texture>();

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        meshCount++;
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => materialMap.set(mat.uuid, mat));
        } else if (mesh.material) {
          materialMap.set(mesh.material.uuid, mesh.material);
        }
      }
    });

    const materialsInfo: AssetDiagnostics["materials"] = [];
    materialMap.forEach((mat) => {
      const std = mat as THREE.MeshStandardMaterial;
      if (std.map) texturesSet.add(std.map);
      if (std.normalMap) texturesSet.add(std.normalMap);
      if (std.roughnessMap) texturesSet.add(std.roughnessMap);
      if (std.emissiveMap) texturesSet.add(std.emissiveMap);

      materialsInfo.push({
        name: mat.name || "(unnamed)",
        type: mat.type,
        transparent: mat.transparent,
        opacity: mat.opacity,
        roughness: std.roughness !== undefined ? std.roughness : undefined,
        metalness: std.metalness !== undefined ? std.metalness : undefined,
        hasBaseMap: Boolean(std.map),
        hasNormalMap: Boolean(std.normalMap),
        hasRoughnessMap: Boolean(std.roughnessMap),
        hasEmissiveMap: Boolean(std.emissiveMap),
        emissiveIntensity: std.emissiveIntensity
      });
    });

    return {
      clipNames: clips.map((c) => c.name),
      durations: clips.map((c) => c.duration),
      trackCounts: clips.map((c) => c.tracks.length),
      meshCount,
      materialCount: materialMap.size,
      materials: materialsInfo,
      textureCount: texturesSet.size,
      boundingBox: {
        min: { x: box.min.x, y: box.min.y, z: box.min.z },
        max: { x: box.max.x, y: box.max.y, z: box.max.z },
        size: { x: size.x, y: size.y, z: size.z }
      },
      center: { x: center.x, y: center.y, z: center.z },
      originOffsetApplied: { x: -center.x, y: -center.y, z: -center.z },
      modelScale: 1.0
    };
  }

  private printDiagnostics(d: AssetDiagnostics): void {
    console.group("%c[EXIST Asset Diagnostics: Butterfly GLB]", "color: #70d6ff; font-weight: bold;");
    console.log("Animation Clips:", d.clipNames.map((name, i) => ({
      name,
      duration: `${d.durations[i].toFixed(3)}s`,
      tracks: d.trackCounts[i]
    })));
    console.log(`Meshes: ${d.meshCount}, Materials: ${d.materialCount}, Textures: ${d.textureCount}`);
    console.log("Materials detail:", d.materials);
    console.log("Raw Bounding Box:", d.boundingBox);
    console.log("Original Center / Origin:", d.center);
    console.log("Offset Applied to ModelGroup (Origin correction):", d.originOffsetApplied);
    console.groupEnd();
  }

  public dispose(): void {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.modelGroup);
      this.mixer = null;
    }

    this.controller.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material?.dispose();
        }
      }
    });

    this.controller.clear();
  }
}
