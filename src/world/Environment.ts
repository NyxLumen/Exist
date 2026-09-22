import * as THREE from "three";

/**
 * Environment setup for Phase 1: Cinematic Composition.
 *
 * Establishes a minimal dark 3D space with physical surfaces (floor & backdrop)
 * ready to receive light from the butterfly in future phases.
 * Subdued baseline lighting keeps the environment subordinate and nearly black.
 */
export class Environment {
  public readonly scene: THREE.Scene;
  private readonly disposableResources: { dispose: () => void }[] = [];

  public floor: THREE.Mesh | null = null;
  public backdrop: THREE.Mesh | null = null;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    // Subtle linear depth fog: preserves clear foreground while gently merging far geometry into black
    this.scene.fog = new THREE.Fog(0x000000, 8, 26);

    this.setupSurfaces();
    this.setupBaselineLighting();
  }

  /**
   * Minimal physical surfaces to establish 3D depth and prepare for dynamic light reception.
   */
  private setupSurfaces(): void {
    // 1. Horizontal ground plane (floor)
    const floorGeo = new THREE.PlaneGeometry(80, 80);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x050507,
      roughness: 0.95,
      metalness: 0.05
    });
    this.floor = new THREE.Mesh(floorGeo, floorMat);
    this.floor.name = "EnvironmentFloor";
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(0, -2.5, 0);
    this.scene.add(this.floor);

    this.disposableResources.push(floorGeo, floorMat);

    // 2. Distant vertical backdrop plane
    const backGeo = new THREE.PlaneGeometry(100, 60);
    const backMat = new THREE.MeshStandardMaterial({
      color: 0x030304,
      roughness: 0.98,
      metalness: 0.0
    });
    this.backdrop = new THREE.Mesh(backGeo, backMat);
    this.backdrop.name = "EnvironmentBackdrop";
    this.backdrop.position.set(0, 5, -14);
    this.scene.add(this.backdrop);

    this.disposableResources.push(backGeo, backMat);
  }

  /**
   * Minimal baseline lighting: keeps the environment near-black while
   * providing subtle form definition to the butterfly.
   */
  private setupBaselineLighting(): void {
    // Ultra-low ambient light for atmospheric presence
    const ambientLight = new THREE.AmbientLight(0x0a0d14, 0.5);
    ambientLight.name = "BaselineAmbientLight";
    this.scene.add(ambientLight);
    this.disposableResources.push(ambientLight);

    // Subtle directional key light from top-front
    const keyLight = new THREE.DirectionalLight(0x141a28, 0.8);
    keyLight.position.set(3, 6, 5);
    keyLight.name = "BaselineKeyLight";
    this.scene.add(keyLight);
    this.disposableResources.push(keyLight);

    // Faint rim light from below-rear to separate silhouettes against black backdrop
    const rimLight = new THREE.DirectionalLight(0x0f1522, 0.4);
    rimLight.position.set(-4, -1, -5);
    rimLight.name = "BaselineRimLight";
    this.scene.add(rimLight);
    this.disposableResources.push(rimLight);
  }

  public dispose(): void {
    if (this.floor) {
      this.scene.remove(this.floor);
      this.floor = null;
    }
    if (this.backdrop) {
      this.scene.remove(this.backdrop);
      this.backdrop = null;
    }

    for (const res of this.disposableResources) {
      res.dispose();
    }
    this.disposableResources.length = 0;
  }
}
