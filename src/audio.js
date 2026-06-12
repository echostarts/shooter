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
    // music chain: musicGain (user volume) -> duck (pause) -> master
    this.duckGain = this.ctx.createGain();
    this.duckGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = CONFIG.audio.musicVolume;
    this.musicGain.connect(this.duckGain);

    const decodes = Object.entries(ASSETS.sfxBuffers).map(async ([key, ab]) => {
      this.buffers[key] = await this.ctx.decodeAudioData(ab.slice(0));
    });
    await Promise.all(decodes);
    this.startAmbience();
    this.startMusic();
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

  // Synthesized beast growl: distorted saw with pitch wobble + breath noise.
  growl({ volume = 0.4, pitch = 1 } = {}) {
    if (!this.ctx || volume <= 0.01) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 0.45 + Math.random() * 0.3;
    const f0 = 72 * pitch * (0.9 + Math.random() * 0.2);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0 * 1.3, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.78, t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9 + Math.random() * 5;
    const lfoG = ctx.createGain();
    lfoG.gain.value = f0 * 0.2;
    lfo.connect(lfoG).connect(osc.frequency);

    if (!this._distCurve) {
      const n = 256;
      const c = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = Math.tanh(x * 3.2);
      }
      this._distCurve = c;
    }
    const ws = ctx.createWaveShaper();
    ws.curve = this._distCurve;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 430;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volume, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(ws).connect(lp).connect(g).connect(this.sfxGain);

    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 260;
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(volume * 0.4, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(bp).connect(ng).connect(this.sfxGain);

    osc.start(t); lfo.start(t); n.start(t, Math.random() * 2);
    osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05); n.stop(t + dur + 0.05);
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
    this.noiseBuf = noiseBuf;  // reused by the drum/tick layers
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

  // ---- procedural combat score ----------------------------------------
  // A-minor war music: bass ostinato + war drum that fades in with combat,
  // sombre pad swells in the lulls, low sting on death.
  startMusic() {
    const ctx = this.ctx;

    // cathedral reverb: synthetic stereo impulse, ~2.6 s decay
    const irLen = (ctx.sampleRate * 2.6) | 0;
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.4);
      }
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const revGain = ctx.createGain();
    revGain.gain.value = 0.55;
    this.reverb.connect(revGain).connect(this.musicGain);

    this.combatBus = ctx.createGain();
    this.combatBus.gain.value = 0;
    const combatLp = ctx.createBiquadFilter();
    combatLp.type = 'lowpass';
    combatLp.frequency.value = 1400;
    this.combatBus.connect(combatLp).connect(this.musicGain);
    // a touch of the combat layer into the hall
    const combatSend = ctx.createGain();
    combatSend.gain.value = 0.25;
    combatLp.connect(combatSend).connect(this.reverb);

    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.9;
    this.padBus.connect(this.musicGain);
    const padSend = ctx.createGain();
    padSend.gain.value = 0.7;
    this.padBus.connect(padSend).connect(this.reverb);

    // melodic layer (lead chimes) — mostly wet, sits "in the cathedral"
    this.leadBus = ctx.createGain();
    this.leadBus.gain.value = 0;
    this.leadBus.connect(this.musicGain);
    const leadSend = ctx.createGain();
    leadSend.gain.value = 1.1;
    this.leadBus.connect(leadSend).connect(this.reverb);

    this.stepDur = 60 / 96 / 4;          // 16ths at 96 BPM
    this.nextStep = ctx.currentTime + 0.2;
    this.step = 0;
    this.section = 0;                    // increments every 2 bars
    this.state = 'calm';                 // calm | combat | death
    this.intensity = 0.4;
    this.padTimer = 3;
    this.chimeTimer = 4;
  }

  setState(s) {
    if (!this.ctx || s === this.state) return;
    if (s === 'death') {
      this.playPad([55, 65.41, 82.41], 0.14, 7);   // low A-minor lament
      this.tollBell();
    }
    this.state = s;
  }

  setIntensity(v) { this.intensity = Math.max(0, Math.min(1, v)); }

  setPaused(p) {
    if (!this.duckGain) return;
    const t = this.ctx.currentTime;
    this.duckGain.gain.cancelScheduledValues(t);
    this.duckGain.gain.setTargetAtTime(p ? 0.18 : 1, t, 0.25);
  }

  // 2-bar (32-step) pattern; intensity opens the filter and adds layers.
  // Sections alternate bass roots (Am / Dm) and lead phrases call-and-answer.
  scheduleStep(step, t) {
    const I = this.intensity;
    const odd = this.section % 2 === 1;
    const BASS_A = { 0: 55, 3: 55, 6: 65.41, 8: 55, 11: 49, 14: 55, 16: 55, 19: 55, 22: 73.42, 24: 55, 27: 49, 30: 41.2 };
    const BASS_B = { 0: 73.42, 3: 73.42, 6: 87.31, 8: 73.42, 11: 65.41, 14: 73.42, 16: 55, 19: 55, 22: 65.41, 24: 55, 27: 51.91, 30: 55 };
    const BASS = odd ? BASS_B : BASS_A;
    if (BASS[step] !== undefined) {
      const accent = step % 8 === 0 ? 1 : 0.72;
      this.pluck(BASS[step], t, 0.24 * accent * (0.6 + I * 0.4), 140 + I * 620);
    }

    if (step % 8 === 0) this.warDrum(t, step % 16 === 0 ? 0.5 : 0.3);
    // drum fill rolling into the next section
    if (I > 0.5 && odd && step >= 29) this.warDrum(t, 0.14 + (step - 29) * 0.05);
    if (I > 0.55 && step % 4 === 2) this.tick(t, 0.025 + (I - 0.55) * 0.05);

    // brooding lead motif in A harmonic minor (call on even sections, answer on odd)
    if (I > 0.35) {
      const LEAD_A = { 0: 220, 4: 261.63, 8: 329.63, 12: 293.66, 14: 261.63, 16: 246.94, 20: 207.65, 24: 220 };
      const LEAD_B = { 0: 440, 6: 415.3, 12: 349.23, 16: 329.63, 22: 293.66, 26: 261.63 };
      const LEAD = odd ? LEAD_B : LEAD_A;
      if (LEAD[step] !== undefined) {
        this.chime(LEAD[step], t, 0.14 * (0.5 + I * 0.5), this.leadBus);
      }
    }

    // minor chord stab at the bar line when the fight runs hot
    if (I > 0.55 && step === 16) {
      const chord = odd ? [73.42, 110, 174.61] : [110, 164.81, 220];
      for (const f of chord) this.stab(f, t, 0.05 + I * 0.04);
    }
  }

  // dark celesta chime: triangle + octave shimmer, long ring through the hall
  chime(freq, t, vel, dest) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    g.connect(lp).connect(dest ?? this.padBus);
    const specs = [[1, 1, 'triangle'], [2, 0.28, 'sine'], [2.99, 0.1, 'sine']];
    for (const [mult, amp, type] of specs) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq * mult;
      osc.detune.value = (Math.random() - 0.5) * 7;
      const og = ctx.createGain();
      og.gain.value = amp;
      osc.connect(og).connect(g);
      osc.start(t);
      osc.stop(t + 1.5);
    }
  }

  // short filtered saw chord stab
  stab(freq, t, vel) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    osc.connect(lp).connect(g).connect(this.combatBus);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  pluck(freq, t, vel, cutoff) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = freq / 2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff * 0.3), t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    osc.connect(lp); sub.connect(lp);
    lp.connect(g).connect(this.combatBus);
    osc.start(t); sub.start(t);
    osc.stop(t + 0.3); sub.stop(t + 0.3);
  }

  warDrum(t, vel) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(96, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(g).connect(this.combatBus);
    osc.start(t); osc.stop(t + 0.26);
    // skin rattle
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 240;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    n.connect(bp).connect(ng).connect(this.combatBus);
    n.start(t, Math.random() * 2); n.stop(t + 0.1);
  }

  tick(t, vel) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    n.connect(hp).connect(g).connect(this.combatBus);
    n.start(t, Math.random() * 2); n.stop(t + 0.05);
  }

  playPad(freqs = null, vol = 0.05, release = 4) {
    const ctx = this.ctx;
    const chords = [
      [110, 130.81, 164.81],   // Am
      [87.31, 130.81, 174.61], // F
      [73.42, 110, 174.61],    // Dm
      [82.41, 123.47, 164.81], // Em
    ];
    const chord = freqs ?? chords[(Math.random() * chords.length) | 0];
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 2.2);
    g.gain.linearRampToValueAtTime(0.0001, t + 2.2 + release);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    g.connect(lp).connect(this.padBus);
    for (const f of chord) {
      for (const det of [-5, 6]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = f;
        osc.detune.value = det;
        osc.connect(g);
        osc.start(t);
        osc.stop(t + 2.4 + release);
      }
    }
  }

  // Called from the game loop with real dt.
  update(dt, playerHpFrac) {
    if (!this.ctx) return;
    this.bellTimer -= dt;
    if (this.bellTimer <= 0) {
      this.bellTimer = 11 + Math.random() * 14;
      this.tollBell();
    }

    if (this.combatBus) {
      const ctx = this.ctx;
      // catch up cleanly after long pauses instead of bursting old steps
      if (this.nextStep < ctx.currentTime - 0.2) this.nextStep = ctx.currentTime + 0.05;
      while (this.nextStep < ctx.currentTime + 0.15) {
        if (this.state === 'combat') this.scheduleStep(this.step, this.nextStep);
        this.nextStep += this.stepDur;
        this.step = (this.step + 1) % 32;
        if (this.step === 0) this.section++;
      }
      // combat + lead layers fade in/out
      const target = this.state === 'combat' ? 1.25 : 0;
      const cur = this.combatBus.gain.value;
      this.combatBus.gain.value = cur + (target - cur) * Math.min(1, dt * 1.1);
      const leadTarget = this.state === 'combat' ? 1 : 0;
      const leadCur = this.leadBus.gain.value;
      this.leadBus.gain.value = leadCur + (leadTarget - leadCur) * Math.min(1, dt * 0.8);
      // sombre pads in the lulls
      this.padTimer -= dt;
      if (this.padTimer <= 0) {
        this.padTimer = 10 + Math.random() * 6;
        if (this.state !== 'combat') this.playPad();
      }
      // sparse music-box chimes while the court is quiet
      this.chimeTimer -= dt;
      if (this.chimeTimer <= 0) {
        this.chimeTimer = 3.5 + Math.random() * 5;
        if (this.state !== 'combat') {
          const NOTES = [220, 261.63, 329.63, 440, 523.25, 392];
          const n = NOTES[(Math.random() * NOTES.length) | 0];
          this.chime(n, ctx.currentTime + 0.05, 0.06, this.padBus);
          if (Math.random() < 0.4) {
            this.chime(n * 1.5 > 500 ? n / 2 : n * 1.5, ctx.currentTime + 0.4 + Math.random() * 0.3, 0.04, this.padBus);
          }
        }
      }
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
    if (this.reverb) g.connect(this.reverb);  // let the bell ring in the hall
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
