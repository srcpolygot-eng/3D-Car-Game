/**
 * MenuOverlay — Start screen, pause menu, camera mode selector,
 * graphics quality toggles, reset button, and controls overlay.
 */
export class MenuOverlay {
  constructor(container, { onStart, onResume, onRestart, onCameraChange, onQualityChange, onMuteToggle }) {
    this.container = container;
    this.onStart = onStart;
    this.onResume = onResume;
    this.onRestart = onRestart;
    this.onCameraChange = onCameraChange;
    this.onQualityChange = onQualityChange;
    this.onMuteToggle = onMuteToggle;

    this.root = document.createElement('div');
    this.root.id = 'menu-root';
    this.root.style.cssText = `
      position: absolute;
      inset: 0;
      pointer-events: auto;
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
      user-select: none;
      z-index: 100;
    `;
    this.container.appendChild(this.root);

    this.isPaused = false;
    this.hasStarted = false;
    this.cameraMode = 'Chase'; // Chase, Hood, Bumper, Orbit
    this.quality = 'high';

    this._createStartScreen();
    this._createPauseScreen();
    this._createTopBar();
  }

  _createStartScreen() {
    this.startScreen = document.createElement('div');
    this.startScreen.style.cssText = `
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at center, rgba(16, 2, 34, 0.85) 0%, rgba(5, 1, 13, 0.96) 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(8px);
      transition: opacity 0.4s ease;
    `;

    this.startScreen.innerHTML = `
      <div style="text-align: center; max-width: 680px; padding: 20px;">
        <h1 style="font-size: 64px; font-weight: 900; font-style: italic; letter-spacing: 4px; margin: 0; background: linear-gradient(135deg, #22f3ff 0%, #ff2bd6 60%, #ffd36b 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; filter: drop-shadow(0 0 24px rgba(255, 43, 214, 0.6));">
          NEON DRIFT
        </h1>
        <p style="font-size: 16px; font-weight: 700; letter-spacing: 3px; color: #22f3ff; margin-top: 6px; text-transform: uppercase;">
          Midnight Dockyard // Arcade-Sim
        </p>

        <div style="margin: 32px 0 36px 0; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 43, 214, 0.3); border-radius: 12px; padding: 20px 28px; text-align: left; display: grid; grid-template-columns: 1fr 1fr; gap: 14px 28px; font-size: 14px;">
          <div><strong style="color: #22f3ff;">W / ↑</strong> : Throttle</div>
          <div><strong style="color: #22f3ff;">S / ↓</strong> : Brake / Reverse</div>
          <div><strong style="color: #22f3ff;">A / D or ← / →</strong> : Steer</div>
          <div><strong style="color: #ff2bd6;">SPACE</strong> : Handbrake (Drift)</div>
          <div><strong style="color: #8a2bff;">SHIFT</strong> : Nitro Boost</div>
          <div><strong style="color: #ffd36b;">C</strong> : Camera Mode</div>
          <div><strong style="color: #ffd36b;">R</strong> : Respawn / Reset</div>
          <div><strong style="color: #ffd36b;">ESC / P</strong> : Pause Menu</div>
        </div>

        <button id="btn-start" style="
          background: linear-gradient(135deg, #ff2bd6, #8a2bff);
          color: #fff;
          font-size: 22px;
          font-weight: 900;
          font-style: italic;
          letter-spacing: 3px;
          padding: 16px 54px;
          border: none;
          border-radius: 36px;
          cursor: pointer;
          box-shadow: 0 0 25px rgba(255, 43, 214, 0.7);
          transition: transform 0.15s, box-shadow 0.15s;
        ">PRESS TO RACE</button>
      </div>
    `;

    this.root.appendChild(this.startScreen);

    const btnStart = this.startScreen.querySelector('#btn-start');
    btnStart.addEventListener('mouseenter', () => {
      btnStart.style.transform = 'scale(1.05)';
      btnStart.style.boxShadow = '0 0 35px rgba(255, 43, 214, 0.9)';
    });
    btnStart.addEventListener('mouseleave', () => {
      btnStart.style.transform = 'scale(1.0)';
      btnStart.style.boxShadow = '0 0 25px rgba(255, 43, 214, 0.7)';
    });
    btnStart.addEventListener('click', () => {
      this.dismissStart();
    });
  }

  _createPauseScreen() {
    this.pauseScreen = document.createElement('div');
    this.pauseScreen.style.cssText = `
      position: absolute;
      inset: 0;
      background: rgba(5, 1, 13, 0.88);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(10px);
      z-index: 50;
    `;

    this.pauseScreen.innerHTML = `
      <div style="text-align: center; width: 340px;">
        <h2 style="font-size: 42px; font-weight: 900; font-style: italic; letter-spacing: 3px; color: #22f3ff; margin-bottom: 24px; text-shadow: 0 0 16px #22f3ff;">
          PAUSED
        </h2>
        <div style="display: flex; flex-direction: column; gap: 14px;">
          <button id="btn-resume" style="padding: 12px; font-size: 16px; font-weight: 800; border-radius: 8px; border: 1px solid #22f3ff; background: rgba(34, 243, 255, 0.15); color: #fff; cursor: pointer;">RESUME</button>
          <button id="btn-restart" style="padding: 12px; font-size: 16px; font-weight: 800; border-radius: 8px; border: 1px solid #ff2bd6; background: rgba(255, 43, 214, 0.15); color: #fff; cursor: pointer;">RESTART RACE</button>
        </div>
      </div>
    `;

    this.root.appendChild(this.pauseScreen);

    this.pauseScreen.querySelector('#btn-resume').addEventListener('click', () => this.togglePause(false));
    this.pauseScreen.querySelector('#btn-restart').addEventListener('click', () => {
      this.togglePause(false);
      this.onRestart?.();
    });
  }

  _createTopBar() {
    this.topBar = document.createElement('div');
    this.topBar.style.cssText = `
      position: absolute;
      bottom: 24px;
      left: 28px;
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 10;
    `;

    // Camera toggle button
    this.btnCam = document.createElement('button');
    this.btnCam.style.cssText = this._buttonStyle();
    this.btnCam.textContent = 'CAM: CHASE';
    this.btnCam.addEventListener('click', () => this.cycleCamera());

    // Quality toggle button
    this.btnQuality = document.createElement('button');
    this.btnQuality.style.cssText = this._buttonStyle();
    this.btnQuality.textContent = 'GFX: HIGH';
    this.btnQuality.addEventListener('click', () => this.cycleQuality());

    // Reset button
    this.btnReset = document.createElement('button');
    this.btnReset.style.cssText = this._buttonStyle();
    this.btnReset.textContent = 'RESET (R)';
    this.btnReset.addEventListener('click', () => this.onRestart?.());

    // Mute button
    this.btnMute = document.createElement('button');
    this.btnMute.style.cssText = this._buttonStyle();
    this.btnMute.textContent = 'AUDIO: ON';
    this.btnMute.addEventListener('click', () => {
      const isMuted = this.onMuteToggle?.();
      this.btnMute.textContent = isMuted ? 'AUDIO: OFF' : 'AUDIO: ON';
    });

    this.topBar.appendChild(this.btnCam);
    this.topBar.appendChild(this.btnQuality);
    this.topBar.appendChild(this.btnReset);
    this.topBar.appendChild(this.btnMute);

    this.root.appendChild(this.topBar);
  }

  _buttonStyle() {
    return `
      background: rgba(16, 8, 30, 0.7);
      border: 1px solid rgba(255, 43, 214, 0.4);
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1px;
      padding: 8px 14px;
      border-radius: 6px;
      cursor: pointer;
      backdrop-filter: blur(4px);
      box-shadow: 0 0 10px rgba(0,0,0,0.5);
      transition: background 0.15s, border-color 0.15s;
    `;
  }

  dismissStart() {
    if (this.hasStarted) return;
    this.hasStarted = true;
    this.startScreen.style.opacity = '0';
    setTimeout(() => {
      this.startScreen.style.display = 'none';
    }, 400);
    this.onStart?.();
  }

  togglePause(forceState = null) {
    if (!this.hasStarted) return;
    this.isPaused = forceState !== null ? forceState : !this.isPaused;
    this.pauseScreen.style.display = this.isPaused ? 'flex' : 'none';
    if (this.isPaused) {
      this.onResume?.(false);
    } else {
      this.onResume?.(true);
    }
  }

  cycleCamera() {
    const modes = ['Chase', 'Hood', 'Cinematic'];
    const curIdx = modes.indexOf(this.cameraMode);
    this.cameraMode = modes[(curIdx + 1) % modes.length];
    this.btnCam.textContent = `CAM: ${this.cameraMode.toUpperCase()}`;
    this.onCameraChange?.(this.cameraMode);
  }

  cycleQuality() {
    const qList = ['high', 'medium', 'low'];
    const curIdx = qList.indexOf(this.quality);
    this.quality = qList[(curIdx + 1) % qList.length];
    this.btnQuality.textContent = `GFX: ${this.quality.toUpperCase()}`;
    this.onQualityChange?.(this.quality);
  }

  dispose() {
    this.root.remove();
  }
}
