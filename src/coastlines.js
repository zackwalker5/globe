import * as THREE from 'three'
import { feature } from 'topojson-client'
import earcut from 'earcut'
import landTopo from 'world-atlas/land-110m.json'

const DEG2RAD = Math.PI / 180

function latLonToVec3(lat, lon, radius) {
  const phi = (90 - lat) * DEG2RAD
  const theta = (lon + 180) * DEG2RAD
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

function ringToLine(coords, radius, color) {
  const points = []
  for (const [lon, lat] of coords) {
    points.push(latLonToVec3(lat, lon, radius))
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points)
  return new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 })
  )
}

function polygonToMesh(rings, radius, material) {
  // rings[0] = outer ring, rings[1..] = holes
  // Flatten coords for earcut (works in 2D lat/lon, then project to 3D)
  const flatCoords = []
  const holeIndices = []

  for (let r = 0; r < rings.length; r++) {
    if (r > 0) holeIndices.push(flatCoords.length / 2)
    const ring = rings[r]
    // Skip closing coord if it duplicates the first
    const len = ring.length > 1 &&
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1]
        ? ring.length - 1
        : ring.length
    for (let i = 0; i < len; i++) {
      flatCoords.push(ring[i][0], ring[i][1]) // lon, lat
    }
  }

  const indices = earcut(flatCoords, holeIndices.length ? holeIndices : undefined)
  if (indices.length === 0) return null

  // Build 3D vertices
  const vertCount = flatCoords.length / 2
  const positions = new Float32Array(vertCount * 3)
  for (let i = 0; i < vertCount; i++) {
    const lon = flatCoords[i * 2]
    const lat = flatCoords[i * 2 + 1]
    const v = latLonToVec3(lat, lon, radius)
    positions[i * 3] = v.x
    positions[i * 3 + 1] = v.y
    positions[i * 3 + 2] = v.z
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setIndex(Array.from(indices))
  geo.computeVertexNormals()

  return new THREE.Mesh(geo, material)
}

export async function createCoastlines(radius) {
  const outlineGroup = new THREE.Group()
  const fillGroup = new THREE.Group()
  const wrapper = new THREE.Group()

  const outlineColor = new THREE.Color(0x8c64ff)

  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0x2a1550,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  })

  const land = feature(landTopo, landTopo.objects.land)

  for (const feat of land.type === 'FeatureCollection' ? land.features : [land]) {
    const geom = feat.geometry || feat
    if (geom.type === 'Polygon') {
      // Outline
      for (const ring of geom.coordinates) {
        outlineGroup.add(ringToLine(ring, radius * 1.002, outlineColor))
      }
      // Fill
      const mesh = polygonToMesh(geom.coordinates, radius * 1.001, fillMaterial)
      if (mesh) fillGroup.add(mesh)
    } else if (geom.type === 'MultiPolygon') {
      for (const polygon of geom.coordinates) {
        // Outline
        for (const ring of polygon) {
          outlineGroup.add(ringToLine(ring, radius * 1.002, outlineColor))
        }
        // Fill
        const mesh = polygonToMesh(polygon, radius * 1.001, fillMaterial)
        if (mesh) fillGroup.add(mesh)
      }
    }
  }

  wrapper.add(fillGroup)
  wrapper.add(outlineGroup)
  wrapper.userData = { fillMaterial, outlineGroup, fillGroup }

  return wrapper
}
