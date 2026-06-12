import * as THREE from 'three';
import { CONFIG } from './config.js';
import { ASSETS } from './assets.js';

// "The Court of Vespers" — square night courtyard with PBR floor/walls,
// scattered ruins for cover, 4 glowing spawn gates, moon + torches.
export class Level {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.colliders = [];   // THREE.Box3 list (walls + props), used by player & enemies
    this.torches = [];     // { light, baseIntensity, seed }
    this.gates = [];       // { position (Vector3), forward (Vector3) }
    this.disposables = [];

    this.buildEnvironment();
    this.buildArena();
    this.buildProps();
    this.buildGates();
    this.buildLights();
  }

  buildEnvironment() {
    const hdr = ASSETS.hdri.night;
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = hdr;
    this.scene.background = hdr;
    this.scene.backgroundIntensity = 0.16;
    this.scene.backgroundBlurriness = 0.04;
    this.scene.environmentIntensity = 0.28;
    this.scene.fog = new THREE.FogExp2(CONFIG.arena.fogColor, CONFIG.arena.fogDensity);
  }

  setupTex(t, repX, repY, srgb) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repX, repY);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return t;
  }

  buildArena() {
    const S = CONFIG.arena.size;
    const H = CONFIG.arena.wallHeight;
    const T = CONFIG.arena.wallThickness;
    const tx = ASSETS.textures;
    const ft = CONFIG.arena.floorTiling;

    const floorMat = new THREE.MeshStandardMaterial({
      map: this.setupTex(tx.cobbleDiff, ft, ft, true),
      normalMap: this.setupTex(tx.cobbleNor, ft, ft, false),
      roughnessMap: this.setupTex(tx.cobbleRough, ft, ft, false),
      aoMap: this.setupTex(tx.cobbleAO, ft, ft, false),
      roughness: 1,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(S, S), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.disposables.push(floor.geometry, floorMat);

    const wu = CONFIG.arena.wallTilingU, wv = CONFIG.arena.wallTilingV;
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.setupTex(tx.rockDiff.clone(), wu, wv, true),
      normalMap: this.setupTex(tx.rockNor.clone(), wu, wv, false),
      roughnessMap: this.setupTex(tx.rockRough.clone(), wu, wv, false),
      aoMap: this.setupTex(tx.rockAO.clone(), wu, wv, false),
      roughness: 1,
      color: 0x9a9a9f,
    });
    this.disposables.push(wallMat);

    const half = S / 2;
    const mk = (w, d, x, z) => {
      const geo = new THREE.BoxGeometry(w, H, d);
      const m = new THREE.Mesh(geo, wallMat);
      m.position.set(x, H / 2, z);
      m.receiveShadow = true;
      m.castShadow = false;
      this.scene.add(m);
      this.disposables.push(geo);
      this.colliders.push(new THREE.Box3().setFromObject(m));
    };
    mk(S + T * 2, T, 0, -half - T / 2);
    mk(S + T * 2, T, 0, half + T / 2);
    mk(T, S, -half - T / 2, 0);
    mk(T, S, half + T / 2, 0);
  }

  placeModel(key, x, z, ry = 0, scale = 1, collide = true, y = 0) {
    const src = ASSETS.models[key].scene;
    const obj = src.clone(true);
    obj.position.set(x, y, z);
    obj.rotation.y = ry;
    obj.scale.setScalar(scale);
    obj.traverse((c) => {
      if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
    });
    this.scene.add(obj);
    if (collide) {
      const box = new THREE.Box3().setFromObject(obj);
      // clamp very tall/very thin boxes a bit for fairer movement
      box.min.y = 0;
      this.colliders.push(box);
    }
    return obj;
  }

  buildProps() {
    const rng = mulberry32(0xdead);
    const half = CONFIG.arena.size / 2 - 5;
    const picks = [
      ['columnRound', 1.6], ['columnSquare', 1.6], ['columnShort', 1.6],
      ['barrel', 1.4], ['crate', 1.4], ['deadTree', 1.5], ['arch', 1.5],
    ];
    const placed = [];
    const tryPlace = (key, scale) => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const x = (rng() * 2 - 1) * half;
        const z = (rng() * 2 - 1) * half;
        if (Math.hypot(x, z) < 6) continue;           // keep player spawn clear
        if (Math.abs(x) > half - 2 && Math.abs(z) > half - 2) continue;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 5)) continue;
        placed.push({ x, z });
        this.placeModel(key, x, z, rng() * Math.PI * 2, scale);
        return;
      }
    };
    for (let i = 0; i < CONFIG.arena.propCount; i++) {
      const [key, scale] = picks[i % picks.length];
      tryPlace(key, scale * (0.85 + rng() * 0.4));
    }
  }

  buildGates() {
    const half = CONFIG.arena.size / 2;
    const defs = [
      { x: 0, z: -half + 0.8, ry: 0 },
      { x: 0, z: half - 0.8, ry: Math.PI },
      { x: -half + 0.8, z: 0, ry: Math.PI / 2 },
      { x: half - 0.8, z: 0, ry: -Math.PI / 2 },
    ];
    const violet = new THREE.Color(CONFIG.colors.violet);
    for (const d of defs) {
      const arch = this.placeModel('arch', d.x, d.z, d.ry, 1.7, false);
      // violet glow plane inside the arch
      const mat = new THREE.MeshBasicMaterial({
        color: violet, transparent: true, opacity: 0.32,
        side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.4), mat);
      plane.position.set(d.x, 1.8, d.z);
      plane.rotation.y = d.ry;
      this.scene.add(plane);
      this.disposables.push(plane.geometry, mat);

      const light = new THREE.PointLight(violet, 14, 11, 2);
      light.position.set(d.x, 2.2, d.z);
      this.scene.add(light);

      const inward = new THREE.Vector3(-d.x, 0, -d.z).normalize();
      this.gates.push({
        position: new THREE.Vector3(d.x + inward.x * 1.6, 0, d.z + inward.z * 1.6),
        forward: inward,
        glow: plane,
        arch,
      });
    }
  }

  buildLights() {
    // single shadow-casting "moon"
    const moon = new THREE.DirectionalLight(0x8fa3c8, 1.45);
    moon.position.set(-22, 34, 14);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const ext = CONFIG.arena.size * 0.62;
    Object.assign(moon.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 4, far: 90 });
    moon.shadow.bias = -0.0004;
    this.scene.add(moon);
    // cool sky bounce + faint warm ground bounce keeps silhouettes readable
    this.scene.add(new THREE.HemisphereLight(0x2a3654, 0x171008, 0.8));
    this.scene.add(new THREE.AmbientLight(0x1a2030, 0.35));

    // warm wall-mounted torches around the perimeter (no shadows)
    const rng = mulberry32(0xbeef);
    const half = CONFIG.arena.size / 2;
    const gold = 0xffa64d;
    const n = CONFIG.arena.torchCount;
    // two per wall, offset away from the centred gates
    const slots = [];
    for (const s of [-0.55, 0.55]) {
      slots.push({ x: s * half, z: -half + 0.15, ry: 0 });
      slots.push({ x: s * half, z: half - 0.15, ry: Math.PI });
      slots.push({ x: -half + 0.15, z: s * half, ry: Math.PI / 2 });
      slots.push({ x: half - 0.15, z: s * half, ry: -Math.PI / 2 });
    }
    for (let i = 0; i < Math.min(n, slots.length); i++) {
      const s = slots[i];
      const torch = this.placeModel('torch', s.x, s.z, s.ry, 2.2, false, 1.9);
      const inward = new THREE.Vector3(Math.sin(s.ry), 0, Math.cos(s.ry));
      const lp = new THREE.Vector3(s.x + inward.x * 0.8, 2.75, s.z + inward.z * 0.8);
      const light = new THREE.PointLight(gold, 14, 15, 2);
      light.position.copy(lp);
      this.scene.add(light);
      this.torches.push({ light, baseIntensity: 14, seed: rng() * 100, pos: lp.clone().setY(2.55), torch });
    }
  }

  // torch flicker + gate swirl particles
  update(dt, time, particles) {
    for (const t of this.torches) {
      const n = Math.sin(time * 11 + t.seed) * 0.5 + Math.sin(time * 23 + t.seed * 2.7) * 0.3 + Math.sin(time * 5 + t.seed * 0.3) * 0.4;
      t.light.intensity = t.baseIntensity * (1 + n * 0.18);
      if (Math.random() < dt * 14) {
        particles.spawn({
          x: t.pos.x + (Math.random() - 0.5) * 0.15, y: t.pos.y, z: t.pos.z + (Math.random() - 0.5) * 0.15,
          vx: (Math.random() - 0.5) * 0.3, vy: 0.8 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.3,
          r: 1, g: 0.55, b: 0.18, life: 0.5 + Math.random() * 0.4, size: 0.07, gravity: -0.6, drag: 1,
        });
      }
    }
    for (const g of this.gates) {
      if (Math.random() < dt * 22) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.9 + Math.random() * 0.5;
        particles.spawn({
          x: g.glow.position.x + Math.cos(a) * r * Math.abs(g.forward.z) + g.forward.x * 0.2,
          y: 0.4 + Math.random() * 2.6,
          z: g.glow.position.z + Math.sin(a) * r * Math.abs(g.forward.x) + g.forward.z * 0.2,
          vx: g.forward.x * 0.4, vy: 0.5 + Math.random() * 0.7, vz: g.forward.z * 0.4,
          r: 0.55, g: 0.36, b: 0.96, life: 0.8 + Math.random() * 0.6, size: 0.085, gravity: -0.4, drag: 0.6,
        });
      }
    }
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
