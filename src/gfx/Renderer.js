import { WebGPURenderer, NeutralToneMapping, AgXToneMapping, ACESFilmicToneMapping, HalfFloatType, LinearSRGBColorSpace, SRGBColorSpace, PCFSoftShadowMap, VSMShadowMap } from 'three/webgpu';

/**
 * Kapselt Aufbau und Größenverwaltung des WebGPU-Renderers.
 * Der ganze Rest der Grafik läuft in HDR (Half-Float) bis zum Post-Stack.
 */
export async function createRenderer(canvas, opts = {}) {
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
  const info = {
    isWebGPU: !!backend?.isWebGPUBackend,
    adapter: backend?.adapter?.info ?? null,
    limits: backend?.device?.limits ?? null,
    features: backend?.device ? [...backend.device.features] : [],
  };

  return { renderer, info };
}

/** Reagiert auf Fenstergrößen und liefert die interne Renderauflösung. */
export class Viewport {
  constructor(renderer, canvas, { renderScale = 1.0 } = {}) {
    this.renderer = renderer;
    this.canvas = canvas;
    this.renderScale = renderScale;
    this.width = 1; this.height = 1;
    this.onResize = [];
    this._apply();
    addEventListener('resize', () => this._apply());
  }

  setScale(s) { this.renderScale = s; this._apply(); }

  _apply() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cw = Math.max(320, this.canvas.clientWidth || innerWidth);
    const ch = Math.max(240, this.canvas.clientHeight || innerHeight);
    const w = Math.round(cw * dpr * this.renderScale);
    const h = Math.round(ch * dpr * this.renderScale);
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.renderer.setSize(cw, ch, false);
    this.renderer.setPixelRatio(dpr * this.renderScale);
    for (const f of this.onResize) f(w, h);
  }
}
