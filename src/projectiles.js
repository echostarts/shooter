import * as THREE from 'three';
import { CONFIG } from './config.js';
import { getGlowTexture } from './particles.js';

// Ray vs AABB slab test. Returns distance t >= 0 or null.
export function rayBox(origin, dir, box) {
  let tmin = 0;
  let tmax = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis], d = dir[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < box.min[axis] || o > box.max[axis]) return null;
    } else {
      let t1 = (box.min[axis] - o) / d;
      let t2 = (box.max[axis] - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

// Nearest obstacle (walls/props) hit along a ray; returns t or maxDist.
export function castObstacles(origin, dir, colliders, maxDist) {
  let best = maxDist;
  for (const b of colliders) {
    const t = rayBox(origin, dir, b);
    if (t !== null && t < best) best = t;
  }
  return best;
}

const ORB_POOL = 8;
const BOLT_POOL = 16;

// Pooled projectiles: player hex orbs (violet, AoE) and enemy caster bolts.
export class ProjectileSystem {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;

    const glowTex = getGlowTexture();
    const mkGlow = (color, scale, opacity = 0.9) => {
      const g = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color, transparent: true, opacity,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      g.scale.setScalar(scale);
      return g;
    };

    // player hex orbs: bright core + violet halo + point light
    this.orbs = [];
    const orbGeo = new THREE.SphereGeometry(0.11, 12, 10);
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xe8dcff });
    orbMat.color.multiplyScalar(2.4); // push into bloom
    for (let i = 0; i < ORB_POOL; i++) {
      const mesh = new THREE.Mesh(orbGeo, orbMat);
      mesh.visible = false;
      const light = new THREE.PointLight(CONFIG.colors.violet, 7, 7, 2);
      light.visible = false;
      mesh.add(light);
      const halo = mkGlow(new THREE.Color(CONFIG.colors.violet).multiplyScalar(1.6), 0.85);
      mesh.add(halo);
      scene.add(mesh);
      this.orbs.push({ mesh, light, halo, active: false, vel: new THREE.Vector3(), age: 0 });
    }
    this.orbGeo = orbGeo; this.orbMat = orbMat;

    // caster bolts: white-hot core in a violet halo, comet trail in update()
    this.bolts = [];
    const boltGeo = new THREE.SphereGeometry(0.07, 10, 8);
    const boltMat = new THREE.MeshBasicMaterial({ color: 0xf2eaff });
    boltMat.color.multiplyScalar(2.6);
    for (let i = 0; i < BOLT_POOL; i++) {
      const mesh = new THREE.Mesh(boltGeo, boltMat);
      mesh.visible = false;
      const halo = mkGlow(new THREE.Color(0x9b6dff).multiplyScalar(1.8), 0.62);
      mesh.add(halo);
      scene.add(mesh);
      this.bolts.push({ mesh, halo, active: false, vel: new THREE.Vector3(), age: 0 });
    }
    this.boltGeo = boltGeo; this.boltMat = boltMat;
  }

  fireOrb(origin, dir) {
    const o = this.orbs.find((x) => !x.active);
    if (!o) return false;
    o.active = true;
    o.age = 0;
    o.mesh.visible = o.light.visible = true;
    o.mesh.position.copy(origin);
    o.vel.copy(dir).multiplyScalar(CONFIG.hex.speed);
    return true;
  }

  fireBolt(origin, dir) {
    const b = this.bolts.find((x) => !x.active);
    if (!b) return false;
    b.active = true;
    b.age = 0;
    b.mesh.visible = true;
    b.mesh.position.copy(origin);
    b.vel.copy(dir).multiplyScalar(CONFIG.enemies.caster.boltSpeed);
    return true;
  }

  explodeOrb(o) {
    o.active = false;
    o.mesh.visible = o.light.visible = false;
    this.game.onHexExplosion(o.mesh.position.clone());
  }

  update(dt) {
    const game = this.game;
    const colliders = game.level.colliders;

    for (const o of this.orbs) {
      if (!o.active) continue;
      o.age += dt;
      o.vel.y -= CONFIG.hex.gravity * dt;
      const step = o.vel.length() * dt;
      const dir = o.vel.clone().normalize();
      const p = o.mesh.position;

      // wall/prop hit
      const tObs = castObstacles(p, dir, colliders, step + 0.16);
      // enemy hit
      let hitEnemy = false;
      for (const e of game.enemies.list) {
        if (!e.alive) continue;
        if (p.distanceToSquared(e.center) < (0.4 + e.radius) ** 2) { hitEnemy = true; break; }
      }
      if (hitEnemy || tObs < step + 0.16 || p.y < 0.12 || o.age > 6) {
        this.explodeOrb(o);
        continue;
      }
      p.addScaledVector(o.vel, dt);
      o.halo.scale.setScalar(0.85 + Math.sin(o.age * 17) * 0.09);
      // swirling violet trail
      for (let i = 0; i < 2; i++) {
        const a = o.age * 22 + i * Math.PI;
        game.particles.spawn({
          x: p.x + Math.cos(a) * 0.1, y: p.y + Math.sin(a) * 0.1, z: p.z,
          vx: 0, vy: 0.25, vz: 0,
          r: 0.6, g: 0.4, b: 1, life: 0.4, size: 0.08, gravity: 0, drag: 2,
        });
      }
    }

    for (const b of this.bolts) {
      if (!b.active) continue;
      b.age += dt;
      const p = b.mesh.position;
      const step = b.vel.length() * dt;
      const dir = b.vel.clone().normalize();

      // player hit (sphere vs capsule-ish)
      const pl = game.player;
      const dx = p.x - pl.position.x, dz = p.z - pl.position.z;
      const py = Math.min(Math.max(p.y, pl.position.y + 0.2), pl.eye + 0.1);
      const dy = p.y - py;
      if (dx * dx + dz * dz + dy * dy < 0.55 ** 2 && pl.alive) {
        pl.damage(CONFIG.enemies.caster.damage, game, p);
        b.active = false; b.mesh.visible = false;
        continue;
      }
      const tObs = castObstacles(p, dir, colliders, step + 0.13);
      if (tObs < step + 0.13 || p.y < 0.1 || b.age > 5) {
        game.particles.burst(p, { count: 8, color: 0x8b5cf6, speed: 2.5, life: 0.4, size: 0.06, gravity: 3 });
        b.active = false; b.mesh.visible = false;
        continue;
      }
      p.addScaledVector(b.vel, dt);
      // comet tail: dense violet wisps stretching behind the core
      b.halo.scale.setScalar(0.62 + Math.sin(b.age * 21) * 0.07);
      const tail = dir.clone().multiplyScalar(-1);
      for (let i = 0; i < 2; i++) {
        const back = Math.random() * 0.55;
        game.particles.spawn({
          x: p.x + tail.x * back + (Math.random() - 0.5) * 0.05,
          y: p.y + tail.y * back + (Math.random() - 0.5) * 0.05,
          z: p.z + tail.z * back + (Math.random() - 0.5) * 0.05,
          vx: 0, vy: 0.1, vz: 0,
          r: 0.62 - back * 0.4, g: 0.4 - back * 0.25, b: 1 - back * 0.35,
          life: 0.3 + Math.random() * 0.2,
          size: 0.1 * (1 - back * 0.8) + 0.03,
          gravity: 0, drag: 2.5,
        });
      }
    }
  }

  reset() {
    for (const o of this.orbs) { o.active = false; o.mesh.visible = o.light.visible = false; }
    for (const b of this.bolts) { b.active = false; b.mesh.visible = false; }
  }
}
