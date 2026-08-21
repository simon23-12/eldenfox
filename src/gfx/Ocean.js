import {
  Mesh, BufferGeometry, BufferAttribute, MeshPhysicalNodeMaterial, Vector2, Vector3, Color,
  DataTexture, RGBAFormat, FloatType, HalfFloatType, LinearFilter, RepeatWrapping, FrontSide,
} from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, int, uint, uvec2, ivec2, instanceIndex, textureStore, textureLoad,
  texture, textureLevel, uniform, attribute, positionLocal, positionWorld, cameraPosition, normalize,
  If, Loop, cos, sin, exp, sqrt, log, max, min, abs, floor, fract, mod, select, PI, PI2, atan, pow,
  dot, length, mix, clamp, saturate, smoothstep, step, sign, time, transformNormalToView, reflect,
  luminance, cross, screenUV, positionViewDirection, Break, div,
} from 'three/tsl';
import { Fft2D, makeStorage } from './Fft.js';
import { instancedArray } from 'three/tsl';
import { Rng } from '../core/Rng.js';

/* ============================================================================
 * Ozean nach Tessendorf: statistisches Wellenspektrum, inverse Fouriertrans-
 * formation auf der GPU, mehrere Kaskaden für Dünung bis Kräuselung.
 *
 * Pro Kaskade laufen zwei komplexe Transformationen (vier reelle Signale je
 * Textur dank der Real-Paar-Packung):
 *   Textur 1: (Dx + i·Dz) und (Dy + i·Dxz)
 *   Textur 2: (Dyx + i·Dyz) und (Dxx + i·Dzz)
 * Daraus folgen Verschiebung, Normale und die Jacobi-Determinante, die den
 * Gischtanteil auf den Wellenkämmen liefert.
 * ========================================================================== */

const GRAVITY = 9.81;
const SPECTRUM_CALIBRATION = 0.058;

class Cascade {
  /**
   * @param {number} n          Auflösung (Zweierpotenz)
   * @param {number} patchSize  Kantenlänge der Kachel in Metern
   * @param {number} seed
   */
  constructor(n, patchSize, seed, cutoffLow, cutoffHigh) {
    this.N = n;
    this.patch = patchSize;
    this.cutoffLow = cutoffLow;
    this.cutoffHigh = cutoffHigh;
    this.fft = new Fft2D(n);

    this.h0 = makeStorage(n, n, FloatType);              // h0(k) und conj(h0(-k))
    this.specA = makeStorage(n, n, FloatType);           // Dx+iDz , Dy+iDxz
    this.specB = makeStorage(n, n, FloatType);           // Dyx+iDyz, Dxx+iDzz
    this.outA = makeStorage(n, n, HalfFloatType, LinearFilter);
    this.outB = makeStorage(n, n, HalfFloatType, LinearFilter);

    this.noise = makeGaussianNoise(n, seed);
    this.stage = uniform(0, 'int');
    this.stageB = uniform(0, 'int');
    this._baked = false;
  }
}

/** Vier gaußverteilte Zufallszahlen je Texel, deterministisch. */
function makeGaussianNoise(n, seed) {
  const rng = new Rng(seed);
  const data = new Float32Array(n * n * 4);
  for (let i = 0; i < n * n * 4; i++) data[i] = rng.gauss(0, 1);
  const t = new DataTexture(data, n, n, RGBAFormat, FloatType);
  t.needsUpdate = true;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export class Ocean {
  /**
   * @param {object} o
   * @param {import('./Atmosphere.js').Atmosphere} o.atmosphere
   * @param {import('./Sky.js').Sky} o.sky
   */
  constructor({ atmosphere, sky, quality = 1.0 } = {}) {
    this.atmo = atmosphere;
    this.sky = sky;

    /* --- Wind und Wellenbild --- */
    this.windDir = uniform(new Vector2(0.82, 0.57).normalize());
    this.windSpeed = uniform(11.5);
    this.fetch = uniform(0.86);          // wie ausgereift die See ist
    this.choppiness = uniform(1.0);
    this.amplitude = uniform(1.0);
    this.timeScale = uniform(1.0);
    this.oceanTime = uniform(0.0);
    this.origin = uniform(new Vector2(0, 0));
    this.seaLevel = uniform(0.0);

    /* --- Wechselwirkung mit der Spielfigur ---
     * Ringwellen und Schaum um eine bewegte Quelle. Bewusst analytisch statt
     * als Ping-Pong-Simulation: das kostet nichts, laeuft ohne zusaetzliche
     * Texturen und reicht fuer eine einzelne Figur voellig aus. */
    this.wakePos = uniform(new Vector2(0, 0));      // Weltkoordinaten x/z
    this.wakeStrength = uniform(0.0);               // 0 = aus
    this.wakeSpeed = uniform(0.0);                  // Tempo der Figur
    this.wakeTime = uniform(0.0);
    this.wakeRadius = uniform(6.0);
    this.wakeAmplitude = uniform(0.34);

    /* --- Farben und Optik --- */
    this.deepColor = uniform(new Color(0.0055, 0.0290, 0.0480));
    this.shallowColor = uniform(new Color(0.0350, 0.1450, 0.1600));
    this.scatterColor = uniform(new Color(0.055, 0.215, 0.190));
    this.ambientScatter = uniform(1.6);
    this.foamColor = uniform(new Color(0.86, 0.90, 0.92));
    // Gischt entsteht dort, wo sich die Oberfläche selbst überschlägt, die
    // Jacobi-Determinante also gegen null geht. Alles darüber ist Kunstfreiheit.
    this.foamThreshold = uniform(0.30);
    this.foamStrength = uniform(0.85);
    /**
     * Wie stark die horizontale Auslenkung in die Gischtberechnung eingeht.
     * Mit dem vollen Wert liegt die Jacobi-Determinante über weite Flächen
     * unter null und der ganze Ozean ist Schaumkrone.
     */
    this.foamJacobian = uniform(0.30);
    this.sssStrength = uniform(1.0);
    this.roughnessBase = uniform(0.055);
    this.reflectionStrength = uniform(1.0);


    // Bandgrenze zwischen den Kaskaden: Wellen länger als BAND_SPLIT_M kommen
    // aus der groben Kachel, kürzere aus der feinen. Ohne diese Trennung
    // erzeugt die feine Kaskade ihre eigenen langen Wellen und die See
    // schaukelt sich auf ein Vielfaches der physikalischen Höhe hoch.
    const BAND_SPLIT_M = 14.0;
    const kSplit = (2 * Math.PI) / BAND_SPLIT_M;
    const hi = quality >= 0.75;
    this.cascades = [
      new Cascade(hi ? 256 : 128, 340.0, 1337, 0.0, kSplit),
      new Cascade(hi ? 128 : 64, 38.0, 4711, kSplit, 1e5),
    ];

    this._buildKernels();
    this.mesh = this._buildMesh(hi);
  }

  /* --------------------------------------------------------------- Compute */

  _buildKernels() {
    for (const c of this.cascades) {
      const N = c.N;
      const invPatch = PI2.div(float(c.patch));

      /** Wellenzahlvektor für den Texel, zentriert um null. */
      const kOf = (x, y) => {
        const nx = float(x).sub(float(N / 2));
        const ny = float(y).sub(float(N / 2));
        return vec2(nx, ny).mul(invPatch);
      };

      /* ---- h0(k): einmalig ---- */
      c.h0Kernel = Fn(() => {
        const x = instanceIndex.mod(uint(N)).toVar();
        const y = instanceIndex.div(uint(N)).toVar();
        const k = kOf(x, y).toVar();
        const kLen = length(k).toVar();

        const h0 = vec2(0.0).toVar();
        const h0c = vec2(0.0).toVar();

        If(kLen.greaterThan(1e-6), () => {
          const kHat = k.div(kLen).toVar();
          const windN = normalize(this.windDir).toVar();
          const L = this.windSpeed.mul(this.windSpeed).div(GRAVITY).mul(this.fetch).toVar();

          // Phillips-Spektrum mit Richtungsanteil und kurzwelliger Dämpfung
          const kL2 = kLen.mul(L).mul(kLen.mul(L)).toVar();
          const damp = float(L).mul(0.0016).toVar();
          const dirTerm = pow(abs(dot(kHat, windN)), 4.0).toVar();
          let ph = exp(float(-1.0).div(max(1e-6, kL2)))
            .div(pow(kLen, 4.0))
            .mul(dirTerm)
            .mul(exp(kLen.mul(kLen).mul(damp).mul(damp).negate()))
            .toVar();

          // Bandbegrenzung: jede Kaskade deckt nur ihr Frequenzband ab,
          // sonst überlagern sich die Kaskaden zu Doppelwellen.
          const bandLo = c.cutoffLow > 0
            ? smoothstep(float(c.cutoffLow * 0.75), float(c.cutoffLow * 1.25), kLen).toVar()
            : float(1.0).toVar();
          const bandHi = c.cutoffHigh < 1e4
            ? float(1.0).sub(smoothstep(float(c.cutoffHigh * 0.75), float(c.cutoffHigh * 1.25), kLen)).toVar()
            : float(1.0).toVar();
          ph.mulAssign(bandLo.mul(bandHi).mul(this.amplitude).mul(this.amplitude));

          // Diskretisierung: die Spektraldichte muss mit der Modenfläche
          // dk^2 = (2*pi/L)^2 gewichtet werden, sonst hängt die Wellenhöhe
          // an der Auflösung statt an der Physik.
          const dk = (Math.PI * 2) / c.patch;
          ph.mulAssign(float(dk * dk));
          // Kalibrierkonstante: bringt die Wellenhöhe bei 11.5 m/s Wind auf
          // rund 1.8 m signifikante Wellenhöhe, wie es der Beaufort-Skala
          // entspricht. `amplitude` bleibt damit ein Regler um 1.0 herum.
          ph.mulAssign(float(SPECTRUM_CALIBRATION * SPECTRUM_CALIBRATION));

          const g = textureLoad(c.noise, ivec2(int(x), int(y))).toVar();
          const s = sqrt(max(0.0, ph)).mul(0.7071).toVar();
          h0.assign(vec2(g.x, g.y).mul(s));
          h0c.assign(vec2(g.z, g.w.negate()).mul(s));
        });

        textureStore(c.h0, uvec2(x, y), vec4(h0, h0c)).toStack();
      })().compute(N * N);

      /* ---- Zeitentwicklung: h(k,t) ---- */
      c.evolveKernel = Fn(() => {
        const x = instanceIndex.mod(uint(N)).toVar();
        const y = instanceIndex.div(uint(N)).toVar();
        const k = kOf(x, y).toVar();
        const kLen = max(1e-5, length(k)).toVar();
        const kHat = k.div(kLen).toVar();

        // Dispersionsrelation für tiefes Wasser, auf ein Vielfaches der
        // Grundfrequenz gerundet -> die Animation kachelt zeitlich sauber.
        const w0 = PI2.div(200.0).toVar();
        const omega = floor(float(Math.sqrt(GRAVITY)).mul(sqrt(kLen)).div(w0)).mul(w0).toVar();
        const phase = omega.mul(this.oceanTime).toVar();
        const cosP = cos(phase).toVar();
        const sinP = sin(phase).toVar();

        const d = textureLoad(c.h0, ivec2(int(x), int(y))).toVar();
        const h0 = d.xy.toVar();
        const h0c = d.zw.toVar();

        // h = h0 * e^{iwt} + conj(h0(-k)) * e^{-iwt}
        const a = vec2(h0.x.mul(cosP).sub(h0.y.mul(sinP)), h0.x.mul(sinP).add(h0.y.mul(cosP))).toVar();
        const b = vec2(h0c.x.mul(cosP).add(h0c.y.mul(sinP)), h0c.x.mul(sinP).negate().add(h0c.y.mul(cosP))).toVar();
        const h = a.add(b).toVar();
        const ih = vec2(h.y.negate(), h.x).toVar();          // i * h

        // Real-Paar-Packung: zwei reelle Signale je komplexer Transformation
        const dx = ih.mul(kHat.x).toVar();
        const dz = ih.mul(kHat.y).toVar();
        const dy = h.toVar();
        const dxz = h.negate().mul(kHat.x).mul(kHat.y).mul(kLen).toVar();

        const dyx = ih.mul(k.x).toVar();
        const dyz = ih.mul(k.y).toVar();
        const dxx = h.negate().mul(kHat.x).mul(kHat.x).mul(kLen).toVar();
        const dzz = h.negate().mul(kHat.y).mul(kHat.y).mul(kLen).toVar();

        const packA1 = vec2(dx.x.sub(dz.y), dx.y.add(dz.x)).toVar();
        const packA2 = vec2(dy.x.sub(dxz.y), dy.y.add(dxz.x)).toVar();
        const packB1 = vec2(dyx.x.sub(dyz.y), dyx.y.add(dyz.x)).toVar();
        const packB2 = vec2(dxx.x.sub(dzz.y), dxx.y.add(dzz.x)).toVar();

        textureStore(c.specA, uvec2(x, y), vec4(packA1, packA2)).toStack();
        textureStore(c.specB, uvec2(x, y), vec4(packB1, packB2)).toStack();
      })().compute(N * N);

      c.kernelsA = c.fft.buildKernels(c.specA, c.outA, { stage: c.stage });
      c.kernelsB = c.fft.buildKernels(c.specB, c.outB, { stage: c.stageB });
    }
  }

  /**
   * Statistik der Auslenkung (min/max/RMS in Metern) von der GPU holen.
   * Nur zum Abstimmen der Wellenhöhe gedacht, nicht im Spielbetrieb.
   */
  async stats(renderer, cascadeIndex = 0) {
    const c = this.cascades[cascadeIndex];
    if (!c._statsBuf) {
      c._statsBuf = instancedArray(4, 'float').setName('oceanStats');
      const N = c.N;
      c._statsKernel = Fn(() => {
        const minY = float(1e9).toVar();
        const maxY = float(-1e9).toVar();
        const sum2 = float(0.0).toVar();
        const step = 8;
        Loop(N / step, N / step, ({ i, j }) => {
          const v = textureLoad(c.outA, ivec2(int(i).mul(step), int(j).mul(step))).toVar();
          minY.assign(min(minY, v.z));
          maxY.assign(max(maxY, v.z));
          sum2.addAssign(v.z.mul(v.z));
        });
        c._statsBuf.element(uint(0)).assign(minY);
        c._statsBuf.element(uint(1)).assign(maxY);
        c._statsBuf.element(uint(2)).assign(sqrt(sum2.div(float((N / step) * (N / step)))));
        c._statsBuf.element(uint(3)).assign(float(c.patch));
      })().compute(1);
    }
    renderer.compute(c._statsKernel);
    const buf = await renderer.getArrayBufferAsync(c._statsBuf.value);
    const f = new Float32Array(buf);
    return { min: f[0], max: f[1], rms: f[2], patch: f[3] };
  }

  async bake(renderer) {
    for (const c of this.cascades) {
      if (c._baked) continue;
      await renderer.computeAsync(c.h0Kernel);
      c._baked = true;
    }
  }

  /** Neu backen, wenn sich Wind oder Amplitude geändert haben. */
  rebake(renderer) {
    for (const c of this.cascades) renderer.compute(c.h0Kernel);
  }

  /**
   * Meldet die Figur ans Wasser.
   * @param {{x:number,z:number}|null} pos Weltposition, null = niemand im Wasser
   * @param {number} tiefe Eintauchtiefe in Metern
   * @param {number} tempo Horizontales Tempo in m/s
   */
  setWakeSource(pos, tiefe = 0, tempo = 0) {
    if (!pos || tiefe <= 0) {
      // sanft ausklingen statt hart abschalten
      this.wakeStrength.value = Math.max(0, this.wakeStrength.value - 0.06);
      return;
    }
    this.wakePos.value.set(pos.x, pos.z);
    this.wakeSpeed.value = tempo;
    const ziel = Math.min(1, tiefe / 0.9);
    this.wakeStrength.value += (ziel - this.wakeStrength.value) * 0.25;
  }

  update(renderer, dt, camera) {
    this.oceanTime.value += dt * this.timeScale.value;
    this.wakeTime.value += dt;

    for (const c of this.cascades) {
      renderer.compute(c.evolveKernel);
      c.fft.run(renderer, c.kernelsA, { stage: c.stage });
      c.fft.run(renderer, c.kernelsB, { stage: c.stageB });
    }

    // Netz der Kamera nachführen, auf ein grobes Raster gerastet, damit die
    // Scheitelpunkte nicht relativ zur Welt wandern (kein Kriechen).
    const snap = 8.0;
    const ox = Math.round(camera.position.x / snap) * snap;
    const oz = Math.round(camera.position.z / snap) * snap;
    this.origin.value.set(ox, oz);
    this.mesh.position.set(ox, this.seaLevel.value, oz);
  }

  /**
   * Ringwellen um die Figur. Rueckgabe: x = Hoehe, y = Schaumanteil.
   *
   * Die Ringe laufen nach aussen (Phase minus Zeit), klingen mit dem Abstand
   * ab und werden am Rand des Wirkradius weich ausgeblendet, damit keine
   * harte Kante entsteht.
   */
  wakeAt(worldXZ) {
    const d = length(worldXZ.sub(this.wakePos)).toVar();
    const rand = saturate(float(1.0).sub(d.div(this.wakeRadius))).toVar();
    const huelle = rand.mul(rand).toVar();                    // weicher Rand

    const phase = d.mul(2.6).sub(this.wakeTime.mul(7.0)).toVar();
    const ring = sin(phase).mul(exp(d.mul(-0.45))).toVar();

    const hoehe = ring.mul(this.wakeAmplitude).mul(huelle).mul(this.wakeStrength).toVar();

    // Schaum direkt um die Figur, staerker wenn sie sich schnell bewegt
    const nah = saturate(float(1.0).sub(d.div(this.wakeRadius.mul(0.45)))).toVar();
    const schaum = nah.mul(nah).mul(this.wakeStrength)
      .mul(saturate(this.wakeSpeed.mul(0.22)).add(0.25))
      .mul(saturate(ring.mul(0.5).add(0.75))).toVar();

    return vec2(hoehe, saturate(schaum));
  }

  /* ---------------------------------------------------------------- Abtaster */

  /** Verschiebung an einer Weltposition (nur GPU-seitig). */
  displacementAt(worldXZ) {
    const total = vec3(0.0).toVar();
    for (const c of this.cascades) {
      const uv = worldXZ.div(float(c.patch));
      const s = textureLevel(c.outA, uv, 0).toVar();
      total.addAssign(vec3(s.x.mul(this.choppiness), s.z, s.y.mul(this.choppiness)));
    }
    return total;
  }

  /**
   * CPU-Näherung der Wellenhöhe für Physik und Bootsauftrieb.
   * Rekonstruiert die drei stärksten Gerstner-artigen Komponenten statt die
   * GPU zu befragen – reicht für Auftrieb und Wasserstand völlig aus.
   */
  heightAt(x, z, t = this.oceanTime.value) {
    const w = this.windDir.value;
    const A = this.amplitude.value;
    let h = 0;
    const comps = [
      [340 / 3.0, 0.55, 0.0],
      [340 / 7.0, 0.32, 1.1],
      [38 / 2.0, 0.12, 2.3],
      [38 / 5.0, 0.06, 4.1],
    ];
    for (const [len, amp, ph] of comps) {
      const k = (Math.PI * 2) / len;
      const omega = Math.sqrt(GRAVITY * k);
      const dx = w.x * Math.cos(ph) - w.y * Math.sin(ph);
      const dz = w.x * Math.sin(ph) + w.y * Math.cos(ph);
      h += amp * A * Math.sin(k * (dx * x + dz * z) - omega * t + ph);
    }
    return h + this.seaLevel.value;
  }

  /* ------------------------------------------------------------------ Netz */

  _buildMesh(hi) {
    const A = hi ? 320 : 192;          // Winkelsegmente
    const R = hi ? 300 : 180;          // Radialringe
    const rMin = 0.65;
    const rMax = 26000;

    const vertCount = (R + 1) * (A + 1);
    const pos = new Float32Array(vertCount * 3);
    const dist = new Float32Array(vertCount);

    let p = 0, d = 0;
    for (let i = 0; i <= R; i++) {
      // exponentiell wachsender Radius: dichte Scheitelpunkte nah an der Kamera
      const t = i / R;
      const r = rMin * Math.pow(rMax / rMin, t);
      for (let j = 0; j <= A; j++) {
        const a = (j / A) * Math.PI * 2;
        pos[p++] = Math.cos(a) * r;
        pos[p++] = 0;
        pos[p++] = Math.sin(a) * r;
        dist[d++] = r;
      }
    }

    const idx = [];
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < A; j++) {
        const a0 = i * (A + 1) + j;          // Ring i,   Winkel j
        const b0 = a0 + 1;                   // Ring i,   Winkel j+1
        const a1 = (i + 1) * (A + 1) + j;    // Ring i+1, Winkel j
        const b1 = a1 + 1;
        // Reihenfolge so, dass die Flächennormale nach oben zeigt: mit der
        // umgekehrten Wicklung cullt FrontSide genau die Wellenflanken weg,
        // die zur Kamera zeigen – man sieht dann durch das Wasser hindurch.
        idx.push(a0, b0, a1, b0, b1, a1);
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('radialDist', new BufferAttribute(dist, 1));
    geo.setIndex(idx.length > 65535 ? new BufferAttribute(new Uint32Array(idx), 1)
      : new BufferAttribute(new Uint16Array(idx), 1));
    geo.boundingSphere = null;
    geo.computeBoundingSphere();
    geo.boundingSphere.radius = rMax * 1.2;

    const mat = this._buildMaterial();
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder = 1;
    mesh.name = 'Ocean';
    return mesh;
  }

  _buildMaterial() {
    const mat = new MeshPhysicalNodeMaterial();
    mat.side = FrontSide;
    mat.metalness = 0.0;
    mat.transmission = 0.0;
    mat.name = 'OceanMaterial';

    const radial = attribute('radialDist', 'float');

    /* --- gemeinsamer Abtastblock: Verschiebung und Ableitungen --- */
    const sampleWaves = (worldXZ, lodFade) => {
      const disp = vec3(0.0).toVar();
      const slope = vec2(0.0).toVar();
      const jacobian = vec2(0.0).toVar();   // (Dxx, Dzz)
      const dxz = float(0.0).toVar();

      this.cascades.forEach((c, i) => {
        const uv = worldXZ.div(float(c.patch));
        // feine Kaskaden in der Ferne ausblenden -> kein Aliasing am Horizont
        const fade = i === 0 ? float(1.0)
          : saturate(float(1.0).sub(smoothstep(float(120.0), float(700.0), lodFade)));
        const a = textureLevel(c.outA, uv, 0).toVar();
        const b = textureLevel(c.outB, uv, 0).toVar();
        disp.addAssign(vec3(a.x.mul(this.choppiness), a.z, a.y.mul(this.choppiness)).mul(fade));
        slope.addAssign(vec2(b.x, b.y).mul(fade));
        jacobian.addAssign(vec2(b.z, b.w).mul(fade));
        dxz.addAssign(a.w.mul(fade));
      });

      return { disp, slope, jacobian, dxz };
    };

    /* ------------------------------ Scheitelpunkt ------------------------------ */
    mat.positionNode = Fn(() => {
      const local = positionLocal.toVar();
      const worldXZ = local.xz.add(this.origin).toVar();
      const r = radial.toVar();

      const { disp } = sampleWaves(worldXZ, r);

      // ganz außen flach auslaufen lassen, damit der Horizont ruhig bleibt
      const horizonFade = saturate(float(1.0).sub(smoothstep(float(2500.0), float(9000.0), r))).toVar();

      // Erdkrümmung: ohne sie bleibt die Ebene bis zum Meshrand auf Höhe null
      // und endet als sichtbare Kante *über* dem echten Horizont.
      // Absenkung = r^2 / (2 * Erdradius).
      const drop = r.mul(r).div(2.0 * 6371000.0).toVar();

      const wake = this.wakeAt(worldXZ).x.toVar();

      return vec3(
        local.x.add(disp.x.mul(horizonFade)),
        disp.y.mul(horizonFade).add(wake.mul(horizonFade)).sub(drop),
        local.z.add(disp.z.mul(horizonFade)),
      );
    })();

    /* ------------------------------ Normale ------------------------------ */
    // Achtung: im Fragment muss die *unverschobene* Position abgetastet werden.
    // `positionWorld` ist bereits ausgelenkt und würde die Wellen doppelt
    // verzerren. Das Attribut wird automatisch als Varying durchgereicht.
    const worldXZFrag = positionLocal.xz.add(this.origin).toVar();
    const radialFrag = radial.toVar();

    /** rg = Neigung, b = Jacobi-Determinante (Gischt), a = Kaskadenmischung */
    const fragWaves = Fn(() => {
      const { slope, jacobian, dxz } = sampleWaves(worldXZFrag, radialFrag);
      const ch = this.choppiness.mul(this.foamJacobian).toVar();
      const jx = float(1.0).add(jacobian.x.mul(ch)).toVar();
      const jz = float(1.0).add(jacobian.y.mul(ch)).toVar();
      const cross2 = dxz.mul(ch).toVar();
      const J = jx.mul(jz).sub(cross2.mul(cross2)).toVar();
      return vec4(slope.x, slope.y, J, 0.0);
    })();

    const oceanNormal = Fn(() => {
      const s = fragWaves.xy.toVar();
      const n = normalize(vec3(s.x.negate(), 1.0, s.y.negate())).toVar();
      // Richtung Horizont zur Senkrechten ziehen -> das Spiegelbild bleibt ruhig
      const flat = saturate(smoothstep(float(500.0), float(4000.0), radialFrag)).toVar();
      return normalize(mix(n, vec3(0.0, 1.0, 0.0), flat));
    })();

    mat.normalNode = transformNormalToView(oceanNormal);

    /* ------------------------------ Gischt ------------------------------ */
    // Die Jacobi-Determinante der horizontalen Auslenkung wird negativ, wo
    // sich die Oberfläche selbst überschlägt – genau dort bricht die Welle.
    const foam = Fn(() => {
      const J = fragWaves.z.toVar();
      const folded = saturate(this.foamThreshold.sub(J).mul(2.2)).toVar();
      const n1 = fract(sin(dot(worldXZFrag.mul(1.7), vec2(12.9898, 78.233))).mul(43758.5453)).toVar();
      const n2 = fract(sin(dot(worldXZFrag.mul(0.41), vec2(39.3468, 11.135))).mul(24634.6345)).toVar();
      const grain = mix(n1, n2, 0.5).mul(0.5).add(0.68).toVar();
      const eigen = saturate(folded.mul(grain).mul(this.foamStrength)).toVar();
      const durchFigur = this.wakeAt(worldXZFrag).y.toVar();
      return saturate(max(eigen, durchFigur));
    })();

    /* ------------------------------ Optik ------------------------------
     * Wasser wird bewusst *nicht* über die automatische Umgebungsbeleuchtung
     * schattiert. Ein Dielektrikum mit F0 = 0.02 lebt fast vollständig von
     * der winkelabhängigen Spiegelung, und die will explizit mit Fresnel
     * gewichtet und am Horizont beschnitten werden. Die Sonnenspiegelung
     * (GGX) kommt weiter aus dem Direktlicht des Materials.
     * ------------------------------------------------------------------ */
    mat.envMapIntensity = 0.0;

    const viewDir = Fn(() => normalize(cameraPosition.sub(positionWorld)))();

    mat.colorNode = Fn(() => {
      const f = foam.toVar();
      // Der diffuse Anteil ist nur der Gischtschaum – der Wasserkörper selbst
      // wird über emissiveNode als Streulicht aufgebaut.
      return vec4(mix(vec3(0.0), this.foamColor, f), 1.0);
    })();

    mat.roughnessNode = Fn(() => {
      const f = foam.toVar();
      // Entfernungsabhängig aufrauen: bekämpft das Funkelaliasing am Horizont
      const distRough = smoothstep(float(80.0), float(1600.0), radialFrag).mul(0.18).toVar();
      return clamp(this.roughnessBase.add(distRough).add(f.mul(0.70)), 0.02, 1.0);
    })();

    mat.metalnessNode = float(0.0);

    mat.emissiveNode = Fn(() => {
      const n = oceanNormal.toVar();
      const v = viewDir.toVar();
      const l = normalize(this.atmo.sunDirection).toVar();
      const ndv = saturate(dot(n, v)).toVar();
      const f = foam.toVar();
      const sunRadiance = this.atmo.sunColorU.mul(this.atmo.sunLuminanceU).toVar();

      /* --- Spiegelung des Himmels, Schlick-Fresnel für F0 = 0.02 --- */
      const F = float(0.02).add(float(0.98).mul(pow(float(1.0).sub(ndv), 5.0))).toVar();
      const r = reflect(v.negate(), n).toVar();
      // Wellenflanken können den Reflexionsstrahl unter den Horizont kippen.
      // Dort ist der Himmel schwarz, was als harte dunkle Kante auffiele –
      // also nach oben zurückklappen statt abzuschneiden.
      const rUp = normalize(vec3(r.x, abs(r.y).add(0.0025), r.z)).toVar();
      const rough = clamp(this.roughnessBase.add(smoothstep(float(80.0), float(1600.0), radialFrag).mul(0.18)), 0.02, 1.0).toVar();
      const skyRefl = this.sky.specularSky(rUp, rough).toVar();

      const reflection = skyRefl.mul(F).mul(this.reflectionStrength).mul(float(1.0).sub(f.mul(0.85))).toVar();

      /* --- Streuung im Wasserkörper --- */
      // Höhe über dem Mittelwasser: Kämme streuen deutlich mehr als Täler
      const h = saturate(positionWorld.y.sub(this.seaLevel).mul(0.9).add(0.35)).toVar();
      const towardsView = pow(saturate(dot(l, v.negate())), 4.0).toVar();
      const thin = pow(saturate(float(0.5).sub(dot(l, n).mul(0.5))), 3.0).toVar();
      const sunScatter = this.scatterColor
        .mul(sunRadiance)
        .mul(towardsView.mul(thin).mul(h.mul(0.6).add(0.4)))
        .mul(this.sssStrength)
        .toVar();

      // Von oben eingestreutes Himmelslicht, das aus dem Wasser zurückkommt.
      // Es klingt mit der Blickneigung ab: steil nach unten sieht man tiefer
      // ins Wasser hinein und damit dunkler.
      const skyIrr = this.sky.irradiance(vec3(0.0, 1.0, 0.0)).toVar();
      const body = mix(this.deepColor, this.shallowColor, pow(ndv, 0.6)).toVar();
      const ambient = body.mul(skyIrr).mul(this.ambientScatter).toVar();

      /* --- Gischt ist ein dichtes Blasenmedium und streut fast alles zurück --- */
      const foamLit = this.sky.irradiance(n).mul(this.foamColor).mul(f).mul(0.9)
        .add(this.foamColor.mul(sunRadiance).mul(saturate(dot(n, l))).mul(f).mul(0.16))
        .toVar();


      return reflection.add(sunScatter).add(ambient).add(foamLit);
    })();

    return mat;
  }
}
