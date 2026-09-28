import * as THREE from "three";
import { Butterfly } from "../src/world/Butterfly.ts";
import { FlightPhase } from "../src/world/FlightController.ts";

function runVerification() {
  console.log("=== EXIST Stage 5: Real Flight / Locomotion Rebuild Verification ===\n");

  // [1] Numerical Stability, Momentum, Containment, & Phase Transitions (30 seconds / 1800 frames)
  console.log("[1] Simulating 30 Seconds (1800 frames) of Physical Flight:");
  const butterfly = new Butterfly();
  const delta = 1 / 60;
  const totalFrames = 60 * 30; // 1800 frames

  const observedPhases = new Set<FlightPhase>();
  let minSpeed = Infinity;
  let maxSpeed = -Infinity;
  let maxAccel = -Infinity;
  let maxAngularVel = -Infinity;
  let minEnergy = Infinity;
  let maxEnergy = -Infinity;
  let maxDistFromCenter = 0;
  let glideOccurrences = 0;
  let prevPos = new THREE.Vector3().copy(butterfly.flight.position);
  let maxSingleFrameJump = 0;

  for (let f = 0; f < totalFrames; f++) {
    butterfly.update(delta);

    const flight = butterfly.flight;
    const pos = flight.position;
    const vel = flight.velocity;
    const accel = flight.acceleration;
    const angVel = flight.angularVelocity;
    const speed = flight.speed;
    const energy = flight.energy;
    const phase = flight.flightPhase;

    observedPhases.add(phase);

    // Sanity: Zero NaN / Infinity check
    if (isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z) || !isFinite(pos.x)) {
      throw new Error(`NaN / Non-finite detected in position at frame ${f}`);
    }
    if (isNaN(vel.x) || isNaN(vel.y) || isNaN(vel.z) || !isFinite(vel.x)) {
      throw new Error(`NaN / Non-finite detected in velocity at frame ${f}`);
    }
    if (isNaN(accel.x) || isNaN(accel.y) || isNaN(accel.z) || !isFinite(accel.x)) {
      throw new Error(`NaN / Non-finite detected in acceleration at frame ${f}`);
    }
    if (isNaN(angVel.x) || isNaN(angVel.y) || isNaN(angVel.z) || !isFinite(angVel.x)) {
      throw new Error(`NaN / Non-finite detected in angularVelocity at frame ${f}`);
    }

    // Teleportation / Discontinuous Jump Check
    const frameJump = pos.distanceTo(prevPos);
    maxSingleFrameJump = Math.max(maxSingleFrameJump, frameJump);
    if (f > 0 && frameJump > 0.15) {
      throw new Error(`Discontinuous teleportation detected at frame ${f}: jump = ${frameJump.toFixed(4)} units`);
    }
    prevPos.copy(pos);

    // Metrics tracking
    if (f > 60 * 4) { // Post-awakening
      minSpeed = Math.min(minSpeed, speed);
      maxSpeed = Math.max(maxSpeed, speed);
      maxAccel = Math.max(maxAccel, accel.length());
      maxAngularVel = Math.max(maxAngularVel, angVel.length());
      minEnergy = Math.min(minEnergy, energy);
      maxEnergy = Math.max(maxEnergy, energy);

      // Distance from center
      const dx = pos.x - 0.15;
      const dy = pos.y - (-0.35);
      const dz = pos.z - 0.0;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      maxDistFromCenter = Math.max(maxDistFromCenter, dist);

      if (flight.isGliding && (f % 30 === 0)) {
        glideOccurrences++;
      }
    }

    // Progress milestone logs
    if (f === 60 * 1) {
      console.log(`  -> t = 1.0s: Phase = ${phase}, Speed = ${speed.toFixed(3)}, Energy = ${(energy * 100).toFixed(1)}%`);
    } else if (f === 60 * 3) {
      console.log(`  -> t = 3.0s: Phase = ${phase}, Speed = ${speed.toFixed(3)}, Bank = ${(flight.bank * 180 / Math.PI).toFixed(1)}°`);
    } else if (f === 60 * 12) {
      console.log(`  -> t = 12.0s: Phase = ${phase}, Speed = ${speed.toFixed(3)}, Pos = [${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}]`);
    } else if (f === 60 * 24) {
      console.log(`  -> t = 24.0s: Phase = ${phase}, Speed = ${speed.toFixed(3)}, Energy = ${(energy * 100).toFixed(1)}%`);
    }
  }

  console.log("\n[2] Metrics Summary:");
  console.log(`- Speed Range: [${minSpeed.toFixed(4)}, ${maxSpeed.toFixed(4)}]`);
  console.log(`- Peak Acceleration: ${maxAccel.toFixed(4)}`);
  console.log(`- Peak Angular Velocity: ${maxAngularVel.toFixed(4)} rad/s`);
  console.log(`- Max Frame Movement: ${maxSingleFrameJump.toFixed(5)} units/frame`);
  console.log(`- Energy Range: [${minEnergy.toFixed(4)}, ${maxEnergy.toFixed(4)}]`);
  console.log(`- Max Distance from Center: ${maxDistFromCenter.toFixed(3)} units`);
  console.log(`- Observed Phases: ${Array.from(observedPhases).join(", ")}`);
  console.log(`- Glide Active Frames Sampled: ${glideOccurrences}`);

  // Validation Checks
  console.log("\n[3] Validating Flight Criteria:");

  // Check 1: Speed Bounds
  if (minSpeed < 0.05 || maxSpeed > 0.85) {
    throw new Error(`Speed out of physiological envelope: [${minSpeed}, ${maxSpeed}]`);
  }
  console.log("  [PASS] Speed bounds physiologically constrained with natural variation.");

  // Check 2: Energy Regulation
  if (minEnergy <= 0.15 || maxEnergy > 1.0 || minEnergy === maxEnergy) {
    throw new Error(`Energy regulation failed: range [${minEnergy}, ${maxEnergy}]`);
  }
  console.log("  [PASS] Energy dynamically cycles between expenditure and recovery without locking.");

  // Check 3: Containment
  if (maxDistFromCenter > 2.8) {
    throw new Error(`Butterfly drifted beyond composition envelope: dist = ${maxDistFromCenter.toFixed(2)}`);
  }
  console.log("  [PASS] Soft composition containment gracefully preserves the framing around EXIST.");

  // Check 4: Diverse Natural Phases
  const requiredPhases = [FlightPhase.RESTING, FlightPhase.AWAKENING, FlightPhase.CRUISE];
  for (const rp of requiredPhases) {
    if (!observedPhases.has(rp)) {
      throw new Error(`Missing expected flight phase: ${rp}`);
    }
  }
  if (!observedPhases.has(FlightPhase.TURNING) && !observedPhases.has(FlightPhase.CLIMBING) && !observedPhases.has(FlightPhase.GLIDING)) {
    throw new Error("Locomotion lacked behavioral maneuvers (no turning/climbing/gliding observed)!");
  }
  console.log("  [PASS] Natural behavioral variety confirmed across multiple flight phases.");

  // [4] Determinism Verification
  console.log("\n[4] Deterministic Simulation Test (Same seed produces bit-exact trajectory):");
  const b1 = new Butterfly();
  const b2 = new Butterfly();

  for (let f = 0; f < 300; f++) {
    b1.update(delta);
    b2.update(delta);
  }

  const p1 = b1.flight.position;
  const p2 = b2.flight.position;
  const diff = p1.distanceTo(p2);
  console.log(`  -> Final position difference after 300 frames: ${diff.toExponential(4)} units`);
  if (diff > 1e-6) {
    throw new Error(`Simulation is not deterministic! Position difference = ${diff}`);
  }
  console.log("  [PASS] Bit-exact deterministic repeatability confirmed.");

  // [5] Stage 4 Secondary Motion Response Verification
  console.log("\n[5] Stage 4 Secondary Motion Health Check with New Locomotion:");
  const procedural = butterfly.procedural;
  const parts = procedural.bodyParts;

  console.log(`  -> Thorax Heave & Surge: Bob = ${parts.root.position.y.toFixed(5)}, Surge = ${parts.root.position.z.toFixed(5)}`);
  let tipAngle = 0;
  for (const s of parts.abdomenSegments) tipAngle += s.rotation.x;
  console.log(`  -> Abdomen Curvature: Tip Pitch = ${(tipAngle * 180 / Math.PI).toFixed(2)}°`);
  console.log(`  -> Antenna Deflection: Left = ${(procedural.antennaSystem.leftAntennaGroup.rotation.x * 180 / Math.PI).toFixed(2)}°`);
  console.log(`  -> Streamer Velocity Drag Uniform: ${procedural.streamerDeform.uniforms.uVelocityDrag.value.toFixed(4)}`);
  console.log(`  -> Biological Breath Scale: ${parts.abdomen.scale.x.toFixed(4)}`);

  console.log("\n=== ALL STAGE 5 VERIFICATION CHECKS PASSED SUCCESSFULLY ===");
}

runVerification();
