import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CarMesh } from './CarMesh.js';

/**
 * AITraffic — manages autonomous waypoint-following rival/traffic cars
 * driving along the track spline with distinct paint jobs, lane changes,
 * collision physics bodies, and wheel animations.
 */
export class AITraffic {
  constructor(scene, physics, track) {
    this.scene = scene;
    this.physics = physics;
    this.track = track;
    this.cars = [];

    this._initCars();
  }

  _initCars() {
    const N = this.track.sampleCount;

    // Config for 2 autonomous cars
    const configs = [
      {
        index: Math.floor(N * 0.12),
        lateral: -2.8,
        speed: 26, // ~94 km/h
        color: 0xff1744, // Neon Crimson
        accent: 0xffd36b,
      },
      {
        index: Math.floor(N * 0.42),
        lateral: 2.8,
        speed: 30, // ~108 km/h
        color: 0x00e676, // Cyber Mint
        accent: 0x22f3ff,
      },
    ];

    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      const mesh = new CarMesh({
        color: cfg.color,
        accent: cfg.accent,
        lights: false,
      });
      this.scene.add(mesh.root);

      // Kinematic Cannon body for robust player collisions
      const body = new CANNON.Body({
        mass: 0, // static/kinematic so player bounces off or shunts them
        type: CANNON.Body.KINEMATIC,
        material: this.physics.materials.car,
      });
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.9, 0.4, 2.1)));
      body.userData = { type: 'ai_car', id: i };
      this.physics.addBody(body);

      const f = this.track.getFrame(cfg.index, cfg.lateral);
      mesh.root.position.copy(f.pos).addScaledVector(f.normal, 0.68);
      body.position.set(mesh.root.position.x, mesh.root.position.y, mesh.root.position.z);

      this.cars.push({
        id: i,
        mesh,
        body,
        index: cfg.index,
        targetLateral: cfg.lateral,
        currentLateral: cfg.lateral,
        baseSpeed: cfg.speed,
        currentSpeed: cfg.speed,
        wheelSpin: [0, 0, 0, 0],
        steerAngle: 0,
        position: new THREE.Vector3().copy(mesh.root.position),
      });
    }
  }

  update(dt) {
    const N = this.track.sampleCount;
    const len = this.track.length;
    const segLen = len / N;

    for (const car of this.cars) {
      // 1. Advance along spline index based on speed
      const indexDelta = (car.currentSpeed * dt) / segLen;
      car.index = (car.index + indexDelta) % N;

      // 2. Smooth lane positioning
      car.currentLateral += (car.targetLateral - car.currentLateral) * Math.min(1, dt * 2);

      // 3. Obtain current frame and lookahead frame for orientation
      const fCurr = this.track.getFrame(car.index, car.currentLateral);
      const fAhead = this.track.getFrame((car.index + 4) % N, car.currentLateral);

      const pos = fCurr.pos.clone().addScaledVector(fCurr.normal, 0.68);
      car.position.copy(pos);

      // Tangent direction
      const fwd = fAhead.pos.clone().sub(fCurr.pos).normalize();
      const up = fCurr.normal.clone();
      const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
      const normUp = new THREE.Vector3().crossVectors(right, fwd).normalize();

      const basis = new THREE.Matrix4().makeBasis(right, normUp, fwd.clone().negate());
      const quat = new THREE.Quaternion().setFromRotationMatrix(basis);

      car.mesh.root.position.copy(pos);
      car.mesh.root.quaternion.copy(quat);

      // Sync Cannon kinematic body
      car.body.position.set(pos.x, pos.y, pos.z);
      car.body.quaternion.set(quat.x, quat.y, quat.z, quat.w);

      // 4. Wheels spin and slight steer
      const spinDelta = (car.currentSpeed * dt) / 0.36;
      for (let w = 0; w < 4; w++) {
        car.wheelSpin[w] -= spinDelta;
        car.mesh.setWheel(w, 0.32, (w < 2 ? car.steerAngle : 0), car.wheelSpin[w]);
      }
    }
  }

  dispose() {
    for (const car of this.cars) {
      this.physics.removeBody(car.body);
      car.mesh.dispose();
    }
    this.cars.length = 0;
  }
}
