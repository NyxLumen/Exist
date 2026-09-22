import { Camera } from "./core/Camera.ts";
import { Renderer } from "./core/Renderer.ts";
import { Loop } from "./core/Loop.ts";
import { Environment } from "./world/Environment.ts";
import { Butterfly } from "./world/Butterfly.ts";

export class App {
  public readonly canvas: HTMLCanvasElement;
  public readonly camera: Camera;
  public readonly renderer: Renderer;
  public readonly loop: Loop;
  public readonly environment: Environment;
  public readonly butterfly: Butterfly;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const width = window.innerWidth;
    const height = window.innerHeight;

    // 1. Initialize Core Systems
    this.camera = new Camera(width, height);
    this.renderer = new Renderer(this.canvas, width, height);
    this.loop = new Loop();
    this.environment = new Environment();

    // 2. Initialize Butterfly Controller & Model
    this.butterfly = new Butterfly();
    this.environment.scene.add(this.butterfly.controller);

    // 3. Register Loop Tick
    this.loop.add((delta: number) => {
      this.butterfly.update(delta);
      this.renderer.render(this.environment.scene, this.camera.instance);
    });

    // 4. Attach Event Listeners
    window.addEventListener("resize", this.onResize);

    // 5. Start Render Loop
    this.loop.start();

    // 6. Asynchronously load Butterfly asset
    this.initButterfly();
  }

  private async initButterfly(): Promise<void> {
    try {
      await this.butterfly.load("/models/fantasy_butterfly_animation.glb");
      console.log("[App] Butterfly asset loaded and initialized successfully.");
    } catch (error) {
      console.error("[App] Failed to load butterfly model:", error);
    }
  }

  private onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.resize(width, height);
    this.renderer.resize(width, height);
    this.butterfly.resize(width, height);
  };

  public destroy(): void {
    window.removeEventListener("resize", this.onResize);
    this.loop.stop();
    this.butterfly.dispose();
    this.environment.dispose();
    this.renderer.dispose();
  }
}
