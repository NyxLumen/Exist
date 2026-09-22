import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";

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
   * Root controller group for future flight position, rotation, scale, and trajectory logic.
   * Internal GLB transforms should never be directly modified by flight behavior.
   */
  public readonly controller: THREE.Group;

  /**
   * Intermediate model group holding the centered/normalized GLB.
   */
  public readonly modelGroup: THREE.Group;

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

    // Initial cinematic composition placement on ButterflyController:
    // Gracefully positioned below and to the right of "EXIST" (under "ST")
    this.controller.rotation.set(0.46, -0.14, 0.04);
    this.resize(window.innerWidth, window.innerHeight);
  }

  public resize(width: number, height: number): void {
    const aspect = width / height;
    if (aspect < 0.65) {
      // Narrow mobile: clear separation below typography
      this.controller.position.set(0.10, -1.40, 0.1);
    } else if (aspect < 1.0) {
      // Portrait tablet / large phone
      this.controller.position.set(0.30, -1.10, 0.1);
    } else if (aspect < 1.4) {
      // Landscape tablet / square desktop
      this.controller.position.set(0.50, -0.98, 0.1);
    } else {
      // Standard widescreen desktop: sits comfortably below-right of "EXIST"
      this.controller.position.set(0.68, -0.94, 0.1);
    }
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

    // 3. AnimationMixer and playback
    this.clips = gltf.animations;
    if (this.clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(model);

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
  }

  public update(delta: number): void {
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
