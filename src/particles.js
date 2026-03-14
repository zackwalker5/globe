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


// --- Storm systems — radar-style squall lines & cells ---
// Multiple cluster sub-points per storm, count based on intensity
// Concentric pulse rings radiate from each storm
const PARTICLES_PER_SUBPOINT = 80
const PARTICLE_LIFE = 10.0

// Generate cluster sub-points around a storm center
function generateCluster(pt, globeRadius) {
  // More intense = more sub-points in the cluster (2-6)
  const count = Math.floor(2 + pt.intensity * 4)
  const subPoints = []
  const spread = (0.5 + pt.intensity * 1.5) // degrees of spread

  for (let i = 0; i < count; i++) {
    const offsetLat = (Math.random() - 0.5) * spread * 2
    const offsetLon = (Math.random() - 0.5) * spread * 2
    subPoints.push({
      lat: pt.lat + offsetLat,
      lon: pt.lon + offsetLon,
      intensity: pt.intensity * (0.5 + Math.random() * 0.5), // vary sub-intensity
    })
  }
  return subPoints
}

export function createEruptions(trafficPoints, globeRadius) {
  // First pass: generate all cluster sub-points to know total count
  const allSubPoints = []
  for (const pt of trafficPoints) {
    const cluster = generateCluster(pt, globeRadius)
    allSubPoints.push(...cluster)
  }

  const totalParticles = allSubPoints.length * PARTICLES_PER_SUBPOINT

  const positions = new Float32Array(totalParticles * 3)
  const lifetimes = new Float32Array(totalParticles)
  const maxLifetimes = new Float32Array(totalParticles)
  const sizes = new Float32Array(totalParticles)
  const intensities = new Float32Array(totalParticles)
  const origins = new Float32Array(totalParticles * 3)
  const normals = new Float32Array(totalParticles * 3)
  const tangents1 = new Float32Array(totalParticles * 3)
  const tangents2 = new Float32Array(totalParticles * 3)
  const offsets1 = new Float32Array(totalParticles)
  const offsets2 = new Float32Array(totalParticles)
  const driftSpeeds = new Float32Array(totalParticles)
  const heights = new Float32Array(totalParticles)

  for (let p = 0; p < allSubPoints.length; p++) {
    const pt = allSubPoints[p]
    const pos = latLonToVec3(pt.lat, pt.lon, globeRadius)
    const normal = new THREE.Vector3(pos.x, pos.y, pos.z).normalize()

    const up = new THREE.Vector3(0, 1, 0)
    let tan1 = new THREE.Vector3().crossVectors(up, normal)
    if (tan1.length() < 0.01) tan1 = new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), normal)
    tan1.normalize()
    const tan2 = new THREE.Vector3().crossVectors(normal, tan1).normalize()

    // Storm dimensions — smaller per sub-point since there are multiple
    const stormLength = (0.2 + pt.intensity * 0.4) * globeRadius * 0.15
    const stormWidth = stormLength * (0.3 + Math.random() * 0.3)
    const stormAngle = Math.random() * Math.PI * 2
    const cosA = Math.cos(stormAngle)
    const sinA = Math.sin(stormAngle)

    for (let i = 0; i < PARTICLES_PER_SUBPOINT; i++) {
      const idx = p * PARTICLES_PER_SUBPOINT + i

      origins[idx * 3] = pos.x
      origins[idx * 3 + 1] = pos.y
      origins[idx * 3 + 2] = pos.z

      normals[idx * 3] = normal.x
      normals[idx * 3 + 1] = normal.y
      normals[idx * 3 + 2] = normal.z

      tangents1[idx * 3] = tan1.x
      tangents1[idx * 3 + 1] = tan1.y
      tangents1[idx * 3 + 2] = tan1.z

      tangents2[idx * 3] = tan2.x
      tangents2[idx * 3 + 1] = tan2.y
      tangents2[idx * 3 + 2] = tan2.z

      lifetimes[idx] = -Math.random() * PARTICLE_LIFE
      maxLifetimes[idx] = PARTICLE_LIFE * (0.5 + Math.random() * 0.5)

      let localX, localY, intensity

      if (i < PARTICLES_PER_SUBPOINT * 0.3) {
        // Leading edge / core line — tight band along the length
        // Like the bright red/magenta line in the squall line radar
        localX = (Math.random() - 0.5) * stormLength * 0.9
        localY = (Math.random() - 0.5) * stormWidth * 0.2 // very narrow
        intensity = 0.8 + Math.random() * 0.2 // bright
      } else if (i < PARTICLES_PER_SUBPOINT * 0.65) {
        // Mid region — the yellow/green area around the core
        localX = (Math.random() - 0.5) * stormLength
        localY = (Math.random() - 0.5) * stormWidth * 0.6
        // Bias behind the leading edge (trailing precip)
        localY += stormWidth * 0.15
        intensity = 0.4 + Math.random() * 0.3
      } else if (i < PARTICLES_PER_SUBPOINT * 0.9) {
        // Trailing precipitation — wide, faint, behind the core
        // Like the blue/light blue area trailing the squall line
        localX = (Math.random() - 0.5) * stormLength * 1.2
        localY = Math.random() * stormWidth * 1.0 + stormWidth * 0.1 // behind core
        intensity = 0.1 + Math.random() * 0.2
      } else {
        // Scattered cells — random blobs around the main system
        const cellAngle = Math.random() * Math.PI * 2
        const cellDist = stormLength * (0.5 + Math.random() * 0.5)
        localX = Math.cos(cellAngle) * cellDist * (0.3 + Math.random() * 0.3)
        localY = Math.sin(cellAngle) * cellDist * (0.2 + Math.random() * 0.2)
        intensity = 0.3 + Math.random() * 0.5
      }

      // Add jagged irregularity — real storms have messy edges
      localX += (Math.random() - 0.5) * stormWidth * 0.3
      localY += (Math.random() - 0.5) * stormWidth * 0.3

      // Rotate by storm orientation
      offsets1[idx] = localX * cosA - localY * sinA
      offsets2[idx] = localX * sinA + localY * cosA

      // Slow drift — storm moves across the surface
      driftSpeeds[idx] = 0.01 + Math.random() * 0.02

      heights[idx] = 0.003 + Math.random() * 0.008

      // Size: core particles bigger, trailing smaller
      sizes[idx] = 2.0 + intensity * 5.0 + Math.random() * 2.0

      intensities[idx] = intensity

      positions[idx * 3] = pos.x
      positions[idx * 3 + 1] = pos.y
      positions[idx * 3 + 2] = pos.z
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aLife', new THREE.BufferAttribute(lifetimes, 1))
  geo.setAttribute('aMaxLife', new THREE.BufferAttribute(maxLifetimes, 1))
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geo.setAttribute('aIntensity', new THREE.BufferAttribute(intensities, 1))
  geo.setAttribute('aOrigin', new THREE.BufferAttribute(origins, 3))
  geo.setAttribute('aNormal', new THREE.BufferAttribute(normals, 3))
  geo.setAttribute('aTan1', new THREE.BufferAttribute(tangents1, 3))
  geo.setAttribute('aTan2', new THREE.BufferAttribute(tangents2, 3))
  geo.setAttribute('aOffset1', new THREE.BufferAttribute(offsets1, 1))
  geo.setAttribute('aOffset2', new THREE.BufferAttribute(offsets2, 1))
  geo.setAttribute('aDriftSpeed', new THREE.BufferAttribute(driftSpeeds, 1))
  geo.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1))

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 0.31 },
      uPointScale: { value: 0.01 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uColor1: { value: new THREE.Color(0xf1666e) }, // hot core (red/magenta)
      uColor2: { value: new THREE.Color(0xf7a43e) }, // mid (yellow/orange)
      uColor3: { value: new THREE.Color(0x61c16b) }, // outer (green)
      uColor4: { value: new THREE.Color(0x4697f7) }, // trailing precip (blue)
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uScale;
      uniform float uPointScale;
      uniform float uPixelRatio;

      attribute float aLife;
      attribute float aMaxLife;
      attribute float aSize;
      attribute float aIntensity;
      attribute vec3 aOrigin;
      attribute vec3 aNormal;
      attribute vec3 aTan1;
      attribute vec3 aTan2;
      attribute float aOffset1;
      attribute float aOffset2;
      attribute float aDriftSpeed;
      attribute float aHeight;

      varying float vAlpha;
      varying float vIntensity;

      void main() {
        float life = aLife + uTime;
        float t = mod(life, aMaxLife);
        float progress = t / aMaxLife;
        float alive = step(0.0, life);

        // Organic wobble — edges shift slowly but stay near origin
        float wobble1 = sin(uTime * 0.3 + aOffset1 * 5.0) * 0.02 * uScale;
        float wobble2 = cos(uTime * 0.25 + aOffset2 * 4.0) * 0.02 * uScale;

        vec3 offset = aTan1 * (aOffset1 * uScale + wobble1)
                    + aTan2 * (aOffset2 * uScale + wobble2);
        offset += aNormal * aHeight;

        vec3 pos = aOrigin + offset;

        // Fade lifecycle
        float fadeIn = smoothstep(0.0, 0.15, progress);
        float fadeOut = 1.0 - smoothstep(0.75, 1.0, progress);
        float baseFade = fadeIn * fadeOut * alive;

        vAlpha = baseFade * (0.04 + aIntensity * 0.14);
        vIntensity = aIntensity;

        vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPos;

        gl_PointSize = max(aSize * uPointScale * uPixelRatio * (300.0 / -mvPos.z), 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      uniform vec3 uColor3;
      uniform vec3 uColor4;

      varying float vAlpha;
      varying float vIntensity;

      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;

        // Soft gaussian falloff
        float soft = exp(-d * d * 6.0);

        // Radar-style color ramp based on intensity
        // 0.0-0.25 = blue (light precip)
        // 0.25-0.5 = green (moderate)
        // 0.5-0.75 = yellow/orange (heavy)
        // 0.75-1.0 = red/magenta (severe)
        vec3 color;
        if (vIntensity < 0.25) {
          color = mix(uColor4, uColor3, vIntensity / 0.25);
        } else if (vIntensity < 0.5) {
          color = mix(uColor3, uColor2, (vIntensity - 0.25) / 0.25);
        } else {
          color = mix(uColor2, uColor1, (vIntensity - 0.5) / 0.5);
        }

        gl_FragColor = vec4(color, soft * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geo, mat)
  return { points, material: mat }
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
