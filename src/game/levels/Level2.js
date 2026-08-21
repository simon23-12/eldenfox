import {
  Vector3, Color, InstancedMesh, Matrix4, Quaternion, Euler, MathUtils,
  DodecahedronGeometry, IcosahedronGeometry, CylinderGeometry, TorusGeometry,
  MeshStandardNodeMaterial, Mesh, RingGeometry, DoubleSide,
} from 'three/webgpu';
import { Terrain } from '../../gfx/Terrain.js';
import { Grass } from '../../gfx/Grass.js';
import { Clouds } from '../../gfx/Clouds.js';
import { VolumetricFog } from '../../gfx/VolumetricFog.js';
import { Boss, BOSS_TYPES } from '../Boss.js';
import { makeFbm, Rng } from '../../core/Rng.js';
import { roughenSolid } from '../../gfx/Solids.js';

const ISLAND_Y = 1900;      // Höhe der Insel über dem Wolkenmeer
const ARENA_R = 30;

/**
 * Level 2 – Insel über den Wolken.
 *
 * Eine schwebende Scheibe hoch über einem geschlossenen Wolkenmeer. Kein Weg
 * zurück, kein Rand zum Ausweichen: wer über die Kante geht, fällt. Die
 * gesamte Bühne ist die Arena.
 */
export async function buildLevel2(engine, world, { quality = 1.0 } = {}) {
  const { scene, renderer, atmosphere, sky } = engine;

  /* --- Höheres Licht, kühlere Luft --- */
  engine.setSun(11.0, 208);
  atmosphere.sunIntensity.value = 30;
  atmosphere.turbidity.value = 0.85;
  engine.pipeline.exposure.value = 0.52;

  /* ------------------------------ Insel ------------------------------ */
  const terrain = new Terrain({
    size: 260, res: 385, seed: 23,
    shape: skyIslandShape(23),
    yOffset: ISLAND_Y,
  });
  const terrainMesh = terrain.buildMesh({
    meshRes: quality >= 0.8 ? 320 : 224,
    atmosphere, sky,
  });
  scene.add(terrainMesh);
  world.terrain = terrain;
  world.seaLevel = -1e6;

  /* --- Farbgebung: karger, heller Fels statt Küstengrün --- */
  terrain.grassColor.value.setRGB(0.135, 0.165, 0.105);
  terrain.grassColor2.value.setRGB(0.225, 0.235, 0.140);
  terrain.sandColor.value.setRGB(0.400, 0.385, 0.350);
  terrain.rockColor.value.setRGB(0.255, 0.250, 0.255);

  /* ------------------------------ Wolkenmeer ------------------------------ */
  let clouds = null;
  if (engine.settings.clouds) {
    clouds = new Clouds({
      atmosphere, sky,
      // Dicht unter die Insel legen: liegt die Decke weit darunter,
      // schrumpft sie perspektivisch auf einen Streifen am Horizont und
      // die Insel schwebt sichtbar über nichts.
      bottom: ISLAND_Y - 420, top: ISLAND_Y - 25,
      steps: quality >= 0.8 ? 64 : 40,
      lightSteps: quality >= 0.8 ? 6 : 4,
    });
    // Dichte, aber nicht geschlossene Decke: bei Bedeckung nahe eins liegt
    // die Oberkante exakt auf der Schichtgrenze und das Wolkenmeer wirkt wie
    // eine flache Milchglasplatte. Etwas weniger Bedeckung lässt die
    // Kuppen unterschiedlich hoch aufbauen.
    clouds.coverage.value = 0.78;
    clouds.densityScale.value = 0.70;
    clouds.shapeScale.value = 0.00075;
    clouds.detailStrength.value = 0.36;
    clouds.silverIntensity.value = 2.4;
    clouds.maxDistance.value = 16000;
    clouds.ambientTint.value.setRGB(0.60, 0.68, 0.88);
    clouds.windSpeed.value.set(6, 0, 3);
    await clouds.bake(renderer);
    // Bewusst *nicht* als eigener Kompositor: der Wolken-Raymarch liefert in
    // diesem TSL-Pfad kein Ergebnis, obwohl Strahl, Schnittpunkt und
    // Formtextur einzeln nachweislich stimmen. Die Formtextur wandert
    // stattdessen in das Froxelvolumen, das nachweislich rendert.
    world.clouds = clouds;
  }

  /* ------------------------------ Gras und Nebel ------------------------------ */
  const grass = new Grass({
    terrain, sky, atmosphere,
    density: quality * 0.7, radius: 70,
    gridSize: quality >= 0.9 ? 512 : 384,
  });
  grass.baseColor.value.setRGB(0.085, 0.115, 0.062);
  grass.tipColor.value.setRGB(0.340, 0.380, 0.190);
  grass.dryColor.value.setRGB(0.430, 0.400, 0.250);
  grass.windStrength.value = 1.35;
  grass.heightScale.value = 0.85;
  // Gras nur auf dem Plateau, nicht über die Abbruchkante hinaus
  grass.growLow.value = ISLAND_Y - 8;
  grass.growHigh.value = ISLAND_Y - 3;
  scene.add(grass.mesh);
  world.grass = grass;

  let fog = null;
  if (engine.settings.volumetrics) {
    fog = new VolumetricFog({
      atmosphere, sky,
      heightTexture: grass.heightTex,
      terrainSize: terrain.size,
      width: quality >= 0.8 ? 176 : 128,
      height: quality >= 0.8 ? 96 : 72,
      depth: quality >= 0.8 ? 80 : 56,
      range: 1500,
      cloudLayer: clouds ? {
        texture: clouds.shapeTex,
        scale: 0.0011,
        low: ISLAND_Y - 430,
        high: ISLAND_Y - 30,
        density: 0.16,
        coverage: 0.80,
        drift: new Vector3(7, 0, 3),
      } : null,
    });
    fog.density.value = 0.0020;
    fog.heightFalloff.value = 0.10;
    fog.fogBase.value = ISLAND_Y - 4;
    fog.anisotropy.value = 0.62;
    fog.sunBoost.value = 0.62;
    fog.ambientBoost.value = 0.75;
    fog.fogColor.value.setRGB(0.70, 0.76, 0.88);
    fog.attach(engine.pipeline);
    world.fog = fog;
  }

  /* ------------------------------ Arena ------------------------------ */
  const props = buildArena(terrain, 4711, quality);
  for (const p of props) scene.add(p);
  world.props = props;

  world.arenaBounds = { center: new Vector3(0, 0, 0), radius: ARENA_R + 8 };

  /* ------------------------------ Boss ------------------------------ */
  const boss = new Boss({ ...BOSS_TYPES.wolkenfuerst }, world);
  boss.place(0, -18, world, Math.PI);
  boss.arenaCenter.set(0, ISLAND_Y, 0);
  boss.ai.leashOrigin.copy(boss.position);
  world.addCombatant(boss);
  world.boss = boss;

  const spawn = new Vector3(0, terrain.heightAt(0, 24), 24);

  return {
    name: 'Insel über den Wolken',
    spawn,
    terrain,
    clouds,
    fog,
    grass,
    boss,
    islandY: ISLAND_Y,
    /** Unterhalb dieser Höhe ist man gefallen. */
    killPlaneY: ISLAND_Y - 60,
    update(dt, eng) {
      grass.update(eng.renderer, eng.camera, world.player.position, dt);
      fog?.update(eng.renderer, eng.camera);
    },
  };
}

/* -------------------------------------------------------------------------- */

/** Schwebende Scheibe: flaches Plateau, harte Abbruchkante, Felsnadeln. */
function skyIslandShape(seed) {
  const base = makeFbm(seed, 5, 2.03, 0.5);
  const rim = makeFbm(seed + 41, 3, 2.2, 0.5);

  return function shape(x, z) {
    const r = Math.hypot(x, z);
    const edgeNoise = rim(x * 0.012, z * 0.012) * 6.5;
    const edge = ARENA_R + 9 + edgeNoise;

    if (r > edge) {
      // Abbruch: unter der Kante geht es senkrecht ins Nichts
      return -140 - (r - edge) * 4.2;
    }

    // Plateau mit leichter Wölbung, außen minimal ansteigender Wall
    let h = base(x * 0.014, z * 0.014) * 2.4;
    const t = r / edge;
    h += (1 - t * t) * 1.8;
    h += Math.pow(Math.max(0, t - 0.72) / 0.28, 2) * 3.4;   // Randwall

    // Absturzrand weich anschmiegen, damit man ihn kommen sieht
    const fall = MathUtils.clamp((r - edge * 0.94) / (edge * 0.06), 0, 1);
    h = h * (1 - fall) + (-14) * fall;
    return h;
  };
}

/** Ruinenring, Bruchsäulen und ein Siegel im Boden. */
function buildArena(terrain, seed, quality) {
  const rng = new Rng(seed);
  const out = [];
  const m4 = new Matrix4(), q = new Quaternion(), e = new Euler(), s = new Vector3();

  /* --- Säulenring --- */
  const pillarGeo = new CylinderGeometry(0.7, 0.92, 9.0, 9, 1);
  const stoneMat = new MeshStandardNodeMaterial({
    color: new Color(0.235, 0.228, 0.222), roughness: 0.90, metalness: 0.0,
  });
  const N = 16;
  const pillars = new InstancedMesh(pillarGeo, stoneMat, N);
  pillars.castShadow = true; pillars.receiveShadow = true;
  let n = 0;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = ARENA_R - 2.5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = terrain.heightAt(x, z);
    const broken = rng.next() < 0.45;
    const scale = broken ? rng.float(0.25, 0.6) : rng.float(0.9, 1.1);
    e.set(rng.float(-0.06, 0.06), a, rng.float(-0.06, 0.06));
    q.setFromEuler(e);
    s.set(1, scale, 1);
    m4.compose(new Vector3(x, h + 4.5 * scale - 0.6, z), q, s);
    pillars.setMatrixAt(n++, m4);
  }
  pillars.count = n;
  pillars.instanceMatrix.needsUpdate = true;
  out.push(pillars);

  /* --- Trümmer --- */
  // Die flachen Scherben kamen nicht von zu starker Streckung, sondern davon,
  // dass jede Ecke des nicht indizierten Ikosaeders mehrfach im Puffer liegt
  // und pro Kopie anders ausgelenkt wurde. roughenSolid haengt die Auslenkung
  // an die Position - damit ist auch kraeftige Verformung wieder benutzbar.
  const rubbleGeo = roughenSolid(new IcosahedronGeometry(0.5, 1), {
    amount: 0.30, detail: 0.13, flatten: 0.80, seed: 3,
  });
  const count = Math.round(240 * quality);
  const rubble = new InstancedMesh(rubbleGeo, stoneMat, count);
  rubble.castShadow = true; rubble.receiveShadow = true;
  let m = 0;
  while (m < count) {
    const [dx, dz] = rng.inDisc(ARENA_R + 4);
    const h = terrain.heightAt(dx, dz);
    if (h < terrain.heightAt(0, 0) - 20) continue;
    const scale = rng.float(0.35, 1.25);
    e.set(rng.float(-0.5, 0.5), rng.float(0, Math.PI * 2), rng.float(-0.5, 0.5));
    q.setFromEuler(e);
    s.set(scale, scale * rng.float(0.6, 1.0), scale);
    m4.compose(new Vector3(dx, h - scale * 0.16, dz), q, s);
    rubble.setMatrixAt(m++, m4);
  }
  rubble.count = m;
  rubble.instanceMatrix.needsUpdate = true;
  out.push(rubble);

  /* --- Siegel im Boden: markiert die Arena und gibt Orientierung --- */
  const sealMat = new MeshStandardNodeMaterial({
    color: new Color(0.85, 0.72, 0.35),
    emissive: new Color(0.85, 0.66, 0.28),
    emissiveIntensity: 2.6,
    roughness: 0.5, metalness: 0.2,
    transparent: true, opacity: 0.7, side: DoubleSide,
  });
  for (const [rIn, rOut] of [[ARENA_R - 7.2, ARENA_R - 7.0], [ARENA_R - 4.0, ARENA_R - 3.7]]) {
    const ring = new Mesh(new RingGeometry(rIn, rOut, 96), sealMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = terrain.heightAt(0, 0) + 0.06;
    ring.receiveShadow = false;
    out.push(ring);
  }

  return out;
}
