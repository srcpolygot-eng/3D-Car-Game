/**
 * SoundEngine — 100% procedural Web Audio API engine.
 * Synthesizes:
 * - Multi-oscillator engine tone (sawtooth + triangle + sub) with throttle-load distortion and dynamic low-pass filtering.
 * - Tire screech (pink/bandpass noise) modulated by lateral wheel slip.
 * - Turbo blow-off valve (noise burst + resonant highpass downward sweep on upshifts).
 * - Nitro hiss & turbine whine.
 * - Collision impacts (pitch-dropping sub-bass thud + crunch noise).
 * - UI beeps & countdown tones.
 */
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.muted = false;
    this.initialized = false;

    // Engine synth nodes
    this.engineGain = null;
    this.oscSaw1 = null;
    this.oscSaw2 = null;
    this.oscSub = null;
    this.engineFilter = null;
    this.waveshaper = null;

    // Tire screech nodes
    this.tireGain = null;
    this.tireFilter = null;
    this.tireNoise = null;

    // Nitro sound nodes
    this.nitroGain = null;
    this.nitroFilter = null;
    this.nitroNoise = null;
    this.nitroOsc = null;

    // Wind / speed rush noise
    this.windGain = null;
    this.windFilter = null;
    this.windNoise = null;
  }

  init() {
    if (this.initialized) return;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      console.warn('Web Audio API not supported.');
      return;
    }

    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
    this.masterGain.connect(this.ctx.destination);

    this._createEngineSynth();
    this._createTireScreech();
    this._createNitroSound();
    this._createWindRush();

    this.initialized = true;

    // Handle initial browser autoplay policy
    if (this.ctx.state === 'suspended') {
      const resume = () => {
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume();
        }
        window.removeEventListener('click', resume);
        window.removeEventListener('keydown', resume);
        window.removeEventListener('touchstart', resume);
      };
      window.addEventListener('click', resume);
      window.addEventListener('keydown', resume);
      window.addEventListener('touchstart', resume);
    }
  }

  _makeDistortionCurve(k = 20) {
    const n = 256;
    const curve = new Float32Array(n);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; ++i) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  _createNoiseBuffer(seconds = 3) {
    const sampleRate = this.ctx.sampleRate;
    const bufferSize = sampleRate * seconds;
    const buffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      // Pinkish noise filter
      lastOut = (lastOut * 0.94) + (white * 0.06);
      data[i] = lastOut * 3.5;
    }
    return buffer;
  }

  _createEngineSynth() {
    const ctx = this.ctx;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.setValueAtTime(0.35, ctx.currentTime);

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.setValueAtTime(450, ctx.currentTime);
    this.engineFilter.Q.setValueAtTime(3.0, ctx.currentTime);

    this.waveshaper = ctx.createWaveShaper();
    this.waveshaper.curve = this._makeDistortionCurve(18);
    this.waveshaper.oversample = '2x';

    // Saw 1: Primary fundamental
    this.oscSaw1 = ctx.createOscillator();
    this.oscSaw1.type = 'sawtooth';
    this.oscSaw1.frequency.setValueAtTime(45, ctx.currentTime);

    // Saw 2: Slightly detuned secondary harmonic
    this.oscSaw2 = ctx.createOscillator();
    this.oscSaw2.type = 'sawtooth';
    this.oscSaw2.frequency.setValueAtTime(45.6, ctx.currentTime);

    // Sub oscillator for deep rumble
    this.oscSub = ctx.createOscillator();
    this.oscSub.type = 'triangle';
    this.oscSub.frequency.setValueAtTime(22.5, ctx.currentTime);

    const sawGain = ctx.createGain();
    sawGain.gain.setValueAtTime(0.5, ctx.currentTime);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.4, ctx.currentTime);

    this.oscSaw1.connect(sawGain);
    this.oscSaw2.connect(sawGain);
    this.oscSub.connect(subGain);

    sawGain.connect(this.waveshaper);
    subGain.connect(this.engineFilter);

    this.waveshaper.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.oscSaw1.start();
    this.oscSaw2.start();
    this.oscSub.start();
  }

  _createTireScreech() {
    const ctx = this.ctx;
    const noiseBuffer = this._createNoiseBuffer(2);

    this.tireNoise = ctx.createBufferSource();
    this.tireNoise.buffer = noiseBuffer;
    this.tireNoise.loop = true;

    this.tireFilter = ctx.createBiquadFilter();
    this.tireFilter.type = 'bandpass';
    this.tireFilter.frequency.setValueAtTime(950, ctx.currentTime);
    this.tireFilter.Q.setValueAtTime(4.5, ctx.currentTime);

    this.tireGain = ctx.createGain();
    this.tireGain.gain.setValueAtTime(0.0, ctx.currentTime);

    this.tireNoise.connect(this.tireFilter);
    this.tireFilter.connect(this.tireGain);
    this.tireGain.connect(this.masterGain);

    this.tireNoise.start();
  }

  _createNitroSound() {
    const ctx = this.ctx;
    const noiseBuffer = this._createNoiseBuffer(2);

    this.nitroNoise = ctx.createBufferSource();
    this.nitroNoise.buffer = noiseBuffer;
    this.nitroNoise.loop = true;

    this.nitroFilter = ctx.createBiquadFilter();
    this.nitroFilter.type = 'bandpass';
    this.nitroFilter.frequency.setValueAtTime(1400, ctx.currentTime);
    this.nitroFilter.Q.setValueAtTime(2.0, ctx.currentTime);

    this.nitroGain = ctx.createGain();
    this.nitroGain.gain.setValueAtTime(0.0, ctx.currentTime);

    // High turbine whistle
    this.nitroOsc = ctx.createOscillator();
    this.nitroOsc.type = 'sine';
    this.nitroOsc.frequency.setValueAtTime(3200, ctx.currentTime);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.08, ctx.currentTime);
    this.nitroOsc.connect(oscGain);
    oscGain.connect(this.nitroGain);

    this.nitroNoise.connect(this.nitroFilter);
    this.nitroFilter.connect(this.nitroGain);
    this.nitroGain.connect(this.masterGain);

    this.nitroNoise.start();
    this.nitroOsc.start();
  }

  _createWindRush() {
    const ctx = this.ctx;
    const noiseBuffer = this._createNoiseBuffer(3);

    this.windNoise = ctx.createBufferSource();
    this.windNoise.buffer = noiseBuffer;
    this.windNoise.loop = true;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.setValueAtTime(200, ctx.currentTime);

    this.windGain = ctx.createGain();
    this.windGain.gain.setValueAtTime(0.0, ctx.currentTime);

    this.windNoise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);

    this.windNoise.start();
  }

  /**
   * Continuous frame update for vehicle telemetry
   */
  update({ rpm = 1000, maxRpm = 8000, throttle = 0, speedKmh = 0, slip = 0, isNitro = false }) {
    if (!this.initialized || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;

    // 1. Engine frequency based on RPM
    const rpmNorm = Math.min(1, Math.max(0, (rpm - 800) / (maxRpm - 800)));
    const baseFreq = 32 + Math.pow(rpmNorm, 1.25) * 220; // 32 Hz up to ~252 Hz fundamental

    this.oscSaw1.frequency.setTargetAtTime(baseFreq, t, 0.04);
    this.oscSaw2.frequency.setTargetAtTime(baseFreq * 1.012 + 0.5, t, 0.04);
    this.oscSub.frequency.setTargetAtTime(baseFreq * 0.5, t, 0.04);

    // Filter frequency responds heavily to throttle (intake roar)
    const cutoff = 300 + Math.pow(rpmNorm, 1.4) * 2200 + throttle * 1200;
    this.engineFilter.frequency.setTargetAtTime(cutoff, t, 0.03);

    // Engine volume dynamics
    const engineVol = 0.28 + throttle * 0.22 + rpmNorm * 0.15;
    this.engineGain.gain.setTargetAtTime(engineVol, t, 0.05);

    // 2. Tire screech modulated by lateral slip
    const slipIntensity = Math.min(1, Math.max(0, (slip - 2.5) / 10.0));
    const targetTireVol = slipIntensity * 0.45;
    const tireCenterFreq = 850 + slipIntensity * 450;
    this.tireGain.gain.setTargetAtTime(targetTireVol, t, 0.04);
    this.tireFilter.frequency.setTargetAtTime(tireCenterFreq, t, 0.05);

    // 3. Nitro sound
    const targetNitroVol = isNitro ? 0.35 : 0.0;
    this.nitroGain.gain.setTargetAtTime(targetNitroVol, t, 0.08);

    // 4. Wind rush at high speeds
    const windNorm = Math.min(1, Math.max(0, (speedKmh - 60) / 180));
    this.windGain.gain.setTargetAtTime(windNorm * 0.25, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(150 + windNorm * 800, t, 0.1);
  }

  /**
   * Turbo blow-off valve on gear upshift
   */
  playBlowoff() {
    if (!this.initialized || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = this._createNoiseBuffer(0.4);

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(2800, now);
    filter.frequency.exponentialRampToValueAtTime(600, now + 0.32);
    filter.Q.setValueAtTime(6.0, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start(now);
    noise.stop(now + 0.36);
  }

  /**
   * Collision thud & metallic crunch
   */
  playCollision(impactVelocity = 5) {
    if (!this.initialized || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const strength = Math.min(1, Math.max(0.1, impactVelocity / 22));

    // 1. Sub punch (sine drop)
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.28);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(strength * 0.7, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.32);

    // 2. Crunch noise
    const noise = ctx.createBufferSource();
    noise.buffer = this._createNoiseBuffer(0.25);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(500, now);
    filter.Q.setValueAtTime(1.5, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(strength * 0.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);

    noise.start(now);
    noise.stop(now + 0.25);
  }

  /**
   * Checkpoint gate chime
   */
  playCheckpoint(isLap = false) {
    if (!this.initialized || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const freq = isLap ? 880 : 587.33; // A5 or D5
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.setValueAtTime(freq * 1.5, now + 0.08);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.42);
  }

  /**
   * Boost pad chime
   */
  playBoostPad() {
    if (!this.initialized || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(1100, now + 0.25);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.32);
  }

  toggleMute() {
    if (!this.masterGain) return false;
    this.muted = !this.muted;
    this.masterGain.gain.setValueAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime);
    return this.muted;
  }
}
