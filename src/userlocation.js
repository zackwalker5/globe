import * as THREE from 'three'
import { latLonToVec3 } from './data.js'

const RINGS = 3

export function createUserMarker(globeRadius) {
  const group = new THREE.Group()
  group.visible = false // hidden until location acquired

  const ringMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x00ccff) },
      uMaxRadius: { value: 0.4 },
      uSpeed: { value: 0.3 },
      uOpacity: { value: 0.5 },
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;

      uniform float uTime;
      uniform float uMaxRadius;
      uniform float uSpeed;

      varying float vAlpha;

      void main() {
        float cycle = uTime * uSpeed + aPhase;
        float progress = fract(cycle / ${RINGS.toFixed(1)});

        float radius = progress * uMaxRadius;
        vec3 pos = position * radius;

        vAlpha = 1.0 - smoothstep(0.2, 1.0, progress);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;

      void main() {
        gl_FragColor = vec4(uColor, vAlpha * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })

  // Pre-build ring geometries (repositioned when location is set)
  const rings = []
  for (let r = 0; r < RINGS; r++) {
    const segments = 64
    const positions = new Float32Array(segments * 3)
    const phases = new Float32Array(segments)

    for (let s = 0; s < segments; s++) {
      const angle = (s / segments) * Math.PI * 2
      positions[s * 3] = Math.cos(angle)
      positions[s * 3 + 1] = Math.sin(angle)
      positions[s * 3 + 2] = 0
      phases[s] = r
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))

    const ring = new THREE.LineLoop(geo, ringMat)
    rings.push(ring)
    group.add(ring)
  }

  function setLocation(lat, lon) {
    const pos = latLonToVec3(lat, lon, globeRadius)
    const normal = new THREE.Vector3(pos.x, pos.y, pos.z).normalize()

    for (const ring of rings) {
      ring.position.set(pos.x, pos.y, pos.z)
      ring.lookAt(pos.x + normal.x, pos.y + normal.y, pos.z + normal.z)
    }

    group.visible = true
  }

  return { group, material: ringMat, setLocation }
}
