import {
  Mesh, PlaneGeometry, BufferAttribute, MeshStandardNodeMaterial, Vector2, Vector3, Color,
  DataTexture, RGBAFormat, FloatType, LinearFilter, RepeatWrapping, MathUtils,
} from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, texture, positionWorld, normalWorld, normalLocal,
  attribute, mix, clamp, saturate, smoothstep, pow, abs, max, min, dot, normalize, fract, sin,
  floor, length, mul, sub, add, positionLocal, cross, step, uv,
} from 'three/tsl';
import { makeFbm, Rng } from '../core/Rng.js';

/**
 * Höhenfeldgelände mit Materialschichtung.
 *
 * Die Höhen entstehen aus fraktalem Rauschen mit radialem Abfall zur Insel.
 * Das Material mischt Sand, Gras und Fels nach Höhe und Hangneigung und
 * bekommt über Triplanar-Detailrauschen eine Nahstruktur, damit es aus
 * Spielerhöhe nicht flach wirkt.
 */
export class Terrain {
  /**
   * @param {object} o
   * @param {number} o.size      Kantenlänge in Metern
   * @param {number} o.res       Auflösung des Höhenfelds
   * @param {function} o.shape   (nx, nz) => Höhe in Metern
   */
  /**
   * @param {number} [o.yOffset] Verschiebt das gesamte Höhenfeld.
   *   Wichtig für schwebende Inseln: der Versatz muss *im Feld* stecken,
   *   nicht nur in `mesh.position`. Sonst weichen Höhentextur (Gras,
   *   Nebel) und Weltkoordinaten um genau diesen Betrag voneinander ab.
   */
  constructor({ size = 520, res = 513, shape, seed = 7, yOffset = 0 } = {}) {
    this.size = size;
    this.res = res;
    this.half = size / 2;
    this.cell = size / (res - 1);
    this.heights = new Float32Array(res * res);
    this.normals = new Float32Array(res * res * 3);
    this.shape = shape ?? defaultIslandShape(seed);
    this.yOffset = yOffset;

    this._build();
  }

  _build() {
    const { res, size, half, heights } = this;
    for (let j = 0; j < res; j++) {
      const z = -half + (j / (res - 1)) * size;
      for (let i = 0; i < res; i++) {
        const x = -half + (i / (res - 1)) * size;
        heights[j * res + i] = this.shape(x, z) + this.yOffset;
      }
    }

    // Normalen aus zentralen Differenzen
    const n = this.normals;
    const c = this.cell;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const hl = heights[j * res + Math.max(0, i - 1)];
        const hr = heights[j * res + Math.min(res - 1, i + 1)];
        const hd = heights[Math.max(0, j - 1) * res + i];
        const hu = heights[Math.min(res - 1, j + 1) * res + i];
        const nx = (hl - hr) / (2 * c);
        const nz = (hd - hu) / (2 * c);
        const inv = 1 / Math.hypot(nx, 1, nz);
        const o = (j * res + i) * 3;
        n[o] = nx * inv; n[o + 1] = inv; n[o + 2] = nz * inv;
      }
    }
  }

  /** Bilinear interpolierte Höhe; außerhalb der Kachel Meeresgrund. */
  heightAt(x, z) {
    const { res, half, size, heights } = this;
    const fx = ((x + half) / size) * (res - 1);
    const fz = ((z + half) / size) * (res - 1);
    if (fx < 0 || fz < 0 || fx > res - 1 || fz > res - 1) return this.yOffset - 12;
    const i0 = Math.floor(fx), j0 = Math.floor(fz);
    const i1 = Math.min(res - 1, i0 + 1), j1 = Math.min(res - 1, j0 + 1);
    const tx = fx - i0, tz = fz - j0;
    const h00 = heights[j0 * res + i0], h10 = heights[j0 * res + i1];
    const h01 = heights[j1 * res + i0], h11 = heights[j1 * res + i1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /** Normale am Punkt, für Ausrichtung von Objekten. */
  normalAt(x, z, out = new Vector3()) {
    const { res, half, size } = this;
    const i = MathUtils.clamp(Math.round(((x + half) / size) * (res - 1)), 0, res - 1);
    const j = MathUtils.clamp(Math.round(((z + half) / size) * (res - 1)), 0, res - 1);
    const o = (j * res + i) * 3;
    return out.set(this.normals[o], this.normals[o + 1], this.normals[o + 2]);
  }

  slopeAt(x, z) {
    const n = this.normalAt(x, z, _n);
    return 1 - n.y;
  }

  /**
   * Baut das sichtbare Netz.
   * @param {number} meshRes Netzauflösung (darf gröber sein als das Höhenfeld)
   */
  buildMesh({ meshRes = 384, atmosphere, sky } = {}) {
    const geo = new PlaneGeometry(this.size, this.size, meshRes - 1, meshRes - 1);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position.array;
    const nrm = geo.attributes.normal.array;
    const count = geo.attributes.position.count;
    const wetness = new Float32Array(count);

    const n = new Vector3();
    for (let i = 0; i < count; i++) {
      const x = pos[i * 3], z = pos[i * 3 + 2];
      const h = this.heightAt(x, z);
      pos[i * 3 + 1] = h;
      this.normalAt(x, z, n);
      nrm[i * 3] = n.x; nrm[i * 3 + 1] = n.y; nrm[i * 3 + 2] = n.z;
      // Nässe direkt an der Wasserlinie
      wetness[i] = MathUtils.clamp(1 - (h + 0.4) / 1.6, 0, 1);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.setAttribute('wetness', new BufferAttribute(wetness, 1));
    geo.computeBoundingSphere();

    const mat = new MeshStandardNodeMaterial();
    mat.name = 'TerrainMaterial';
    this._applyMaterial(mat, atmosphere, sky);

    const mesh = new Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.name = 'Terrain';
    this.mesh = mesh;
    this.material = mat;
    return mesh;
  }

  _applyMaterial(mat, atmosphere, sky) {
    this.sandColor = uniform(new Color(0.58, 0.50, 0.38));
    this.grassColor = uniform(new Color(0.16, 0.24, 0.10));
    this.grassColor2 = uniform(new Color(0.28, 0.32, 0.13));
    this.rockColor = uniform(new Color(0.24, 0.23, 0.22));
    this.wetTint = uniform(new Color(0.35, 0.32, 0.26));
    this.detailScale = uniform(1.0);

    const wet = attribute('wetness', 'float');

    /** Billiges Wertrauschen für Nahdetails, dreifach projiziert. */
    const hash2 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
    const vnoise = Fn(([p]) => {
      const i = floor(p).toVar();
      const f = fract(p).toVar();
      const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
      const a = hash2(i).toVar();
      const b = hash2(i.add(vec2(1.0, 0.0))).toVar();
      const c = hash2(i.add(vec2(0.0, 1.0))).toVar();
      const d = hash2(i.add(vec2(1.0, 1.0))).toVar();
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    });
    const fbm2 = Fn(([p]) => {
      const s = float(0.0).toVar();
      const amp = float(0.5).toVar();
      const q = p.toVar();
      for (let i = 0; i < 4; i++) {
        s.addAssign(vnoise(q).mul(amp));
        q.mulAssign(2.03);
        amp.mulAssign(0.5);
      }
      return s;
    });

    const worldXZ = positionWorld.xz;
    const h = positionWorld.y;
    const slope = saturate(float(1.0).sub(normalWorld.y).mul(2.6));

    mat.colorNode = Fn(() => {
      const nFine = fbm2(worldXZ.mul(this.detailScale.mul(0.9))).toVar();
      const nCoarse = fbm2(worldXZ.mul(0.055)).toVar();

      // Gras variiert in zwei Tönen, damit die Fläche lebt
      const grass = mix(this.grassColor, this.grassColor2, saturate(nCoarse.mul(1.6).sub(0.2))).toVar();
      grass.mulAssign(float(0.78).add(nFine.mul(0.44)));

      const sand = this.sandColor.mul(float(0.82).add(nFine.mul(0.36))).toVar();
      const rock = this.rockColor.mul(float(0.7).add(fbm2(worldXZ.mul(0.42)).mul(0.7))).toVar();

      // Sand am Wasser, Gras darüber, Fels an steilen Hängen
      const beach = saturate(float(1.0).sub(smoothstep(float(0.15), float(2.6), h))).toVar();
      const c = mix(grass, sand, beach).toVar();
      c.assign(mix(c, rock, saturate(slope.mul(1.25).sub(0.15))));

      // nasser Sand ist dunkler und gesättigter
      const w = saturate(wet.add(beach.mul(0.25))).toVar();
      c.assign(mix(c, c.mul(this.wetTint).mul(2.0), w.mul(0.55)));

      return vec4(c, 1.0);
    })();

    mat.roughnessNode = Fn(() => {
      const w = saturate(wet).toVar();
      const base = mix(float(0.92), float(0.78), saturate(slope)).toVar();
      return clamp(base.sub(w.mul(0.55)), 0.08, 1.0);
    })();

    mat.metalnessNode = float(0.0);

    // Bewusst keine Normalenstörung aus dem Rauschen: die Ableitung
    // erzeugt bei flachem Blickwinkel Moiré, das TRAA nicht wegbekommt.
    // Struktur entsteht über Farbvariation und das Gras darüber.
  }
}

const _n = new Vector3();

/** Standardform: eine Insel mit Sandsaum, Hügeln und ein paar Klippen. */
export function defaultIslandShape(seed = 7) {
  const base = makeFbm(seed, 6, 2.03, 0.5);
  const ridge = makeFbm(seed + 91, 4, 2.11, 0.55);
  const detail = makeFbm(seed + 313, 3, 2.4, 0.5);

  return function shape(x, z) {
    const r = Math.hypot(x, z);
    // Inselmaske: innen 1, außen 0
    const mask = MathUtils.smoothstep(1 - MathUtils.clamp((r - 90) / 130, 0, 1), 0, 1);

    let h = base(x * 0.0042, z * 0.0042) * 26;
    // Grate: |noise| invertiert gibt scharfe Kämme
    const rg = 1 - Math.abs(ridge(x * 0.0075, z * 0.0075));
    h += rg * rg * 16;
    h += detail(x * 0.03, z * 0.03) * 1.1;

    h = h * mask - 9 * (1 - mask);
    // flacher Strand um die Wasserlinie
    if (h > -1.5 && h < 3.0) h *= 0.55;
    return h;
  };
}
