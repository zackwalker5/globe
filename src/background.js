import * as THREE from 'three'

// --- Starfield ---
export function createStarfield(count = 1500) {
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const twinklePhase = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    // Random positions on a large sphere
    const r = 50 + Math.random() * 50
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = r * Math.cos(phi)

    sizes[i] = 0.5 + Math.random() * 2.0
    twinklePhase[i] = Math.random() * Math.PI * 2
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geo.setAttribute('aTwinkle', new THREE.BufferAttribute(twinklePhase, 1))

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aSize;
      attribute float aTwinkle;
      varying float vAlpha;

      void main() {
        // Gentle twinkle
        float twinkle = sin(uTime * 0.5 + aTwinkle) * 0.3 + 0.7;
        vAlpha = twinkle * 0.6;

        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPos;
        gl_PointSize = aSize * uPixelRatio * (100.0 / -mvPos.z);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float glow = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(0.85, 0.85, 1.0), glow * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  return { points: new THREE.Points(geo, mat), material: mat }
}

// --- Nebula clouds (large soft billboards) ---
export function createNebula() {
  const group = new THREE.Group()

  const clouds = [
    { pos: [-15, 8, -30], scale: 25, color: 0x7828c8, opacity: 0.06 },
    { pos: [20, -10, -25], scale: 20, color: 0xc83278, opacity: 0.04 },
    { pos: [-8, -15, -35], scale: 30, color: 0x503cb4, opacity: 0.03 },
    { pos: [12, 12, -28], scale: 18, color: 0x9650d0, opacity: 0.05 },
    { pos: [-20, 5, -20], scale: 22, color: 0xc85096, opacity: 0.035 },
  ]

  for (const cloud of clouds) {
    const geo = new THREE.PlaneGeometry(cloud.scale, cloud.scale)
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(cloud.color) },
        uOpacity: { value: cloud.opacity },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uTime;
        varying vec2 vUv;

        void main() {
          vec2 center = vUv - 0.5;
          float d = length(center);
          float cloud = smoothstep(0.5, 0.0, d);
          cloud = pow(cloud, 1.5);

          // Subtle animation
          float shift = sin(uTime * 0.1 + center.x * 3.0) * 0.1;
          cloud *= (1.0 + shift);

          gl_FragColor = vec4(uColor, cloud * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })

    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(...cloud.pos)
    mesh.lookAt(0, 0, 0) // face center
    mat.userData = { baseOpacity: cloud.opacity }
    mesh.userData.nebulaMat = mat
    group.add(mesh)
  }

  return group
}
