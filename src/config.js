// All gameplay numbers in one place.
export const CONFIG = {
  arena: {
    size: 60,            // metres, square
    wallHeight: 6,
    wallThickness: 1.5,
    floorTiling: 14,     // texture repeats across the arena
    wallTilingU: 12,
    wallTilingV: 1.6,
    fogColor: 0x070a12,
    fogDensity: 0.024,
    torchCount: 8,
    propCount: 26,
  },

  colors: {
    gold: 0xe8b34b,      // player power
    violet: 0x8b5cf6,    // enemy / corruption
    cyan: 0x43d6d6,      // heal pickups only
  },

  player: {
    eyeHeight: 1.7,
    radius: 0.45,
    hp: 100,
    walkSpeed: 5.2,
    sprintSpeed: 8.0,
    accel: 38,
    friction: 11,
    airControl: 0.35,
    jumpSpeed: 4.6,
    gravity: 16,
    baseFov: 75,
    sprintFovAdd: 6,
    healAmount: 25,
    lowHpThreshold: 30,
  },

  crossbow: {
    damage: 18,
    upperMult: 1.5,
    magSize: 12,
    reloadTime: 0.9,
    fireInterval: 0.34,
    tracerFade: 0.06,
    recoilKick: 0.055,
    range: 120,
  },

  hex: {
    damage: 35,
    aoeRadius: 3,
    speed: 14,
    gravity: 3.2,        // slight arc
    charges: 6,
    rechargeTime: 4,
    fireInterval: 0.55,
    selfKnock: 0,
  },

  enemies: {
    grunt:  { hp: 35,  speed: 4.2, damage: 10, attackRange: 1.7, attackCooldown: 1.1, scale: 0.8,  knockback: 0 },
    caster: { hp: 50,  speed: 2.6, damage: 12, attackRange: 16,  attackCooldown: 2.8, scale: 0.9,
              keepMin: 10, keepMax: 14, boltSpeed: 9.5 },
    brute:  { hp: 160, speed: 1.8, damage: 30, attackRange: 2.3, attackCooldown: 1.8, scale: 1.9,  knockback: 5.5 },
    separationRadius: 1.4,
    separationForce: 6,
    whiskerLength: 2.2,
    maxLive: 24,
    crossfade: 0.2,
    dissolveTime: 1.15,
    dropChance: 0.14,    // cyan vial
    dropPity: 5,         // guaranteed drop after this many dropless kills
  },

  waves: {
    baseCount: 4,
    perWave: 3,
    batchSize: 4,
    batchInterval: 1.4,
    interTime: 5,        // seconds between waves
    bruteFromWave: 3,
    casterFracBase: 0.1,
    casterFracPerWave: 0.05,
    casterFracMax: 0.45,
    bruteFrac: 0.14,
  },

  feel: {
    hitstop: 0.03,           // seconds of near-frozen time per kill
    hitstopScale: 0.08,
    shakeDamage: 0.16,       // seconds
    shakeAoE: 0.13,
    swayAmount: 0.012,
    bobAmount: 0.017,
    bobSpeed: 9.5,
    weaponLag: 9,            // lerp rate, higher = tighter
    muzzleFlashTime: 0.05,
    enemyFlashTime: 0.08,
  },

  post: {
    bloomThreshold: 0.85,
    bloomStrength: 0.55,
    bloomRadius: 0.4,
    exposure: 1.15,
    grain: 0.035,
    vignette: 0.55,
  },

  audio: {
    sfxVolume: 0.8,
    musicVolume: 0.5,
    pitchJitter: 0.1,
  },
};
