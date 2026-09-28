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
    __EXIST_FLIGHT__: typeof app.butterfly.flight;
    __SET_PHASE__: (phase: number, time?: number) => void;
  };
  win.__EXIST_APP__ = app;
  win.__EXIST_FLIGHT__ = app.butterfly.flight;
  win.__SET_PHASE__ = (phase: number, time: number = phase * 2.5) => {
    app.fixedPhase = phase;
    app.fixedTime = time;
  };

  // Stage 5 Development Flight Telemetry HUD (?debugFlight)
  if (params.has("debugFlight")) {
    const debugEl = document.createElement("div");
    debugEl.style.position = "fixed";
    debugEl.style.bottom = "16px";
    debugEl.style.left = "16px";
    debugEl.style.padding = "10px 14px";
    debugEl.style.background = "rgba(4, 8, 20, 0.85)";
    debugEl.style.border = "1px solid rgba(0, 220, 255, 0.35)";
    debugEl.style.borderRadius = "6px";
    debugEl.style.color = "#00f0ff";
    debugEl.style.fontFamily = "monospace";
    debugEl.style.fontSize = "11px";
    debugEl.style.lineHeight = "1.5";
    debugEl.style.zIndex = "9999";
    debugEl.style.pointerEvents = "none";
    document.body.appendChild(debugEl);

    setInterval(() => {
      const t = app.butterfly.flight.getDebugTelemetry();
      debugEl.innerHTML = `
        <div><strong>EXIST FLIGHT TELEMETRY</strong></div>
        <div>Phase: <strong>${t.phase}</strong> ${t.isGliding ? "(GLIDING)" : ""}</div>
        <div>Speed: ${t.speed.toFixed(3)} | Energy: ${(t.energy * 100).toFixed(1)}%</div>
        <div>Bank: ${t.bankDeg.toFixed(1)}° | Accel: ${t.accelMag.toFixed(3)}</div>
        <div>Pos: [${t.posX.toFixed(2)}, ${t.posY.toFixed(2)}, ${t.posZ.toFixed(2)}]</div>
        <div>Vel: [${t.velX.toFixed(2)}, ${t.velY.toFixed(2)}, ${t.velZ.toFixed(2)}]</div>
        <div>Steer: ${t.steerMag.toFixed(3)} | Contain: ${t.containMag.toFixed(3)}</div>
      `;
    }, 50);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
