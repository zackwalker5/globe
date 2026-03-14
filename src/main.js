import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import GUI from 'lil-gui'

import { createGlobe } from './globe.js'
import { createEruptions, createHotspots, createPulseRings } from './particles.js'
import { createStarfield, createNebula } from './background.js'
import { trafficPoints } from './data.js'
import { createCoastlines } from './coastlines.js'
import { fetchStormData, getFallbackStorms } from './weather.js'
import { fetchEONETEvents } from './eonet.js'
import { createUserMarker } from './userlocation.js'
import { createISS } from './iss.js'
import { fetchEarthquakes } from './earthquakes.js'
import { createQuakeLayer } from './quakevis.js'
import { fetchStarlinkPositions, updatePositions, createSatelliteCloud } from './satellites.js'

// --- Setup ---
const GLOBE_RADIUS = 3

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200)
camera.position.set(0, 2, 9)

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
})
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setClearColor(0x050010)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.8
document.body.appendChild(renderer.domElement)

// --- Post-processing (bloom) ---
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.4,   // strength
  0.3,   // radius
  0.6    // threshold
)
composer.addPass(bloomPass)

// --- Controls ---
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.05
controls.rotateSpeed = 0.5
controls.zoomSpeed = 0.8
controls.minDistance = 5
controls.maxDistance = 20
controls.enablePan = false
controls.autoRotate = false
controls.autoRotateSpeed = 0.3

// --- Scene objects ---

// Background
const starfield = createStarfield(2000)
scene.add(starfield.points)

const nebula = createNebula()
scene.add(nebula)

// Globe
const { group: globeGroup, globe, atmosphere, gridSphere } = createGlobe(GLOBE_RADIUS)
atmosphere.scale.setScalar(0.88)
scene.add(globeGroup)

// Coastlines
createCoastlines(GLOBE_RADIUS).then((coastlines) => {
  globeGroup.add(coastlines)
  // Add to dev controls
  const { fillMaterial, outlineGroup, fillGroup } = coastlines.userData
  const coastFolder = gui.addFolder('Coastlines')
  coastFolder.add(coastlines, 'visible').name('Visible')

  // Outline controls
  const outlineOpacity = { value: 0.35 }
  coastFolder.add(outlineOpacity, 'value', 0, 1, 0.01).name('Outline Opacity').onChange((v) => {
    outlineGroup.traverse((child) => {
      if (child.material) child.material.opacity = v
    })
  })
  const outlineColor = { value: '#8c64ff' }
  coastFolder.addColor(outlineColor, 'value').name('Outline Color').onChange((hex) => {
    outlineGroup.traverse((child) => {
      if (child.material) child.material.color.set(hex)
    })
  })

  // Fill controls
  coastFolder.add(fillGroup, 'visible').name('Fill Visible')
  const fillColor = { value: '#2a1550' }
  coastFolder.addColor(fillColor, 'value').name('Fill Color').onChange((hex) => {
    fillMaterial.color.set(hex)
  })
  coastFolder.add(fillMaterial, 'opacity', 0, 1, 0.01).name('Fill Opacity')

  coastFolder.close()
})

// --- Emitter system (swappable data source) ---
let hotspots = createHotspots(trafficPoints, GLOBE_RADIUS)
globeGroup.add(hotspots.points)

let eruptions = createEruptions(trafficPoints, GLOBE_RADIUS)
globeGroup.add(eruptions.points)

let pulseRings = createPulseRings(trafficPoints, GLOBE_RADIUS)
globeGroup.add(pulseRings.group)

// --- Data info UI ---
const infoSource = document.getElementById('info-source')
const infoCount = document.getElementById('info-count')
const infoTimestamp = document.getElementById('info-timestamp')

function updateDataInfo(source, count, timestamp) {
  infoSource.textContent = source
  infoCount.textContent = `${count} ${count === 1 ? 'event' : 'events'}`
  if (timestamp) {
    infoTimestamp.textContent = `Updated ${timestamp}`
  } else {
    infoTimestamp.textContent = ''
  }
}

function formatTimestamp() {
  const now = new Date()
  return now.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: true,
  })
}

updateDataInfo('NASA EONET', '...', 'Fetching')

// Starlink satellite cloud (replaces ambient particle cloud)
let satCloud = null
let satSatrecs = []
const SAT_UPDATE_INTERVAL = 10000 // update orbital positions every 10s
let lastSatUpdate = 0

fetchStarlinkPositions().then(({ satrecs, positions }) => {
  if (positions.length === 0) return
  satSatrecs = satrecs
  satCloud = createSatelliteCloud(GLOBE_RADIUS, positions)
  scene.add(satCloud.points)
  timedMaterials.push(satCloud.material)
  console.log(`Starlink cloud: ${positions.length} satellites`)
})

// Swap emitter data source
function setEmitterData(points) {
  // Remove old
  globeGroup.remove(hotspots.points)
  globeGroup.remove(eruptions.points)
  hotspots.points.geometry.dispose()
  hotspots.material.dispose()
  eruptions.points.geometry.dispose()
  eruptions.material.dispose()

  // Remove old pulse rings
  pulseRings.group.traverse((child) => {
    if (child.geometry) child.geometry.dispose()
  })
  pulseRings.material.dispose()
  globeGroup.remove(pulseRings.group)

  // Create new
  hotspots = createHotspots(points, GLOBE_RADIUS)
  eruptions = createEruptions(points, GLOBE_RADIUS)
  pulseRings = createPulseRings(points, GLOBE_RADIUS)
  globeGroup.add(hotspots.points)
  globeGroup.add(eruptions.points)
  globeGroup.add(pulseRings.group)

  // Apply proxy state values to new materials
  eruptions.material.uniforms.uColor1.value.set(eruptState.color1)
  eruptions.material.uniforms.uColor2.value.set(eruptState.color2)
  eruptions.material.uniforms.uColor3.value.set(eruptState.color3)
  eruptions.material.uniforms.uColor4.value.set(eruptState.color4)
  eruptions.material.uniforms.uScale.value = eruptState.spread
  eruptions.material.uniforms.uPointScale.value = eruptState.pointSize
  eruptions.points.visible = eruptState.visible

  hotspots.material.uniforms.uColor.value.set(hotspotState.color)
  hotspots.points.visible = hotspotState.visible

  pulseRings.material.uniforms.uColor.value.set(ringsState.color)
  pulseRings.material.uniforms.uMaxRadius.value = ringsState.maxRadius
  pulseRings.material.uniforms.uSpeed.value = ringsState.speed
  pulseRings.material.uniforms.uOpacity.value = ringsState.opacity
  pulseRings.group.visible = ringsState.visible

  // Update timed materials list
  timedMaterials.length = 0
  timedMaterials.push(starfield.material, eruptions.material, hotspots.material, pulseRings.material, userMarker.material)
  if (satCloud) timedMaterials.push(satCloud.material)
  nebulaMaterials.forEach((m) => timedMaterials.push(m))
}

// --- Track all shader materials for time uniform ---
const timedMaterials = [
  starfield.material,
  eruptions.material,
  hotspots.material,
  pulseRings.material,
]

// Nebula cloud materials
const nebulaMaterials = []
nebula.traverse((child) => {
  if (child.userData.nebulaMat) {
    timedMaterials.push(child.userData.nebulaMat)
    nebulaMaterials.push(child.userData.nebulaMat)
  }
})

// User location marker
const userMarker = createUserMarker(GLOBE_RADIUS)
globeGroup.add(userMarker.group)
timedMaterials.push(userMarker.material)

// Default to Oklahoma, then update with real location if available
userMarker.setLocation(35.5, -97.5)

if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userMarker.setLocation(pos.coords.latitude, pos.coords.longitude)
      console.log(`User location: ${pos.coords.latitude}, ${pos.coords.longitude}`)
    },
    (err) => console.warn('Geolocation denied, using default:', err.message),
    { enableHighAccuracy: false, timeout: 10000 }
  )
}

// ISS tracker
const iss = createISS(GLOBE_RADIUS)
globeGroup.add(iss.group)
timedMaterials.push(iss.markerMaterial)
iss.startPolling()

// --- Dev Controls (lil-gui) ---
const gui = new GUI({ title: 'Dev Controls', width: 320 })

// Helper to bind a color uniform to gui
function guiColor(folder, mat, uniformName, label) {
  const obj = { [label]: '#' + mat.uniforms[uniformName].value.getHexString() }
  folder.addColor(obj, label).onChange((hex) => {
    mat.uniforms[uniformName].value.set(hex)
  })
}

// -- Bloom --
const bloomFolder = gui.addFolder('Bloom')
bloomFolder.add(bloomPass, 'strength', 0, 5, 0.01).name('Strength')
bloomFolder.add(bloomPass, 'radius', 0, 2, 0.01).name('Radius')
bloomFolder.add(bloomPass, 'threshold', 0, 1, 0.01).name('Threshold')
bloomFolder.add(renderer, 'toneMappingExposure', 0.1, 5, 0.05).name('Exposure')

// -- Globe Surface --
const globeFolder = gui.addFolder('Globe')
guiColor(globeFolder, globe.material, 'uColor', 'Base Color')
globeFolder.add(globe.material.uniforms.uTextureStrength, 'value', 0, 1, 0.01).name('Albedo Opacity')
globeFolder.add(globe.material.uniforms.uBumpStrength, 'value', 0, 0.2, 0.005).name('Bump Opacity')
globeFolder.add(globe.material.uniforms.uNightStrength, 'value', 0, 2, 0.01).name('Night Lights Opacity')
globeFolder.add(globe.material.uniforms.uOceanStrength, 'value', 0, 1, 0.01).name('Ocean Opacity')
globeFolder.add(globe.material.uniforms.uTerminatorSharpness, 'value', 1, 30, 0.5).name('Terminator Sharpness')

// -- Grid (separate sphere) --
const gridFolder = gui.addFolder('Grid')
const gridMat = gridSphere.material
gridFolder.add(gridSphere, 'visible').name('Visible')
guiColor(gridFolder, gridMat, 'uGridColor', 'Color')
gridFolder.add(gridMat.uniforms.uGridOpacity, 'value', 0, 1, 0.01).name('Opacity')
gridFolder.add(gridMat.uniforms.uLatSpacing, 'value', 5, 45, 1).name('Lat Spacing (deg)')
gridFolder.add(gridMat.uniforms.uLonSpacing, 'value', 5, 45, 1).name('Lon Spacing (deg)')
gridFolder.add(gridMat.uniforms.uLineWidth, 'value', 0.001, 0.02, 0.001).name('Line Width')
const gridElevation = { value: 1.006 }
gridFolder.add(gridElevation, 'value', 1.0, 1.5, 0.001).name('Elevation').onChange((v) => {
  gridSphere.scale.setScalar(v)
})

// -- Atmosphere --
const atmosFolder = gui.addFolder('Atmosphere')
const atmosMat = atmosphere.material
guiColor(atmosFolder, atmosMat, 'uColor1', 'Inner Color')
guiColor(atmosFolder, atmosMat, 'uColor2', 'Outer Color')
atmosFolder.add(atmosMat.uniforms.uIntensity, 'value', 0, 2, 0.01).name('Intensity')
atmosFolder.add(atmosphere.scale, 'x', 0.8, 1.5, 0.01).name('Scale').onChange((v) => {
  atmosphere.scale.set(v, v, v)
})

// -- Satellites (Starlink) --
const satFolder = gui.addFolder('Satellites')
const satState = {
  color1: '#ffffff',
  color2: '#ffffff',
  brightness: 1.0,
  size: 0.2,
  visible: true,
}
satFolder.addColor(satState, 'color1').name('Color 1').onChange((v) => { if (satCloud) satCloud.material.uniforms.uColor1.value.set(v) })
satFolder.addColor(satState, 'color2').name('Color 2').onChange((v) => { if (satCloud) satCloud.material.uniforms.uColor2.value.set(v) })
satFolder.add(satState, 'brightness', 0, 3, 0.05).name('Brightness').onChange((v) => { if (satCloud) satCloud.material.uniforms.uBrightness.value = v })
satFolder.add(satState, 'size', 0.1, 5.0, 0.1).name('Size').onChange((v) => { if (satCloud) satCloud.material.uniforms.uSize.value = v })
satFolder.add(satState, 'visible').name('Visible').onChange((v) => { if (satCloud) satCloud.points.visible = v })

// -- Events (use proxy values — materials get recreated on data swap) --
const eruptFolder = gui.addFolder('Events')
const eruptState = {
  color1: '#' + eruptions.material.uniforms.uColor1.value.getHexString(),
  color2: '#' + eruptions.material.uniforms.uColor2.value.getHexString(),
  color3: '#' + eruptions.material.uniforms.uColor3.value.getHexString(),
  color4: '#' + eruptions.material.uniforms.uColor4.value.getHexString(),
  spread: eruptions.material.uniforms.uScale.value,
  pointSize: eruptions.material.uniforms.uPointScale.value,
  visible: true,
}
eruptFolder.addColor(eruptState, 'color1').name('Severe (Red)').onChange((v) => eruptions.material.uniforms.uColor1.value.set(v))
eruptFolder.addColor(eruptState, 'color2').name('Heavy (Yellow)').onChange((v) => eruptions.material.uniforms.uColor2.value.set(v))
eruptFolder.addColor(eruptState, 'color3').name('Moderate (Green)').onChange((v) => eruptions.material.uniforms.uColor3.value.set(v))
eruptFolder.addColor(eruptState, 'color4').name('Light (Blue)').onChange((v) => eruptions.material.uniforms.uColor4.value.set(v))
eruptFolder.add(eruptState, 'spread', 0.01, 0.5, 0.005).name('Spread').onChange((v) => eruptions.material.uniforms.uScale.value = v)
eruptFolder.add(eruptState, 'pointSize', 0.001, 0.05, 0.001).name('Point Size').onChange((v) => eruptions.material.uniforms.uPointScale.value = v)
eruptFolder.add(eruptState, 'visible').name('Visible').onChange((v) => eruptions.points.visible = v)

// -- Hotspots --
const hotspotFolder = gui.addFolder('Hotspots')
const hotspotState = {
  color: '#' + hotspots.material.uniforms.uColor.value.getHexString(),
  visible: false,
}
hotspots.points.visible = false
hotspotFolder.addColor(hotspotState, 'color').name('Glow Color').onChange((v) => hotspots.material.uniforms.uColor.value.set(v))
hotspotFolder.add(hotspotState, 'visible').name('Visible').onChange((v) => hotspots.points.visible = v)

// -- Pulse Rings --
const ringsFolder = gui.addFolder('Pulse Rings')
const ringsState = {
  color: '#' + pulseRings.material.uniforms.uColor.value.getHexString(),
  maxRadius: pulseRings.material.uniforms.uMaxRadius.value,
  speed: pulseRings.material.uniforms.uSpeed.value,
  opacity: pulseRings.material.uniforms.uOpacity.value,
  visible: true,
}
ringsFolder.addColor(ringsState, 'color').name('Color').onChange((v) => pulseRings.material.uniforms.uColor.value.set(v))
ringsFolder.add(ringsState, 'maxRadius', 0.1, 3.0, 0.05).name('Max Radius').onChange((v) => pulseRings.material.uniforms.uMaxRadius.value = v)
ringsFolder.add(ringsState, 'speed', 0.1, 2.0, 0.05).name('Speed').onChange((v) => pulseRings.material.uniforms.uSpeed.value = v)
ringsFolder.add(ringsState, 'opacity', 0, 1, 0.01).name('Opacity').onChange((v) => pulseRings.material.uniforms.uOpacity.value = v)
ringsFolder.add(ringsState, 'visible').name('Visible').onChange((v) => pulseRings.group.visible = v)

// -- Earthquakes (dedicated layer, proxy state) --
const quakeFolder = gui.addFolder('Earthquakes')
const quakeState = {
  markerColor: '#ffcc44',
  markerSize: 1.0,
  ringColor: '#ffcc44',
  maxRadius: 0.15,
  speed: 0.15,
  ringOpacity: 0.08,
  visible: true,
}
quakeFolder.addColor(quakeState, 'markerColor').name('Marker Color').onChange((v) => { if (quakeLayer) quakeLayer.markerMaterial.uniforms.uColor.value.set(v) })
quakeFolder.add(quakeState, 'markerSize', 0.2, 5.0, 0.1).name('Marker Size').onChange((v) => { if (quakeLayer) quakeLayer.markerMaterial.uniforms.uSize.value = v })
quakeFolder.addColor(quakeState, 'ringColor').name('Ring Color').onChange((v) => { if (quakeLayer) quakeLayer.ringMaterial.uniforms.uColor.value.set(v) })
quakeFolder.add(quakeState, 'maxRadius', 0.05, 1.0, 0.01).name('Ring Radius').onChange((v) => { if (quakeLayer) quakeLayer.ringMaterial.uniforms.uMaxRadius.value = v })
quakeFolder.add(quakeState, 'speed', 0.05, 1.0, 0.01).name('Ring Speed').onChange((v) => { if (quakeLayer) quakeLayer.ringMaterial.uniforms.uSpeed.value = v })
quakeFolder.add(quakeState, 'ringOpacity', 0, 0.5, 0.005).name('Ring Opacity').onChange((v) => { if (quakeLayer) quakeLayer.ringMaterial.uniforms.uOpacity.value = v })
quakeFolder.add(quakeState, 'visible').name('Visible').onChange((v) => { if (quakeLayer) quakeLayer.group.visible = v })

// -- User Location --
const userFolder = gui.addFolder('My Location')
guiColor(userFolder, userMarker.material, 'uColor', 'Color')
userFolder.add(userMarker.material.uniforms.uMaxRadius, 'value', 0.1, 2.0, 0.05).name('Max Radius')
userFolder.add(userMarker.material.uniforms.uSpeed, 'value', 0.1, 2.0, 0.05).name('Speed')
userFolder.add(userMarker.material.uniforms.uOpacity, 'value', 0, 1, 0.01).name('Opacity')
userFolder.add(userMarker.group, 'visible').name('Visible')

// -- ISS --
const issFolder = gui.addFolder('ISS Tracker')
guiColor(issFolder, iss.markerMaterial, 'uColor', 'Marker Color')
guiColor(issFolder, iss.trailMaterial, 'uColor', 'Trail Color')
issFolder.add(iss.markerMaterial.uniforms.uSize, 'value', 0.3, 5.0, 0.1).name('Marker Size')
issFolder.add(iss.trailMaterial.uniforms.uOpacity, 'value', 0, 1, 0.01).name('Trail Opacity')
issFolder.add(iss.group, 'visible').name('Visible')

// -- Starfield --
const starsFolder = gui.addFolder('Starfield')
starsFolder.add(starfield.points, 'visible').name('Visible')

// -- Nebula --
const nebulaFolder = gui.addFolder('Nebula')
nebulaFolder.add(nebula, 'visible').name('Visible')
if (nebulaMaterials.length > 0) {
  const nebulaOpacity = { value: 1.0 }
  nebulaFolder.add(nebulaOpacity, 'value', 0, 3, 0.01).name('Opacity Scale').onChange((v) => {
    for (const mat of nebulaMaterials) {
      mat.uniforms.uOpacity.value = mat.userData?.baseOpacity
        ? mat.userData.baseOpacity * v
        : v * 0.05
    }
  })
}

// -- Scene --
const sceneFolder = gui.addFolder('Scene')
const bgColor = { value: '#050010' }
sceneFolder.addColor(bgColor, 'value').name('Background').onChange((hex) => {
  renderer.setClearColor(hex)
})
const rotSpeed = { value: 0.005 }
sceneFolder.add(rotSpeed, 'value', 0, 0.3, 0.005).name('Globe Rotate Speed')
sceneFolder.add(controls, 'autoRotate').name('Auto Rotate (Orbit)')
sceneFolder.add(controls, 'autoRotateSpeed', 0, 2, 0.05).name('Orbit Rotate Speed')

// -- Data Sources (multi-select) --
const dataFolder = gui.addFolder('Data Sources')
const dataState = {
  status: 'Ready',
  totalPoints: 0,
}

// Cached data per source
const sourceCache = {
  eonet: [],
  earthquakes: [],
  storms: [],
  traffic: trafficPoints,
}

// Source toggle state
const sourceToggles = {
  eonet: true,
  earthquakes: false,
  storms: false,
  traffic: false,
}

// EONET category filters
const eonetFilters = {
  wildfires: true,
  severeStorms: true,
  volcanoes: true,
  earthquakes: true,
  floods: true,
  landslides: true,
  snow: true,
  dustHaze: true,
  drought: true,
  tempExtremes: true,
  seaLakeIce: true,
  waterColor: true,
  manmade: true,
}

function getFilteredEONET() {
  return sourceCache.eonet.filter((e) => eonetFilters[e.category] !== false)
}

function mergeAndApply() {
  const merged = []
  const activeSources = []

  if (sourceToggles.eonet) {
    const filtered = getFilteredEONET()
    merged.push(...filtered)
    activeSources.push(`EONET: ${filtered.length}`)
  }
  if (sourceToggles.earthquakes) {
    // Earthquakes render via dedicated quake layer, not emitters
    activeSources.push(`Quakes: ${sourceCache.earthquakes.length}`)
  }
  if (sourceToggles.storms) {
    merged.push(...sourceCache.storms)
    activeSources.push(`Storms: ${sourceCache.storms.length}`)
  }
  if (sourceToggles.traffic) {
    merged.push(...sourceCache.traffic)
    activeSources.push(`Traffic: ${sourceCache.traffic.length}`)
  }

  setEmitterData(merged)
  const quakeCount = sourceToggles.earthquakes ? sourceCache.earthquakes.length : 0
  dataState.totalPoints = merged.length + quakeCount
  dataState.status = activeSources.length > 0 ? activeSources.join(' + ') : 'No sources active'
  updateDataInfo(
    activeSources.length > 0 ? Object.entries(sourceToggles).filter(([,v]) => v).map(([k]) => {
      return { eonet: 'EONET', earthquakes: 'USGS', storms: 'Storms', traffic: 'Traffic' }[k]
    }).join(' + ') : 'None',
    merged.length,
    formatTimestamp()
  )
  statusCtrl.updateDisplay()
  countCtrl.updateDisplay()
}

// --- Source toggles ---
dataFolder.add(sourceToggles, 'eonet').name('NASA EONET').onChange(async (v) => {
  if (v && sourceCache.eonet.length === 0) {
    dataState.status = 'Fetching EONET...'
    statusCtrl.updateDisplay()
    sourceCache.eonet = await fetchEONETEvents()
    eonetFolder.show()
  }
  if (v) eonetFolder.show(); else eonetFolder.hide()
  mergeAndApply()
})

// --- Quake layer (dedicated visualization) ---
let quakeLayer = null

function rebuildQuakeLayer() {
  // Remove old layer
  if (quakeLayer) {
    quakeLayer.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose()
    })
    quakeLayer.markerMaterial.dispose()
    quakeLayer.ringMaterial.dispose()
    globeGroup.remove(quakeLayer.group)
    // Remove old materials from timedMaterials
    timedMaterials.splice(timedMaterials.indexOf(quakeLayer.markerMaterial), 1)
    timedMaterials.splice(timedMaterials.indexOf(quakeLayer.ringMaterial), 1)
    quakeLayer = null
  }

  if (sourceToggles.earthquakes && sourceCache.earthquakes.length > 0) {
    quakeLayer = createQuakeLayer(sourceCache.earthquakes, GLOBE_RADIUS)
    globeGroup.add(quakeLayer.group)
    timedMaterials.push(quakeLayer.markerMaterial, quakeLayer.ringMaterial)

    // Apply quake state from dev controls
    quakeLayer.markerMaterial.uniforms.uColor.value.set(quakeState.markerColor)
    quakeLayer.markerMaterial.uniforms.uSize.value = quakeState.markerSize
    quakeLayer.ringMaterial.uniforms.uColor.value.set(quakeState.ringColor)
    quakeLayer.ringMaterial.uniforms.uMaxRadius.value = quakeState.maxRadius
    quakeLayer.ringMaterial.uniforms.uSpeed.value = quakeState.speed
    quakeLayer.ringMaterial.uniforms.uOpacity.value = quakeState.ringOpacity
    quakeLayer.group.visible = quakeState.visible
  }
}

dataFolder.add(sourceToggles, 'earthquakes').name('USGS Earthquakes').onChange(async (v) => {
  if (v && sourceCache.earthquakes.length === 0) {
    dataState.status = 'Fetching quakes...'
    statusCtrl.updateDisplay()
    sourceCache.earthquakes = await fetchEarthquakes()
  }
  rebuildQuakeLayer()
  mergeAndApply()
})

dataFolder.add(sourceToggles, 'storms').name('Live Storms').onChange(async (v) => {
  if (v && sourceCache.storms.length === 0) {
    dataState.status = 'Fetching storms...'
    statusCtrl.updateDisplay()
    const storms = await fetchStormData()
    sourceCache.storms = storms.length > 0 ? storms : getFallbackStorms()
  }
  mergeAndApply()
})

dataFolder.add(sourceToggles, 'traffic').name('Internet Traffic').onChange(() => {
  mergeAndApply()
})

// EONET filter subfolder
const eonetFolder = dataFolder.addFolder('EONET Filters')
const filterLabels = {
  wildfires: 'Wildfires',
  severeStorms: 'Severe Storms',
  volcanoes: 'Volcanoes',
  earthquakes: 'Earthquakes',
  floods: 'Floods',
  landslides: 'Landslides',
  snow: 'Snow',
  dustHaze: 'Dust & Haze',
  drought: 'Drought',
  tempExtremes: 'Temp Extremes',
  seaLakeIce: 'Sea & Lake Ice',
  waterColor: 'Water Color',
  manmade: 'Manmade',
}
for (const [key, label] of Object.entries(filterLabels)) {
  eonetFolder.add(eonetFilters, key).name(label).onChange(() => mergeAndApply())
}
eonetFolder.close()

const statusCtrl = dataFolder.add(dataState, 'status').name('Status').disable()
const countCtrl = dataFolder.add(dataState, 'totalPoints').name('Points').disable()

// Auto-fetch EONET on startup
fetchEONETEvents().then((events) => {
  sourceCache.eonet = events
  mergeAndApply()
})

// -- Close folders by default to keep it tidy --
bloomFolder.close()
globeFolder.close()
gridFolder.close()
atmosFolder.close()
satFolder.close()
eruptFolder.close()
hotspotFolder.close()
ringsFolder.close()
quakeFolder.close()
userFolder.close()
issFolder.close()
starsFolder.close()
nebulaFolder.close()
sceneFolder.close()

// --- Sun direction from real time (object space — fixed to texture) ---
function getSunDirection() {
  const now = new Date()

  // Solar hour angle — where the sun is based on UTC time
  const hours = now.getUTCHours() + now.getUTCMinutes() / 60
  const sunLon = ((12 - hours) / 24) * Math.PI * 2 // noon = 0° lon, wraps around

  // Solar declination — latitude of subsolar point based on day of year
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000)
  const sunLat = 23.44 * Math.sin(((dayOfYear - 81) / 365) * Math.PI * 2) * (Math.PI / 180)

  // Object-space direction — maps directly to texture geography
  // Three.js SphereGeometry: Prime Meridian (u=0.5) faces +X
  return new THREE.Vector3(
    Math.cos(sunLat) * Math.cos(sunLon),
    Math.sin(sunLat),
    -Math.cos(sunLat) * Math.sin(sunLon)
  ).normalize()
}

// --- Animation ---
const clock = new THREE.Clock()

function animate() {
  requestAnimationFrame(animate)

  const elapsed = clock.getElapsedTime()

  // Update time uniforms
  for (const mat of timedMaterials) {
    mat.uniforms.uTime.value = elapsed
  }

  // Slow auto-rotation of globe
  globeGroup.rotation.y = elapsed * rotSpeed.value

  // Update sun direction in object space — locked to geography
  globe.material.uniforms.uSunDir.value.copy(getSunDirection())

  // Update satellite orbital positions periodically
  if (satCloud && satSatrecs.length > 0 && elapsed - lastSatUpdate > SAT_UPDATE_INTERVAL / 1000) {
    lastSatUpdate = elapsed
    const newPositions = updatePositions(satSatrecs, new Date())
    satCloud.setPositions(newPositions, GLOBE_RADIUS)
  }

  controls.update()
  composer.render()
}

animate()

// --- Resize ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)

  const pr = Math.min(window.devicePixelRatio, 2)
  if (satCloud) satCloud.material.uniforms.uPixelRatio.value = pr
  eruptions.material.uniforms.uPixelRatio.value = pr
  hotspots.material.uniforms.uPixelRatio.value = pr
})
