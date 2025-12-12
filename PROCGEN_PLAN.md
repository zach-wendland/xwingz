# Procedural Generation Requirements Plan (Reference)

This document captures the procedural-generation ("autogeneration") principles inspired by *No Man's Sky* and their application to a Star-Wars-scale open-galaxy RPG. It is saved from the design discussion for ongoing reference.

## 1. No Man's Sky Autogeneration Engine - Key Mechanics

**Deterministic universe from a single seed.**  
All content is a pure function of `(globalSeed, coordinates, biome/archetype ids, ...)`. Worlds are not stored; they are regenerated on demand so different players at the same location see the same reality.

**Hierarchical layers (macro -> micro).**
1. Galaxy layer: star distribution, rarity fields, galactic arms.
2. System layer: planets, economy, faction context.
3. Planet layer: biome/atmosphere/hazards, palette, terrain seed.
4. Region/tile layer: terrain chunks, resources, POI density maps.
5. Entity layer: flora/fauna/NPC equivalents, structures, loot, missions.

Each layer derives child seeds from parent seeds, exploding variety while preserving reproducibility.

**Curated archetypes + parameters + constraints.**  
Variety comes from finite libraries of templates (biomes, creatures, structures) plus parameter ranges (size, color, density, stats) gated by rules that forbid incoherent combos.

**Noise fields as the backbone.**  
Layered fractal noise drives terrain, climate, resources, flora/fauna density, and POI interest maps.

**Grammar/graph composition.**  
Structures and creatures are assembled from modular kits by connection rules (room graphs, prop slots, body plans).

**Streaming + LOD are core.**  
Chunks generate and render near the player; distant content uses impostors/low LOD.

**Progression-aware rarity gradients.**  
Rarity and danger are shaped so "exotic" things are far/rare, high value hides in high risk, and story state unlocks new layers without breaking determinism.

**Lesson:** breadth without systemic depth feels repetitive. Procedural layers must feed deep gameplay systems.

## 2. Principles to Apply
1. Determinism by coordinate hashing.
2. Layer ownership: each generation layer decides a clear "why."
3. Archetypes preserve identity; parameters create scale; constraints ensure coherence.
4. Interest maps for logical placement, not random scatter.
5. Progression-aware generation to avoid stagnation.
6. Tooling is part of the engine (seed inspectors, heatmaps, previewers).

## 3. Star-Wars-Scale Application

### 3.1 Galaxy Layer (Sectors, Eras, Factions)
**Sector archetypes:** Core metropolises, frontier Outer Rim, Hutt space, war-scarred Separatist remnants, Old Republic ruin zones, etc.  
**Echo/Era field:** per-sector scalar/categorical mix (Old Republic / Clone Wars / Empire / New Republic / First Order) that justifies KOTOR + films + Clone Wars content coexisting via "hyperspace echo intensity."

**Deterministic:** `sectorSeed = hash(globalSeed, sectorCoord)`

### 3.2 System Layer
**System archetypes:** smugglers' hubs, Jedi-haunted dead systems, corporate mining clusters, Republic patrol lanes, Sith cult worlds, pirate nebulae, etc.

**Deterministic:** `systemSeed = hash(sectorSeed, systemCoord)`

System decides star class, orbital graph, economy, patrol/raid rates, and story anchor probability.

### 3.3 Planet Layer
**Planet archetypes:** lush Core worlds, desert scavenger worlds, frozen relic worlds, toxic industrial moons, oceanic routes, Force-scarred anomaly planets.

**Deterministic:** `planetSeed = hash(systemSeed, orbitIndex)`

Planet chooses biome set, hazards, palette, and special-site slots (temples, wrecks, kyber seams, battlefields).

### 3.4 Region/Terrain Layer
Cube-sphere quadtree streaming; tiles generate mesh LODs, climate masks, resources, and POI interest maps.

**Deterministic:** `tileSeed = hash(planetSeed, tileCoord)`

### 3.5 Places / POIs
Faction/era kits (Republic outposts, Imperial checkpoints, Hutt palaces, Mandalorian forges, Sith tombs, Jedi enclaves, Separatist foundries, pirate scrapyards) assembled by grammar rules into room graphs and prop/loot slots.

**Deterministic:** `poiSeed = hash(tileSeed, poiIndex, archetypeId)`

Placement uses interest maps + lore constraints.

### 3.6 NPC Generation
**Role & faction first:** trader, bounty hunter, pirate, Jedi remnant, Sith acolyte, clone deserter, slicer, mechanic, noble, cultist, refugee, mercenary, etc.  
**Species archetype slots:** silhouette, armor kits, voice banks, syllable grammar, behavior bias.  
**Parametric variation:** morphology, cybernetics, gear, personality vectors, backstory hooks tied to local events.

**Deterministic:** `npcSeed = hash(poiSeed/tileSeed, npcIndex, speciesId, roleId)`

Behavior weights derive from personality + faction hostility + economy pressure.

### 3.7 Items & Loot
Blueprint + affixes + visual kit model.  
Archetypes: blasters, vibro-melee + rare lightsabers, armor by faction/era, ship modules, artifacts (holocrons, Sith relics, beskar, clone-war tech, imperial codes).

**Deterministic:** `itemSeed = hash(containerSeed, itemIndex, archetypeId)`

Rarity ties to echo intensity, danger, and progression.

### 3.8 Missions & Narrative
Procedural templates (bounty, escort, salvage, smuggle, sabotage, relic recovery, diplomacy, defense, Jedi/Sith trials) filled with local context, plus authored story anchors that query procedural worlds. New story layers unlock over time without breaking determinism.

**Deterministic:** `missionSeed = hash(systemSeed, slotId, templateId)`

## 4. Engine-Level Requirements
- Stable cross-platform hash/seed stack library.
- Content databases for archetypes, constraints, rarity curves, grammars, voice/language kits, affix rules.
- Tooling: galaxy viewer, constraint-based seed searcher, POI grammar visualizer, NPC/loot previewers.
- Validation: determinism, distribution, lore-constraint, and replay tests.
- Performance: tile budgets, instancing, impostors, worker-thread generation.

## 5. Player-Expectation Guardrail
Procedural content must feel meaningful, not random: Star-Wars-authentic places, people, conflicts, and loot supported by systemic depth and authored anchors.

