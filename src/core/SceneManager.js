import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Speed FX: chromatic aberration + radial speed lines + vignette + film grain. */
const SpeedFXShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0.0 },
    uSpeedLines: { value: 0.0 },
    uVignette: { value: 0.9 },
    uAspect: { value: 1 },
    uTint: { value: new THREE.Color(0.55, 0.35, 1.0) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberration, uSpeedLines, uVignette, uAspect;
    uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c);
      vec2 dir = c / max(r, 1e-4);
      float ab = uAberration * r * r * 0.06;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - dir * ab).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + dir * ab).b;

      // Radial speed lines
      if (uSpeedLines > 0.001) {
        float ang = atan(c.y, c.x * uAspect);
        float lines = hash(vec2(floor(ang * 90.0), floor(uTime * 18.0)));
        lines = smoothstep(0.82, 1.0, lines);
        float streak = lines * smoothstep(0.22, 0.72, r) * uSpeedLines;
        col += uTint * streak * 0.55;
      }
      // Vignette
      float v = 1.0 - smoothstep(0.25, 0.85, r * uVignette);
      col *= mix(0.55, 1.0, v);
      // Grain
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.025;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

const QUALITY = {
  low: { pixelRatio: 0.75, shadows: false, bloom: false, shadowMap: 512 },
  medium: { pixelRatio: 1.0, shadows: true, bloom: true, shadowMap: 1024 },
  high: { pixelRatio: Math.min(window.devicePixelRatio, 2), shadows: true, bloom: true, shadowMap: 2048 },
};

/**
 * SceneManager — renderer, camera, lighting, sky, fog and post-processing.
 */
export class SceneManager {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x1a0830, 0.0028);
    this.scene.background = new THREE.Color(0x0a0218);

    this.baseFov = 68;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, window.innerWidth / window.innerHeight, 0.1, 3000);
    this.camera.position.set(0, 6, 12);

    this._buildLights();
    this._buildSky();
    this._buildComposer();

    this.quality = 'high';
    this.setQuality('high');

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  _buildLights() {
    // Cool moonlit hemisphere + warm sunset rim from the horizon sun.
    this.hemi = new THREE.HemisphereLight(0x6a5cff, 0x2a0a20, 0.75);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x30204a, 0.5);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xff8a5c, 1.6);
    this.sun.position.set(-120, 140, -200);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(2048, 2048);
    s.camera.near = 10;
    s.camera.far = 500;
    s.camera.left = -60; s.camera.right = 60; s.camera.top = 60; s.camera.bottom = -60;
    s.bias = -0.0005;
    s.normalBias = 0.04;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  _buildSky() {
    // Synthwave gradient dome with a striped retro sun and twinkling stars.
    const geo = new THREE.SphereGeometry(1500, 48, 24);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(-0.35, 0.08, -0.93).normalize() },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uTime;
        uniform vec3 uSunDir;
        varying vec3 vDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 horizon = vec3(1.0, 0.28, 0.45);
          vec3 mid = vec3(0.38, 0.06, 0.45);
          vec3 top = vec3(0.02, 0.0, 0.08);
          vec3 col = mix(horizon, mid, smoothstep(-0.02, 0.18, h));
          col = mix(col, top, smoothstep(0.15, 0.65, h));
          col = mix(col, vec3(0.08, 0.0, 0.12), 1.0 - smoothstep(-0.2, 0.0, h));

          // Retro sun with horizontal scanline cuts
          float sd = distance(d, uSunDir);
          float sunR = 0.16;
          if (sd < sunR) {
            float t = (d.y - (uSunDir.y - sunR)) / (2.0 * sunR);
            vec3 sunCol = mix(vec3(1.0, 0.15, 0.55), vec3(1.0, 0.85, 0.25), t);
            float stripes = step(0.5, fract(d.y * 90.0)) + step(0.55, t);
            float edge = 1.0 - smoothstep(sunR - 0.006, sunR, sd);
            col = mix(col, sunCol * 2.2, edge * clamp(stripes, 0.0, 1.0));
          }
          col += vec3(1.0, 0.3, 0.5) * 0.35 * exp(-sd * 6.0);

          // Stars
          vec3 sp = floor(d * 400.0);
          float star = step(0.9975, hash(sp));
          float tw = 0.6 + 0.4 * sin(uTime * 3.0 + hash(sp + 1.0) * 40.0);
          col += star * tw * smoothstep(0.1, 0.4, h) * vec3(0.9, 0.85, 1.0);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }

  _buildComposer() {
    const w = window.innerWidth, h = window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.85, 0.55, 0.78);
    this.composer.addPass(this.bloomPass);

    this.fxPass = new ShaderPass(SpeedFXShader);
    this.fxPass.uniforms.uAspect.value = w / h;
    this.composer.addPass(this.fxPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  setQuality(level) {
    const q = QUALITY[level] || QUALITY.high;
    this.quality = level;
    this.renderer.setPixelRatio(q.pixelRatio);
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    this.bloomPass.enabled = q.bloom;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    this._onResize();
  }

  /** Keep the shadow frustum centered on the player. */
  followShadow(target) {
    this.sun.position.set(target.x - 60, target.y + 90, target.z - 100);
    this.sun.target.position.copy(target);
  }

  /** Apply speed-driven FX. speedNorm 0..1, boost 0..1 */
  setSpeedFX(speedNorm, boost, time) {
    const u = this.fxPass.uniforms;
    u.uTime.value = time;
    u.uAberration.value = speedNorm * 0.6 + boost * 1.6;
    u.uSpeedLines.value = Math.max(0, speedNorm - 0.6) * 0.8 + boost * 0.9;
    this.sky.material.uniforms.uTime.value = time;
    this.bloomPass.strength = 0.8 + boost * 0.35;
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.fxPass.uniforms.uAspect.value = w / h;
  }

  render() {
    this.sky.position.copy(this.camera.position);
    this.composer.render();
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          Object.values(m).forEach((v) => { if (v && v.isTexture) v.dispose(); });
          m.dispose();
        });
      }
    });
    this.composer.dispose?.();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
