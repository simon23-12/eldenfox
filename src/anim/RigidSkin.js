import {
  Mesh, BufferGeometry, BufferAttribute, Matrix4, Color, MeshPhysicalNodeMaterial,
  DynamicDrawUsage, Vector3, Box3, Sphere,
} from 'three/webgpu';
import {
  Fn, vec3, vec4, float, uint, int, attribute, positionLocal, normalLocal, instanceIndex,
  attributeArray, dot, normalize, uniform, mix, clamp, saturate, vertexColor,
} from 'three/tsl';

/**
 * Starres Skinning über einen Storage-Buffer.
 *
 * Die Figuren tragen Plattenrüstung – segmentierte Teile sind dort die
 * richtige Darstellung, und ohne Vertexgewichtung bleibt der Aufwand klein.
 * Alle Körperteile landen in *einer* Geometrie; jeder Vertex merkt sich nur
 * seinen Knochenindex. Die Knochenmatrizen liegen als 3x4-Zeilen in einem
 * Storage-Buffer, den der Vertexshader direkt liest.
 *
 * Ergebnis: ein Draw-Call je Figur, optional instanziert über mehrere
 * Figuren desselben Typs.
 */
export class RigidSkinnedMesh extends Mesh {
  /**
   * @param {Array<{geometry: BufferGeometry, bone: string, color: Color|number,
   *                roughness?: number, metalness?: number, emissive?: number}>} parts
   * @param {string[]} boneOrder  Knochennamen in fester Reihenfolge
   * @param {object} [o]
   */
  constructor(parts, boneOrder, { instances = 1, material = null } = {}) {
    const boneIndex = new Map(boneOrder.map((n, i) => [n, i]));
    const merged = mergeParts(parts, boneIndex);

    const boneCount = boneOrder.length;
    const rowsPerInstance = boneCount * 3;
    const boneBuffer = attributeArray(rowsPerInstance * instances, 'vec4').setName('boneRows');

    const mat = material ?? new MeshPhysicalNodeMaterial();

    const boneIdx = attribute('boneIdx', 'float');
    const matParams = attribute('matParams', 'vec4');

    /** Zeilenindex der Knochenmatrix für diesen Vertex. */
    const rowBase = Fn(() => instanceIndex.mul(uint(rowsPerInstance)).add(uint(boneIdx.mul(3.0))))();

    mat.positionNode = Fn(() => {
      const b = rowBase.toVar();
      const r0 = boneBuffer.element(b).toVar();
      const r1 = boneBuffer.element(b.add(uint(1))).toVar();
      const r2 = boneBuffer.element(b.add(uint(2))).toVar();
      const p = vec4(positionLocal, 1.0).toVar();
      return vec3(dot(p, r0), dot(p, r1), dot(p, r2));
    })();

    mat.normalNode = Fn(() => {
      const b = rowBase.toVar();
      const r0 = boneBuffer.element(b).toVar();
      const r1 = boneBuffer.element(b.add(uint(1))).toVar();
      const r2 = boneBuffer.element(b.add(uint(2))).toVar();
      const n = normalLocal.toVar();
      // Knochenmatrizen sind reine Rotation plus Verschiebung, daher genügt
      // der lineare Anteil ohne inverse Transponierte.
      return normalize(vec3(dot(n, r0.xyz), dot(n, r1.xyz), dot(n, r2.xyz)));
    })();

    // Farbe und Materialwerte kommen als Vertexattribute; `vertexColors = true`
    // allein reicht nicht, weil die Knoten hier ohnehin explizit gesetzt werden.
    const vcol = attribute('color', 'vec3');
    mat.colorNode = vec4(vcol, 1.0);
    mat.roughnessNode = matParams.x;
    mat.metalnessNode = matParams.y;
    mat.emissiveNode = vcol.mul(matParams.z);

    super(merged, mat);

    this.boneOrder = boneOrder;
    this.boneIndex = boneIndex;
    this.boneCount = boneCount;
    this.rowsPerInstance = rowsPerInstance;
    this.boneBuffer = boneBuffer;
    this.instanceCount = instances;
    this.castShadow = true;
    this.receiveShadow = true;
    this.frustumCulled = false;      // Auslenkung passiert im Shader

    this._rowData = boneBuffer.value.array;
    this._m = new Matrix4();
    this._rootInv = new Matrix4();
  }

  /**
   * Schreibt die aktuellen Knochenmatrizen (relativ zur Rig-Wurzel) in den
   * Storage-Buffer. Muss nach `updateMatrixWorld` des Rigs laufen.
   *
   * @param {import('./Rig.js').Rig} rig
   * @param {number} [slot] Instanzindex
   */
  updateBones(rig, slot = 0) {
    rig.root.updateMatrixWorld(true);
    this._rootInv.copy(rig.root.matrixWorld).invert();

    const base = slot * this.rowsPerInstance * 4;
    const d = this._rowData;

    for (let i = 0; i < this.boneCount; i++) {
      const bone = rig.bones[this.boneOrder[i]];
      this._m.multiplyMatrices(this._rootInv, bone.matrixWorld);
      const e = this._m.elements;   // spaltenweise
      const o = base + i * 12;
      // Zeile 0
      d[o + 0] = e[0]; d[o + 1] = e[4]; d[o + 2] = e[8]; d[o + 3] = e[12];
      // Zeile 1
      d[o + 4] = e[1]; d[o + 5] = e[5]; d[o + 6] = e[9]; d[o + 7] = e[13];
      // Zeile 2
      d[o + 8] = e[2]; d[o + 9] = e[6]; d[o + 10] = e[10]; d[o + 11] = e[14];
    }
    this.boneBuffer.value.needsUpdate = true;
  }
}

/** Führt alle Teilgeometrien zu einer zusammen und hängt die Attribute an. */
function mergeParts(parts, boneIndex) {
  let vTotal = 0, iTotal = 0;
  for (const p of parts) {
    const g = p.geometry;
    // Extrude- und Lathe-Geometrien kommen ohne Index; hier normalisieren,
    // statt das jedem Erzeuger einzeln aufzubürden.
    if (!g.index) {
      const n = g.attributes.position.count;
      const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
      for (let i = 0; i < n; i++) arr[i] = i;
      g.setIndex(new BufferAttribute(arr, 1));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    vTotal += g.attributes.position.count;
    iTotal += g.index.count;
  }

  const position = new Float32Array(vTotal * 3);
  const normal = new Float32Array(vTotal * 3);
  const color = new Float32Array(vTotal * 3);
  const matParams = new Float32Array(vTotal * 4);
  const boneIdx = new Float32Array(vTotal);
  const index = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);

  const tmp = new Color();
  let vo = 0, io = 0;

  for (const p of parts) {
    const g = p.geometry;
    const pos = g.attributes.position.array;
    const nrm = g.attributes.normal ? g.attributes.normal.array : null;
    const n = g.attributes.position.count;
    const bi = boneIndex.get(p.bone);
    if (bi === undefined) throw new Error(`RigidSkin: unbekannter Knochen "${p.bone}"`);

    position.set(pos, vo * 3);
    if (nrm) normal.set(nrm, vo * 3);

    tmp.set(p.color ?? 0xffffff);
    for (let i = 0; i < n; i++) {
      color[(vo + i) * 3 + 0] = tmp.r;
      color[(vo + i) * 3 + 1] = tmp.g;
      color[(vo + i) * 3 + 2] = tmp.b;
      matParams[(vo + i) * 4 + 0] = p.roughness ?? 0.7;
      matParams[(vo + i) * 4 + 1] = p.metalness ?? 0.0;
      matParams[(vo + i) * 4 + 2] = p.emissive ?? 0.0;
      matParams[(vo + i) * 4 + 3] = 1;
      boneIdx[vo + i] = bi;
    }

    const idx = g.index.array;
    for (let i = 0; i < idx.length; i++) index[io + i] = idx[i] + vo;

    vo += n;
    io += idx.length;
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(position, 3));
  geo.setAttribute('normal', new BufferAttribute(normal, 3));
  geo.setAttribute('color', new BufferAttribute(color, 3));
  geo.setAttribute('matParams', new BufferAttribute(matParams, 4));
  geo.setAttribute('boneIdx', new BufferAttribute(boneIdx, 1));
  geo.setIndex(new BufferAttribute(index, 1));
  geo.boundingSphere = new Sphere(new Vector3(0, 1, 0), 2.5);
  geo.boundingBox = new Box3(new Vector3(-1.5, -0.5, -1.5), new Vector3(1.5, 2.6, 1.5));
  return geo;
}
