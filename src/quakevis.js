import * as THREE from 'three'
import { latLonToVec3 } from './data.js'

// Everything in a single Points draw call — concentric rings rendered in fragment shader
export function createQuakeLayer(quakePoints, globeRadius) {
  const count = quakePoints.length
  const positions = new Float32Array(count * 3)
  const intensities = new Float32Array(count)
  const phases = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const pt = quakePoints[i]
    const pos = latLonToVec3(pt.lat, pt.lon, globeRadius * 1.004)
    positions[i * 3] = pos.x
    positions[i * 3 + 1] = pos.y
    positions[i * 3 + 2] = pos.z
    intensities[i] = pt.intensity
    phases[i] = Math.random() * 6.28 // offset so they don't all pulse in sync
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aIntensity', new THREE.BufferAttribute(intensities, 1))
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uColor: { value: new THREE.Color(0xffcc44) },
      uSize: { value: 1.0 },
      uOpacity: { value: 0.5 },
      uSpeed: { value: 0.5 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uSize;

      attribute float aIntensity;
      attribute float aPhase;

      varying float vIntensity;
      varying float vPhase;

      void main() {
        vIntensity = aIntensity;
        vPhase = aPhase;

        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPos;

        // Size scales with intensity
        float baseSize = 2.0 + aIntensity * 6.0;
        gl_PointSize = baseSize * uSize * uPixelRatio * (200.0 / -mvPos.z);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uSpeed;

      varying float vIntensity;
      varying float vPhase;

      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0; // 0 at center, 1 at edge
        if (d > 1.0) discard;

        float t = fract(uTime * uSpeed * 0.15 + vPhase);

        // Center dot with slow breathe
        float breathe = 0.7 + sin(uTime * uSpeed * 0.5 + vPhase) * 0.3;
        float dot = smoothstep(0.2, 0.0, d) * breathe;

        // 2 concentric expanding rings — wider bands, fade as they expand
        float ring1t = fract(t);
        float ring1 = smoothstep(0.06, 0.0, abs(d - ring1t)) * (1.0 - ring1t * ring1t);

        float ring2t = fract(t + 0.5);
        float ring2 = smoothstep(0.06, 0.0, abs(d - ring2t)) * (1.0 - ring2t * ring2t);

        float alpha = (dot + ring1 + ring2) * vIntensity * uOpacity;
        if (alpha < 0.001) discard;

        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  })

  const points = new THREE.Points(geo, mat)
  return { group: points, material: mat }
}
