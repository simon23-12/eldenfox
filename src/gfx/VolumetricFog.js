import {
  Storage3DTexture, HalfFloatType, RGBAFormat, LinearFilter, ClampToEdgeWrapping,
  Vector3, Vector2, Color, Matrix4,
} from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, int, uint, uvec3, ivec2, ivec3, instanceIndex,
  texture3D, textureLevel, storageTexture3D, uniform, screenUV, positionWorld,
  If, Loop, Break, exp, max, min, clamp, saturate, mix, pow, sqrt, abs, floor, fract, sin, cos,
  dot, cross, normalize, length, smoothstep, step, time, PI, PI2, select, cameraPosition,
  perspectiveDepthToViewZ, cameraNear, cameraFar, log2, sign,
} from 'three/tsl';

/**
 * Volumetrischer Nebel über ein Froxelgitter.
 *
 * Das Sichtvolumen wird in ein 3D-Gitter zerlegt (Bildschirm-XY mal Tiefe).
 * Zwei Compute-Durchgänge:
 *
 *   1. Einspeisen – pro Froxel Dichte und eingestreutes Licht bestimmen.
 *      Die Sonnensichtbarkeit kommt aus einem kurzen Raymarch durch die
 *      Geländehöhentextur; daraus entstehen echte Lichtschächte hinter
 *      Hügeln und Ruinen, ohne die Schattenkarte anfassen zu müssen.
 *   2. Integrieren – je Bildschirmspalte einmal durch die Tiefe laufen und
 *      Streuung sowie Transmission vorwärts akkumulieren.
 *
 * Das Zusammensetzen im Postpfad ist danach eine einzige 3D-Textursuche.
 */
export class VolumetricFog {
  /**
   * @param {object} o
   * @param {import('./Atmosphere.js').Atmosphere} o.atmosphere
   * @param {import('./Sky.js').Sky} o.sky
   * @param {import('./Terrain.js').Terrain} o.terrain
   */
  /**
   * @param {object} [o.cloudLayer] Optionale Wolkenbank im selben Volumen:
   *   `{ texture, scale, low, high, density, drift }`. Das Froxelgitter
   *   trägt damit auch eine Wolkendecke, ohne dass ein zweiter Raymarch
   *   nötig wird.
   */
  constructor({
    atmosphere, sky, heightTexture, terrainSize = 620,
    width = 160, height = 88, depth = 64, range = 300,
    cloudLayer = null,
  } = {}) {
    this.atmo = atmosphere;
    this.sky = sky;
    this.W = width; this.H = height; this.D = depth;
    this.range = range;

    /* --- Regler --- */
    this.density = uniform(0.030);
    this.heightFalloff = uniform(0.055);
    this.fogBase = uniform(0.0);          // Höhe, ab der der Nebel dünner wird
    this.anisotropy = uniform(0.72);
    this.ambientBoost = uniform(1.0);
    this.sunBoost = uniform(1.5);
    this.noiseScale = uniform(0.045);
    this.noiseStrength = uniform(0.65);
    this.windDrift = uniform(new Vector3(0.9, 0.02, 0.4));
    this.fogColor = uniform(new Color(0.62, 0.66, 0.72));

    /* --- Kamera --- */
    this.camPos = uniform(new Vector3());
    this.camFwd = uniform(new Vector3(0, 0, -1));
    this.camRight = uniform(new Vector3(1, 0, 0));
    this.camUp = uniform(new Vector3(0, 1, 0));
    this.tanX = uniform(1.0);
    this.tanY = uniform(0.6);

    this.heightTexture = heightTexture;
    this.terrainSize = terrainSize;

    this.cloudLayer = cloudLayer;
    if (cloudLayer) {
      this.cloudLow = uniform(cloudLayer.low ?? 0);
      this.cloudHigh = uniform(cloudLayer.high ?? 100);
      this.cloudDensity = uniform(cloudLayer.density ?? 0.02);
      this.cloudScale = uniform(cloudLayer.scale ?? 0.0008);
      this.cloudDrift = uniform(cloudLayer.drift ?? new Vector3(6, 0, 3));
      this.cloudCoverage = uniform(cloudLayer.coverage ?? 0.7);
      this.cloudTint = uniform(cloudLayer.tint ?? new Color(0.92, 0.95, 1.0));
    }

    this.scatterTex = make3D(width, height, depth);
    this.integralTex = make3D(width, height, depth);

    this._buildKernels();
    this._buildCompositor();
  }

  /** Weltposition eines Froxels; die Tiefe wächst quadratisch. */
  _froxelWorld(fx, fy, fz) {
    const u = fx.add(0.5).div(float(this.W));
    const v = fy.add(0.5).div(float(this.H));
    const w = fz.add(0.5).div(float(this.D));

    const ndcX = u.mul(2.0).sub(1.0);
    const ndcY = v.mul(2.0).sub(1.0);
    const dir = normalize(
      this.camFwd
        .add(this.camRight.mul(ndcX.mul(this.tanX)))
        .add(this.camUp.mul(ndcY.mul(this.tanY))),
    ).toVar();

    // Quadratische Verteilung: nah fein, fern grob
    const dist = w.mul(w).mul(float(this.range)).toVar();
    return { pos: this.camPos.add(dir.mul(dist)), dir, dist, w };
  }

  _buildKernels() {
    const { W, H, D } = this;

    /* --- 3D-Wertrauschen für Schwaden --- */
    const hash3 = Fn(([p]) =>
      fract(sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453123)));
    const vnoise3 = Fn(([p]) => {
      const i = floor(p).toVar();
      const f = fract(p).toVar();
      const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
      const n000 = hash3(i).toVar();
      const n100 = hash3(i.add(vec3(1, 0, 0))).toVar();
      const n010 = hash3(i.add(vec3(0, 1, 0))).toVar();
      const n110 = hash3(i.add(vec3(1, 1, 0))).toVar();
      const n001 = hash3(i.add(vec3(0, 0, 1))).toVar();
      const n101 = hash3(i.add(vec3(1, 0, 1))).toVar();
      const n011 = hash3(i.add(vec3(0, 1, 1))).toVar();
      const n111 = hash3(i.add(vec3(1, 1, 1))).toVar();
      const x00 = mix(n000, n100, u.x), x10 = mix(n010, n110, u.x);
      const x01 = mix(n001, n101, u.x), x11 = mix(n011, n111, u.x);
      return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
    });

    const fbm3 = Fn(([p]) => {
      const s = float(0.0).toVar();
      const amp = float(0.55).toVar();
      const q = p.toVar();
      for (let i = 0; i < 3; i++) {
        s.addAssign(vnoise3(q).mul(amp));
        q.mulAssign(2.17);
        amp.mulAssign(0.5);
      }
      return s;
    });

    /** Geländehöhe an einer Weltposition. */
    const terrainH = (xz) => {
      const uv = xz.div(float(this.terrainSize)).add(0.5);
      return textureLevel(this.heightTexture, uv, 0).x;
    };

    /**
     * Sonnensichtbarkeit: kurzer Marsch Richtung Sonne durch das Höhenfeld.
     * Acht Schritte reichen – die Schächte sollen weich sein, nicht exakt.
     */
    const sunVisibility = Fn(([p, sunDir]) => {
      const vis = float(1.0).toVar();
      const stepLen = float(9.0).toVar();
      Loop(8, ({ i }) => {
        const q = p.add(sunDir.mul(stepLen.mul(float(i).add(1.0)))).toVar();
        const h = terrainH(q.xz).toVar();
        // je tiefer unter dem Gelände, desto stärker verdeckt
        vis.mulAssign(saturate(smoothstep(float(-2.0), float(3.0), q.y.sub(h)).mul(0.85).add(0.15)));
      });
      return vis;
    });

    const henyeyGreenstein = (cosT, g) => {
      const g2 = g.mul(g);
      return float(1.0).sub(g2)
        .div(float(4.0).mul(PI).mul(pow(max(1e-3, float(1.0).add(g2).sub(g.mul(cosT).mul(2.0))), 1.5)));
    };

    /* ---------------- Durchgang 1: Einspeisen ---------------- */
    this.injectKernel = Fn(() => {
      const fx = instanceIndex.mod(uint(W)).toVar();
      const fy = instanceIndex.div(uint(W)).mod(uint(H)).toVar();
      const fz = instanceIndex.div(uint(W * H)).toVar();

      const f = this._froxelWorld(float(fx), float(fy), float(fz));
      const p = f.pos.toVar();

      /* --- Dichte --- */
      const heightTerm = exp(max(0.0, p.y.sub(this.fogBase)).mul(this.heightFalloff).negate()).toVar();
      const drift = this.windDrift.mul(time.mul(0.6)).toVar();
      const n = fbm3(p.add(drift).mul(this.noiseScale)).toVar();
      const swirl = mix(float(1.0).sub(this.noiseStrength), float(1.0).add(this.noiseStrength), n).toVar();
      const dens = this.density.mul(heightTerm).mul(max(0.0, swirl)).toVar();

      /* --- Wolkenbank --- */
      // Dieselbe Maschinerie trägt auch eine Wolkendecke: Höhenband mal
      // Formtextur. Ein eigener Raymarch dafür wäre teurer und hätte
      // dieselbe Beleuchtung noch einmal implementieren müssen.
      if (this.cloudLayer) {
        const cq = p.add(this.cloudDrift.mul(time)).toVar();
        const chf = saturate(p.y.sub(this.cloudLow)
          .div(max(1.0, this.cloudHigh.sub(this.cloudLow)))).toVar();
        const band = smoothstep(0.0, 0.16, chf)
          .mul(float(1.0).sub(smoothstep(0.55, 1.0, chf)))
          .toVar();
        const shape = texture3D(this.cloudLayer.texture, cq.mul(this.cloudScale)).level(0).toVar();
        const cd = saturate(shape.r.mul(1.9).mul(band).sub(float(1.0).sub(this.cloudCoverage))).toVar();
        dens.addAssign(cd.mul(this.cloudDensity));
      }

      /* --- Beleuchtung --- */
      const sunDir = normalize(this.atmo.sunDirection).toVar();
      const cosT = dot(normalize(f.dir), sunDir).toVar();
      const phase = henyeyGreenstein(cosT, this.anisotropy).toVar();
      const vis = sunVisibility(p, sunDir).toVar();

      const sunRad = this.atmo.sunColorU.mul(this.atmo.sunLuminanceU).toVar();
      const inSun = sunRad.mul(phase).mul(vis).mul(this.sunBoost).toVar();
      const inSky = this.sky.irradiance(vec3(0.0, 1.0, 0.0))
        .mul(this.fogColor).mul(this.ambientBoost).toVar();

      const scattering = inSun.add(inSky).mul(dens).toVar();
      storageTexture3D(this.scatterTex, uvec3(fx, fy, fz), vec4(scattering, dens)).toStack();
    })().compute(W * H * D);

    /* ---------------- Durchgang 2: Integrieren ---------------- */
    // Eine Invokation je Bildschirmpixel des Gitters, die durch die Tiefe läuft.
    this.integrateKernel = Fn(() => {
      const fx = instanceIndex.mod(uint(W)).toVar();
      const fy = instanceIndex.div(uint(W)).toVar();

      const accum = vec3(0.0).toVar();
      const transmittance = float(1.0).toVar();
      const prevDist = float(0.0).toVar();

      Loop(D, ({ i }) => {
        const w = float(i).add(0.5).div(float(D)).toVar();
        const dist = w.mul(w).mul(float(this.range)).toVar();
        const dz = max(1e-4, dist.sub(prevDist)).toVar();
        prevDist.assign(dist);

        // Wichtig: 3D-Texturen brauchen texture3D(). `textureLevel` legt
        // einen 2D-Sampler an und liefert stillschweigend Nullen.
        const s = texture3D(this.scatterTex, vec3(
          float(fx).add(0.5).div(float(W)),
          float(fy).add(0.5).div(float(H)),
          w,
        )).level(0).toVar();

        const sigma = max(1e-6, s.w).toVar();
        const sliceT = exp(sigma.mul(dz).negate()).toVar();
        // analytisch integrierte Scheibe statt Rechteckregel: bei groben
        // Tiefenschritten sonst deutlich zu dunkel
        const sInt = s.xyz.mul(float(1.0).sub(sliceT)).div(sigma).toVar();
        accum.addAssign(transmittance.mul(sInt));
        transmittance.mulAssign(sliceT);

        storageTexture3D(this.integralTex, uvec3(fx, fy, uint(i)),
          vec4(accum, transmittance)).toStack();
      });
    })().compute(W * H);
  }

  _buildCompositor() {
    /**
     * Setzt Nebel auf ein Bild. `viewDist` ist die Entfernung des Pixels
     * zur Kamera in Metern.
     */
    this.apply = Fn(([colorNode, viewDist]) => {
      const w = saturate(sqrt(max(0.0, viewDist).div(float(this.range)))).toVar();
      const s = texture3D(this.integralTex, vec3(screenUV.x, screenUV.y, w)).level(0).toVar();
      return vec4(colorNode.rgb.mul(s.w).add(s.xyz), colorNode.a);
    });
  }

  /** Pro Frame vor dem Rendern. */
  update(renderer, camera) {
    this.camPos.value.copy(camera.position);
    const q = camera.quaternion;
    this.camFwd.value.set(0, 0, -1).applyQuaternion(q);
    this.camRight.value.set(1, 0, 0).applyQuaternion(q);
    this.camUp.value.set(0, 1, 0).applyQuaternion(q);
    const tanY = Math.tan((camera.fov * Math.PI) / 360);
    this.tanY.value = tanY;
    this.tanX.value = tanY * camera.aspect;

    renderer.compute(this.injectKernel);
    renderer.compute(this.integrateKernel);
  }

  /**
   * Hängt sich als Kompositor in den Postpfad.
   * @param {import('./Pipeline.js').Pipeline} pipeline
   */
  attach(pipeline) {
    pipeline.addCompositor((color, ctx) => Fn(() => {
      const viewZ = ctx.viewZ.toVar();
      const dist = abs(viewZ).toVar();
      return this.apply(color, dist);
    })());
  }
}

function make3D(w, h, d) {
  const t = new Storage3DTexture(w, h, d);
  t.type = HalfFloatType;
  t.format = RGBAFormat;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = ClampToEdgeWrapping;
  return t;
}
