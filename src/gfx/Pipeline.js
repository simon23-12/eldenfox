import { RenderPipeline, HalfFloatType, Matrix4, Vector3 } from 'three/webgpu';
import {
  pass, mrt, output, normalView, velocity, vec2, vec3, vec4, float, uniform,
  screenUV, uv, mix, max, min, clamp, pow, saturate, dot, length, smoothstep, exp, sin, cos,
  Fn, luminance, texture, time, screenSize, fract, abs, sub, mul, add, div, positionWorld,
  metalness, roughness, cameraPosition, cameraNear, cameraFar, normalize, step, select, int, log2, agxToneMapping,
} from 'three/tsl';

import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js';
import { fsr1 } from 'three/addons/tsl/display/FSR1Node.js';
import { depthOfField, chromaticAberration, cameraMotionBlur, anamorphicStreak } from './PostFx.js';

export const QUALITY = {
  // Hinweis zu `ssgi`: der Addon-Knoten liefert in dieser Three-Fassung ein
  // Vollbild-Ergebnis ohne Hintergrundmaske und flutet damit auch Himmel-
  // pixel. Additiv eingehängt kippt das ganze Bild in die Sonnenfarbe.
  // Bis das geklärt ist übernehmen GTAO + Himmel-IBL + SSR die indirekte
  // Beleuchtung; der Pfad bleibt zum Nachmessen erhalten.
  ultra: {
    ao: true, aoDenoise: true, ssr: true, ssrStochastic: false, ssgi: false,
    traa: true, bloom: true, lensflare: false, dof: true, motionBlur: true,
    volumetrics: true, clouds: true, grain: true, ca: true, upscale: true,
    // Intern in 0.72 rendern und per FSR1 rekonstruieren: das ist auf
    // Retina-Displays deutlich schneller als native Auflösung und bei
    // aktivem TRAA kaum vom nativen Bild zu unterscheiden.
    renderScale: 0.72, shadowMapSize: 2048, cascades: 4, grassDensity: 1.0,
  },
  high: {
    ao: true, aoDenoise: true, ssr: true, ssrStochastic: false, ssgi: false,
    traa: true, bloom: true, lensflare: false, dof: true, motionBlur: true,
    volumetrics: true, clouds: true, grain: true, ca: true, upscale: true,
    // Stand vorher auf 0.85 und lag damit *über* ultra – die Stufe, auf die
    // große Bildschirme ausweichen sollen, war die teuerste von allen. 0.72
    // ist der oben beschriebene FSR1-Arbeitspunkt.
    renderScale: 0.72, shadowMapSize: 2048, cascades: 4, grassDensity: 0.75,
  },
  medium: {
    ao: true, aoDenoise: false, ssr: false, ssrStochastic: false, ssgi: false,
    traa: true, bloom: true, lensflare: false, dof: false, motionBlur: true,
    volumetrics: true, clouds: true, grain: true, ca: false, upscale: true,
    renderScale: 0.72, shadowMapSize: 1536, cascades: 3, grassDensity: 0.5,
  },
  low: {
    ao: false, aoDenoise: false, ssr: false, ssrStochastic: false, ssgi: false,
    traa: false, bloom: true, lensflare: false, dof: false, motionBlur: false,
    volumetrics: false, clouds: true, grain: false, ca: false, upscale: true,
    renderScale: 0.6, shadowMapSize: 1024, cascades: 2, grassDensity: 0.28,
  },
};

/**
 * Setzt den kompletten Renderpfad zusammen:
 * Szenenpass mit MRT -> AO -> SSGI/SSR -> Volumetrik -> TRAA ->
 * Bloom/Lensflare -> DOF -> Motion Blur -> Tonemapping -> Korn/Vignette.
 */
export class Pipeline {
  constructor(renderer, scene, camera, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.settings = { ...QUALITY.ultra, ...(opts.settings ?? {}) };

    /* --- künstlerische Regler --- */
    this.exposure = uniform(0.42);
    this.bloomStrength = uniform(0.17);
    this.bloomThreshold = uniform(1.05);
    this.grainAmount = uniform(0.028);
    this.vignetteAmount = uniform(0.42);
    this.caAmount = uniform(0.55);
    this.saturationAmount = uniform(1.06);
    this.contrastAmount = uniform(1.04);
    this.dofFocus = uniform(9.0);
    this.dofRange = uniform(90.0);
    this.dofBokeh = uniform(0.38);
    this.motionBlurAmount = uniform(0.55);
    this.prevViewProj = uniform(new Matrix4());
    this.invViewProj = uniform(new Matrix4());
    this._vp = new Matrix4();
    /** Kamerabasis für Strahlrekonstruktion im Postpfad. */
    this.camBasis = {
      forward: uniform(new Vector3(0, 0, -1)),
      right: uniform(new Vector3(1, 0, 0)),
      up: uniform(new Vector3(0, 1, 0)),
      tanX: uniform(1.0),
      tanY: uniform(0.6),
    };
    this.hitFlash = uniform(0.0);
    this.deathFade = uniform(0.0);
    this.aoStrength = uniform(1.0);
    /** Optionale HDR-Umgebung für stochastisches SSR (equirektangular, mit image.data). */
    this.ssrEnvironment = opts.ssrEnvironment ?? null;

    /** Hooks: Funktionen (colorNode, ctx) => colorNode, z.B. Nebel & Wolken. */
    this.compositors = [];

    this._built = false;
  }

  /** Fügt einen Kompositor ein (Reihenfolge = Einfügereihenfolge). */
  addCompositor(fn) { this.compositors.push(fn); if (this._built) this.build(); }

  build() {
    const { scene, camera, settings: S } = this;

    const scenePass = pass(scene, camera, { type: HalfFloatType, samples: 0 });
    scenePass.setMRT(mrt({
      output,
      normal: normalView,
      velocity,
      material: vec4(roughness, metalness, 0.0, 1.0),
    }));
    this.scenePass = scenePass;

    const colorTex = scenePass.getTextureNode('output');
    const depthTex = scenePass.getTextureNode('depth');
    const normalTex = scenePass.getTextureNode('normal');
    const velocityTex = scenePass.getTextureNode('velocity');
    const materialTex = scenePass.getTextureNode('material');
    const viewZ = scenePass.getViewZNode('depth');
    const linearDepth = scenePass.getLinearDepthNode('depth');

    this.tex = { colorTex, depthTex, normalTex, velocityTex, materialTex, viewZ, linearDepth };

    let color = colorTex;

    /* ---------------- temporale Kantenglättung ----------------
     * TRAA sitzt bewusst direkt hinter dem Szenenpass: der Knoten liest das
     * Render-Target seines Eingangs, und ein zwischengeschaltetes RTT wäre
     * zum Auflösezeitpunkt noch leer. AO/SSR/SSGI arbeiten ohnehin auf dem
     * ungeglätteten G-Buffer und bringen eigene Entrauschung mit. */
    if (S.traa) {
      const t = traa(colorTex, depthTex, velocityTex, camera);
      this.traaPass = t;
      color = t;
    }

    /* ---------------- Umgebungsverdeckung ---------------- */
    if (S.ao) {
      const aoPass = ao(depthTex, normalTex, camera);
      aoPass.resolutionScale = 1.0;
      aoPass.distanceExponent.value = 1.6;
      aoPass.distanceFallOff.value = 0.7;
      aoPass.radius.value = 0.9;
      aoPass.scale.value = 1.4;
      aoPass.thickness.value = 1.2;
      aoPass.samples.value = 24;
      this.aoPass = aoPass;

      let aoTex = aoPass.getTextureNode();
      if (S.aoDenoise) {
        const dn = denoise(aoTex, depthTex, normalTex, camera);
        dn.lumaPhi.value = 12;
        dn.depthPhi.value = 3;
        dn.normalPhi.value = 6;
        dn.radius.value = 8;
        aoTex = dn;
      }
      // AO wirkt vor allem auf den indirekten Anteil: helle, direkt
      // beleuchtete Pixel werden deutlich weniger verdunkelt.
      const aoV = aoTex.r;
      const prevColor = color;
      color = Fn(() => {
        const c = prevColor.toVar();
        const a = saturate(aoV).toVar();
        const protect = saturate(luminance(c.rgb).mul(0.55)).toVar();
        const applied = mix(a, float(1.0), protect.mul(0.75)).toVar();
        const strength = mix(float(1.0), applied, this.aoStrength).toVar();
        return vec4(c.rgb.mul(strength), c.a);
      })();
    }

    /* ---------------- Bildschirmraum-GI ---------------- */
    if (S.ssgi) {
      const gi = ssgi(colorTex, depthTex, normalTex, camera);
      gi.sliceCount.value = 2;
      gi.stepCount.value = 8;
      gi.useScreenSpaceSampling.value = true;
      // Nur ein dezenter Farbabprall – die Verdeckung macht GTAO,
      // sonst verdoppelt sich der Effekt und das Bild flacht aus.
      gi.giIntensity.value = 0.8;
      gi.aoIntensity.value = 0.0;
      gi.radius.value = 8;
      this.ssgiPass = gi;
      color = color.add(gi);
    }

    /* ---------------- Bildschirmraum-Reflexionen ---------------- */
    if (S.ssr) {
      // `stochastic: true` verlangt zwingend eine equirektangulare HDR-Umgebung
      // mit CPU-seitigen Daten (ImportanceSampledEnvironment). Ohne die
      // scheitert der Shaderbau mit "sampleEnvironmentBRDF of null" und der
      // ganze Postgraph bleibt halb übersetzt liegen.
      const stochastic = S.ssrStochastic && this.ssrEnvironment != null;
      const r = ssr(colorTex, depthTex, normalTex, {
        stochastic,
        environmentNode: this.ssrEnvironment ?? null,
        roughnessNode: materialTex.r,
        metalnessNode: materialTex.g,
        // Nichtmetalle bewusst ausgenommen: bei glatten Dielektrika (Wasser,
        // nasser Stein) liefert der Knoten die volle Umgebungsfarbe ohne
        // Fresnel-Gewichtung, additiv eingehängt ertränkt das die Fläche.
        // Deren Spiegelung kommt korrekt aus dem Himmel-IBL des Materials.
        reflectNonMetals: false,
        binaryRefine: true,
        camera,
      });
      r.maxDistance.value = 200;
      r.intensity.value = 1.0;
      r.thickness.value = 0.18;
      this.ssrPass = r;
      color = color.add(r);
    }

    /* ---------------- eigene Kompositoren: Nebel, Wolken, Wasser ---------------- */
    const ctx = { depthTex, normalTex, viewZ, linearDepth, velocityTex, materialTex, camera, scenePass, colorTex };
    for (const f of this.compositors) color = f(color, ctx);

    /* ---------------- Belichtung ----------------
     * Muss *vor* Bloom liegen: der Bloom-Schwellwert ist sonst an die
     * absolute Szenenhelligkeit gekoppelt und der halbe Himmel glüht,
     * sobald die Sonnenstärke sich ändert. */
    color = color.mul(this.exposure);

    /* ---------------- Bloom + Lensflare ---------------- */
    if (S.bloom) {
      const b = bloom(color, this.bloomStrength, 0.62, this.bloomThreshold);
      this.bloomPass = b;
      color = color.add(b);
      if (S.lensflare) {
        const lf = lensflare(b, {
          ghostTint: vec3(1.0, 0.82, 0.62),
          threshold: float(9.0),
          ghostSamples: float(4.0),
          ghostSpacing: float(0.32),
          ghostAttenuationFactor: float(32.0),
          downSampleRatio: 4,
        });
        color = color.add(lf.mul(0.16));
      }
    }

    /* ---------------- Schärfentiefe ---------------- */
    if (S.dof) {
      color = depthOfField(color, depthTex, {
        focus: this.dofFocus,
        range: this.dofRange,
        bokeh: this.dofBokeh,
        maxRadiusPx: 15,
        samples: 20,
        nearScale: 0.55,
        farLimit: 0.13,
      });
    }

    /* ---------------- Bewegungsunschärfe ---------------- */
    if (S.motionBlur) {
      color = cameraMotionBlur(color, depthTex, {
        strength: this.motionBlurAmount,
        prevViewProj: this.prevViewProj,
        camBasis: this.camBasis,
        maxLengthPx: 18,
        samples: 10,
      });
    }

    /* ---------------- Farbgebung & Filmlook ---------------- */
    color = this._grade(color);

    if (S.ca) color = chromaticAberration(color, { strength: this.caAmount, edgePower: 2.4, samples: 5 });

    /* ---------------- Auflösungsrekonstruktion ---------------- */
    if (S.upscale) color = fsr1(color, 0.25, true);

    const post = new RenderPipeline(this.renderer);
    post.outputNode = color;
    this.post = post;
    this._built = true;
    return post;
  }

  /** Tonemapping, Sättigung, Kontrast, Vignette, Korn, Trefferblitz. */
  _grade(colorNode) {
    return Fn(() => {
      const c = colorNode.toVar();
      const rgb = max(vec3(0.0), c.rgb).toVar();

      // Trefferblitz: kurzer roter Stoß am Bildrand
      const edge = smoothstep(0.18, 0.75, length(screenUV.sub(0.5)).mul(1.6)).toVar();
      rgb.assign(mix(rgb, mix(rgb, vec3(0.85, 0.06, 0.05), edge), this.hitFlash));

      // AgX: filmische Kennlinie mit sauberem Hochton-Rolloff
      const toned = agxToneMapping(rgb, float(1.0)).toVar();

      // Sättigung / Kontrast
      const lum = luminance(toned).toVar();
      const sat = mix(vec3(lum), toned, this.saturationAmount).toVar();
      const contr = max(vec3(0.0), sat.sub(0.5).mul(this.contrastAmount).add(0.5)).toVar();

      // Vignette
      const d = length(screenUV.sub(0.5)).mul(1.414).toVar();
      const vig = mix(float(1.0), smoothstep(1.02, 0.28, d), this.vignetteAmount).toVar();
      const out = contr.mul(vig).toVar();

      // Filmkorn (zeitabhängig, luminanzgewichtet)
      const n = fract(sin(dot(screenUV.mul(screenSize).add(time.mul(91.7)), vec2(12.9898, 78.233))).mul(43758.5453)).toVar();
      const grainW = mix(float(1.0), float(0.35), saturate(luminance(out))).toVar();
      out.addAssign(n.sub(0.5).mul(this.grainAmount).mul(grainW));

      // Tod: Ausblenden nach Sepia-Schwarz
      const dead = luminance(out).toVar();
      const sepia = vec3(dead.mul(1.05), dead.mul(0.82), dead.mul(0.62)).toVar();
      out.assign(mix(out, sepia.mul(float(1.0).sub(this.deathFade.mul(0.85))), this.deathFade));

      return vec4(max(vec3(0.0), out), 1.0);
    })();
  }

  /**
   * Die Effektknoten verwalten ihre Zielgrößen selbst (updateBefore);
   * hier nur die Regler nachziehen, die von der Auflösung abhängen.
   */
  setSize(w, h) {
    this.dofBokeh.value = 0.38 * Math.min(1.4, h / 1080);
  }

  /** Muss einmal pro Frame *vor* dem Rendern laufen. */
  updateFrameMatrices(camera) {
    this.prevViewProj.value.copy(this._vp);
    camera.updateMatrixWorld();
    this._vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.invViewProj.value.copy(this._vp).invert();

    const q = camera.quaternion;
    this.camBasis.forward.value.set(0, 0, -1).applyQuaternion(q);
    this.camBasis.right.value.set(1, 0, 0).applyQuaternion(q);
    this.camBasis.up.value.set(0, 1, 0).applyQuaternion(q);
    const tanY = Math.tan((camera.fov * Math.PI) / 360);
    this.camBasis.tanY.value = tanY;
    this.camBasis.tanX.value = tanY * camera.aspect;
  }

  render() { return this.post.renderAsync(); }
  renderSync() { return this.post.render(); }
}
