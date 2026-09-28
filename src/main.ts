import * as THREE from "three";
import { App } from "./App.ts";
import { BUTTERFLY_CANONICAL_FORWARD } from "./world/FlightController.ts";

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

  // Stage 5 Development Flight Telemetry HUD & Visual Direction Vectors (?debugFlight)
  if (params.has("debugFlight")) {
    // 1. Visual Direction Vectors in 3D scene (Development Only)
    // Green arrow = Actual Velocity Direction
    // Cyan arrow  = Visual Butterfly Head Direction
    const velArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      0.8,
      0x00ff66,
      0.18,
      0.10
    );
    velArrow.name = "DebugVelocityArrow";
    app.scene.instance.add(velArrow);

    const headArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      0.65,
      0x00f0ff,
      0.14,
      0.08
    );
    headArrow.name = "DebugHeadArrow";
    app.scene.instance.add(headArrow);

    const _scratchHead = new THREE.Vector3();
    const _scratchVel = new THREE.Vector3();

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
      const ctrlPos = app.butterfly.controller.position;

      // Update 3D visual direction vectors
      velArrow.position.copy(ctrlPos);
      if (t.speed > 0.001) {
        _scratchVel.set(t.velX, t.velY, t.velZ).normalize();
        velArrow.setDirection(_scratchVel);
        velArrow.setLength(Math.max(0.4, t.speed * 1.8), 0.16, 0.08);
        velArrow.visible = true;
      } else {
        velArrow.visible = false;
      }

      headArrow.position.copy(ctrlPos);
      _scratchHead.copy(BUTTERFLY_CANONICAL_FORWARD).applyQuaternion(app.butterfly.controller.quaternion).normalize();
      headArrow.setDirection(_scratchHead);
      headArrow.visible = true;

      debugEl.innerHTML = `
        <div><strong>EXIST FLIGHT TELEMETRY</strong></div>
        <div>Phase: <strong>${t.phase}</strong> ${t.isGliding ? "(GLIDING)" : ""}</div>
        <div>Speed: ${t.speed.toFixed(3)} | Energy: ${(t.energy * 100).toFixed(1)}%</div>
        <div>Bank: ${t.bankDeg.toFixed(1)}° | Accel: ${t.accelMag.toFixed(3)}</div>
        <div>Pos: [${t.posX.toFixed(2)}, ${t.posY.toFixed(2)}, ${t.posZ.toFixed(2)}]</div>
        <div>Vel: [${t.velX.toFixed(2)}, ${t.velY.toFixed(2)}, ${t.velZ.toFixed(2)}]</div>
        <div>Head: [${t.headX.toFixed(2)}, ${t.headY.toFixed(2)}, ${t.headZ.toFixed(2)}]</div>
        <div style="color: ${t.headingErrorDeg < 25 ? '#00ff88' : '#ff4466'}">
          Heading Error: <strong>${t.headingErrorDeg.toFixed(1)}°</strong>
          (Green: Vel, Cyan: Head)
        </div>
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
