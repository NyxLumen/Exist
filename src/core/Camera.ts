import * as THREE from "three";

export class Camera {
  public readonly instance: THREE.PerspectiveCamera;

  constructor(width: number, height: number) {
    this.instance = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.updateFraming(width, height);
  }

  public resize(width: number, height: number): void {
    this.updateFraming(width, height);
  }

  private updateFraming(width: number, height: number): void {
    const aspect = width / height;
    this.instance.aspect = aspect;

    // Cinematic static camera framing with responsive distance adjustment
    if (aspect < 0.6) {
      // Narrow mobile portrait: pull back so both typography and offset butterfly remain comfortably framed
      this.instance.position.set(0, -0.15, 9.2);
    } else if (aspect < 1.0) {
      // Standard mobile / portrait tablet
      this.instance.position.set(0, -0.1, 8.0);
    } else if (aspect < 1.4) {
      // Landscape tablet / square desktop
      this.instance.position.set(0, -0.05, 6.6);
    } else {
      // Standard desktop 16:9 / 16:10
      this.instance.position.set(0, 0.0, 5.6);
    }

    this.instance.lookAt(0, 0, 0);
    this.instance.updateProjectionMatrix();
  }
}
