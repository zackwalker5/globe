import * as THREE from 'three'

const MANIFEST_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const TILE_SIZE = 256
const ZOOM = 3
const GRID = 8 // 2^ZOOM
const CANVAS_SIZE = TILE_SIZE * GRID // 2048
const FRAME_INTERVAL = 500
const MANIFEST_REFRESH = 10 * 60 * 1000

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

// Generic weather overlay — works for radar or infrared satellite
function createWeatherOverlay(globeRadius, { radiusScale = 1.008, tileUrlSuffix = '/2/1_1.png' } = {}) {
  const displayCanvas = document.createElement('canvas')
  displayCanvas.width = CANVAS_SIZE
  displayCanvas.height = CANVAS_SIZE
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
    const offscreen = document.createElement('canvas')
    offscreen.width = CANVAS_SIZE
    offscreen.height = CANVAS_SIZE
    const ctx = offscreen.getContext('2d')
    let loaded = 0

    const promises = []
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const url = `${manifestHost}${frame.path}/${TILE_SIZE}/${ZOOM}/${x}/${y}${tileUrlSuffix}`
        promises.push(
          loadTileImage(url).then((img) => {
            if (img) {
              ctx.drawImage(img, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE)
              loaded++
            }
          })
        )
      }
    }
    await Promise.all(promises)
    return { canvas: offscreen, tileCount: loaded }
  }

  function showFrame(index) {
    if (!frameCanvases[index]) return
    displayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
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

  // setFrames is called externally after manifest fetch
  async function loadFrames(newFrames) {
    if (newFrames.length === 0) return
    frames = newFrames
    loading = true
    ready = false

    // Show the most recent frame immediately
    const lastResult = await prerenderFrame(frames[frames.length - 1])
    if (lastResult.tileCount > 0) {
      displayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
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
