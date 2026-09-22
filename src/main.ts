import { App } from "./App.ts";

function init(): void {
  const canvas = document.getElementById("webgl-canvas") as HTMLCanvasElement | null;

  if (!canvas) {
    console.error("[main] Canvas element with id #webgl-canvas not found.");
    return;
  }

  const app = new App(canvas);

  // Expose on window for runtime testing and inspection
  (window as unknown as { __EXIST_APP__: App }).__EXIST_APP__ = app;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
