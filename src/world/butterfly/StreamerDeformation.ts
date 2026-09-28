import * as THREE from "three";

/**
 * StreamerDeformation implements GPU-side procedural fluid wave dynamics for the trailing streamers:
 * - Fluid traveling waves propagating down each ribbon: pow(s, 1.35)
 * - Silk-underwater physics: smooth low-frequency harmonic undulations
 * - Reaction to wing stroke airflow vortices and flight momentum
 */
export class StreamerDeformation {
  public readonly material: THREE.MeshStandardMaterial;

  public uniforms: {
    uTime: { value: number };
    uFlapPhase: { value: number };
    uFlapVelocity: { value: number };
    uSpeed: { value: number };
    uBank: { value: number };
  };

  constructor() {
    this.uniforms = {
      uTime: { value: 0 },
      uFlapPhase: { value: 0 },
      uFlapVelocity: { value: 0 },
      uSpeed: { value: 0 },
      uBank: { value: 0 }
    };

    this.material = new THREE.MeshStandardMaterial({
      color: 0x95a2b0,
      roughness: 0.45,
      metalness: 0.08,
      side: THREE.DoubleSide
    });

    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uFlapPhase = this.uniforms.uFlapPhase;
      shader.uniforms.uFlapVelocity = this.uniforms.uFlapVelocity;
      shader.uniforms.uSpeed = this.uniforms.uSpeed;
      shader.uniforms.uBank = this.uniforms.uBank;

      shader.vertexShader = `
        uniform float uTime;
        uniform float uFlapPhase;
        uniform float uFlapVelocity;
        uniform float uSpeed;
        uniform float uBank;

        attribute float aDistanceToRoot;
        attribute float aDistanceToEdge;
        attribute float aWingPart;

        ${shader.vertexShader}
      `;

      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `
        #include <begin_vertex>

        // s = distance along streamer length (0 at anchor, 1 at tip)
        float s = aDistanceToRoot;

        // Progressive amplitude envelope: root is anchored (0), tip moves freely (pow(s, 1.35))
        float amp = pow(s, 1.35);

        // 1. Primary low-frequency traveling wave (silk in fluid)
        float wave1 = sin(uTime * 2.2 - s * 3.8) * 0.14 * amp;
        float wave2 = cos(uTime * 3.1 - s * 5.2 + 0.9) * 0.08 * amp;
        float lateralWave = wave1 + wave2;

        // 2. Trailing depth wave in Z (flapping air wake impulse)
        float wakeWave = sin(uFlapPhase * 6.2831853 - s * 4.2) * 0.12 * amp;
        float sagWave = cos(uTime * 1.8 - s * 2.8) * 0.06 * amp;
        float depthWave = wakeWave + sagWave;

        // 3. Bank and flight drag bias
        float bankDrag = uBank * 0.25 * amp;

        transformed.x += lateralWave + bankDrag;
        transformed.z += depthWave - uSpeed * 0.35 * s;
        `
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        `
        #include <beginnormal_vertex>
        // Smoothly adjust normals for traveling wave highlights
        float sNorm = aDistanceToRoot;
        float waveAngle = cos(uTime * 2.2 - sNorm * 3.8) * 0.25 * pow(sNorm, 0.8);
        float cosW = cos(waveAngle);
        float sinW = sin(waveAngle);

        float nX = objectNormal.x * cosW - objectNormal.z * sinW;
        float nZ = objectNormal.x * sinW + objectNormal.z * cosW;
        objectNormal.x = nX;
        objectNormal.z = nZ;
        `
      );
    };

    this.material.customProgramCacheKey = () => "StreamerDeformation_Neutral";
  }

  public update(time: number, flapPhase: number, flapVelocity: number, speed: number, bank: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uFlapPhase.value = flapPhase;
    this.uniforms.uFlapVelocity.value = flapVelocity;
    this.uniforms.uSpeed.value = speed;
    this.uniforms.uBank.value = bank;
  }

  public dispose(): void {
    this.material.dispose();
  }
}
