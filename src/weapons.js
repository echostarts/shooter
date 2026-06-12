import * as THREE from 'three';
import { CONFIG } from './config.js';
import { ASSETS } from './assets.js';
import { castObstacles } from './projectiles.js';

const GOLD = new THREE.Color(CONFIG.colors.gold);
const _UP = new THREE.Vector3(0, 1, 0);
const _ZERO_EULER = new THREE.Euler();
const _v = new THREE.Vector3(); const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3(); const _v4 = new THREE.Vector3();

// Soft radial glow with cross streaks for the muzzle flash / bolt glow.
function makeFlashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const rad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rad.addColorStop(0, 'rgba(255,244,210,1)');
  rad.addColorStop(0.22, 'rgba(255,205,100,0.85)');
  rad.addColorStop(0.55, 'rgba(235,150,45,0.25)');
  rad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  g.translate(64, 64);
  for (let i = 0; i < 2; i++) {
    g.rotate(Math.PI / 2 * i);
    const streak = g.createLinearGradient(-64, 0, 64, 0);
    streak.addColorStop(0, 'rgba(255,200,90,0)');
    streak.addColorStop(0.5, 'rgba(255,230,170,0.7)');
    streak.addColorStop(1, 'rgba(255,200,90,0)');
    g.fillStyle = streak;
    g.fillRect(-64, -3, 128, 6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Viewmodel rig + two weapons. All motion is procedural: sway, bob,
// sprint tilt, recoil, reload dip, camera lag, switch raise/lower.
export class WeaponSystem {
  constructor(camera, game) {
    this.camera = camera;
    this.game = game;

    this.rig = new THREE.Group();        // lags behind camera rotation
    camera.add(this.rig);

    // small fill light so the viewmodel reads at night
    const fill = new THREE.PointLight(0xc8d2e8, 1.6, 1.7, 2);
    fill.position.set(0.25, 0.05, -0.25);
    camera.add(fill);

    this.crossbow = this.buildCrossbow();
    this.hex = this.buildHexLauncher();
    this.rig.add(this.crossbow.root, this.hex.root);

    this.current = this.crossbow;
    this.hex.root.visible = false;

    // state
    this.ammo = CONFIG.crossbow.magSize;
    this.charges = CONFIG.hex.charges;
    this.rechargeTimer = 0;
    this.cooldown = 0;
    this.reloading = 0;        // remaining reload time
    this.switchAnim = 1;       // 0..1 raise progress (1 = fully raised)
    this.recoil = 0;
    this.swayX = 0; this.swayY = 0;
    this.lagQuat = new THREE.Quaternion();
    this.firing = false;
    this.aiming = false;
    this.aimBlend = 0;

    this.flashTex = makeFlashTexture();

    // flying bolt pool: a real projectile you can see, with a spark trail
    this.flyBolts = [];
    const fbShaft = new THREE.CylinderGeometry(0.012, 0.012, 0.46, 6);
    fbShaft.rotateX(Math.PI / 2);
    const fbHead = new THREE.ConeGeometry(0.022, 0.075, 8);
    fbHead.rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const group = new THREE.Group();
      const shaft = new THREE.Mesh(fbShaft, new THREE.MeshBasicMaterial({ color: 0x6b4a26 }));
      const head = new THREE.Mesh(fbHead, new THREE.MeshBasicMaterial({ color: GOLD.clone().multiplyScalar(2.2) }));
      head.position.z = -0.26;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.flashTex, color: GOLD.clone().multiplyScalar(1.6),
        transparent: true, opacity: 0.85, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      glow.scale.setScalar(0.22);
      glow.position.z = -0.22;
      group.add(shaft, head, glow);
      group.visible = false;
      game.scene.add(group);
      this.flyBolts.push({ group, dir: new THREE.Vector3(), remaining: 0, active: false, impact: null, end: new THREE.Vector3() });
    }

    // muzzle flash
    this.flashTime = 0;
    const flashMat = new THREE.SpriteMaterial({
      map: this.flashTex,
      color: 0xfff2cc,
      transparent: true, opacity: 0, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.flash = new THREE.Sprite(flashMat);
    this.flash.scale.setScalar(0.5);
    this.flash.renderOrder = 999;
    this.flashLight = new THREE.PointLight(GOLD, 0, 9, 2);
    this.crossbow.muzzle.add(this.flash, this.flashLight);

    this._wheel = () => {
      if (!this.game.playing) return;
      this.select(this.other());
    };
    document.addEventListener('wheel', this._wheel);
  }

  buildCrossbow() {
    const root = new THREE.Group();
    root.position.set(0.31, -0.27, -0.46);
    const baseRot = new THREE.Euler(0.015, -0.11, 0.02); // 3/4 hero pose

    const wood = new THREE.MeshStandardMaterial({ color: 0x3b2b1d, roughness: 0.8, metalness: 0.04 });
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x261a10, roughness: 0.85, metalness: 0.04 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3f444d, roughness: 0.38, metalness: 0.92 });
    const gold = new THREE.MeshStandardMaterial({
      color: 0xb08a3e, roughness: 0.32, metalness: 1,
      emissive: GOLD, emissiveIntensity: 0.16,
    });

    // stock: tapered two-part body + raised cheek piece
    const butt = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.078, 0.2), wood);
    butt.position.set(0, -0.006, 0.15);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.064, 0.34), wood);
    body.position.set(0, 0, -0.12);
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.022, 0.18), woodDark);
    cheek.position.set(0, 0.05, 0.14);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.15, 0.058), woodDark);
    grip.position.set(0, -0.1, 0.19);
    grip.rotation.x = 0.5;
    root.add(butt, body, cheek, grip);

    // steel bolt groove on top
    const railTop = 0.04;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.01, 0.48), steel);
    rail.position.set(0, railTop, -0.12);
    root.add(rail);

    // lock block with gold side inlays
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.042, 0.07), steel);
    lock.position.set(0, 0.043, -0.01);
    const inlay = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.074, 14), gold);
    inlay.rotation.z = Math.PI / 2;
    inlay.position.copy(lock.position);
    root.add(lock, inlay);

    // recurve lath: tube along a parabolic curve, flat in the XZ plane
    const lathZ = -0.32;
    const half = 0.215;
    const depth = 0.075;
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const x = -half + (i / 8) * half * 2;
      pts.push(new THREE.Vector3(x, 0, -depth * (1 - (x / half) ** 2)));
    }
    const lath = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.0095, 8), steel);
    const lathG = new THREE.Group();
    lathG.position.set(0, 0.035, lathZ);
    lathG.add(lath);
    // gold tip caps
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.045, 10), gold);
      cap.position.set(sx * half, 0, 0.012);
      cap.rotation.z = sx * 1.25;
      lathG.add(cap);
    }
    root.add(lathG);

    // string: two segments from the lath tips to the moving nut
    const stringMat = new THREE.MeshBasicMaterial({ color: 0xcabb96 });
    const stringGeo = new THREE.CylinderGeometry(0.0032, 0.0032, 1, 5);
    const stringL = new THREE.Mesh(stringGeo, stringMat);
    const stringR = new THREE.Mesh(stringGeo, stringMat);
    root.add(stringL, stringR);

    // loaded bolt: dark shaft, gold head, twin fletches
    const bolt = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.3, 7), woodDark);
    shaft.rotation.x = Math.PI / 2;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.0085, 0.04, 8), gold);
    head.rotation.x = -Math.PI / 2;
    head.position.z = -0.17;
    const fletchMat = new THREE.MeshStandardMaterial({
      color: 0xc8a050, roughness: 0.7, side: THREE.DoubleSide,
      emissive: GOLD, emissiveIntensity: 0.04,
    });
    for (const r of [0, Math.PI / 2]) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.014, 0.05), fletchMat);
      f.position.z = 0.125;
      f.rotation.set(0, 0, r);
      f.rotateX(0.12);
      bolt.add(f);
    }
    bolt.add(shaft, head);
    bolt.position.set(0, railTop + 0.012, -0.2);
    root.add(bolt);

    // foot stirrup at the nose + trigger guard
    const stirrup = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, 8, 18, Math.PI), gold);
    stirrup.position.set(0, 0.012, -0.41);
    stirrup.rotation.z = Math.PI;
    root.add(stirrup);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.0038, 8, 16, Math.PI), steel);
    guard.position.set(0, -0.034, 0.085);
    guard.rotation.set(0, Math.PI / 2, Math.PI);
    root.add(guard);
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.026, 0.011), steel);
    trigger.position.set(0, -0.04, 0.08);
    trigger.rotation.x = 0.25;
    root.add(trigger);

    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, railTop + 0.012, -0.42);
    root.add(muzzle);

    const w = {
      root, muzzle, name: 'crossbow', basePos: root.position.clone(), baseRot,
      bolt, stringL, stringR,
      stringY: 0.035, lathZ, lathHalf: half,
      nutZ: -0.03, nutTarget: -0.03,    // string position: cocked at the lock
      recock: 0,                         // time until the string is re-drawn
    };
    this.updateString(w);
    return w;
  }

  // place the two string segments between the lath tips and the nut
  updateString(w) {
    const tipY = w.stringY;
    const nut = _v.set(0, tipY, w.nutZ);
    for (const [mesh, sx] of [[w.stringL, -1], [w.stringR, 1]]) {
      const tip = _v2.set(sx * w.lathHalf, tipY, w.lathZ + 0.012);
      const mid = _v3.copy(tip).add(nut).multiplyScalar(0.5);
      const dir = _v4.copy(nut).sub(tip);
      const len = dir.length();
      mesh.position.copy(mid);
      mesh.quaternion.setFromUnitVectors(_UP, dir.normalize());
      mesh.scale.set(1, len, 1);
    }
  }

  buildHexLauncher() {
    const root = new THREE.Group();
    root.position.set(0.34, -0.3, -0.52);

    const potion = ASSETS.models.potion.scene.clone(true);
    potion.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = false;
        // re-tint the flask toward corruption violet
        c.material = c.material.clone();
        c.material.color.set(0xb08cf0);
        c.material.emissive = new THREE.Color(CONFIG.colors.violet);
        c.material.emissiveIntensity = 0.12;
      }
    });
    potion.scale.setScalar(2.8);
    potion.rotation.y = Math.PI * 0.15;
    potion.position.set(0, -0.06, 0);  // model pivot is at the flask base
    root.add(potion);

    // violet orb hovering above the flask
    const orbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(CONFIG.colors.violet).multiplyScalar(1.8) });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), orbMat);
    orb.position.set(0, 0.42, 0);
    root.add(orb);
    const orbLight = new THREE.PointLight(CONFIG.colors.violet, 1.5, 2.5, 2);
    orb.add(orbLight);

    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.44, -0.15);
    root.add(muzzle);

    return {
      root, muzzle, orb, name: 'hex',
      basePos: root.position.clone(),
      baseRot: new THREE.Euler(0.04, 0.18, -0.06),
    };
  }

  magSize() { return CONFIG.crossbow.magSize + (this.game.mods?.magSize ?? 0); }
  maxCharges() { return CONFIG.hex.charges + (this.game.mods?.hexCharges ?? 0); }

  other() { return this.current === this.crossbow ? 'hex' : 'crossbow'; }

  select(name) {
    const target = name === 'hex' ? this.hex : this.crossbow;
    if (target === this.current || this.switchAnim < 1) return;
    this.pending = target;
    this.switchAnim = 0;
    this.reloading = 0;
    this.aiming = false;
    this.game.audio.play('uiClick', { volume: 0.35, pitch: 0.8 });
  }

  triggerDown() { this.firing = true; }
  triggerUp() { this.firing = false; }

  startReload() {
    if (this.current !== this.crossbow || this.reloading > 0 || this.ammo === this.magSize()) return;
    this.reloadTotal = CONFIG.crossbow.reloadTime * (this.game.mods?.reloadMul ?? 1);
    this.reloading = this.reloadTotal;
    this.game.audio.play('reload', { volume: 0.7 });
  }

  fireCrossbow() {
    const C = CONFIG.crossbow;
    if (this.ammo <= 0) {
      this.game.audio.play('dryFire', { volume: 0.5 });
      this.startReload();
      this.cooldown = 0.3;
      return;
    }
    this.ammo--;
    this.cooldown = C.fireInterval;
    this.recoil = 1;
    this.flashTime = CONFIG.feel.muzzleFlashTime;
    // string snaps forward, bolt leaves the rail, then auto-recock
    const xb = this.crossbow;
    xb.nutZ = xb.lathZ + 0.03;
    xb.recock = C.fireInterval * 0.8;
    xb.bolt.visible = false;
    this.updateString(xb);
    this.game.ui.crosshairKick();
    this.game.audio.playOne(['shotCrossbow1', 'shotCrossbow2'], { volume: 0.9 });

    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    const game = this.game;
    const tWall = castObstacles(origin, dir, game.level.colliders, C.range);
    const hit = game.enemies.raycast(origin, dir, tWall);

    // damage is instant (hitscan); the visible bolt and impact FX fly out
    let endT = tWall;
    let impact = tWall < C.range ? 'stone' : null;
    if (hit) {
      endT = hit.t;
      impact = 'flesh';
      const mods = this.game.mods;
      const dmg = C.damage * (mods?.xbowDamage ?? 1) *
        (hit.upper ? C.upperMult + (mods?.critBonus ?? 0) : 1);
      hit.enemy.damage(dmg, dir);
      game.ui.hitmarker(hit.upper);
    }

    const mz = new THREE.Vector3();
    this.crossbow.muzzle.getWorldPosition(mz);
    const end = origin.clone().addScaledVector(dir, Math.min(endT, C.range));
    this.spawnFlyBolt(mz, end, impact);

    if (this.ammo === 0) this.startReload();
  }

  spawnFlyBolt(from, to, impact) {
    const b = this.flyBolts.find((x) => !x.active) ?? this.flyBolts[0];
    b.active = true;
    b.group.visible = true;
    b.group.position.copy(from);
    b.group.lookAt(to);
    b.dir.copy(to).sub(from);
    b.remaining = b.dir.length();
    b.dir.normalize();
    b.end.copy(to);
    b.impact = impact;
  }

  updateFlyBolts(dt) {
    const game = this.game;
    for (const b of this.flyBolts) {
      if (!b.active) continue;
      const step = CONFIG.crossbow.boltVisualSpeed * dt;
      b.group.position.addScaledVector(b.dir, Math.min(step, b.remaining));
      b.remaining -= step;
      // glittering trail behind the fletching
      for (let i = 0; i < 2; i++) {
        const back = 0.2 + Math.random() * 0.5;
        game.particles.spawn({
          x: b.group.position.x - b.dir.x * back + (Math.random() - 0.5) * 0.04,
          y: b.group.position.y - b.dir.y * back + (Math.random() - 0.5) * 0.04,
          z: b.group.position.z - b.dir.z * back + (Math.random() - 0.5) * 0.04,
          vx: 0, vy: 0.12, vz: 0,
          r: 1, g: 0.78, b: 0.36,
          life: 0.22 + Math.random() * 0.16,
          size: 0.045 + Math.random() * 0.03,
          gravity: 0, drag: 2.5,
        });
      }
      if (b.remaining <= 0) {
        b.active = false;
        b.group.visible = false;
        if (b.impact === 'flesh') {
          game.audio.playOne(['impactFlesh0', 'impactFlesh1', 'impactFlesh2', 'impactFlesh3', 'impactFlesh4'], { volume: 0.65 });
          game.particles.burst(b.end, { count: 10, color: 0x6e1212, color2: 0x55504a, speed: 3, life: 0.5, size: 0.07, gravity: 7 });
        } else if (b.impact === 'stone') {
          game.audio.playOne(['impactStone0', 'impactStone1', 'impactStone2'], { volume: 0.4 });
          game.particles.burst(b.end, { count: 7, color: CONFIG.colors.gold, color2: 0xfff0c8, speed: 3.5, life: 0.35, size: 0.05, gravity: 8 });
        }
      }
    }
  }

  setAim(v) {
    this.aiming = v && this.current === this.crossbow;
  }

  fireHex() {
    if (this.charges <= 0) {
      this.game.audio.play('dryFire', { volume: 0.5, pitch: 0.7 });
      this.cooldown = 0.3;
      return;
    }
    this.charges--;
    this.cooldown = CONFIG.hex.fireInterval;
    this.recoil = 0.7;
    this.game.ui.crosshairKick();
    this.game.audio.play('hexCast', { volume: 0.9, pitch: 0.75 });

    const origin = new THREE.Vector3();
    this.hex.muzzle.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y += 0.03; dir.normalize();
    this.game.projectiles.fireOrb(origin, dir);
  }

  update(dt, mouseDX, mouseDY) {
    const game = this.game;
    const player = game.player;
    const F = CONFIG.feel;

    // weapon switch animation (lower -> swap -> raise)
    if (this.pending) {
      this.switchAnim += dt / 0.18;
      if (this.switchAnim >= 0.5 && this.current !== this.pending) {
        this.current.root.visible = false;
        this.current = this.pending;
        this.current.root.visible = true;
        game.ui.setWeapon(this.current.name);
      }
      if (this.switchAnim >= 1) { this.switchAnim = 1; this.pending = null; }
    }

    // recharge hex
    if (this.charges < this.maxCharges()) {
      this.rechargeTimer += dt;
      if (this.rechargeTimer >= CONFIG.hex.rechargeTime * (this.game.mods?.hexRecharge ?? 1)) {
        this.rechargeTimer = 0;
        this.charges++;
        this.game.onHexReady();
      }
    } else this.rechargeTimer = 0;

    // reload
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        this.ammo = this.magSize();
        this.game.audio.play('reload', { volume: 0.5, pitch: 1.25 });
      }
    }

    // firing
    this.cooldown -= dt;
    if (this.firing && this.cooldown <= 0 && this.reloading <= 0 && !this.pending && player.alive && game.playing) {
      if (this.current === this.crossbow) this.fireCrossbow();
      else this.fireHex();
    }

    // ---- procedural motion ----
    this.recoil = Math.max(0, this.recoil - dt * 7);
    this.swayX = THREE.MathUtils.lerp(this.swayX, -mouseDX * F.swayAmount, 1 - Math.exp(-14 * dt));
    this.swayY = THREE.MathUtils.lerp(this.swayY, mouseDY * F.swayAmount, 1 - Math.exp(-14 * dt));

    const w = this.current;
    const bob = player.bobPhase;
    const speedFrac = Math.min(1, player.speed2D / CONFIG.player.sprintSpeed);
    const bobX = Math.sin(bob) * F.bobAmount * speedFrac;
    const bobY = -Math.abs(Math.cos(bob)) * F.bobAmount * 1.2 * speedFrac;

    // idle breathing
    const t = performance.now() / 1000;
    const idleY = Math.sin(t * 1.7) * 0.0035;

    const recoilZ = this.recoil * CONFIG.crossbow.recoilKick * 4;
    const reloadDip = this.reloading > 0 ? Math.sin(Math.min(1, 1 - this.reloading / (this.reloadTotal || CONFIG.crossbow.reloadTime)) * Math.PI) * 0.16 : 0;
    const switchDip = this.pending ? Math.sin(this.switchAnim * Math.PI) * 0.3
      : (this.switchAnim < 1 ? (1 - this.switchAnim) * 0.3 : 0);

    w.root.position.set(
      w.basePos.x + this.swayX + bobX,
      w.basePos.y + this.swayY + bobY + idleY - reloadDip - switchDip,
      w.basePos.z + recoilZ * 0.06,
    );
    // aim-down-sights blend: weapon slides to centre, motion dampens
    this.aimBlend += ((this.aiming ? 1 : 0) - this.aimBlend) * Math.min(1, 12 * dt);
    const ab = w === this.crossbow ? this.aimBlend : 0;
    if (ab > 0.001) {
      const p = w.root.position;
      p.x = THREE.MathUtils.lerp(p.x, this.swayX * 0.3, ab);
      p.y = THREE.MathUtils.lerp(p.y, -0.085 + this.swayY * 0.3 + idleY * 0.5 - reloadDip - switchDip, ab);
      p.z = THREE.MathUtils.lerp(p.z, -0.52 + recoilZ * 0.06, ab);
    }

    const br = w.baseRot ?? _ZERO_EULER;
    const rotDamp = 1 - ab * 0.85;
    w.root.rotation.set(
      (br.x + this.recoil * -CONFIG.crossbow.recoilKick * 3 + this.swayY * 0.6) * rotDamp,
      (br.y + this.swayX * 0.6) * rotDamp,
      (br.z + (player.sprinting ? -0.12 : 0) + this.swayX * 0.4) * rotDamp,
    );

    // crossbow string recock + bolt visibility
    const xb = this.crossbow;
    if (xb.recock > 0) {
      xb.recock -= dt;
      if (xb.recock <= 0 && this.ammo > 0) {
        this.game.audio.play('dryFire', { volume: 0.18, pitch: 1.5 });
      }
    } else {
      const cocked = -0.03;
      if (Math.abs(xb.nutZ - cocked) > 0.001) {
        // draw the string back smoothly
        xb.nutZ = THREE.MathUtils.lerp(xb.nutZ, cocked, 1 - Math.exp(-16 * dt));
        this.updateString(xb);
      }
      xb.bolt.visible = this.ammo > 0 && this.reloading <= 0;
    }

    // rig lags behind camera rotation
    const target = this.camera.quaternion;
    this.lagQuat.slerp(target, 1 - Math.exp(-F.weaponLag * dt));
    const delta = target.clone().invert().multiply(this.lagQuat);
    const e = new THREE.Euler().setFromQuaternion(delta, 'YXZ');
    this.rig.rotation.set(e.x * 0.5, e.y * 0.5, e.z * 0.3);

    // hex orb hover
    if (this.hex.root.visible) {
      this.hex.orb.position.y = 0.44 + Math.sin(t * 3.1) * 0.016;
      this.hex.orb.scale.setScalar(1 + Math.sin(t * 5.3) * 0.12);
      this.hex.orb.visible = this.charges > 0;
    }

    // muzzle flash decay
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      const f = Math.max(0, this.flashTime / F.muzzleFlashTime);
      this.flash.material.opacity = f;
      this.flash.material.rotation = Math.random() * Math.PI;
      this.flashLight.intensity = 26 * f;
    } else {
      this.flash.material.opacity = 0;
      this.flashLight.intensity = 0;
    }

    this.updateFlyBolts(dt);
  }

  reset() {
    this.ammo = this.magSize();
    this.charges = this.maxCharges();
    this.aiming = false;
    this.aimBlend = 0;
    for (const b of this.flyBolts) { b.active = false; b.group.visible = false; }
    this.rechargeTimer = 0;
    this.cooldown = 0;
    this.reloading = 0;
    this.recoil = 0;
    this.firing = false;
    this.pending = null;
    this.switchAnim = 1;
    if (this.current !== this.crossbow) {
      this.current.root.visible = false;
      this.current = this.crossbow;
      this.current.root.visible = true;
    }
  }

  dispose() {
    document.removeEventListener('wheel', this._wheel);
  }
}
