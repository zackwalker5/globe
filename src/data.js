// Major internet traffic hubs — lat/lon coordinates
// Intensity 0-1 represents relative traffic volume
export const trafficPoints = [
  { name: 'Ashburn, VA', lat: 39.04, lon: -77.49, intensity: 1.0 },
  { name: 'Frankfurt', lat: 50.11, lon: 8.68, intensity: 0.85 },
  { name: 'Tokyo', lat: 35.68, lon: 139.69, intensity: 0.9 },
  { name: 'Singapore', lat: 1.35, lon: 103.82, intensity: 0.75 },
  { name: 'London', lat: 51.51, lon: -0.13, intensity: 0.8 },
  { name: 'São Paulo', lat: -23.55, lon: -46.63, intensity: 0.6 },
  { name: 'Mumbai', lat: 19.08, lon: 72.88, intensity: 0.65 },
  { name: 'Sydney', lat: -33.87, lon: 151.21, intensity: 0.5 },
  { name: 'Amsterdam', lat: 52.37, lon: 4.90, intensity: 0.75 },
  { name: 'San Jose', lat: 37.34, lon: -121.89, intensity: 0.85 },
  { name: 'Seoul', lat: 37.57, lon: 126.98, intensity: 0.7 },
  { name: 'Hong Kong', lat: 22.32, lon: 114.17, intensity: 0.7 },
  { name: 'Chicago', lat: 41.88, lon: -87.63, intensity: 0.6 },
  { name: 'Dallas', lat: 32.78, lon: -96.80, intensity: 0.55 },
  { name: 'Los Angeles', lat: 34.05, lon: -118.24, intensity: 0.7 },
  { name: 'Paris', lat: 48.86, lon: 2.35, intensity: 0.65 },
  { name: 'Stockholm', lat: 59.33, lon: 18.07, intensity: 0.45 },
  { name: 'Dubai', lat: 25.20, lon: 55.27, intensity: 0.5 },
  { name: 'Johannesburg', lat: -26.20, lon: 28.05, intensity: 0.35 },
  { name: 'Toronto', lat: 43.65, lon: -79.38, intensity: 0.5 },
]

// Convert lat/lon to 3D position on a sphere
export function latLonToVec3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lon + 180) * (Math.PI / 180)
  return {
    x: -radius * Math.sin(phi) * Math.cos(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.sin(theta),
  }
}
