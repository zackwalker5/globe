import * as THREE from 'three'
import { latLonToVec3 } from './data.js'

export function createUserMarker(globeRadius) {
  const group = new THREE.Group()
  group.visible = false // hidden until location acquired

  // Solid filled circle disc
  const segments = 48
  const discGeo = new THREE.CircleGeometry(1, segments)

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x00ccff) },
      uRadius: { value: 0.06 },
      uSpeed: { value: 1.5 },
      uOpacity: { value: 0.8 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uRadius;
      uniform float uSpeed;

      varying vec2 vUv;

      void main() {
        // Gentle pulse
        float pulse = 1.0 + sin(uTime * uSpeed) * 0.2;
        vec3 pos = position * uRadius * pulse;
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      uniform float uSpeed;

      varying vec2 vUv;

      void main() {
        // Distance from center (uvs go 0-1, center is 0.5)
        float d = length(vUv - 0.5) * 2.0;

        // Soft edge
        float alpha = smoothstep(1.0, 0.7, d);

        // Pulse brightness
        float pulse = 0.8 + sin(uTime * uSpeed) * 0.2;

        gl_FragColor = vec4(uColor * pulse, alpha * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })

  const disc = new THREE.Mesh(discGeo, mat)
  group.add(disc)

  function setLocation(lat, lon) {
    const pos = latLonToVec3(lat, lon, globeRadius * 1.004)
    const normal = new THREE.Vector3(pos.x, pos.y, pos.z).normalize()

    disc.position.set(pos.x, pos.y, pos.z)
    disc.lookAt(pos.x + normal.x, pos.y + normal.y, pos.z + normal.z)

    group.visible = true
  }

  return { group, material: mat, setLocation }
}
