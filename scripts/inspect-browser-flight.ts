import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--enable-webgl"]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  console.log("Navigating to http://localhost:3001/?debugFlight ...");
  await page.goto("http://localhost:3001/?debugFlight", { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 500));

  const outputDir = path.resolve("scratch/flight-diagnosis");
  fs.mkdirSync(outputDir, { recursive: true });

  console.log("Observing flight over 5 seconds...");

  // Sample every 250ms for 5 seconds
  const samples = [];
  for (let step = 0; step <= 20; step++) {
    const elapsed = step * 0.25;

    const telemetry = await page.evaluate(() => {
      const app = (window as any).__EXIST_APP__;
      const flight = (window as any).__EXIST_FLIGHT__;
      if (!app || !flight) return null;

      // Controller forward in world space
      const controller = app.butterfly.controller;
      controller.updateMatrixWorld(true);

      // Model head in world space
      const head = app.butterfly.procedural.bodyParts.head;
      head.updateMatrixWorld(true);

      const headWorldPos = new head.position.constructor();
      head.getWorldPosition(headWorldPos);

      const thoraxWorldPos = new head.position.constructor();
      app.butterfly.procedural.bodyParts.thorax.getWorldPosition(thoraxWorldPos);

      // Vector from thorax to head (actual creature visual forward in world space!)
      const visualCreatureForward = headWorldPos.clone().sub(thoraxWorldPos).normalize();

      // Controller forward axis (+Z rotated by controller quaternion)
      const controllerForward = new head.position.constructor(0, 0, 1).applyQuaternion(controller.quaternion).normalize();

      const vel = flight.velocity.clone();
      const speed = flight.speed;
      const velDir = speed > 0.001 ? vel.clone().normalize() : new head.position.constructor(0, 0, 0);

      // Dot product between velocity direction and visual creature forward
      const dotCreatureForwardWithVel = speed > 0.001 ? visualCreatureForward.dot(velDir) : 1;
      // Dot product between velocity direction and controller forward (+Z)
      const dotControllerForwardWithVel = speed > 0.001 ? controllerForward.dot(velDir) : 1;

      return {
        flightTime: flight.flightTime,
        flightPhase: flight.flightPhase,
        speed: flight.speed,
        energy: flight.energy,
        pos: [flight.position.x, flight.position.y, flight.position.z],
        vel: [flight.velocity.x, flight.velocity.y, flight.velocity.z],
        velDir: [velDir.x, velDir.y, velDir.z],
        creatureVisualForward: [visualCreatureForward.x, visualCreatureForward.y, visualCreatureForward.z],
        controllerForward: [controllerForward.x, controllerForward.y, controllerForward.z],
        dotCreatureForwardWithVel,
        angleCreatureDeg: (Math.acos(Math.max(-1, Math.min(1, dotCreatureForwardWithVel))) * 180) / Math.PI,
        dotControllerForwardWithVel,
        angleControllerDeg: (Math.acos(Math.max(-1, Math.min(1, dotControllerForwardWithVel))) * 180) / Math.PI
      };
    });

    if (telemetry) {
      samples.push({ t: elapsed.toFixed(2), ...telemetry });
      console.log(`[t = ${elapsed.toFixed(2)}s] Phase: ${telemetry.flightPhase.padEnd(12)} Speed: ${telemetry.speed.toFixed(3)} | Angle (Creature vs Vel): ${telemetry.angleCreatureDeg.toFixed(1)}° | Angle (Controller +Z vs Vel): ${telemetry.angleControllerDeg.toFixed(1)}°`);
    }

    // Capture screenshot at key moments
    if ([0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0].includes(elapsed)) {
      await page.screenshot({ path: path.join(outputDir, `frame_${elapsed.toFixed(2)}s.png`) });
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  fs.writeFileSync(path.join(outputDir, "telemetry_timeline.json"), JSON.stringify(samples, null, 2));
  console.log(`Saved timeline and frames to ${outputDir}`);

  await browser.close();
}

main().catch((err) => {
  console.error("Diagnosis error:", err);
  process.exit(1);
});
