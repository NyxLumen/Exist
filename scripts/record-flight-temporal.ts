import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

async function main() {
  const outputDir = path.resolve("scratch/flight-temporal");
  const framesDir = path.join(outputDir, "frames");
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--enable-webgl", "--window-size=1280,720"]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  console.log("Navigating to http://localhost:3001/?debugFlight ...");
  await page.goto("http://localhost:3001/?debugFlight", { waitUntil: "domcontentloaded" });

  // Reset butterfly pose cleanly right before sampling
  await page.evaluate(() => {
    const app = (window as any).__EXIST_APP__;
    if (app) {
      app.butterfly.flight.resetToInitialPose();
    }
  });

  console.log("Sampling flight telemetry and visual frames across the first 3.5 seconds...");
  const targetCheckpoints = [0.05, 0.25, 0.50, 0.75, 1.00, 1.25, 1.50, 1.75, 2.00, 2.30, 2.60, 3.00, 3.50];
  const telemetryLog = [];
  let frameIdx = 0;

  for (const targetT of targetCheckpoints) {
    // Wait until in-engine flightTime reaches targetT
    await page.waitForFunction(
      (t) => {
        const app = (window as any).__EXIST_APP__;
        return app && app.butterfly.flight.flightTime >= t;
      },
      { timeout: 15000 },
      targetT
    );

    const telemetry = await page.evaluate(() => {
      const app = (window as any).__EXIST_APP__;
      const flight = (window as any).__EXIST_FLIGHT__;
      if (!app || !flight) return null;

      const t = flight.getDebugTelemetry();
      return {
        flightTime: flight.flightTime,
        phase: t.phase,
        speed: t.speed,
        energy: t.energy,
        pos: [t.posX, t.posY, t.posZ],
        vel: [t.velX, t.velY, t.velZ],
        head: [t.headX, t.headY, t.headZ],
        headingErrorDeg: t.headingErrorDeg,
        bankDeg: t.bankDeg
      };
    });

    const frameFile = path.join(framesDir, `frame_${String(frameIdx).padStart(4, "0")}.png`);
    await page.screenshot({ path: frameFile });

    if (telemetry) {
      telemetryLog.push({ frame: frameIdx, targetT, ...telemetry });
      console.log(
        `[t = ${telemetry.flightTime.toFixed(2)}s] Phase: ${telemetry.phase.padEnd(12)} Speed: ${telemetry.speed.toFixed(3)} | Heading Error: ${telemetry.headingErrorDeg.toFixed(1)}° | Bank: ${telemetry.bankDeg.toFixed(1)}° | Pos: [${telemetry.pos.map((v: number) => v.toFixed(2)).join(", ")}]`
      );
    }
    frameIdx++;
  }

  await browser.close();

  // Save telemetry JSON
  fs.writeFileSync(path.join(outputDir, "telemetry.json"), JSON.stringify(telemetryLog, null, 2));

  // Compile video and gif using ffmpeg
  const mp4Path = path.join(outputDir, "flight_sequence.mp4");
  const gifPath = path.join(outputDir, "flight_sequence.gif");

  console.log("\nCompiling frames into animated GIF and MP4 with ffmpeg...");
  execSync(
    `ffmpeg -y -framerate 4 -i "${framesDir}/frame_%04d.png" -vf "scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 "${gifPath}"`,
    { stdio: "inherit" }
  );

  execSync(
    `ffmpeg -y -framerate 4 -i "${framesDir}/frame_%04d.png" -c:v libx264 -pix_fmt yuv420p "${mp4Path}"`,
    { stdio: "inherit" }
  );

  console.log(`GIF saved to: ${gifPath}`);
  console.log(`MP4 saved to: ${mp4Path}`);

  // Temporal analysis of the first 3 seconds
  console.log("\n=== TEMPORAL ANALYSIS OF THE FIRST 3 SECONDS ===");
  const intervals = [
    { label: "0.00s - 0.25s (Immediate Life)", start: 0, end: 0.25 },
    { label: "0.25s - 0.50s (Natural Acceleration)", start: 0.25, end: 0.50 },
    { label: "0.50s - 1.00s (Smooth Transition)", start: 0.50, end: 1.00 },
    { label: "1.00s - 2.00s (Continuous Flight)", start: 1.00, end: 2.00 },
    { label: "2.00s - 3.50s (Autonomous Dynamic Flight)", start: 2.00, end: 3.50 }
  ];

  for (const inv of intervals) {
    const subset = telemetryLog.filter((s) => s.flightTime >= inv.start - 0.05 && s.flightTime <= inv.end + 0.1);
    if (subset.length === 0) continue;
    const avgSpeed = subset.reduce((acc, s) => acc + s.speed, 0) / subset.length;
    const avgHeadingError = subset.reduce((acc, s) => acc + s.headingErrorDeg, 0) / subset.length;
    const phases = Array.from(new Set(subset.map((s) => s.phase))).join(", ");
    const startPos = subset[0].pos;
    const endPos = subset[subset.length - 1].pos;
    const dist = Math.hypot(endPos[0] - startPos[0], endPos[1] - startPos[1], endPos[2] - startPos[2]);

    console.log(`\n[${inv.label}]`);
    console.log(`  Phases:        ${phases}`);
    console.log(`  Speed Range:   [${subset[0].speed.toFixed(3)} -> ${subset[subset.length - 1].speed.toFixed(3)}] (Avg: ${avgSpeed.toFixed(3)})`);
    console.log(`  Heading Error: Avg ${avgHeadingError.toFixed(1)}° (Max: ${Math.max(...subset.map((s) => s.headingErrorDeg)).toFixed(1)}°)`);
    console.log(`  Displacement:  ${dist.toFixed(4)} units`);
  }
}

main().catch((err) => {
  console.error("Recording error:", err);
  process.exit(1);
});
