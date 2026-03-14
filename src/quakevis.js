import * as THREE from 'three'
import { latLonToVec3 } from './data.js'

const RINGS_PER_QUAKE = 2
const RING_SEGMENTS = 48

// Earthquake markers — expanding concentric ring loops like the user location marker
export function createQuakeLayer(quakePoints, globeRadius) {
  const count = quakePoints.length
  const group = new THREE.Group()

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xffcc44) },
      uMaxRadius: { value: 0.15 },
      uSpeed: { value: 0.5 },
      uOpacity: { value: 0.5 },
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aIntensity;

      uniform float uTime;
      uniform float uMaxRadius;
      uniform float uSpeed;

      varying float vAlpha;
      varying float vIntensity;

      void main() {
        float cycle = uTime * uSpeed + aPhase;
        float progress = fract(cycle / ${RINGS_PER_QUAKE.toFixed(1)});

        float radius = progress * uMaxRadius * (0.5 + aIntensity * 0.5);
        vec3 pos = position * radius;

        vAlpha = 1.0 - smoothstep(0.2, 1.0, progress);
        vIntensity = aIntensity;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      varying float vIntensity;

      void main() {
        gl_FragColor = vec4(uColor, vAlpha * uOpacity * vIntensity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  })

  for (let i = 0; i < count; i++) {
    const pt = quakePoints[i]
    const pos = latLonToVec3(pt.lat, pt.lon, globeRadius * 1.004)
    const normal = new THREE.Vector3(pos.x, pos.y, pos.z).normalize()

    for (let r = 0; r < RINGS_PER_QUAKE; r++) {
      const positions = new Float32Array(RING_SEGMENTS * 3)
      const phases = new Float32Array(RING_SEGMENTS)
      const intensities = new Float32Array(RING_SEGMENTS)

      for (let s = 0; s < RING_SEGMENTS; s++) {
        const angle = (s / RING_SEGMENTS) * Math.PI * 2
        positions[s * 3] = Math.cos(angle)
        positions[s * 3 + 1] = Math.sin(angle)
        positions[s * 3 + 2] = 0
        phases[s] = r + i * 0.7 // offset per quake so they don't sync
        intensities[s] = pt.intensity
      }

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
      geo.setAttribute('aIntensity', new THREE.BufferAttribute(intensities, 1))

      const ring = new THREE.LineLoop(geo, mat)
      ring.position.set(pos.x, pos.y, pos.z)
      ring.lookAt(pos.x + normal.x, pos.y + normal.y, pos.z + normal.z)
      group.add(ring)
    }
  }

  return { group, material: mat }
}
