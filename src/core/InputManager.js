/**
 * InputManager — unified keyboard + Gamepad API input.
 * Produces smoothed analog axes (steer/throttle/brake) plus edge-triggered actions.
 */
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'handbrake',
  ShiftLeft: 'nitro', ShiftRight: 'nitro',
  KeyR: 'reset',
  KeyC: 'camera',
  Escape: 'pause', KeyP: 'pause',
  KeyM: 'mute',
};

export class InputManager {
  constructor() {
    this.keys = new Set();
    this.pressedThisFrame = new Set();
    this.state = {
      steer: 0,      // -1 (left) .. 1 (right), smoothed
      throttle: 0,   // 0..1
      brake: 0,      // 0..1 (also reverse)
      handbrake: false,
      nitro: false,
    };
    this.gamepadIndex = -1;
    this._prevPadButtons = [];
    this.usingGamepad = false;

    this._onKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) {
        return;
      }
      const a = KEYMAP[e.code];
      if (!a) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(a)) this.pressedThisFrame.add(a);
      this.keys.add(a);
      this.usingGamepad = false;
    };
    this._onKeyUp = (e) => {
      const a = KEYMAP[e.code];
      if (a) this.keys.delete(a);
    };
    this._onBlur = () => this.keys.clear();
    this._onPadConnect = (e) => { this.gamepadIndex = e.gamepad.index; };
    this._onPadDisconnect = (e) => { if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = -1; };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('gamepadconnected', this._onPadConnect);
    window.addEventListener('gamepaddisconnected', this._onPadDisconnect);
  }

  /** Was the action pressed since the last `endFrame()`? */
  wasPressed(action) { return this.pressedThisFrame.has(action); }

  /** Call once per render frame after consumers have read edge events. */
  endFrame() { this.pressedThisFrame.clear(); }

  _pollGamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    let pad = this.gamepadIndex >= 0 ? pads[this.gamepadIndex] : null;
    if (!pad) {
      for (const p of pads) if (p) { pad = p; this.gamepadIndex = p.index; break; }
    }
    if (!pad) return null;
    const btn = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
    const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
    const res = {
      steer: dz(pad.axes[0] || 0),
      throttle: btn(7),
      brake: btn(6),
      handbrake: btn(0) > 0.5 || btn(5) > 0.5,
      nitro: btn(2) > 0.5 || btn(4) > 0.5,
    };
    // Edge-triggered buttons: Y=reset, Start=pause, Back=camera
    const edges = { 3: 'reset', 9: 'pause', 8: 'camera' };
    for (const [i, action] of Object.entries(edges)) {
      const down = btn(+i) > 0.5;
      if (down && !this._prevPadButtons[i]) this.pressedThisFrame.add(action);
      this._prevPadButtons[i] = down;
    }
    if (Math.abs(res.steer) > 0.05 || res.throttle > 0.05 || res.brake > 0.05) this.usingGamepad = true;
    return res;
  }

  /** Update smoothed axes. dt in seconds. */
  update(dt) {
    const pad = this._pollGamepad();
    const k = this.keys;
    let targetSteer = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0);
    let throttle = k.has('up') ? 1 : 0;
    let brake = k.has('down') ? 1 : 0;
    let handbrake = k.has('handbrake');
    let nitro = k.has('nitro');

    if (pad && this.usingGamepad) {
      targetSteer = pad.steer;
      throttle = Math.max(throttle, pad.throttle);
      brake = Math.max(brake, pad.brake);
      handbrake = handbrake || pad.handbrake;
      nitro = nitro || pad.nitro;
      this.state.steer = targetSteer; // analog sticks need no smoothing
    } else {
      // Keyboard: ramp toward target, snap back faster to center.
      const s = this.state.steer;
      const rate = targetSteer === 0 || Math.sign(targetSteer) !== Math.sign(s) ? 7.5 : 4.2;
      const diff = targetSteer - s;
      const step = Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
      this.state.steer = s + step;
    }
    this.state.throttle = throttle;
    this.state.brake = brake;
    this.state.handbrake = handbrake;
    this.state.nitro = nitro;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('gamepadconnected', this._onPadConnect);
    window.removeEventListener('gamepaddisconnected', this._onPadDisconnect);
  }
}
