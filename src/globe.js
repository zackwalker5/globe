import * as THREE from 'three'

// Globe with lat/lon grid as separate sphere + fresnel atmosphere
export function createGlobe(radius) {
  const group = new THREE.Group()

  // --- Globe sphere (textured surface with bump, ocean, night lights) ---
  const textureLoader = new THREE.TextureLoader()
  const albedoTex = textureLoader.load('/textures/Albedo.jpeg')
  const bumpTex = textureLoader.load('/textures/Bump.jpeg')
  const oceanTex = textureLoader.load('/textures/Ocean_Mask.png')
  const nightTex = textureLoader.load('/textures/night_lights_modified.png')

  albedoTex.colorSpace = THREE.SRGBColorSpace
  nightTex.colorSpace = THREE.SRGBColorSpace

  const globeGeo = new THREE.SphereGeometry(radius, 128, 64)
  const globeMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0x1a0a30) },
      uAlbedo: { value: albedoTex },
      uBump: { value: bumpTex },
      uOcean: { value: oceanTex },
      uNightLights: { value: nightTex },
      uTextureStrength: { value: 1.0 },
      uBumpStrength: { value: 0.03 },
      uNightStrength: { value: 0.15 },
      uOceanStrength: { value: 0.3 },
      uSunDir: { value: new THREE.Vector3(1.0, 0.5, 0.8).normalize() },
      uTerminatorSharpness: { value: 8.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vObjNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vObjNormal = normalize(normal);
        vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform sampler2D uAlbedo;
      uniform sampler2D uBump;
      uniform sampler2D uOcean;
      uniform sampler2D uNightLights;
      uniform float uTextureStrength;
      uniform float uBumpStrength;
      uniform float uNightStrength;
      uniform float uOceanStrength;
      uniform vec3 uSunDir;
      uniform float uTerminatorSharpness;

      varying vec3 vNormal;
      varying vec3 vObjNormal;
      varying vec3 vWorldPos;
      varying vec2 vUv;

      void main() {
        // Object-space normal for sun lighting (fixed to texture/geography)
        vec3 objN = normalize(vObjNormal);
        // World-space normal for view-dependent effects (fresnel, specular)
        vec3 N = normalize(vNormal);

        // Bump perturbation on object-space normal
        vec2 texelSize = vec2(1.0 / 1920.0);
        float bL = texture2D(uBump, vUv - vec2(texelSize.x, 0.0)).r;
        float bR = texture2D(uBump, vUv + vec2(texelSize.x, 0.0)).r;
        float bD = texture2D(uBump, vUv - vec2(0.0, texelSize.y)).r;
        float bU = texture2D(uBump, vUv + vec2(0.0, texelSize.y)).r;

        vec3 up = abs(objN.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 T = normalize(cross(up, objN));
        vec3 B = cross(objN, T);
        vec3 bumpObjN = normalize(objN + (T * (bL - bR) + B * (bD - bU)) * uBumpStrength * 50.0);

        vec3 viewDir = normalize(cameraPosition - vWorldPos);

        // Sun direction in object space — locked to geography, no globe rotation involved
        vec3 sunDir = normalize(uSunDir);

        // Lighting with sharp terminator
        float NdotL = dot(bumpObjN, sunDir);
        float terminator = clamp(NdotL * uTerminatorSharpness + 0.5, 0.0, 1.0);
        float ambient = 0.08;
        float dayLight = ambient + terminator * 0.92;

        // How much is in shadow (night side)
        float nightMask = 1.0 - terminator;

        // Albedo
        vec3 albedo = texture2D(uAlbedo, vUv).rgb;

        // Ocean specular highlight (view-dependent, use world-space normal)
        float oceanMask = texture2D(uOcean, vUv).r;
        vec3 reflDir = reflect(-viewDir, N);
        float spec = pow(max(dot(reflDir, N), 0.0), 80.0);
        vec3 oceanSpec = vec3(0.4, 0.6, 0.8) * spec * oceanMask * uOceanStrength * (1.0 - nightMask);

        // Night lights
        vec3 nightLights = texture2D(uNightLights, vUv).rgb * uNightStrength * nightMask;

        // Compose
        vec3 baseColor = uColor * mix(0.3, 1.0, dot(viewDir, N));
        vec3 dayColor = albedo * dayLight + oceanSpec;
        vec3 nightColor = albedo * ambient * 0.3 + nightLights;
        vec3 texColor = mix(dayColor, nightColor, nightMask);

        vec3 color = mix(baseColor, texColor, uTextureStrength);

        // Fresnel edge darkening (view-dependent)
        float fresnel = dot(viewDir, N);
        color *= mix(0.4, 1.0, fresnel);

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.FrontSide,
  })

  const globe = new THREE.Mesh(globeGeo, globeMat)
  group.add(globe)

  // --- Grid sphere (separate, can be toggled + elevated) ---
  const gridGeo = new THREE.SphereGeometry(radius, 128, 64)
  const gridMat = new THREE.ShaderMaterial({
    uniforms: {
      uGridColor: { value: new THREE.Color(0x6149f7) },
      uGridOpacity: { value: 0.12 },
      uLatSpacing: { value: 15.0 },
      uLonSpacing: { value: 15.0 },
      uLineWidth: { value: 0.001 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vPosition;

      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uGridColor;
      uniform float uGridOpacity;
      uniform float uLatSpacing;
      uniform float uLonSpacing;
      uniform float uLineWidth;

      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vPosition;

      #define PI 3.14159265359

      void main() {
        vec3 nPos = normalize(vPosition);
        float lat = asin(nPos.y) * (180.0 / PI);
        float lon = atan(nPos.z, nPos.x) * (180.0 / PI);

        float latLine = abs(mod(lat + uLatSpacing * 0.5, uLatSpacing) - uLatSpacing * 0.5);
        float lonLine = abs(mod(lon + uLonSpacing * 0.5, uLonSpacing) - uLonSpacing * 0.5);

        float latGrid = 1.0 - smoothstep(0.0, uLineWidth * 180.0, latLine);
        float lonGrid = 1.0 - smoothstep(0.0, uLineWidth * 180.0, lonLine);
        float grid = max(latGrid, lonGrid);

        // Fresnel edge fade
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fresnel = dot(viewDir, vNormal);
        float edgeFade = smoothstep(0.0, 0.4, fresnel);

        float alpha = grid * uGridOpacity * edgeFade;
        if (alpha < 0.001) discard;

        gl_FragColor = vec4(uGridColor, alpha);
      }
    `,
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const gridSphere = new THREE.Mesh(gridGeo, gridMat)
  gridSphere.scale.setScalar(1.006) // just above surface by default
  group.add(gridSphere)

  // --- Atmosphere glow (outer shell with fresnel) ---
  const atmosGeo = new THREE.SphereGeometry(radius * 1.15, 64, 32)
  const atmosMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor1: { value: new THREE.Color(0x45e8e5) },
      uColor2: { value: new THREE.Color(0x1379e7) },
      uIntensity: { value: 0.67 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      uniform float uIntensity;
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fresnel = 1.0 - dot(viewDir, vNormal);
        fresnel = pow(fresnel, 3.0);

        vec3 color = mix(uColor1, uColor2, fresnel);
        float alpha = fresnel * uIntensity;

        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const atmosphere = new THREE.Mesh(atmosGeo, atmosMat)
  group.add(atmosphere)

  return { group, globe, atmosphere, gridSphere }
}
