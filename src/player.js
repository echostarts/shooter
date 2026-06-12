import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { CONFIG } from './config.js';

// First-person controller: acceleration/friction movement, capsule-vs-AABB
// per-axis collision, gravity + jump, sprint FOV, damage state.
export class Player {
  constructor(camera, dom, level) {
    this.camera = camera;
    this.level = level;
    this.controls = new PointerLockControls(camera, dom);

    this.position = new THREE.Vector3(0, 0, 6); // feet
    this.velocity = new THREE.Vector3();
    this.onGround = true;
    this.mods = null;               // set by Game; perk modifiers
    this.maxHp = CONFIG.player.hp;
    this.hp = this.maxHp;
    this.alive = true;
    this.sprinting = false;
    this.moveInput = new THREE.Vector2();
    this.bobPhase = 0;
    this.speed2D = 0;

    this.keys = {};
    this._onKeyDown = (e) => { this.keys[e.code] = true; };
    this._onKeyUp = (e) => { this.keys[e.code] = false; };
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
  }

  reset() {
    this.position.set(0, 0, 6);
    this.velocity.set(0, 0, 0);
    this.maxHp = CONFIG.player.hp;
    this.hp = this.maxHp;
    this.alive = true;
    this.onGround = true;
  }

  get eye() {
    return this.position.y + CONFIG.player.eyeHeight;
  }

  damage(amount, game, sourcePos) {
    if (!this.alive) return;
    this.hp -= amount;
    game.onPlayerDamaged(amount, sourcePos);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      game.onPlayerDeath();
    }
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  knockback(dir, force) {
    this.velocity.x += dir.x * force;
    this.velocity.z += dir.z * force;
    this.velocity.y += force * 0.25;
    this.onGround = false;
  }

  update(dt) {
    const C = CONFIG.player;
    const k = this.keys;
    const fwd = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    const strafe = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    this.sprinting = !!k.ShiftLeft && fwd > 0;

    // camera-relative wish direction on the XZ plane
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.y = 0; dir.normalize();
    const right = new THREE.Vector3(dir.z, 0, -dir.x).negate();

    const wish = new THREE.Vector3()
      .addScaledVector(dir, fwd)
      .addScaledVector(right, strafe);
    if (wish.lengthSq() > 0) wish.normalize();

    const maxSpeed = (this.sprinting ? C.sprintSpeed : C.walkSpeed) * (this.mods?.moveSpeed ?? 1);
    const control = this.onGround ? 1 : C.airControl;

    // accelerate toward wish, friction when no input
    this.velocity.x += wish.x * C.accel * control * dt;
    this.velocity.z += wish.z * C.accel * control * dt;
    if (this.onGround && wish.lengthSq() === 0) {
      const f = Math.max(0, 1 - C.friction * dt);
      this.velocity.x *= f;
      this.velocity.z *= f;
    }
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    if (sp > maxSpeed) {
      const s = maxSpeed / sp;
      this.velocity.x *= s;
      this.velocity.z *= s;
    }
    this.speed2D = Math.min(sp, maxSpeed);

    // jump + gravity
    if (k.Space && this.onGround && this.alive) {
      this.velocity.y = C.jumpSpeed;
      this.onGround = false;
    }
    this.velocity.y -= C.gravity * dt;

    this.moveWithCollision(dt);

    // ground plane
    if (this.position.y <= 0) {
      this.position.y = 0;
      this.velocity.y = 0;
      this.onGround = true;
    }

    if (this.speed2D > 0.5 && this.onGround) {
      this.bobPhase += dt * CONFIG.feel.bobSpeed * (this.sprinting ? 1.25 : 1);
    }

    this.camera.position.set(this.position.x, this.eye, this.position.z);
  }

  moveWithCollision(dt) {
    const r = CONFIG.player.radius;
    const h = CONFIG.player.eyeHeight + 0.1;
    const p = this.position;

    const collides = (x, y, z) => {
      for (const b of this.level.colliders) {
        if (x + r > b.min.x && x - r < b.max.x &&
            z + r > b.min.z && z - r < b.max.z &&
            y + h > b.min.y && y < b.max.y) return true;
      }
      return false;
    };

    // per-axis swept clamp
    const nx = p.x + this.velocity.x * dt;
    if (!collides(nx, p.y, p.z)) p.x = nx; else this.velocity.x = 0;
    const nz = p.z + this.velocity.z * dt;
    if (!collides(p.x, p.y, nz)) p.z = nz; else this.velocity.z = 0;
    const ny = p.y + this.velocity.y * dt;
    if (!collides(p.x, ny, p.z)) {
      p.y = ny;
      if (this.velocity.y !== 0) this.onGround = false;
    } else {
      if (this.velocity.y > 0) this.velocity.y = 0;
      else { this.velocity.y = 0; this.onGround = true; }
    }
  }

  dispose() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    this.controls.dispose();
  }
}
