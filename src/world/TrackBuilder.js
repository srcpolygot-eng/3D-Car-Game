import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/**
 * TrackBuilder — spline-driven road generator.
 *
 * Builds a closed Catmull-Rom loop with elevation, curvature-based banking,
 * neon curbs, guardrails (static physics), ramps, boost pads and support pillars.
 * Exposes a sampled frame table used by checkpoints, AI, mini-map and props.
 */
export class TrackBuilder {
  constructor(sceneManager, physics) {
    this.sceneManager = sceneManager;
    this.scene = sceneManager.scene;
    this.physics = physics;
    this.width = 16;
    this.sampleCount = 1100;
    this.group = new THREE.Group();
    this.group.name = 'Track';
    this.bodies = [];
    this.boostPads = [];
    this.ramps = [];

    // x, y(elevation), z
    const ctrl = [
      [0, 0.3, 0], [140, 1, 0], [260, 5, -10], [340, 9, -70], [352, 10, -170],
      [300, 9, -242], [210, 6, -252], [150, 3, -200], [90, 1, -232], [20, 0.3, -300],
      [-80, 0.3, -302], [-170, 0.3, -262], [-205, 0.3, -185], [-150, 0.3, -130],
      [-212, 2, -70], [-200, 4, 10], [-130, 2, 42], [-60, 0.5, 22],
    ];
    this.curve = new THREE.CatmullRomCurve3(
      ctrl.map(([x, y, z]) => new THREE.Vector3(x, y, z)), true, 'centripetal', 0.5,
    );
    this.length = this.curve.getLength();
    this._sample();
  }

  _sample() {
    const N = this.sampleCount;
    const pts = this.curve.getSpacedPoints(N); // N+1, last == first
    pts.pop();
    this.points = pts;
    this.tangents = [];
    this.sides = [];
    this.normals = [];
    this.banks = [];
    this.distances = [];
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < N; i++) {
      const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
      this.tangents.push(b.clone().sub(a).normalize());
    }
    // Signed curvature (positive = left turn), smoothed.
    const curv = new Array(N).fill(0);
    const seg = this.length / N;
    for (let i = 0; i < N; i++) {
      const t0 = this.tangents[i], t1 = this.tangents[(i + 1) % N];
      curv[i] = (t0.z * t1.x - t0.x * t1.z) / seg;
    }
    const smooth = new Array(N).fill(0);
    const W = 14;
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -W; k <= W; k++) s += curv[(i + k + N) % N];
      smooth[i] = s / (2 * W + 1);
    }
    let dist = 0;
    for (let i = 0; i < N; i++) {
      const t = this.tangents[i];
      const side = new THREE.Vector3().crossVectors(t, up).normalize(); // right-hand side
      const bank = THREE.MathUtils.clamp(smooth[i] * 4.5, -0.16, 0.16);
      const normal = new THREE.Vector3().crossVectors(side, t).normalize();
      normal.applyAxisAngle(t, -bank);
      side.applyAxisAngle(t, -bank);
      this.sides.push(side);
      this.normals.push(normal);
      this.banks.push(bank);
      this.distances.push(dist);
      dist += pts[i].distanceTo(pts[(i + 1) % N]);
    }
  }

  /** Returns {pos, tangent, side, normal} at a continuous sample index with lateral offset. */
  getFrame(index, lateral = 0, out = {}) {
    const N = this.sampleCount;
    const i0 = ((Math.floor(index) % N) + N) % N;
    const i1 = (i0 + 1) % N;
    const f = index - Math.floor(index);
    out.pos = (out.pos || new THREE.Vector3()).lerpVectors(this.points[i0], this.points[i1], f);
    out.tangent = (out.tangent || new THREE.Vector3()).lerpVectors(this.tangents[i0], this.tangents[i1], f).normalize();
    out.side = (out.side || new THREE.Vector3()).lerpVectors(this.sides[i0], this.sides[i1], f).normalize();
    out.normal = (out.normal || new THREE.Vector3()).lerpVectors(this.normals[i0], this.normals[i1], f).normalize();
    out.pos.addScaledVector(out.side, lateral);
    return out;
  }

  /** Nearest sample index to world position. Uses a local window around `hint` when given. */
  nearestIndex(pos, hint = -1) {
    const N = this.sampleCount;
    let best = -1, bestD = Infinity;
    if (hint >= 0) {
      for (let k = -40; k <= 40; k++) {
        const i = (hint + k + N) % N;
        const d = this.points[i].distanceToSquared(pos);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (bestD < 40 * 40) return best;
    }
    for (let i = 0; i < N; i++) {
      const d = this.points[i].distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** Signed lateral offset of pos relative to the centerline at index. */
  lateralOffset(pos, index) {
    return this._tmp.copy(pos).sub(this.points[index]).dot(this.sides[index]);
  }

  build() {
    this._tmp = new THREE.Vector3();
    this._buildRoad();
    this._buildCurbs();
    this._buildGuardrails();
    this._buildPillars();
    this._buildRamps([0.135, 0.58]);
    this._buildBoostPads([0.04, 0.3, 0.47, 0.76]);
    this._buildStartGate();
    this.scene.add(this.group);
    return this;
  }

  _roadTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 1024;
    const g = c.getContext('2d');
    g.fillStyle = '#17141f';
    g.fillRect(0, 0, 512, 1024);
    // asphalt grain
    const img = g.getImageData(0, 0, 512, 1024);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() * 26) | 0;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n + 4;
    }
    g.putImageData(img, 0, 0);
    // tire marks
    g.globalAlpha = 0.18;
    g.fillStyle = '#000';
    for (const x of [120, 180, 330, 390]) g.fillRect(x, 0, 26, 1024);
    g.globalAlpha = 1;
    // edge lines
    g.fillStyle = '#e8e4ff';
    g.fillRect(18, 0, 10, 1024);
    g.fillRect(484, 0, 10, 1024);
    // dashed lanes
    g.fillStyle = '#ffd36b';
    for (let y = 0; y < 1024; y += 256) {
      g.fillRect(170, y, 8, 140);
      g.fillRect(334, y, 8, 140);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  _buildRoad() {
    const N = this.sampleCount, hw = this.width / 2;
    const pos = new Float32Array(N * 2 * 3 + 6);
    const uv = new Float32Array(N * 2 * 2 + 4);
    const idx = [];
    const skirtPos = [];
    const skirtIdx = [];
    const v = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      const ii = i % N;
      const p = this.points[ii], s = this.sides[ii];
      const L = v.copy(p).addScaledVector(s, -hw);
      pos.set([L.x, L.y, L.z], i * 6);
      const R = v.copy(p).addScaledVector(s, hw);
      pos.set([R.x, R.y, R.z], i * 6 + 3);
      const vv = (i === N ? this.length : this.distances[ii]) / 24;
      uv.set([0, vv, 1, vv], i * 4);
      if (i < N) {
        const a = i * 2, b = a + 1, c2 = a + 2, d = a + 3;
        idx.push(a, b, c2, b, d, c2);
      }
      // deck skirt (visual thickness)
      for (const side of [-1, 1]) {
        const e = v.copy(p).addScaledVector(s, hw * side);
        skirtPos.push(e.x, e.y, e.z, e.x, e.y - 1.4, e.z);
      }
      if (i < N) {
        const base = i * 4;
        // left skirt (faces outward -side), right skirt (faces +side)
        skirtIdx.push(base, base + 4, base + 1, base + 1, base + 4, base + 5);
        skirtIdx.push(base + 2, base + 3, base + 6, base + 3, base + 7, base + 6);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      map: this._roadTexture(), roughness: 0.42, metalness: 0.35, color: 0xb8b0d8,
    });
    this.roadMesh = new THREE.Mesh(geo, mat);
    this.roadMesh.receiveShadow = true;
    this.group.add(this.roadMesh);

    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPos, 3));
    sgeo.setIndex(skirtIdx);
    sgeo.computeVertexNormals();
    const skirt = new THREE.Mesh(sgeo, new THREE.MeshStandardMaterial({ color: 0x2a2040, roughness: 0.8, side: THREE.DoubleSide }));
    this.group.add(skirt);

    // Physics: one static trimesh for the whole ribbon (wheels raycast against this).
    const verts = Array.from(pos.slice(0, (N + 1) * 6));
    const shape = new CANNON.Trimesh(verts, idx);
    const body = new CANNON.Body({ mass: 0, material: this.physics.materials.ground });
    body.addShape(shape);
    body.userData = { type: 'road' };
    this.physics.addBody(body);
    this.bodies.push(body);
  }

  _buildCurbs() {
    const N = this.sampleCount, hw = this.width / 2;
    const positions = [], colors = [], indices = [];
    const pink = new THREE.Color(0xff2bd6), cyan = new THREE.Color(0x22f3ff), white = new THREE.Color(0xffffff);
    const v = new THREE.Vector3();
    let vi = 0;
    for (const sideSign of [-1, 1]) {
      for (let i = 0; i <= N; i++) {
        const ii = i % N;
        const p = this.points[ii], s = this.sides[ii], n = this.normals[ii];
        const inner = v.copy(p).addScaledVector(s, sideSign * (hw - 0.55)).addScaledVector(n, 0.03);
        positions.push(inner.x, inner.y, inner.z);
        const outer = v.copy(p).addScaledVector(s, sideSign * hw).addScaledVector(n, 0.03);
        positions.push(outer.x, outer.y, outer.z);
        const curvy = Math.abs(this.banks[ii]) > 0.05;
        const stripe = Math.floor(i / 3) % 2 === 0;
        const col = curvy ? (stripe ? pink : white) : (sideSign < 0 ? cyan : pink);
        const k = curvy ? 1.6 : 1.1;
        colors.push(col.r * k, col.g * k, col.b * k, col.r * k, col.g * k, col.b * k);
        if (i < N) {
          const a = vi, b = vi + 1, c = vi + 2, d = vi + 3;
          if (sideSign > 0) indices.push(a, b, c, b, d, c);
          else indices.push(a, c, b, b, c, d);
        }
        vi += 2;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide }));
    this.group.add(mesh);
  }

  _buildGuardrails() {
    const N = this.sampleCount, hw = this.width / 2 + 0.4;
    const step = 4;
    const count = Math.ceil(N / step) * 2;
    const railGeo = new THREE.BoxGeometry(1, 1, 1);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x3a3550, metalness: 0.8, roughness: 0.35 });
    const glowGeo = new THREE.BoxGeometry(1, 1, 1);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const rails = new THREE.InstancedMesh(railGeo, railMat, count);
    const glows = new THREE.InstancedMesh(glowGeo, glowMat, count);
    rails.castShadow = true;
    rails.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), mid = new THREE.Vector3(), dir = new THREE.Vector3();
    const basis = new THREE.Matrix4(), upv = new THREE.Vector3(), sidev = new THREE.Vector3();
    const pinkC = new THREE.Color(0xff2bd6).multiplyScalar(2), cyanC = new THREE.Color(0x22f3ff).multiplyScalar(2);
    let n = 0;
    for (const sideSign of [-1, 1]) {
      for (let i = 0; i < N; i += step) {
        const j = Math.min(i + step, N) % N;
        a.copy(this.points[i]).addScaledVector(this.sides[i], sideSign * hw);
        b.copy(this.points[j]).addScaledVector(this.sides[j], sideSign * hw);
        mid.addVectors(a, b).multiplyScalar(0.5);
        dir.subVectors(b, a);
        const len = dir.length() + 0.15;
        dir.normalize();
        upv.set(0, 1, 0);
        sidev.crossVectors(upv, dir).normalize();
        upv.crossVectors(dir, sidev).normalize();
        basis.makeBasis(sidev, upv, dir);
        q.setFromRotationMatrix(basis);

        const h = 1.1, t = 0.35;
        const center = mid.clone().addScaledVector(upv, h / 2);
        m.compose(center, q, sc.set(t, h, len));
        rails.setMatrixAt(n, m);
        const gc = center.clone().addScaledVector(upv, h / 2 + 0.03);
        m.compose(gc, q, sc.set(t + 0.04, 0.08, len));
        glows.setMatrixAt(n, m);
        glows.setColorAt(n, sideSign < 0 ? cyanC : pinkC);
        n++;

        const body = new CANNON.Body({ mass: 0, material: this.physics.materials.wall });
        body.addShape(new CANNON.Box(new CANNON.Vec3(t / 2 + 0.1, h / 2 + 0.4, len / 2)));
        body.position.set(center.x, center.y + 0.3, center.z);
        body.quaternion.set(q.x, q.y, q.z, q.w);
        body.userData = { type: 'wall' };
        this.physics.addBody(body);
        this.bodies.push(body);
      }
    }
    rails.count = n; glows.count = n;
    rails.instanceMatrix.needsUpdate = true;
    glows.instanceMatrix.needsUpdate = true;
    if (glows.instanceColor) glows.instanceColor.needsUpdate = true;
    this.group.add(rails, glows);
  }

  _buildPillars() {
    const N = this.sampleCount;
    const list = [];
    for (let i = 0; i < N; i += 18) if (this.points[i].y > 1.6) list.push(i);
    if (!list.length) return;
    const geo = new THREE.CylinderGeometry(0.9, 1.2, 1, 10);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b2440, roughness: 0.7, metalness: 0.2 });
    const ringGeo = new THREE.TorusGeometry(1.0, 0.08, 6, 16);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff3df0, toneMapped: false });
    const inst = new THREE.InstancedMesh(geo, mat, list.length * 2);
    const rings = new THREE.InstancedMesh(ringGeo, ringMat, list.length * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qr = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    let n = 0;
    for (const i of list) {
      for (const s of [-0.55, 0.55]) {
        const p = this.points[i].clone().addScaledVector(this.sides[i], s * this.width * 0.7);
        const h = p.y - 1.2;
        m.compose(new THREE.Vector3(p.x, h / 2 - 0.05, p.z), q, new THREE.Vector3(1, h, 1));
        inst.setMatrixAt(n, m);
        m.compose(new THREE.Vector3(p.x, h * 0.6, p.z), qr, new THREE.Vector3(1.1, 1.1, 1.1));
        rings.setMatrixAt(n, m);
        n++;
      }
    }
    inst.castShadow = true;
    this.group.add(inst, rings);
  }

  _frameQuat(i) {
    const basis = new THREE.Matrix4().makeBasis(this.sides[i], this.normals[i], this.tangents[i].clone().negate());
    return new THREE.Quaternion().setFromRotationMatrix(basis);
  }

  _buildRamps(fractions) {
    const angle = 0.2; // ~11.5 degrees
    const halfLen = 5, halfW = 3.2, halfH = 0.25;
    for (const [k, f] of fractions.entries()) {
      const i = Math.floor(f * this.sampleCount);
      const lateral = k % 2 === 0 ? -3.2 : 3.2;
      const p = this.points[i].clone().addScaledVector(this.sides[i], lateral);
      // Orientation: local +Z = backwards along track; tilt so far end (−Z, forward) rises.
      const q = this._frameQuat(i).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle));
      const center = p.clone().addScaledVector(this.normals[i], Math.sin(angle) * halfLen - halfH * Math.cos(angle) + 0.05);

      const geo = new THREE.BoxGeometry(halfW * 2, halfH * 2, halfLen * 2);
      const mat = new THREE.MeshStandardMaterial({ color: 0x302a48, metalness: 0.5, roughness: 0.4, emissive: 0x2a0050, emissiveIntensity: 0.6 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(center);
      mesh.quaternion.copy(q);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Chevron stripes
      const chevGeo = new THREE.PlaneGeometry(halfW * 1.6, 0.35);
      const chevMat = new THREE.MeshBasicMaterial({ color: 0xffb627, toneMapped: false });
      for (let c = -3; c <= 3; c++) {
        const chev = new THREE.Mesh(chevGeo, chevMat);
        chev.rotation.x = -Math.PI / 2;
        chev.position.set(0, halfH + 0.01, c * 1.3);
        mesh.add(chev);
      }
      this.group.add(mesh);

      const body = new CANNON.Body({ mass: 0, material: this.physics.materials.ground });
      body.addShape(new CANNON.Box(new CANNON.Vec3(halfW, halfH, halfLen)));
      body.position.set(center.x, center.y, center.z);
      body.quaternion.set(q.x, q.y, q.z, q.w);
      body.userData = { type: 'ramp' };
      this.physics.addBody(body);
      this.bodies.push(body);
      this.ramps.push({ index: i, position: center });
    }
  }

  _buildBoostPads(fractions) {
    const tex = (() => {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = '#0a0020';
      g.fillRect(0, 0, 128, 256);
      g.strokeStyle = '#22f3ff';
      g.lineWidth = 14;
      for (let y = 30; y < 256; y += 70) {
        g.beginPath(); g.moveTo(14, y + 40); g.lineTo(64, y); g.lineTo(114, y + 40); g.stroke();
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    for (const [k, f] of fractions.entries()) {
      const i = Math.floor(f * this.sampleCount);
      const lateral = [2.5, -2.5, 0, 3][k % 4];
      const p = this.points[i].clone().addScaledVector(this.sides[i], lateral).addScaledVector(this.normals[i], 0.05);
      const mat = new THREE.MeshBasicMaterial({ map: tex.clone(), toneMapped: false, color: 0xffffff, transparent: true, opacity: 0.95 });
      mat.map.needsUpdate = true;
      mat.color.setScalar(1.8);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 8), mat);
      const q = this._frameQuat(i).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      mesh.quaternion.copy(q);
      mesh.position.copy(p);
      this.group.add(mesh);
      this.boostPads.push({ index: i, position: p, lateral, halfW: 2.2, halfL: 4.2, mesh, cooldown: 0 });
    }
  }

  _buildStartGate() {
    const i = 0;
    const p = this.points[i];
    const q = this._frameQuat(i);
    const gate = new THREE.Group();
    gate.position.copy(p);
    gate.quaternion.copy(q);
    const postGeo = new THREE.BoxGeometry(0.8, 9, 0.8);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1b1530, metalness: 0.7, roughness: 0.3 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(s * (this.width / 2 + 1.5), 4.5, 0);
      gate.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(this.width + 4, 1.4, 0.6), postMat);
    beam.position.y = 9;
    gate.add(beam);
    const neon = new THREE.Mesh(new THREE.BoxGeometry(this.width + 3, 0.18, 0.7), new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false }));
    neon.position.y = 8.2;
    gate.add(neon);
    // Checkered start line
    const c = document.createElement('canvas');
    c.width = 256; c.height = 32;
    const g = c.getContext('2d');
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#fff' : '#111';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(this.width, 2),
      new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), roughness: 0.6 }),
    );
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.04;
    gate.add(line);
    // Sign text
    const sc = document.createElement('canvas');
    sc.width = 1024; sc.height = 128;
    const sg = sc.getContext('2d');
    sg.fillStyle = '#05010d';
    sg.fillRect(0, 0, 1024, 128);
    sg.font = 'bold italic 92px Arial';
    sg.textAlign = 'center';
    sg.fillStyle = '#22f3ff';
    sg.shadowColor = '#22f3ff';
    sg.shadowBlur = 20;
    sg.fillText('NEON DRIFT', 512, 98);
    const stex = new THREE.CanvasTexture(sc);
    stex.colorSpace = THREE.SRGBColorSpace;
    for (const face of [1, -1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(this.width + 3, 1.3), new THREE.MeshBasicMaterial({ map: stex, toneMapped: false }));
      sign.position.set(0, 9, face * 0.32);
      if (face < 0) sign.rotation.y = Math.PI;
      gate.add(sign);
    }
    this.group.add(gate);
  }

  /** Spawn transform at given sample index. */
  getSpawn(index = 6, lateral = 0) {
    const f = this.getFrame(index, lateral);
    const yaw = Math.atan2(-f.tangent.x, -f.tangent.z); // car forward is local −Z
    return { position: f.pos.clone().addScaledVector(f.normal, 1.2), yaw, index };
  }

  dispose() {
    for (const b of this.bodies) this.physics.removeBody(b);
    this.bodies.length = 0;
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    this.scene.remove(this.group);
  }
}
