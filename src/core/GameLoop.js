/**
 * GameLoop — fixed-timestep simulation with a variable-rate render step.
 *
 * - Physics/gameplay advance in deterministic FIXED_DT slices.
 * - Frame delta is clamped so tab-switching / breakpoints never explode the sim.
 * - Render receives the interpolation alpha for smooth visuals between steps.
 */
export class GameLoop {
  /**
   * @param {object} opts
   * @param {(dt:number)=>void} opts.fixedUpdate  called 0..maxSubSteps times per frame
   * @param {(dt:number, alpha:number)=>void} opts.render called once per frame
   * @param {number} [opts.fixedDt=1/120]
   * @param {number} [opts.maxFrameDt=0.1]
   * @param {number} [opts.maxSubSteps=8]
   */
  constructor({ fixedUpdate, render, fixedDt = 1 / 120, maxFrameDt = 0.1, maxSubSteps = 8 }) {
    this.fixedUpdate = fixedUpdate;
    this.render = render;
    this.fixedDt = fixedDt;
    this.maxFrameDt = maxFrameDt;
    this.maxSubSteps = maxSubSteps;
    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this.timeScale = 1;
    this.rafId = 0;
    this.elapsed = 0;
    this.fps = 60;
    this._tick = this._tick.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    document.addEventListener('visibilitychange', this._onVisibility);
    this.rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    document.removeEventListener('visibilitychange', this._onVisibility);
  }

  _onVisibility() {
    // Reset the clock when returning to the tab so we don't simulate the gap.
    this.lastTime = performance.now();
    this.accumulator = 0;
  }

  _tick(now) {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this._tick);

    let frameDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!Number.isFinite(frameDt) || frameDt < 0) frameDt = 0;
    frameDt = Math.min(frameDt, this.maxFrameDt);
    this.fps += ((frameDt > 0 ? 1 / frameDt : 60) - this.fps) * 0.05;

    const scaled = frameDt * this.timeScale;
    this.accumulator += scaled;
    this.elapsed += scaled;

    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxSubSteps) {
      this.fixedUpdate(this.fixedDt);
      this.accumulator -= this.fixedDt;
      steps++;
    }
    // If we hit the cap, drop the leftover time instead of spiraling.
    if (steps >= this.maxSubSteps) this.accumulator = 0;

    this.render(frameDt, this.accumulator / this.fixedDt);
  }
}
