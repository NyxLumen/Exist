import { App } from "./App.ts";

function init(): void {
  const canvas = document.getElementById("webgl-canvas") as HTMLCanvasElement | null;

  if (!canvas) {
    console.error("[main] Canvas element with id #webgl-canvas not found.");
    return;
  }

  const app = new App(canvas);
  const params = new URLSearchParams(window.location.search);

  // Allow clean inspection of the 3D creature without text interference when requested
  if (params.has("hideText")) {
    const overlay = document.querySelector(".hero-overlay") as HTMLElement | null;
    if (overlay) overlay.style.display = "none";
  }

  // Allow center staging for close-up symmetry and curvature inspection
  if (params.has("center")) {
    app.butterfly.controller.position.set(0, -0.2, 0);
    app.butterfly.controller.rotation.set(0.32, 0, 0);
    app.butterfly.flight.enabled = false;
  }

  // Allow deterministic phase inspection
  if (params.has("phase")) {
    const phase = parseFloat(params.get("phase") || "0");
    const time = parseFloat(params.get("time") || `${phase * 2.5}`);
    app.fixedPhase = phase;
    app.fixedTime = time;
  }

  // Expose on window for runtime testing and inspection
  const win = window as unknown as {
    __EXIST_APP__: App;
    __SET_PHASE__: (phase: number, time?: number) => void;
  };
  win.__EXIST_APP__ = app;
  win.__SET_PHASE__ = (phase: number, time: number = phase * 2.5) => {
    app.fixedPhase = phase;
    app.fixedTime = time;
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
