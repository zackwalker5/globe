import * as THREE from 'three'
import { latLonToVec3 } from './data.js'

const ISS_API = 'https://api.wheretheiss.at/v1/satellites/25544'
const ISS_POSITIONS_API = 'https://api.wheretheiss.at/v1/satellites/25544/positions'
const TRAIL = 500
const POLL_INTERVAL = 5000 // 5 seconds
const BACKFILL_MINUTES = 45
const BACKFILL_STEP = 10 // seconds between backfill samples

export function createISS(globeRadius, { trailLength = 500, backfillMinutes = 45 } = {}) {
  const group = new THREE.Group()
  const TRAIL = trailLength
  const BACKFILL = backfillMinutes

  // --- Orbit trail (fading line behind ISS) ---
  const trailPositions = new Float32Array(TRAIL * 3)
  const trailAlphas = new Float32Array(TRAIL)

  for (let i = 0; i < TRAIL; i++) {
    trailAlphas[i] = i // store index; shader normalizes by active count
  }

  const trailGeo = new THREE.BufferGeometry()
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3))
  trailGeo.setAttribute('aAlpha', new THREE.BufferAttribute(trailAlphas, 1))

  const trailMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xff6b35) },
      uOpacity: { value: 0.6 },
      uTrailCount: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      uniform float uTrailCount;
      varying float vAlpha;

      void main() {
        float t = uTrailCount > 1.0 ? aAlpha / (uTrailCount - 1.0) : 0.0;
        vAlpha = 1.0 - t;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;

      void main() {
        float fade = pow(vAlpha, 2.0);
        gl_FragColor = vec4(uColor, fade * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const trail = new THREE.Line(trailGeo, trailMat)
  group.add(trail)

  // --- ISS marker (triangle pointing in direction of travel) ---
  // Triangle: tip at +Y (forward), base at -Y
  const triVerts = new Float32Array([
    0, 0.06, 0,      // tip
    -0.03, -0.03, 0, // base left
    0.03, -0.03, 0,  // base right
  ])
  const markerGeo = new THREE.BufferGeometry()
  markerGeo.setAttribute('position', new THREE.BufferAttribute(triVerts, 3))
  markerGeo.setIndex([0, 1, 2])

  const markerMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xff6b35) },
      uSize: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSize;

      varying vec3 vPos;

      void main() {
        float pulse = 1.0 + sin(uTime * 3.0) * 0.1;
        vec3 scaled = position * uSize * pulse;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(scaled, 1.0);
        vPos = position;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;

      varying vec3 vPos;

      void main() {
        // Brighter toward tip
        float tipGlow = smoothstep(-0.03, 0.06, vPos.y);
        vec3 color = mix(uColor, vec3(1.0), tipGlow * 0.4);
        float alpha = 0.7 + tipGlow * 0.3;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })

  const marker = new THREE.Mesh(markerGeo, markerMat)
  group.add(marker)

  // --- State ---
  const orbitAlt = globeRadius * 1.02
  let trailIndex = 0
  let trailFilled = false
  let polling = null
  let prevPos = null

  function updatePosition(lat, lon) {
    const p = latLonToVec3(lat, lon, orbitAlt)
    const posVec = new THREE.Vector3(p.x, p.y, p.z)

    // Position the triangle on the globe surface
    marker.position.copy(posVec)

    // Orient: normal = outward from globe center, forward = velocity direction
    const normal = posVec.clone().normalize()

    if (prevPos) {
      // Velocity vector projected onto the tangent plane
      const velocity = posVec.clone().sub(prevPos)
      // Remove radial component to get tangent direction
      const radialComponent = normal.clone().multiplyScalar(velocity.dot(normal))
      const tangentVel = velocity.sub(radialComponent)

      if (tangentVel.length() > 0.0001) {
        tangentVel.normalize()
        // Build orientation: Z = normal (away from surface), Y = forward (velocity)
        const right = new THREE.Vector3().crossVectors(tangentVel, normal).normalize()
        const forward = tangentVel

        const m = new THREE.Matrix4()
        m.makeBasis(right, forward, normal)
        marker.quaternion.setFromRotationMatrix(m)
      }
    } else {
      // First update — just face outward
      marker.lookAt(posVec.clone().add(normal))
    }

    prevPos = posVec.clone()

    // Shift trail: move all positions one slot back
    const tPos = trail.geometry.attributes.position.array
    for (let i = TRAIL - 1; i > 0; i--) {
      tPos[i * 3] = tPos[(i - 1) * 3]
      tPos[i * 3 + 1] = tPos[(i - 1) * 3 + 1]
      tPos[i * 3 + 2] = tPos[(i - 1) * 3 + 2]
    }
    tPos[0] = p.x
    tPos[1] = p.y
    tPos[2] = p.z
    trail.geometry.attributes.position.needsUpdate = true

    if (!trailFilled) {
      trailIndex++
      if (trailIndex >= TRAIL) trailFilled = true
      const count = Math.min(trailIndex, TRAIL)
      trail.geometry.setDrawRange(0, count)
      trailMat.uniforms.uTrailCount.value = count
    }
  }

  async function fetchPosition() {
    try {
      const res = await fetch(ISS_API)
      if (!res.ok) return
      const data = await res.json()
      updatePosition(data.latitude, data.longitude)
      group.visible = true
    } catch (e) {
      // silently fail, keep last known position
    }
  }

  async function backfillTrail() {
    try {
      const now = Math.floor(Date.now() / 1000)
      const totalSamples = Math.floor((BACKFILL * 60) / BACKFILL_STEP)
      // API limits ~10 timestamps per request, so batch them
      const batchSize = 10
      const allPositions = []

      for (let i = 0; i < totalSamples; i += batchSize) {
        const timestamps = []
        for (let j = 0; j < batchSize && (i + j) < totalSamples; j++) {
          // oldest first: start from BACKFILL minutes ago, step forward
          const secsAgo = (totalSamples - (i + j)) * BACKFILL_STEP
          timestamps.push(now - secsAgo)
        }
        try {
          const res = await fetch(`${ISS_POSITIONS_API}?timestamps=${timestamps.join(',')}&units=kilometers`)
          if (res.status === 429) { break } // rate limited, stop backfill
          if (!res.ok) continue
          const data = await res.json()
          allPositions.push(...data)
          // Small delay between batches to avoid rate limiting
          if (i + batchSize < totalSamples) await new Promise(r => setTimeout(r, 300))
        } catch {
          break // network error, stop backfill
        }
      }

      // Fill trail from oldest to newest (no marker update, just trail)
      const tPos = trail.geometry.attributes.position.array
      const count = Math.min(allPositions.length, TRAIL)
      // Place oldest at the end of the trail, newest at the front
      for (let i = 0; i < count; i++) {
        const d = allPositions[allPositions.length - 1 - i]
        const p = latLonToVec3(d.latitude, d.longitude, orbitAlt)
        tPos[i * 3] = p.x
        tPos[i * 3 + 1] = p.y
        tPos[i * 3 + 2] = p.z
      }
      trail.geometry.attributes.position.needsUpdate = true
      trailIndex = count
      trailFilled = count >= TRAIL
      trail.geometry.setDrawRange(0, count)
      trailMat.uniforms.uTrailCount.value = count

      // Set prevPos from second-to-last for correct marker orientation on first live update
      if (allPositions.length >= 2) {
        const secondLast = allPositions[allPositions.length - 2]
        const sp = latLonToVec3(secondLast.latitude, secondLast.longitude, orbitAlt)
        prevPos = new THREE.Vector3(sp.x, sp.y, sp.z)
      }

      // Position marker at most recent backfill point
      if (allPositions.length > 0) {
        const last = allPositions[allPositions.length - 1]
        const lp = latLonToVec3(last.latitude, last.longitude, orbitAlt)
        marker.position.set(lp.x, lp.y, lp.z)
        if (prevPos) {
          const posVec = new THREE.Vector3(lp.x, lp.y, lp.z)
          const normal = posVec.clone().normalize()
          const velocity = posVec.clone().sub(prevPos)
          const radialComponent = normal.clone().multiplyScalar(velocity.dot(normal))
          const tangentVel = velocity.sub(radialComponent)
          if (tangentVel.length() > 0.0001) {
            tangentVel.normalize()
            const right = new THREE.Vector3().crossVectors(tangentVel, normal).normalize()
            const m = new THREE.Matrix4()
            m.makeBasis(right, tangentVel, normal)
            marker.quaternion.setFromRotationMatrix(m)
          }
        }
        prevPos = new THREE.Vector3(lp.x, lp.y, lp.z)
        group.visible = true
      }
    } catch (e) {
      console.warn('ISS backfill error:', e)
    }
  }

  async function startPolling() {
    try { await backfillTrail() } catch (e) { console.warn('ISS backfill failed:', e) }
    fetchPosition()
    polling = setInterval(fetchPosition, POLL_INTERVAL)
  }

  function stopPolling() {
    if (polling) {
      clearInterval(polling)
      polling = null
    }
  }

  group.visible = false // hidden until first position acquired

  return {
    group,
    markerMaterial: markerMat,
    trailMaterial: trailMat,
    startPolling,
    stopPolling,
  }
}
