import { WebGPURenderer, NeutralToneMapping, AgXToneMapping, ACESFilmicToneMapping, HalfFloatType, LinearSRGBColorSpace, SRGBColorSpace, PCFSoftShadowMap, VSMShadowMap } from 'three/webgpu';

/**
 * Kapselt Aufbau und Größenverwaltung des WebGPU-Renderers.
 * Der ganze Rest der Grafik läuft in HDR (Half-Float) bis zum Post-Stack.
 */
export async function createRenderer(canvas, opts = {}) {
  // Erst nachfragen, dann bauen. Ohne WebGPU faellt der WebGPURenderer still
  // auf WebGL zurueck und stirbt dort tief in three mit einem nichtssagenden
  // "Cannot read properties of null (reading 'getSupportedExtensions')".
  // Haeufigster Grund: Chrome hat die Hardwarebeschleunigung abgeschaltet,
  // weil der GPU-Prozess mehrfach abgestuerzt ist. Dagegen hilft nur ein
  // vollstaendiger Neustart des Browsers.
  if (!opts.forceWebGL) await requireWebGPU();

  const renderer = new WebGPURenderer({
    canvas,
    antialias: false,             // wir machen TRAA im Post-Stack
    alpha: false,
    stencil: false,
    depth: true,
    reversedDepthBuffer: opts.reversedDepth !== false,
    outputBufferType: HalfFloatType,
    powerPreference: 'high-performance',
    forceWebGL: opts.forceWebGL === true,
  });

  renderer.setPixelRatio(1);      // Auflösung steuert der Upscaler, nicht der DPR
  renderer.setSize(canvas.clientWidth || 1280, canvas.clientHeight || 720, false);
  renderer.setClearColor(0x000000, 1);

  // Tonemapping passiert explizit im Post-Stack (RenderOutputNode), nicht hier.
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = SRGBColorSpace;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  await renderer.init();

  const backend = renderer.backend;
  // three legt den Adapter selbst nicht ab; die Kennung hängt am Gerät.
  const adapterInfo = backend?.device?.adapterInfo ?? null;
  const info = {
    isWebGPU: !!backend?.isWebGPUBackend,
    adapter: adapterInfo,
    adapterName: describeAdapter(adapterInfo),
    isSoftware: isSoftwareAdapter(adapterInfo),
    limits: backend?.device?.limits ?? null,
    features: backend?.device ? [...backend.device.features] : [],
  };

  return { renderer, info };
}

/**
 * Stellt sicher, dass WebGPU wirklich benutzbar ist – mit einer Fehlermeldung,
 * aus der hervorgeht, was zu tun ist.
 */
async function requireWebGPU() {
  // Als erwartet markierte Fehler zeigt der Startbildschirm ohne Stacktrace.
  const fail = (msg) => { const e = new Error(msg); e.expected = true; throw e; };
  if (!navigator.gpu) {
    fail(
      'Dieser Browser bietet kein WebGPU an.\n\n'
      + 'Nötig ist Chrome/Edge 113+, Safari 18+ oder Firefox mit aktiviertem '
      + 'dom.webgpu.enabled. Prüfe chrome://gpu – dort sollte WebGPU auf '
      + '"Hardware accelerated" stehen.',
    );
  }

  let adapter = null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch (err) {
    throw new Error(`WebGPU liefert keinen Adapter: ${err?.message ?? err}`);
  }

  if (!adapter) {
    fail(
      'WebGPU ist vorhanden, liefert aber keine Grafikkarte.\n\n'
      + 'Das passiert vor allem, wenn Chrome die Hardwarebeschleunigung nach '
      + 'mehreren Abstürzen des GPU-Prozesses abgeschaltet hat. Beende Chrome '
      + 'vollständig – alle Fenster, auch Inkognito – und starte es neu. '
      + 'Danach zeigt chrome://gpu wieder "WebGPU: Hardware accelerated".',
    );
  }
}

/** Lesbarer Name des Adapters, so weit Chrome ihn preisgibt. */
export function describeAdapter(i) {
  if (!i) return '';
  return [i.vendor, i.architecture, i.device, i.description]
    .filter(Boolean).join(' ').trim();
}

/**
 * Erkennt einen Software-Rasterizer (WARP, SwiftShader, llvmpipe).
 *
 * Chrome weicht darauf aus, wenn es die echte Grafikkarte nicht benutzen kann
 * oder sie gesperrt ist. WebGPU meldet sich dann ganz normal, nur rechnet die
 * CPU: die Grafikkarte langweilt sich, der Arbeitsspeicher läuft voll und
 * irgendwann bricht das Gerät weg. Für dieses Spiel ist das unbrauchbar.
 */
export function isSoftwareAdapter(adapterInfo) {
  if (!adapterInfo) return false;
  if (adapterInfo.isFallbackAdapter === true) return true;
  const name = describeAdapter(adapterInfo).toLowerCase();
  if (!name) return false;
  return /warp|swiftshader|llvmpipe|lavapipe|basic render|software|microsoft basic/.test(name);
}

/** Reagiert auf Fenstergrößen und liefert die interne Renderauflösung. */
export class Viewport {
  constructor(renderer, canvas, { renderScale = 1.0, maxPixelScale = Infinity } = {}) {
    this.renderer = renderer;
    this.canvas = canvas;
    this.renderScale = renderScale;
    this.maxPixelScale = maxPixelScale;
    this.width = 1; this.height = 1;
    this.onResize = [];
    this._apply();
    addEventListener('resize', () => this._apply());
  }

  setScale(s, maxPixelScale = this.maxPixelScale) {
    this.renderScale = s;
    this.maxPixelScale = maxPixelScale;
    this._apply();
  }

  /** Tatsächlicher Faktor auf die CSS-Größe, Obergrenze eingerechnet. */
  get pixelScale() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    return Math.min(dpr * this.renderScale, this.maxPixelScale);
  }

  _apply() {
    // `renderScale` allein reicht nicht: multipliziert mit der Pixeldichte
    // landet selbst die niedrigste Stufe über der nativen Auflösung (bei
    // dpr 2 sind 0.6 immer noch 1.2×). `maxPixelScale` deckelt das, damit
    // die unteren Stufen wirklich entlasten.
    const scale = this.pixelScale;
    const cw = Math.max(320, this.canvas.clientWidth || innerWidth);
    const ch = Math.max(240, this.canvas.clientHeight || innerHeight);
    const w = Math.round(cw * scale);
    const h = Math.round(ch * scale);
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.renderer.setSize(cw, ch, false);
    this.renderer.setPixelRatio(scale);
    for (const f of this.onResize) f(w, h);
  }
}
