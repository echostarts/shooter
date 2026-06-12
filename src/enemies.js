import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { CONFIG } from './config.js';
import { ASSETS } from './assets.js';
import { rayBox } from './projectiles.js';

const VIOLET = new THREE.Color(CONFIG.colors.violet);
const CYAN = new THREE.Color(CONFIG.colors.cyan);
const loggedMappings = new Set();

// Map animation clips by case-insensitive regex — clip names vary per model.
function mapClips(animations, modelKey, wantsRun) {
  const find = (re) => animations.filter((a) => re.test(a.name));
  const moves = find(/walk|run/i);
  const map = {
    idle: find(/idle/i)[0] ?? animations[0],
    move: (wantsRun ? moves.find((a) => /run/i.test(a.name)) : moves.find((a) => /walk/i.test(a.name))) ?? moves[0] ?? animations[0],
    attack: find(/attack|punch|bite/i)[0] ?? animations[0],
    death: find(/death|die/i)[0] ?? animations[0],
  };
  if (!loggedMappings.has(modelKey)) {
    loggedMappings.add(modelKey);
    console.info(`[GRAVEHOLD] ${modelKey} clips:`, Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v?.name])));
  }
  return map;
}

// Inject a noise-threshold dissolve with violet edge glow into a standard material.
function makeDissolvable(material) {
  const uDissolve = { value: 0 };
  material.userData.uDissolve = uDissolve;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = uDissolve;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGhWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGhWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGhWorld;
        uniform float uDissolve;
        float ghHash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float ghNoise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(ghHash(i), ghHash(i + vec3(1,0,0)), f.x), mix(ghHash(i + vec3(0,1,0)), ghHash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(ghHash(i + vec3(0,0,1)), ghHash(i + vec3(1,0,1)), f.x), mix(ghHash(i + vec3(0,1,1)), ghHash(i + vec3(1,1,1)), f.x), f.y),
            f.z);
        }`)
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
        float ghN = ghNoise(vGhWorld * 7.0);
        if (ghN < uDissolve) discard;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float ghEdge = 1.0 - smoothstep(uDissolve, uDissolve + 0.12, ghN);
        totalEmissiveRadiance += vec3(0.545, 0.36, 0.965) * ghEdge * step(0.001, uDissolve) * 2.5;`);
  };
  material.customProgramCacheKey = () => 'gh-dissolve';
  return material;
}

let nextId = 1;

class Enemy {
  constructor(type, modelKey, game) {
    this.id = nextId++;
    this.type = type;                       // 'grunt' | 'caster' | 'brute'
    this.cfg = CONFIG.enemies[type];
    this.game = game;
    this.hp = this.cfg.hp;
    this.maxHp = this.cfg.hp;
    this.alive = true;
    this.state = 'spawn';
    this.position = new THREE.Vector3();
    this.yaw = 0;
    this.attackCooldown = 0.6 + Math.random() * 0.6;
    this.attackTimer = 0;
    this.didHit = false;
    this.flashTimer = 0;
    this.dissolve = -1;                     // <0 = not dissolving
    this.deathTimer = 0;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.growlTimer = 2 + Math.random() * 6;

    const gltf = ASSETS.models[modelKey];
    this.root = skeletonClone(gltf.scene);
    this.root.scale.setScalar(this.cfg.scale);
    this.materials = [];
    this.root.traverse((c) => {
      if (c.isMesh || c.isSkinnedMesh) {
        c.castShadow = true;
        c.frustumCulled = false;
        c.material = makeDissolvable(c.material.clone());
        this.materials.push(c.material);
        // faint corruption glow — strongest on the brute, subtle elsewhere
        c.material.emissive = VIOLET.clone();
        c.material.emissiveIntensity =
          type === 'boss' ? 0.085 : type === 'brute' ? 0.045 : type === 'caster' ? 0.03 : 0.02;
      }
    });
    game.scene.add(this.root);

    this.mixer = new THREE.AnimationMixer(this.root);
    this.clips = mapClips(gltf.animations, modelKey, this.cfg.speed > 3);
    this.actions = {};
    for (const [k, clip] of Object.entries(this.clips)) {
      if (clip) this.actions[k] = this.mixer.clipAction(clip);
    }
    this.actions.attack.setLoop(THREE.LoopOnce);
    this.actions.attack.clampWhenFinished = true;
    this.actions.death.setLoop(THREE.LoopOnce);
    this.actions.death.clampWhenFinished = true;
    this.currentAction = null;
    this.playAction('idle');

    // body extents for hit detection (computed once, in local space)
    const box = new THREE.Box3().setFromObject(this.root);
    this.height = Math.max(0.9, box.max.y - box.min.y);
    this.radius = Math.max(0.3, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.30);
    this.upperY = this.height * 0.55;       // upper-body crit zone starts here
    this.center = new THREE.Vector3();
  }

  playAction(name, fade = CONFIG.enemies.crossfade) {
    const next = this.actions[name];
    if (!next || this.currentAction === next) return;
    next.reset();
    next.play();
    if (this.currentAction) next.crossFadeFrom(this.currentAction, fade, false);
    this.currentAction = next;
  }

  damage(amount, dir) {
    if (!this.alive) return;
    this.hp -= amount;
    this.flashTimer = CONFIG.feel.enemyFlashTime;
    for (const m of this.materials) {
      m.emissive.setRGB(1, 1, 1);
      m.emissiveIntensity = 0.9;
    }
    if (this.hp <= 0) this.die();
    else this.game.audio.play('enemyHit', { volume: 0.4 });
  }

  die() {
    this.alive = false;
    this.state = 'death';
    this.deathTimer = 0;
    this.playAction('death', 0.12);
    this.game.onEnemyKilled(this);
  }

  update(dt) {
    const game = this.game;
    const player = game.player;
    this.mixer.update(dt);

    // damage flash decay
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        const glow = this.type === 'boss' ? 0.085 : this.type === 'brute' ? 0.045 : this.type === 'caster' ? 0.03 : 0.02;
        for (const m of this.materials) {
          m.emissive.copy(VIOLET);
          m.emissiveIntensity = glow;
        }
      }
    }

    if (this.state === 'death') {
      this.deathTimer += dt;
      const clipDur = Math.min(this.clips.death?.duration ?? 1, 1.4);
      if (this.deathTimer > clipDur * 0.85 && this.dissolve < 0) this.dissolve = 0;
      if (this.dissolve >= 0) {
        this.dissolve += dt / CONFIG.enemies.dissolveTime;
        for (const m of this.materials) m.userData.uDissolve.value = Math.min(1, this.dissolve);
        if (this.dissolve >= 1) this.disposeSelf();
      }
      return;
    }

    if (!player.alive) { this.playAction('idle'); this.syncTransform(dt); return; }

    const toPlayer = new THREE.Vector3(player.position.x - this.position.x, 0, player.position.z - this.position.z);
    const dist = toPlayer.length();
    toPlayer.normalize();

    this.growlTimer -= dt;
    if (this.growlTimer <= 0 && dist < 16) {
      this.growlTimer = 4 + Math.random() * 8;
      this.game.audio.playOne(['growl1', 'growl2', 'growl3'], { volume: 0.3, pitch: this.type === 'brute' ? 0.4 : 0.6 });
    }

    this.attackCooldown -= dt;

    if (this.state === 'attack') {
      this.attackTimer += dt;
      const clip = this.clips.attack;
      const dur = clip ? clip.duration : 0.8;
      // damage lands on a hit-window mid-clip, not on touch
      if (!this.didHit && this.attackTimer > dur * 0.45) {
        this.didHit = true;
        if (this.type === 'caster') {
          this.castBolt(player);
        } else if (dist < this.cfg.attackRange + 0.5) {
          player.damage(this.cfg.damage, game);
          if (this.cfg.knockback) player.knockback(toPlayer, this.cfg.knockback);
        } else if (this.type === 'boss') {
          // slam misses: still thud
          game.shake(0.12, 0.03);
        }
      }
      if (this.attackTimer >= dur * 0.95) {
        this.state = 'chase';
        this.attackCooldown = this.cfg.attackCooldown;
      }
      this.faceToward(toPlayer, dt * 6);
      this.syncTransform(dt);
      return;
    }

    // movement intent
    let moveDir = new THREE.Vector3();
    let wantAttack = false;

    if (this.type === 'caster') {
      const { keepMin, keepMax } = this.cfg;
      if (dist > keepMax) moveDir.copy(toPlayer);
      else if (dist < keepMin) moveDir.copy(toPlayer).negate();
      else {
        // strafe around the player
        moveDir.set(-toPlayer.z * this.strafeDir, 0, toPlayer.x * this.strafeDir);
        if (Math.random() < dt * 0.25) this.strafeDir *= -1;
      }
      wantAttack = dist <= this.cfg.attackRange && this.attackCooldown <= 0 && this.hasLineOfSight(player);
    } else {
      moveDir.copy(toPlayer);
      wantAttack = dist <= this.cfg.attackRange && this.attackCooldown <= 0;
    }

    if (wantAttack) {
      this.state = 'attack';
      this.attackTimer = 0;
      this.didHit = false;
      this.playAction('attack', 0.12);
      this.syncTransform(dt);
      return;
    }

    // whisker avoidance + separation
    moveDir = this.steer(moveDir);
    for (const other of this.game.enemies.list) {
      if (other === this || !other.alive) continue;
      const dx = this.position.x - other.position.x;
      const dz = this.position.z - other.position.z;
      const d2 = dx * dx + dz * dz;
      const minD = CONFIG.enemies.separationRadius * (this.type === 'brute' || other.type === 'brute' ? 1.5 : 1);
      if (d2 < minD * minD && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const f = CONFIG.enemies.separationForce * (1 - d / minD);
        moveDir.x += (dx / d) * f * 0.2;
        moveDir.z += (dz / d) * f * 0.2;
      }
    }

    if (moveDir.lengthSq() > 0.001) {
      moveDir.normalize();
      const stopAt = this.type === 'caster' ? 0 : this.cfg.attackRange * 0.7;
      if (dist > stopAt) {
        this.position.addScaledVector(moveDir, this.cfg.speed * dt);
        this.faceToward(moveDir, dt * 7);
        this.playAction('move');
        this.state = 'chase';
      } else {
        this.playAction('idle');
      }
    } else {
      this.playAction('idle');
    }

    this.resolveCollisions();
    this.syncTransform(dt);
  }

  // 3 whisker segment tests against level AABBs — steer around props
  steer(dir) {
    const L = CONFIG.enemies.whiskerLength;
    const test = (d) => {
      const end = this.position.clone().addScaledVector(d, L);
      end.y = 1;
      const o = this.position.clone(); o.y = 1;
      const seg = end.sub(o);
      const len = seg.length();
      const nd = seg.normalize();
      for (const b of this.game.level.colliders) {
        const t = rayBox(o, nd, b);
        if (t !== null && t < len) return true;
      }
      return false;
    };
    if (!test(dir)) return dir;
    const left = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.7);
    const right = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.7);
    const lBlocked = test(left);
    const rBlocked = test(right);
    if (!lBlocked && rBlocked) return left;
    if (!rBlocked && lBlocked) return right;
    if (!lBlocked && !rBlocked) return Math.random() < 0.5 ? left : right;
    return dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  }

  // keep enemies out of props/walls (2D circle vs AABB push-out)
  resolveCollisions() {
    const r = this.radius;
    for (const b of this.game.level.colliders) {
      if (this.position.y > b.max.y) continue;
      const cx = Math.max(b.min.x, Math.min(this.position.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(this.position.z, b.max.z));
      const dx = this.position.x - cx;
      const dz = this.position.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 < 1e-8) { this.position.x += r; continue; }
        const d = Math.sqrt(d2);
        this.position.x += (dx / d) * (r - d);
        this.position.z += (dz / d) * (r - d);
      }
    }
    const lim = CONFIG.arena.size / 2 - 0.8;
    this.position.x = Math.max(-lim, Math.min(lim, this.position.x));
    this.position.z = Math.max(-lim, Math.min(lim, this.position.z));
  }

  hasLineOfSight(player) {
    const o = this.position.clone(); o.y = this.upperY;
    const target = new THREE.Vector3(player.position.x, player.eye - 0.2, player.position.z);
    const d = target.sub(o);
    const len = d.length();
    d.normalize();
    for (const b of this.game.level.colliders) {
      const t = rayBox(o, d, b);
      if (t !== null && t < len) return false;
    }
    return true;
  }

  castBolt(player) {
    const origin = this.position.clone();
    origin.y = this.upperY + 0.2;
    // lead slightly toward where the player is heading — still dodgeable
    const target = new THREE.Vector3(player.position.x, player.position.y + 1.2, player.position.z)
      .addScaledVector(player.velocity, 0.25);
    const dir = target.sub(origin).normalize();
    this.game.projectiles.fireBolt(origin, dir);
    this.game.audio.play('casterBolt', { volume: 0.5, pitch: 0.7 });
    this.game.particles.burst(origin, { count: 8, color: CONFIG.colors.violet, speed: 1.5, life: 0.4, size: 0.07, gravity: 0 });
  }

  faceToward(dir, amount) {
    const target = Math.atan2(dir.x, dir.z);
    let d = target - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, amount);
  }

  syncTransform() {
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
    this.center.set(this.position.x, this.position.y + this.height * 0.5, this.position.z);
  }

  // ray vs this enemy's two hit boxes. Returns { t, upper } or null.
  raycastHit(origin, dir, maxT) {
    if (!this.alive) return null;
    const r = this.radius;
    const p = this.position;
    const lower = _box.set(
      _v1.set(p.x - r, p.y, p.z - r),
      _v2.set(p.x + r, p.y + this.upperY, p.z + r));
    const upper = _box2.set(
      _v3.set(p.x - r * 0.8, p.y + this.upperY, p.z - r * 0.8),
      _v4.set(p.x + r * 0.8, p.y + this.height, p.z + r * 0.8));
    const tU = rayBox(origin, dir, upper);
    const tL = rayBox(origin, dir, lower);
    let best = null;
    if (tU !== null && tU < maxT) best = { t: tU, upper: true };
    if (tL !== null && tL < maxT && (!best || tL < best.t)) best = { t: tL, upper: false };
    return best;
  }

  disposeSelf() {
    this.game.scene.remove(this.root);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.root.traverse((c) => {
      if (c.isSkinnedMesh) c.skeleton?.dispose?.();
      if (c.isMesh || c.isSkinnedMesh) c.material.dispose();
    });
    this.materials.length = 0;
    this.disposed = true;
  }
}

const _box = new THREE.Box3();
const _box2 = new THREE.Box3();
const _v1 = new THREE.Vector3(); const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3(); const _v4 = new THREE.Vector3();

const TYPE_MODEL = { grunt: 'grunt', caster: 'caster', brute: 'brute', boss: 'brute' };

// Wave spawning, enemy bookkeeping, pickups.
export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.pickups = [];
    this.wave = 0;
    this.kills = 0;
    this.dropless = 0;
    this.state = 'intermission';   // 'intermission' | 'active'
    this.interTimer = 2.5;         // first wave comes quickly
    this.spawnQueue = [];
    this.batchTimer = 0;

    const geo = new THREE.IcosahedronGeometry(0.16, 0);
    const mat = new THREE.MeshBasicMaterial({ color: CYAN.clone().multiplyScalar(1.9) });
    this.pickupGeo = geo;
    this.pickupMat = mat;
  }

  buildWave(n) {
    const W = CONFIG.waves;
    if (n % W.bossEvery === 0) {
      const queue = ['boss'];
      const escort = Math.min(10, 2 + n);
      for (let i = 0; i < escort; i++) queue.push(i % 3 === 2 ? 'caster' : 'grunt');
      return queue;
    }
    const total = W.baseCount + W.perWave * n;
    const casterFrac = Math.min(W.casterFracMax, W.casterFracBase + W.casterFracPerWave * n);
    const bruteFrac = n >= W.bruteFromWave ? W.bruteFrac : 0;
    const nBrute = Math.round(total * bruteFrac);
    const nCaster = Math.round(total * casterFrac);
    const queue = [];
    for (let i = 0; i < nBrute; i++) queue.push('brute');
    for (let i = 0; i < nCaster; i++) queue.push('caster');
    while (queue.length < total) queue.push('grunt');
    // shuffle
    for (let i = queue.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    return queue;
  }

  spawnOne(type) {
    const gates = this.game.level.gates;
    const gate = gates[(Math.random() * gates.length) | 0];
    const e = new Enemy(type, TYPE_MODEL[type], this.game);
    e.position.copy(gate.position);
    e.position.x += (Math.random() - 0.5) * 1.6;
    e.position.z += (Math.random() - 0.5) * 1.6;
    e.yaw = Math.atan2(gate.forward.x, gate.forward.z);
    e.syncTransform();
    this.list.push(e);
    this.game.particles.burst(e.center, {
      count: 22, color: CONFIG.colors.violet, color2: 0x3b2a68,
      speed: 2.5, life: 0.7, size: 0.1, gravity: 0.5, up: 0.9,
    });
    this.game.audio.playOne(['growl1', 'growl2', 'growl3'],
      { volume: type === 'boss' ? 0.7 : 0.4, pitch: type === 'boss' ? 0.26 : type === 'brute' ? 0.38 : 0.62 });
  }

  liveCount() { return this.list.filter((e) => e.alive).length; }

  update(dt) {
    const game = this.game;

    if (this.state === 'intermission') {
      this.interTimer -= dt;
      if (this.interTimer <= 0) {
        this.wave++;
        this.spawnQueue = this.buildWave(this.wave);
        this.state = 'active';
        this.batchTimer = 0;
        const isBoss = this.wave % CONFIG.waves.bossEvery === 0;
        game.ui.showWave(this.wave, isBoss);
        game.audio.play('waveBell', { volume: 0.8, pitch: isBoss ? 0.5 : 0.7, jitter: 0.02 });
      }
    } else {
      if (this.spawnQueue.length > 0) {
        this.batchTimer -= dt;
        if (this.batchTimer <= 0 && this.liveCount() < CONFIG.enemies.maxLive) {
          this.batchTimer = CONFIG.waves.batchInterval;
          const n = Math.min(CONFIG.waves.batchSize, this.spawnQueue.length,
            CONFIG.enemies.maxLive - this.liveCount());
          for (let i = 0; i < n; i++) this.spawnOne(this.spawnQueue.pop());
        }
      } else if (this.list.every((e) => !e.alive)) {
        if (game.player.alive) {
          this.state = 'perk';
          game.ui.showWaveCleared(this.wave);
          game.openPerkChoice();
        } else {
          this.state = 'intermission';
          this.interTimer = CONFIG.waves.interTime;
        }
      }
    }

    for (const e of this.list) if (!e.disposed) e.update(dt);
    this.list = this.list.filter((e) => !e.disposed);

    // pickups: bob, spin, collect
    const player = game.player;
    for (const p of this.pickups) {
      p.age += dt;
      p.mesh.rotation.y += dt * 2.2;
      p.mesh.position.y = 0.55 + Math.sin(p.age * 2.6) * 0.12;
      if (player.alive && p.mesh.position.distanceToSquared(
        _v1.set(player.position.x, 0.55, player.position.z)) < 1.3) {
        player.heal(CONFIG.player.healAmount + (game.mods?.vialBonus ?? 0));
        game.audio.play('pickupVial', { volume: 0.8, pitch: 1.2 });
        game.ui.healFlash();
        game.particles.burst(p.mesh.position, { count: 14, color: CONFIG.colors.cyan, speed: 2.2, life: 0.5, size: 0.07, gravity: -1 });
        game.scene.remove(p.mesh);
        p.dead = true;
      }
    }
    this.pickups = this.pickups.filter((p) => !p.dead);
  }

  // chance-based cyan vial drop with pity counter
  maybeDrop(pos) {
    this.dropless++;
    if (Math.random() > CONFIG.enemies.dropChance && this.dropless < CONFIG.enemies.dropPity) return;
    this.dropless = 0;
    this.dropVial(pos);
  }

  dropVial(pos, jitter = 0) {
    const mesh = new THREE.Mesh(this.pickupGeo, this.pickupMat);
    mesh.position.set(pos.x + (Math.random() - 0.5) * jitter, 0.55, pos.z + (Math.random() - 0.5) * jitter);
    this.game.scene.add(mesh);
    this.pickups.push({ mesh, age: Math.random() * 4, dead: false });
  }

  // the live boss, if any (for the HUD bar)
  boss() {
    return this.list.find((e) => e.type === 'boss' && e.alive) ?? null;
  }

  // nearest enemy hit along a hitscan ray
  raycast(origin, dir, maxT) {
    let best = null;
    for (const e of this.list) {
      const hit = e.raycastHit(origin, dir, maxT);
      if (hit && (!best || hit.t < best.t)) best = { ...hit, enemy: e };
    }
    return best;
  }

  reset() {
    for (const e of this.list) if (!e.disposed) e.disposeSelf();
    this.list = [];
    for (const p of this.pickups) this.game.scene.remove(p.mesh);
    this.pickups = [];
    this.wave = 0;
    this.kills = 0;
    this.dropless = 0;
    this.state = 'intermission';
    this.interTimer = 2.5;
    this.spawnQueue = [];
  }
}
