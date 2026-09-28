import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

async function main() {
  const outputDir = path.resolve("scratch/flight-extended");
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

  console.log("Sampling flight telemetry and visual frames across 20 seconds...");
  const targetCheckpoints = [];
  for (let t = 0.5; t <= 20.0; t += 1.0) {
    targetCheckpoints.push(t);
  }

  const telemetryLog = [];
  let frameIdx = 0;

  for (const targetT of targetCheckpoints) {
    await page.waitForFunction(
      (t) => {
        const app = (window as any).__EXIST_APP__;
        return app && app.butterfly.flight.flightTime >= t;
      },
      { timeout: 30000 },
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
        isGliding: t.isGliding,
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
        `[t = ${telemetry.flightTime.toFixed(2)}s] Phase: ${telemetry.phase.padEnd(12)} Speed: ${telemetry.speed.toFixed(3)} | Energy: ${(telemetry.energy * 100).toFixed(1)}% | Heading Error: ${telemetry.headingErrorDeg.toFixed(1)}° | Bank: ${telemetry.bankDeg.toFixed(1)}° | Pos: [${telemetry.pos.map((v: number) => v.toFixed(2)).join(", ")}]`
      );
    }
    frameIdx++;
  }

  await browser.close();

  fs.writeFileSync(path.join(outputDir, "telemetry.json"), JSON.stringify(telemetryLog, null, 2));

  const mp4Path = path.join(outputDir, "flight_extended.mp4");
  const gifPath = path.join(outputDir, "flight_extended.gif");

  console.log("\nCompiling frames into animated GIF and MP4 with ffmpeg...");
  execSync(
    `ffmpeg -y -framerate 2 -i "${framesDir}/frame_%04d.png" -vf "scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 "${gifPath}"`,
    { stdio: "inherit" }
  );

  execSync(
    `ffmpeg -y -framerate 2 -i "${framesDir}/frame_%04d.png" -c:v libx264 -pix_fmt yuv420p "${mp4Path}"`,
    { stdio: "inherit" }
  );

  console.log(`GIF saved to: ${gifPath}`);
  console.log(`MP4 saved to: ${mp4Path}`);
}

main().catch((err) => {
  console.error("Error running extended flight audit:", err);
  process.exit(1);
});
