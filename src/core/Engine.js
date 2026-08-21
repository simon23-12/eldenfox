import { Scene, PerspectiveCamera, Timer, DirectionalLight, Vector3, Color } from 'three/webgpu';
import { createRenderer, Viewport } from '../gfx/Renderer.js';
import { Atmosphere } from '../gfx/Atmosphere.js';
import { Sky } from '../gfx/Sky.js';
import { Pipeline, QUALITY } from '../gfx/Pipeline.js';
import { Input } from './Input.js';

/**
 * Bündelt Renderer, Szene, Kamera, Atmosphäre und Postpfad und treibt
 * die Aktualisierungsschleife. Spielsysteme melden sich über `add()` an.
 */
export class Engine {
  constructor(canvas, { quality = 'ultra', reversedDepth = true, bypassPost = false, skip = null } = {}) {
    this.reversedDepth = reversedDepth;
    /** Wenn gesetzt, wird die Postkette weder gebaut noch benutzt. */
    this.bypassPost = bypassPost;
    /** Namen abgeschalteter Teilsysteme, siehe ?skip= in main.js. */
    this.skip = skip instanceof Set ? skip : new Set(skip ?? []);
    this.canvas = canvas;
    this.qualityName = quality;
    this.settings = { ...QUALITY[quality] };
    this.systems = [];
    this.timer = new Timer();
    this.frame = 0;
    this.time = 0;
    this.dt = 0;
    this.paused = false;
    this.timeScale = 1;
    this._acc = 0;
    this._fpsSamples = [];
  }

  async init(onProgress = () => {}) {
    onProgress(0.05, 'WebGPU-Gerät anfordern…');
    const { renderer, info } = await createRenderer(this.canvas, { reversedDepth: this.reversedDepth !== false });
    this.renderer = renderer;
    this.gpuInfo = info;
    if (!info.isWebGPU) {
      throw new Error(
        'Dieser Browser liefert kein WebGPU. Elden Fox braucht WebGPU '
        + '(Chrome/Edge 113+, Safari 18+ oder Firefox mit aktiviertem dom.webgpu.enabled).',
      );
    }

    onProgress(0.15, 'Szene aufbauen…');
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(58, 16 / 9, 0.15, 12000);
    this.camera.position.set(0, 3, 8);

    this.viewport = new Viewport(renderer, this.canvas, {
      renderScale: this.settings.renderScale,
      maxPixelScale: this.settings.maxPixelScale ?? Infinity,
    });
    this.viewport.onResize.push((w, h) => {
      this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
      this.camera.updateProjectionMatrix();
      this.pipeline?.setSize(w, h);
    });
    this.camera.aspect = (this.canvas.clientWidth || 16) / (this.canvas.clientHeight || 9);
    this.camera.updateProjectionMatrix();

    onProgress(0.3, 'Atmosphäre berechnen…');
    this.atmosphere = new Atmosphere({ apRangeMeters: 6000 });
    await this.atmosphere.bake(renderer);

    onProgress(0.45, 'Himmel abtasten…');
    this.sky = new Sky(this.atmosphere, { cubeSize: 128 });
    this.sky.attachTo(this.scene);

    // Sonne: Farbe und Stärke kommen aus der Atmosphäre
    this.sun = new DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(this.settings.shadowMapSize);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.045;
    this.sun.shadow.intensity = 1.0;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.input = new Input(this.canvas);

    onProgress(0.6, 'Renderpfad übersetzen…');
    this.pipeline = new Pipeline(renderer, this.scene, this.camera, { settings: this.settings });

    return this;
  }

  /** Nach dem Anmelden aller Kompositoren aufrufen. */
  buildPipeline() {
    this.pipeline.build();
    this.pipeline.setSize(this.viewport.width, this.viewport.height);
  }

  /**
   * Baut den Postpfad mit geänderten Einstellungen neu auf.
   * Vor allem zum Vergleichen einzelner Stufen gedacht.
   */
  rebuild(overrides = {}) {
    const compositors = this.pipeline.compositors;
    const tuning = {};
    for (const k of ['exposure','bloomStrength','bloomThreshold','grainAmount','vignetteAmount',
                     'caAmount','saturationAmount','contrastAmount','dofFocus','dofRange',
                     'dofBokeh','motionBlurAmount','aoStrength']) {
      tuning[k] = this.pipeline[k].value;
    }
    Object.assign(this.settings, overrides);
    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, { settings: this.settings });
    this.pipeline.compositors = compositors;
    for (const [k, v] of Object.entries(tuning)) this.pipeline[k].value = v;
    this.buildPipeline();
    return this.settings;
  }

  add(system) { this.systems.push(system); return system; }

  /** Sonnenstand über Höhen- und Azimutwinkel in Grad. */
  setSun(elevationDeg, azimuthDeg) {
    const e = (elevationDeg * Math.PI) / 180;
    const a = (azimuthDeg * Math.PI) / 180;
    this.atmosphere.sunDirection.value.set(
      Math.cos(e) * Math.sin(a),
      Math.sin(e),
      -Math.cos(e) * Math.cos(a),
    ).normalize();
  }

  _syncSun() {
    const d = this.atmosphere.sunDirection.value;
    const cam = this.camera.position;
    // Schattenkamera folgt dem Spieler, Licht steht "unendlich" weit weg
    this.sun.target.position.set(cam.x, 0, cam.z);
    this.sun.position.set(cam.x + d.x * 160, d.y * 160, cam.z + d.z * 160);
    this.sun.color.copy(this.atmosphere.sunColor);
    this.sun.intensity = this.atmosphere.sunLuminance;
    this.sun.visible = this.atmosphere.sunLuminance > 0.002;
  }

  start() {
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      this.tick();
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() { cancelAnimationFrame(this._raf); }

  tick() {
    this.timer.update();
    const raw = Math.min(this.timer.getDelta(), 0.1);
    this.dt = raw * this.timeScale;
    this.time += this.dt;
    this.frame++;

    this.input.begin();

    if (!this.paused) {
      for (const s of this.systems) s.update?.(this.dt, this);
    } else {
      for (const s of this.systems) if (s.alwaysUpdate) s.update?.(0, this);
    }

    this._syncSun();
    // Beide fahren jedes Bild Compute-Kernel – unabhaengig von Aufloesung und
    // Postkette. Zum Eingrenzen einzeln abschaltbar.
    if (!this.skip.has('atmosphere')) this.atmosphere.update(this.renderer, this.camera);
    if (!this.skip.has('sky')) this.sky.update(this.renderer);

    for (const s of this.systems) s.preRender?.(this.dt, this);

    if (this.bypassPost) {
      // Diagnosepfad: Szene direkt zeichnen, ohne Postkette. Trennt die Frage
      // "stirbt die Karte am Post-Stack" von "stirbt sie an der Szene".
      this.renderer.render(this.scene, this.camera);
    } else {
      this.pipeline.updateFrameMatrices(this.camera);
      this.pipeline.renderSync();
    }

    this.input.end();

    // gleitende Bildrate
    this._fpsSamples.push(raw);
    if (this._fpsSamples.length > 45) this._fpsSamples.shift();
  }

  get fps() {
    if (!this._fpsSamples.length) return 0;
    const avg = this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length;
    return avg > 0 ? 1 / avg : 0;
  }
}
