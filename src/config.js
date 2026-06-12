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
    boss:   { hp: 1050, speed: 2.3, damage: 40, attackRange: 3.0, attackCooldown: 2.1, scale: 3.1, knockback: 9 },
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
    bossEvery: 5,        // every Nth wave is a Warden wave
  },

  score: {
    grunt: 50,
    caster: 80,
    brute: 220,
    boss: 1200,
    comboWindow: 4,      // seconds to keep the chain alive
    comboMax: 8,         // multiplier cap
    killsPerComboStep: 2,
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

// Default per-run modifiers — perks mutate a copy of this.
export function defaultMods() {
  return {
    moveSpeed: 1,
    xbowDamage: 1,
    magSize: 0,
    reloadMul: 1,
    hexCharges: 0,
    hexRecharge: 1,
    aoeRadius: 1,
    critBonus: 0,
    lifeOnKill: 0,
    maxHpBonus: 0,
    vialBonus: 0,
  };
}

// Litanies — one of three is chosen after every cleared wave. All stack.
export const PERKS = [
  { id: 'haste',    name: "Wolf's Haste",   desc: 'Move 12% faster.',
    apply: (m) => { m.moveSpeed *= 1.12; } },
  { id: 'bite',     name: 'Steel Bite',     desc: 'Crossbow bolts deal +20% damage.',
    apply: (m) => { m.xbowDamage *= 1.2; } },
  { id: 'quiver',   name: "Saint's Quiver", desc: '+6 bolts per magazine.',
    apply: (m) => { m.magSize += 6; } },
  { id: 'hands',    name: 'Deft Hands',     desc: 'Reload 30% faster.',
    apply: (m) => { m.reloadMul *= 0.7; } },
  { id: 'pact',     name: 'Witch Pact',     desc: '+2 maximum hex charges.',
    apply: (m) => { m.hexCharges += 2; } },
  { id: 'catalyst', name: 'Catalyst',       desc: 'Hexes recharge 35% faster.',
    apply: (m) => { m.hexRecharge *= 0.65; } },
  { id: 'ruin',     name: 'Wider Ruin',     desc: 'Hex blast radius +30%.',
    apply: (m) => { m.aoeRadius *= 1.3; } },
  { id: 'headsman', name: 'Headsman',       desc: 'Upper-body hits deal +35% more.',
    apply: (m) => { m.critBonus += 0.35; } },
  { id: 'leech',    name: 'Leech Rune',     desc: 'Heal 2 HP on every kill.',
    apply: (m) => { m.lifeOnKill += 2; } },
  { id: 'heart',    name: 'Stone Heart',    desc: '+25 max HP, and mend 25 now.',
    apply: (m, game) => {
      m.maxHpBonus += 25;
      if (game) { game.player.maxHp += 25; game.player.heal(25); }
    } },
  { id: 'rites',    name: 'Last Rites',     desc: 'Vials restore +15 more HP.',
    apply: (m) => { m.vialBonus += 15; } },
];
