import { CONFIG } from './config.js';
import { ASSETS } from './assets.js';

// WebAudio: decoded SFX with pitch jitter, plus a fully procedural
// ambience bed (55 Hz drone, filtered wind, sparse low bell) and a
// low-HP heartbeat.
export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.heartbeat = { timer: 0, active: false };
    this.bellTimer = 6;
  }

  // Must be called from a user gesture.
  async init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = CONFIG.audio.sfxVolume;
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = CONFIG.audio.musicVolume;
    this.musicGain.connect(this.master);

    const decodes = Object.entries(ASSETS.sfxBuffers).map(async ([key, ab]) => {
      this.buffers[key] = await this.ctx.decodeAudioData(ab.slice(0));
    });
    await Promise.all(decodes);
    this.startAmbience();
  }

  resume() { this.ctx?.resume(); }

  setSfxVolume(v) { if (this.sfxGain) this.sfxGain.gain.value = v; }
  setMusicVolume(v) { if (this.musicGain) this.musicGain.gain.value = v; }

  play(key, { volume = 1, pitch = 1, jitter = CONFIG.audio.pitchJitter, delay = 0 } = {}) {
    if (!this.ctx || !this.buffers[key]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[key];
    src.playbackRate.value = pitch * (1 + (Math.random() * 2 - 1) * jitter);
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.sfxGain);
    src.start(this.ctx.currentTime + delay);
  }

  playOne(keys, opts) {
    this.play(keys[(Math.random() * keys.length) | 0], opts);
  }

  // ---- procedural ambience -------------------------------------------
  startAmbience() {
    const ctx = this.ctx;
    // Low drone: two slightly detuned oscillators around 55 Hz.
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.05;
    droneGain.connect(this.musicGain);
    for (const detune of [-4, 3]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 55;
      osc.detune.value = detune;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 160;
      osc.connect(f).connect(droneGain);
      osc.start();
    }

    // Wind: looped noise through a slowly-wandering bandpass.
    const len = ctx.sampleRate * 4;
    const noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 320;
    bp.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.035;
    noise.connect(bp).connect(windGain).connect(this.musicGain);
    noise.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(bp.frequency);
    lfo.start();
    this.windGain = windGain;
  }

  // Sparse low bell, called from the game loop with real dt.
  update(dt, playerHpFrac) {
    if (!this.ctx) return;
    this.bellTimer -= dt;
    if (this.bellTimer <= 0) {
      this.bellTimer = 11 + Math.random() * 14;
      this.tollBell();
    }
    // Heartbeat under low HP.
    const low = playerHpFrac > 0 && playerHpFrac <= CONFIG.player.lowHpThreshold / CONFIG.player.hp;
    if (low) {
      this.heartbeat.timer -= dt;
      if (this.heartbeat.timer <= 0) {
        const rate = 0.55 + 0.5 * (1 - playerHpFrac * (CONFIG.player.hp / CONFIG.player.lowHpThreshold));
        this.heartbeat.timer = Math.max(0.45, 0.95 - rate * 0.3);
        this.thump(0.16);
        setTimeout(() => this.thump(0.1), 180);
      }
    }
  }

  thump(vol) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(58, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  }

  tollBell() {
    const ctx = this.ctx;
    const base = 98 * (Math.random() < 0.5 ? 1 : 0.75);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + 5);
    g.connect(this.musicGain);
    for (const [mult, amp] of [[1, 1], [2.76, 0.4], [5.4, 0.18]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * mult;
      const og = ctx.createGain();
      og.gain.value = amp;
      osc.connect(og).connect(g);
      osc.start();
      osc.stop(ctx.currentTime + 5.2);
    }
  }
}
