import * as THREE from 'three'

const MANIFEST_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const TILE_SIZE = 256
const ZOOM = 3
const GRID = 8 // 2^ZOOM
const MERC_SIZE = TILE_SIZE * GRID // 2048 — Mercator tile grid
const EQ_WIDTH = 2048 // equirectangular output
const EQ_HEIGHT = 1024
const FRAME_INTERVAL = 500
const MANIFEST_REFRESH = 10 * 60 * 1000

// Mercator max latitude in radians (~85.05°)
const MERC_MAX_LAT = Math.atan(Math.sinh(Math.PI))

// Shared manifest — fetched once, used by both layers
let manifestCache = null
let manifestHost = ''
let manifestPromise = null

async function fetchSharedManifest() {
  if (manifestPromise) return manifestPromise
  manifestPromise = (async () => {
    try {
      const res = await fetch(MANIFEST_URL)
      if (!res.ok) return null
      const data = await res.json()
      manifestHost = data.host
      manifestCache = data
      return data
    } catch (e) {
      console.warn('RainViewer manifest fetch error:', e)
      return null
    } finally {
      manifestPromise = null
    }
  })()
  return manifestPromise
}

// Pre-compute equirectangular row → Mercator source row lookup table
function buildRowLUT(eqHeight, mercHeight) {
  const lut = new Float32Array(eqHeight)
  for (let y = 0; y < eqHeight; y++) {
    // Map output row to latitude: top = +90°, bottom = -90°
    const lat = (0.5 - y / eqHeight) * Math.PI // radians, +π/2 to -π/2

    // Clamp to Mercator range
    if (Math.abs(lat) >= MERC_MAX_LAT) {
      lut[y] = -1 // outside Mercator coverage
      continue
    }

    // Latitude to Mercator normalized y (0 at top/north, 1 at bottom/south)
    const mercY = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2
    lut[y] = mercY * mercHeight
  }
  return lut
}

const rowLUT = buildRowLUT(EQ_HEIGHT, MERC_SIZE)

// Re-project a Mercator canvas to equirectangular
function reprojectToEquirect(mercCanvas) {
  const eq = document.createElement('canvas')
  eq.width = EQ_WIDTH
  eq.height = EQ_HEIGHT
  const eqCtx = eq.getContext('2d')
  const mercCtx = mercCanvas.getContext('2d')

  // x maps linearly (both are 0-360° longitude), just scale
  const xScale = MERC_SIZE / EQ_WIDTH

  for (let y = 0; y < EQ_HEIGHT; y++) {
    const srcY = rowLUT[y]
    if (srcY < 0 || srcY >= MERC_SIZE - 1) continue

    const srcYFloor = Math.floor(srcY)
    // Draw a 1px-high strip from the Mercator source row
    eqCtx.drawImage(
      mercCanvas,
      0, srcYFloor, MERC_SIZE, 1, // source: full width, 1px row
      0, y, EQ_WIDTH, 1           // dest: full width, 1px row
    )
  }

  return eq
}

// Generic weather overlay — works for radar or infrared satellite
function createWeatherOverlay(globeRadius, { radiusScale = 1.008, tileUrlSuffix = '/2/1_1.png' } = {}) {
  const displayCanvas = document.createElement('canvas')
  displayCanvas.width = EQ_WIDTH
  displayCanvas.height = EQ_HEIGHT
  const displayCtx = displayCanvas.getContext('2d')

  const texture = new THREE.CanvasTexture(displayCanvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter

  const geo = new THREE.SphereGeometry(globeRadius * radiusScale, 128, 64)
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.FrontSide,
  })
  const mesh = new THREE.Mesh(geo, mat)

  let frames = []
  let frameCanvases = []
  let frameIndex = 0
  let animInterval = null
  let loading = false
  let ready = false

  function loadTileImage(url) {
    return new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = url
    })
  }

  async function prerenderFrame(frame) {
    // 1. Draw tiles to Mercator canvas
    const mercCanvas = document.createElement('canvas')
    mercCanvas.width = MERC_SIZE
    mercCanvas.height = MERC_SIZE
    const mercCtx = mercCanvas.getContext('2d')
    let loaded = 0

    const promises = []
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const url = `${manifestHost}${frame.path}/${TILE_SIZE}/${ZOOM}/${x}/${y}${tileUrlSuffix}`
        promises.push(
          loadTileImage(url).then((img) => {
            if (img) {
              mercCtx.drawImage(img, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE)
              loaded++
            }
          })
        )
      }
    }
    await Promise.all(promises)

    if (loaded === 0) return { canvas: null, tileCount: 0 }

    // 2. Re-project from Mercator to equirectangular
    const eqCanvas = reprojectToEquirect(mercCanvas)
    return { canvas: eqCanvas, tileCount: loaded }
  }

  function showFrame(index) {
    if (!frameCanvases[index]) return
    displayCtx.clearRect(0, 0, EQ_WIDTH, EQ_HEIGHT)
    displayCtx.drawImage(frameCanvases[index], 0, 0)
    texture.needsUpdate = true
  }

  async function prefetchAllFrames() {
    const BATCH = 4
    const results = []
    for (let i = 0; i < frames.length; i += BATCH) {
      const batch = frames.slice(i, i + BATCH)
      const batchResults = await Promise.all(batch.map((f) => prerenderFrame(f)))
      results.push(...batchResults)
    }
    frameCanvases = results.filter((r) => r.tileCount > 0).map((r) => r.canvas)
  }

  function startAnimation() {
    if (animInterval) return
    animInterval = setInterval(() => {
      if (!ready || frameCanvases.length === 0) return
      frameIndex = (frameIndex + 1) % frameCanvases.length
      showFrame(frameIndex)
    }, FRAME_INTERVAL)
  }

  function stopAnimation() {
    if (animInterval) {
      clearInterval(animInterval)
      animInterval = null
    }
  }

  async function loadFrames(newFrames) {
    if (newFrames.length === 0) return
    frames = newFrames
    loading = true
    ready = false

    // Show the most recent frame immediately
    const lastResult = await prerenderFrame(frames[frames.length - 1])
    if (lastResult.tileCount > 0) {
      displayCtx.clearRect(0, 0, EQ_WIDTH, EQ_HEIGHT)
      displayCtx.drawImage(lastResult.canvas, 0, 0)
      texture.needsUpdate = true
    }

    await prefetchAllFrames()
    frameIndex = frameCanvases.length - 1
    ready = true
    loading = false
  }

  return {
    mesh,
    material: mat,
    loadFrames,
    startAnimation,
    stopAnimation,
    isLoading: () => loading,
  }
}

export function createRadarOverlay(globeRadius) {
  const overlay = createWeatherOverlay(globeRadius, { radiusScale: 1.008, tileUrlSuffix: '/2/1_1.png' })

  async function init() {
    const data = await fetchSharedManifest()
    if (!data) return
    const frames = data.radar?.past || []
    await overlay.loadFrames(frames)
    console.log(`Radar: ${frames.length} frames`)
    overlay.startAnimation()

    setInterval(async () => {
      const refreshed = await fetchSharedManifest()
      if (refreshed) {
        const newFrames = refreshed.radar?.past || []
        await overlay.loadFrames(newFrames)
      }
    }, MANIFEST_REFRESH)
  }

  return { ...overlay, init }
}

export function createInfraredOverlay(globeRadius) {
  const overlay = createWeatherOverlay(globeRadius, { radiusScale: 1.006, tileUrlSuffix: '/0/0_0.png' })

  async function init() {
    const data = await fetchSharedManifest()
    if (!data) return
    const frames = data.satellite?.infrared || []
    await overlay.loadFrames(frames)
    console.log(`Infrared: ${frames.length} frames`)
    overlay.startAnimation()

    setInterval(async () => {
      const refreshed = await fetchSharedManifest()
      if (refreshed) {
        const newFrames = refreshed.satellite?.infrared || []
        await overlay.loadFrames(newFrames)
      }
    }, MANIFEST_REFRESH)
  }

  return { ...overlay, init }
}
