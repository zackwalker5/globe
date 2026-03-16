const USGS_BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_'

export const QUAKE_RANGES = {
  'Past Hour': 'hour',
  'Past 24 Hours': 'day',
  'Past 7 Days': 'week',
  'Past 30 Days': 'month',
}

export async function fetchEarthquakes(range = 'day') {
  console.log(`Fetching USGS earthquake data (${range})...`)

  try {
    const res = await fetch(`${USGS_BASE}${range}.geojson`)
    if (!res.ok) {
      console.warn(`USGS API ${res.status}`)
      return []
    }

    const data = await res.json()
    const events = []

    for (const feature of data.features) {
      const coords = feature.geometry?.coordinates
      if (!coords) continue

      const lon = coords[0]
      const lat = coords[1]
      const depth = coords[2] // km
      const mag = feature.properties?.mag
      if (mag == null) continue

      // Normalize magnitude to 0-1 intensity
      // 2.5 = low, 5.0 = moderate, 7.0+ = extreme
      const intensity = Math.min((mag - 2.0) / 6.0, 1.0)

      events.push({
        name: feature.properties.place || 'Unknown',
        lat,
        lon,
        intensity,
        category: 'earthquakes',
        magnitude: mag,
        magnitudeUnit: feature.properties.magType || 'mag',
        depth,
      })
    }

    console.log(`Found ${events.length} earthquakes (M2.5+ ${range})`)
    return events
  } catch (e) {
    console.warn('USGS fetch error:', e)
    return []
  }
}
