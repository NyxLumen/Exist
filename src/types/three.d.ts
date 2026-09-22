declare module "three" {
  export const SRGBColorSpace: string;
  export const ACESFilmicToneMapping: number;
  export const LoopRepeat: number;

  export class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    set(x: number, y: number, z: number): this;
    setScalar(scalar: number): this;
    [key: string]: any;
  }

  export class Color {
    constructor(color?: any);
    [key: string]: any;
  }

  export class Box3 {
    min: Vector3;
    max: Vector3;
    constructor(min?: Vector3, max?: Vector3);
    setFromObject(object: any): this;
    getCenter(target: Vector3): Vector3;
    getSize(target: Vector3): Vector3;
    [key: string]: any;
  }

  export class Object3D {
    id: number;
    uuid: string;
    name: string;
    position: Vector3;
    rotation: any;
    scale: Vector3;
    children: Object3D[];
    add(...object: Object3D[]): this;
    remove(...object: Object3D[]): this;
    clear(): this;
    traverse(callback: (child: any) => void): void;
    [key: string]: any;
  }

  export class Group extends Object3D {
    isGroup: boolean;
    constructor();
  }

  export class Scene extends Object3D {
    background: Color | null;
    constructor();
  }

  export class Camera extends Object3D {
    constructor();
  }

  export class PerspectiveCamera extends Camera {
    aspect: number;
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    lookAt(x: number | Vector3, y?: number, z?: number): void;
    updateProjectionMatrix(): void;
  }

  export class WebGLRenderer {
    outputColorSpace: string;
    toneMapping: number;
    toneMappingExposure: number;
    constructor(parameters?: any);
    setSize(width: number, height: number, updateStyle?: boolean): void;
    setPixelRatio(value: number): void;
    render(scene: Scene, camera: Camera): void;
    dispose(): void;
    [key: string]: any;
  }

  export class Clock {
    constructor(autoStart?: boolean);
    start(): void;
    stop(): void;
    getDelta(): number;
    getElapsedTime(): number;
    [key: string]: any;
  }

  export class Light extends Object3D {
    color: Color;
    intensity: number;
    dispose(): void;
    [key: string]: any;
  }

  export class AmbientLight extends Light {
    constructor(color?: any, intensity?: number);
  }

  export class DirectionalLight extends Light {
    constructor(color?: any, intensity?: number);
  }

  export class Material {
    uuid: string;
    name: string;
    type: string;
    transparent: boolean;
    opacity: number;
    dispose(): void;
    [key: string]: any;
  }

  export class MeshStandardMaterial extends Material {
    roughness: number;
    metalness: number;
    map: any;
    normalMap: any;
    roughnessMap: any;
    emissiveMap: any;
    [key: string]: any;
  }

  export class Mesh extends Object3D {
    isMesh: boolean;
    geometry: any;
    material: Material | Material[];
    constructor(geometry?: any, material?: any);
  }

  export class Texture {
    uuid: string;
    name: string;
    image: any;
    dispose(): void;
    [key: string]: any;
  }

  export class AnimationClip {
    name: string;
    duration: number;
    tracks: any[];
    [key: string]: any;
  }

  export class AnimationAction {
    clampWhenFinished: boolean;
    setLoop(mode: number, repetitions: number): this;
    play(): this;
    stop(): this;
    [key: string]: any;
  }

  export class AnimationMixer {
    constructor(root: any);
    clipAction(clip: AnimationClip): AnimationAction;
    update(deltaTimeInSeconds: number): this;
    stopAllAction(): this;
    uncacheRoot(root: any): void;
    [key: string]: any;
  }
}

declare module "three/addons/loaders/GLTFLoader.js" {
  import * as THREE from "three";

  export interface GLTF {
    animations: THREE.AnimationClip[];
    scene: THREE.Group;
    scenes: THREE.Group[];
    cameras: THREE.Camera[];
    asset: any;
  }

  export class GLTFLoader {
    constructor();
    load(
      url: string,
      onLoad: (gltf: GLTF) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (event: ErrorEvent | any) => void
    ): void;
  }
}
