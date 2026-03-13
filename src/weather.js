const API_KEY = import.meta.env.VITE_TOMORROW_API_KEY
const BASE_URL = 'https://api.tomorrow.io/v4/weather/realtime'

// Severe weather codes from Tomorrow.io
// 4xxx = rain, 5xxx = snow, 6xxx = freezing, 7xxx = ice, 8xxx = thunderstorm
const STORM_CODES = new Set([
  4201, 4001, // heavy/moderate rain
  5101, 5001, // heavy/moderate snow
  6201, 6001, // heavy/moderate freezing rain
  7101, 7000, // heavy ice / ice pellets
  8000,       // thunderstorm
])

// Rough severity mapping — higher = more intense eruption
function weatherSeverity(code) {
  if (code === 8000) return 1.0     // thunderstorm
  if (code === 7101) return 0.9     // heavy ice
  if (code === 4201) return 0.85    // heavy rain
  if (code === 5101) return 0.85    // heavy snow
  if (code === 6201) return 0.8     // heavy freezing rain
  if (code === 4001) return 0.6     // moderate rain
  if (code === 5001) return 0.6     // moderate snow
  if (code === 6001) return 0.6     // moderate freezing rain
  if (code === 7000) return 0.5     // ice pellets
  return 0.4
}

// Grid of global sample points — covers major land areas
// Spaced roughly every 20-30 degrees, biased toward populated/storm-prone areas
const SAMPLE_GRID = [
  // North America
  { lat: 47, lon: -122, region: 'NA' }, // Seattle
  { lat: 37, lon: -122, region: 'NA' }, // San Francisco
  { lat: 34, lon: -118, region: 'NA' }, // Los Angeles
  { lat: 33, lon: -112, region: 'NA' }, // Phoenix
  { lat: 40, lon: -105, region: 'NA' }, // Denver
  { lat: 30, lon: -98, region: 'NA' },  // Austin
  { lat: 42, lon: -88, region: 'NA' },  // Chicago
  { lat: 30, lon: -90, region: 'NA' },  // New Orleans
  { lat: 26, lon: -80, region: 'NA' },  // Miami
  { lat: 39, lon: -77, region: 'NA' },  // DC
  { lat: 41, lon: -74, region: 'NA' },  // NYC
  { lat: 44, lon: -79, region: 'NA' },  // Toronto
  { lat: 20, lon: -99, region: 'NA' },  // Mexico City
  { lat: 25, lon: -100, region: 'NA' }, // Monterrey

  // Central America / Caribbean
  { lat: 19, lon: -70, region: 'CA' },  // Dominican Republic
  { lat: 10, lon: -84, region: 'CA' },  // Costa Rica
  { lat: 15, lon: -87, region: 'CA' },  // Honduras

  // South America
  { lat: 4, lon: -74, region: 'SA' },   // Bogota
  { lat: -12, lon: -77, region: 'SA' }, // Lima
  { lat: -23, lon: -47, region: 'SA' }, // São Paulo
  { lat: -34, lon: -58, region: 'SA' }, // Buenos Aires
  { lat: -3, lon: -60, region: 'SA' },  // Manaus (Amazon)
  { lat: -16, lon: -68, region: 'SA' }, // La Paz

  // Europe
  { lat: 51, lon: -0.1, region: 'EU' }, // London
  { lat: 49, lon: 2, region: 'EU' },    // Paris
  { lat: 52, lon: 13, region: 'EU' },   // Berlin
  { lat: 41, lon: 12, region: 'EU' },   // Rome
  { lat: 40, lon: -4, region: 'EU' },   // Madrid
  { lat: 60, lon: 25, region: 'EU' },   // Helsinki
  { lat: 59, lon: 18, region: 'EU' },   // Stockholm
  { lat: 52, lon: 21, region: 'EU' },   // Warsaw
  { lat: 48, lon: 16, region: 'EU' },   // Vienna
  { lat: 38, lon: 24, region: 'EU' },   // Athens

  // Africa
  { lat: 31, lon: 31, region: 'AF' },   // Cairo
  { lat: 6, lon: 3, region: 'AF' },     // Lagos
  { lat: -1, lon: 37, region: 'AF' },   // Nairobi
  { lat: -26, lon: 28, region: 'AF' },  // Johannesburg
  { lat: 34, lon: -7, region: 'AF' },   // Casablanca
  { lat: 9, lon: 39, region: 'AF' },    // Addis Ababa
  { lat: -4, lon: 15, region: 'AF' },   // Kinshasa

  // Middle East
  { lat: 25, lon: 55, region: 'ME' },   // Dubai
  { lat: 41, lon: 29, region: 'ME' },   // Istanbul
  { lat: 32, lon: 35, region: 'ME' },   // Tel Aviv
  { lat: 24, lon: 47, region: 'ME' },   // Riyadh

  // Asia
  { lat: 55, lon: 37, region: 'AS' },   // Moscow
  { lat: 19, lon: 73, region: 'AS' },   // Mumbai
  { lat: 28, lon: 77, region: 'AS' },   // Delhi
  { lat: 13, lon: 80, region: 'AS' },   // Chennai
  { lat: 23, lon: 90, region: 'AS' },   // Dhaka
  { lat: 14, lon: 100, region: 'AS' },  // Bangkok
  { lat: 22, lon: 114, region: 'AS' },  // Hong Kong
  { lat: 31, lon: 121, region: 'AS' },  // Shanghai
  { lat: 40, lon: 116, region: 'AS' },  // Beijing
  { lat: 35, lon: 140, region: 'AS' },  // Tokyo
  { lat: 37, lon: 127, region: 'AS' },  // Seoul
  { lat: 1, lon: 104, region: 'AS' },   // Singapore
  { lat: -6, lon: 107, region: 'AS' },  // Jakarta
  { lat: 14, lon: 121, region: 'AS' },  // Manila
  { lat: 21, lon: 106, region: 'AS' },  // Hanoi

  // Oceania
  { lat: -34, lon: 151, region: 'OC' }, // Sydney
  { lat: -38, lon: 145, region: 'OC' }, // Melbourne
  { lat: -27, lon: 153, region: 'OC' }, // Brisbane
  { lat: -37, lon: 175, region: 'OC' }, // New Zealand
]

// Batch requests with delay to stay within rate limits
async function fetchWithDelay(url, delayMs = 100) {
  return new Promise((resolve) => {
    setTimeout(async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) {
          console.warn(`Weather API ${res.status} for ${url}`)
          resolve(null)
          return
        }
        resolve(await res.json())
      } catch (e) {
        console.warn('Weather fetch error:', e)
        resolve(null)
      }
    }, delayMs)
  })
}

export async function fetchStormData() {
  if (!API_KEY) {
    console.warn('No Tomorrow.io API key found. Set VITE_TOMORROW_API_KEY in .env')
    return []
  }

  console.log(`Fetching weather for ${SAMPLE_GRID.length} global points...`)
  const storms = []

  // Process in batches of 10 to avoid rate limits
  const BATCH_SIZE = 10
  for (let i = 0; i < SAMPLE_GRID.length; i += BATCH_SIZE) {
    const batch = SAMPLE_GRID.slice(i, i + BATCH_SIZE)
    const promises = batch.map((point, idx) => {
      const url = `${BASE_URL}?location=${point.lat},${point.lon}&apikey=${API_KEY}`
      return fetchWithDelay(url, idx * 150) // stagger within batch
    })

    const results = await Promise.all(promises)

    for (let j = 0; j < results.length; j++) {
      const data = results[j]
      const point = batch[j]
      if (!data?.data?.values) continue

      const code = data.data.values.weatherCode
      if (STORM_CODES.has(code)) {
        storms.push({
          name: `Storm @ ${point.lat}, ${point.lon}`,
          lat: point.lat,
          lon: point.lon,
          intensity: weatherSeverity(code),
          weatherCode: code,
          region: point.region,
          windSpeed: data.data.values.windSpeed || 0,
          precipitationIntensity: data.data.values.precipitationIntensity || 0,
        })
      }
    }
  }

  console.log(`Found ${storms.length} active storm points`)
  return storms
}

// Fallback data for when API is unavailable or no storms found
export function getFallbackStorms() {
  return [
    { name: 'Atlantic Storm', lat: 25, lon: -70, intensity: 0.8 },
    { name: 'Pacific Typhoon', lat: 18, lon: 135, intensity: 0.9 },
    { name: 'Indian Cyclone', lat: 15, lon: 85, intensity: 0.7 },
    { name: 'European Storm', lat: 52, lon: 5, intensity: 0.5 },
    { name: 'Gulf Storm', lat: 28, lon: -90, intensity: 0.6 },
    { name: 'South China Sea', lat: 15, lon: 115, intensity: 0.65 },
    { name: 'Coral Sea Storm', lat: -18, lon: 155, intensity: 0.55 },
  ]
}
