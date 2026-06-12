# GRAVEHOLD

A gothic dark-fantasy arena wave-shooter in the browser. Alone in a ruined night
courtyard — *The Court of Vespers* — you hold off waves of monsters with a hand
crossbow and a hex launcher. Boomer-shooter energy, modern rendering polish.

Built with **Vite + vanilla JavaScript + three.js**. No TypeScript, no React,
no physics engine.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build into dist/
```

Optional checks:

```bash
node scripts/verify-assets.mjs   # all manifest assets return 200 (dev server must be running)
```

## Controls

| Input | Action |
|---|---|
| Click (start screen) | Enter the court / lock pointer |
| `WASD` | Move |
| `Shift` | Sprint (forward only, +FOV) |
| `Space` | Jump |
| `LMB` | Fire |
| `R` | Reload crossbow |
| `1` / `2` / mouse wheel | Switch weapon |
| `Esc` | Pause (resume / restart / sensitivity / volume) |
| `F` | FPS counter |

## Weapons

- **Crossbow** (slot 1) — hitscan, 12-bolt magazine, 18 dmg (×1.5 on upper-body
  hits), 0.9 s reload (auto on empty), gold tracer + impact sparks.
- **Hex launcher** (slot 2) — violet orb projectile with a slight arc, 3 m AoE,
  35 dmg with centre falloff, 6 charges, +1 charge every 4 s.

## Enemies

| | HP | Speed | Damage | Behaviour |
|---|---|---|---|---|
| **GRUNT** (skull orc) | 35 | 4.2 m/s | 10 melee | rushes you down |
| **CASTER** (wizard) | 50 | 2.6 m/s | 12 ranged | keeps 10–14 m, lobs dodgeable violet bolts |
| **BRUTE** (demon) | 160 | 1.8 m/s | 30 melee + knockback | slow violet-lit tank, appears from wave 3 |

Wave *N* spawns `4 + 3N` enemies in batches from four violet spawn gates.
Caster ratio grows each wave. Rare cyan vials heal 25 HP.

## What was downloaded and from where

All runtime assets are real downloaded files (no generated stand-ins shipped).
Full per-file table with authors and licenses: [`public/assets/CREDITS.md`](public/assets/CREDITS.md).

- **Monsters** — Quaternius *Ultimate Monsters* (CC0): Orc_Skull, Wizard, Demon
  (animated glTF, downloaded from the pack's Google Drive linked on
  quaternius.com).
- **Ruins / cover props** — Quaternius *Ultimate Modular Ruins* (CC0): arch,
  columns, barrel, crate, dead tree. The pack ships FBX only, converted to GLB
  with Facebook **FBX2glTF** during the build.
- **Flask & torches** — Quaternius *Fantasy Props MegaKit* free Standard
  version (Potion_1, Torch_Metal, CC0, native glTF; trim textures downscaled
  2048→1024). The crossbow viewmodel is fully procedural.
- **HDRI** — Poly Haven `dikhololo_night` 2k (CC0), via the public API.
- **PBR textures** — Poly Haven `cobblestone_floor_08` and `rock_wall_08`
  (diffuse / normal-GL / roughness / AO, 1k, CC0).
- **SFX** — Kenney *Impact Sounds*, *RPG Audio*, *UI Audio* (CC0). Pitch is
  randomized ±10% on every play.
- **Fonts** — Cinzel + MedievalSharp (SIL OFL), bundled locally.
- **Music/ambience** — none downloaded; generated at runtime with WebAudio
  (55 Hz drone, filtered wind, sparse low bell, low-HP heartbeat).

## Tuning knobs

Every gameplay number lives in [`src/config.js`](src/config.js) (`CONFIG`):
player movement and HP, both weapons, the three enemy archetypes, wave
composition, game-feel (hitstop, shake, sway/bob, muzzle flash), post stack
(bloom threshold/strength, exposure, grain, vignette), audio volumes.

## Architecture

```
src/main.js         bootstrap, post stack (bloom → grade → output), game loop, hitstop/shake
src/config.js       every tunable number
src/assets.js       manifest + loaders with progress
src/level.js        arena, PBR materials, gates, torches, fog, moon
src/player.js       pointer-lock controller, capsule-vs-AABB collision
src/weapons.js      viewmodels + procedural weapon motion, hitscan, tracers
src/projectiles.js  pooled hex orbs and caster bolts, shared ray/AABB helpers
src/enemies.js      enemy AI + animation state machines, dissolve death, waves, pickups
src/particles.js    one pooled additive point cloud for all effects
src/audio.js        decoded SFX + procedural ambience
src/ui.js           HUD, screens, banners (DOM)
```

## Known tradeoffs

- **No CC0 crossbow model exists in the Quaternius catalogue** (checked
  Medieval Weapons, Ultimate RPG, Fantasy Props MegaKit, Medieval Dungeon,
  Survival). Per the fallback policy the crossbow viewmodel is built
  procedurally from primitives: tapered stock, steel recurve lath, animated
  string (snaps on fire, re-draws on recock), loaded bolt, stirrup, trigger
  guard and gold inlays — tuned by screenshot iteration until it read as an
  ornate hand crossbow.
- Enemy hit detection uses analytic ray-vs-AABB body boxes (lower body /
  upper-body crit zone) instead of skinned-mesh raycasts — far cheaper and
  deterministic at 24 live enemies.
- Monster *geometries* are shared between instances by design (cloned via
  SkeletonUtils); per-instance materials, skeletons and mixers are disposed on
  death. `renderer.info` was verified stable across kills and restarts.
- Kenney packs have no monster voices: growls are `creak1–3.ogg` pitched down,
  which reads surprisingly well.
- Headless CI screenshots render via SwiftShader at ~1 fps; on a real GPU the
  scene is a single 60×60 arena with one shadow light, ≤24 skinned enemies,
  pooled particles/projectiles and capped pixel ratio (1.6) — built to hold
  60 fps on a mid laptop.
