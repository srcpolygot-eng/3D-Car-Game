/**
 * HUD — Heads-Up Display:
 * - Speedometer & RPM gauge (neon arcade tachometer)
 * - Gear indicator
 * - Nitro gauge
 * - Drift score & combo multiplier badge
 * - Lap timer & sector splits
 * - Mini-map with track silhouette, player dot, and AI traffic blips
 * - Wrong-way warning
 */
export class HUD {
  constructor(container, track) {
    this.container = container;
    this.track = track;

    this.root = document.createElement('div');
    this.root.id = 'hud-container';
    this.root.style.cssText = `
      position: absolute;
      inset: 0;
      pointer-events: none;
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
      overflow: hidden;
    `;
    this.container.appendChild(this.root);

    this._createSpeedoGauge();
    this._createDriftDisplay();
    this._createTimeDisplay();
    this._createMinimap();
    this._createWrongWayBanner();

    this.flashBankTimer = 0;
    this.flashFailTimer = 0;
  }

  _createSpeedoGauge() {
    this.speedoWrapper = document.createElement('div');
    this.speedoWrapper.style.cssText = `
      position: absolute;
      bottom: 24px;
      right: 32px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      text-shadow: 0 0 12px rgba(34, 243, 255, 0.6);
    `;

    // Speed digits + unit
    this.speedRow = document.createElement('div');
    this.speedRow.style.cssText = `display: flex; align-items: baseline; gap: 8px;`;

    this.speedVal = document.createElement('div');
    this.speedVal.style.cssText = `
      font-size: 72px;
      font-weight: 900;
      font-style: italic;
      color: #fff;
      line-height: 1;
      letter-spacing: -2px;
    `;
    this.speedVal.textContent = '000';

    this.speedUnit = document.createElement('div');
    this.speedUnit.style.cssText = `
      font-size: 18px;
      font-weight: 700;
      color: #22f3ff;
      letter-spacing: 2px;
    `;
    this.speedUnit.textContent = 'KM/H';

    this.speedRow.appendChild(this.speedVal);
    this.speedRow.appendChild(this.speedUnit);

    // Gear indicator & RPM
    this.gearRpmRow = document.createElement('div');
    this.gearRpmRow.style.cssText = `
      display: flex;
      align-items: center;
      gap: 16px;
      margin-top: 6px;
      width: 220px;
    `;

    this.gearVal = document.createElement('div');
    this.gearVal.style.cssText = `
      font-size: 28px;
      font-weight: 900;
      color: #ff2bd6;
      width: 32px;
      text-align: center;
      border: 2px solid #ff2bd6;
      border-radius: 6px;
      padding: 2px 0;
      box-shadow: 0 0 10px rgba(255, 43, 214, 0.4);
    `;
    this.gearVal.textContent = '1';

    // RPM Bar container
    this.rpmBarOuter = document.createElement('div');
    this.rpmBarOuter.style.cssText = `
      flex: 1;
      height: 12px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 4px;
      overflow: hidden;
      display: flex;
      padding: 2px;
      box-shadow: inset 0 0 4px #000;
    `;

    this.rpmBarFill = document.createElement('div');
    this.rpmBarFill.style.cssText = `
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #22f3ff 0%, #ff2bd6 70%, #ff1744 100%);
      border-radius: 2px;
      transition: width 0.05s ease-out;
    `;
    this.rpmBarOuter.appendChild(this.rpmBarFill);

    this.gearRpmRow.appendChild(this.gearVal);
    this.gearRpmRow.appendChild(this.rpmBarOuter);

    // Nitro Bar
    this.nitroRow = document.createElement('div');
    this.nitroRow.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 8px;
      width: 220px;
    `;

    this.nitroLabel = document.createElement('div');
    this.nitroLabel.style.cssText = `
      font-size: 11px;
      font-weight: 800;
      color: #a855f7;
      letter-spacing: 1px;
    `;
    this.nitroLabel.textContent = 'NITRO';

    this.nitroBarOuter = document.createElement('div');
    this.nitroBarOuter.style.cssText = `
      flex: 1;
      height: 8px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      overflow: hidden;
      padding: 1px;
    `;

    this.nitroBarFill = document.createElement('div');
    this.nitroBarFill.style.cssText = `
      height: 100%;
      width: 50%;
      background: linear-gradient(90deg, #8a2bff, #22f3ff);
      box-shadow: 0 0 8px #22f3ff;
      border-radius: 2px;
      transition: width 0.08s ease-out;
    `;
    this.nitroBarOuter.appendChild(this.nitroBarFill);
    this.nitroRow.appendChild(this.nitroLabel);
    this.nitroRow.appendChild(this.nitroBarOuter);

    this.speedoWrapper.appendChild(this.speedRow);
    this.speedoWrapper.appendChild(this.gearRpmRow);
    this.speedoWrapper.appendChild(this.nitroRow);

    this.root.appendChild(this.speedoWrapper);
  }

  _createDriftDisplay() {
    this.driftBox = document.createElement('div');
    this.driftBox.style.cssText = `
      position: absolute;
      top: 140px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      opacity: 0;
      transition: opacity 0.2s, transform 0.2s;
      text-shadow: 0 0 16px rgba(255, 43, 214, 0.8);
    `;

    this.driftScoreText = document.createElement('div');
    this.driftScoreText.style.cssText = `
      font-size: 44px;
      font-weight: 900;
      font-style: italic;
      color: #ff2bd6;
      letter-spacing: 2px;
    `;
    this.driftScoreText.textContent = '+0 PTS';

    this.driftMultBadge = document.createElement('div');
    this.driftMultBadge.style.cssText = `
      font-size: 16px;
      font-weight: 800;
      background: #22f3ff;
      color: #05010d;
      padding: 2px 12px;
      border-radius: 12px;
      margin-top: 4px;
      letter-spacing: 1px;
      box-shadow: 0 0 10px #22f3ff;
    `;
    this.driftMultBadge.textContent = 'x1.0 DRIFT';

    this.driftBox.appendChild(this.driftScoreText);
    this.driftBox.appendChild(this.driftMultBadge);
    this.root.appendChild(this.driftBox);

    // Floating notifications for banked points or failed combo
    this.driftNotice = document.createElement('div');
    this.driftNotice.style.cssText = `
      position: absolute;
      top: 210px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 20px;
      font-weight: 800;
      opacity: 0;
      letter-spacing: 2px;
      transition: opacity 0.3s;
    `;
    this.root.appendChild(this.driftNotice);
  }

  _createTimeDisplay() {
    this.timeBox = document.createElement('div');
    this.timeBox.style.cssText = `
      position: absolute;
      top: 24px;
      left: 28px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      text-shadow: 0 0 8px rgba(0, 0, 0, 0.8);
    `;

    // Lap badge
    this.lapText = document.createElement('div');
    this.lapText.style.cssText = `
      font-size: 26px;
      font-weight: 900;
      font-style: italic;
      color: #ffd36b;
      letter-spacing: 1px;
    `;
    this.lapText.textContent = 'LAP 1 / 3';

    // Current lap timer
    this.lapTimer = document.createElement('div');
    this.lapTimer.style.cssText = `
      font-size: 32px;
      font-weight: 800;
      color: #fff;
      font-family: monospace;
      letter-spacing: 1px;
    `;
    this.lapTimer.textContent = '00:00.00';

    // Best lap
    this.bestTimer = document.createElement('div');
    this.bestTimer.style.cssText = `
      font-size: 14px;
      font-weight: 700;
      color: #22f3ff;
      font-family: monospace;
    `;
    this.bestTimer.textContent = 'BEST: --:--.--';

    // Sector split
    this.splitNotice = document.createElement('div');
    this.splitNotice.style.cssText = `
      font-size: 15px;
      font-weight: 800;
      opacity: 0;
      transition: opacity 0.3s;
    `;
    this.splitNotice.textContent = '+0.00';

    this.timeBox.appendChild(this.lapText);
    this.timeBox.appendChild(this.lapTimer);
    this.timeBox.appendChild(this.bestTimer);
    this.timeBox.appendChild(this.splitNotice);
    this.root.appendChild(this.timeBox);
  }

  _createMinimap() {
    this.mapCanvas = document.createElement('canvas');
    this.mapCanvas.width = 160;
    this.mapCanvas.height = 160;
    this.mapCanvas.style.cssText = `
      position: absolute;
      top: 24px;
      right: 28px;
      background: rgba(10, 2, 24, 0.65);
      border: 1px solid rgba(255, 43, 214, 0.4);
      border-radius: 12px;
      box-shadow: 0 0 14px rgba(0,0,0,0.5), inset 0 0 10px rgba(34, 243, 255, 0.15);
    `;
    this.root.appendChild(this.mapCanvas);
    this.mapCtx = this.mapCanvas.getContext('2d');

    // Precalculate bounds of track points
    const pts = this.track.points;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const pad = 35;
    this.mapBounds = {
      minX: minX - pad,
      maxX: maxX + pad,
      minZ: minZ - pad,
      maxZ: maxZ + pad,
      width: (maxX - minX) + pad * 2,
      height: (maxZ - minZ) + pad * 2,
    };
  }

  _createWrongWayBanner() {
    this.wrongWayBanner = document.createElement('div');
    this.wrongWayBanner.style.cssText = `
      position: absolute;
      top: 25%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 23, 68, 0.85);
      color: #fff;
      font-size: 32px;
      font-weight: 900;
      font-style: italic;
      padding: 10px 40px;
      border-radius: 8px;
      letter-spacing: 4px;
      box-shadow: 0 0 25px #ff1744;
      display: none;
      animation: blink 0.5s infinite alternate;
    `;
    this.wrongWayBanner.textContent = 'WRONG WAY!';
    this.root.appendChild(this.wrongWayBanner);
  }

  _formatTime(sec) {
    if (sec == null || !Number.isFinite(sec)) return '--:--.--';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 100);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }

  showBankNotice(score) {
    this.driftNotice.textContent = `BANKED +${score} PTS!`;
    this.driftNotice.style.color = '#22f3ff';
    this.driftNotice.style.textShadow = '0 0 12px #22f3ff';
    this.driftNotice.style.opacity = '1';
    this.flashBankTimer = 1.8;
  }

  showFailNotice() {
    this.driftNotice.textContent = `COMBO LOST!`;
    this.driftNotice.style.color = '#ff1744';
    this.driftNotice.style.textShadow = '0 0 12px #ff1744';
    this.driftNotice.style.opacity = '1';
    this.flashFailTimer = 1.6;
  }

  showSplitNotice(delta) {
    if (delta == null) return;
    const sign = delta > 0 ? '+' : '';
    this.splitNotice.textContent = `${sign}${delta.toFixed(2)}s`;
    this.splitNotice.style.color = delta <= 0 ? '#00e676' : '#ff1744';
    this.splitNotice.style.opacity = '1';
    setTimeout(() => {
      if (this.splitNotice) this.splitNotice.style.opacity = '0';
    }, 2500);
  }

  update(dt, car, checkpointManager, aiCars = []) {
    const s = car.state;

    // 1. Speed & Gear
    const kmh = Math.round(s.kmh);
    this.speedVal.textContent = kmh.toString().padStart(3, '0');

    if (s.gear === -1) {
      this.gearVal.textContent = 'R';
      this.gearVal.style.color = '#ffd36b';
    } else {
      this.gearVal.textContent = s.gear.toString();
      this.gearVal.style.color = '#ff2bd6';
    }

    const rpmFrac = Math.min(1, Math.max(0, (s.rpm - car.T.idleRpm) / (car.T.redline - car.T.idleRpm)));
    this.rpmBarFill.style.width = `${Math.round(rpmFrac * 100)}%`;

    // 2. Nitro
    this.nitroBarFill.style.width = `${Math.round(s.nitro * 100)}%`;

    // 3. Drift
    if (s.drifting && s.driftScore > 20) {
      this.driftBox.style.opacity = '1';
      this.driftBox.style.transform = `translateX(-50%) scale(${1 + Math.min(0.2, (s.driftMultiplier - 1) * 0.035)})`;
      this.driftScoreText.textContent = `+${Math.floor(s.driftScore)} PTS`;
      this.driftMultBadge.textContent = `x${s.driftMultiplier} DRIFT`;
    } else {
      this.driftBox.style.opacity = '0';
    }

    if (this.flashBankTimer > 0) {
      this.flashBankTimer -= dt;
      if (this.flashBankTimer <= 0) this.driftNotice.style.opacity = '0';
    }
    if (this.flashFailTimer > 0) {
      this.flashFailTimer -= dt;
      if (this.flashFailTimer <= 0) this.driftNotice.style.opacity = '0';
    }

    // 4. Lap Times
    const curLap = checkpointManager.lap;
    const totLaps = checkpointManager.totalLaps;
    this.lapText.textContent = `LAP ${Math.max(1, curLap)} / ${totLaps}`;
    this.lapTimer.textContent = this._formatTime(checkpointManager.lapTime);
    this.bestTimer.textContent = `BEST: ${this._formatTime(checkpointManager.records.bestLap)}`;

    // 5. Wrong way
    this.wrongWayBanner.style.display = checkpointManager.wrongWay ? 'block' : 'none';

    // 6. Minimap
    this._drawMinimap(car, aiCars);
  }

  _drawMinimap(playerCar, aiCars) {
    const ctx = this.mapCtx;
    const w = this.mapCanvas.width;
    const h = this.mapCanvas.height;
    const b = this.mapBounds;

    ctx.clearRect(0, 0, w, h);

    const worldToMap = (wx, wz) => {
      const mx = ((wx - b.minX) / b.width) * (w - 20) + 10;
      const my = ((wz - b.minZ) / b.height) * (h - 20) + 10;
      return [mx, my];
    };

    // Draw track line
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 43, 214, 0.45)';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pts = this.track.points;
    for (let i = 0; i < pts.length; i += 3) {
      const [mx, my] = worldToMap(pts[i].x, pts[i].z);
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    }
    ctx.closePath();
    ctx.stroke();

    // Start / finish marker
    const [sx, sy] = worldToMap(pts[0].x, pts[0].z);
    ctx.fillStyle = '#ffd36b';
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fill();

    // AI Traffic blips
    ctx.fillStyle = '#ff1744';
    for (const ai of aiCars) {
      const [ax, ay] = worldToMap(ai.position.x, ai.position.z);
      ctx.beginPath();
      ctx.arc(ax, ay, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player blip
    const [px, py] = worldToMap(playerCar.position.x, playerCar.position.z);
    ctx.fillStyle = '#22f3ff';
    ctx.shadowColor = '#22f3ff';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  dispose() {
    this.root.remove();
  }
}
