import { CONFIG } from './config.js';

function roman(n) {
  const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return out || 'I';
}

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
};

export class UI {
  constructor() {
    this.root = document.getElementById('ui');

    // --- loading / start screen ---
    this.startScreen = el('div', 'screen start-screen', this.root);
    el('h1', 'title', this.startScreen, 'GRAVEHOLD');
    el('p', 'flavor', this.startScreen, 'The bells of Vespers have gone silent. Hold the court until dawn — or join it.');
    this.loadingWrap = el('div', 'loading-wrap', this.startScreen);
    this.loadingBar = el('div', 'loading-bar', this.loadingWrap);
    this.loadingText = el('div', 'loading-text', this.startScreen, 'Unsealing the crypt&hellip;');
    this.enterHint = el('div', 'enter-hint hidden', this.startScreen, 'CLICK TO ENTER');
    this.controlsHint = el('div', 'controls-hint hidden', this.startScreen,
      'WASD move &middot; SHIFT sprint &middot; SPACE jump &middot; LMB fire &middot; R reload &middot; 1/2/wheel weapons &middot; ESC pause');

    // --- HUD ---
    this.hud = el('div', 'hud hidden', this.root);
    this.crosshair = el('div', 'crosshair', this.hud);
    for (const d of ['t', 'b', 'l', 'r']) el('div', `tick tick-${d}`, this.crosshair);
    el('div', 'dot', this.crosshair);
    this.hitmark = el('div', 'hitmarker', this.crosshair);
    for (const d of ['a', 'b', 'c', 'd']) el('div', `hm hm-${d}`, this.hitmark);

    const hpWrap = el('div', 'hp-wrap', this.hud);
    this.hpBar = el('div', 'hp-bar', hpWrap);
    this.hpText = el('div', 'hp-text', hpWrap, '100');

    this.ammoWrap = el('div', 'ammo-wrap', this.hud);
    this.ammoBig = el('div', 'ammo-big', this.ammoWrap, '12');
    this.ammoSmall = el('div', 'ammo-small', this.ammoWrap, 'BOLTS');

    this.topWrap = el('div', 'top-wrap', this.hud);
    this.waveText = el('div', 'wave-text', this.topWrap, '');
    this.killText = el('div', 'kill-text', this.topWrap, '');

    this.banner = el('div', 'wave-banner hidden', this.hud);

    this.vignette = el('div', 'vignette-damage', this.hud);
    this.ember = el('div', 'vignette-ember', this.hud);
    this.healFx = el('div', 'heal-flash', this.hud);

    this.fps = el('div', 'fps hidden', this.hud, '');

    // --- pause ---
    this.pauseScreen = el('div', 'screen pause-screen hidden', this.root);
    el('h2', 'subtitle', this.pauseScreen, 'RESPITE');
    this.resumeBtn = el('button', 'btn', this.pauseScreen, 'Resume');
    this.restartBtn = el('button', 'btn', this.pauseScreen, 'Restart');
    const sensRow = el('div', 'slider-row', this.pauseScreen);
    el('label', null, sensRow, 'Sensitivity');
    this.sensSlider = el('input', null, sensRow);
    Object.assign(this.sensSlider, { type: 'range', min: 0.2, max: 2.5, step: 0.05, value: 1 });
    const volRow = el('div', 'slider-row', this.pauseScreen);
    el('label', null, volRow, 'Volume');
    this.volSlider = el('input', null, volRow);
    Object.assign(this.volSlider, { type: 'range', min: 0, max: 1, step: 0.05, value: CONFIG.audio.sfxVolume });

    // --- death ---
    this.deathScreen = el('div', 'screen death-screen hidden', this.root);
    el('h2', 'death-title', this.deathScreen, 'THE COURT CLAIMS YOU');
    this.deathStats = el('div', 'death-stats', this.deathScreen, '');
    this.deathRestartBtn = el('button', 'btn', this.deathScreen, 'Rise Again');

    this.bannerTimer = null;
  }

  setProgress(f) {
    this.loadingBar.style.width = `${Math.round(f * 100)}%`;
  }

  loadingDone() {
    this.loadingWrap.classList.add('hidden');
    this.loadingText.classList.add('hidden');
    this.enterHint.classList.remove('hidden');
    this.controlsHint.classList.remove('hidden');
  }

  showStart() {
    this.startScreen.classList.remove('hidden');
    this.hud.classList.add('hidden');
  }

  startGame() {
    this.startScreen.classList.add('hidden');
    this.pauseScreen.classList.add('hidden');
    this.deathScreen.classList.add('hidden');
    this.hud.classList.remove('hidden');
  }

  updateHud(game) {
    const player = game.player;
    const hpFrac = player.hp / CONFIG.player.hp;
    this.hpBar.style.width = `${hpFrac * 100}%`;
    // gold draining to ember
    const hue = 38 * hpFrac + 8;
    this.hpBar.style.background = `hsl(${hue}, 72%, ${30 + 22 * hpFrac}%)`;
    this.hpText.textContent = Math.ceil(player.hp);

    const w = game.weapons;
    if (w.current.name === 'crossbow') {
      this.ammoBig.textContent = w.reloading > 0 ? '—' : w.ammo;
      this.ammoSmall.textContent = 'BOLTS';
      this.ammoBig.classList.toggle('low', w.ammo <= 3 && w.reloading <= 0);
    } else {
      this.ammoBig.textContent = w.charges;
      this.ammoSmall.textContent = 'HEXES';
      this.ammoBig.classList.toggle('low', w.charges === 0);
    }

    this.waveText.textContent = game.enemies.wave > 0 ? `WAVE ${roman(game.enemies.wave)}` : '';
    this.killText.textContent = `${game.enemies.kills} SLAIN`;

    this.ember.style.opacity = player.hp <= CONFIG.player.lowHpThreshold && player.alive
      ? String(0.45 + 0.25 * (1 - player.hp / CONFIG.player.lowHpThreshold)) : '0';
  }

  setWeapon() {}

  showWave(n) {
    this.banner.innerHTML = `WAVE ${roman(n)}`;
    this.banner.classList.remove('hidden');
    this.banner.classList.remove('anim');
    void this.banner.offsetWidth;
    this.banner.classList.add('anim');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.banner.classList.add('hidden'), 2600);
  }

  showWaveCleared(n) {
    this.banner.innerHTML = `WAVE ${roman(n)} CLEARED`;
    this.banner.classList.remove('hidden');
    this.banner.classList.remove('anim');
    void this.banner.offsetWidth;
    this.banner.classList.add('anim');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.banner.classList.add('hidden'), 2200);
  }

  hitmarker(crit) {
    this.hitmark.classList.remove('show');
    void this.hitmark.offsetWidth;
    this.hitmark.classList.toggle('crit', !!crit);
    this.hitmark.classList.add('show');
  }

  damageFlash(frac) {
    this.vignette.style.opacity = String(Math.min(0.85, 0.3 + frac * 1.6));
    clearTimeout(this._dmgTimer);
    this._dmgTimer = setTimeout(() => { this.vignette.style.opacity = '0'; }, 140);
  }

  healFlash() {
    this.healFx.style.opacity = '0.5';
    clearTimeout(this._healTimer);
    this._healTimer = setTimeout(() => { this.healFx.style.opacity = '0'; }, 220);
  }

  showPause() { this.pauseScreen.classList.remove('hidden'); }
  hidePause() { this.pauseScreen.classList.add('hidden'); }

  showDeath(wave, kills, best) {
    this.deathStats.innerHTML =
      `You endured <b>${wave > 0 ? roman(wave) : '—'}</b> wave${wave === 1 ? '' : 's'} and slew <b>${kills}</b> horrors.` +
      (best > 0 ? `<br>Session best: <b>${best}</b> slain.` : '');
    this.deathScreen.classList.remove('hidden');
    this.hud.classList.add('hidden');
  }

  setFps(v, visible) {
    this.fps.classList.toggle('hidden', !visible);
    if (visible) this.fps.textContent = `${v} FPS`;
  }
}
