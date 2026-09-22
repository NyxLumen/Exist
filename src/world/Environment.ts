import * as THREE from "three";

/**
 * Environment setup for Phase 0.
 *
 * NOTE: The lighting configured here is EXPLICITLY TEMPORARY for asset inspection.
 * In future phases, the butterfly itself will act as the primary dynamic light source.
 */
export class Environment {
  public readonly scene: THREE.Scene;
  private readonly temporaryLights: THREE.Light[] = [];

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    this.setupTemporaryInspectionLights();
  }

  /**
   * Temporary inspection lights to allow inspecting the GLB meshes, materials,
   * textures, and animations against the pitch-black void.
   */
  private setupTemporaryInspectionLights(): void {
    // Soft ambient illumination so shadow-sides and textures remain legible
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    ambientLight.name = "TempInspectionAmbientLight";
    this.scene.add(ambientLight);
    this.temporaryLights.push(ambientLight);

    // Key directional light from above-front
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(4, 6, 5);
    keyLight.name = "TempInspectionKeyLight";
    this.scene.add(keyLight);
    this.temporaryLights.push(keyLight);

    // Rim/fill directional light from behind-left to reveal edges and silhouette
    const rimLight = new THREE.DirectionalLight(0x88bbff, 1.0);
    rimLight.position.set(-4, -2, -4);
    rimLight.name = "TempInspectionRimLight";
    this.scene.add(rimLight);
    this.temporaryLights.push(rimLight);
  }

  public dispose(): void {
    for (const light of this.temporaryLights) {
      this.scene.remove(light);
      light.dispose();
    }
    this.temporaryLights.length = 0;
  }
}
