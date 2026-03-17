import * as THREE from 'three'
import { feature, mesh } from 'topojson-client'
import earcut from 'earcut'
import countriesTopo from 'world-atlas/countries-50m.json'

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

function polygonToMesh(rings, radius, material) {
  const flatCoords = []
  const holeIndices = []

  for (let r = 0; r < rings.length; r++) {
    if (r > 0) holeIndices.push(flatCoords.length / 2)
    const ring = rings[r]
    const len = ring.length > 1 &&
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1]
        ? ring.length - 1
        : ring.length
    for (let i = 0; i < len; i++) {
      flatCoords.push(ring[i][0], ring[i][1])
    }
  }

  const indices = earcut(flatCoords, holeIndices.length ? holeIndices : undefined)
  if (indices.length === 0) return null

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

export function createCountryBorders(radius) {
  const group = new THREE.Group()
  const fillGroup = new THREE.Group()

  // mesh() extracts shared borders — each border drawn once, no duplicates
  const borders = mesh(countriesTopo, countriesTopo.objects.countries, (a, b) => a !== b)
  const coastline = mesh(countriesTopo, countriesTopo.objects.countries, (a, b) => a === b)

  const borderMat = new THREE.LineBasicMaterial({
    color: 0x6149f7,
    transparent: true,
    opacity: 0.3,
  })

  const coastMat = new THREE.LineBasicMaterial({
    color: 0x8c64ff,
    transparent: true,
    opacity: 0.5,
  })

  const fillMat = new THREE.MeshBasicMaterial({
    color: 0x1a0a30,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false,
  })

  function addLines(geojson, material, r) {
    const coords = geojson.type === 'MultiLineString'
      ? geojson.coordinates
      : [geojson.coordinates]

    for (const line of coords) {
      if (line.length < 2) continue
      const points = []
      for (const [lon, lat] of line) {
        points.push(latLonToVec3(lat, lon, r))
      }
      const geo = new THREE.BufferGeometry().setFromPoints(points)
      group.add(new THREE.Line(geo, material))
    }
  }

  // Country fills
  const countries = feature(countriesTopo, countriesTopo.objects.countries)
  for (const feat of countries.features) {
    const geom = feat.geometry
    if (geom.type === 'Polygon') {
      const m = polygonToMesh(geom.coordinates, radius * 1.001, fillMat)
      if (m) fillGroup.add(m)
    } else if (geom.type === 'MultiPolygon') {
      for (const polygon of geom.coordinates) {
        const m = polygonToMesh(polygon, radius * 1.001, fillMat)
        if (m) fillGroup.add(m)
      }
    }
  }

  group.add(fillGroup)
  addLines(borders, borderMat, radius * 1.0015)
  addLines(coastline, coastMat, radius * 1.002)

  return {
    group,
    fillGroup,
    borderMaterial: borderMat,
    coastMaterial: coastMat,
    fillMaterial: fillMat,
  }
}
