import * as THREE from 'three';
import { GameLoop } from './core/GameLoop.js';
import { SceneManager } from './core/SceneManager.js';
import { PhysicsWorld } from './core/PhysicsWorld.js';
import { InputManager } from './core/InputManager.js';
import { SoundEngine } from './audio/SoundEngine.js';
import { TrackBuilder } from './world/TrackBuilder.js';
import { EnvironmentProps } from './world/EnvironmentProps.js';
import { CheckpointManager } from './world/CheckpointManager.js';
import { CarController } from './vehicle/CarController.js';
import { ParticleSystem } from './vehicle/ParticleSystem.js';
import { AITraffic } from './vehicle/AITraffic.js';
import { HUD } from './ui/HUD.js';
import { MenuOverlay } from './ui/MenuOverlay.js';
import { SandboxConsole } from './ui/SandboxConsole.js';

class Game {
  constructor() {
    this.appContainer = document.getElementById('app');
    this.uiRoot = document.getElementById('ui-root');
    this.errorBox = document.getElementById('boot-error');

    this.cameraMode = 'Chase'; // 'Chase', 'Hood', 'Cinematic'
    this.camTargetPos = new THREE.Vector3();
    this.camTargetLook = new THREE.Vector3();
    this.camCurrPos = new THREE.Vector3(0, 10, 20);
    this.camCurrLook = new THREE.Vector3();
    this.camShake = 0;

    this.isPaused = false;
    this.gameTime = 0;
  }

  async boot() {
    try {
      // 1. Core systems
      this.sceneMgr = new SceneManager(this.appContainer);
      this.physics = new PhysicsWorld();
      this.input = new InputManager();
      this.audio = new SoundEngine();
      this.particles = new ParticleSystem(this.sceneMgr.scene);
      this.particles.setPixelScale(window.innerHeight);

      // 2. World & Track
      this.track = new TrackBuilder(this.sceneMgr, this.physics);
      this.track.build();

      this.props = new EnvironmentProps(this.sceneMgr, this.physics, this.track);
      this.props.build();

      this.checkpoints = new CheckpointManager(this.sceneMgr, this.track, {
        count: 8,
        totalLaps: 3,
      });

      // 3. Vehicles
      this.car = new CarController(this.physics, this.sceneMgr.scene, {
        color: 0x7a1cff, // Deep Synthwave Purple
        accent: 0x22f3ff, // Cyan Neon
        lights: true,
      });

      this.aiTraffic = new AITraffic(this.sceneMgr.scene, this.physics, this.track);

      // Spawn player at start gate
      this.respawnCar();

      // 4. UI Systems
      this.hud = new HUD(this.uiRoot, this.track);
      this.menu = new MenuOverlay(this.uiRoot, {
        onStart: () => {
          this.audio.init();
        },
        onResume: (running) => {
          this.isPaused = !running;
        },
        onRestart: () => {
          this.respawnCar(true);
        },
        onCameraChange: (mode) => {
          this.cameraMode = mode;
        },
        onQualityChange: (level) => {
          this.sceneMgr.setQuality(level);
        },
        onMuteToggle: () => {
          return this.audio.toggleMute();
        },
        onToggleSandbox: () => {
          this.sandbox.toggle();
        },
      });
      this.sandbox = new SandboxConsole(this.uiRoot, this);

      // 5. Wire Events & Audio Feedback
      this._bindEvents();

      // 6. Game Loop (120 Hz fixed physics, smooth decoupled render)
      this.loop = new GameLoop({
        fixedDt: 1 / 120,
        fixedUpdate: (dt) => this.fixedUpdate(dt),
        render: (dt, alpha) => this.render(dt, alpha),
      });

      window.addEventListener('resize', () => {
        this.particles.setPixelScale(window.innerHeight);
      });

      this.loop.start();
    } catch (err) {
      console.error('Fatal boot error:', err);
      if (this.errorBox) {
        this.errorBox.style.display = 'flex';
        this.errorBox.textContent = `CRITICAL GAME ENGINE ERROR:\n${err.stack || err.message}`;
      }
    }
  }

  _bindEvents() {
    const car = this.car;
    const audio = this.audio;
    const hud = this.hud;

    car.on('shift', ({ up }) => {
      if (up) audio.playBlowoff();
    });

    car.on('driftBank', ({ score }) => {
      hud.showBankNotice(score);
      this.checkpoints.submitDriftScore(score);
    });

    car.on('driftFail', () => {
      hud.showFailNotice();
    });

    car.on('boostpad', () => {
      audio.playBoostPad();
      this.camShake = Math.max(this.camShake, 0.45);
    });

    car.on('requestReset', () => {
      this.respawnCar();
    });

    this.checkpoints.on('checkpoint', (split) => {
      audio.playCheckpoint(false);
      hud.showSplitNotice(split.delta);
    });

    this.checkpoints.on('lap', ({ isBest }) => {
      audio.playCheckpoint(true);
      if (isBest) {
        hud.showBankNotice('NEW BEST LAP!');
      }
    });

    // Collision audio & particle bursts
    this.physics.onCollision((bodyA, bodyB, impact) => {
      if (impact > 1.8) {
        if (bodyA === car.chassis || bodyB === car.chassis) {
          audio.playCollision(impact);
          car.notifyImpact(impact);
          this.camShake = Math.min(1.0, this.camShake + impact * 0.04);

          const pos = car.position.clone();
          this.particles.impactBurst(pos, impact);
        }
      }
    });
  }

  respawnCar(fullReset = false) {
    const spawnIdx = fullReset ? 6 : this.checkpoints.lastCheckpointIndex;
    const spawn = this.track.getSpawn(spawnIdx, 0);
    this.car.reset(spawn.position, spawn.yaw);

    // Initialize camera smoothly behind car
    const fwd = this.car.forward;
    this.camCurrPos.copy(this.car.position).addScaledVector(fwd, -9).setY(this.car.position.y + 4.5);
    this.camCurrLook.copy(this.car.position);

    if (fullReset) {
      this.checkpoints.reset();
      this.props.resetProps();
      this.particles.clear();
    }
  }

  fixedUpdate(dt) {
    if (this.isPaused) return;

    // 1. Inputs
    this.input.update(dt);

    if (this.input.wasPressed('reset')) {
      this.respawnCar();
    }
    if (this.input.wasPressed('pause')) {
      this.menu.togglePause();
    }
    if (this.input.wasPressed('camera')) {
      this.menu.cycleCamera();
    }
    if (this.input.wasPressed('mute')) {
      const isMuted = this.audio.toggleMute();
      this.menu.btnMute.textContent = isMuted ? 'AUDIO: OFF' : 'AUDIO: ON';
    }

    // 2. Car dynamics
    this.car.fixedUpdate(dt, this.input.state);

    // 3. Physics step
    this.physics.step(dt);

    // 4. Boost pad triggers
    this._checkBoostPads(dt);

    // 5. Track checkpoints & lap progression
    this.checkpoints.update(dt, this.car.position, this.car.velocity);

    // 6. AI Traffic
    this.aiTraffic.update(dt);

    // 7. Dynamic Props
    this.props.update(dt);

    this.input.endFrame();
  }

  _checkBoostPads(dt) {
    const pads = this.track.boostPads;
    const pPos = this.car.position;

    for (const pad of pads) {
      if (pad.cooldown > 0) pad.cooldown -= dt;
      if (pad.cooldown <= 0) {
        const distSq = pPos.distanceToSquared(pad.position);
        if (distSq < pad.halfL * pad.halfL) {
          this.car.applyBoostPad();
          this.particles.boostPadBurst(pad.position);
          pad.cooldown = 1.8;
        }
      }
    }
  }

  render(frameDt, alpha) {
    this.gameTime += frameDt;
    this.sandbox?.updateHooks(frameDt);

    // 1. Interpolate car visuals
    this.car.updateVisuals(frameDt, alpha, this.gameTime);

    // 2. Update Audio Engine
    const s = this.car.state;
    this.audio.update({
      rpm: s.rpm,
      maxRpm: this.car.T.redline,
      throttle: s.throttle,
      speedKmh: s.kmh,
      slip: s.rearSlip,
      isNitro: s.boosting,
    });

    // 3. Particle Emitters (Smoke, Skid marks, Sparks, Nitro Flames)
    this._updateParticles(frameDt);

    // 4. Camera Tracking
    this._updateCamera(frameDt);

    // 5. Directional shadow follower
    this.sceneMgr.followShadow(this.car.position);

    // 6. Post-processing Speed FX
    const speedRatio = Math.min(1, s.speed / this.car.T.topSpeed);
    const boostRatio = s.boosting ? 1.0 : (s.boostPadTimer > 0 ? 0.8 : 0.0);
    this.sceneMgr.setSpeedFX(speedRatio, boostRatio, this.gameTime);

    // 7. Render Three.js Scene
    this.sceneMgr.render();

    // 8. Update HUD
    this.hud.update(frameDt, this.car, this.checkpoints, this.aiTraffic.cars);
  }

  _updateParticles(dt) {
    const car = this.car;
    const s = car.state;

    // A. Tire smoke & Skidmarks for all 4 contact wheels
    for (let i = 0; i < 4; i++) {
      const pt = car.contactPoints[i];
      const slip = car.wheelSlip[i];
      const isRear = i >= 2;

      if (pt) {
        // Skidmark ribbon
        const skidAlpha = THREE.MathUtils.clamp((slip - 2.8) / 8.0, 0, 0.95);
        this.particles.skids.add(i, pt, skidAlpha);

        // Tire smoke puff
        if (slip > 3.5) {
          const intensity = Math.min(1.5, (slip - 3.5) / 7.0);
          const tint = s.drifting
            ? [0.85, 0.5, 1.0] // Neon purple/pink smoke tint on big drift
            : [0.75, 0.72, 0.82];
          this.particles.tireSmoke(pt, car.velocity, intensity, tint);

          // Drift sparks on hard slide
          if (slip > 7.0 && Math.random() < 0.45) {
            const side = car.right.clone().multiplyScalar(i % 2 === 0 ? -1 : 1);
            this.particles.sparks(pt, side, 4, [3.0, 1.2, 0.3]);
          }
        }
      } else {
        this.particles.skids.add(i, null, 0);
      }
    }

    // B. Nitro flame exhaust trail
    if (s.boosting || s.boostPadTimer > 0.4) {
      const exhausts = car.getExhaustWorld();
      const back = car.forward.clone().negate();
      for (const ex of exhausts) {
        this.particles.nitroFlame(ex, back, car.velocity);
      }
    }

    this.particles.update(dt);
  }

  _updateCamera(dt) {
    const car = this.car;
    const s = car.state;
    const cam = this.sceneMgr.camera;

    const pPos = car.position;
    const pFwd = car.forward;
    const pUp = car.up;

    // Decay camera shake
    if (this.camShake > 0) {
      this.camShake = Math.max(0, this.camShake - dt * 2.5);
    }
    const shakeOffset = new THREE.Vector3(
      (Math.random() - 0.5) * this.camShake * 0.4,
      (Math.random() - 0.5) * this.camShake * 0.3,
      (Math.random() - 0.5) * this.camShake * 0.4,
    );

    if (this.cameraMode === 'Chase') {
      // Dynamic chase camera with drift swing & speed lag
      const dist = 7.8 + Math.min(3.5, (s.speed / car.T.topSpeed) * 3.5);
      const height = 3.2;

      // Position behind car along heading, swinging out during drifts
      this.camTargetPos.copy(pPos)
        .addScaledVector(pFwd, -dist)
        .addScaledVector(pUp, height);

      // Look slightly ahead of the car
      this.camTargetLook.copy(pPos)
        .addScaledVector(pFwd, 6.0)
        .addScaledVector(pUp, 1.2);

      const smoothPos = Math.min(1, dt * 11);
      const smoothLook = Math.min(1, dt * 14);

      this.camCurrPos.lerp(this.camTargetPos, smoothPos);
      this.camCurrLook.lerp(this.camTargetLook, smoothLook);

      // Dynamic FOV kick on speed & nitro
      const baseFov = this.sceneMgr.baseFov;
      const fovKick = (s.speed / car.T.topSpeed) * 14 + (s.boosting ? 12 : 0);
      cam.fov = baseFov + fovKick;
      cam.updateProjectionMatrix();

    } else if (this.cameraMode === 'Hood') {
      // Bonnet / Hood cam
      this.camTargetPos.copy(pPos)
        .addScaledVector(pFwd, -0.2)
        .addScaledVector(pUp, 1.1);

      this.camTargetLook.copy(pPos)
        .addScaledVector(pFwd, 25.0)
        .addScaledVector(pUp, 0.9);

      this.camCurrPos.lerp(this.camTargetPos, Math.min(1, dt * 28));
      this.camCurrLook.lerp(this.camTargetLook, Math.min(1, dt * 28));

      cam.fov = this.sceneMgr.baseFov + 16 + (s.boosting ? 8 : 0);
      cam.updateProjectionMatrix();

    } else if (this.cameraMode === 'Cinematic') {
      // Low wide angle tracking angle
      const orbitAngle = this.gameTime * 0.4;
      this.camTargetPos.copy(pPos)
        .add(new THREE.Vector3(Math.sin(orbitAngle) * 9, 2.0, Math.cos(orbitAngle) * 9));

      this.camTargetLook.copy(pPos).addScaledVector(pUp, 0.8);

      this.camCurrPos.lerp(this.camTargetPos, Math.min(1, dt * 6));
      this.camCurrLook.lerp(this.camTargetLook, Math.min(1, dt * 8));

      cam.fov = 58;
      cam.updateProjectionMatrix();
    }

    cam.position.copy(this.camCurrPos).add(shakeOffset);
    cam.lookAt(this.camCurrLook);
  }
}

// Boot game when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  window.game = game;
  game.boot();
});
