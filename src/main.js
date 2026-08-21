import { Engine } from './core/Engine.js';
import { World } from './game/World.js';
import { Player } from './game/Player.js';
import { CameraRig } from './game/CameraRig.js';
import { Hud, characterSelect } from './ui/Hud.js';
import { buildLevel1 } from './game/levels/Level1.js';
import { buildLevel2 } from './game/levels/Level2.js';
import { QUALITY } from './gfx/Pipeline.js';
import { Audio } from './audio/Audio.js';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

// Zum Nachmessen und Abstimmen aus der Konsole
window.__W = THREE;
window.__T = TSL;

const bootbar = document.getElementById('bootbar');
const bootmsg = document.getElementById('bootmsg');
const booterr = document.getElementById('booterr');

function progress(p, msg) {
  bootbar.style.width = `${Math.round(p * 100)}%`;
  if (msg) bootmsg.textContent = msg;
}

/**
 * Gibt den Hauptfaden frei, bis der Browser wirklich gezeichnet hat.
 *
 * `await` auf eine bereits erfüllte Promise reicht nicht: Mikrotasks laufen
 * noch vor dem Zeichnen. Ohne diesen Umweg bleibt das zuletzt gezeichnete Bild
 * stehen, während der Ladepfad den Faden minutenlang blockiert – die Seite
 * sieht dann eingefroren aus, obwohl sie arbeitet.
 */
function nextPaint() {
  // Im Hintergrundtab feuert rAF nicht. Ohne den Zeitgeber als Ausweg bliebe
  // der Ladepfad dort für immer stehen.
  return new Promise((r) => {
    let done = false;
    const fin = () => { if (!done) { done = true; r(); } };
    requestAnimationFrame(() => requestAnimationFrame(fin));
    setTimeout(fin, 120);
  });
}

/** Grobe Voreinstellung anhand der Bildschirmfläche. */
function guessQuality() {
  const stored = localStorage.getItem('eldenfox.quality');
  if (stored && QUALITY[stored]) return stored;
  const px = (innerWidth * innerHeight) * Math.min(devicePixelRatio || 1, 2) ** 2;
  // Vorher gab es nur 'high' und 'ultra'. Auf sehr großen Flächen reichte das
  // nicht: die Bilder wurden so teuer, dass der Treiber zurückgesetzt hat.
  // Die Schwellen sind so gelegt, dass verbreitete Auflösungen bleiben, wo sie
  // waren: 1920×1080 bei doppelter Pixeldichte sind 8.3e6 und damit weiter
  // 'high'. Erst darüber – 4K, große Retina-Flächen – wird abgestuft.
  if (px > 16e6) return 'low';
  if (px > 10e6) return 'medium';
  return px > 4.2e6 ? 'high' : 'ultra';
}

async function boot() {
  const canvas = document.getElementById('stage');
  const qualityName = guessQuality();
  const engine = new Engine(canvas, { quality: qualityName });
  window.__engine = engine;

  await engine.init(progress);

  // Software-Rasterizer: WebGPU meldet sich normal, aber gerechnet wird auf
  // der CPU. Das Spiel ist dann unspielbar langsam und frisst Arbeitsspeicher,
  // bis das Gerät wegbricht. Lieber einmal klar sagen, was los ist.
  if (engine.gpuInfo.isSoftware) {
    warnSoftwareRendering(engine.gpuInfo.adapterName);
  }

  const hud = new Hud();
  const world = new World(engine);
  engine.world = world;
  window.__world = world;

  const audio = new Audio();
  world.audio = audio;
  audio.menuStart();                // Titelmusik ab dem Bootscreen

  progress(0.62, 'Wähle deinen Fuchs…');
  const choice = await characterSelect();
  audio.menuStop(2.2);              // blendet über in die Kulisse
  audio.unlock();

  const qScale = { ultra: 1.0, high: 0.85, medium: 0.65, low: 0.45 }[qualityName] ?? 1;

  // ?level=2 springt direkt in die Bossarena – zum Abstimmen des zweiten
  // Abschnitts, ohne jedes Mal die Küste durchspielen zu müssen.
  const startStage = new URLSearchParams(location.search).get('level') === '2' ? 2 : 1;

  progress(0.68, startStage === 2 ? 'Insel heben…' : 'Küste formen…');
  await nextPaint();          // Ladebalken sichtbar machen, bevor der Faden blockiert
  let level = startStage === 2
    ? await buildLevel2(engine, world, { quality: qScale })
    : await buildLevel1(engine, world, { quality: qScale });
  world.level = level;

  progress(0.84, `${choice.name} erwacht…`);
  await nextPaint();
  const player = new Player({ ...choice, faction: 'player' }, world);
  player.position.copy(level.spawn);
  player.facing = 0;                // Eröffnungsblick auf die Abendsee
  player.targetFacing = player.facing;
  world.player = player;
  world.addCombatant(player);
  hud.setCharacter(choice);

  const cam = new CameraRig(engine.camera, world);
  cam.yaw = Math.PI;
  engine.cameraRig = cam;

  player.onHit = (dmg, blocked) => {
    audio.hit(blocked);
    cam.addShake(blocked ? 0.15 : 0.4);
  };
  world.onEnemyDeath = (c) => {
    audio.death();
    hud.message(`${c.runeReward} Runen`, 1.4);
  };

  progress(0.92, 'Renderpfad übersetzen…');
  await nextPaint();
  engine.buildPipeline();

  // Die Shader des ersten Bildes übersetzt der Treiber sonst mitten im ersten
  // renderSync() – auf langsameren GPUs steht der Faden dabei sehr lange still.
  // compileAsync() zieht das vor und lässt den Browser zwischendurch zeichnen.
  progress(0.96, 'Shader übersetzen…');
  await nextPaint();
  try {
    await engine.renderer.compileAsync(engine.scene, engine.camera);
  } catch (err) {
    console.warn('compileAsync übersprungen:', err);
  }

  /* ------------------------------------------------------------------ Ablauf */

  const game = {
    phase: 'play',
    stage: startStage,
    timer: 0,
    bossEngaged: false,
    checkpoint: level.spawn.clone(),

    update(dt, eng) {
      const input = eng.input;

      switch (game.phase) {
        case 'play':
          player.control(input, cam, dt);
          world.update(dt);
          level.update(dt, eng);
          game._watchBoss(eng);
          game._watchFall(eng);
          if (player.dead) { game.phase = 'dying'; game.timer = 0; }
          break;

        case 'dying':
          world.update(dt);
          level.update(dt, eng);
          game.timer += dt;
          eng.pipeline.deathFade.value = Math.min(1, game.timer / 2.0);
          eng.timeScale = Math.max(0.3, 1 - game.timer * 0.4);
          if (game.timer > 1.3) hud.showDeath();
          if (game.timer > 4.2) game._respawn(eng);
          break;

        case 'transition':
          world.update(dt);
          level.update(dt, eng);
          game.timer += dt;
          eng.pipeline.deathFade.value = Math.min(1, game.timer / 1.8);
          if (game.timer > 2.4) game._enterLevel2(eng);
          break;

        case 'loading':
          break;

        case 'won':
          world.update(dt);
          level.update(dt, eng);
          game.timer += dt;
          eng.timeScale = Math.max(0.35, 1 - game.timer * 0.3);
          break;

        default:
          break;
      }

      cam.update(dt, player, input);
      hud.update(player, dt);
      hud.updateBoss(dt);

      const flash = eng.pipeline.hitFlash;
      flash.value = Math.max(0, flash.value - dt * 3.2);
      if (player.flash > 0.9) flash.value = Math.min(0.85, player.flash * 0.7);

      // Schärfentiefe auf das anvisierte Ziel legen
      const focusTarget = player.lockTarget
        ? player.position.distanceTo(player.lockTarget.position)
        : cam.distance + 5.0;
      const dof = eng.pipeline.dofFocus;
      dof.value += (focusTarget - dof.value) * Math.min(1, dt * 3.0);

      audio.update(dt, player, world);

      if (eng.frame % 12 === 0) {
        hud.perf(`${eng.fps.toFixed(0)} fps · ${eng.viewport.width}×${eng.viewport.height}\n`
          + `${eng.qualityName} · ${world.combatants.length} Figuren · ${player.runes} Runen`);
      }
    },

    /* --------------------------- Bossleiste --------------------------- */
    _watchBoss(eng) {
      const b = world.boss ?? world.miniBoss;
      if (!b) return;
      if (!game.bossEngaged && !b.dead && b.target === player) {
        game.bossEngaged = true;
        hud.setBoss(b);
        hud.message(b.healthBarName, 3.2);
        audio.bossStart();
        if (b.onPhaseChange === null || b.onPhaseChange === undefined) {
          b.onPhaseChange = () => {
            hud.message('Der Fürst erhebt sich', 2.6);
            audio.bossPhase();
          };
        }
      }
      if (game.bossEngaged && b.dead) {
        game.bossEngaged = false;
        hud.setBoss(null);
        if (game.stage === 1) {
          hud.message('Große Feindseligkeit besiegt', 3.0);
          game.phase = 'transition';
          game.timer = 0;
        } else {
          hud.message('', 0.1);
          hud.showVictory(`${player.def.name} hat den Fürsten über den Wolken bezwungen.`);
          game.phase = 'won';
          game.timer = 0;
          audio.victory();
        }
      }
    },

    /* --------------------------- Absturz --------------------------- */
    _watchFall() {
      if (level.killPlaneY === undefined || player.dead) return;
      if (player.position.y < level.killPlaneY) {
        player.hp = 0;
        player.die({ from: player.position });
      }
    },

    /* --------------------------- Tod --------------------------- */
    _respawn(eng) {
      hud.hideDeath();
      eng.pipeline.deathFade.value = 0;
      eng.timeScale = 1;
      player.hp = player.maxHp;
      player.stamina = player.st.maxStamina;
      player.fp = player.st.maxFp;
      player.flasks = player.maxFlasks;
      player.dead = false;
      player.velocity.set(0, 0, 0);
      player.position.copy(game.checkpoint);
      player.setState('idle', null);
      player.anim.play(player.anim.current, { fade: 0, restart: true });
      player.lockTarget = null;
      // Runen bleiben: Souls würde sie fallen lassen, hier wäre das nur zäh
      for (const c of world.combatants) {
        if (c === player || c.dead) continue;
        c.hp = c.maxHp;
        c.target = null;
        c.position.copy(c.ai.leashOrigin);
        c.ai.mode = 'idle';
      }
      const b = world.boss ?? world.miniBoss;
      if (b && b.dead === false) {
        b.hp = b.maxHp;
        b.phase = 1;
        if (b.currentPattern !== undefined) b.currentPattern = null;
      }
      game.bossEngaged = false;
      hud.setBoss(null);
      game.phase = 'play';
    },

    /* --------------------------- Abschnittswechsel --------------------------- */
    async _enterLevel2(eng) {
      game.phase = 'loading';
      hud.message('Aufstieg…', 2.0);

      world.clearLevel();
      // Kompositoren gehören zum alten Abschnitt und müssen neu gebaut werden
      eng.pipeline.compositors.length = 0;

      level = await buildLevel2(eng, world, { quality: qScale });
      world.level = level;
      eng.buildPipeline();

      player.position.copy(level.spawn);
      player.velocity.set(0, 0, 0);
      player.hp = player.maxHp;
      player.stamina = player.st.maxStamina;
      player.fp = player.st.maxFp;
      player.flasks = player.maxFlasks;
      player.lockTarget = null;
      player.facing = Math.PI;
      player.targetFacing = Math.PI;
      cam.yaw = 0;
      cam.pitch = -0.05;

      game.checkpoint = level.spawn.clone();
      game.stage = 2;
      game.timer = 0;
      eng.pipeline.deathFade.value = 0;
      eng.timeScale = 1;
      hud.message('Insel über den Wolken', 3.4);
      audio.levelTwo();
      game.phase = 'play';
    },
  };

  engine.add(game);
  window.__game = game;

  /* ---------------- Zusätzliche Tasten ---------------- */
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyP') {
      engine.paused = !engine.paused;
      hud.message(engine.paused ? 'Pause' : '', 1.2);
    }
    if (e.code === 'KeyO') {
      const order = ['low', 'medium', 'high', 'ultra'];
      const next = order[(order.indexOf(engine.qualityName) + 1) % order.length];
      engine.qualityName = next;
      localStorage.setItem('eldenfox.quality', next);
      engine.viewport.setScale(QUALITY[next].renderScale, QUALITY[next].maxPixelScale ?? Infinity);
      engine.rebuild(QUALITY[next]);
      hud.message(`Grafik: ${next}`, 1.6);
    }
  });

  watchDeviceLoss(engine, hud);

  progress(1, 'Bereit');
  document.getElementById('boot').classList.add('hidden');
  hud.show();
  hud.message(level.name, 3.0);

  canvas.addEventListener('click', () => {
    canvas.requestPointerLock?.();
    audio.unlock();
  });
  engine.start();
}

/**
 * Weist auf einen Software-Rasterizer hin und schaltet auf die unterste Stufe.
 *
 * Das Spiel läuft danach weiter – abbrechen wäre bevormundend –, aber der
 * Grund für ruckelnde Bilder und volllaufenden Arbeitsspeicher steht dann auf
 * dem Schirm statt nur in der Konsole.
 */
function warnSoftwareRendering(name) {
  console.warn('WebGPU läuft auf einem Software-Rasterizer:', name || '(unbekannt)');
  localStorage.setItem('eldenfox.quality', 'low');
  booterr.textContent =
    'Achtung: WebGPU rechnet hier auf der CPU'
    + (name ? ` (${name})` : '')
    + ', nicht auf der Grafikkarte.\n\n'
    + 'Das Spiel läuft dadurch sehr langsam und belegt viel Arbeitsspeicher. '
    + 'Prüfe chrome://gpu – unter "Graphics Feature Status" sollte WebGPU auf '
    + '"Hardware accelerated" stehen. Hilft oft: Hardwarebeschleunigung in den '
    + 'Chrome-Einstellungen aktivieren, Grafiktreiber aktualisieren, oder Chrome '
    + 'in den Windows-Grafikeinstellungen auf "Hohe Leistung" setzen.';
}

/**
 * Ein verlorenes WebGPU-Gerät blieb bisher unsichtbar: die Schleife tickt
 * weiter und meldet muntere Bildraten, aber jedes Bild geht ins Leere – auf
 * dem Schirm bleibt es schwarz. Das ist der Zustand, den ein Treiberreset
 * (etwa nach einem zu teuren Bild) hinterlässt.
 *
 * Statt schwarz zu bleiben: Schleife anhalten, sagen was los ist, und die
 * nächste Sitzung eine Stufe niedriger starten lassen.
 */
function watchDeviceLoss(engine, hud) {
  const device = engine.renderer?.backend?.device;
  if (!device?.lost) return;

  device.lost.then((info) => {
    // `destroy()` löst dieselbe Promise aus – das ist kein Fehlerfall.
    if (info.reason === 'destroyed') return;
    console.error('WebGPU-Gerät verloren:', info.reason, info.message);
    engine.stop();
    hud.hide();

    // Eine Stufe zurück, damit der nächste Start leichter ausfällt.
    const order = ['low', 'medium', 'high', 'ultra'];
    const lower = order[Math.max(0, order.indexOf(engine.qualityName) - 1)];
    localStorage.setItem('eldenfox.quality', lower);

    // Welche GPU es getroffen hat, gehört in die Meldung: bei zwei Grafik-
    // karten im Rechner greift Chrome unter Windows gern zur integrierten,
    // weil `powerPreference` dort ignoriert wird (crbug 369219127).
    const gpu = engine.gpuInfo?.adapterName ?? '';

    const boot = document.getElementById('boot');
    boot.classList.remove('hidden');
    bootbar.style.width = '100%';
    bootmsg.textContent = 'Grafikgerät verloren';
    booterr.textContent =
      'Der Grafiktreiber hat die Verbindung abgebrochen – meist, weil ein Bild '
      + 'zu lange gebraucht hat.\n\n'
      + (gpu ? `Grafikkarte: ${gpu}\n` : '')
      + `Auflösung: ${engine.viewport.width}×${engine.viewport.height} `
      + `(Stufe "${engine.qualityName}")\n\n`
      + `Die Qualität steht jetzt auf "${lower}". Lade die Seite neu, um mit `
      + 'dieser Stufe weiterzuspielen. Mit der Taste O lässt sie sich im Spiel '
      + 'jederzeit umschalten.';
  });
}

boot().catch((e) => {
  console.error(e);
  booterr.textContent = `${e?.message ?? e}\n\n${(e?.stack ?? '').split('\n').slice(1, 4).join('\n')}`;
  bootmsg.textContent = 'Start fehlgeschlagen';
});
