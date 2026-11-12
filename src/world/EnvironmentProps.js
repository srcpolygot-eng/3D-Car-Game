import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Seeded RNG so the world is identical every boot. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * EnvironmentProps — synthwave grid ground, ocean, skyline, palms, neon arches,
 * dockyard set dressing and destructible physics props (cones, barriers, streetlights).
 */
export class EnvironmentProps {
  constructor(sceneManager, physics, track) {
    this.scene = sceneManager.scene;
    this.physics = physics;
    this.track = track;
    this.group = new THREE.Group();
    this.group.name = 'Environment';
    this.rand = mulberry32(1337);
    this.dynamicProps = []; // { mesh, body, initPos, initQuat, type }
    this.staticBodies = [];
    this.animated = [];
    this.time = 0;
  }

  build() {
    this._buildGround();
    this._buildOcean();
    this._buildSkyline();
    this._buildPalms();
    this._buildArches();
    this._buildDockyard();
    this._buildCones();
    this._buildBarriers();
    this._buildStreetlights();
    this.scene.add(this.group);
    return this;
  }

  // ---------------------------------------------------------------- ground / ocean
  _buildGround() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uTime;
        varying vec3 vWorld;
        float gridLine(vec2 p, float scale, float width) {
          vec2 g = abs(fract(p / scale - 0.5) - 0.5) / fwidth(p / scale);
          return 1.0 - min(min(g.x, g.y) / width, 1.0);
        }
        void main() {
          vec3 base = vec3(0.035, 0.012, 0.07);
          float g1 = gridLine(vWorld.xz, 20.0, 1.2);
          float g2 = gridLine(vWorld.xz, 100.0, 1.6);
          float dist = length(cameraPosition.xz - vWorld.xz);
          float fade = exp(-dist * 0.0028);
          float pulse = 0.6 + 0.4 * sin(uTime * 0.8 - dist * 0.02);
          vec3 col = base + vec3(0.85, 0.12, 0.85) * g1 * 0.35 * fade * pulse + vec3(0.1, 0.8, 1.0) * g2 * 0.6 * fade;
          col = mix(vec3(0.10, 0.03, 0.19), col, exp(-dist * 0.0018));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      extensions: { derivatives: true },
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    this.group.add(ground);
    this.groundMat = mat;
  }

  _buildOcean() {
    const mat = new THREE.ShaderMaterial({
      transparent: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */`
        uniform float uTime;
        varying vec3 vWorld;
        void main() {
          vec3 p = position;
          vec4 w = modelMatrix * vec4(p, 1.0);
          w.y += sin(w.x * 0.05 + uTime) * 0.3 + cos(w.z * 0.07 + uTime * 1.3) * 0.25;
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uTime;
        varying vec3 vWorld;
        void main() {
          float dist = length(cameraPosition.xz - vWorld.xz);
          float shimmer = sin(vWorld.x * 0.3 + uTime * 2.0) * sin(vWorld.z * 0.21 - uTime * 1.5);
          vec3 deep = vec3(0.04, 0.0, 0.12);
          vec3 glint = vec3(1.0, 0.35, 0.6) * smoothstep(0.75, 1.0, shimmer) * 0.9;
          vec3 col = deep + glint * exp(-dist * 0.002);
          col = mix(vec3(0.25, 0.06, 0.25), col, exp(-dist * 0.0012));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1600, 2600, 80, 80), mat);
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(1240, -0.6, 0);
    this.group.add(ocean);
    const ocean2 = new THREE.Mesh(new THREE.PlaneGeometry(2600, 1200, 80, 40), mat);
    ocean2.rotation.x = -Math.PI / 2;
    ocean2.position.set(0, -0.6, 720);
    this.group.add(ocean2);
    this.oceanMat = mat;
  }

  // ---------------------------------------------------------------- skyline
  _windowTexture() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, 64, 128);
    const palette = ['#ff2bd6', '#22f3ff', '#ffd36b', '#ffffff', '#8a2bff'];
    for (let y = 4; y < 128; y += 8) {
      for (let x = 4; x < 64; x += 8) {
        if (this.rand() < 0.38) {
          g.fillStyle = palette[(this.rand() * palette.length) | 0];
          g.globalAlpha = 0.4 + this.rand() * 0.6;
          g.fillRect(x, y, 4, 5);
        }
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    return t;
  }

  _buildSkyline() {
    const count = 260;
    const tex = this._windowTexture();
    tex.repeat.set(2, 4);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x120a22, roughness: 0.6, metalness: 0.4,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.4,
    });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    let n = 0;
    while (n < count) {
      // City sits on the west/north side, away from the ocean.
      const ang = Math.PI * 0.35 + this.rand() * Math.PI * 1.2;
      const r = 480 + this.rand() * 520;
      const x = Math.cos(ang) * r * 1.1 - 60, z = -Math.sin(ang) * r - 120;
      if (x > 380) continue;
      const w = 18 + this.rand() * 40, d = 18 + this.rand() * 40;
      const h = 40 + Math.pow(this.rand(), 2) * 260;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rand() * Math.PI);
      m.compose(new THREE.Vector3(x, -0.1, z), q, new THREE.Vector3(w, h, d));
      inst.setMatrixAt(n++, m);
    }
    this.group.add(inst);

    // Rooftop beacons
    const beaconGeo = new THREE.SphereGeometry(2.2, 8, 6);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2040, toneMapped: false });
    const beacons = new THREE.InstancedMesh(beaconGeo, beaconMat, count);
    const tmp = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      inst.getMatrixAt(i, tmp);
      tmp.decompose(p, q, s);
      m.compose(new THREE.Vector3(p.x, s.y + 2, p.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      beacons.setMatrixAt(i, m);
    }
    this.group.add(beacons);
    this.beaconMat = beaconMat;
  }

  // ---------------------------------------------------------------- palms
  _buildPalms() {
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.42, 9, 7, 6);
    // Bend the trunk
    const tp = trunkGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i) + 4.5;
      tp.setX(i, tp.getX(i) + Math.pow(y / 9, 2) * 1.4);
    }
    trunkGeo.translate(0, 4.5, 0);
    trunkGeo.computeVertexNormals();
    const fronds = [];
    for (let k = 0; k < 7; k++) {
      const f = new THREE.ConeGeometry(0.7, 4.6, 4, 1);
      f.scale(1, 1, 0.18);
      f.translate(0, 2.3, 0);
      f.rotateZ(-1.15);
      f.rotateY((k / 7) * Math.PI * 2);
      f.translate(1.4, 9, 0);
      fronds.push(f);
    }
    const frondGeo = mergeGeometries(fronds);
    const positions = [];
    const N = this.track.sampleCount;
    for (let i = 0; i < N; i += 14) {
      const p = this.track.points[i];
      if (p.x < -20 && p.z < -80) continue; // keep dockyard industrial
      for (const s of [-1, 1]) {
        if (this.rand() < 0.35) continue;
        const lat = s * (this.track.width / 2 + 5 + this.rand() * 6);
        const pos = p.clone().addScaledVector(this.track.sides[i], lat);
        if (this._nearTrack(pos, this.track.width / 2 + 3)) continue;
        pos.y = Math.max(-0.05, 0);
        positions.push(pos);
      }
    }
    const trunkMat = new THREE.MeshToonMaterial({ color: 0x3a1f2a });
    const frondMat = new THREE.MeshToonMaterial({ color: 0x0c3a3a, emissive: 0x031818 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
    const leaves = new THREE.InstancedMesh(frondGeo, frondMat, positions.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    positions.forEach((pos, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rand() * Math.PI * 2);
      const sc = 0.8 + this.rand() * 0.5;
      m.compose(pos, q, new THREE.Vector3(sc, sc, sc));
      trunks.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);
    });
    trunks.castShadow = leaves.castShadow = true;
    this.group.add(trunks, leaves);
  }

  _nearTrack(pos, minDist) {
    const pts = this.track.points;
    const md2 = minDist * minDist;
    for (let i = 0; i < pts.length; i += 3) {
      const dx = pts[i].x - pos.x, dz = pts[i].z - pos.z;
      if (dx * dx + dz * dz < md2) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- neon arches
  _buildArches() {
    const N = this.track.sampleCount;
    const colors = [0xff2bd6, 0x22f3ff, 0x8a2bff, 0xffb627];
    const geo = new THREE.TorusGeometry(this.track.width / 2 + 2.2, 0.28, 8, 40, Math.PI);
    let c = 0;
    for (let i = 40; i < N; i += 55) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(colors[c % colors.length]).multiplyScalar(2.2), toneMapped: false });
      const arch = new THREE.Mesh(geo, mat);
      const t = this.track;
      const basis = new THREE.Matrix4().makeBasis(t.sides[i], t.normals[i], t.tangents[i].clone().negate());
      arch.quaternion.setFromRotationMatrix(basis);
      arch.position.copy(t.points[i]);
      this.group.add(arch);
      this.animated.push({ mesh: arch, phase: c * 0.7, base: mat.color.clone() });
      c++;
    }
  }

  // ---------------------------------------------------------------- dockyard
  _buildDockyard() {
    const colors = [0xc2185b, 0x00838f, 0xf9a825, 0x5e35b1, 0x2e7d32, 0xd84315];
    const geo = new THREE.BoxGeometry(2.6, 2.7, 12);
    const containers = [];
    // Container stacks in the dockyard (south-west quadrant)
    for (let k = 0; k < 140; k++) {
      const x = -330 + this.rand() * 300;
      const z = -420 + this.rand() * 300;
      const pos = new THREE.Vector3(x, 0, z);
      if (this._nearTrack(pos, this.track.width / 2 + 9)) continue;
      const stack = 1 + ((this.rand() * 3) | 0);
      const rot = this.rand() < 0.5 ? 0 : Math.PI / 2;
      for (let s = 0; s < stack; s++) containers.push({ x, y: 1.35 + s * 2.7, z, rot, color: colors[(this.rand() * colors.length) | 0] });
    }
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff });
    const inst = new THREE.InstancedMesh(geo, mat, containers.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    containers.forEach((c, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.rot);
      m.compose(new THREE.Vector3(c.x, c.y, c.z), q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, col.set(c.color).multiplyScalar(0.55));
    });
    inst.castShadow = inst.receiveShadow = true;
    this.group.add(inst);
    // Physics for ground-level containers so they're solid if you go off-road.
    containers.filter((c) => c.y < 2).forEach((c) => {
      const b = new CANNON.Body({ mass: 0, material: this.physics.materials.wall });
      b.addShape(new CANNON.Box(new CANNON.Vec3(1.3, 1.35 * 3, 6)));
      b.position.set(c.x, c.y, c.z);
      b.quaternion.setFromEuler(0, c.rot, 0);
      b.userData = { type: 'wall' };
      this.physics.addBody(b);
      this.staticBodies.push(b);
    });

    // Gantry cranes with blinking warning lights
    const craneMat = new THREE.MeshToonMaterial({ color: 0xff8f00 });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xff1744, toneMapped: false });
    const spots = [[-260, -330], [-120, -360], [-280, -110], [40, -360]];
    for (const [x, z] of spots) {
      const crane = new THREE.Group();
      for (const dx of [-6, 6]) for (const dz of [-4, 4]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 34, 0.8), craneMat);
        leg.position.set(dx, 17, dz);
        crane.add(leg);
      }
      const boom = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 60), craneMat);
      boom.position.set(0, 35, 14);
      crane.add(boom);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), new THREE.MeshToonMaterial({ color: 0x263238 }));
      cab.position.set(0, 32, 4);
      crane.add(cab);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), lightMat);
      light.position.set(0, 36.5, 43);
      crane.add(light);
      crane.position.set(x, 0, z);
      crane.rotation.y = this.rand() * Math.PI * 2;
      crane.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.group.add(crane);
    }
    this.craneLightMat = lightMat;

    // Neon billboards
    const words = ['無限', 'DRIFT', 'NITRO', '夜', 'TURBO', 'ネオン'];
    const bbColors = ['#ff2bd6', '#22f3ff', '#ffb627', '#8a2bff'];
    const N = this.track.sampleCount;
    for (let k = 0; k < 10; k++) {
      const i = Math.floor((k / 10) * N + 30) % N;
      const side = k % 2 ? 1 : -1;
      const t = this.track;
      const pos = t.points[i].clone().addScaledVector(t.sides[i], side * (t.width / 2 + 9));
      const c = document.createElement('canvas');
      c.width = 512; c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = '#07010f';
      g.fillRect(0, 0, 512, 256);
      const color = bbColors[k % bbColors.length];
      g.strokeStyle = color; g.lineWidth = 10; g.strokeRect(12, 12, 488, 232);
      g.font = 'bold 120px Arial';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = color; g.shadowBlur = 30;
      g.fillStyle = color;
      g.fillText(words[k % words.length], 256, 132);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }));
      board.position.set(pos.x, Math.max(pos.y, 0) + 11, pos.z);
      board.lookAt(t.points[(i + 25) % N].clone().setY(board.position.y));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, board.position.y, 8), new THREE.MeshStandardMaterial({ color: 0x222233, metalness: 0.8 }));
      pole.position.set(pos.x, board.position.y / 2 - 0.05, pos.z);
      this.group.add(board, pole);
    }
  }

  // ---------------------------------------------------------------- destructibles
  _addDynamic(mesh, body, type) {
    body.userData = { type, prop: true };
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.3;
    body.sleepTimeLimit = 0.6;
    body.linearDamping = 0.1;
    body.angularDamping = 0.2;
    this.physics.addBody(body);
    body.sleep();
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
    this.group.add(mesh);
    this.dynamicProps.push({
      mesh, body, type,
      initPos: body.position.clone(),
      initQuat: body.quaternion.clone(),
    });
  }

  _buildCones() {
    const t = this.track, N = t.sampleCount;
    const coneGeo = new THREE.ConeGeometry(0.32, 0.9, 12);
    coneGeo.translate(0, 0.0, 0);
    const coneMat = new THREE.MeshToonMaterial({ color: 0xff5a1f, emissive: 0x401000 });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const stripeGeo = new THREE.CylinderGeometry(0.2, 0.24, 0.12, 12, 1, true);
    const baseGeo = new THREE.BoxGeometry(0.62, 0.06, 0.62);
    // Cone lines on the apex of the sharpest bends.
    const candidates = [];
    for (let i = 0; i < N; i += 2) candidates.push([Math.abs(t.banks[i]), i]);
    candidates.sort((a, b) => b[0] - a[0]);
    const chosen = [];
    for (const [, i] of candidates) {
      if (chosen.every((j) => Math.min(Math.abs(j - i), N - Math.abs(j - i)) > 60)) chosen.push(i);
      if (chosen.length >= 6) break;
    }
    for (const center of chosen) {
      const inside = t.banks[center] > 0 ? -1 : 1; // inside of the turn
      for (let k = -6; k <= 6; k += 2) {
        const i = (center + k + N) % N;
        const f = t.getFrame(i, inside * (t.width / 2 - 1.4));
        const mesh = new THREE.Group();
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.castShadow = true;
        const stripe = new THREE.Mesh(stripeGeo, stripeMat);
        stripe.position.y = 0.05;
        const base = new THREE.Mesh(baseGeo, coneMat);
        base.position.y = -0.42;
        mesh.add(cone, stripe, base);
        const body = new CANNON.Body({ mass: 4, material: this.physics.materials.prop });
        body.addShape(new CANNON.Cylinder(0.05, 0.32, 0.9, 8));
        body.position.set(f.pos.x, f.pos.y + 0.47, f.pos.z);
        this._addDynamic(mesh, body, 'cone');
      }
    }
  }

  _buildBarriers() {
    const t = this.track, N = t.sampleCount;
    const geo = new THREE.BoxGeometry(2.0, 0.9, 0.6);
    const mats = [
      new THREE.MeshToonMaterial({ color: 0xe0e0f0 }),
      new THREE.MeshToonMaterial({ color: 0xff2bd6, emissive: 0x400030 }),
    ];
    const reflGeo = new THREE.PlaneGeometry(1.6, 0.15);
    const reflMat = new THREE.MeshBasicMaterial({ color: 0x22f3ff, toneMapped: false, side: THREE.DoubleSide });
    // Chicane clusters at a few spots on straights.
    const spots = [0.2, 0.42, 0.66, 0.88];
    spots.forEach((fr, sIdx) => {
      const i0 = Math.floor(fr * N);
      for (let k = 0; k < 4; k++) {
        const i = (i0 + k * 2) % N;
        const lateral = (sIdx % 2 ? 1 : -1) * (t.width / 2 - 1.6);
        const f = t.getFrame(i, lateral);
        const mesh = new THREE.Mesh(geo, mats[k % 2]);
        mesh.castShadow = true;
        const r = new THREE.Mesh(reflGeo, reflMat);
        r.position.set(0, 0.2, 0.31);
        const r2 = r.clone(); r2.position.z = -0.31;
        mesh.add(r, r2);
        const body = new CANNON.Body({ mass: 35, material: this.physics.materials.prop });
        body.addShape(new CANNON.Box(new CANNON.Vec3(1.0, 0.45, 0.3)));
        body.position.set(f.pos.x, f.pos.y + 0.47, f.pos.z);
        const yaw = Math.atan2(f.tangent.x, f.tangent.z) + Math.PI / 2;
        body.quaternion.setFromEuler(0, yaw, 0);
        this._addDynamic(mesh, body, 'barrier');
      }
    });
  }

  _buildStreetlights() {
    const t = this.track, N = t.sampleCount;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, metalness: 0.8, roughness: 0.3 });
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.75, 0.45).multiplyScalar(3), toneMapped: false });
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 7, 8);
    const armGeo = new THREE.BoxGeometry(0.12, 0.12, 2.2);
    const lampGeo = new THREE.BoxGeometry(0.4, 0.15, 0.8);
    // Light cone (fake volumetric)
    const beamGeo = new THREE.ConeGeometry(2.6, 6.6, 16, 1, true);
    beamGeo.translate(0, -3.3, 0);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffb070, transparent: true, opacity: 0.07, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    for (let i = 10, k = 0; i < N; i += 26, k++) {
      const side = k % 2 ? 1 : -1;
      const lateral = side * (t.width / 2 - 0.5);
      const f = t.getFrame(i, lateral);
      const g = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.castShadow = true;
      const arm = new THREE.Mesh(armGeo, poleMat);
      arm.position.set(0, 3.4, 0);
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(0, 3.3, 0);
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(0, 3.2, 0);
      // Arm reaches toward the road center.
      const armGroup = new THREE.Group();
      armGroup.add(arm, lamp, beam);
      arm.position.z = 1.0; lamp.position.z = 2.0; beam.position.z = 2.0;
      g.add(pole, armGroup);
      const body = new CANNON.Body({ mass: 90, material: this.physics.materials.prop });
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.15, 3.5, 0.15)));
      body.position.set(f.pos.x, f.pos.y + 3.5, f.pos.z);
      // face toward road center
      const toCenter = f.side.clone().multiplyScalar(-side);
      const yaw = Math.atan2(toCenter.x, toCenter.z);
      body.quaternion.setFromEuler(0, yaw, 0);
      this._addDynamic(g, body, 'streetlight');
    }
  }

  /** Restore all destructible props to their spawn transforms. */
  resetProps() {
    for (const p of this.dynamicProps) {
      p.body.position.copy(p.initPos);
      p.body.quaternion.copy(p.initQuat);
      p.body.velocity.setZero();
      p.body.angularVelocity.setZero();
      p.body.sleep();
      p.mesh.position.copy(p.initPos);
      p.mesh.quaternion.copy(p.initQuat);
    }
  }

  update(dt) {
    this.time += dt;
    this.groundMat.uniforms.uTime.value = this.time;
    this.oceanMat.uniforms.uTime.value = this.time;
    for (const p of this.dynamicProps) {
      const b = p.body;
      if (b.sleepState === CANNON.Body.SLEEPING) continue;
      if (b.position.y < -20) { // fell out of the world -> park it
        b.position.copy(p.initPos); b.quaternion.copy(p.initQuat);
        b.velocity.setZero(); b.angularVelocity.setZero(); b.sleep();
      }
      p.mesh.position.copy(b.position);
      p.mesh.quaternion.copy(b.quaternion);
    }
    for (const a of this.animated) {
      const k = 0.75 + 0.25 * Math.sin(this.time * 2.5 + a.phase);
      a.mesh.material.color.copy(a.base).multiplyScalar(k);
    }
    const blink = Math.sin(this.time * 4) > 0.2 ? 1 : 0.15;
    this.craneLightMat.color.setRGB(2 * blink, 0.1 * blink, 0.2 * blink);
    this.beaconMat.color.setRGB(1.5 * (0.5 + 0.5 * Math.sin(this.time * 2)), 0.05, 0.15);
  }

  dispose() {
    for (const p of this.dynamicProps) this.physics.removeBody(p.body);
    for (const b of this.staticBodies) this.physics.removeBody(b);
    this.dynamicProps.length = 0;
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { if (m.map) m.map.dispose(); if (m.emissiveMap) m.emissiveMap.dispose(); m.dispose(); });
      }
    });
    this.scene.remove(this.group);
  }
}
