import * as THREE from 'three'
import * as satellite from 'satellite.js'

const CELESTRAK_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json'

// Convert GP JSON record to a satellite.js satrec
function gpToSatrec(gp) {
  // satellite.js needs TLE-style inputs via twoline2satrec or direct satrec init
  // We'll use the OMM (Orbit Mean-elements Message) approach
  const satrec = satellite.twoline2satrec(
    buildTleLine1(gp),
    buildTleLine2(gp)
  )
  return satrec
}

// Reconstruct TLE line 1 from GP JSON
function buildTleLine1(gp) {
  const noradId = String(gp.NORAD_CAT_ID).padStart(5, '0')
  const classification = gp.CLASSIFICATION_TYPE || 'U'
  const intlDesig = formatIntlDesig(gp.OBJECT_ID)
  const epoch = formatEpoch(gp.EPOCH)
  const ndot = formatNdot(gp.MEAN_MOTION_DOT)
  const nddot = formatNddot(gp.MEAN_MOTION_DDOT)
  const bstar = formatBstar(gp.BSTAR)
  const ephType = gp.EPHEMERIS_TYPE || 0
  const elsetNo = String(gp.ELEMENT_SET_NO || 999).padStart(4, ' ')

  const line = `1 ${noradId}${classification} ${intlDesig} ${epoch} ${ndot} ${nddot} ${bstar} ${ephType} ${elsetNo}`
  return addChecksum(line.padEnd(68, ' '))
}

// Reconstruct TLE line 2 from GP JSON
function buildTleLine2(gp) {
  const noradId = String(gp.NORAD_CAT_ID).padStart(5, '0')
  const inc = gp.INCLINATION.toFixed(4).padStart(8, ' ')
  const raan = gp.RA_OF_ASC_NODE.toFixed(4).padStart(8, ' ')
  const ecc = gp.ECCENTRICITY.toFixed(7).slice(2) // remove "0."
  const argp = gp.ARG_OF_PERICENTER.toFixed(4).padStart(8, ' ')
  const ma = gp.MEAN_ANOMALY.toFixed(4).padStart(8, ' ')
  const mm = gp.MEAN_MOTION.toFixed(8).padStart(11, ' ')
  const revnum = String(gp.REV_AT_EPOCH || 0).padStart(5, ' ')

  const line = `2 ${noradId} ${inc} ${raan} ${ecc} ${argp} ${ma} ${mm}${revnum}`
  return addChecksum(line.padEnd(68, ' '))
}

function formatIntlDesig(objectId) {
  if (!objectId) return '00000A  '
  // "2019-074B" -> "19074B  "
  const parts = objectId.split('-')
  if (parts.length < 2) return '00000A  '
  const year = parts[0].slice(2)
  const launch = parts[1].replace(/[^0-9A-Z]/gi, '')
  return (year + launch).padEnd(8, ' ')
}

function formatEpoch(epochStr) {
  const d = new Date(epochStr)
  const year = d.getUTCFullYear() % 100
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const dayOfYear = (d - start) / 86400000 + 1
  return String(year).padStart(2, '0') + dayOfYear.toFixed(8).padStart(12, '0')
}

function formatNdot(val) {
  if (!val) return ' .00000000'
  const sign = val >= 0 ? ' ' : '-'
  return sign + Math.abs(val).toFixed(8).replace(/^0/, '')
}

function formatNddot(val) {
  if (!val || val === 0) return ' 00000-0'
  const sign = val >= 0 ? ' ' : '-'
  const exp = Math.floor(Math.log10(Math.abs(val)))
  const mantissa = Math.abs(val) / Math.pow(10, exp)
  return sign + Math.round(mantissa * 100000).toString().padStart(5, '0') + (exp >= 0 ? '+' : '-') + Math.abs(exp)
}

function formatBstar(val) {
  if (!val || val === 0) return ' 00000-0'
  const sign = val >= 0 ? ' ' : '-'
  const exp = Math.floor(Math.log10(Math.abs(val)))
  const mantissa = Math.abs(val) / Math.pow(10, exp)
  return sign + Math.round(mantissa * 100000).toString().padStart(5, '0') + (exp >= 0 ? '+' : '-') + Math.abs(exp)
}

function addChecksum(line) {
  let sum = 0
  for (let i = 0; i < 68; i++) {
    const c = line[i]
    if (c >= '0' && c <= '9') sum += parseInt(c)
    else if (c === '-') sum += 1
  }
  return line.slice(0, 68) + (sum % 10)
}

// Propagate a satrec to a given Date, return ECI position in km
function propagate(satrec, date) {
  const positionAndVelocity = satellite.propagate(satrec, date)
  if (!positionAndVelocity.position) return null
  return positionAndVelocity.position // { x, y, z } in km
}

// Convert ECI position to lat/lon/alt
function eciToGeodetic(positionEci, date) {
  const gmst = satellite.gstime(date)
  const geo = satellite.eciToGeodetic(positionEci, gmst)
  return {
    lat: satellite.degreesLat(geo.latitude),
    lon: satellite.degreesLong(geo.longitude),
    alt: geo.height, // km
  }
}

export async function fetchStarlinkPositions() {
  console.log('Fetching Starlink orbital elements...')

  try {
    const res = await fetch(CELESTRAK_URL)
    if (!res.ok) {
      console.warn(`Celestrak API ${res.status}`)
      return { satrecs: [], positions: [] }
    }

    const gpData = await res.json()
    const now = new Date()
    const satrecs = []
    const positions = []

    for (const gp of gpData) {
      try {
        const satrec = gpToSatrec(gp)
        const posEci = propagate(satrec, now)
        if (!posEci) continue

        const geo = eciToGeodetic(posEci, now)
        if (isNaN(geo.lat) || isNaN(geo.lon)) continue

        satrecs.push(satrec)
        positions.push({ lat: geo.lat, lon: geo.lon, alt: geo.alt })
      } catch {
        // skip bad records
      }
    }

    console.log(`Propagated ${positions.length}/${gpData.length} Starlink satellites`)
    return { satrecs, positions }
  } catch (e) {
    console.warn('Celestrak fetch error:', e)
    return { satrecs: [], positions: [] }
  }
}

// Update positions in-place for animation
export function updatePositions(satrecs, date) {
  const positions = []
  for (const satrec of satrecs) {
    try {
      const posEci = propagate(satrec, date)
      if (!posEci) { positions.push(null); continue }
      const geo = eciToGeodetic(posEci, date)
      if (isNaN(geo.lat) || isNaN(geo.lon)) { positions.push(null); continue }
      positions.push({ lat: geo.lat, lon: geo.lon, alt: geo.alt })
    } catch {
      positions.push(null)
    }
  }
  return positions
}

// Convert lat/lon/alt to 3D position on globe
function satToVec3(lat, lon, alt, globeRadius) {
  // Map real altitude to visual height above globe
  // Starlink orbits at ~550km, Earth radius ~6371km
  // Scale: 550/6371 = 0.086 of globe radius
  const visualAlt = globeRadius * (1.0 + (alt / 6371) * 0.8)
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lon + 180) * (Math.PI / 180)
  return {
    x: -visualAlt * Math.sin(phi) * Math.cos(theta),
    y: visualAlt * Math.cos(phi),
    z: visualAlt * Math.sin(phi) * Math.sin(theta),
  }
}

export function createSatelliteCloud(globeRadius, positions) {
  const count = positions.length

  const posArr = new Float32Array(count * 3)
  const sizes = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const p = positions[i]
    const v = satToVec3(p.lat, p.lon, p.alt, globeRadius)
    posArr[i * 3] = v.x
    posArr[i * 3 + 1] = v.y
    posArr[i * 3 + 2] = v.z
    sizes[i] = 0.3 + Math.random() * 0.2
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3))
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uColor1: { value: new THREE.Color(0xffffff) },
      uColor2: { value: new THREE.Color(0xffffff) },
      uBrightness: { value: 1.0 },
      uSize: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uSize;

      attribute float aSize;

      varying float vColorMix;
      varying float vAlpha;

      void main() {
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPos;
        gl_PointSize = max(aSize * uSize * uPixelRatio * (150.0 / -mvPos.z), 1.0);

        // Vary color by position
        vColorMix = sin(position.x * 2.0 + position.z * 3.0) * 0.5 + 0.5;

        // Subtle twinkle
        float twinkle = sin(uTime * 2.0 + position.x * 50.0 + position.y * 30.0) * 0.15 + 0.85;
        vAlpha = twinkle * 0.7;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      uniform float uBrightness;

      varying float vColorMix;
      varying float vAlpha;

      void main() {
        vec3 color = mix(uColor1, uColor2, vColorMix);
        gl_FragColor = vec4(color * uBrightness, vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geo, mat)

  // Update positions from new geodetic data
  function setPositions(newPositions, gRadius) {
    const arr = points.geometry.attributes.position.array
    for (let i = 0; i < newPositions.length && i < count; i++) {
      const p = newPositions[i]
      if (!p) continue
      const v = satToVec3(p.lat, p.lon, p.alt, gRadius)
      arr[i * 3] = v.x
      arr[i * 3 + 1] = v.y
      arr[i * 3 + 2] = v.z
    }
    points.geometry.attributes.position.needsUpdate = true
  }

  return { points, material: mat, setPositions }
}
