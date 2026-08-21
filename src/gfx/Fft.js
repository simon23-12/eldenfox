import { StorageTexture, DataTexture, RGBAFormat, FloatType, HalfFloatType, NearestFilter, LinearFilter, ClampToEdgeWrapping, RepeatWrapping } from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, int, uint, uvec2, ivec2, instanceIndex, textureStore, textureLoad,
  If, Loop, cos, sin, exp, sqrt, log, max, min, abs, floor, mod, select, PI, PI2, atan, pow, dot, length,
} from 'three/tsl';

/**
 * GPU-Fouriertransformation über Schmetterlingsstufen.
 *
 * Zwei komplexe Signale je Textur (rg und ba) werden gleichzeitig
 * transformiert. Der Ablauf ist der klassische Cooley-Tukey mit
 * vorberechneter Schmetterlingstextur: log2(N) waagerechte, dann log2(N)
 * senkrechte Stufen mit Ping-Pong zwischen zwei Puffern.
 */
export class Fft2D {
  /** @param {number} size Zweierpotenz, typischerweise 256. */
  constructor(size = 256) {
    this.N = size;
    this.stages = Math.log2(size);
    if (!Number.isInteger(this.stages)) throw new Error('FFT-Größe muss Zweierpotenz sein');

    this.butterfly = this._makeButterflyTexture();
    this.pingPong = makeStorage(size, size, FloatType);   // nur textureLoad -> kein Filter nötig
  }

  /** Bit-Umkehr-Tabelle und Drehfaktoren, einmalig auf der CPU erzeugt. */
  _makeButterflyTexture() {
    const { N, stages } = this;
    const data = new Float32Array(stages * N * 4);

    const bitReverse = (i) => {
      let r = 0;
      for (let b = 0; b < stages; b++) { r = (r << 1) | ((i >> b) & 1); }
      return r >>> 0;
    };

    for (let s = 0; s < stages; s++) {
      for (let y = 0; y < N; y++) {
        const span = 1 << s;
        const k = ((y * (N / (span * 2))) % N);
        const ang = (PI2_JS * k) / N;
        const tw = [Math.cos(ang), Math.sin(ang)];

        let top, bottom;
        const inLower = (y % (span * 2)) < span;
        if (s === 0) {
          top = inLower ? bitReverse(y) : bitReverse(y - 1);
          bottom = inLower ? bitReverse(y + 1) : bitReverse(y);
        } else {
          top = inLower ? y : y - span;
          bottom = inLower ? y + span : y;
        }

        const idx = (s + y * stages) * 4;
        data[idx + 0] = tw[0];
        data[idx + 1] = tw[1];
        data[idx + 2] = top;
        data[idx + 3] = bottom;
      }
    }

    const t = new DataTexture(data, stages, N, RGBAFormat, FloatType);
    t.minFilter = NearestFilter;
    t.magFilter = NearestFilter;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }

  /**
   * Baut die Kernel für ein Spektrum.
   *
   * Wichtig: Eine Textur darf in *einem* Dispatch nie gleichzeitig gelesen
   * und geschrieben werden – WebGPU verbietet die Doppelbindung. Deshalb
   * pingpongt die Transformation zwischen `spectrum` und `pingPong`, und die
   * abschließende Permutation schreibt in eine eigene Ausgabetextur.
   *
   * @param {StorageTexture} spectrum Eingang (rg + ba = zwei komplexe Signale)
   * @param {StorageTexture} output   gefilterte Ausgabe für die Materialien
   * @param {object} uniforms         { stage } als TSL-Uniform
   */
  buildKernels(spectrum, output, uniforms) {
    const { N } = this;
    const bf = this.butterfly;
    const pp = this.pingPong;

    const complexMul = (a, b) =>
      vec2(a.x.mul(b.x).sub(a.y.mul(b.y)), a.x.mul(b.y).add(a.y.mul(b.x)));

    /** Eine Schmetterlingsstufe. `horizontal` schaltet die Achse um. */
    const makeStage = (horizontal, src, dst) => Fn(() => {
      const x = instanceIndex.mod(uint(N)).toVar();
      const y = instanceIndex.div(uint(N)).toVar();
      const axis = horizontal ? int(x) : int(y);

      const data = textureLoad(bf, ivec2(int(uniforms.stage), axis)).toVar();
      const twiddle = data.xy.toVar();
      const iTop = int(data.z).toVar();
      const iBot = int(data.w).toVar();

      const cTop = horizontal ? ivec2(iTop, int(y)) : ivec2(int(x), iTop);
      const cBot = horizontal ? ivec2(iBot, int(y)) : ivec2(int(x), iBot);

      const a = textureLoad(src, cTop).toVar();
      const b = textureLoad(src, cBot).toVar();

      // zwei unabhängige komplexe Signale in rg und ba
      const r0 = a.xy.add(complexMul(twiddle, b.xy)).toVar();
      const r1 = a.zw.add(complexMul(twiddle, b.zw)).toVar();

      textureStore(dst, uvec2(x, y), vec4(r0, r1)).toStack();
    })().compute(N * N);

    return {
      hToPing: makeStage(true, spectrum, pp),
      hToSpec: makeStage(true, pp, spectrum),
      vToPing: makeStage(false, spectrum, pp),
      vToSpec: makeStage(false, pp, spectrum),
      /** Vorzeichenpermutation und Normierung, Ergebnis in `output`. */
      permute: Fn(() => {
        const x = instanceIndex.mod(uint(N)).toVar();
        const y = instanceIndex.div(uint(N)).toVar();
        const v = textureLoad(spectrum, ivec2(int(x), int(y))).toVar();
        const perm = select(
          int(x).add(int(y)).mod(int(2)).equal(int(0)),
          float(1.0), float(-1.0),
        ).toVar();
        textureStore(output, uvec2(x, y), v.mul(perm)).toStack();
      })().compute(N * N),
    };
  }

  /**
   * Vollständige inverse Transformation. 2*log2(N) Stufen sind immer
   * geradzahlig, das Ergebnis landet daher stets wieder im Spektrumpuffer.
   */
  run(renderer, kernels, uniforms) {
    let inSpectrum = true;
    for (let s = 0; s < this.stages; s++) {
      uniforms.stage.value = s;
      renderer.compute(inSpectrum ? kernels.hToPing : kernels.hToSpec);
      inSpectrum = !inSpectrum;
    }
    for (let s = 0; s < this.stages; s++) {
      uniforms.stage.value = s;
      renderer.compute(inSpectrum ? kernels.vToPing : kernels.vToSpec);
      inSpectrum = !inSpectrum;
    }
    renderer.compute(kernels.permute);
  }
}

const PI2_JS = Math.PI * 2;

export function makeStorage(w, h, type = HalfFloatType, filter = NearestFilter) {
  const t = new StorageTexture(w, h);
  t.type = type;
  t.format = RGBAFormat;
  t.minFilter = filter;
  t.magFilter = filter;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.generateMipmaps = false;
  return t;
}
