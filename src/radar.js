import * as THREE from 'three'

const MANIFEST_URL = 'https://api.rainviewer.com/public/weather-maps.json'
const TILE_SIZE = 256
const FRAME_INTERVAL = 500
const MANIFEST_REFRESH = 10 * 60 * 1000

// Zoom tiers: camera distance → tile zoom level + output resolution
const ZOOM_TIERS = [
  { maxDist: 5,  zoom: 5, eqW: 4096, eqH: 2048 },  // very close
  { maxDist: 8,  zoom: 4, eqW: 4096, eqH: 2048 },   // close
  { maxDist: 14, zoom: 3, eqW: 2048, eqH: 1024 },   // mid
  { maxDist: Infinity, zoom: 2, eqW: 1024, eqH: 512 }, // far
]
// Limit frames at high zoom to keep tile count sane
// zoom 4: 256 tiles/frame, zoom 5: 1024 tiles/frame
const MAX_FRAMES_BY_ZOOM = { 5: 2, 4: 3 }

const MERC_MAX_LAT = Math.atan(Math.sinh(Math.PI))

// Shared manifest
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

// Build row LUT for a given eq height and merc height
const rowLUTCache = {}
function getRowLUT(eqH, mercH) {
  const key = `${eqH}_${mercH}`
  if (rowLUTCache[key]) return rowLUTCache[key]
  const lut = new Float32Array(eqH)
  for (let y = 0; y < eqH; y++) {
    const lat = (0.5 - y / eqH) * Math.PI
    if (Math.abs(lat) >= MERC_MAX_LAT) {
      lut[y] = -1
      continue
    }
    const mercY = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2
    lut[y] = mercY * mercH
  }
  rowLUTCache[key] = lut
  return lut
}

function reprojectToEquirect(mercCanvas, mercSize, eqW, eqH) {
  const eq = document.createElement('canvas')
  eq.width = eqW
  eq.height = eqH
  const eqCtx = eq.getContext('2d')
  const lut = getRowLUT(eqH, mercSize)

  for (let y = 0; y < eqH; y++) {
    const srcY = lut[y]
    if (srcY < 0 || srcY >= mercSize - 1) continue
    eqCtx.drawImage(
      mercCanvas,
      0, Math.floor(srcY), mercSize, 1,
      0, y, eqW, 1
    )
  }
  return eq
}

function createWeatherOverlay(globeRadius, { radiusScale = 1.008, tileUrlSuffix = '/2/1_1.png' } = {}) {
  // Start with mid-tier canvas size
  let eqW = 2048
  let eqH = 1024

  const displayCanvas = document.createElement('canvas')
  displayCanvas.width = eqW
  displayCanvas.height = eqH
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

  let allFrames = []
  let frameCanvases = []
  let frameIndex = 0
  let animInterval = null
  let loading = false
  let ready = false
  let currentZoom = 3
  let rebuilding = false

  function resizeCanvas(newW, newH) {
    if (displayCanvas.width === newW && displayCanvas.height === newH) return
    displayCanvas.width = newW
    displayCanvas.height = newH
    eqW = newW
    eqH = newH
    texture.needsUpdate = true
  }

  function loadTileImage(url) {
    return new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = url
    })
  }

  async function prerenderFrame(frame, zoom, outW, outH) {
    const grid = Math.pow(2, zoom)
    const mercSize = TILE_SIZE * grid
    const mercCanvas = document.createElement('canvas')
    mercCanvas.width = mercSize
    mercCanvas.height = mercSize
    const mercCtx = mercCanvas.getContext('2d')
    let loaded = 0

    const promises = []
    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++) {
        const url = `${manifestHost}${frame.path}/${TILE_SIZE}/${zoom}/${x}/${y}${tileUrlSuffix}`
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
    const eqCanvas = reprojectToEquirect(mercCanvas, mercSize, outW, outH)
    return { canvas: eqCanvas, tileCount: loaded }
  }

  function showFrame(index) {
    if (!frameCanvases[index]) return
    displayCtx.clearRect(0, 0, eqW, eqH)
    displayCtx.drawImage(frameCanvases[index], 0, 0)
    texture.needsUpdate = true
  }

  async function buildCache(zoom, frames) {
    const tier = ZOOM_TIERS.find((t) => t.zoom === zoom) || ZOOM_TIERS[2]
    const maxFrames = MAX_FRAMES_BY_ZOOM[zoom]
    const useFrames = maxFrames ? frames.slice(-maxFrames) : frames
    const BATCH = zoom >= 5 ? 1 : zoom >= 4 ? 2 : 4
    const results = []
    for (let i = 0; i < useFrames.length; i += BATCH) {
      const batch = useFrames.slice(i, i + BATCH)
      const batchResults = await Promise.all(
        batch.map((f) => prerenderFrame(f, zoom, tier.eqW, tier.eqH))
      )
      results.push(...batchResults)
    }
    return {
      canvases: results.filter((r) => r.tileCount > 0).map((r) => r.canvas),
      eqW: tier.eqW,
      eqH: tier.eqH,
    }
  }

  function startAnimation() {
    if (animInterval) return
    animInterval = setInterval(() => {
      if (frameCanvases.length === 0) return
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
    allFrames = newFrames
    loading = true

    const tier = ZOOM_TIERS.find((t) => t.zoom === currentZoom) || ZOOM_TIERS[2]

    // If no frames cached yet, show most recent immediately
    if (frameCanvases.length === 0) {
      resizeCanvas(tier.eqW, tier.eqH)
      const lastResult = await prerenderFrame(allFrames[allFrames.length - 1], currentZoom, tier.eqW, tier.eqH)
      if (lastResult.tileCount > 0) {
        displayCtx.clearRect(0, 0, eqW, eqH)
        displayCtx.drawImage(lastResult.canvas, 0, 0)
        texture.needsUpdate = true
      }
    }

    const result = await buildCache(currentZoom, allFrames)
    if (result.canvases.length > 0) {
      resizeCanvas(result.eqW, result.eqH)
      frameCanvases = result.canvases
      frameIndex = frameCanvases.length - 1
    }
    ready = true
    loading = false
  }

  async function setZoomForDistance(camDist) {
    let targetZoom = ZOOM_TIERS[ZOOM_TIERS.length - 1].zoom
    for (const tier of ZOOM_TIERS) {
      if (camDist <= tier.maxDist) {
        targetZoom = tier.zoom
        break
      }
    }

    if (targetZoom === currentZoom || rebuilding || allFrames.length === 0) return
    currentZoom = targetZoom
    rebuilding = true
    console.log(`Weather: switching to zoom ${currentZoom}`)

    try {
      // Build new cache in background — old frames keep animating
      const result = await buildCache(currentZoom, allFrames)
      if (result.canvases.length > 0) {
        resizeCanvas(result.eqW, result.eqH)
        frameCanvases = result.canvases
        frameIndex = frameCanvases.length - 1
        showFrame(frameIndex)
      }
    } catch (e) {
      console.warn('Weather zoom switch error:', e)
    }
    rebuilding = false
  }

  return {
    mesh,
    material: mat,
    loadFrames,
    startAnimation,
    stopAnimation,
    setZoomForDistance,
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
