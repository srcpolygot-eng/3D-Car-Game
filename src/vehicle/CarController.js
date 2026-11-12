import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CarMesh } from './CarMesh.js';

/**
 * Tuning constants — heavy, planted, snappy. All SI units.
 * (Gravity is −20 m/s² in PhysicsWorld for a weightier arcade feel.)
 */
export const TUNING = {
  mass: 1150,
  chassisHalfExtents: new CANNON.Vec3(0.9, 0.32, 2.1),
  angularDamping: 0.35,
  linearDamping: 0.015,

  wheelRadius: 0.36,
  suspensionRestLength: 0.32,
  suspensionStiffness: 38,      // ×mass internally → firm sports suspension
  dampingRelaxation: 3.0,
  dampingCompression: 4.5,
  maxSuspensionForce: 1e5,
  maxSuspensionTravel: 0.28,
  rollInfluence: 0.04,          // low = resists rollover but still leans
  frictionFront: 3.6,
  frictionRear: 3.3,
  frictionRearHandbrake: 1.05,  // handbrake: rear lets go
  frictionRearDrift: 1.75,      // sustained power-slide grip

  maxEngineForce: 9400,         // total, split over rear wheels (RWD)
  reverseForce: 4200,
  brakeForce: 6200,             // N per wheel (converted to impulse per step)
  handbrakeForce: 2200,
  topSpeed: 72,                 // m/s ≈ 259 km/h
  nitroTopSpeed: 90,
  nitroForce: 7600,
  nitroBurn: 0.32,              // meter per second
  downforce: 1.15,              // N per (m/s)²

  maxSteerLow: 0.56,
  maxSteerHigh: 0.17,
  steerSpeedRef: 55,
  counterSteerAssist: 0.85,
  driftYawTorque: 5200,
  driftMomentum: 0.85,          // how strongly velocity is redirected toward heading in a slide

  gearTops: [0, 15, 26, 37, 49, 61, 76],
  idleRpm: 950,
  redline: 7600,
  shiftTime: 0.14,
};

const FORWARD_LOCAL = new CANNON.Vec3(0, 0, -1);
const UP_LOCAL = new CANNON.Vec3(0, 1, 0);

/**
 * CarController — RaycastVehicle, drivetrain, drift model, nitro & scoring.
 */
export class CarController {
  constructor(physics, scene, { color, accent, lights = true } = {}) {
    this.physics = physics;
    this.scene = scene;
    this.T = TUNING;
    this.listeners = {};

    // ---- Chassis ----
    const T = this.T;
    this.chassis = new CANNON.Body({
      mass: T.mass,
      material: physics.materials.car,
      angularDamping: T.angularDamping,
      linearDamping: T.linearDamping,
      allowSleep: false,
    });
    this.chassis.addShape(new CANNON.Box(T.chassisHalfExtents));
    // Rounded nose/tail volume to slide off walls instead of snagging.
    this.chassis.addShape(new CANNON.Sphere(0.45), new CANNON.Vec3(0, 0.15, -1.75));
    this.chassis.addShape(new CANNON.Sphere(0.45), new CANNON.Vec3(0, 0.15, 1.75));
    this.chassis.userData = { type: 'player' };

    // ---- Vehicle ----
    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassis, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2,
    });
    this.mesh = new CarMesh({ color, accent, lights });
    const base = {
      radius: T.wheelRadius,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      suspensionStiffness: T.suspensionStiffness,
      suspensionRestLength: T.suspensionRestLength,
      dampingRelaxation: T.dampingRelaxation,
      dampingCompression: T.dampingCompression,
      maxSuspensionForce: T.maxSuspensionForce,
      maxSuspensionTravel: T.maxSuspensionTravel,
      rollInfluence: T.rollInfluence,
      customSlidingRotationalSpeed: -30,
      useCustomSlidingRotationalSpeed: true,
    };
    this.mesh.wheelPositions.forEach((p, i) => {
      this.vehicle.addWheel({
        ...base,
        frictionSlip: i < 2 ? T.frictionFront : T.frictionRear,
        chassisConnectionPointLocal: new CANNON.Vec3(p.x, p.y, p.z),
      });
    });
    this.vehicle.addToWorld(physics.world);
    scene.add(this.mesh.root);

    // ---- State ----
    this.state = {
      speed: 0, forwardSpeed: 0, lateralSpeed: 0, kmh: 0,
      rpm: T.idleRpm, gear: 1, throttle: 0, brake: 0,
      slipAngle: 0, rearSlip: 0, drifting: false, handbrake: false,
      nitro: 0.35, boosting: false, boostPadTimer: 0,
      onGround: true, wheelsOnGround: 4, airTime: 0,
      driftScore: 0, driftMultiplier: 1, driftTime: 0, bankedScore: 0, totalScore: 0,
      wheelspin: 0, upsideDownTimer: 0,
    };
    this._shiftTimer = 0;
    this._driftExitTimer = 0;
    this._prevForward = 0;
    this._longAccel = 0;
    this._latAccel = 0;
    this._pitch = 0; this._pitchVel = 0;
    this._roll = 0; this._rollVel = 0;
    this._wheelSpin = [0, 0, 0, 0];
    this._prevPos = new THREE.Vector3();
    this._prevQuat = new THREE.Quaternion();
    this._currPos = new THREE.Vector3();
    this._currQuat = new THREE.Quaternion();
    this._tmpV = new CANNON.Vec3();
    this._tmpV2 = new CANNON.Vec3();
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.contactPoints = [null, null, null, null];
    this.wheelSlip = [0, 0, 0, 0];
    this.controlsEnabled = true;
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  emit(evt, data) { (this.listeners[evt] || []).forEach((fn) => fn(data)); }

  /** Place the car at a transform and kill all motion. */
  reset(position, yaw) {
    const c = this.chassis;
    c.position.set(position.x, position.y, position.z);
    c.quaternion.setFromEuler(0, yaw, 0);
    c.velocity.setZero();
    c.angularVelocity.setZero();
    c.force.setZero();
    c.torque.setZero();
    for (const w of this.vehicle.wheelInfos) {
      w.deltaRotation = 0; w.rotation = 0; w.suspensionLength = w.suspensionRestLength;
    }
    this.state.drifting = false;
    this.state.driftScore = 0;
    this.state.driftMultiplier = 1;
    this.state.driftTime = 0;
    this.state.gear = 1;
    this.state.boosting = false;
    this._pitch = this._roll = this._pitchVel = this._rollVel = 0;
    this._syncPrev();
    this._syncPrev();
  }

  _syncPrev() {
    this._prevPos.copy(this._currPos);
    this._prevQuat.copy(this._currQuat);
    const c = this.chassis;
    this._currPos.set(c.position.x, c.position.y, c.position.z);
    this._currQuat.set(c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w);
  }

  addNitro(amount) { this.state.nitro = Math.min(1, this.state.nitro + amount); }

  /** Boost pad: instant forward kick + short nitro-like FX. */
  applyBoostPad() {
    const fwd = this.chassis.quaternion.vmult(FORWARD_LOCAL, this._tmpV);
    const kick = 9 * this.T.mass;
    this.chassis.applyImpulse(new CANNON.Vec3(fwd.x * kick, 0, fwd.z * kick));
    this.state.boostPadTimer = 0.9;
    this.addNitro(0.12);
    this.emit('boostpad', {});
  }

  /** Called by collision handler. Hard impacts cancel the unbanked drift combo. */
  notifyImpact(strength) {
    if (strength > 7 && this.state.driftScore > 0) {
      this.emit('driftFail', { lost: this.state.driftScore });
      this.state.driftScore = 0;
      this.state.driftMultiplier = 1;
      this.state.driftTime = 0;
      this.state.drifting = false;
    }
  }

  /** Fixed-step update — call BEFORE physics.step(). */
  fixedUpdate(dt, input) {
    this._syncPrev();
    const T = this.T, S = this.state, c = this.chassis, v = this.vehicle;

    // ---- Kinematics in chassis space ----
    const localVel = c.vectorToLocalFrame(c.velocity, this._tmpV);
    const forwardSpeed = -localVel.z;
    const lateralSpeed = localVel.x;
    const speed = c.velocity.length();
    const absFwd = Math.abs(forwardSpeed);
    S.speed = speed;
    S.forwardSpeed = forwardSpeed;
    S.lateralSpeed = lateralSpeed;
    S.kmh = speed * 3.6;
    S.slipAngle = speed > 3 ? Math.atan2(lateralSpeed, Math.max(absFwd, 0.5)) : 0;

    const localAng = c.vectorToLocalFrame(c.angularVelocity, this._tmpV2);
    const yawRate = localAng.y;

    // Accelerations for visual weight transfer
    const rawLong = (forwardSpeed - this._prevForward) / dt;
    this._prevForward = forwardSpeed;
    this._longAccel += (rawLong - this._longAccel) * Math.min(1, dt * 8);
    this._latAccel += (forwardSpeed * yawRate - this._latAccel) * Math.min(1, dt * 8);

    // ---- Ground contact ----
    let contacts = 0;
    for (let i = 0; i < 4; i++) if (v.wheelInfos[i].isInContact) contacts++;
    const wasGround = S.onGround;
    S.wheelsOnGround = contacts;
    S.onGround = contacts >= 2;
    if (!S.onGround) S.airTime += dt;
    else {
      if (!wasGround && S.airTime > 0.35) this.emit('land', { airTime: S.airTime, impact: Math.abs(c.velocity.y) });
      S.airTime = 0;
    }

    // ---- Input ----
    const ctl = this.controlsEnabled;
    const steerIn = ctl ? input.steer : 0;
    const throttleIn = ctl ? input.throttle : 0;
    const brakeIn = ctl ? input.brake : 0;
    const handbrake = ctl && input.handbrake;
    const wantNitro = ctl && input.nitro;
    S.throttle = throttleIn;
    S.handbrake = handbrake;

    // ---- Drift state machine ----
    const slipMag = Math.abs(S.slipAngle);
    const driftEntry = speed > 9 && (slipMag > 0.2 || (handbrake && Math.abs(steerIn) > 0.1));
    if (driftEntry && S.onGround) {
      if (!S.drifting) { S.drifting = true; this.emit('driftStart', {}); }
      this._driftExitTimer = 0;
    } else if (S.drifting) {
      this._driftExitTimer += dt;
      if (this._driftExitTimer > 0.45 || speed < 5) {
        S.drifting = false;
        this._bankDrift();
      }
    }

    // ---- Steering (speed-sensitive + counter-steer assist) ----
    const speedT = Math.min(1, absFwd / T.steerSpeedRef);
    let maxSteer = THREE.MathUtils.lerp(T.maxSteerLow, T.maxSteerHigh, speedT);
    if (S.drifting) maxSteer = Math.max(maxSteer, 0.42);
    let steer = -steerIn * maxSteer; // cannon: + = left
    if (S.drifting && forwardSpeed > 2) {
      // Steer toward the direction of travel automatically → catches slides.
      const assist = THREE.MathUtils.clamp(-S.slipAngle * T.counterSteerAssist, -0.45, 0.45);
      steer = THREE.MathUtils.clamp(steer + assist * (1 - Math.abs(steerIn) * 0.35), -0.6, 0.6);
    }
    v.setSteeringValue(steer, 0);
    v.setSteeringValue(steer, 1);

    // ---- Rear grip (handbrake / drift / grip) ----
    let rearGrip = T.frictionRear;
    if (handbrake) rearGrip = T.frictionRearHandbrake;
    else if (S.drifting) rearGrip = THREE.MathUtils.lerp(T.frictionRear, T.frictionRearDrift, 0.4 + throttleIn * 0.6);
    for (let i = 2; i < 4; i++) {
      const w = v.wheelInfos[i];
      w.frictionSlip += (rearGrip - w.frictionSlip) * Math.min(1, dt * (handbrake ? 18 : 5));
    }

    // ---- Gearbox ----
    this._updateGearbox(dt, absFwd, forwardSpeed, throttleIn, brakeIn);

    // ---- Engine / brakes ----
    const topSpeed = S.boosting ? T.nitroTopSpeed : T.topSpeed;
    const shiftCut = this._shiftTimer > 0 ? 0.25 : 1;
    let engine = 0;
    let brake = 0;
    S.brake = 0;
    if (throttleIn > 0) {
      const v01 = Math.max(0, forwardSpeed) / topSpeed;
      const torqueCurve = Math.max(0, 1 - v01 * v01) * (0.75 + 0.25 * Math.sin(Math.min(1, S.rpm / T.redline) * Math.PI));
      engine = throttleIn * T.maxEngineForce * torqueCurve * shiftCut;
    }
    if (brakeIn > 0) {
      if (forwardSpeed > 1.5) {
        brake = brakeIn * T.brakeForce * dt;
        S.brake = brakeIn;
      } else {
        engine = -brakeIn * T.reverseForce * Math.max(0, 1 - Math.abs(forwardSpeed) / 14);
        S.gear = -1;
      }
    }
    for (let i = 0; i < 4; i++) v.setBrake(brake, i);
    if (handbrake) {
      v.setBrake(T.handbrakeForce * dt, 2);
      v.setBrake(T.handbrakeForce * dt, 3);
      engine *= 0.55;
    }
    // RWD
    v.applyEngineForce(0, 0);
    v.applyEngineForce(0, 1);
    v.applyEngineForce(engine / 2, 2);
    v.applyEngineForce(engine / 2, 3);

    // ---- World-space helpers ----
    const fwdW = c.quaternion.vmult(FORWARD_LOCAL, new CANNON.Vec3());
    const upW = c.quaternion.vmult(UP_LOCAL, new CANNON.Vec3());

    // ---- Drift dynamics: yaw authority + momentum conservation ----
    if (S.drifting && S.onGround) {
      // Player-controlled yaw (steer right → clockwise from above → −Y torque).
      const yawTq = -steerIn * T.driftYawTorque * Math.min(1, speed / 20);
      // Anti-spin: resist excessive slip angles and yaw rates.
      // Slip > 60°: yaw the nose back toward the velocity vector (clockwise for right-slides).
      const antiSpin = slipMag > 1.05 ? -Math.sign(S.slipAngle) * (slipMag - 1.05) * 7000 : 0;
      const yawDamp = -yawRate * 900;
      c.torque.vadd(upW.scale(yawTq + yawDamp + antiSpin), c.torque);

      // Redirect some velocity toward the heading so slides carry speed instead of scrubbing.
      const k = T.driftMomentum * (0.35 + 0.65 * throttleIn) * dt;
      const flatSpeed = Math.hypot(c.velocity.x, c.velocity.z);
      const fx = fwdW.x, fz = fwdW.z;
      const fl = Math.hypot(fx, fz) || 1;
      const sign = forwardSpeed >= 0 ? 1 : -1;
      const tx = (fx / fl) * flatSpeed * sign, tz = (fz / fl) * flatSpeed * sign;
      c.velocity.x += (tx - c.velocity.x) * k;
      c.velocity.z += (tz - c.velocity.z) * k;
    }

    // ---- Nitro ----
    const canBoost = wantNitro && S.nitro > 0.02;
    if (canBoost && !S.boosting) this.emit('nitroStart', {});
    if (!canBoost && S.boosting) this.emit('nitroEnd', {});
    S.boosting = canBoost;
    if (S.boosting) {
      S.nitro = Math.max(0, S.nitro - T.nitroBurn * dt);
      const f = T.nitroForce * (forwardSpeed < T.nitroTopSpeed ? 1 : 0.2);
      c.applyForce(new CANNON.Vec3(fwdW.x * f, fwdW.y * f, fwdW.z * f), c.position);
    }
    if (S.boostPadTimer > 0) S.boostPadTimer -= dt;

    // ---- Downforce & air control ----
    if (S.onGround) {
      const df = T.downforce * speed * speed;
      c.applyForce(new CANNON.Vec3(-upW.x * df, -upW.y * df, -upW.z * df), c.position);
    } else {
      // Gentle self-righting + mid-air steer.
      const rightingAxis = upW.cross(new CANNON.Vec3(0, 1, 0));
      c.torque.vadd(rightingAxis.scale(1500), c.torque);
      c.torque.vadd(new CANNON.Vec3(0, -steerIn * 1500, 0), c.torque);
      c.angularVelocity.scale(1 - Math.min(1, dt * 0.8), c.angularVelocity);
    }

    // ---- Drift scoring & nitro economy ----
    if (S.drifting && speed > 10) {
      S.driftTime += dt;
      S.driftMultiplier = Math.min(8, 1 + Math.floor(S.driftTime / 2.2));
      const pts = dt * speed * Math.min(slipMag, 1.0) * 14 * S.driftMultiplier;
      S.driftScore += pts;
      S.nitro = Math.min(1, S.nitro + dt * 0.16 * Math.min(1, slipMag * 1.6) * (S.boosting ? 0 : 1));
    }

    // ---- Upside-down auto recovery ----
    if (upW.y < 0.25 && speed < 3) {
      S.upsideDownTimer += dt;
      if (S.upsideDownTimer > 2.0) { S.upsideDownTimer = 0; this.emit('requestReset', {}); }
    } else S.upsideDownTimer = 0;

    // ---- Per-wheel slip for audio/particles ----
    let rearSlip = 0;
    for (let i = 0; i < 4; i++) {
      const w = v.wheelInfos[i];
      let slip = 0;
      if (w.isInContact) {
        slip = Math.abs(lateralSpeed) * (i >= 2 ? 1 : 0.6) + (1 - w.skidInfo) * 12;
        if (i >= 2 && handbrake) slip += absFwd * 0.25;
      }
      this.wheelSlip[i] = slip;
      if (i >= 2) rearSlip += slip * 0.5;
    }
    S.rearSlip = rearSlip;
    S.wheelspin = throttleIn > 0.5 && absFwd < 12 && S.gear === 1 ? throttleIn * (1 - absFwd / 12) : 0;
  }

  _bankDrift() {
    const S = this.state;
    if (S.driftScore > 50) {
      const banked = Math.floor(S.driftScore);
      S.bankedScore += banked;
      S.totalScore += banked;
      this.emit('driftBank', { score: banked, multiplier: S.driftMultiplier });
    }
    S.driftScore = 0;
    S.driftMultiplier = 1;
    S.driftTime = 0;
  }

  _updateGearbox(dt, absFwd, forwardSpeed, throttle, brake) {
    const T = this.T, S = this.state;
    if (this._shiftTimer > 0) this._shiftTimer -= dt;
    if (S.gear === -1 && (forwardSpeed > 0.5 || brake === 0)) S.gear = 1;
    if (S.gear >= 1) {
      const top = T.gearTops[S.gear];
      const low = T.gearTops[S.gear - 1];
      if (absFwd > top * 0.97 && S.gear < 6 && throttle > 0) {
        S.gear++;
        this._shiftTimer = T.shiftTime;
        this.emit('shift', { gear: S.gear, up: true });
      } else if (S.gear > 1 && absFwd < low * 0.82) {
        S.gear--;
        this.emit('shift', { gear: S.gear, up: false });
      }
    }
    const g = Math.max(1, S.gear);
    const top = T.gearTops[g];
    let target = T.idleRpm + (absFwd / top) * (T.redline - T.idleRpm);
    if (!S.onGround || S.wheelspin > 0 || (S.handbrake && throttle > 0) || (S.drifting && throttle > 0)) {
      target = Math.max(target, T.idleRpm + throttle * (T.redline - T.idleRpm) * (S.drifting ? 0.85 : 0.95));
    }
    if (absFwd < 1 && throttle > 0) target = T.idleRpm + throttle * 5500;
    if (this._shiftTimer > 0) target *= 0.78;
    S.rpm += (Math.min(target, T.redline + 150) - S.rpm) * Math.min(1, dt * 10);
    if (S.rpm > T.redline) S.rpm -= Math.random() * 300; // limiter bounce
  }

  /** Render-time visual sync with interpolation alpha. */
  updateVisuals(dt, alpha, time) {
    const S = this.state, v = this.vehicle;
    const root = this.mesh.root;
    root.position.lerpVectors(this._prevPos, this._currPos, alpha);
    root.quaternion.slerpQuaternions(this._prevQuat, this._currQuat, alpha);

    this.position.copy(root.position);
    this.velocity.set(this.chassis.velocity.x, this.chassis.velocity.y, this.chassis.velocity.z);
    this.forward.set(0, 0, -1).applyQuaternion(root.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(root.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(root.quaternion);

    // Weight transfer: damped springs toward accel-driven targets.
    const pitchTarget = THREE.MathUtils.clamp(this._longAccel * 0.0065, -0.075, 0.06);
    const rollTarget = THREE.MathUtils.clamp(-this._latAccel * 0.0055, -0.08, 0.08);
    const k = 140, d = 14;
    this._pitchVel += ((pitchTarget - this._pitch) * k - this._pitchVel * d) * dt;
    this._pitch += this._pitchVel * dt;
    this._rollVel += ((rollTarget - this._roll) * k - this._rollVel * d) * dt;
    this._roll += this._rollVel * dt;
    this.mesh.setBodyTilt(this._pitch, this._roll);

    // Wheels
    for (let i = 0; i < 4; i++) {
      const w = v.wheelInfos[i];
      let rollSpeed = S.forwardSpeed;
      if (i >= 2) {
        if (S.handbrake && S.onGround) rollSpeed *= 0.15;
        else if (S.drifting || S.wheelspin > 0) rollSpeed = Math.max(rollSpeed, 10 + S.throttle * 25);
      }
      this._wheelSpin[i] -= (rollSpeed * dt) / this.T.wheelRadius;
      this.mesh.setWheel(i, w.suspensionLength, w.steering, this._wheelSpin[i]);
      // Contact points for skid marks / smoke
      if (w.isInContact) {
        this.contactPoints[i] = this.contactPoints[i] || new THREE.Vector3();
        const hp = w.raycastResult.hitPointWorld;
        this.contactPoints[i].set(hp.x, hp.y, hp.z);
      } else this.contactPoints[i] = null;
    }

    this.mesh.setBrake(Math.max(S.brake, S.handbrake ? 0.7 : 0), S.gear === -1);
    this.mesh.setNitro(S.boosting || S.boostPadTimer > 0.4, time);
    this.mesh.setUnderglowPulse(0.5 + 0.5 * Math.sin(time * 3));
  }

  /** World-space exhaust positions. */
  getExhaustWorld(out = []) {
    this.mesh.exhaustPoints.forEach((p, i) => {
      out[i] = (out[i] || new THREE.Vector3()).copy(p);
      this.mesh.body.localToWorld(out[i]);
    });
    return out;
  }

  dispose() {
    this.vehicle.removeFromWorld(this.physics.world);
    this.mesh.dispose();
    this.listeners = {};
  }
}
