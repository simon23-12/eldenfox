import {
  Vector3, Vector2, Color, InstancedMesh, Matrix4, Quaternion, Euler,
  IcosahedronGeometry, MeshStandardNodeMaterial, DodecahedronGeometry, BoxGeometry,
  CylinderGeometry, Group, MathUtils,
} from 'three/webgpu';
import { Terrain } from '../../gfx/Terrain.js';
import { Grass } from '../../gfx/Grass.js';
import { Ocean } from '../../gfx/Ocean.js';
import { VolumetricFog } from '../../gfx/VolumetricFog.js';
import { Clouds } from '../../gfx/Clouds.js';
import { ENEMY_TYPES } from '../Enemy.js';
import { makeFbm, Rng } from '../../core/Rng.js';
import { roughenSolid } from '../../gfx/Solids.js';

/**
 * Level 1 – Küste im Abendlicht.
 *
 * Eine Insel mit Sandsaum und Grasplateau. Der Spieler startet am Wasser mit
 * der Sonne im Rücken des Weges, arbeitet sich landeinwärts durch drei
 * Gegnergruppen und trifft am Ende auf den Gefallenen Ritter.
 */
export async function buildLevel1(engine, world, { quality = 1.0 } = {}) {
  const { scene, renderer, atmosphere, sky } = engine;
  const skip = engine.skip ?? new Set();

  /* ------------------------------ Abendsonne ------------------------------ */
  engine.setSun(8.5, 188);
  atmosphere.sunIntensity.value = 27;
  atmosphere.turbidity.value = 1.15;
  engine.pipeline.exposure.value = 0.44;

  /* ------------------------------ Gelände ------------------------------ */
  const terrain = new Terrain({ size: 620, res: 513, shape: shoreShape(11), seed: 11 });
  const terrainMesh = terrain.buildMesh({
    meshRes: quality >= 0.8 ? 448 : 288,
    atmosphere, sky,
  });
  scene.add(terrainMesh);
  world.terrain = terrain;

  /* ------------------------------ Meer ------------------------------ */
  // Der Ozean fährt pro Bild eine FFT über mehrere Compute-Stufen.
  let ocean = null;
  if (!skip.has('ocean')) {
    ocean = new Ocean({ atmosphere, sky, quality });
    await ocean.bake(renderer);
    ocean.windDir.value.set(0.32, 0.95).normalize();
    ocean.windSpeed.value = 10.5;
    ocean.amplitude.value = 0.9;
    scene.add(ocean.mesh);
    world.ocean = ocean;
  }
  world.seaLevel = 0;

  /* ------------------------------ Gras ------------------------------ */
  let grass = null;
  if (!skip.has('grass')) grass = new Grass({
    terrain, sky, atmosphere,
    density: quality, radius: 105,
    gridSize: quality >= 0.9 ? 768 : quality >= 0.7 ? 544 : 384,
  });
  if (grass) {
    grass.baseColor.value.setRGB(0.075, 0.130, 0.048);
    grass.tipColor.value.setRGB(0.395, 0.470, 0.175);
    grass.dryColor.value.setRGB(0.470, 0.410, 0.195);
    grass.windStrength.value = 0.85;
    grass.growLow.value = 2.2;
    grass.growHigh.value = 5.5;
    scene.add(grass.mesh);
    world.grass = grass;
  }

  /* ------------------------------ Wolken ------------------------------ */
  // Reihenfolge zählt: Wolken zuerst anmelden, dann Nebel. Der Nebel muss
  // *nach* den Wolken laufen, sonst legt sich der Dunst nicht über sie.
  let clouds = null;
  if (engine.settings.clouds) {
    clouds = new Clouds({
      atmosphere, sky,
      bottom: 1250, top: 2250,
      steps: quality >= 0.8 ? 56 : 36,
      lightSteps: quality >= 0.8 ? 6 : 4,
    });
    clouds.coverage.value = 0.62;
    clouds.densityScale.value = 0.42;
    clouds.shapeScale.value = 0.00062;
    clouds.detailStrength.value = 0.34;
    clouds.maxDistance.value = 20000;
    clouds.ambientTint.value.setRGB(0.55, 0.63, 0.82);
    await clouds.bake(renderer);
    clouds.attach(engine.pipeline, { resolutionScale: quality >= 0.8 ? 0.5 : 0.35 });
    world.clouds = clouds;
  }

  /* ------------------------------ Volumetrik ------------------------------ */
  let fog = null;
  if (engine.settings.volumetrics && grass) {
    fog = new VolumetricFog({
      atmosphere, sky,
      heightTexture: grass.heightTex,
      terrainSize: terrain.size,
      width: quality >= 0.8 ? 176 : 128,
      height: quality >= 0.8 ? 96 : 72,
      depth: quality >= 0.8 ? 64 : 48,
      range: 340,
    });
    // Optische Tiefe über die volle Reichweite soll rund 0.7 betragen –
    // sichtbarer Dunst, aber der Horizont bleibt lesbar. Bei einem Zehntel
    // mehr Dichte kippt der Blick in die Sonne sofort ins Weiße, weil die
    // Vorwärtsstreuung dann fast die volle Sonnenleuchtdichte erreicht.
    fog.density.value = 0.0021;
    fog.heightFalloff.value = 0.055;
    fog.fogBase.value = 0.0;
    fog.anisotropy.value = 0.56;
    fog.sunBoost.value = 0.55;
    fog.ambientBoost.value = 0.42;
    fog.fogColor.value.setRGB(0.58, 0.62, 0.70);
    fog.attach(engine.pipeline);
    world.fog = fog;
  }

  /* ------------------------------ Felsen und Ruinen ------------------------------ */
  const props = scatterProps(terrain, 1337, quality);
  for (const p of props) scene.add(p);
  world.props = props;

  /* ------------------------------ Gegner ------------------------------ */
  const spawns = [
    // Erste Begegnung: eine einzelne Wache, gut sichtbar
    { type: ENEMY_TYPES.wache, x: 6, z: 62, facing: Math.PI },
    // Zweite Gruppe: zwei Streuner von der Seite
    { type: ENEMY_TYPES.streuner, x: -22, z: 24, facing: Math.PI * 0.6 },
    { type: ENEMY_TYPES.streuner, x: -14, z: 12, facing: Math.PI * 0.7 },
    // Dritte: Wache plus Speer, zwingt zum Anvisieren
    { type: ENEMY_TYPES.wache, x: 24, z: -4, facing: -Math.PI * 0.4 },
    { type: ENEMY_TYPES.speer, x: 34, z: -18, facing: -Math.PI * 0.5 },
    // Vor dem Ritter noch zwei Wachen als Puffer
    { type: ENEMY_TYPES.wache, x: -6, z: -40, facing: 0 },
    { type: ENEMY_TYPES.streuner, x: 8, z: -46, facing: 0 },
  ];
  for (const s of spawns) world.spawnEnemy(s.type, s.x, s.z, { facing: s.facing });

  /* ------------------------------ Kleiner Boss ------------------------------ */
  const knight = world.spawnEnemy(ENEMY_TYPES.ritter, 0, -78, { facing: 0 });
  knight.isBoss = true;
  knight.healthBarName = 'Gefallener Ritter der Küste';
  knight.ai.sightRange = 26;
  knight.ai.leashRange = 40;
  world.miniBoss = knight;

  /* ------------------------------ Startpunkt ------------------------------ */
  // Nicht fest verdrahten: die Küstenlinie hängt am Rauschen, ein fester
  // Punkt landet je nach Seed im Wasser.
  const b = findBeachSpawn(terrain, Math.PI / 2, 1.3);
  const spawn = new Vector3(b.x, b.y, b.z);

  return {
    name: 'Küste im Abendlicht',
    spawn,
    ocean,
    grass,
    terrain,
    miniBoss: knight,
    /** Wird vom Spielablauf pro Frame aufgerufen. */
    fog,
    clouds,
    update(dt, eng) {
      // Figur ans Wasser melden, bevor es sich aktualisiert
      const sp = world.player;
      if (ocean && sp) {
        const tiefe = world.seaLevel - sp.position.y;
        const tempo = Math.hypot(sp.velocity.x, sp.velocity.z);
        ocean.setWakeSource(tiefe > 0 ? sp.position : null, tiefe, tempo);
      }
      ocean?.update(eng.renderer, dt, eng.camera);
      grass?.update(eng.renderer, eng.camera, world.player.position, dt);
      fog?.update(eng.renderer, eng.camera);
    },
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Inselform: breiter Sandstrand im Süden, Grasland, Felsrücken im Norden.
 *
 * Die Höhe folgt einem bewusst gesetzten Radialprofil statt reinem Rauschen.
 * Nur so entsteht ein Strand, der breit genug zum Kämpfen ist, und ein
 * Anstieg, der den Spieler von selbst landeinwärts führt.
 */
function shoreShape(seed) {
  const base = makeFbm(seed, 5, 2.03, 0.5);
  const ridge = makeFbm(seed + 71, 4, 2.09, 0.55);
  const fine = makeFbm(seed + 311, 3, 2.4, 0.5);
  const coast = makeFbm(seed + 907, 3, 2.2, 0.5);

  // Stützstellen: [Radius, Höhe]
  const PROFILE = [
    [0, 15.0],     // Hochland um die Ruine
    [45, 12.0],
    [80, 8.0],     // Grasland
    [118, 4.2],
    [142, 1.6],    // Strandkrone
    [163, 0.35],   // Wasserlinie
    [178, -2.2],   // Flachwasser
    [205, -7.0],
    [260, -13.0],  // Seegrund
  ];

  function profileAt(r) {
    if (r <= PROFILE[0][0]) return PROFILE[0][1];
    for (let i = 0; i < PROFILE.length - 1; i++) {
      const [r0, h0] = PROFILE[i], [r1, h1] = PROFILE[i + 1];
      if (r <= r1) {
        const t = (r - r0) / (r1 - r0);
        return h0 + (h1 - h0) * (t * t * (3 - 2 * t));
      }
    }
    return PROFILE[PROFILE.length - 1][1];
  }

  const CX = 0, CZ = -40;

  return function shape(x, z) {
    const dx = x - CX, dz = z - CZ;
    // Leicht elliptisch: die Insel zieht sich nach Norden
    const r = Math.hypot(dx * 1.06, dz * 0.94);

    // Küstenlinie ausfransen, damit der Saum nicht kreisrund wirkt
    const ang = Math.atan2(dz, dx);
    const wobble = coast(Math.cos(ang) * 2.4, Math.sin(ang) * 2.4) * 26;
    let h = profileAt(r - wobble);

    // Land bekommt Relief, Wasser bleibt ruhig
    const land = Math.max(0, Math.min(1, (h + 1.0) / 4.0));
    h += base(x * 0.0062, z * 0.0062) * 6.5 * land;

    const rg = 1 - Math.abs(ridge(x * 0.0088, z * 0.0088));
    h += rg * rg * 7.5 * land;

    // Felsrücken im Norden: natürliche Rückwand hinter dem Ritter
    const north = Math.max(0, Math.min(1, (-z - 95) / 75));
    h += north * north * 26;

    h += fine(x * 0.045, z * 0.045) * 0.55 * land;

    // Strandband zusätzlich glätten: dort soll man sauber kämpfen können
    const beach = Math.max(0, 1 - Math.abs(h - 1.1) / 2.6);
    h = h * (1 - beach * 0.45) + 1.1 * beach * 0.45;

    return h;
  };
}

/** Sucht vom offenen Wasser nach innen den ersten trockenen Strandpunkt. */
export function findBeachSpawn(terrain, angleRad = Math.PI / 2, minHeight = 1.1) {
  const CX = 0, CZ = -40;
  for (let r = 210; r > 60; r -= 1.5) {
    const x = CX + Math.cos(angleRad) * r;
    const z = CZ + Math.sin(angleRad) * r;
    if (terrain.heightAt(x, z) >= minHeight) {
      return { x, z, y: terrain.heightAt(x, z) };
    }
  }
  return { x: 0, z: 60, y: terrain.heightAt(0, 60) };
}

/** Streut Felsen, Findlinge und Ruinenreste über die Insel. */
function scatterProps(terrain, seed, quality) {
  const rng = new Rng(seed);
  const meshes = [];

  // Bewusst grob: die flachen Facetten der Grundkoerper machen den Felslook.
  // Feiner unterteilt naehert sich alles einer Kugel und wird mit der
  // Stauchung zur glatten Kuppe - ausprobiert, sah deutlich schlechter aus.
  const rockGeos = [
    new DodecahedronGeometry(1, 0),
    new IcosahedronGeometry(1, 0),
    new DodecahedronGeometry(1, 1),
  ];
  // Unregelmäßig verformen, damit es keine Würfelwelt wird. Die Auslenkung
  // haengt an der Position, nicht am Vertexindex – sonst reisst der Koerper
  // auf, siehe roughenSolid.
  rockGeos.forEach((g, i) => roughenSolid(g, {
    amount: 0.40, detail: 0.16, flatten: 0.74, seed: 7 + i * 13,
  }));

  const rockMat = new MeshStandardNodeMaterial({
    color: new Color(0.20, 0.195, 0.185), roughness: 0.92, metalness: 0.0,
  });
  rockMat.vertexColors = false;

  const counts = [Math.round(220 * quality), Math.round(160 * quality), Math.round(90 * quality)];
  const m4 = new Matrix4(), q = new Quaternion(), e = new Euler(), s = new Vector3();

  rockGeos.forEach((geo, gi) => {
    const inst = new InstancedMesh(geo, rockMat, counts[gi]);
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.name = `rocks${gi}`;
    let placed = 0, tries = 0;
    while (placed < counts[gi] && tries < counts[gi] * 40) {
      tries++;
      const [dx, dz] = rng.inDisc(230);
      const x = dx, z = dz - 30;
      const h = terrain.heightAt(x, z);
      if (h < 0.6 || h > 60) continue;
      const slope = terrain.slopeAt(x, z);
      // Felsen bevorzugt an Hängen und in Strandnähe
      const wantSlope = slope > 0.12 ? 1 : 0.25;
      if (rng.next() > wantSlope) continue;

      const scale = (0.35 + rng.next() * 1.7) * (gi === 2 ? 2.1 : 1);
      e.set(rng.float(-0.3, 0.3), rng.float(0, Math.PI * 2), rng.float(-0.3, 0.3));
      q.setFromEuler(e);
      s.set(scale * rng.float(0.8, 1.3), scale * rng.float(0.6, 1.1), scale * rng.float(0.8, 1.3));
      m4.compose(new Vector3(x, h - scale * 0.22, z), q, s);
      inst.setMatrixAt(placed, m4);
      placed++;
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = true;
    meshes.push(inst);
  });

  /* --- Ruinensäulen als Wegmarken zum Boss --- */
  const pillarGeo = new CylinderGeometry(0.55, 0.72, 6.5, 8, 1);
  const pillarMat = new MeshStandardNodeMaterial({
    color: new Color(0.30, 0.285, 0.255), roughness: 0.86, metalness: 0.0,
  });
  const pillars = new InstancedMesh(pillarGeo, pillarMat, 26);
  pillars.castShadow = true;
  pillars.receiveShadow = true;
  pillars.name = 'pillars';
  let n = 0;
  for (let i = 0; i < 13; i++) {
    const t = i / 12;
    const z = 84 - t * 168;
    for (const sx of [-9.5, 9.5]) {
      const x = sx + Math.sin(t * 5.2) * 3.2;
      const h = terrain.heightAt(x, z);
      if (h < 0.4) continue;
      const broken = rng.next() < 0.42;
      const height = broken ? rng.float(0.28, 0.62) : 1;
      e.set(rng.float(-0.05, 0.05), rng.float(0, Math.PI), rng.float(-0.05, 0.05));
      q.setFromEuler(e);
      s.set(1, height, 1);
      m4.compose(new Vector3(x, h + 3.25 * height - 0.4, z), q, s);
      pillars.setMatrixAt(n, m4);
      n++;
    }
  }
  pillars.count = n;
  pillars.instanceMatrix.needsUpdate = true;
  meshes.push(pillars);

  return meshes;
}
