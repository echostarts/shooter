import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

// import.meta.env exists under Vite; fall back to '/' when imported from Node.
const BASE = `${import.meta.env?.BASE_URL ?? '/'}assets/`;

export const MANIFEST = {
  models: {
    grunt: 'models/Orc_Skull.gltf',
    caster: 'models/Wizard.gltf',
    brute: 'models/Demon.gltf',
    arch: 'models/Arch_Gothic_RoundColumn.glb',
    columnRound: 'models/Column_Round.glb',
    columnShort: 'models/Column_Round_Short.glb',
    columnSquare: 'models/Column_Square.glb',
    barrel: 'models/Barrel.glb',
    crate: 'models/Crate.glb',
    deadTree: 'models/DeadTree_1.glb',
    potion: 'models/Potion_1.gltf',
    torch: 'models/Torch_Metal.gltf',
  },
  textures: {
    cobbleDiff: 'textures/cobblestone_floor_08_diff_1k.jpg',
    cobbleNor: 'textures/cobblestone_floor_08_nor_gl_1k.jpg',
    cobbleRough: 'textures/cobblestone_floor_08_rough_1k.jpg',
    cobbleAO: 'textures/cobblestone_floor_08_ao_1k.jpg',
    rockDiff: 'textures/rock_wall_08_diff_1k.jpg',
    rockNor: 'textures/rock_wall_08_nor_gl_1k.jpg',
    rockRough: 'textures/rock_wall_08_rough_1k.jpg',
    rockAO: 'textures/rock_wall_08_ao_1k.jpg',
  },
  hdri: {
    night: 'hdri/dikhololo_night_2k.hdr',
  },
  // SVG icons are used directly by the DOM (perk cards, HUD) — listed here
  // so the verification script covers them; loadAll skips this group.
  icons: {
    perkHaste: 'icons/perk_haste.svg',
    perkBite: 'icons/perk_bite.svg',
    perkQuiver: 'icons/perk_quiver.svg',
    perkHands: 'icons/perk_hands.svg',
    perkPact: 'icons/perk_pact.svg',
    perkCatalyst: 'icons/perk_catalyst.svg',
    perkRuin: 'icons/perk_ruin.svg',
    perkHeadsman: 'icons/perk_headsman.svg',
    perkLeech: 'icons/perk_leech.svg',
    perkHeart: 'icons/perk_heart.svg',
    perkRites: 'icons/perk_rites.svg',
    weaponCrossbow: 'icons/weapon_crossbow.svg',
    weaponHex: 'icons/weapon_hex.svg',
  },
  sfx: {
    shotCrossbow1: 'sfx/shot_crossbow_1.ogg',
    shotCrossbow2: 'sfx/shot_crossbow_2.ogg',
    reload: 'sfx/reload_latch.ogg',
    dryFire: 'sfx/click_dry.ogg',
    hexCast: 'sfx/hex_cast.ogg',
    hexExplodeGlass: 'sfx/hex_explode_glass.ogg',
    hexExplodeThump: 'sfx/hex_explode_thump.ogg',
    impactFlesh0: 'sfx/impact_flesh_0.ogg',
    impactFlesh1: 'sfx/impact_flesh_1.ogg',
    impactFlesh2: 'sfx/impact_flesh_2.ogg',
    impactFlesh3: 'sfx/impact_flesh_3.ogg',
    impactFlesh4: 'sfx/impact_flesh_4.ogg',
    impactStone0: 'sfx/impact_stone_0.ogg',
    impactStone1: 'sfx/impact_stone_1.ogg',
    impactStone2: 'sfx/impact_stone_2.ogg',
    growl1: 'sfx/growl_1.ogg',
    growl2: 'sfx/growl_2.ogg',
    growl3: 'sfx/growl_3.ogg',
    enemyHit: 'sfx/enemy_hit.ogg',
    enemyDie: 'sfx/enemy_die.ogg',
    playerHurt1: 'sfx/player_hurt_1.ogg',
    playerHurt2: 'sfx/player_hurt_2.ogg',
    uiClick: 'sfx/ui_click.ogg',
    uiHover: 'sfx/ui_hover.ogg',
    waveBell: 'sfx/wave_bell.ogg',
    deathBell: 'sfx/death_bell.ogg',
    pickupVial: 'sfx/pickup_vial.ogg',
    casterBolt: 'sfx/caster_bolt.ogg',
    footstep0: 'sfx/footstep_0.ogg',
    footstep1: 'sfx/footstep_1.ogg',
    footstep2: 'sfx/footstep_2.ogg',
    footstep3: 'sfx/footstep_4.ogg',
  },
};

// Returns every asset URL (used by the verification script and prefetch).
export function allAssetUrls() {
  const urls = [];
  for (const group of Object.values(MANIFEST)) {
    for (const rel of Object.values(group)) urls.push(BASE + rel);
  }
  return urls;
}

export const ASSETS = {
  models: {},   // key -> gltf scene (+ animations)
  textures: {},
  hdri: {},
  sfxBuffers: {}, // raw ArrayBuffers, decoded later by audio.js
};

export async function loadAll(onProgress) {
  const gltfLoader = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();
  const hdrLoader = new RGBELoader();

  const tasks = [];
  let done = 0;
  let total = 0;
  const tick = () => { done++; onProgress?.(done / total); };

  for (const [key, rel] of Object.entries(MANIFEST.models)) {
    tasks.push(gltfLoader.loadAsync(BASE + rel).then((g) => { ASSETS.models[key] = g; tick(); }));
  }
  for (const [key, rel] of Object.entries(MANIFEST.textures)) {
    tasks.push(texLoader.loadAsync(BASE + rel).then((t) => { ASSETS.textures[key] = t; tick(); }));
  }
  for (const [key, rel] of Object.entries(MANIFEST.hdri)) {
    tasks.push(hdrLoader.loadAsync(BASE + rel).then((t) => { ASSETS.hdri[key] = t; tick(); }));
  }
  for (const [key, rel] of Object.entries(MANIFEST.sfx)) {
    tasks.push(fetch(BASE + rel).then(async (r) => {
      if (!r.ok) throw new Error(`SFX ${rel}: HTTP ${r.status}`);
      ASSETS.sfxBuffers[key] = await r.arrayBuffer();
      tick();
    }));
  }

  total = tasks.length;
  await Promise.all(tasks);
  return ASSETS;
}
