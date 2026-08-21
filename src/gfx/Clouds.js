import {
  Storage3DTexture, StorageTexture, RGBAFormat, HalfFloatType, LinearFilter,
  RepeatWrapping, ClampToEdgeWrapping, Vector2, Vector3, Color, NoColorSpace,
} from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, int, uint, texture, texture3D, textureLevel, uniform, screenUV,
  If, Loop, Break, exp, max, min, clamp, saturate, mix, pow, sqrt, abs, floor, fract, sin, cos,
  dot, normalize, length, smoothstep, step, time, PI, PI2, select, cameraPosition, rtt,
  perspectiveDepthToViewZ, cameraNear, cameraFar, sign, luminance,
  instanceIndex, uvec3, uvec2, textureStore, storageTexture3D, mod,
} from 'three/tsl';

/**
 * Volumetrische Wolken als Schichtmodell.
 *
 * Der Strahl schneidet eine Wolkenschicht zwischen zwei Höhen und wird darin
 * abgetastet. Die Dichte kommt aus zwei vorberechneten Texturen – einer
 * groben 3D-Form und einem feinen Detailrauschen – statt aus fbm im Shader.
 * Das ist deutlich billiger und erlaubt mehr Schritte pro Strahl.
 *
 * Beleuchtet wird mit einem kurzen Marsch Richtung Sonne (Beer-Lambert),
 * Henyey-Greenstein-Phase und einem Powder-Term für die dunklen Ränder, die
 * echte Wolken von Wattebäuschen unterscheiden.
 */
export class Clouds {
  constructor({
    atmosphere, sky, seed = 3,
    bottom = 900, top = 2600, steps = 64, lightSteps = 6,
  } = {}) {
    this.atmo = atmosphere;
    this.sky = sky;
    this.steps = steps;
    this.lightSteps = lightSteps;

    /* --- Regler --- */
    this.bottom = uniform(bottom);
    this.top = uniform(top);
    this.coverage = uniform(0.46);
    this.densityScale = uniform(0.16);
    this.shapeScale = uniform(0.00042);
    this.detailScale = uniform(0.0042);
    this.detailStrength = uniform(0.30);
    this.anisotropy = uniform(0.62);
    this.silverIntensity = uniform(1.5);
    this.powder = uniform(0.62);
    this.windSpeed = uniform(new Vector3(11.0, 0.0, 4.0));
    this.ambientTint = uniform(new Color(0.62, 0.70, 0.86));
    this.maxDistance = uniform(24000);
    this.opacityScale = uniform(1.0);

    this.shapeSize = 64;
    this.detailSize = 32;
    this.weatherSize = 256;
    this.shapeTex = makeCloudStorage3D(this.shapeSize);
    this.detailTex = makeCloudStorage3D(this.detailSize);
    this.weatherTex = makeCloudStorage2D(this.weatherSize, this.weatherSize);
    this._baked = false;

    this._buildNodes();
    this._bakeKernels = [
      buildShapeKernel(this.shapeTex, this.shapeSize),
      buildDetailKernel(this.detailTex, this.detailSize),
      buildWeatherKernel(this.weatherTex, this.weatherSize),
    ];
  }

  /** Rauschtexturen einmalig füllen. Muss vor dem ersten Frame laufen. */
  async bake(renderer) {
    if (this._baked) return;
    for (const k of this._bakeKernels) await renderer.computeAsync(k);
    this._baked = true;
  }

  _buildNodes() {
    const A = this.atmo;

    /** Höhenanteil 0..1 innerhalb der Schicht. */
    const heightFraction = (p) =>
      saturate(p.y.sub(this.bottom).div(max(1.0, this.top.sub(this.bottom))));

    /** Typischer Wolkenaufbau: unten flach, in der Mitte bauchig, oben ausgefranst. */
    const heightGradient = Fn(([hf, kind]) => {
      const base = smoothstep(0.0, 0.12, hf).toVar();
      const topFade = float(1.0).sub(smoothstep(mix(float(0.35), float(0.75), kind), 1.0, hf)).toVar();
      return base.mul(topFade);
    });

    /** Dichte an einem Punkt. */
    /**
     * Dichte an einem Punkt.
     *
     * Bewusst schlank gehalten: Formtextur, Höhenverlauf, Bedeckungsschwelle,
     * optional Detailerosion. Jede zusätzliche Schwelle davor hatte den
     * Effekt, die Wolken vollständig wegzuschneiden – hier soll jeder
     * Faktor nachvollziehbar bleiben.
     */
    const sampleDensity = Fn(([p, detailOn]) => {
      const hf = heightFraction(p).toVar();
      const q = p.add(this.windSpeed.mul(time)).toVar();

      const shape = texture3D(this.shapeTex, q.mul(this.shapeScale)).toVar();

      // unten anschwellen, oben ausfransen
      const grad = smoothstep(0.0, 0.10, hf)
        .mul(float(1.0).sub(smoothstep(0.52, 1.0, hf)))
        .toVar();

      const d = saturate(
        shape.r.mul(1.7).mul(grad).sub(float(1.0).sub(this.coverage)),
      ).toVar();

      // Verzweigungsfrei: eine Bedingung mit `.and()` innerhalb einer in
      // Schleifen aufgerufenen Fn hat das Ergebnis stumm auf null gezogen.
      const det = texture3D(this.detailTex, q.mul(this.detailScale)).toVar();
      const dfbm = det.r.mul(0.625).add(det.g.mul(0.25)).add(det.b.mul(0.125)).toVar();
      // an der Oberkante ausfransen, unten kompakt lassen
      const erode = mix(dfbm, float(1.0).sub(dfbm), saturate(hf.mul(4.0))).toVar();
      const eroded = saturate(
        d.sub(erode.mul(this.detailStrength).mul(saturate(hf.mul(1.6)))),
      ).toVar();

      return mix(d, eroded, saturate(detailOn)).mul(this.densityScale);
    });

    this._sampleDensity = sampleDensity;

    const hg = (cosT, g) => {
      const g2 = g.mul(g);
      return float(1.0).sub(g2)
        .div(float(4.0).mul(PI).mul(pow(max(1e-3, float(1.0).add(g2).sub(g.mul(cosT).mul(2.0))), 1.5)));
    };

    /** Licht, das an einem Punkt aus Sonnenrichtung ankommt. */
    const lightMarch = Fn(([p, sunDir]) => {
      const steps = this.lightSteps;
      const stepLen = float((2600 - 900) / 6).toVar();
      const acc = float(0.0).toVar();
      Loop(steps, ({ i }) => {
        // konisch aufweiten: streut das Rauschen und wirkt weicher
        const t = stepLen.mul(float(i).add(0.5)).toVar();
        const jitter = vec3(
          sin(float(i).mul(12.9)).mul(0.3),
          0.0,
          cos(float(i).mul(7.3)).mul(0.3),
        ).mul(t.mul(0.06)).toVar();
        const q = p.add(sunDir.mul(t)).add(jitter).toVar();
        acc.addAssign(sampleDensity(q, float(0.0)).mul(stepLen));
      });
      return acc;
    });

    /**
     * Raymarch durch die Schicht.
     * @param rayOrigin Kameraposition
     * @param rayDir    normalisierte Blickrichtung
     * @param maxDist   Entfernung des Szenenpixels (Verdeckung)
     */
    /**
     * Raymarch durch die Schicht.
     *
     * Ohne umschließendes `If`: der gültige Bereich wird über eine Maske
     * am Ende verrechnet. Verschachtelte Bedingungen um Schleifen mit
     * `Break()` erwiesen sich als unzuverlässig – das Ergebnis kam leer
     * zurück, obwohl Schnittpunkt und Dichte nachweislich stimmten.
     *
     * @param rayOrigin Kameraposition
     * @param rayDir    normalisierte Blickrichtung
     * @param maxDist   Entfernung des Szenenpixels (Verdeckung)
     */
    this.march = Fn(([rayOrigin, rayDir, maxDist]) => {
      const dy = rayDir.y.toVar();
      const safeDy = select(abs(dy).lessThan(1e-4), float(1e-4), dy).toVar();
      const t0 = this.bottom.sub(rayOrigin.y).div(safeDy).toVar();
      const t1 = this.top.sub(rayOrigin.y).div(safeDy).toVar();
      const tEnter = min(t0, t1).toVar();
      const tExit = max(t0, t1).toVar();

      const start = max(tEnter, 0.0).toVar();
      const end = min(min(tExit, maxDist), this.maxDistance).toVar();
      const span = max(0.0, end.sub(start)).toVar();
      const valid = step(1.0, span).toVar();          // 1, wenn es etwas zu marschieren gibt

      const stepLen = span.div(float(this.steps)).toVar();

      const sunDir = normalize(A.sunDirection).toVar();
      const cosT = dot(rayDir, sunDir).toVar();
      // zwei Keulen: vorwärts für den Silberrand, rückwärts fürs Volumen
      const phase = mix(hg(cosT, this.anisotropy), hg(cosT, this.anisotropy.negate().mul(0.4)), 0.4).toVar();
      const silver = pow(saturate(cosT), 18.0).mul(this.silverIntensity).toVar();

      const sunRad = A.sunColorU.mul(A.sunLuminanceU).toVar();
      const ambient = this.sky.irradiance(vec3(0.0, 1.0, 0.0)).mul(this.ambientTint).toVar();

      // Rauschversatz gegen Bänderung
      const jitter = fract(sin(dot(screenUV.mul(1024.0), vec2(12.9898, 78.233))).mul(43758.5453)).toVar();

      const transmittance = float(1.0).toVar();
      const scattered = vec3(0.0).toVar();

      Loop(this.steps, ({ i }) => {
        const t = start.add(stepLen.mul(float(i).add(jitter))).toVar();
        const p = rayOrigin.add(rayDir.mul(t)).toVar();
        const dens = sampleDensity(p, float(1.0)).mul(valid).toVar();

        If(dens.greaterThan(0.0001), () => {
          const lightDepth = lightMarch(p, sunDir).toVar();
          const beer = exp(lightDepth.negate()).toVar();
          // Powder: dünne Ränder wirken dunkler, nicht heller
          const powderTerm = float(1.0).sub(exp(lightDepth.mul(-2.0))).toVar();
          const energy = beer.mul(mix(float(1.0), powderTerm, this.powder)).toVar();

          const hf = saturate(p.y.sub(this.bottom).div(max(1.0, this.top.sub(this.bottom)))).toVar();
          const sunLight = sunRad.mul(energy).mul(phase.add(silver)).toVar();
          const skyLight = ambient.mul(mix(float(0.35), float(1.0), hf)).toVar();
          const lum = sunLight.add(skyLight).toVar();

          const sigma = dens.mul(stepLen).toVar();
          const sliceT = exp(sigma.negate()).toVar();
          scattered.addAssign(transmittance.mul(lum).mul(float(1.0).sub(sliceT)));
          transmittance.mulAssign(sliceT);
        });
      });

      return vec4(scattered, mix(float(1.0), transmittance, valid));
    });
  }

  /**
   * Hängt sich als Kompositor in den Postpfad.
   * Läuft in halber Auflösung; Wolken haben keine harten Kanten, das fällt
   * nicht auf, spart aber die Hälfte der Strahlen.
   */
  attach(pipeline, { resolutionScale = 0.5 } = {}) {
    pipeline.addCompositor((color, ctx) => {
      const cloudNode = Fn(() => {
        // Blickstrahl aus der Kamerabasis rekonstruieren statt über die
        // inverse Sicht-Projektions-Matrix: die Matrix-Uniform kommt im
        // Postpfad nicht aktualisiert an, der Strahl wäre für alle Pixel
        // gleich. Vorwärts-, Rechts- und Hochvektor pflegt die Atmosphäre
        // ohnehin jeden Frame.
        const A = this.atmo;
        const ndcX = screenUV.x.mul(2.0).sub(1.0).toVar();
        const ndcY = screenUV.y.mul(2.0).sub(1.0).toVar();
        const dir = normalize(
          A.camForward
            .add(A.camRight.mul(ndcX.mul(A.camTanX)))
            .add(A.camUp.mul(ndcY.mul(A.camTanY))),
        ).toVar();

        // Szenentiefe in Strahlentfernung umrechnen: viewZ misst entlang der
        // Kameraachse, der Strahl läuft schräg dazu.
        const viewZ = ctx.viewZ.toVar();
        const cosAngle = max(0.2, dot(dir, normalize(A.camForward))).toVar();
        const sceneDist = abs(viewZ).div(cosAngle).toVar();
        // Hintergrund: leerer Tiefenpuffer oder jenseits der Fernebene
        const isBg = sceneDist.greaterThan(float(6000.0)).or(abs(viewZ).lessThan(0.001));
        const maxDist = select(isBg, float(1e6), sceneDist).toVar();

        return this.march(cameraPosition, dir, maxDist);
      })();

      const cloud = rtt(cloudNode);
      cloud.setResolutionScale(resolutionScale);

      return Fn(() => {
        const c = cloud.sample(screenUV).toVar();
        return vec4(color.rgb.mul(c.a).add(c.rgb.mul(this.opacityScale)), color.a);
      })();
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Rauschtexturen                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Die Texturen entstehen auf der GPU und liegen in Storage-Texturen.
 *
 * Der naheliegende Weg über `Data3DTexture` scheitert in diesem Renderpfad
 * stillschweigend: die Daten landen zwar im Speicher, `texture3D()` liefert
 * beim Abtasten aber durchgehend Nullen. Storage-Texturen funktionieren
 * nachweislich (die Volumetrik nutzt denselben Weg), also wird das Rauschen
 * einmalig per Compute-Kernel hineingeschrieben.
 */

export function makeCloudStorage3D(size, filter = LinearFilter) {
  const t = new Storage3DTexture(size, size, size);
  t.type = HalfFloatType;
  t.format = RGBAFormat;
  t.minFilter = filter;
  t.magFilter = filter;
  t.wrapS = t.wrapT = t.wrapR = RepeatWrapping;
  t.generateMipmaps = false;
  t.colorSpace = NoColorSpace;
  return t;
}

export function makeCloudStorage2D(w, h) {
  const t = new StorageTexture(w, h);
  t.type = HalfFloatType;
  t.format = RGBAFormat;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.generateMipmaps = false;
  t.colorSpace = NoColorSpace;
  return t;
}

/* ---- Rauschbausteine ---- */

const hash13 = /*@__PURE__*/ Fn(([p]) => {
  const q = fract(p.mul(0.1031)).toVar();
  const d = dot(q, q.yzx.add(33.33)).toVar();
  const r = fract(q.add(d)).toVar();
  return fract(r.x.add(r.y).mul(r.z));
});

const hash33 = /*@__PURE__*/ Fn(([p]) => {
  const q = fract(p.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
  const d = dot(q, q.yxz.add(33.33)).toVar();
  const r = q.add(d).toVar();
  return fract(vec3(r.x.add(r.y), r.x.add(r.z), r.y.add(r.z)).mul(r.zyx));
});

/** Kachelndes 3D-Wertrauschen; `freq` muss ganzzahlig sein. */
const vnoise3 = /*@__PURE__*/ Fn(([p, freq]) => {
  const pf = p.mul(freq).toVar();
  const i = floor(pf).toVar();
  const f = fract(pf).toVar();
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();

  const c = (dx, dy, dz) => hash13(mod(i.add(vec3(dx, dy, dz)), freq).add(0.5));
  const x00 = mix(c(0, 0, 0), c(1, 0, 0), u.x).toVar();
  const x10 = mix(c(0, 1, 0), c(1, 1, 0), u.x).toVar();
  const x01 = mix(c(0, 0, 1), c(1, 0, 1), u.x).toVar();
  const x11 = mix(c(0, 1, 1), c(1, 1, 1), u.x).toVar();
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
});

/** Kachelndes Worley-Rauschen: eins minus Abstand zum nächsten Zellpunkt. */
const worley3 = /*@__PURE__*/ Fn(([p, cells]) => {
  const pc = p.mul(cells).toVar();
  const base = floor(pc).toVar();
  const best = float(9.0).toVar();
  Loop(3, 3, 3, ({ i, j, k }) => {
    const off = vec3(float(i).sub(1.0), float(j).sub(1.0), float(k).sub(1.0)).toVar();
    const cell = mod(base.add(off), cells).toVar();
    const pt = base.add(off).add(hash33(cell.add(0.5))).toVar();
    best.assign(min(best, length(pc.sub(pt))));
  });
  return saturate(float(1.0).sub(best));
});

/* ---- Backkernel ---- */

/**
 * Formtextur: r = Perlin-Worley, gba = Worley-Oktaven.
 * Der Perlin-Anteil wird vor der Umbildung gespreizt, sonst liegt er eng um
 * 0.5 und die Umbildung schneidet die Wolke praktisch vollständig weg.
 */
export function buildShapeKernel(tex, size) {
  return Fn(() => {
    const x = instanceIndex.mod(uint(size)).toVar();
    const y = instanceIndex.div(uint(size)).mod(uint(size)).toVar();
    const z = instanceIndex.div(uint(size * size)).toVar();
    const p = vec3(float(x), float(y), float(z)).add(0.5).div(float(size)).toVar();

    const perlinRaw = vnoise3(p, float(4)).mul(0.5)
      .add(vnoise3(p, float(8)).mul(0.25))
      .add(vnoise3(p, float(16)).mul(0.125))
      .add(vnoise3(p, float(32)).mul(0.0625))
      .div(0.9375)
      .toVar();
    const perlin = saturate(perlinRaw.sub(0.30).div(0.42)).toVar();

    const w1 = worley3(p, float(4)).toVar();
    const w2 = worley3(p, float(8)).toVar();
    const w3 = worley3(p, float(16)).toVar();
    const wf = w1.mul(0.625).add(w2.mul(0.25)).add(w3.mul(0.125)).toVar();

    const pw = saturate(perlin.sub(float(1.0).sub(wf).mul(0.40))
      .div(max(0.35, wf.mul(0.8).add(0.2)))).toVar();

    storageTexture3D(tex, uvec3(x, y, z), vec4(pw, w1, w2, w3)).toStack();
  })().compute(size * size * size);
}

/** Feines Worley-Detail zum Ausfransen der Ränder. */
export function buildDetailKernel(tex, size) {
  return Fn(() => {
    const x = instanceIndex.mod(uint(size)).toVar();
    const y = instanceIndex.div(uint(size)).mod(uint(size)).toVar();
    const z = instanceIndex.div(uint(size * size)).toVar();
    const p = vec3(float(x), float(y), float(z)).add(0.5).div(float(size)).toVar();
    storageTexture3D(tex, uvec3(x, y, z), vec4(
      worley3(p, float(4)), worley3(p, float(8)), worley3(p, float(16)), 1.0,
    )).toStack();
  })().compute(size * size * size);
}

/** Wetterkarte: r = Bedeckung, g = Niederschlag, b = Wolkenhöhe. */
export function buildWeatherKernel(tex, size) {
  return Fn(() => {
    const x = instanceIndex.mod(uint(size)).toVar();
    const y = instanceIndex.div(uint(size)).toVar();
    const p = vec3(float(x).add(0.5).div(float(size)), float(y).add(0.5).div(float(size)), 0.31).toVar();

    const covRaw = vnoise3(p, float(2)).mul(0.5)
      .add(vnoise3(p, float(4)).mul(0.25))
      .add(vnoise3(p, float(8)).mul(0.125))
      .add(vnoise3(p, float(16)).mul(0.0625))
      .div(0.9375)
      .toVar();
    const cov = saturate(covRaw.sub(0.28).div(0.44)).toVar();

    const q = vec3(p.x, p.y, 0.77).toVar();
    const hgt = saturate(vnoise3(q, float(2)).mul(0.6).add(vnoise3(q, float(4)).mul(0.4))).toVar();

    textureStore(tex, uvec2(x, y), vec4(cov, 0.16, hgt, 1.0)).toStack();
  })().compute(size * size);
}
