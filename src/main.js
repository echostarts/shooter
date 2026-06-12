import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG, defaultMods, PERKS } from './config.js';
import { loadAll } from './assets.js';
import { Level } from './level.js';
import { Player } from './player.js';
import { WeaponSystem } from './weapons.js';
import { EnemyManager } from './enemies.js';
import { ProjectileSystem } from './projectiles.js';
import { ParticleSystem } from './particles.js';
import { AudioSystem } from './audio.js';
import { UI } from './ui.js';

// Final grade: vignette + film grain + teal-shadow / gold-highlight split tone.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: CONFIG.post.vignette },
    uGrain: { value: CONFIG.post.grain },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float luma = dot(col.rgb, vec3(0.299, 0.587, 0.114));
      // teal shadows, gold highlights
      vec3 shadowTint = vec3(0.86, 1.0, 1.06);
      vec3 highTint = vec3(1.06, 1.0, 0.88);
      col.rgb *= mix(shadowTint, highTint, smoothstep(0.12, 0.75, luma));
      // vignette
      float d = distance(vUv, vec2(0.5));
      col.rgb *= 1.0 - uVignette * smoothstep(0.32, 0.78, d);
      // grain (pixel-space so it doesn't alias into streaks)
      col.rgb += (hash(gl_FragCoord.xy + fract(uTime) * 61.7) - 0.5) * uGrain;
      gl_FragColor = col;
    }`,
};

class Game {
  constructor() {
    this.ui = new UI();
    this.audio = new AudioSystem();
    this.playing = false;
    this.paused = false;
    this.started = false;
    this.timeScale = 1;
    this.hitstopTimer = 0;
    this.shakeTime = 0;
    this.shakeMag = 0;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.bestKills = 0;
    this.fovKick = 0;
    this.showFps = false;
    this.fpsAcc = 0;
    this.fpsFrames = 0;

    this.mods = defaultMods();          // per-run perk modifiers
    this.score = 0;
    this.combo = { chain: 0, timer: 0, mult: 1 };
    this.choosingPerk = false;
    this.best = this.loadJSON('gravehold.best') ?? { score: 0, wave: 0, kills: 0 };
    this.settings = this.loadJSON('gravehold.settings') ??
      { sens: 1, sfx: CONFIG.audio.sfxVolume, music: CONFIG.audio.musicVolume };
  }

  loadJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* private mode */ }
  }

  async init() {
    await loadAll((f) => this.ui.setProgress(f));
    this.ui.loadingDone();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = CONFIG.post.exposure;
    document.body.insertBefore(this.renderer.domElement, document.getElementById('ui'));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CONFIG.player.baseFov, window.innerWidth / window.innerHeight, 0.05, 300);
    this.scene.add(this.camera);

    this.level = new Level(this.scene, this.renderer);
    this.particles = new ParticleSystem(this.scene);
    this.player = new Player(this.camera, this.renderer.domElement, this.level);
    this.player.mods = this.mods;
    this.projectiles = new ProjectileSystem(this.scene, this);
    this.weapons = new WeaponSystem(this.camera, this);
    this.weapons.rig.visible = false;   // hidden during the menu orbit
    this.enemies = new EnemyManager(this);

    // post stack
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      CONFIG.post.bloomStrength, CONFIG.post.bloomRadius, CONFIG.post.bloomThreshold);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    this.bindEvents();
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    });

    // restore persisted settings
    this.player.controls.pointerSpeed = this.settings.sens;
    this.ui.sensSlider.value = this.settings.sens;
    this.ui.volSlider.value = this.settings.sfx;
    this.ui.musicSlider.value = this.settings.music;

    this.ui.startScreen.addEventListener('click', async () => {
      if (!this.assetsReady()) return;
      await this.audio.init();
      this.audio.setSfxVolume(this.settings.sfx);
      this.audio.setMusicVolume(this.settings.music);
      this.audio.resume();
      this.startRun();
    });

    this.player.controls.addEventListener('unlock', () => {
      if (this.playing && this.player.alive && !this.restarting && !this.choosingPerk) this.pause();
    });
    this.player.controls.addEventListener('lock', () => {
      this.paused = false;
      this.audio.setPaused(false);
      this.ui.hidePause();
    });

    // button hover ticks
    for (const btn of [this.ui.resumeBtn, this.ui.restartBtn, this.ui.deathRestartBtn]) {
      btn.addEventListener('mouseenter', () => this.audio.play('uiHover', { volume: 0.22 }));
    }

    document.addEventListener('mousedown', (e) => {
      if (!this.playing || this.paused || !this.player.controls.isLocked) return;
      if (e.button === 0) this.weapons.triggerDown();
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.weapons.triggerUp();
    });
    document.addEventListener('mousemove', (e) => {
      if (this.player.controls.isLocked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR') this.weapons.startReload();
      if (e.code === 'Digit1') this.weapons.select('crossbow');
      if (e.code === 'Digit2') this.weapons.select('hex');
      if (e.code === 'KeyF') { this.showFps = !this.showFps; this.ui.setFps(0, this.showFps); }
    });

    this.ui.resumeBtn.addEventListener('click', () => this.resume());
    this.ui.restartBtn.addEventListener('click', () => this.restart());
    this.ui.deathRestartBtn.addEventListener('click', () => this.restart());
    this.ui.sensSlider.addEventListener('input', (e) => {
      this.settings.sens = parseFloat(e.target.value);
      this.player.controls.pointerSpeed = this.settings.sens;
      this.saveJSON('gravehold.settings', this.settings);
    });
    this.ui.volSlider.addEventListener('input', (e) => {
      this.settings.sfx = parseFloat(e.target.value);
      this.audio.setSfxVolume(this.settings.sfx);
      this.saveJSON('gravehold.settings', this.settings);
    });
    this.ui.musicSlider.addEventListener('input', (e) => {
      this.settings.music = parseFloat(e.target.value);
      this.audio.setMusicVolume(this.settings.music);
      this.saveJSON('gravehold.settings', this.settings);
    });
  }

  assetsReady() { return !!this.renderer; }

  startRun() {
    this.started = true;
    this.playing = true;
    this.paused = false;
    this.camera.rotation.set(0, 0, 0);  // leave the menu orbit pose
    this.weapons.rig.visible = true;
    this.ui.startGame();
    this.player.controls.lock();
    this.audio.play('uiClick', { volume: 0.4 });
  }

  pause() {
    this.paused = true;
    this.audio.setPaused(true);
    this.ui.showPause();
  }

  resume() {
    this.audio.play('uiClick', { volume: 0.4 });
    this.audio.setPaused(false);
    this.player.controls.lock();
  }

  restart() {
    this.restarting = true;
    this.audio.play('uiClick', { volume: 0.4 });
    this.audio.setState('calm');
    this.audio.setPaused(false);
    this.mods = defaultMods();
    this.player.mods = this.mods;
    this.score = 0;
    this.combo = { chain: 0, timer: 0, mult: 1 };
    this.choosingPerk = false;
    this.ui.hidePerks();
    this.enemies.reset();
    this.projectiles.reset();
    this.particles.reset();
    this.weapons.reset();
    this.player.reset();
    this.timeScale = 1;
    this.hitstopTimer = 0;
    this.shakeTime = 0;
    this.playing = true;
    this.paused = false;
    this.ui.startGame();
    this.player.controls.lock();
    this.restarting = false;
  }

  // ---- game-feel hooks -------------------------------------------------
  onEnemyKilled(enemy) {
    const S = CONFIG.score;
    this.enemies.kills++;
    this.bestKills = Math.max(this.bestKills, this.enemies.kills);

    // combo chain + score
    this.combo.chain++;
    this.combo.timer = S.comboWindow;
    this.combo.mult = Math.min(S.comboMax, 1 + Math.floor(this.combo.chain / S.killsPerComboStep));
    this.score += (S[enemy.type] ?? 50) * this.combo.mult;

    if (this.mods.lifeOnKill > 0) this.player.heal(this.mods.lifeOnKill);

    const isBoss = enemy.type === 'boss';
    this.hitstopTimer = isBoss ? 0.09 : CONFIG.feel.hitstop;
    this.audio.play('enemyDie', { volume: isBoss ? 0.9 : 0.6, pitch: isBoss ? 0.45 : enemy.type === 'brute' ? 0.6 : 0.9 });
    this.particles.burst(enemy.center, {
      count: isBoss ? 48 : 16, color: 0x6e1212, color2: isBoss ? 0x8b5cf6 : 0x4a443e,
      speed: isBoss ? 6 : 3, life: 0.7, size: isBoss ? 0.13 : 0.09, gravity: 6,
    });
    if (isBoss) {
      this.shake(0.3, 0.05);
      this.audio.play('waveBell', { volume: 0.7, pitch: 0.45, jitter: 0 });
      this.enemies.dropVial(enemy.position, 2.5);
      this.enemies.dropVial(enemy.position, 2.5);
    } else {
      this.enemies.maybeDrop(enemy.position);
    }
  }

  onPlayerDamaged(amount) {
    this.ui.damageFlash(amount / CONFIG.player.hp);
    this.shake(CONFIG.feel.shakeDamage, 0.04 + amount * 0.002);
    this.audio.playOne(['playerHurt1', 'playerHurt2'], { volume: 0.7 });
  }

  onPlayerDeath() {
    this.playing = false;
    this.weapons.triggerUp();
    this.choosingPerk = false;
    this.ui.hidePerks();
    this.audio.setState('death');
    this.audio.play('deathBell', { volume: 0.9, pitch: 0.55, jitter: 0 });
    this.player.controls.unlock();
    this.best = {
      score: Math.max(this.best.score, this.score),
      wave: Math.max(this.best.wave, this.enemies.wave),
      kills: Math.max(this.best.kills, this.enemies.kills),
    };
    this.saveJSON('gravehold.best', this.best);
    this.ui.showDeath(this.enemies.wave, this.enemies.kills, this.score, this.best);
  }

  onHexExplosion(pos) {
    const R = CONFIG.hex.aoeRadius * (this.mods?.aoeRadius ?? 1);
    for (const e of this.enemies.list) {
      if (!e.alive) continue;
      const d = e.center.distanceTo(pos);
      if (d < R + e.radius) {
        const falloff = 1 - Math.max(0, d - 0.6) / (R + e.radius);
        e.damage(CONFIG.hex.damage * Math.max(0.25, falloff));
      }
    }
    this.audio.play('hexExplodeGlass', { volume: 0.8, pitch: 0.7 });
    this.audio.play('hexExplodeThump', { volume: 0.9, pitch: 0.5 });
    this.particles.burst(pos, {
      count: 34, color: CONFIG.colors.violet, color2: 0xd0b8ff,
      speed: 6, life: 0.65, size: 0.12, gravity: 4, up: 0.7,
    });
    const d = this.camera.position.distanceTo(pos);
    if (d < 14) this.shake(CONFIG.feel.shakeAoE, 0.05 * (1 - d / 14) + 0.015);
  }

  openPerkChoice() {
    this.choosingPerk = true;
    this.weapons.triggerUp();
    const pool = [...PERKS];
    const picks = [];
    for (let i = 0; i < 3 && pool.length; i++) {
      picks.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
    }
    this.ui.showPerks(picks, (perk) => this.onPerkPicked(perk));
    this.player.controls.unlock();
  }

  onPerkPicked(perk) {
    perk.apply(this.mods, this);
    this.audio.play('uiClick', { volume: 0.5 });
    this.ui.hidePerks();
    this.choosingPerk = false;
    this.enemies.state = 'intermission';
    this.enemies.interTimer = 3;
    this.player.controls.lock();
  }

  shake(time, mag) {
    this.shakeTime = Math.max(this.shakeTime, time);
    this.shakeMag = Math.max(this.shakeMag, mag);
  }

  // ---- main loop --------------------------------------------------------
  frame() {
    const rawDt = Math.min(this.clock.getDelta(), 0.05);

    // hitstop: dip the timescale, recover quickly
    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= rawDt;
      this.timeScale = CONFIG.feel.hitstopScale;
    } else {
      this.timeScale = THREE.MathUtils.lerp(this.timeScale, 1, 1 - Math.exp(-18 * rawDt));
    }
    const dt = rawDt * (this.paused ? 0 : this.timeScale);
    const time = performance.now() / 1000;

    if (this.started && !this.paused && !this.choosingPerk) {
      if (this.player.alive) this.player.update(dt);
      this.weapons.update(dt, this.mouseDX, this.mouseDY);
      this.enemies.update(dt);
      this.projectiles.update(dt);
      this.level.update(dt, time, this.particles);
      this.particles.update(dt);
      this.ui.updateHud(this);

      // combo decay
      if (this.combo.timer > 0) {
        this.combo.timer -= dt;
        if (this.combo.timer <= 0) { this.combo.chain = 0; this.combo.mult = 1; }
      }

      // music state follows the fight
      const live = this.enemies.liveCount();
      this.audio.setState(!this.player.alive ? 'death' : live > 0 ? 'combat' : 'calm');
      this.audio.setIntensity(0.3 + this.enemies.wave * 0.055 + live * 0.018);

      // footsteps keyed to the bob cycle
      const stepPhase = Math.floor(this.player.bobPhase / Math.PI);
      if (stepPhase !== this._lastStep && this.player.onGround && this.player.speed2D > 1.5) {
        this.audio.playOne(['footstep0', 'footstep1', 'footstep2', 'footstep3'],
          { volume: this.player.sprinting ? 0.32 : 0.22, pitch: 0.92 });
      }
      this._lastStep = stepPhase;

      // camera shake + idle breathing
      if (this.shakeTime > 0) {
        this.shakeTime -= rawDt;
        const f = this.shakeMag * Math.min(1, this.shakeTime * 10);
        this.camera.position.x += (Math.random() - 0.5) * f * 2;
        this.camera.position.y += (Math.random() - 0.5) * f * 2;
        this.camera.position.z += (Math.random() - 0.5) * f * 2;
        if (this.shakeTime <= 0) this.shakeMag = 0;
      }
      this.camera.position.y += Math.sin(time * 1.4) * 0.006;

      // sprint FOV
      const targetFov = CONFIG.player.baseFov + (this.player.sprinting ? CONFIG.player.sprintFovAdd : 0);
      if (Math.abs(this.camera.fov - targetFov) > 0.01) {
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-8 * rawDt));
        this.camera.updateProjectionMatrix();
      }
    } else if (this.choosingPerk) {
      // world stays alive behind the litany cards
      this.level.update(rawDt, time, this.particles);
      this.particles.update(rawDt);
    } else if (!this.started) {
      // cinematic orbit around the arena behind the start screen
      const a = time * 0.045;
      this.camera.position.set(Math.cos(a) * 17, 6.2 + Math.sin(time * 0.3) * 0.4, Math.sin(a) * 17);
      this.camera.lookAt(0, 1.2, 0);
      this.level.update(rawDt, time, this.particles);
      this.particles.update(rawDt);
    }
    // keep the score and ambience ticking even on pause/death screens
    this.audio.update(rawDt, this.player ? this.player.hp / this.player.maxHp : 1);
    this.mouseDX = 0;
    this.mouseDY = 0;

    this.grade.uniforms.uTime.value = time;
    this.composer.render();

    if (this.showFps) {
      this.fpsAcc += rawDt;
      this.fpsFrames++;
      if (this.fpsAcc >= 0.5) {
        this.ui.setFps(Math.round(this.fpsFrames / this.fpsAcc), true);
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }
    }
  }
}

const game = new Game();
window.__GRAVEHOLD = game; // debug / automated-verification hook
game.init().catch((err) => {
  console.error('[GRAVEHOLD] failed to start:', err);
  document.querySelector('.loading-text')?.replaceChildren(
    document.createTextNode('The crypt would not open. See console.'));
});
