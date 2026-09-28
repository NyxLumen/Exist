import * as THREE from "three";
import { ProceduralButterfly } from "./butterfly/ProceduralButterfly.ts";
import { FlightController } from "./FlightController.ts";

export class Butterfly {
  /**
   * Root controller group for flight position, rotation, scale, and trajectory logic.
   */
  public readonly controller: THREE.Group;

  /**
   * Intermediate model group holding the procedural butterfly.
   */
  public readonly modelGroup: THREE.Group;

  /**
   * Procedural 3D flight steering controller.
   */
  public readonly flight: FlightController;

  /**
   * Procedural butterfly creature assembly.
   */
  public readonly procedural: ProceduralButterfly;

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

    // Instantiate Procedural Butterfly in Stage 1 neutral material
    this.procedural = new ProceduralButterfly({ neutralMaterial: true });
    this.modelGroup.add(this.procedural.group);

    // Wingspan in procedural geometry is ~4.0 units across
    // Scale factor can be normalized or slightly adjusted for dramatic focal presence
    this.modelGroup.scale.setScalar(1.0);

    this.isLoaded = true;
    this.flight.resetToInitialPose();
  }

  public resize(width: number, height: number): void {
    this.flight.resize(width, height);
  }

  /**
   * Synchronously or asynchronously initialize; no external asset fetch needed.
   */
  public async load(_url?: string): Promise<void> {
    this.isLoaded = true;
    return Promise.resolve();
  }

  public update(delta: number): void {
    // 1. Procedural 3D flight steering
    this.flight.update(delta);

    // 2. Procedural creature internal update
    this.procedural.update(delta);
  }

  public dispose(): void {
    this.procedural.dispose();
    this.controller.clear();
  }
}
