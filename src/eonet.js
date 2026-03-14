const EONET_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=50'

// Map EONET categories to intensity values
const CATEGORY_INTENSITY = {
  volcanoes: 1.0,
  severeStorms: 0.9,
  wildfires: 0.85,
  earthquakes: 0.8,
  floods: 0.7,
  landslides: 0.65,
  tempExtremes: 0.6,
  snow: 0.5,
  dustHaze: 0.45,
  drought: 0.4,
  seaLakeIce: 0.35,
  waterColor: 0.3,
  manmade: 0.5,
}

export async function fetchEONETEvents() {
  console.log('Fetching NASA EONET events...')

  try {
    const res = await fetch(EONET_URL)
    if (!res.ok) {
      console.warn(`EONET API ${res.status}`)
      return []
    }

    const data = await res.json()
    const events = []

    for (const event of data.events) {
      if (!event.geometry?.length) continue

      // Use the most recent geometry entry
      const geo = event.geometry[event.geometry.length - 1]
      if (!geo.coordinates) continue

      // EONET uses [lon, lat]
      const lon = geo.coordinates[0]
      const lat = geo.coordinates[1]

      const category = event.categories?.[0]?.id || 'unknown'
      const intensity = CATEGORY_INTENSITY[category] || 0.5

      // Scale intensity by magnitude if available
      let magnitudeBoost = 1.0
      if (geo.magnitudeValue != null) {
        if (geo.magnitudeUnit === 'acres') {
          magnitudeBoost = Math.min(geo.magnitudeValue / 5000, 2.0)
        } else if (geo.magnitudeUnit === 'kts') {
          magnitudeBoost = Math.min(geo.magnitudeValue / 60, 2.0)
        }
      }

      events.push({
        name: event.title,
        lat,
        lon,
        intensity: Math.min(intensity * magnitudeBoost, 1.0),
        category,
        magnitude: geo.magnitudeValue,
        magnitudeUnit: geo.magnitudeUnit,
      })
    }

    console.log(`Found ${events.length} EONET events`)
    return events
  } catch (e) {
    console.warn('EONET fetch error:', e)
    return []
  }
}
