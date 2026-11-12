import * as THREE from 'three';

const STORAGE_KEY = 'neon-drift:records:v1';

/**
 * CheckpointManager — ordered trigger gates, lap/sector timing, wrong-way detection
 * and best-lap / best-drift persistence in localStorage.
 */
export class CheckpointManager {
  constructor(sceneManager, track, { count = 8, totalLaps = 3 } = {}) {
    this.scene = sceneManager.scene;
    this.track = track;
    this.count = count;
    this.totalLaps = totalLaps;
    this.indices = [];
    for (let k = 0; k < count; k++) this.indices.push(Math.floor((k / count) * track.sampleCount));
    this.group = new THREE.Group();
    this.listeners = {};
    this.records = this._load();
    this._buildGates();
    this.reset();
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  _emit(evt, data) { (this.listeners[evt] || []).forEach((fn) => fn(data)); }

  _load() {
    try {
      const r = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return { bestLap: r.bestLap ?? null, bestDrift: r.bestDrift ?? 0, bestSectors: r.bestSectors ?? [] };
    } catch {
      return { bestLap: null, bestDrift: 0, bestSectors: [] };
    }
  }

  _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records)); } catch { /* private mode */ }
  }

  _buildGates() {
    const t = this.track;
    this.gates = [];
    const geo = new THREE.PlaneGeometry(t.width, 6);
    for (let k = 0; k < this.count; k++) {
      const i = this.indices[k];
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x22f3ff) }, uActive: { value: 0 } },
        vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: /* glsl */`
          uniform float uTime, uActive; uniform vec3 uColor; varying vec2 vUv;
          void main(){
            float scan = 0.5 + 0.5 * sin(vUv.y * 40.0 - uTime * 8.0);
            float edge = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x);
            float fade = (1.0 - vUv.y) * edge;
            float a = fade * (0.05 + scan * 0.12) * (0.35 + uActive * 0.9);
            gl_FragColor = vec4(uColor * 1.6, a);
          }`,
      });
      const gate = new THREE.Mesh(geo, mat);
      const basis = new THREE.Matrix4().makeBasis(t.sides[i], t.normals[i], t.tangents[i].clone().negate());
      gate.quaternion.setFromRotationMatrix(basis);
      gate.position.copy(t.points[i]).addScaledVector(t.normals[i], 3);
      this.group.add(gate);
      this.gates.push(gate);
    }
    this.scene.add(this.group);
  }

  reset() {
    this.lap = 0;            // 0 = before crossing the start line
    this.nextCp = 0;
    this.lapTime = 0;
    this.totalTime = 0;
    this.lastLapTime = null;
    this.sectorTimes = [];
    this.lastSplit = null;   // { sector, time, delta }
    this.wrongWay = false;
    this._wrongTimer = 0;
    this.trackIndex = -1;
    this.finished = false;
    this.started = false;
  }

  /** Called every fixed step with car position & velocity (THREE.Vector3). */
  update(dt, carPos, carVel) {
    const t = this.track, N = t.sampleCount;
    this.trackIndex = t.nearestIndex(carPos, this.trackIndex);
    const idx = this.trackIndex;

    if (this.started && !this.finished) {
      this.lapTime += dt;
      this.totalTime += dt;
    }

    // Gate crossing: within a small forward window of the expected checkpoint.
    const target = this.indices[this.nextCp];
    const ahead = (idx - target + N) % N;
    if (ahead >= 0 && ahead < 20) this._passCheckpoint();

    // Wrong-way detection
    const along = carVel.dot(t.tangents[idx]);
    if (along < -4) this._wrongTimer += dt; else this._wrongTimer = Math.max(0, this._wrongTimer - dt * 2);
    const ww = this._wrongTimer > 1.2;
    if (ww !== this.wrongWay) { this.wrongWay = ww; this._emit('wrongway', ww); }

    // Gate visuals
    for (let k = 0; k < this.gates.length; k++) {
      const u = this.gates[k].material.uniforms;
      u.uTime.value += dt;
      u.uActive.value = k === this.nextCp ? 1 : 0;
      u.uColor.value.set(k === 0 ? 0xff2bd6 : 0x22f3ff);
    }
  }

  _passCheckpoint() {
    const cp = this.nextCp;
    if (cp === 0) {
      if (!this.started) {
        this.started = true;
        this.lap = 1;
        this.lapTime = 0;
        this._emit('start', {});
      } else {
        this._completeLap();
      }
    } else {
      const sectorIdx = cp - 1;
      const time = this.lapTime;
      const best = this.records.bestSectors[sectorIdx];
      this.lastSplit = { sector: cp, time, delta: best != null ? time - best : null };
      this.sectorTimes[sectorIdx] = time;
      this._emit('checkpoint', this.lastSplit);
    }
    this.nextCp = (this.nextCp + 1) % this.count;
  }

  _completeLap() {
    const lapTime = this.lapTime;
    const isBest = this.records.bestLap == null || lapTime < this.records.bestLap;
    if (isBest) {
      this.records.bestLap = lapTime;
      this.records.bestSectors = this.sectorTimes.slice();
    }
    this._save();
    this.lastLapTime = lapTime;
    this._emit('lap', { lap: this.lap, time: lapTime, isBest });
    this.sectorTimes = [];
    this.lapTime = 0;
    if (this.lap >= this.totalLaps) {
      this.finished = true;
      this._emit('finish', { total: this.totalTime });
    } else {
      this.lap++;
    }
  }

  /** Persist a drift score if it's a new record. Returns true when it was. */
  submitDriftScore(score) {
    if (score > this.records.bestDrift) {
      this.records.bestDrift = Math.floor(score);
      this._save();
      return true;
    }
    return false;
  }

  /** Progress 0..1 around the lap (for HUD / AI comparisons). */
  get progress() {
    return this.trackIndex < 0 ? 0 : this.trackIndex / this.track.sampleCount;
  }

  /** Index of the last checkpoint passed — used for respawns. */
  get lastCheckpointIndex() {
    const k = (this.nextCp - 1 + this.count) % this.count;
    return this.started ? this.indices[k] + 2 : this.track.sampleCount - 14;
  }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.scene.remove(this.group);
  }
}
