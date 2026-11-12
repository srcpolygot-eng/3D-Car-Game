import * as THREE from 'three';

const VERT = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */`
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uSoft;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = (1.0 - smoothstep(uSoft, 0.5, d)) * vAlpha;
    gl_FragColor = vec4(vColor, a);
  }
`;

/** A pooled CPU-simulated point-sprite emitter. */
class ParticlePool {
  constructor(max, { additive = false, soft = 0.0 } = {}) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.startSize = new Float32Array(max);
    this.endSize = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.startAlpha = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aColor', this.colAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 400 }, uSoft: { value: soft } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.geometry = geo;
  }

  emit(p, v, { life = 1, size = 1, endSize = size, color = [1, 1, 1], alpha = 1, drag = 1, gravity = 0 }) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = p.x; this.pos[i3 + 1] = p.y; this.pos[i3 + 2] = p.z;
    this.vel[i3] = v.x; this.vel[i3 + 1] = v.y; this.vel[i3 + 2] = v.z;
    this.col[i3] = color[0]; this.col[i3 + 1] = color[1]; this.col[i3 + 2] = color[2];
    this.life[i] = life; this.maxLife[i] = life;
    this.startSize[i] = size; this.endSize[i] = endSize;
    this.startAlpha[i] = alpha;
    this.drag[i] = drag; this.gravity[i] = gravity;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - Math.max(this.life[i], 0) / this.maxLife[i];
      const i3 = i * 3;
      const damp = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= damp; this.vel[i3 + 1] = this.vel[i3 + 1] * damp - this.gravity[i] * dt; this.vel[i3 + 2] *= damp;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] = this.startSize[i] + (this.endSize[i] - this.startSize[i]) * t;
      this.alpha[i] = this.startAlpha[i] * (1 - t) * Math.min(1, t * 8 + 0.2);
    }
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  clear() { this.life.fill(0); }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}

/** Ring-buffer skid mark ribbons laid under sliding tires. */
class SkidMarks {
  constructor(maxSegments = 2400) {
    this.max = maxSegments;
    this.cursor = 0;
    this.positions = new Float32Array(maxSegments * 4 * 3);
    this.alphas = new Float32Array(maxSegments * 4);
    const idx = new Uint32Array(maxSegments * 6);
    for (let i = 0; i < maxSegments; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.02,0.0,0.03, vA * 0.75); }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.geometry = geo;
    this.last = [null, null, null, null];
    this._side = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /** Add a segment for wheel `w` at contact point p with intensity a (0..1). Pass null p to break the trail. */
  add(w, p, a) {
    if (!p || a <= 0.02) { this.last[w] = null; return; }
    const prev = this.last[w];
    if (!prev) { this.last[w] = p.clone(); return; }
    const d = prev.distanceTo(p);
    if (d < 0.25) return;
    if (d > 4) { this.last[w].copy(p); return; }
    const dir = p.clone().sub(prev).normalize();
    const side = this._side.crossVectors(dir, this._up).normalize().multiplyScalar(0.14);
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const o = i * 12;
    const lift = 0.025;
    this.positions.set([
      prev.x - side.x, prev.y + lift, prev.z - side.z,
      prev.x + side.x, prev.y + lift, prev.z + side.z,
      p.x - side.x, p.y + lift, p.z - side.z,
      p.x + side.x, p.y + lift, p.z + side.z,
    ], o);
    this.alphas.set([a, a, a, a], i * 4);
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    prev.copy(p);
  }

  clear() {
    this.positions.fill(0);
    this.alphas.fill(0);
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.last = [null, null, null, null];
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}

/**
 * ParticleSystem — tire smoke, drift sparks, nitro exhaust trails, impact debris and skid marks.
 */
export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new ParticlePool(1400, { additive: false, soft: 0.0 });
    this.glow = new ParticlePool(1600, { additive: true, soft: 0.1 });
    this.skids = new SkidMarks();
    scene.add(this.smoke.points, this.glow.points, this.skids.mesh);
    this._v = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  setPixelScale(height) {
    const s = height * 0.6;
    this.smoke.material.uniforms.uScale.value = s;
    this.glow.material.uniforms.uScale.value = s;
  }

  /** Tire smoke puff. `tint` lets drift smoke pick up the neon palette. */
  tireSmoke(pos, carVel, intensity, tint = [0.75, 0.7, 0.85]) {
    const v = this._v.set(
      carVel.x * 0.15 + (Math.random() - 0.5) * 2.5,
      1.0 + Math.random() * 1.6,
      carVel.z * 0.15 + (Math.random() - 0.5) * 2.5,
    );
    this.smoke.emit(pos, v, {
      life: 1.2 + Math.random() * 1.2,
      size: 0.8 + intensity * 0.6,
      endSize: 4.5 + intensity * 3,
      color: tint,
      alpha: 0.22 + intensity * 0.28,
      drag: 1.6,
      gravity: -0.6,
    });
  }

  sparks(pos, dir, count = 6, color = [3.0, 1.6, 0.4]) {
    for (let i = 0; i < count; i++) {
      const v = this._v.set(
        dir.x * (4 + Math.random() * 6) + (Math.random() - 0.5) * 5,
        Math.random() * 4 + 1,
        dir.z * (4 + Math.random() * 6) + (Math.random() - 0.5) * 5,
      );
      this.glow.emit(pos, v, { life: 0.25 + Math.random() * 0.35, size: 0.12, endSize: 0.02, color, alpha: 1, drag: 1.2, gravity: 14 });
    }
  }

  nitroFlame(pos, backDir, carVel) {
    for (let i = 0; i < 3; i++) {
      const sp = 6 + Math.random() * 6;
      const v = this._v.set(
        carVel.x + backDir.x * sp + (Math.random() - 0.5) * 1.2,
        carVel.y + backDir.y * sp + (Math.random() - 0.5) * 1.2,
        carVel.z + backDir.z * sp + (Math.random() - 0.5) * 1.2,
      );
      const hot = Math.random();
      const color = hot > 0.6 ? [1.2, 1.2, 3.5] : [1.4, 0.3, 3.0];
      this.glow.emit(pos, v, { life: 0.18 + Math.random() * 0.15, size: 0.55, endSize: 0.1, color, alpha: 0.9, drag: 4, gravity: 0 });
    }
  }

  exhaustPuff(pos, carVel) {
    const v = this._v.set(carVel.x * 0.4, 0.4, carVel.z * 0.4);
    this.smoke.emit(pos, v, { life: 0.6, size: 0.25, endSize: 0.9, color: [0.4, 0.38, 0.5], alpha: 0.12, drag: 2, gravity: -0.3 });
  }

  impactBurst(pos, strength) {
    const n = Math.min(40, 6 + Math.floor(strength * 2));
    for (let i = 0; i < n; i++) {
      const v = this._v.set((Math.random() - 0.5) * 10, Math.random() * 7, (Math.random() - 0.5) * 10);
      this.glow.emit(pos, v, { life: 0.3 + Math.random() * 0.4, size: 0.15, endSize: 0.02, color: [3, 2, 0.8], alpha: 1, drag: 1, gravity: 16 });
    }
    for (let i = 0; i < n / 3; i++) {
      const v = this._v.set((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3);
      this.smoke.emit(pos, v, { life: 1.4, size: 1.2, endSize: 4, color: [0.5, 0.45, 0.6], alpha: 0.3, drag: 1.5, gravity: -0.4 });
    }
  }

  boostPadBurst(pos) {
    for (let i = 0; i < 30; i++) {
      const v = this._v.set((Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6);
      this.glow.emit(pos, v, { life: 0.6, size: 0.35, endSize: 0.05, color: [0.4, 2.4, 3.0], alpha: 1, drag: 2, gravity: 2 });
    }
  }

  update(dt) {
    this.smoke.update(dt);
    this.glow.update(dt);
  }

  clear() {
    this.smoke.clear();
    this.glow.clear();
    this.skids.clear();
  }

  dispose() {
    this.scene.remove(this.smoke.points, this.glow.points, this.skids.mesh);
    this.smoke.dispose();
    this.glow.dispose();
    this.skids.dispose();
  }
}
