import * as THREE from 'three'
import { latLonToVec3 } from './data.js'

// --- Ambient particle cloud ---
export function createAmbientCloud(globeRadius, count = 2500) {
  const innerR = globeRadius * 1.02
  const outerR = globeRadius * 1.4

  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const opacities = new Float32Array(count)
  const speeds = new Float32Array(count) // orbital speed per particle

  for (let i = 0; i < count; i++) {
    // Random point in spherical shell
    const r = innerR + Math.pow(Math.random(), 1.5) * (outerR - innerR) // bias toward inner
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = r * Math.cos(phi)

    // Closer = slightly bigger + brighter, but all stay tiny
    const distFactor = 1.0 - (r - innerR) / (outerR - innerR)
    sizes[i] = 0.4 + distFactor * 0.3
    opacities[i] = 0.15 + distFactor * 0.5
    speeds[i] = (0.2 + Math.random() * 0.8) * (Math.random() > 0.5 ? 1 : -1)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geo.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1))
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1))

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uColor1: { value: new THREE.Color(0x25a1ef) },
      uColor2: { value: new THREE.Color(0x319694) },
      uShellSpread: { value: 0.3 },
      uDensity: { value: 0.71 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uShellSpread;
      uniform float uDensity;

      attribute float aSize;
      attribute float aOpacity;
      attribute float aSpeed;

      varying float vOpacity;
      varying float vColorMix;

      mat3 rotateY(float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return mat3(c, 0, s, 0, 1, 0, -s, 0, c);
      }

      void main() {
        // Slow orbital rotation per particle
        float angle = uTime * aSpeed * 0.05;
        vec3 pos = rotateY(angle) * position;

        // Shell spread — scale distance from center
        float dist = length(pos);
        vec3 dir = pos / dist;
        float baseR = ${(globeRadius * 1.02).toFixed(3)};
        pos = dir * (baseR + (dist - baseR) * uShellSpread);

        // Slight vertical bob
        pos.y += sin(uTime * 0.3 + pos.x * 2.0) * 0.02;

        // Density — use particle index (aOpacity as proxy) to hide fraction of particles
        float hash = fract(sin(aOpacity * 43758.5453 + aSize * 22578.1459) * 43758.5453);
        float visible = step(hash, uDensity);

        vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPos;
        gl_PointSize = max(aSize * uPixelRatio * (25.0 / -mvPos.z), 1.0) * visible;

        vOpacity = aOpacity * visible;
        vColorMix = sin(pos.x * 3.0 + pos.z * 2.0) * 0.5 + 0.5;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor1;
      uniform vec3 uColor2;

      varying float vOpacity;
      varying float vColorMix;

      void main() {
        // Hard crisp point
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float alpha = smoothstep(0.5, 0.35, d) * vOpacity;

        vec3 color = mix(uColor1, uColor2, vColorMix);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geo, mat)
  return { points, material: mat }
}


// --- Event shape/color config per EONET category ---
export const EVENT_STYLES = {
  // shape: 0=circle, 1=triangle, 2=square, 3=diamond, 4=cross, 5=hexagon
  wildfires:    { shape: 3, color: new THREE.Color(0xff6b35) }, // diamond - orange
  volcanoes:    { shape: 1, color: new THREE.Color(0xff2d2d) }, // triangle - red
  severeStorms: { shape: 5, color: new THREE.Color(0x4697f7) }, // hexagon - blue
  floods:       { shape: 0, color: new THREE.Color(0x00d4aa) }, // circle - teal
  earthquakes:  { shape: 4, color: new THREE.Color(0xffcc44) }, // cross - yellow
  landslides:   { shape: 2, color: new THREE.Color(0xc4956a) }, // square - tan
  snow:         { shape: 4, color: new THREE.Color(0xd4e5ff) }, // cross - ice white
  dustHaze:     { shape: 3, color: new THREE.Color(0xc9a96e) }, // diamond - sand
  drought:      { shape: 2, color: new THREE.Color(0xd4833c) }, // square - burnt orange
  tempExtremes: { shape: 1, color: new THREE.Color(0xff4466) }, // triangle - hot pink
  seaLakeIce:   { shape: 5, color: new THREE.Color(0x88ccff) }, // hexagon - light blue
  waterColor:   { shape: 0, color: new THREE.Color(0x44aa88) }, // circle - sea green
  manmade:      { shape: 2, color: new THREE.Color(0xaa66dd) }, // square - purple
  unknown:      { shape: 0, color: new THREE.Color(0x999999) }, // circle - gray
}

export function createEventMarkers(eventPoints, globeRadius) {
  const count = eventPoints.length
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const shapes = new Float32Array(count)
  const sizes = new Float32Array(count)
  const phases = new Float32Array(count) // random phase for pulse

  for (let i = 0; i < count; i++) {
    const pt = eventPoints[i]
    const pos = latLonToVec3(pt.lat, pt.lon, globeRadius * 1.005)
    positions[i * 3] = pos.x
    positions[i * 3 + 1] = pos.y
    positions[i * 3 + 2] = pos.z

    const style = EVENT_STYLES[pt.category] || EVENT_STYLES.unknown
    colors[i * 3] = style.color.r
    colors[i * 3 + 1] = style.color.g
    colors[i * 3 + 2] = style.color.b
    shapes[i] = style.shape
    sizes[i] = 1.5 + pt.intensity * 2.5
    phases[i] = Math.random() * Math.PI * 2
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('aShape', new THREE.BufferAttribute(shapes, 1))
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uScale: { value: 0.3 },
      uOpacity: { value: 0.85 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uScale;

      attribute vec3 aColor;
      attribute float aShape;
      attribute float aSize;
      attribute float aPhase;

      varying vec3 vColor;
      varying float vShape;
      varying float vPulse;

      void main() {
        vColor = aColor;
        vShape = aShape;

        float pulse = 1.0 + sin(uTime * 1.5 + aPhase) * 0.15;
        vPulse = pulse;

        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPos;
        gl_PointSize = max(aSize * uScale * pulse * uPixelRatio * (80.0 / -mvPos.z), 2.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;

      varying vec3 vColor;
      varying float vShape;
      varying float vPulse;

      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float d;
        float shape = floor(vShape + 0.5);

        if (shape < 0.5) {
          // 0: Circle
          d = length(p);
          if (d > 0.45) discard;
          d = smoothstep(0.45, 0.25, d);
        } else if (shape < 1.5) {
          // 1: Triangle (pointing up)
          vec2 q = vec2(p.x, -p.y + 0.15);
          float tri = max(abs(q.x) * 1.732 + q.y, -q.y * 2.0);
          if (tri > 0.7) discard;
          d = smoothstep(0.7, 0.35, tri);
        } else if (shape < 2.5) {
          // 2: Square
          float sq = max(abs(p.x), abs(p.y));
          if (sq > 0.35) discard;
          d = smoothstep(0.35, 0.2, sq);
        } else if (shape < 3.5) {
          // 3: Diamond
          float dm = abs(p.x) + abs(p.y);
          if (dm > 0.45) discard;
          d = smoothstep(0.45, 0.2, dm);
        } else if (shape < 4.5) {
          // 4: Cross / Plus
          float cx = min(abs(p.x), abs(p.y));
          float co = max(abs(p.x), abs(p.y));
          if (cx > 0.12 || co > 0.4) discard;
          d = smoothstep(0.4, 0.2, co);
        } else {
          // 5: Hexagon
          vec2 q = abs(p);
          float hx = max(q.x * 0.866 + q.y * 0.5, q.y);
          if (hx > 0.4) discard;
          d = smoothstep(0.4, 0.2, hx);
        }

        float alpha = d * uOpacity;
        // Bright solid core with soft edge
        vec3 col = vColor * (0.8 + d * 0.4);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  })

  const points = new THREE.Points(geo, mat)
  return { points, material: mat, eventData: eventPoints }
}


// --- Traffic hotspot glow points on globe surface ---
export function createHotspots(trafficPoints, globeRadius) {
  const count = trafficPoints.length
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const intensities = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const pt = trafficPoints[i]
    const pos = latLonToVec3(pt.lat, pt.lon, globeRadius * 1.005)
    positions[i * 3] = pos.x
    positions[i * 3 + 1] = pos.y
    positions[i * 3 + 2] = pos.z
    sizes[i] = 0.5 + pt.intensity * 1.0
    intensities[i] = pt.intensity
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geo.setAttribute('aIntensity', new THREE.BufferAttribute(intensities, 1))

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uColor: { value: new THREE.Color(0xff96dc) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aSize;
      attribute float aIntensity;
      varying float vIntensity;

      void main() {
        vIntensity = aIntensity;
        float pulse = 1.0 + sin(uTime * 2.0 + aIntensity * 6.28) * 0.3;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPos;
        gl_PointSize = aSize * pulse * uPixelRatio * (200.0 / -mvPos.z);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vIntensity;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float glow = smoothstep(0.5, 0.0, d);
        glow = pow(glow, 1.5);
        float alpha = glow * (0.2 + vIntensity * 0.2);
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geo, mat)
  return { points, material: mat }
}


// --- Concentric pulse rings radiating from storm locations ---
const RINGS_PER_STORM = 3

export function createPulseRings(trafficPoints, globeRadius) {
  const group = new THREE.Group()

  const ringMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x9b84f7) },
      uMaxRadius: { value: 0.2 },
      uSpeed: { value: 0.1 },
      uOpacity: { value: 0.04 },
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
        float progress = fract(cycle / ${RINGS_PER_STORM.toFixed(1)});

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

  for (const pt of trafficPoints) {
    const pos = latLonToVec3(pt.lat, pt.lon, globeRadius)
    const normal = new THREE.Vector3(pos.x, pos.y, pos.z).normalize()

    for (let r = 0; r < RINGS_PER_STORM; r++) {
      const segments = 64
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

  return { group, material: ringMat }
}
