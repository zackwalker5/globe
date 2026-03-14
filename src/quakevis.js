import * as THREE from 'three'
import { latLonToVec3 } from './data.js'

const RINGS_PER_QUAKE = 3

export function createQuakeLayer(quakePoints, globeRadius) {
  const group = new THREE.Group()
  const count = quakePoints.length

  // --- Small circle markers at each epicenter ---
  const markerPositions = new Float32Array(count * 3)
  const markerSizes = new Float32Array(count)
  const markerIntensities = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const pt = quakePoints[i]
    const pos = latLonToVec3(pt.lat, pt.lon, globeRadius * 1.004)
    markerPositions[i * 3] = pos.x
    markerPositions[i * 3 + 1] = pos.y
    markerPositions[i * 3 + 2] = pos.z
    markerSizes[i] = 1.0 + pt.intensity * 3.0
    markerIntensities[i] = pt.intensity
  }

  const markerGeo = new THREE.BufferGeometry()
  markerGeo.setAttribute('position', new THREE.BufferAttribute(markerPositions, 3))
  markerGeo.setAttribute('aSize', new THREE.BufferAttribute(markerSizes, 1))
  markerGeo.setAttribute('aIntensity', new THREE.BufferAttribute(markerIntensities, 1))

  const markerMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uColor: { value: new THREE.Color(0xffcc44) },
      uSize: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uSize;
      attribute float aSize;
      attribute float aIntensity;
      varying float vIntensity;

      void main() {
        vIntensity = aIntensity;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPos;
        gl_PointSize = aSize * uSize * uPixelRatio * (200.0 / -mvPos.z);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vIntensity;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;

        // Hollow circle: bright ring, transparent center
        float ring = smoothstep(0.35, 0.42, d) * smoothstep(0.5, 0.44, d);
        // Subtle fill inside
        float fill = smoothstep(0.5, 0.0, d) * 0.15;
        float alpha = (ring + fill) * (0.5 + vIntensity * 0.5);

        vec3 color = mix(uColor, vec3(1.0), ring * 0.3);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const markers = new THREE.Points(markerGeo, markerMat)
  group.add(markers)

  // --- Pulsing rings around each epicenter ---
  const ringMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xffcc44) },
      uMaxRadius: { value: 0.15 },
      uSpeed: { value: 0.15 },
      uOpacity: { value: 0.08 },
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aIntensity;

      uniform float uTime;
      uniform float uMaxRadius;
      uniform float uSpeed;

      varying float vAlpha;

      void main() {
        float cycle = uTime * uSpeed + aPhase;
        float progress = fract(cycle / ${RINGS_PER_QUAKE.toFixed(1)});

        float radius = progress * uMaxRadius * (0.5 + aIntensity * 0.5);
        vec3 pos = position * radius;

        vAlpha = (1.0 - smoothstep(0.3, 1.0, progress)) * aIntensity;

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

  for (const pt of quakePoints) {
    const pos = latLonToVec3(pt.lat, pt.lon, globeRadius)
    const normal = new THREE.Vector3(pos.x, pos.y, pos.z).normalize()

    for (let r = 0; r < RINGS_PER_QUAKE; r++) {
      const segments = 48
      const ringPositions = new Float32Array(segments * 3)
      const phases = new Float32Array(segments)
      const ringIntensities = new Float32Array(segments)

      for (let s = 0; s < segments; s++) {
        const angle = (s / segments) * Math.PI * 2
        ringPositions[s * 3] = Math.cos(angle)
        ringPositions[s * 3 + 1] = Math.sin(angle)
        ringPositions[s * 3 + 2] = 0
        phases[s] = r
        ringIntensities[s] = pt.intensity
      }

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(ringPositions, 3))
      geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
      geo.setAttribute('aIntensity', new THREE.BufferAttribute(ringIntensities, 1))

      const ring = new THREE.LineLoop(geo, ringMat)
      ring.position.set(pos.x, pos.y, pos.z)
      ring.lookAt(pos.x + normal.x, pos.y + normal.y, pos.z + normal.z)
      group.add(ring)
    }
  }

  return { group, markerMaterial: markerMat, ringMaterial: ringMat }
}
