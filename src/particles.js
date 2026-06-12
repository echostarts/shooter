import * as THREE from 'three';

const MAX = 1500;

// One pooled additive point cloud for every effect in the game.
export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.positions = new Float32Array(MAX * 3);
    this.colors = new Float32Array(MAX * 3);
    this.sizes = new Float32Array(MAX);
    this.velocities = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);     // remaining
    this.maxLife = new Float32Array(MAX);
    this.gravity = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.baseSize = new Float32Array(MAX);
    this.cursor = 0;
    this.aliveCount = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000); // never culled

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (220.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float a = smoothstep(0.5, 0.05, d);
          gl_FragColor = vec4(vColor, a);
        }`,
      vertexColors: true,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(opt) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    const i3 = i * 3;
    this.positions[i3] = opt.x; this.positions[i3 + 1] = opt.y; this.positions[i3 + 2] = opt.z;
    this.velocities[i3] = opt.vx ?? 0; this.velocities[i3 + 1] = opt.vy ?? 0; this.velocities[i3 + 2] = opt.vz ?? 0;
    this.colors[i3] = opt.r; this.colors[i3 + 1] = opt.g; this.colors[i3 + 2] = opt.b;
    this.life[i] = this.maxLife[i] = opt.life ?? 0.6;
    this.gravity[i] = opt.gravity ?? 0;
    this.drag[i] = opt.drag ?? 1.5;
    this.baseSize[i] = opt.size ?? 0.08;
    this.sizes[i] = this.baseSize[i];
  }

  burst(pos, { count = 12, color, color2, speed = 4, spread = 1, life = 0.55, size = 0.08, gravity = 6, up = 0.5 }) {
    const c1 = new THREE.Color(color);
    const c2 = new THREE.Color(color2 ?? color);
    for (let n = 0; n < count; n++) {
      const t = Math.random();
      const c = c1.clone().lerp(c2, t);
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.3) * spread;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: Math.cos(a) * s, vy: up * s + e * s, vz: Math.sin(a) * s,
        r: c.r, g: c.g, b: c.b,
        life: life * (0.6 + Math.random() * 0.8),
        size: size * (0.7 + Math.random() * 0.7),
        gravity,
      });
    }
  }

  update(dt) {
    const p = this.positions, v = this.velocities;
    let any = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.sizes[i] = 0; continue; }
      any = true;
      this.life[i] -= dt;
      const i3 = i * 3;
      v[i3 + 1] -= this.gravity[i] * dt;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      v[i3] *= dr; v[i3 + 1] *= dr; v[i3 + 2] *= dr;
      p[i3] += v[i3] * dt; p[i3 + 1] += v[i3 + 1] * dt; p[i3 + 2] += v[i3 + 2] * dt;
      if (p[i3 + 1] < 0.02) { p[i3 + 1] = 0.02; v[i3 + 1] *= -0.25; }
      const frac = Math.max(0, this.life[i] / this.maxLife[i]);
      this.sizes[i] = this.baseSize[i] * frac;
    }
    if (any || this._wasAlive) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.size.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
    this._wasAlive = any;
  }

  reset() {
    this.life.fill(0);
    this.sizes.fill(0);
    this.points.geometry.attributes.size.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
