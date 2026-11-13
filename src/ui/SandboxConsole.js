import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const PRESETS = [
  {
    label: 'Moon Gravity',
    code: 'world.gravity.set(0, -3.5, 0);',
  },
  {
    label: 'Hyper Car',
    code: 'T.topSpeed = 160; T.nitroTopSpeed = 200; T.maxEngineForce = 24000; T.nitroForce = 18000;',
  },
  {
    label: 'Slow-Mo',
    code: 'loop.timeScale = 0.35;',
  },
  {
    label: 'Spawn Cube',
    code: `(() => {
  const p = car.position.clone().addScaledVector(car.forward, 8);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshStandardMaterial({ color: 0x22f3ff, emissive: 0x114466 })
  );
  mesh.castShadow = true;
  scene.add(mesh);
  const body = new CANNON.Body({ mass: 35, shape: new CANNON.Box(new CANNON.Vec3(1, 1, 1)) });
  body.position.set(p.x, p.y + 3, p.z);
  world.addBody(body);
  onFrame(() => { mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); });
  return 'Spawned physics cube ahead of car';
})()`,
  },
  {
    label: 'Rainbow Paint',
    code: `clearHooks();
onFrame(() => {
  const c = new THREE.Color().setHSL((game.gameTime * 0.5) % 1, 0.9, 0.5);
  car.mesh.disposables[0].color.copy(c);
});`,
  },
  {
    label: 'Reset All',
    code: 'world.gravity.set(0, -20, 0); loop.timeScale = 1; clearHooks(); game.respawnCar(true);',
  },
];

/**
 * SandboxConsole — Live JavaScript REPL & modding sandbox overlay.
 * Lets players inspect and mutate any game system, physics, Three.js scene,
 * car tuning, or register per-frame hooks at runtime.
 */
export class SandboxConsole {
  /**
   * @param {HTMLElement} container
   * @param {object} game - The main Game instance
   */
  constructor(container, game) {
    this.container = container;
    this.game = game;
    this.isOpen = false;
    this.history = [];
    this.historyIdx = -1;
    this.frameHooks = new Set();
    this.vars = {};

    this._buildUI();
    this._bindGlobalKeys();
    this._printWelcome();
  }

  _buildUI() {
    this.root = document.createElement('div');
    this.root.id = 'sandbox-console';
    this.root.style.cssText = `
      position: absolute;
      left: 28px;
      bottom: 72px;
      width: 480px;
      max-width: calc(100vw - 56px);
      display: none;
      flex-direction: column;
      background: rgba(8, 3, 20, 0.9);
      border: 1px solid rgba(34, 243, 255, 0.45);
      border-radius: 10px;
      box-shadow: 0 0 28px rgba(34, 243, 255, 0.2), 0 12px 32px rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(10px);
      pointer-events: auto;
      z-index: 150;
      overflow: hidden;
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: linear-gradient(90deg, rgba(34, 243, 255, 0.14), rgba(255, 43, 214, 0.14));
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1px;
    `;

    const titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'display: flex; align-items: center; gap: 8px; color: #22f3ff;';
    titleWrap.innerHTML = `
      <span>JS SANDBOX</span>
      <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(255, 43, 214, 0.25); color: #ff2bd6;">LIVE</span>
    `;

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; align-items: center; gap: 6px;';

    this.btnHelp = this._headerBtn('HELP', () => this.printHelp());
    this.btnClear = this._headerBtn('CLEAR', () => this.clearLog());
    this.btnClose = this._headerBtn('×', () => this.toggle(false));
    this.btnClose.style.fontSize = '15px';
    this.btnClose.style.padding = '1px 8px';

    actions.append(this.btnHelp, this.btnClear, this.btnClose);
    header.append(titleWrap, actions);

    // Preset chips
    const presetBar = document.createElement('div');
    presetBar.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 7px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.02);
    `;
    for (const preset of PRESETS) {
      const chip = document.createElement('button');
      chip.textContent = preset.label;
      chip.title = preset.code;
      chip.style.cssText = `
        background: rgba(34, 243, 255, 0.08);
        border: 1px solid rgba(34, 243, 255, 0.3);
        color: #c7f9ff;
        font-family: inherit;
        font-size: 10px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 999px;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
      `;
      chip.addEventListener('mouseenter', () => {
        chip.style.background = 'rgba(34, 243, 255, 0.2)';
        chip.style.borderColor = '#22f3ff';
      });
      chip.addEventListener('mouseleave', () => {
        chip.style.background = 'rgba(34, 243, 255, 0.08)';
        chip.style.borderColor = 'rgba(34, 243, 255, 0.3)';
      });
      chip.addEventListener('click', () => {
        this.execute(preset.code);
        this.input.focus();
      });
      presetBar.appendChild(chip);
    }

    // Output log
    this.logEl = document.createElement('div');
    this.logEl.style.cssText = `
      height: 190px;
      overflow-y: auto;
      padding: 8px 12px;
      font-size: 12px;
      line-height: 1.45;
      user-select: text;
      color: #e6e6f0;
    `;

    // Input row
    const inputWrap = document.createElement('div');
    inputWrap.style.cssText = `
      display: flex;
      align-items: stretch;
      gap: 8px;
      padding: 8px 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(0, 0, 0, 0.35);
    `;

    this.input = document.createElement('textarea');
    this.input.rows = 2;
    this.input.spellcheck = false;
    this.input.placeholder = 'Type JS to change anything... (Enter = run, Shift+Enter = newline)';
    this.input.style.cssText = `
      flex: 1;
      resize: vertical;
      min-height: 38px;
      max-height: 140px;
      background: rgba(16, 8, 30, 0.85);
      border: 1px solid rgba(255, 43, 214, 0.4);
      border-radius: 6px;
      color: #fff;
      font-family: inherit;
      font-size: 12px;
      line-height: 1.4;
      padding: 7px 9px;
      outline: none;
      user-select: text;
    `;
    this.input.addEventListener('focus', () => {
      this.input.style.borderColor = '#22f3ff';
    });
    this.input.addEventListener('blur', () => {
      this.input.style.borderColor = 'rgba(255, 43, 214, 0.4)';
    });
    this.input.addEventListener('keydown', (e) => this._onInputKeyDown(e));

    const runBtn = document.createElement('button');
    runBtn.textContent = 'RUN';
    runBtn.style.cssText = `
      background: linear-gradient(135deg, #22f3ff, #8a2bff);
      border: none;
      border-radius: 6px;
      color: #05010d;
      font-family: inherit;
      font-size: 12px;
      font-weight: 800;
      padding: 0 14px;
      cursor: pointer;
      letter-spacing: 0.5px;
    `;
    runBtn.addEventListener('click', () => this._submitInput());

    inputWrap.append(this.input, runBtn);
    this.root.append(header, presetBar, this.logEl, inputWrap);
    this.container.appendChild(this.root);
  }

  _headerBtn(label, onClick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.16);
      color: #ddd;
      font-family: inherit;
      font-size: 10px;
      font-weight: 700;
      padding: 3px 7px;
      border-radius: 4px;
      cursor: pointer;
    `;
    btn.addEventListener('click', onClick);
    return btn;
  }

  _bindGlobalKeys() {
    this._onWindowKeyDown = (e) => {
      // Backquote (~ / `) toggles sandbox when not typing in an input,
      // and Escape closes it when focused inside the sandbox.
      if (e.code === 'Backquote') {
        const active = document.activeElement;
        const inField = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
        if (!inField || e.ctrlKey) {
          e.preventDefault();
          this.toggle();
        }
      } else if (e.code === 'Escape' && this.isOpen && this.root.contains(document.activeElement)) {
        e.preventDefault();
        this.toggle(false);
      }
    };
    window.addEventListener('keydown', this._onWindowKeyDown);
  }

  _onInputKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._submitInput();
      return;
    }

    if (e.key === 'ArrowUp' && !e.shiftKey) {
      const atTop = this.input.selectionStart === 0 && this.input.selectionEnd === 0;
      if (atTop || !this.input.value.includes('\n')) {
        if (this.history.length > 0) {
          e.preventDefault();
          if (this.historyIdx === -1) this.historyIdx = this.history.length;
          if (this.historyIdx > 0) {
            this.historyIdx--;
            this.input.value = this.history[this.historyIdx];
          }
        }
      }
    } else if (e.key === 'ArrowDown' && !e.shiftKey) {
      const atEnd = this.input.selectionStart === this.input.value.length;
      if (atEnd || !this.input.value.includes('\n')) {
        if (this.historyIdx !== -1) {
          e.preventDefault();
          if (this.historyIdx < this.history.length - 1) {
            this.historyIdx++;
            this.input.value = this.history[this.historyIdx];
          } else {
            this.historyIdx = -1;
            this.input.value = '';
          }
        }
      }
    }
  }

  _submitInput() {
    const code = this.input.value.trim();
    if (!code) return;
    if (this.history[this.history.length - 1] !== code) {
      this.history.push(code);
    }
    this.historyIdx = -1;
    this.input.value = '';
    this.execute(code);
  }

  toggle(forceState = null) {
    this.isOpen = forceState !== null ? forceState : !this.isOpen;
    this.root.style.display = this.isOpen ? 'flex' : 'none';
    if (this.isOpen) {
      this.input.focus();
    } else if (this.root.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    return this.isOpen;
  }

  /** Called every render frame from Game.render() to run user-registered hooks. */
  updateHooks(dt) {
    if (this.frameHooks.size === 0) return;
    for (const fn of this.frameHooks) {
      try {
        fn(dt, this.game);
      } catch (err) {
        this.frameHooks.delete(fn);
        this._appendLine(`✖ Hook error (removed): ${err?.message || err}`, '#ff5c8a');
      }
    }
  }

  /** Execute arbitrary JavaScript in the live game scope. */
  execute(code) {
    this._appendLine(`> ${code}`, '#22f3ff');

    const g = this.game;
    const scope = {
      game: g,
      car: g.car,
      T: g.car?.T,
      tuning: g.car?.T,
      scene: g.sceneMgr?.scene,
      camera: g.sceneMgr?.camera,
      sceneMgr: g.sceneMgr,
      world: g.physics?.world,
      physics: g.physics,
      track: g.track,
      props: g.props,
      checkpoints: g.checkpoints,
      traffic: g.aiTraffic,
      particles: g.particles,
      audio: g.audio,
      hud: g.hud,
      menu: g.menu,
      loop: g.loop,
      input: g.input,
      vars: this.vars,
      THREE,
      CANNON,
      log: (...args) => this._appendLine(args.map((a) => this._format(a)).join(' '), '#e6e6f0'),
      clear: () => this.clearLog(),
      help: () => this.printHelp(),
      onFrame: (fn) => {
        if (typeof fn !== 'function') throw new TypeError('onFrame(fn) expects a function');
        this.frameHooks.add(fn);
        return `Registered hook (${this.frameHooks.size} active)`;
      },
      clearHooks: () => {
        const count = this.frameHooks.size;
        this.frameHooks.clear();
        return `Cleared ${count} hook(s)`;
      },
    };

    const keys = Object.keys(scope);
    const values = Object.values(scope);

    // Temporarily capture console output during synchronous evaluation
    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    console.log = (...args) => {
      origLog(...args);
      this._appendLine(args.map((a) => this._format(a)).join(' '), '#e6e6f0');
    };
    console.warn = (...args) => {
      origWarn(...args);
      this._appendLine(args.map((a) => this._format(a)).join(' '), '#ffd36b');
    };
    console.error = (...args) => {
      origError(...args);
      this._appendLine(args.map((a) => this._format(a)).join(' '), '#ff5c8a');
    };

    try {
      let fn;
      try {
        fn = new Function(...keys, `"use strict"; return (\n${code}\n);`);
      } catch {
        fn = new Function(...keys, `"use strict";\n${code}`);
      }
      const result = fn(...values);
      if (result !== undefined) {
        this._appendLine(`← ${this._format(result)}`, '#a6ffb8');
      }
    } catch (err) {
      this._appendLine(`✖ ${err?.name || 'Error'}: ${err?.message || err}`, '#ff5c8a');
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    }
  }

  _format(val) {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (typeof val === 'function') return `[Function ${val.name || 'anonymous'}]`;
    if (val instanceof THREE.Vector3 || val instanceof CANNON.Vec3) {
      return `Vec3(${val.x.toFixed(2)}, ${val.y.toFixed(2)}, ${val.z.toFixed(2)})`;
    }
    if (val instanceof THREE.Color) {
      return `Color(#${val.getHexString()})`;
    }
    try {
      const seen = new WeakSet();
      return JSON.stringify(val, (k, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        return v;
      });
    } catch {
      return String(val);
    }
  }

  _appendLine(text, color = '#e6e6f0') {
    const line = document.createElement('div');
    line.style.cssText = `
      color: ${color};
      white-space: pre-wrap;
      word-break: break-word;
      margin-bottom: 3px;
    `;
    line.textContent = text;
    this.logEl.appendChild(line);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  clearLog() {
    this.logEl.innerHTML = '';
  }

  _printWelcome() {
    this._appendLine('JS Sandbox ready. Press ` (~) or click SANDBOX to toggle.', '#9aa0b8');
    this._appendLine('Type help() to see exposed globals & examples.', '#9aa0b8');
  }

  printHelp() {
    this._appendLine(
      [
        'Available globals:',
        '  game, car, T (tuning), scene, camera, sceneMgr',
        '  world (Cannon), physics, track, props, checkpoints',
        '  traffic, particles, audio, hud, menu, loop, input',
        '  THREE, CANNON, vars (persistent object)',
        'Helpers:',
        '  log(...), clear(), help(), onFrame(fn), clearHooks()',
        'Examples:',
        '  world.gravity.set(0, -5, 0)',
        '  T.topSpeed = 150; T.maxEngineForce = 20000',
        '  car.position.y += 10',
        '  scene.fog.density = 0.0005',
      ].join('\n'),
      '#ffd36b'
    );
  }

  dispose() {
    window.removeEventListener('keydown', this._onWindowKeyDown);
    this.frameHooks.clear();
    this.root.remove();
  }
}
