import * as THREE from "three";

export class Renderer {
  public readonly instance: THREE.WebGLRenderer;

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.instance = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      alpha: false
    });

    this.instance.outputColorSpace = THREE.SRGBColorSpace;
    this.instance.toneMapping = THREE.ACESFilmicToneMapping;
    this.instance.toneMappingExposure = 1.0;
    this.resize(width, height);
  }

  public resize(width: number, height: number): void {
    this.instance.setSize(width, height, false);
    this.instance.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  public render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.instance.render(scene, camera);
  }

  public dispose(): void {
    this.instance.dispose();
  }
}
