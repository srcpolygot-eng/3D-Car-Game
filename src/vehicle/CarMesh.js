import * as THREE from 'three';

/** 3-step toon ramp for the cel-shaded look. */
function makeToonRamp() {
  const data = new Uint8Array([70, 70, 70, 255, 160, 160, 160, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
let sharedRamp = null;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * CarMesh — fully procedural stylized sports car. Faces local −Z.
 *
 * Hierarchy: root (follows physics) → body (visual pitch/roll) + wheels (suspension/steer/spin).
 */
export class CarMesh {
  /**
   * @param {object} o
   * @param {number} [o.color] paint
   * @param {number} [o.accent] neon accent / underglow
   * @param {boolean} [o.lights] add real light sources (player only)
   */
  constructor({ color = 0x7a1cff, accent = 0x22f3ff, lights = false } = {}) {
    sharedRamp ||= makeToonRamp();
    this.root = new THREE.Group();
    this.root.name = 'Car';
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.disposables = [];
    this.wheels = [];
    this.wheelRadius = 0.36;
    this.wheelPositions = [
      new THREE.Vector3(-0.92, -0.05, -1.36), new THREE.Vector3(0.92, -0.05, -1.36),
      new THREE.Vector3(-0.92, -0.05, 1.32), new THREE.Vector3(0.92, -0.05, 1.32),
    ];
    this.exhaustPoints = [new THREE.Vector3(-0.42, -0.12, 2.3), new THREE.Vector3(0.42, -0.12, 2.3)];
    this.accentColor = new THREE.Color(accent);

    this._buildBody(color, accent);
    this._buildWheels();
    this._buildUnderglow(accent, lights);
    if (lights) this._buildHeadlights();
    this.root.traverse((o) => { if (o.isMesh && !o.userData.noShadow) { o.castShadow = true; } });
  }

  _mat(m) { this.disposables.push(m); return m; }
  _geo(g) { this.disposables.push(g); return g; }

  _extrude(points, width, bevel = 0.06) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4,
    });
    geo.translate(0, 0, -width / 2);
    geo.rotateY(Math.PI / 2); // shape +X (front) → world −Z
    geo.computeVertexNormals();
    return this._geo(geo);
  }

  _buildBody(color, accent) {
    const paint = this._mat(new THREE.MeshToonMaterial({ color, gradientMap: sharedRamp }));
    const dark = this._mat(new THREE.MeshToonMaterial({ color: 0x12101a, gradientMap: sharedRamp }));
    const glass = this._mat(new THREE.MeshStandardMaterial({ color: 0x0a0a18, metalness: 0.9, roughness: 0.08, emissive: 0x150a30 }));
    const outline = this._mat(new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
    const neon = this._mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(2.5), toneMapped: false }));

    // Lower body side profile (x = forward)
    const lower = [
      [2.28, -0.08], [2.22, 0.12], [1.9, 0.26], [0.9, 0.34], [-1.3, 0.37], [-2.12, 0.42],
      [-2.26, 0.16], [-2.22, -0.2], [-1.8, -0.26], [1.9, -0.26],
    ];
    const lowerGeo = this._extrude(lower, 1.74);
    const lowerMesh = new THREE.Mesh(lowerGeo, paint);
    this.body.add(lowerMesh);
    const lowerOutline = new THREE.Mesh(lowerGeo, outline);
    lowerOutline.scale.setScalar(1.035);
    lowerOutline.userData.noShadow = true;
    this.body.add(lowerOutline);

    // Cabin / greenhouse
    const cabin = [[0.95, 0.34], [0.15, 0.74], [-0.75, 0.76], [-1.55, 0.4], [-1.55, 0.34]];
    const cabinGeo = this._extrude(cabin, 1.36, 0.08);
    const cabinMesh = new THREE.Mesh(cabinGeo, glass);
    this.body.add(cabinMesh);
    const cabinOutline = new THREE.Mesh(cabinGeo, outline);
    cabinOutline.scale.setScalar(1.03);
    cabinOutline.userData.noShadow = true;
    this.body.add(cabinOutline);
    // Roof panel in paint
    const roof = new THREE.Mesh(this._geo(new THREE.BoxGeometry(1.3, 0.05, 0.85)), paint);
    roof.position.set(0, 0.83, 0.3);
    this.body.add(roof);

    // Hood stripe
    const stripe = new THREE.Mesh(this._geo(new THREE.BoxGeometry(0.34, 0.02, 1.4)), this._mat(new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: sharedRamp })));
    stripe.position.set(0, 0.36, -1.45);
    stripe.rotation.x = -0.08;
    this.body.add(stripe);

    // Side skirts with neon line
    for (const s of [-1, 1]) {
      const skirt = new THREE.Mesh(this._geo(new THREE.BoxGeometry(0.12, 0.14, 2.6)), dark);
      skirt.position.set(s * 0.93, -0.22, 0);
      this.body.add(skirt);
      const line = new THREE.Mesh(this._geo(new THREE.BoxGeometry(0.03, 0.03, 2.5)), neon);
      line.position.set(s * 1.0, -0.2, 0);
      line.userData.noShadow = true;
      this.body.add(line);
      // Fender flares over wheels
      for (const z of [-1.36, 1.32]) {
        const flare = new THREE.Mesh(this._geo(new THREE.CylinderGeometry(0.46, 0.46, 0.22, 16, 1, true, 0, Math.PI)), dark);
        flare.rotation.z = Math.PI / 2;
        flare.rotation.y = 0;
        flare.position.set(s * 0.9, -0.05, z);
        this.body.add(flare);
      }
      // Mirrors
      const mirror = new THREE.Mesh(this._geo(new THREE.BoxGeometry(0.18, 0.1, 0.16)), paint);
      mirror.position.set(s * 0.82, 0.52, -0.55);
      this.body.add(mirror);
    }

    // Front splitter + rear diffuser
    const splitter = new THREE.Mesh(this._geo(new THREE.BoxGeometry(1.86, 0.05, 0.35)), dark);
    splitter.position.set(0, -0.27, -2.18);
    this.body.add(splitter);
    const diffuser = new THREE.Mesh(this._geo(new THREE.BoxGeometry(1.6, 0.18, 0.3)), dark);
    diffuser.position.set(0, -0.2, 2.2);
    this.body.add(diffuser);

    // Spoiler
    const wing = new THREE.Mesh(this._geo(new THREE.BoxGeometry(1.9, 0.05, 0.42)), dark);
    wing.position.set(0, 0.86, 1.95);
    wing.rotation.x = 0.12;
    this.body.add(wing);
    for (const s of [-1, 1]) {
      const strut = new THREE.Mesh(this._geo(new THREE.BoxGeometry(0.06, 0.45, 0.2)), dark);
      strut.position.set(s * 0.55, 0.62, 1.95);
      this.body.add(strut);
      const end = new THREE.Mesh(this._geo(new THREE.BoxGeometry(0.04, 0.2, 0.5)), paint);
      end.position.set(s * 0.96, 0.84, 1.95);
      this.body.add(end);
    }
    const wingNeon = new THREE.Mesh(this._geo(new THREE.BoxGeometry(1.88, 0.02, 0.02)), neon);
    wingNeon.position.set(0, 0.885, 1.74);
    this.body.add(wingNeon);

    // Headlights (emissive)
    this.headMat = this._mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.7, 2.2), toneMapped: false }));
    for (const s of [-1, 1]) {
      const hl = new THREE.Mesh(this._geo(new THREE.BoxGeometry(0.5, 0.07, 0.08)), this.headMat);
      hl.position.set(s * 0.58, 0.16, -2.24);
      hl.rotation.x = 0.4;
      hl.userData.noShadow = true;
      this.body.add(hl);
    }
    // Taillight bar (brightens when braking)
    this.tailMat = this._mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.05, 0.12), toneMapped: false }));
    const tail = new THREE.Mesh(this._geo(new THREE.BoxGeometry(1.7, 0.07, 0.05)), this.tailMat);
    tail.position.set(0, 0.24, 2.27);
    tail.userData.noShadow = true;
    this.body.add(tail);
    for (const s of [-1, 1]) {
      const t2 = new THREE.Mesh(this._geo(new THREE.BoxGeometry(0.3, 0.14, 0.05)), this.tailMat);
      t2.position.set(s * 0.72, 0.18, 2.27);
      this.body.add(t2);
    }
    // Exhausts
    const chrome = this._mat(new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 1, roughness: 0.2 }));
    for (const p of this.exhaustPoints) {
      const pipe = new THREE.Mesh(this._geo(new THREE.CylinderGeometry(0.07, 0.08, 0.25, 10)), chrome);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.copy(p).add(new THREE.Vector3(0, 0, -0.1));
      this.body.add(pipe);
    }
    // Nitro flame cones (shown while boosting)
    this.flameMat = this._mat(new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.5, 0.4, 3.0), transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    this.flames = [];
    for (const p of this.exhaustPoints) {
      const g = this._geo(new THREE.ConeGeometry(0.11, 1, 10, 1, true));
      g.translate(0, 0.5, 0);
      g.rotateX(Math.PI / 2); // base at the pipe, tip points +Z (backwards)
      const flame = new THREE.Mesh(g, this.flameMat);
      flame.position.copy(p);
      flame.visible = false;
      flame.userData.noShadow = true;
      this.body.add(flame);
      this.flames.push(flame);
    }
  }

  _buildWheels() {
    const r = this.wheelRadius;
    const tireGeo = this._geo(new THREE.CylinderGeometry(r, r, 0.32, 24));
    tireGeo.rotateZ(Math.PI / 2);
    const rimGeo = this._geo(new THREE.CylinderGeometry(r * 0.66, r * 0.66, 0.34, 18));
    rimGeo.rotateZ(Math.PI / 2);
    const spokeGeo = this._geo(new THREE.BoxGeometry(0.35, 0.07, r * 1.25));
    const tireMat = this._mat(new THREE.MeshToonMaterial({ color: 0x15131c, gradientMap: sharedRamp }));
    const rimMat = this._mat(new THREE.MeshStandardMaterial({ color: 0xd8d8ff, metalness: 1, roughness: 0.25 }));
    const ringMat = this._mat(new THREE.MeshBasicMaterial({ color: this.accentColor.clone().multiplyScalar(2), toneMapped: false }));
    const ringGeo = this._geo(new THREE.TorusGeometry(r * 0.68, 0.015, 6, 24));
    ringGeo.rotateY(Math.PI / 2);
    const caliperGeo = this._geo(new THREE.BoxGeometry(0.1, 0.22, 0.16));
    const caliperMat = this._mat(new THREE.MeshToonMaterial({ color: 0xff2040, gradientMap: sharedRamp }));

    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group(); // steering + suspension travel
      const spin = new THREE.Group();  // rolling
      pivot.add(spin);
      const tire = new THREE.Mesh(tireGeo, tireMat);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      spin.add(tire, rim);
      for (let k = 0; k < 3; k++) {
        const sp = new THREE.Mesh(spokeGeo, rimMat);
        sp.rotation.x = (k / 3) * Math.PI;
        spin.add(sp);
      }
      const side = this.wheelPositions[i].x < 0 ? -1 : 1;
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.x = side * 0.175;
      spin.add(ring);
      const caliper = new THREE.Mesh(caliperGeo, caliperMat);
      caliper.position.set(side * 0.1, 0.12, i < 2 ? 0.12 : -0.12);
      pivot.add(caliper);
      pivot.position.copy(this.wheelPositions[i]);
      pivot.position.y -= 0.3;
      this.root.add(pivot);
      this.wheels.push({ pivot, spin });
    }
  }

  _buildUnderglow(accent, lights) {
    const tex = glowTexture();
    this.disposables.push(tex);
    this.glowMat = this._mat(new THREE.MeshBasicMaterial({
      map: tex, color: new THREE.Color(accent).multiplyScalar(1.6), transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    }));
    const glow = new THREE.Mesh(this._geo(new THREE.PlaneGeometry(3.6, 6.2)), this.glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.62;
    glow.userData.noShadow = true;
    this.glow = glow;
    this.root.add(glow);
    if (lights) {
      this.glowLight = new THREE.PointLight(accent, 6, 7, 2);
      this.glowLight.position.set(0, -0.3, 0);
      this.root.add(this.glowLight);
      this.brakeLight = new THREE.PointLight(0xff1030, 0, 6, 2);
      this.brakeLight.position.set(0, 0.3, 2.8);
      this.root.add(this.brakeLight);
    }
  }

  _buildHeadlights() {
    const spot = new THREE.SpotLight(0xd8e4ff, 60, 70, 0.55, 0.5, 1.5);
    spot.position.set(0, 0.3, -2.0);
    spot.target.position.set(0, -1.2, -16);
    this.root.add(spot, spot.target);
    this.headlight = spot;
    // Fake light beam
    const beamMat = this._mat(new THREE.MeshBasicMaterial({
      color: 0x8aa0ff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    const beamGeo = this._geo(new THREE.ConeGeometry(2.2, 12, 16, 1, true));
    beamGeo.translate(0, -6, 0);
    beamGeo.rotateX(Math.PI / 2 - 0.06); // point forward (−Z) with slight down tilt
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(beamGeo, beamMat);
      b.position.set(s * 0.58, 0.16, -2.2);
      b.userData.noShadow = true;
      this.body.add(b);
    }
  }

  /** Per-wheel visual: suspension length (m from connection point), steer (rad), spin angle (rad). */
  setWheel(i, suspensionLength, steer, spin) {
    const w = this.wheels[i];
    const base = this.wheelPositions[i];
    w.pivot.position.set(base.x, base.y - suspensionLength, base.z);
    w.pivot.rotation.y = steer;
    w.spin.rotation.x = spin;
  }

  /** Visual weight transfer (rad). */
  setBodyTilt(pitch, roll) {
    this.body.rotation.x = pitch;
    this.body.rotation.z = roll;
  }

  setBrake(amount, reversing = false) {
    const k = 1.2 + amount * 3.2;
    this.tailMat.color.setRGB(k, reversing ? k * 0.9 : 0.05 * k, reversing ? k : 0.12 * k);
    if (this.brakeLight) this.brakeLight.intensity = amount * 8;
  }

  setNitro(active, time) {
    for (const f of this.flames) {
      f.visible = active;
      if (active) {
        const s = 0.8 + Math.sin(time * 60 + f.id) * 0.25 + Math.random() * 0.2;
        f.scale.set(1 + Math.random() * 0.3, 1 + Math.random() * 0.3, s * 1.4);
      }
    }
  }

  setUnderglowPulse(k) {
    this.glowMat.opacity = 0.6 + 0.35 * k;
    if (this.glowLight) this.glowLight.intensity = 4 + 4 * k;
  }

  dispose() {
    this.root.parent?.remove(this.root);
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
