import * as THREE from "three";

export class Camera {
  public readonly instance: THREE.PerspectiveCamera;

  constructor(width: number, height: number) {
    this.instance = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    // Position camera with slight elevation looking down at origin for clear model inspection
    this.instance.position.set(0, 1.8, 4.8);
    this.instance.lookAt(0, 0, 0);
  }

  public resize(width: number, height: number): void {
    this.instance.aspect = width / height;
    this.instance.updateProjectionMatrix();
  }
}
