import { Object3D, Vector3, Quaternion, Euler, MathUtils } from 'three/webgpu';

/**
 * Humanoides Skelett aus verschachtelten Object3D-Knochen.
 *
 * Bewusst starr statt geskinnt: die Figuren tragen Plattenrüstung, dort sind
 * segmentierte Teile die richtige Darstellung, und es spart die komplette
 * Gewichtungsmaschinerie. Die Silhouette entsteht über Proportionen und
 * saubere Posen, nicht über Vertexdeformation.
 *
 * Alle Längen in Metern, Referenzgröße 1.80 m.
 */

/** name: [parentName, [x, y, z] Offset zum Elternteil] */
export const BONES = {
  root:       [null,       [0, 0, 0]],
  hips:       ['root',     [0, 0.98, 0]],
  spine:      ['hips',     [0, 0.10, 0]],
  chest:      ['spine',    [0, 0.16, 0]],
  upperChest: ['chest',    [0, 0.15, 0]],
  neck:       ['upperChest', [0, 0.10, 0]],
  head:       ['neck',     [0, 0.09, 0]],

  shoulderL:  ['upperChest', [ 0.055, 0.055, 0]],
  shoulderR:  ['upperChest', [-0.055, 0.055, 0]],
  armL:       ['shoulderL',  [ 0.135, 0, 0]],
  armR:       ['shoulderR',  [-0.135, 0, 0]],
  forearmL:   ['armL',       [ 0.265, 0, 0]],
  forearmR:   ['armR',       [-0.265, 0, 0]],
  handL:      ['forearmL',   [ 0.245, 0, 0]],
  handR:      ['forearmR',   [-0.245, 0, 0]],

  thighL:     ['hips',    [ 0.095, -0.06, 0]],
  thighR:     ['hips',    [-0.095, -0.06, 0]],
  shinL:      ['thighL',  [0, -0.42, 0]],
  shinR:      ['thighR',  [0, -0.42, 0]],
  footL:      ['shinL',   [0, -0.41, 0]],
  footR:      ['shinR',   [0, -0.41, 0]],
  toeL:       ['footL',   [0, -0.06, 0.10]],
  toeR:       ['footR',   [0, -0.06, 0.10]],

  // Anker für Umhang, Haare, Effekte
  capeAnchor: ['upperChest', [0, 0.04, -0.09]],
};

export const LIMB_LENGTH = {
  arm: 0.265, forearm: 0.245, thigh: 0.42, shin: 0.41,
};

export class Rig {
  constructor() {
    /** @type {Record<string, Object3D>} */
    this.bones = {};
    this.root = new Object3D();
    this.root.name = 'rigRoot';

    for (const [name, [parent, off]] of Object.entries(BONES)) {
      const b = new Object3D();
      b.name = name;
      b.position.fromArray(off);
      this.bones[name] = b;
      if (parent === null) this.root.add(b);
      else this.bones[parent].add(b);
    }

    /** Ruhelage merken, damit Posen relativ dazu arbeiten können. */
    this.rest = {};
    for (const [n, b] of Object.entries(this.bones)) {
      this.rest[n] = { p: b.position.clone(), q: b.quaternion.clone() };
    }

    this._q = new Quaternion();
    this._e = new Euler();
    this._v = new Vector3();
  }

  get(name) { return this.bones[name]; }

  /** Setzt alle Knochen zurück auf die Ruhelage. */
  resetPose() {
    for (const [n, b] of Object.entries(this.bones)) {
      b.position.copy(this.rest[n].p);
      b.quaternion.copy(this.rest[n].q);
    }
  }

  /**
   * Wendet eine Pose an. Eine Pose bildet Knochennamen auf
   * `[rx, ry, rz]` (Grad) oder `{ r: [..], p: [..] }` ab.
   */
  applyPose(pose) {
    for (const [name, val] of Object.entries(pose)) {
      const b = this.bones[name];
      if (!b) continue;
      const r = Array.isArray(val) ? val : val.r;
      if (r) {
        this._e.set(
          MathUtils.degToRad(r[0]), MathUtils.degToRad(r[1]), MathUtils.degToRad(r[2]), 'YXZ',
        );
        b.quaternion.setFromEuler(this._e);
      }
      if (!Array.isArray(val) && val.p) {
        b.position.copy(this.rest[name].p).add(this._v.fromArray(val.p));
      }
    }
  }

  /** Weltposition eines Knochens (Matrizen müssen aktuell sein). */
  worldPos(name, target = new Vector3()) {
    return this.bones[name].getWorldPosition(target);
  }
}

/* -------------------------------------------------------------------------- */
/* Posenrechnen                                                                */
/* -------------------------------------------------------------------------- */

/** Lineare Mischung zweier Posen; fehlende Knochen zählen als Ruhelage. */
export function blendPose(a, b, t, out = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const ra = toArr(a[k]);
    const rb = toArr(b[k]);
    const pa = toPos(a[k]);
    const pb = toPos(b[k]);
    const r = [
      lerpAngle(ra[0], rb[0], t),
      lerpAngle(ra[1], rb[1], t),
      lerpAngle(ra[2], rb[2], t),
    ];
    if (pa || pb) {
      const p0 = pa ?? [0, 0, 0];
      const p1 = pb ?? [0, 0, 0];
      out[k] = { r, p: [lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t), lerp(p0[2], p1[2], t)] };
    } else {
      out[k] = r;
    }
  }
  return out;
}

/** Additiv: `add` wird auf `base` draufgerechnet (Winkel addiert). */
export function addPose(base, add, weight = 1, out = {}) {
  const keys = new Set([...Object.keys(base), ...Object.keys(add)]);
  for (const k of keys) {
    const rb = toArr(base[k]);
    const ra = toArr(add[k]);
    const pb = toPos(base[k]);
    const pa = toPos(add[k]);
    const r = [rb[0] + ra[0] * weight, rb[1] + ra[1] * weight, rb[2] + ra[2] * weight];
    if (pb || pa) {
      const p0 = pb ?? [0, 0, 0];
      const p1 = pa ?? [0, 0, 0];
      out[k] = { r, p: [p0[0] + p1[0] * weight, p0[1] + p1[1] * weight, p0[2] + p1[2] * weight] };
    } else {
      out[k] = r;
    }
  }
  return out;
}

function toArr(v) {
  if (v === undefined) return [0, 0, 0];
  return Array.isArray(v) ? v : (v.r ?? [0, 0, 0]);
}
function toPos(v) {
  if (v === undefined || Array.isArray(v)) return null;
  return v.p ?? null;
}
function lerp(a, b, t) { return a + (b - a) * t; }
/** Winkelinterpolation auf kürzestem Weg, in Grad. */
function lerpAngle(a, b, t) {
  let d = ((b - a) % 360 + 540) % 360 - 180;
  return a + d * t;
}

/* -------------------------------------------------------------------------- */
/* Zwei-Knochen-IK (Arme und Beine)                                            */
/* -------------------------------------------------------------------------- */

const _a = new Vector3(), _b = new Vector3(), _c = new Vector3();
const _dir = new Vector3(), _axis = new Vector3(), _q1 = new Vector3();

/**
 * Richtet eine Kette Oberteil -> Unterteil -> Endstück auf ein Weltziel aus.
 * Der Ellbogen/das Knie zeigt dabei in Richtung `poleDir`.
 *
 * @param {Object3D} upper   Oberschenkel bzw. Oberarm
 * @param {Object3D} lower   Schienbein bzw. Unterarm
 * @param {Vector3}  target  Weltposition des Endstücks
 * @param {Vector3}  poleDir Weltrichtung, in die das Gelenk ausknicken soll
 * @param {number}   l1      Länge Oberteil
 * @param {number}   l2      Länge Unterteil
 */
export function solveTwoBoneIK(upper, lower, target, poleDir, l1, l2) {
  upper.updateWorldMatrix(true, false);
  const origin = _a.setFromMatrixPosition(upper.matrixWorld);

  _dir.copy(target).sub(origin);
  const dist = MathUtils.clamp(_dir.length(), 1e-4, l1 + l2 - 1e-4);
  _dir.normalize();

  // Kosinussatz für den Winkel am oberen Gelenk
  const cosA = MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const angleA = Math.acos(cosA);

  // Ebene aus Zielrichtung und Polvektor
  _axis.copy(poleDir).cross(_dir);
  if (_axis.lengthSq() < 1e-8) _axis.set(1, 0, 0);
  _axis.normalize();

  const parentInv = upper.parent.getWorldQuaternion(new Quaternion()).invert();

  // Weltausrichtung des Oberteils: entlang _dir, dann um angleA aufgeklappt
  const upperWorldDir = _b.copy(_dir).applyAxisAngle(_axis, -angleA);
  const qUpper = quatFromUnitVectors(new Vector3(0, -1, 0), upperWorldDir);
  upper.quaternion.copy(parentInv).multiply(qUpper);

  // Unterteil zeigt vom Knie zum Ziel
  upper.updateWorldMatrix(true, false);
  const kneeWorld = _c.copy(origin).addScaledVector(upperWorldDir, l1);
  const lowerWorldDir = _q1.copy(target).sub(kneeWorld).normalize();
  const upperInv = upper.getWorldQuaternion(new Quaternion()).invert();
  const qLower = quatFromUnitVectors(new Vector3(0, -1, 0), lowerWorldDir);
  lower.quaternion.copy(upperInv).multiply(qLower);
}

const _tmpQ = new Quaternion();
function quatFromUnitVectors(from, to) {
  return _tmpQ.clone().setFromUnitVectors(from, to);
}
