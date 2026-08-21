import {
  Scene, CubeCamera, CubeRenderTarget, HalfFloatType, LinearFilter, Vector3,
} from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, normalWorldGeometry, normalize, dot, cos, acos, max, min,
  clamp, smoothstep, mix, pow, sqrt, abs, sign, floor, fract, sin, exp, saturate, PI, instancedArray,
  instanceIndex, Loop, uint, int, atan, PI2, select, time, positionWorld, cameraPosition, length,
} from 'three/tsl';

/**
 * Himmel: Hintergrundknoten aus der Atmosphären-LUT plus Sonnenscheibe,
 * Sterne und ein Umgebungswürfel für die bildbasierte Beleuchtung.
 */
export class Sky {
  /** @param {import('./Atmosphere.js').Atmosphere} atmo */
  constructor(atmo, { cubeSize = 128 } = {}) {
    this.atmo = atmo;
    this.sunAngularRadius = uniform(0.0090);   // etwas größer als real, sieht besser aus
    this.sunDiscBrightness = uniform(70.0);
    this.starIntensity = uniform(1.0);
    this.skyMultiplier = uniform(1.0);

    this.backgroundNode = this._buildBackground();

    /* --- Umgebungswürfel für IBL --- */
    this.envScene = new Scene();
    this.envScene.backgroundNode = this.backgroundNode;

    this.cubeRT = new CubeRenderTarget(cubeSize, {
      type: HalfFloatType,
      generateMipmaps: true,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    });
    this.cubeCamera = new CubeCamera(0.1, 1000, this.cubeRT);

    this._envFrame = 0;
    this.envUpdateInterval = 6;

    this._buildIrradianceSH();
  }

  _buildBackground() {
    const atmo = this.atmo;

    return Fn(() => {
      const dir = normalize(normalWorldGeometry).toVar();
      const sunDir = normalize(atmo.sunDirection).toVar();

      const sky = atmo.sampleSky(dir).mul(this.skyMultiplier).toVar();

      /* --- Sterne: Hash-Gitter auf der Richtungssphäre --- */
      const starField = Fn(([d]) => {
        const scaled = d.mul(220.0).toVar();
        const cell = floor(scaled).toVar();
        const h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))).mul(43758.5453)).toVar();
        const h2 = fract(sin(dot(cell, vec3(93.989, 27.137, 61.331))).mul(24634.6345)).toVar();
        const local = fract(scaled).sub(vec3(h, h2, fract(h.add(h2)))).toVar();
        const d2 = dot(local, local).toVar();
        const brightness = pow(saturate(float(1.0).sub(d2.mul(9.0))), 12.0).toVar();
        const rare = smoothstep(0.986, 0.9975, h).toVar();
        const twinkle = sin(time.mul(2.4).add(h.mul(90.0))).mul(0.22).add(0.85).toVar();
        // leichte Farbtemperaturstreuung
        const tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.88, 0.72), h2);
        return tint.mul(brightness).mul(rare).mul(twinkle);
      });

      const nightFade = saturate(sunDir.y.mul(-6.0).add(0.35)).toVar();
      const stars = starField(dir).mul(this.starIntensity).mul(nightFade).mul(saturate(dir.y.mul(6.0))).toVar();

      /* --- Sonnenscheibe mit Randverdunkelung --- */
      const cosT = dot(dir, sunDir).toVar();
      const r = this.sunAngularRadius.toVar();
      const cosOuter = cos(r.mul(1.10)).toVar();
      const cosInner = cos(r.mul(0.90)).toVar();
      const discMask = smoothstep(cosOuter, cosInner, cosT).toVar();

      const theta = acos(clamp(cosT, -1.0, 1.0)).toVar();
      const u = sqrt(saturate(float(1.0).sub(pow(min(theta.div(r), 1.0), 2.0)))).toVar();
      // Limb darkening (Hestroffer & Magnan, vereinfacht)
      const limb = vec3(
        float(1.0).sub(float(0.397).mul(float(1.0).sub(pow(u, 0.32)))),
        float(1.0).sub(float(0.503).mul(float(1.0).sub(pow(u, 0.29)))),
        float(1.0).sub(float(0.652).mul(float(1.0).sub(pow(u, 0.24)))),
      ).toVar();

      const groundR = float(6.360);
      const camR = groundR.add(atmo.cameraHeight).toVar();
      const sunTr = atmo.transmittance(camR, clamp(sunDir.y, -1.0, 1.0)).toVar();
      const aboveHorizon = smoothstep(-0.02, 0.03, sunDir.y).toVar();

      const sunRadiance = sunTr
        .mul(limb)
        .mul(atmo.sunIntensity)
        .mul(this.sunDiscBrightness)
        .mul(discMask)
        .mul(aboveHorizon)
        .toVar();

      return vec4(sky.add(stars).add(sunRadiance), 1.0);
    })();
  }

  /**
   * Kugelflächenfunktionen 9. Ordnung aus der Himmels-LUT.
   * Ergibt weiche, exakt zum Himmel passende diffuse Umgebungsbeleuchtung
   * für eigene Shader (Gras, Wasser, Partikel).
   */
  _buildIrradianceSH() {
    const SAMPLES_THETA = 24, SAMPLES_PHI = 48;
    this.shBuffer = instancedArray(9, 'vec3').setName('skySH');

    this.shKernel = Fn(() => {
      const c = instanceIndex.toVar();
      const acc = vec3(0.0).toVar();
      const wSum = float(0.0).toVar();

      Loop(SAMPLES_THETA, SAMPLES_PHI, ({ i, j }) => {
        const thetaN = float(i).add(0.5).div(float(SAMPLES_THETA)).toVar();
        const phiN = float(j).add(0.5).div(float(SAMPLES_PHI)).toVar();
        const ct = float(1.0).sub(thetaN.mul(2.0)).toVar();      // cos(theta) in [1,-1]
        const st = sqrt(saturate(float(1.0).sub(ct.mul(ct)))).toVar();
        const phi = phiN.mul(PI2).toVar();
        const d = vec3(st.mul(cos(phi)), ct, st.mul(sin(phi))).toVar();

        const L = this.atmo.sampleSky(d).toVar();
        const solid = float(4.0).mul(PI).div(float(SAMPLES_THETA * SAMPLES_PHI)).toVar();

        // Basisfunktionen
        const Y = float(0.0).toVar();
        const idx = c.toInt().toVar();
        Y.assign(select(idx.equal(int(0)), float(0.282095), Y));
        Y.assign(select(idx.equal(int(1)), float(0.488603).mul(d.y), Y));
        Y.assign(select(idx.equal(int(2)), float(0.488603).mul(d.z), Y));
        Y.assign(select(idx.equal(int(3)), float(0.488603).mul(d.x), Y));
        Y.assign(select(idx.equal(int(4)), float(1.092548).mul(d.x).mul(d.y), Y));
        Y.assign(select(idx.equal(int(5)), float(1.092548).mul(d.y).mul(d.z), Y));
        Y.assign(select(idx.equal(int(6)), float(0.315392).mul(d.z.mul(d.z).mul(3.0).sub(1.0)), Y));
        Y.assign(select(idx.equal(int(7)), float(1.092548).mul(d.x).mul(d.z), Y));
        Y.assign(select(idx.equal(int(8)), float(0.546274).mul(d.x.mul(d.x).sub(d.y.mul(d.y))), Y));

        acc.addAssign(L.mul(Y).mul(solid));
        wSum.addAssign(solid);
      });

      this.shBuffer.element(instanceIndex).assign(acc);
    })().compute(9);

    /** Diffuse Umgebungsstrahlung in Normalenrichtung. */
    this.irradiance = Fn(([n]) => {
      const c0 = this.shBuffer.element(uint(0)).toVar();
      const c1 = this.shBuffer.element(uint(1)).toVar();
      const c2 = this.shBuffer.element(uint(2)).toVar();
      const c3 = this.shBuffer.element(uint(3)).toVar();
      const c4 = this.shBuffer.element(uint(4)).toVar();
      const c5 = this.shBuffer.element(uint(5)).toVar();
      const c6 = this.shBuffer.element(uint(6)).toVar();
      const c7 = this.shBuffer.element(uint(7)).toVar();
      const c8 = this.shBuffer.element(uint(8)).toVar();

      const A0 = float(3.141593), A1 = float(2.094395), A2 = float(0.785398);
      const r = c0.mul(0.282095).mul(A0)
        .add(c1.mul(0.488603).mul(n.y).mul(A1))
        .add(c2.mul(0.488603).mul(n.z).mul(A1))
        .add(c3.mul(0.488603).mul(n.x).mul(A1))
        .add(c4.mul(1.092548).mul(n.x).mul(n.y).mul(A2))
        .add(c5.mul(1.092548).mul(n.y).mul(n.z).mul(A2))
        .add(c6.mul(0.315392).mul(n.z.mul(n.z).mul(3.0).sub(1.0)).mul(A2))
        .add(c7.mul(1.092548).mul(n.x).mul(n.z).mul(A2))
        .add(c8.mul(0.546274).mul(n.x.mul(n.x).sub(n.y.mul(n.y))).mul(A2));
      return max(vec3(0.0), r.div(PI));
    });

    /**
     * Spiegelnde Umgebung: bei glatten Flächen direkt die Himmels-LUT,
     * bei rauen der SH-Mittelwert. `irradiance()` liefert bereits E/pi,
     * also eine mittlere Strahldichte – hier ist kein weiteres pi nötig.
     */
    this.specularSky = Fn(([reflDir, roughness]) => {
      const sharp = this.atmo.sampleSky(reflDir).toVar();
      const wide = this.irradiance(reflDir).toVar();
      return mix(sharp, wide, saturate(roughness.mul(roughness)));
    });
  }

  /** Einmalig nach dem Backen der Atmosphäre. */
  attachTo(scene) {
    scene.backgroundNode = this.backgroundNode;
    scene.environment = this.cubeRT.texture;
    scene.environmentIntensity = 1.0;
    this.scene = scene;
  }

  update(renderer) {
    renderer.compute(this.shKernel);
    if (this._envFrame % this.envUpdateInterval === 0) {
      this.cubeCamera.update(renderer, this.envScene);
    }
    this._envFrame++;
  }
}
