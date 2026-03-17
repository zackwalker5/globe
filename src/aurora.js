import * as THREE from 'three'

const AURORA_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json'
const REFRESH_INTERVAL = 5 * 60 * 1000
const CANVAS_W = 720
const CANVAS_H = 360

function auroraColor(intensity) {
  if (intensity <= 2) return null
  const t = Math.min((intensity - 2) / 12, 1.0) // remap 3-14 → 0-1
  // Mostly green, hints of cyan at peak
  const r = Math.floor(t * t * 40)
  const g = Math.floor(60 + t * 140)
  const b = Math.floor(t * t * 80)
  const a = Math.floor(40 + t * 120)
  return { r, g, b, a }
}

// Simple box blur pass on ImageData
function blurImageData(imageData, w, h, radius) {
  const src = new Uint8ClampedArray(imageData.data)
  const dst = imageData.data

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, count = 0
      for (let dx = -radius; dx <= radius; dx++) {
        const sx = (x + dx + w) % w // wrap longitude
        const idx = (y * w + sx) * 4
        r += src[idx]; g += src[idx + 1]; b += src[idx + 2]; a += src[idx + 3]
        count++
      }
      const idx = (y * w + x) * 4
      dst[idx] = r / count; dst[idx + 1] = g / count
      dst[idx + 2] = b / count; dst[idx + 3] = a / count
    }
  }

  // Copy for vertical pass
  const mid = new Uint8ClampedArray(dst)

  // Vertical pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, count = 0
      for (let dy = -radius; dy <= radius; dy++) {
        const sy = Math.max(0, Math.min(h - 1, y + dy))
        const idx = (sy * w + x) * 4
        r += mid[idx]; g += mid[idx + 1]; b += mid[idx + 2]; a += mid[idx + 3]
        count++
      }
      const idx = (y * w + x) * 4
      dst[idx] = r / count; dst[idx + 1] = g / count
      dst[idx + 2] = b / count; dst[idx + 3] = a / count
    }
  }
}

export function createAuroraOverlay(globeRadius) {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const ctx = canvas.getContext('2d')

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.RepeatWrapping

  const geo = new THREE.SphereGeometry(globeRadius * 1.02, 128, 64)
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMap: { value: texture },
      uOpacity: { value: 0.8 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;

      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uMap;
      uniform float uOpacity;

      varying vec2 vUv;
      varying vec3 vNormal;

      void main() {
        vec4 texel = texture2D(uMap, vUv);
        if (texel.a < 0.01) discard;

        // Slow shimmer — waves of brightness ripple along the aurora
        float wave1 = sin(vUv.x * 10.0 + uTime * 0.5) * 0.25;
        float wave2 = sin(vUv.x * 18.0 - uTime * 0.3 + vUv.y * 6.0) * 0.15;
        float wave3 = sin(vUv.y * 12.0 + uTime * 0.35) * 0.12;
        float shimmer = 1.0 + wave1 + wave2 + wave3;

        // Gentle breathing pulse
        float pulse = 1.0 + sin(uTime * 0.4) * 0.1;

        vec3 color = texel.rgb * shimmer * pulse;
        float alpha = texel.a * uOpacity * shimmer * pulse;

        // Fresnel-like edge glow — aurora is more visible at grazing angles
        float fresnel = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
        fresnel = 0.6 + fresnel * 0.4;
        alpha *= fresnel;

        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  })
  const mesh = new THREE.Mesh(geo, mat)

  function renderData(coordinates) {
    const imageData = ctx.createImageData(CANVAS_W, CANVAS_H)
    const pixels = imageData.data

    for (const [lon, lat, intensity] of coordinates) {
      const col = auroraColor(intensity)
      if (!col) continue

      const px = Math.round((lon / 360) * CANVAS_W) % CANVAS_W
      const py = Math.round(((90 - lat) / 180) * CANVAS_H)
      if (py < 0 || py >= CANVAS_H) continue

      // Paint a 3×3 block so blur has material to work with
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = (px + dx + CANVAS_W) % CANVAS_W
          const y = py + dy
          if (y < 0 || y >= CANVAS_H) continue
          const idx = (y * CANVAS_W + x) * 4
          pixels[idx] = Math.min(255, pixels[idx] + col.r)
          pixels[idx + 1] = Math.min(255, pixels[idx + 1] + col.g)
          pixels[idx + 2] = Math.min(255, pixels[idx + 2] + col.b)
          pixels[idx + 3] = Math.min(255, pixels[idx + 3] + col.a)
        }
      }
    }

    // Multi-pass blur for smooth aurora bands
    blurImageData(imageData, CANVAS_W, CANVAS_H, 4)
    blurImageData(imageData, CANVAS_W, CANVAS_H, 3)
    blurImageData(imageData, CANVAS_W, CANVAS_H, 2)

    ctx.putImageData(imageData, 0, 0)

    // Draw a feathered copy at the seam to eliminate the hard edge at lon 0/360
    // Copy a thin strip from the right edge and blend it onto the left, and vice versa
    const seamW = 8
    ctx.globalAlpha = 0.5
    ctx.drawImage(canvas, CANVAS_W - seamW, 0, seamW, CANVAS_H, -seamW / 2, 0, seamW, CANVAS_H)
    ctx.drawImage(canvas, 0, 0, seamW, CANVAS_H, CANVAS_W - seamW / 2, 0, seamW, CANVAS_H)
    ctx.globalAlpha = 1.0

    texture.needsUpdate = true
  }

  async function fetchAndRender() {
    try {
      const res = await fetch(AURORA_URL)
      if (!res.ok) return
      const data = await res.json()
      if (data.coordinates) {
        renderData(data.coordinates)
        console.log(`Aurora: ${data.coordinates.length} points, forecast ${data['Forecast Time'] || ''}`)
      }
    } catch (e) {
      console.warn('Aurora fetch error:', e)
    }
  }

  async function init() {
    await fetchAndRender()
    setInterval(fetchAndRender, REFRESH_INTERVAL)
  }

  return {
    mesh,
    material: mat,
    init,
  }
}
