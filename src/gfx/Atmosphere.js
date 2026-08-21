import { StorageTexture, Storage3DTexture, HalfFloatType, RGBAFormat, LinearFilter, ClampToEdgeWrapping, Vector3, Color } from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, texture3D, textureLevel, textureStore, storageTexture3D, instancedArray,
  instanceIndex, If, Loop, exp, max, min, clamp, sqrt, pow, dot, normalize, length,
  sin, cos, acos, atan, abs, sign, mix, saturate, PI, PI2, select, uvec2, uvec3, int, uint, step,
} from 'three/tsl';

/* ============================================================================
 * Physikalisch basierte Atmosphäre nach Hillaire 2020
 * ("A Scalable and Production Ready Sky and Atmosphere Rendering Technique").
 *
 * Vier Nachschlagetabellen, alle per Compute-Shader erzeugt:
 *   1. Transmission        256x64   – einmalig gebacken
 *   2. Mehrfachstreuung     32x32   – einmalig gebacken
 *   3. Himmelsansicht      256x144  – pro Frame (Sonnenstand, Kamerahöhe)
 *   4. Luftperspektive   32x32x32   – pro Frame, 3D, für Fernnebel und Dunst
 *
 * Gerechnet wird in Megametern (1 MM = 1000 km), damit die Zahlen klein bleiben.
 * ========================================================================== */

const GROUND_RADIUS = 6.360;
const ATMOS_RADIUS = 6.460;

const RAYLEIGH_SCATTER = [5.802, 13.558, 33.100];   // pro Megameter
const MIE_SCATTER = 3.996;
const MIE_ABSORB = 4.400;
const OZONE_ABSORB = [0.650, 1.881, 0.085];

const TRANS_W = 256, TRANS_H = 64;
const MULTI_W = 32, MULTI_H = 32;
const SKY_W = 256, SKY_H = 144;
const AP_W = 32, AP_H = 32, AP_D = 32;

function makeLut2D(w, h) {
  const t = new StorageTexture(w, h);
  t.type = HalfFloatType;          // rgba16float: schreibbar *und* filterbar
  t.format = RGBAFormat;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = false;
  return t;
}

export class Atmosphere {
  constructor({ apRangeMeters = 6000 } = {}) {
    this.sunDirection = uniform(new Vector3(0.0, 0.12, -1.0).normalize());
    this.sunIntensity = uniform(24.0);
    this.cameraHeight = uniform(0.00002);
    this.apRangeMeters = apRangeMeters;
    this.apRange = uniform(apRangeMeters / 1e6);
    this.groundAlbedo = uniform(new Vector3(0.22, 0.21, 0.18));
    this.mieG = uniform(0.80);
    this.turbidity = uniform(1.0);

    this.camForward = uniform(new Vector3(0, 0, -1));
    this.camRight = uniform(new Vector3(1, 0, 0));
    this.camUp = uniform(new Vector3(0, 1, 0));
    this.camTanX = uniform(1.0);
    this.camTanY = uniform(0.6);

    this.transLut = makeLut2D(TRANS_W, TRANS_H);
    this.multiLut = makeLut2D(MULTI_W, MULTI_H);
    this.skyLut = makeLut2D(SKY_W, SKY_H);

    this.apLut = new Storage3DTexture(AP_W, AP_H, AP_D);
    this.apLut.type = HalfFloatType;
    this.apLut.format = RGBAFormat;
    this.apLut.minFilter = LinearFilter;
    this.apLut.magFilter = LinearFilter;
    this.apLut.wrapS = this.apLut.wrapT = this.apLut.wrapR = ClampToEdgeWrapping;

    this.sunColor = new Color(1, 1, 1);
    this.sunLuminance = 1;
    // gleiche Werte als Uniforms, damit eigene Shader sie direkt nutzen können
    this.sunColorU = uniform(new Vector3(1, 1, 1));
    this.sunLuminanceU = uniform(1.0);
    this.zenithColor = new Color(0.3, 0.45, 0.8);
    this.horizonColor = new Color(0.8, 0.6, 0.45);
    this._baked = false;

    this._buildTsl();
  }

  /* ------------------------------------------------------------------ TSL */

  _buildTsl() {
    const groundR = float(GROUND_RADIUS);
    const atmosR = float(ATMOS_RADIUS);
    const rayleighBase = vec3(...RAYLEIGH_SCATTER);
    const ozoneBase = vec3(...OZONE_ABSORB);

    /**
     * Nächster positiver Schnittpunkt Strahl/Kugel um den Ursprung; -1 wenn keiner.
     *
     * Die naive Formel -b ± sqrt(b²-c) löscht sich aus, sobald der Beobachter
     * nur wenige Meter über der Kugel steht: b² und c sind dann fast gleich
     * groß. Das Ergebnis kippt auf die falsche Wurzel, der Blick nach unten
     * integriert plötzlich einen Weg quer durch die halbe Erde und der
     * Horizont leuchtet knallrot. Daher hier die betragsgroße Wurzel direkt
     * und die kleine über den Satz von Vieta (t0·t1 = c).
     */
    const raySphere = Fn(([ro, rd, rad]) => {
      const b = dot(ro, rd).toVar();
      const c = dot(ro, ro).sub(rad.mul(rad)).toVar();
      const d = b.mul(b).sub(c).toVar();
      const res = float(-1).toVar();
      If(d.greaterThanEqual(0.0), () => {
        const sq = sqrt(d).toVar();
        const q = select(b.lessThan(0.0), b.negate().add(sq), b.negate().sub(sq)).toVar();
        const qSafe = select(abs(q).lessThan(1e-20), float(1e-20), q).toVar();
        const tA = q.toVar();
        const tB = c.div(qSafe).toVar();
        const tNear = min(tA, tB).toVar();
        const tFar = max(tA, tB).toVar();
        res.assign(select(
          tNear.greaterThanEqual(0.0), tNear,
          select(tFar.greaterThanEqual(0.0), tFar, float(-1.0)),
        ));
      });
      return res;
    });
    this.raySphere = raySphere;

    /**
     * Medium an einer Position (MM vom Erdmittelpunkt).
     * Bewusst kein Fn(): liefert mehrere Knoten und wird inline eingebaut.
     */
    const sampleMedium = (pos) => {
      const altKM = length(pos).sub(groundR).mul(1000.0).toVar();
      const rayleighDensity = exp(altKM.div(-8.0)).toVar();
      const mieDensity = exp(altKM.div(-1.2)).mul(this.turbidity).toVar();
      const ozoneDensity = max(0.0, float(1.0).sub(abs(altKM.sub(25.0)).div(15.0))).toVar();

      const rayleighScat = rayleighBase.mul(rayleighDensity).toVar();
      const mieScat = float(MIE_SCATTER).mul(mieDensity).toVar();
      const extinction = rayleighScat
        .add(mieScat)
        .add(float(MIE_ABSORB).mul(mieDensity))
        .add(ozoneBase.mul(ozoneDensity))
        .toVar();
      return { rayleighScat, mieScat, extinction };
    };
    this.sampleMedium = sampleMedium;

    const miePhase = (cosT) => {
      const g = this.mieG;
      const g2 = g.mul(g);
      const num = float(1.0).sub(g2).mul(float(1.0).add(cosT.mul(cosT)));
      const den = float(2.0).add(g2).mul(pow(max(1e-4, float(1.0).add(g2).sub(g.mul(cosT).mul(2.0))), 1.5));
      return float(3.0).div(float(8.0).mul(PI)).mul(num).div(max(1e-4, den));
    };
    const rayleighPhase = (cosT) =>
      float(3.0).div(float(16.0).mul(PI)).mul(float(1.0).add(cosT.mul(cosT)));

    /* ---------- Transmissions-LUT: Parametrisierung ---------- */
    const transUvToRMu = Fn(([uv]) => {
      const H = sqrt(atmosR.mul(atmosR).sub(groundR.mul(groundR))).toVar();
      const rho = H.mul(uv.y).toVar();
      const r = sqrt(rho.mul(rho).add(groundR.mul(groundR))).toVar();
      const dMin = atmosR.sub(r).toVar();
      const dMax = rho.add(H).toVar();
      const d = dMin.add(uv.x.mul(dMax.sub(dMin))).toVar();
      const mu = select(
        d.lessThan(1e-7),
        float(1.0),
        atmosR.mul(atmosR).sub(r.mul(r)).sub(d.mul(d)).div(max(1e-7, r.mul(d).mul(2.0))),
      ).toVar();
      return vec2(r, clamp(mu, -1.0, 1.0));
    });

    const transRMuToUv = Fn(([r, mu]) => {
      const H = sqrt(max(0.0, atmosR.mul(atmosR).sub(groundR.mul(groundR)))).toVar();
      const rho = sqrt(max(0.0, r.mul(r).sub(groundR.mul(groundR)))).toVar();
      const disc = r.mul(r).mul(mu.mul(mu).sub(1.0)).add(atmosR.mul(atmosR)).toVar();
      const d = max(0.0, r.mul(mu).negate().add(sqrt(max(0.0, disc)))).toVar();
      const dMin = atmosR.sub(r).toVar();
      const dMax = rho.add(H).toVar();
      return vec2(
        clamp(d.sub(dMin).div(max(1e-7, dMax.sub(dMin))), 0.0, 1.0),
        clamp(rho.div(max(1e-7, H)), 0.0, 1.0),
      );
    });

    /** Transmission Boden->Weltraum aus der LUT. */
    this.transmittance = Fn(([r, mu]) =>
      textureLevel(this.transLut, transRMuToUv(r, mu), 0).rgb,
    );

    /** Transmission per Raymarch (nur zum Backen der LUT). */
    const marchTransmittance = Fn(([pos, dir]) => {
      const tAtmo = raySphere(pos, dir, atmosR).toVar();
      const steps = 40;
      const dt = max(0.0, tAtmo).div(float(steps)).toVar();
      const transmit = vec3(1.0).toVar();
      Loop(steps, ({ i }) => {
        const p = pos.add(dir.mul(dt.mul(float(i).add(0.5)))).toVar();
        const m = sampleMedium(p);
        transmit.mulAssign(exp(m.extinction.mul(dt).negate()));
      });
      return transmit;
    });

    this.transKernel = Fn(() => {
      const px = instanceIndex.mod(uint(TRANS_W)).toVar();
      const py = instanceIndex.div(uint(TRANS_W)).toVar();
      const uv = vec2(
        float(px).add(0.5).div(float(TRANS_W)),
        float(py).add(0.5).div(float(TRANS_H)),
      ).toVar();
      const rmu = transUvToRMu(uv).toVar();
      const r = rmu.x.toVar(), mu = rmu.y.toVar();
      const pos = vec3(0.0, r, 0.0).toVar();
      const dir = vec3(sqrt(max(0.0, float(1.0).sub(mu.mul(mu)))), mu, 0.0).toVar();
      textureStore(this.transLut, uvec2(px, py), vec4(marchTransmittance(pos, dir), 1.0)).toStack();
    })().compute(TRANS_W * TRANS_H);

    /** Mehrfachstreuung nachschlagen (isotrop). */
    this.multiScatter = Fn(([r, mu]) =>
      textureLevel(this.multiLut, vec2(
        mu.mul(0.5).add(0.5),
        saturate(r.sub(groundR).div(atmosR.sub(groundR))),
      ), 0).rgb,
    );

    /* ---------- Mehrfachstreuungs-LUT ----------
     * Isotrope Näherung: 8x8 Richtungen, je 20 Schritte. Erfasst Licht
     * zweiter Ordnung und schließt daraus die unendliche Reihe. */
    const MS_DIRS = 8, MS_STEPS = 20;
    this.multiKernel = Fn(() => {
      const px = instanceIndex.mod(uint(MULTI_W)).toVar();
      const py = instanceIndex.div(uint(MULTI_W)).toVar();
      const u = float(px).add(0.5).div(float(MULTI_W)).toVar();
      const v = float(py).add(0.5).div(float(MULTI_H)).toVar();

      const sunCos = u.mul(2.0).sub(1.0).toVar();
      const sunDir = vec3(0.0, sunCos, sqrt(saturate(float(1.0).sub(sunCos.mul(sunCos))))).toVar();
      const r = mix(groundR.add(1e-5), atmosR, v).toVar();
      const pos = vec3(0.0, r, 0.0).toVar();

      const lumTotal = vec3(0.0).toVar();
      const fmsTotal = vec3(0.0).toVar();
      const w = float(1.0).div(float(MS_DIRS * MS_DIRS));

      Loop(MS_DIRS, MS_DIRS, ({ i, j }) => {
        const theta = PI2.mul(float(i).add(0.5)).div(float(MS_DIRS)).toVar();
        const cosPhi = float(1.0).sub(float(2.0).mul(float(j).add(0.5)).div(float(MS_DIRS))).toVar();
        const sinPhi = sqrt(saturate(float(1.0).sub(cosPhi.mul(cosPhi)))).toVar();
        const rayDir = vec3(cos(theta).mul(sinPhi), cosPhi, sin(theta).mul(sinPhi)).toVar();

        const atmoDist = raySphere(pos, rayDir, atmosR).toVar();
        const groundDist = raySphere(pos, rayDir, groundR).toVar();
        const tMax = select(groundDist.greaterThan(0.0), groundDist, max(0.0, atmoDist)).toVar();

        const cosT = dot(rayDir, sunDir).toVar();
        const mPh = miePhase(cosT).toVar();
        const rPh = rayleighPhase(cosT).toVar();

        const lum = vec3(0.0).toVar();
        const fms = vec3(0.0).toVar();
        const transmit = vec3(1.0).toVar();
        const dt = tMax.div(float(MS_STEPS)).toVar();

        Loop(MS_STEPS, ({ i: s }) => {
          const p = pos.add(rayDir.mul(dt.mul(float(s).add(0.3)))).toVar();
          const m = sampleMedium(p);
          const sampleTr = exp(m.extinction.mul(dt).negate()).toVar();
          const invExt = float(1.0).div(max(vec3(1e-6), m.extinction)).toVar();

          // Anteil ohne Sonnenlicht -> speist die Reihe
          const scatterNoPhase = m.rayleighScat.add(m.mieScat).toVar();
          fms.addAssign(transmit.mul(scatterNoPhase.sub(scatterNoPhase.mul(sampleTr)).mul(invExt)));

          const rr = length(p).toVar();
          const sunTr = this.transmittance(rr, dot(normalize(p), sunDir)).toVar();
          const shadow = step(0.0, raySphere(p, sunDir, groundR).negate()).toVar();
          const inScatter = m.rayleighScat.mul(rPh).add(m.mieScat.mul(mPh)).mul(sunTr).mul(shadow).toVar();
          lum.addAssign(transmit.mul(inScatter.sub(inScatter.mul(sampleTr)).mul(invExt)));
          transmit.mulAssign(sampleTr);
        });

        If(groundDist.greaterThan(0.0), () => {
          const hit = pos.add(rayDir.mul(groundDist)).toVar();
          const n = normalize(hit).toVar();
          const ndl = saturate(dot(n, sunDir)).toVar();
          const gTr = this.transmittance(length(hit), dot(n, sunDir)).toVar();
          lum.addAssign(transmit.mul(this.groundAlbedo).mul(gTr).mul(ndl).div(PI));
        });

        lumTotal.addAssign(lum.mul(w));
        fmsTotal.addAssign(fms.mul(w));
      });

      const psi = lumTotal.div(max(vec3(1e-5), vec3(1.0).sub(fmsTotal))).toVar();
      textureStore(this.multiLut, uvec2(px, py), vec4(psi, 1.0)).toStack();
    })().compute(MULTI_W * MULTI_H);

    /* ---------- Gemeinsamer Raymarch für Himmel & Luftperspektive ---------- */
    this.raymarchScattering = Fn(([pos, rayDir, sunDir, tMax, steps]) => {
      const cosT = dot(rayDir, sunDir).toVar();
      const mPh = miePhase(cosT).toVar();
      const rPh = rayleighPhase(cosT).toVar();

      const lum = vec3(0.0).toVar();
      const transmit = vec3(1.0).toVar();
      const tPrev = float(0.0).toVar();

      Loop({ start: int(0), end: steps, type: 'int', condition: '<' }, ({ i }) => {
        const t = float(i).add(0.3).div(float(steps)).mul(tMax).toVar();
        const dt = max(1e-9, t.sub(tPrev)).toVar();
        tPrev.assign(t);

        const p = pos.add(rayDir.mul(t)).toVar();
        const m = sampleMedium(p);
        const sampleTr = exp(m.extinction.mul(dt).negate()).toVar();
        const invExt = float(1.0).div(max(vec3(1e-6), m.extinction)).toVar();

        const rr = length(p).toVar();
        const upMu = dot(normalize(p), sunDir).toVar();
        const sunTr = this.transmittance(rr, upMu).toVar();
        const psiMs = this.multiScatter(rr, upMu).toVar();
        const shadow = step(0.0, raySphere(p, sunDir, groundR).negate()).toVar();

        // direkt beleuchtete Streuung + bereits integrierte Mehrfachstreuung
        const contribution = m.rayleighScat.mul(rPh).add(m.mieScat.mul(mPh)).mul(sunTr).mul(shadow)
          .add(m.rayleighScat.add(m.mieScat).mul(psiMs))
          .toVar();

        lum.addAssign(transmit.mul(contribution.sub(contribution.mul(sampleTr)).mul(invExt)));
        transmit.mulAssign(sampleTr);
      });

      return vec4(lum, dot(transmit, vec3(1.0 / 3.0)));
    });

    /* ---------- Himmelsansicht-LUT ---------- */
    this.skyKernel = Fn(() => {
      const px = instanceIndex.mod(uint(SKY_W)).toVar();
      const py = instanceIndex.div(uint(SKY_W)).toVar();
      const u = float(px).add(0.5).div(float(SKY_W)).toVar();
      const v = float(py).add(0.5).div(float(SKY_H)).toVar();

      const azimuth = u.sub(0.5).mul(PI2).toVar();
      const c = v.mul(2.0).sub(1.0).toVar();
      const altitude = sign(c).mul(c).mul(c).mul(PI.mul(0.5)).toVar();

      const ca = cos(altitude).toVar();
      const rayDir = vec3(ca.mul(sin(azimuth)), sin(altitude), ca.mul(cos(azimuth)).negate()).toVar();

      const r = groundR.add(this.cameraHeight).toVar();
      const pos = vec3(0.0, r, 0.0).toVar();
      const sunDir = normalize(this.sunDirection).toVar();

      const atmoDist = raySphere(pos, rayDir, atmosR).toVar();
      const groundDist = raySphere(pos, rayDir, groundR).toVar();
      const tMax = select(groundDist.greaterThan(0.0), groundDist, max(0.0, atmoDist)).toVar();

      const res = this.raymarchScattering(pos, rayDir, sunDir, tMax, int(32)).toVar();
      textureStore(this.skyLut, uvec2(px, py), vec4(res.rgb.mul(this.sunIntensity), 1.0)).toStack();
    })().compute(SKY_W * SKY_H);

    /* ---------- Luftperspektiven-LUT (3D) ---------- */
    this.apKernel = Fn(() => {
      const px = instanceIndex.mod(uint(AP_W)).toVar();
      const py = instanceIndex.div(uint(AP_W)).mod(uint(AP_H)).toVar();
      const pz = instanceIndex.div(uint(AP_W * AP_H)).toVar();

      const u = float(px).add(0.5).div(float(AP_W)).toVar();
      const v = float(py).add(0.5).div(float(AP_H)).toVar();
      const w = float(pz).add(0.5).div(float(AP_D)).toVar();

      const ndc = vec2(u.mul(2.0).sub(1.0), v.mul(2.0).sub(1.0)).toVar();
      const dirWorld = normalize(
        this.camForward
          .add(this.camRight.mul(ndc.x.mul(this.camTanX)))
          .add(this.camUp.mul(ndc.y.mul(this.camTanY))),
      ).toVar();

      const r = groundR.add(this.cameraHeight).toVar();
      const pos = vec3(0.0, r, 0.0).toVar();
      const sunDir = normalize(this.sunDirection).toVar();

      const depth = w.mul(w).mul(this.apRange).toVar();   // nah fein, fern grob
      const atmoDist = raySphere(pos, dirWorld, atmosR).toVar();
      const tMax = max(1e-7, min(depth, max(atmoDist, 0.0))).toVar();

      const res = this.raymarchScattering(pos, dirWorld, sunDir, tMax, int(12)).toVar();
      storageTexture3D(this.apLut, uvec3(px, py, pz), vec4(res.rgb.mul(this.sunIntensity), res.a)).toStack();
    })().compute(AP_W * AP_H * AP_D);

    /* ---------- Abtaster für Materialien ---------- */

    /** Himmelsleuchtdichte in Blickrichtung. */
    this.sampleSky = Fn(([dir]) => {
      const d = normalize(dir).toVar();
      const zenith = acos(clamp(d.y, -1.0, 1.0)).toVar();
      const e = PI.mul(0.5).sub(zenith).toVar();
      const c = sqrt(abs(e).div(PI.mul(0.5))).mul(sign(e)).toVar();
      const v = c.mul(0.5).add(0.5).toVar();
      const azim = atan(d.x, d.z.negate()).toVar();
      const u = azim.div(PI2).add(0.5).toVar();
      return textureLevel(this.skyLut, vec2(u, clamp(v, 0.001, 0.999)), 0).rgb;
    });

    /** Luftperspektive: rgb = Streulicht, a = Transmission. */
    this.aerialPerspective = Fn(([uvNode, distMeters]) => {
      const d = saturate(sqrt(max(0.0, distMeters).div(float(this.apRangeMeters)))).toVar();
      return texture3D(this.apLut, vec3(uvNode.x, uvNode.y, d));
    });
  }

  /* -------------------------------------------------------------- Laufzeit */

  /**
   * Debug: Himmelsleuchtdichte für N Elevationswinkel auslesen.
   * Elevation von -90 bis +90 Grad, Azimut fest auf die Sonnenrichtung.
   */
  async probe(renderer, count = 13) {
    if (!this._probeBuf) {
      this._probeBuf = instancedArray(count, 'vec4').setName('skyProbe');
      this._probeKernel = Fn(() => {
        const i = instanceIndex.toVar();
        const t = float(i).div(float(count - 1)).toVar();
        const elev = t.mul(PI).sub(PI.mul(0.5)).toVar();   // -90..+90 Grad
        const d = vec3(sin(elev).mul(0.0), sin(elev), cos(elev).negate()).toVar();
        const dir = normalize(vec3(0.0, sin(elev), cos(elev).negate())).toVar();
        const L = this.sampleSky(dir).toVar();
        this._probeBuf.element(i).assign(vec4(L, elev.mul(180.0).div(PI)));
      })().compute(count);
    }
    renderer.compute(this._probeKernel);
    const buf = await renderer.getArrayBufferAsync(this._probeBuf.value);
    const f = new Float32Array(buf);
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push({
        elev: +f[i * 4 + 3].toFixed(0),
        rgb: [f[i * 4], f[i * 4 + 1], f[i * 4 + 2]].map((v) => +v.toFixed(3)),
      });
    }
    return out;
  }

  async bake(renderer) {
    if (this._baked) return;
    await renderer.computeAsync(this.transKernel);
    await renderer.computeAsync(this.multiKernel);
    this._baked = true;
  }

  update(renderer, camera) {
    const y = Math.max(0, camera.position.y);
    this.cameraHeight.value = Math.max(0.4, y) / 1e6;

    const q = camera.quaternion;
    this.camForward.value.set(0, 0, -1).applyQuaternion(q);
    this.camRight.value.set(1, 0, 0).applyQuaternion(q);
    this.camUp.value.set(0, 1, 0).applyQuaternion(q);
    const tanY = Math.tan((camera.fov * Math.PI) / 360);
    this.camTanY.value = tanY;
    this.camTanX.value = tanY * camera.aspect;

    renderer.compute(this.skyKernel);
    renderer.compute(this.apKernel);

    this._updateSunColorCPU(y);
  }

  /**
   * CPU-Nachbau der Transmission entlang des Sonnenstrahls.
   * Speist Farbe und Helligkeit des Direktlichts, ohne GPU-Rücklesen.
   */
  _updateSunColorCPU(cameraYMeters) {
    const s = this.sunDirection.value;
    const r0 = GROUND_RADIUS + Math.max(0, cameraYMeters) / 1e6;
    const mu = Math.max(-1, Math.min(1, s.y));
    const sx = Math.sqrt(Math.max(0, 1 - mu * mu));

    const b = r0 * mu;
    const disc = b * b - (r0 * r0 - ATMOS_RADIUS * ATMOS_RADIUS);
    const tMax = disc > 0 ? -b + Math.sqrt(disc) : 0;

    const steps = 32;
    const dt = tMax / steps;
    const tr = [1, 1, 1];
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) * dt;
      const rr = Math.hypot(sx * t, r0 + mu * t);
      const altKM = (rr - GROUND_RADIUS) * 1000;
      const rd = Math.exp(-altKM / 8);
      const md = Math.exp(-altKM / 1.2) * this.turbidity.value;
      const od = Math.max(0, 1 - Math.abs(altKM - 25) / 15);
      for (let ch = 0; ch < 3; ch++) {
        const ext = RAYLEIGH_SCATTER[ch] * rd + (MIE_SCATTER + MIE_ABSORB) * md + OZONE_ABSORB[ch] * od;
        tr[ch] *= Math.exp(-ext * dt);
      }
    }

    // sanftes Ausblenden knapp unter dem Horizont
    const k = Math.max(0, Math.min(1, (mu + 0.055) / 0.09));
    const I = this.sunIntensity.value;
    const l = [tr[0] * I * k, tr[1] * I * k, tr[2] * I * k];
    this.sunLuminance = Math.max(l[0], l[1], l[2]);
    if (this.sunLuminance > 1e-5) {
      this.sunColor.setRGB(l[0] / this.sunLuminance, l[1] / this.sunLuminance, l[2] / this.sunLuminance);
    } else {
      this.sunColor.setRGB(1, 0.95, 0.9);
      this.sunLuminance = 0;
    }
    this.sunColorU.value.set(this.sunColor.r, this.sunColor.g, this.sunColor.b);
    this.sunLuminanceU.value = this.sunLuminance;

    // grobe Umgebungsfarben für Fallback-IBL und UI
    const zen = Math.max(0.02, 0.35 + 0.65 * Math.max(0, mu));
    this.zenithColor.setRGB(0.16 * zen, 0.28 * zen, 0.62 * zen);
    this.horizonColor.setRGB(
      Math.min(1, this.sunColor.r * 0.9 + 0.25),
      Math.min(1, this.sunColor.g * 0.75 + 0.22),
      Math.min(1, this.sunColor.b * 0.6 + 0.26),
    );
  }
}
