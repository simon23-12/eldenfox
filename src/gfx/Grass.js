import {
  Mesh, BufferGeometry, BufferAttribute, MeshStandardNodeMaterial, DataTexture,
  RGBAFormat, FloatType, LinearFilter, ClampToEdgeWrapping, Vector2, Vector3, Vector4, Color,
  IndirectStorageBufferAttribute, Matrix4, DoubleSide, Sphere,
} from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, int, uint, uvec2, ivec2, instanceIndex, attributeArray,
  storage, texture, textureLevel, uniform, attribute, positionLocal, normalLocal, positionWorld,
  If, Loop, Break, atomicAdd, atomicStore, floor, fract, sin, cos, abs, max, min, clamp, saturate,
  mix, pow, sqrt, dot, cross, normalize, length, smoothstep, step, time, PI, PI2, select,
  cameraPosition, mod, sign, exp,
} from 'three/tsl';

/**
 * GPU-getriebene Vegetation.
 *
 * Der komplette Weg läuft ohne CPU-Rückmeldung:
 *   1. Ein Compute-Kernel prüft pro Frame ein festes Raster von Kandidaten
 *      rund um die Kamera, tastet Höhe und Neigung aus einer Geländetextur ab
 *      und verwirft alles, was unter Wasser, zu steil oder außerhalb des
 *      Sichtkegels liegt.
 *   2. Überlebende werden per atomarem Zähler dicht in einen Sichtbarkeits-
 *      puffer geschrieben; derselbe Zähler landet als `instanceCount` in einem
 *      Indirect-Draw-Puffer.
 *   3. Gezeichnet wird mit `drawIndexedIndirect` – die CPU weiß nie, wie viele
 *      Halme es diesen Frame geworden sind.
 *
 * Dichte, Größe und Windantwort hängen an der Entfernung, damit nahe Halme
 * fein und ferne Flächen billig bleiben.
 */
export class Grass {
  /**
   * @param {object} o
   * @param {import('./Terrain.js').Terrain} o.terrain
   * @param {import('./Sky.js').Sky} o.sky
   */
  constructor({ terrain, sky, atmosphere, density = 1.0, radius = 120, gridSize = 512 } = {}) {
    this.terrain = terrain;
    this.sky = sky;
    this.atmo = atmosphere;

    this.gridSize = Math.max(64, Math.round(gridSize * Math.sqrt(density)));
    this.candidates = this.gridSize * this.gridSize;
    this.radius = radius;
    this.spacing = (radius * 2) / this.gridSize;
    // Mehrere Halme je Rasterzelle: die Zellzahl bleibt beherrschbar,
    // die Dichte steigt trotzdem deutlich.
    this.perCell = 3;

    /* --- Uniforms --- */
    this.origin = uniform(new Vector2(0, 0));
    this.windDir = uniform(new Vector2(0.8, 0.6));
    this.windStrength = uniform(1.0);
    this.gustPhase = uniform(0.0);
    this.baseColor = uniform(new Color(0.115, 0.175, 0.062));
    this.tipColor = uniform(new Color(0.46, 0.52, 0.20));
    this.dryColor = uniform(new Color(0.52, 0.45, 0.22));
    this.heightScale = uniform(1.0);
    this.densityFalloff = uniform(1.0);
    this.playerPos = uniform(new Vector3(0, 0, 0));
    this.trampleRadius = uniform(1.15);
    /**
     * Höhenband, in dem Gras wächst. Absolute Werte, weil das Höhenfeld in
     * Weltkoordinaten liegt – bei einer schwebenden Insel muss das Band
     * mitwandern, sonst wächst Gras bis über die Abbruchkante hinaus.
     */
    this.growLow = uniform(2.2);
    this.growHigh = uniform(5.5);

    /* --- Kamerauniforms für das Sichtkegel-Verwerfen --- */
    this.frustum = [
      uniform(new Vector4()), uniform(new Vector4()),
      uniform(new Vector4()), uniform(new Vector4()),
    ];
    this.camPos = uniform(new Vector3());

    this.heightTex = makeHeightTexture(terrain);

    /* --- Puffer --- */
    const maxBlades = this.candidates * 3;
    this.visible = attributeArray(maxBlades, 'vec4').setName('grassVisible');
    this.visible2 = attributeArray(maxBlades, 'vec4').setName('grassVisible2');
    this.counter = attributeArray(1, 'uint').setName('grassCounter');
    this.counter.value.array[0] = 0;

    this.geometry = makeBladeGeometry(5);
    // [indexCount, instanceCount, firstIndex, baseVertex, firstInstance]
    // Elementgröße 1, damit element(i) genau ein u32 adressiert.
    this.indirect = new IndirectStorageBufferAttribute(new Uint32Array([
      this.geometry.index.count, 0, 0, 0, 0,
    ]), 1);
    this.geometry.setIndirect(this.indirect);
    this.indirectStorage = storage(this.indirect, 'uint', 5).setName('grassIndirect');

    this._buildKernels();
    this.mesh = this._buildMesh();
  }

  _buildKernels() {
    const G = this.gridSize;
    const counterAtomic = this.counter.toAtomic();
    const indirectAtomic = this.indirectStorage.toAtomic();

    const hash21 = Fn(([p]) =>
      fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453123)));
    const hash22 = Fn(([p]) => vec2(
      fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453123)),
      fract(sin(dot(p, vec2(269.5, 183.3))).mul(43758.5453123)),
    ));

    /** Höhe und Normale des Geländes an einer Weltposition. */
    const sampleTerrain = (worldXZ) => {
      const uv = worldXZ.div(float(this.terrain.size)).add(0.5);
      const t = textureLevel(this.heightTex, uv, 0);
      return { h: t.x, n: t.yzw };
    };
    this.sampleTerrain = sampleTerrain;

    /* --- Zähler und Indirect-Puffer zurücksetzen --- */
    this.resetKernel = Fn(() => {
      atomicStore(counterAtomic.element(uint(0)), uint(0));
      atomicStore(indirectAtomic.element(uint(1)), uint(0));   // instanceCount
    })().compute(1);

    /* --- Kandidaten prüfen und verdichten --- */
    this.cullKernel = Fn(() => {
      const raw = instanceIndex.toVar();
      const sub = raw.mod(uint(this.perCell)).toVar();      // Halm innerhalb der Zelle
      const idx = raw.div(uint(this.perCell)).toVar();
      const gx = idx.mod(uint(G)).toVar();
      const gz = idx.div(uint(G)).toVar();

      // Zellmittelpunkt, an ein Weltraster gebunden -> keine Wanderung
      const cellX = float(gx).sub(float(G * 0.5)).mul(float(this.spacing)).toVar();
      const cellZ = float(gz).sub(float(G * 0.5)).mul(float(this.spacing)).toVar();

      const snapX = floor(this.origin.x.div(float(this.spacing))).mul(float(this.spacing)).toVar();
      const snapZ = floor(this.origin.y.div(float(this.spacing))).mul(float(this.spacing)).toVar();

      const baseX = cellX.add(snapX).toVar();
      const baseZ = cellZ.add(snapZ).toVar();

      // Streuung innerhalb der Zelle, damit kein Raster sichtbar wird
      const r = hash22(vec2(baseX, baseZ).add(float(sub).mul(37.19)).mul(13.37)).toVar();
      const wx = baseX.add(r.x.sub(0.5).mul(float(this.spacing * 1.6))).toVar();
      const wz = baseZ.add(r.y.sub(0.5).mul(float(this.spacing * 1.6))).toVar();

      const toCam = vec2(wx.sub(this.camPos.x), wz.sub(this.camPos.z)).toVar();
      const dist = length(toCam).toVar();

      If(dist.lessThan(float(this.radius)), () => {
        // Dichte fällt mit der Entfernung: fern reicht ein Bruchteil
        const keep = hash21(vec2(wx, wz).mul(7.77)).toVar();
        const densityAt = saturate(
          float(1.0).sub(smoothstep(float(this.radius * 0.30), float(this.radius), dist)),
        ).mul(0.62).add(0.38).toVar();

        If(keep.lessThan(densityAt.mul(this.densityFalloff)), () => {
          const t = sampleTerrain(vec2(wx, wz));
          const h = t.h.toVar();
          const slope = float(1.0).sub(t.n.y).toVar();

          // Gras wächst nicht im Wasser, nicht auf dem Strandsand und nicht
          // an Steilhängen. Der Übergang ist weich, sonst reißt eine Kante
          // durch die Landschaft.
          const beachFade = smoothstep(this.growLow, this.growHigh, h).toVar();
          const slopeFade = float(1.0).sub(smoothstep(float(0.30), float(0.48), slope)).toVar();
          const grow = beachFade.mul(slopeFade).toVar();

          If(grow.greaterThan(keep.mul(1.35)), () => {
            // Sichtkegel: Kugel um den Halm gegen vier Ebenen
            const p = vec3(wx, h.add(0.4), wz).toVar();
            const rad = float(0.9);
            const inFrustum = float(1.0).toVar();
            for (let i = 0; i < 4; i++) {
              const pl = this.frustum[i];
              const d = dot(pl.xyz, p).add(pl.w).toVar();
              inFrustum.mulAssign(step(rad.negate(), d));
            }

            If(inFrustum.greaterThan(0.5), () => {
              const slot = atomicAdd(counterAtomic.element(uint(0)), uint(1)).toVar();
              atomicAdd(indirectAtomic.element(uint(1)), uint(1));

              // Halmparameter: Höhe, Drehung, Farbton, Neigung
              const rr = hash22(vec2(wz, wx).mul(3.71)).toVar();
              const bladeH = mix(float(0.20), float(0.52), rr.x.mul(rr.x))
                .mul(this.heightScale)
                .mul(float(0.55).add(grow.mul(0.45)))
                .toVar();
              const yaw = rr.y.mul(PI2).toVar();
              const tint = hash21(vec2(wx.mul(0.31), wz.mul(0.29))).toVar();
              // trockener zur Wasserlinie hin
              const dry = saturate(float(1.0).sub(smoothstep(float(1.2), float(4.5), h))).toVar();

              this.visible.element(slot).assign(vec4(wx, h, wz, bladeH));
              this.visible2.element(slot).assign(vec4(yaw, tint, dry, slope));
            });
          });
        });
      });
    })().compute(this.candidates * this.perCell);
  }

  /** Ein Halm: gefächertes Band mit Spitze, beidseitig sichtbar. */
  _buildMesh() {
    const mat = new MeshStandardNodeMaterial();
    mat.side = DoubleSide;
    mat.name = 'GrassMaterial';

    const vSeg = attribute('seg', 'float');    // 0 unten .. 1 Spitze
    const vSide = attribute('side', 'float');  // -1 .. +1

    const inst = this.visible.element(instanceIndex);
    const inst2 = this.visible2.element(instanceIndex);

    /* --- Wind: zwei Wellen plus Böe --- */
    const windAt = Fn(([xz, seg]) => {
      const w = normalize(this.windDir).toVar();
      const phase = dot(xz, w).mul(0.22).sub(time.mul(1.9)).toVar();
      const sway = sin(phase).mul(0.55).add(sin(phase.mul(2.7).add(1.3)).mul(0.25)).toVar();
      // Böen wandern als breite Front über die Fläche
      const gust = smoothstep(0.35, 1.0,
        sin(dot(xz, w).mul(0.035).sub(time.mul(0.55)).add(this.gustPhase))).toVar();
      const amp = sway.mul(float(0.35).add(gust.mul(0.85))).mul(this.windStrength).toVar();
      return w.mul(amp.mul(seg.mul(seg)));
    });

    mat.positionNode = Fn(() => {
      const base = vec3(inst.x, inst.y, inst.z).toVar();
      const bladeH = inst.w.toVar();
      const yaw = inst2.x.toVar();

      const seg = vSeg.toVar();
      const side = vSide.toVar();

      // Breite verjüngt sich zur Spitze
      const width = float(0.022).mul(float(1.0).sub(pow(seg, 1.25))).toVar();

      const c = cos(yaw).toVar(), s = sin(yaw).toVar();
      const tangent = vec3(c, 0.0, s.negate()).toVar();

      const local = tangent.mul(side.mul(width)).toVar();
      local.y.addAssign(seg.mul(bladeH));

      // Eigenkrümmung: Halme hängen zur Spitze hin über
      const bend = seg.mul(seg).mul(0.42).toVar();
      local.addAssign(vec3(s, 0.0, c).mul(bend.mul(bladeH)));

      // Wind
      const w = windAt(base.xz, seg).toVar();
      local.x.addAssign(w.x.mul(bladeH));
      local.z.addAssign(w.y.mul(bladeH));
      // Halme werden beim Beugen kürzer, sonst wirken sie gummiartig
      local.y.mulAssign(float(1.0).sub(length(w).mul(0.35)));

      // Der Spieler drückt das Gras zur Seite
      const toP = base.xz.sub(this.playerPos.xz).toVar();
      const d = length(toP).toVar();
      const push = saturate(float(1.0).sub(d.div(this.trampleRadius))).toVar();
      const pd = normalize(vec3(toP.x, 0.0, toP.y).add(vec3(0.0001, 0.0, 0.0))).toVar();
      local.addAssign(pd.mul(push.mul(push).mul(seg).mul(bladeH.mul(0.85))));
      local.y.mulAssign(float(1.0).sub(push.mul(push).mul(0.6)));

      return base.add(local);
    })();

    mat.normalNode = Fn(() => {
      const yaw = inst2.x.toVar();
      const c = cos(yaw).toVar(), s = sin(yaw).toVar();
      // Blattnormale: senkrecht zur Halmebene, zur Kamera hin gedreht,
      // damit einzelne Halme nicht schwarz erscheinen.
      const flat = vec3(s, 0.35, c).toVar();
      const toCam = normalize(cameraPosition.sub(positionWorld)).toVar();
      const n = normalize(mix(flat, toCam, 0.42)).toVar();
      return n;
    })();

    mat.colorNode = Fn(() => {
      const seg = vSeg.toVar();
      const tint = inst2.y.toVar();
      const dry = inst2.z.toVar();
      // Wurzel dunkel, Spitze hell: die vertikale Abstufung macht den Look
      const c = mix(this.baseColor, this.tipColor, pow(seg, 0.75)).toVar();
      c.assign(mix(c, this.dryColor, dry.mul(0.72)));
      c.mulAssign(float(0.78).add(tint.mul(0.44)));
      // Selbstverschattung im Bestand
      c.mulAssign(float(0.55).add(seg.mul(0.45)));
      return vec4(c, 1.0);
    })();

    mat.roughnessNode = float(0.82);
    mat.metalnessNode = float(0.0);

    // Durchscheinen: Gras leuchtet im Gegenlicht auf
    mat.emissiveNode = Fn(() => {
      const seg = vSeg.toVar();
      const v = normalize(cameraPosition.sub(positionWorld)).toVar();
      const l = normalize(this.atmo.sunDirection).toVar();
      const back = pow(saturate(dot(v, l.negate()).negate()), 3.0).toVar();
      const sun = this.atmo.sunColorU.mul(this.atmo.sunLuminanceU).toVar();
      return this.tipColor.mul(sun).mul(back.mul(seg).mul(0.16));
    })();

    const mesh = new Mesh(this.geometry, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = false;      // Halmschatten kosten mehr als sie bringen
    mesh.receiveShadow = true;
    mesh.name = 'Grass';
    mesh.renderOrder = 2;
    return mesh;
  }

  /** Pro Frame: Uniforms setzen und die beiden Kernel starten. */
  update(renderer, camera, playerPos, dt) {
    this.origin.value.set(camera.position.x, camera.position.z);
    this.camPos.value.copy(camera.position);
    this.playerPos.value.copy(playerPos);
    this.gustPhase.value += dt * 0.35;

    // Sichtkegelebenen aus der Sicht-Projektions-Matrix (nur die Seiten,
    // nah und fern erledigt die Entfernungsprüfung)
    camera.updateMatrixWorld();
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const m = _m.elements;
    const planes = [
      [m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],   // links
      [m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],   // rechts
      [m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]],   // unten
      [m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],   // oben
    ];
    for (let i = 0; i < 4; i++) {
      const p = planes[i];
      const inv = 1 / Math.hypot(p[0], p[1], p[2]);
      this.frustum[i].value.set(p[0] * inv, p[1] * inv, p[2] * inv, p[3] * inv);
    }

    renderer.compute(this.resetKernel);
    renderer.compute(this.cullKernel);
  }
}

const _m = new Matrix4();

/** Höhenfeld als Textur: r = Höhe, gba = Normale. */
function makeHeightTexture(terrain) {
  const res = terrain.res;
  const data = new Float32Array(res * res * 4);
  for (let i = 0; i < res * res; i++) {
    data[i * 4 + 0] = terrain.heights[i];
    data[i * 4 + 1] = terrain.normals[i * 3 + 0];
    data[i * 4 + 2] = terrain.normals[i * 3 + 1];
    data[i * 4 + 3] = terrain.normals[i * 3 + 2];
  }
  const t = new DataTexture(data, res, res, RGBAFormat, FloatType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/** Halmgeometrie: `segments` Quads, oben zu einer Spitze zulaufend. */
function makeBladeGeometry(segments = 5) {
  const verts = [];
  const segAttr = [];
  const sideAttr = [];
  const idx = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    if (i === segments) {
      verts.push(0, 0, 0); segAttr.push(t); sideAttr.push(0);
    } else {
      verts.push(0, 0, 0); segAttr.push(t); sideAttr.push(-1);
      verts.push(0, 0, 0); segAttr.push(t); sideAttr.push(1);
    }
  }

  for (let i = 0; i < segments - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  // Spitzendreieck
  const last = (segments - 1) * 2;
  idx.push(last, segments * 2, last + 1);

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  g.setAttribute('seg', new BufferAttribute(new Float32Array(segAttr), 1));
  g.setAttribute('side', new BufferAttribute(new Float32Array(sideAttr), 1));
  g.setIndex(new BufferAttribute(new Uint16Array(idx), 1));
  // Auslenkung passiert im Shader; eine feste große Hülle verhindert,
  // dass three aus Nullkoordinaten eine entartete Kugel berechnet.
  g.boundingSphere = new Sphere(new Vector3(0, 0, 0), 1e6);
  return g;
}
