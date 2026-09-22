import * as THREE from "three";

export type TickCallback = (delta: number, elapsed: number) => void;

export class Loop {
  private readonly clock: THREE.Clock;
  private readonly callbacks: Set<TickCallback> = new Set();
  private animationFrameId: number | null = null;
  private isRunning: boolean = false;

  constructor() {
    this.clock = new THREE.Clock();
  }

  public add(callback: TickCallback): void {
    this.callbacks.add(callback);
  }

  public remove(callback: TickCallback): void {
    this.callbacks.delete(callback);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.clock.start();
    this.tick();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.clock.stop();
  }

  private tick = (): void => {
    if (!this.isRunning) return;

    // Clamp delta time to 0.1s to avoid jumps when tab is hidden or backgrounded
    const rawDelta = this.clock.getDelta();
    const delta = Math.min(rawDelta, 0.1);
    const elapsed = this.clock.getElapsedTime();

    for (const callback of this.callbacks) {
      callback(delta, elapsed);
    }

    this.animationFrameId = requestAnimationFrame(this.tick);
  };
}
