import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import GUI from 'lil-gui'

import { createGlobe } from './globe.js'
import { createAmbientCloud, createEruptions, createHotspots, createPulseRings } from './particles.js'
import { createStarfield, createNebula } from './background.js'
import { trafficPoints } from './data.js'
import { createCoastlines } from './coastlines.js'
import { fetchStormData, getFallbackStorms } from './weather.js'

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

// Ambient particle cloud
const cloud = createAmbientCloud(GLOBE_RADIUS, 3000)
scene.add(cloud.points)

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

  // Update timed materials list
  timedMaterials.length = 0
  timedMaterials.push(starfield.material, cloud.material, eruptions.material, hotspots.material, pulseRings.material)
  nebulaMaterials.forEach((m) => timedMaterials.push(m))
}

// --- Track all shader materials for time uniform ---
const timedMaterials = [
  starfield.material,
  cloud.material,
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
globeFolder.add(globe.material.uniforms.uTextureStrength, 'value', 0, 1, 0.01).name('Texture Strength')
globeFolder.add(globe.material.uniforms.uBumpStrength, 'value', 0, 0.2, 0.005).name('Bump Strength')
globeFolder.add(globe.material.uniforms.uCloudStrength, 'value', 0, 1, 0.01).name('Cloud Strength')
globeFolder.add(globe.material.uniforms.uNightStrength, 'value', 0, 2, 0.01).name('Night Lights')
globeFolder.add(globe.material.uniforms.uOceanStrength, 'value', 0, 1, 0.01).name('Ocean Specular')
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

// -- Ambient Cloud --
const cloudFolder = gui.addFolder('Particle Cloud')
guiColor(cloudFolder, cloud.material, 'uColor1', 'Color 1')
guiColor(cloudFolder, cloud.material, 'uColor2', 'Color 2')
cloudFolder.add(cloud.points, 'visible').name('Visible')
cloudFolder.add(cloud.material.uniforms.uShellSpread, 'value', 0.1, 3.0, 0.05).name('Shell Spread')
cloudFolder.add(cloud.material.uniforms.uDensity, 'value', 0.0, 1.0, 0.01).name('Density')
const cloudScale = { value: 1.0 }
cloudFolder.add(cloudScale, 'value', 0.5, 3.0, 0.01).name('Scale').onChange((v) => {
  cloud.points.scale.set(v, v, v)
})

// -- Storms --
const eruptFolder = gui.addFolder('Storms')
guiColor(eruptFolder, eruptions.material, 'uColor1', 'Severe (Red)')
guiColor(eruptFolder, eruptions.material, 'uColor2', 'Heavy (Yellow)')
guiColor(eruptFolder, eruptions.material, 'uColor3', 'Moderate (Green)')
guiColor(eruptFolder, eruptions.material, 'uColor4', 'Light (Blue)')
eruptFolder.add(eruptions.material.uniforms.uScale, 'value', 0.01, 0.5, 0.005).name('Spread')
eruptFolder.add(eruptions.material.uniforms.uPointScale, 'value', 0.005, 0.2, 0.005).name('Point Size')
eruptFolder.add(eruptions.points, 'visible').name('Visible')

// -- Hotspots --
const hotspotFolder = gui.addFolder('Hotspots')
guiColor(hotspotFolder, hotspots.material, 'uColor', 'Glow Color')
hotspotFolder.add(hotspots.points, 'visible').name('Visible')

// -- Pulse Rings --
const ringsFolder = gui.addFolder('Pulse Rings')
guiColor(ringsFolder, pulseRings.material, 'uColor', 'Color')
ringsFolder.add(pulseRings.material.uniforms.uMaxRadius, 'value', 0.1, 3.0, 0.05).name('Max Radius')
ringsFolder.add(pulseRings.material.uniforms.uSpeed, 'value', 0.1, 2.0, 0.05).name('Speed')
ringsFolder.add(pulseRings.material.uniforms.uOpacity, 'value', 0, 1, 0.01).name('Opacity')
ringsFolder.add(pulseRings.group, 'visible').name('Visible')

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
const rotSpeed = { value: 0.03 }
sceneFolder.add(rotSpeed, 'value', 0, 0.3, 0.005).name('Globe Rotate Speed')
sceneFolder.add(controls, 'autoRotate').name('Auto Rotate (Orbit)')
sceneFolder.add(controls, 'autoRotateSpeed', 0, 2, 0.05).name('Orbit Rotate Speed')

// -- Data Source --
const dataFolder = gui.addFolder('Data Source')
const dataState = {
  source: 'Internet Traffic',
  status: 'Ready',
  stormCount: 0,
}
dataFolder.add(dataState, 'source', ['Internet Traffic', 'Live Storms', 'Fallback Storms']).name('Source').onChange(async (v) => {
  if (v === 'Internet Traffic') {
    setEmitterData(trafficPoints)
    dataState.stormCount = trafficPoints.length
    dataState.status = `${trafficPoints.length} points loaded`
  } else if (v === 'Live Storms') {
    dataState.status = 'Fetching...'
    statusCtrl.updateDisplay()
    const storms = await fetchStormData()
    if (storms.length === 0) {
      dataState.status = 'No storms found — using fallback'
      setEmitterData(getFallbackStorms())
      dataState.stormCount = getFallbackStorms().length
    } else {
      setEmitterData(storms)
      dataState.stormCount = storms.length
      dataState.status = `${storms.length} storms active`
    }
  } else {
    const fallback = getFallbackStorms()
    setEmitterData(fallback)
    dataState.stormCount = fallback.length
    dataState.status = `${fallback.length} fallback points`
  }
  statusCtrl.updateDisplay()
  countCtrl.updateDisplay()
})
const statusCtrl = dataFolder.add(dataState, 'status').name('Status').disable()
const countCtrl = dataFolder.add(dataState, 'stormCount').name('Points').disable()

// -- Close folders by default to keep it tidy --
bloomFolder.close()
globeFolder.close()
gridFolder.close()
atmosFolder.close()
cloudFolder.close()
eruptFolder.close()
hotspotFolder.close()
ringsFolder.close()
starsFolder.close()
nebulaFolder.close()
sceneFolder.close()

// --- Sun direction from real time ---
function getSunDirection() {
  const now = new Date()

  // Solar hour angle — where the sun is based on UTC time
  const hours = now.getUTCHours() + now.getUTCMinutes() / 60
  const sunLon = ((12 - hours) / 24) * Math.PI * 2 // noon = 0, wraps around

  // Solar declination — latitude of subsolar point based on day of year
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000)
  const sunLat = 23.44 * Math.sin(((dayOfYear - 81) / 365) * Math.PI * 2) * (Math.PI / 180)

  // Pure world-space direction (normals already include globe rotation via modelMatrix)
  return new THREE.Vector3(
    Math.cos(sunLat) * Math.cos(sunLon),
    Math.sin(sunLat),
    Math.cos(sunLat) * Math.sin(sunLon)
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

  // Update sun direction — transform into globe's local space
  // so it stays fixed relative to the texture regardless of globe spin
  const sunDir = getSunDirection()
  const invQuat = new THREE.Quaternion().setFromEuler(globeGroup.rotation).invert()
  sunDir.applyQuaternion(invQuat)
  globe.material.uniforms.uSunDir.value.copy(sunDir)

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
  cloud.material.uniforms.uPixelRatio.value = pr
  eruptions.material.uniforms.uPixelRatio.value = pr
  hotspots.material.uniforms.uPixelRatio.value = pr
})
