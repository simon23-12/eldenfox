import { Vector3, MathUtils } from 'three/webgpu';
import { blendPose, addPose } from './Rig.js';
import { NEUTRAL } from './Clips.js';

/**
 * Spielt Clips auf einem Rig ab: Überblendungen, Ereignisse, Wurzelbewegung.
 *
 * Zwei Ebenen:
 *   base     – Fortbewegung oder eine Aktion (Angriff, Rolle, Treffer)
 *   additive – Aufschläge wie Zucken oder Blickrichtung
 */
export class Animator {
  /** @param {import('./Rig.js').Rig} rig */
  constructor(rig) {
    this.rig = rig;
    this.current = null;
    this.prev = null;
    this.time = 0;
    this.prevTime = 0;
    this.fade = 0;
    this.fadeDur = 0.12;
    this.speed = 1;
    this.additive = [];
    this.onEvent = null;

    this._pose = {};
    this._poseA = {};
    this._poseB = {};
    this._poseBase = {};

    /**
     * Bereitschaftshaltung: ersetzt die Grundhaltung, solange nicht
     * angegriffen wird. Absolut, nicht additiv – die Angriffsclips bleiben
     * dadurch weiter gegen NEUTRAL authorisiert.
     */
    this.stancePose = null;
    this.stanceWeight = 0;
    this.stanceTarget = 0;
    this.stanceRate = 6.0;
    this._firedEvents = new Set();
    this._rootPrev = new Vector3();
    this.rootDelta = new Vector3();
    this.finished = false;
  }

  /**
   * Startet einen Clip.
   * @param {object} clip
   * @param {object} [o] fade (Sekunden), speed, restart
   */
  play(clip, { fade = 0.12, speed = 1, restart = false } = {}) {
    if (this.current === clip && !restart) { this.speed = speed; return; }
    this.prev = this.current;
    this.prevTime = this.time;
    this.current = clip;
    this.time = 0;
    this.speed = speed;
    this.fade = fade > 0 && this.prev ? 0 : 1;
    this.fadeDur = Math.max(1e-4, fade);
    this._firedEvents.clear();
    this._rootPrev.set(0, 0, 0);
    this.finished = false;
  }

  /** Fügt eine additive Ebene hinzu (Gewicht klingt über `decay` ab). */
  pushAdditive(clip, { weight = 1, decay = 0 } = {}) {
    this.additive.push({ clip, t: 0, weight, decay });
  }

  clearAdditive() { this.additive.length = 0; }

  get normalizedTime() {
    if (!this.current) return 0;
    return this.current.loop
      ? (this.time % this.current.dur) / this.current.dur
      : Math.min(1, this.time / this.current.dur);
  }

  update(dt) {
    this.rootDelta.set(0, 0, 0);
    if (!this.current) return this.rootDelta;

    this.time += dt * this.speed;
    if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / this.fadeDur);

    const c = this.current;
    let t = this.time;
    if (c.loop) {
      t %= c.dur;
    } else if (t >= c.dur) {
      t = c.dur;
      this.finished = true;
    }

    /* --- Basisebene --- */
    samplePose(c, t, this._poseA);

    if (this.prev && this.fade < 1) {
      const pc = this.prev;
      let pt = this.prevTime + this.time;
      if (pc.loop) pt %= pc.dur; else pt = Math.min(pt, pc.dur);
      samplePose(pc, pt, this._poseB);
      blendPose(this._poseB, this._poseA, this.fade, this._pose);
    } else {
      Object.assign(this._pose, this._poseA);
      // Knochen, die nur die vorige Pose kannte, sauber ausklingen lassen
      for (const k of Object.keys(this._pose)) {
        if (!(k in this._poseA)) delete this._pose[k];
      }
    }

    /* --- Additive Ebenen --- */
    for (let i = this.additive.length - 1; i >= 0; i--) {
      const a = this.additive[i];
      a.t += dt;
      if (a.decay > 0) a.weight -= dt / a.decay;
      if (a.weight <= 0 || (!a.clip.loop && a.t > a.clip.dur)) {
        this.additive.splice(i, 1);
        continue;
      }
      const at = a.clip.loop ? a.t % a.clip.dur : a.t;
      samplePose(a.clip, at, this._poseB);
      addPose(this._pose, this._poseB, Math.max(0, a.weight), this._pose);
    }

    /* --- Bereitschaftshaltung nachziehen --- */
    if (this.stanceWeight !== this.stanceTarget) {
      const d = this.stanceTarget - this.stanceWeight;
      this.stanceWeight += Math.sign(d) * Math.min(Math.abs(d), dt * this.stanceRate);
    }

    /* --- Grundhaltung bestimmen und Clip daraufsetzen --- */
    const base = (this.stancePose && this.stanceWeight > 0.001)
      ? blendPose(NEUTRAL, this.stancePose, this.stanceWeight, this._poseBase)
      : NEUTRAL;
    const final = addPose(base, this._pose, 1, this._poseB);
    this.rig.applyPose(final);

    /* --- Wurzelbewegung --- */
    if (c.root) {
      const p = sampleRoot(c, t);
      this.rootDelta.set(p.x - this._rootPrev.x, p.y - this._rootPrev.y, p.z - this._rootPrev.z);
      this._rootPrev.copy(p);
    }

    /* --- Ereignisse --- */
    if (c.events && this.onEvent) {
      const loopPass = c.loop ? Math.floor(this.time / c.dur) : 0;
      for (let i = 0; i < c.events.length; i++) {
        const ev = c.events[i];
        const key = `${loopPass}:${i}`;
        if (t >= ev.t && !this._firedEvents.has(key)) {
          this._firedEvents.add(key);
          this.onEvent(ev, this);
        }
      }
      if (c.loop && this._firedEvents.size > c.events.length * 3) {
        this._firedEvents.clear();
      }
    }

    return this.rootDelta;
  }
}

const _rp = new Vector3();

/** Interpoliert die Schlüsselbilder eines Clips zum Zeitpunkt t. */
export function samplePose(clip, t, out = {}) {
  const keys = clip.keys;
  if (keys.length === 1) { Object.assign(out, keys[0].pose); return out; }

  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t < t) i++;
  const a = keys[i], b = keys[i + 1];
  const span = Math.max(1e-5, b.t - a.t);
  const raw = MathUtils.clamp((t - a.t) / span, 0, 1);
  // weiches Ein- und Ausklingen: Posen wirken dadurch nicht mechanisch
  const f = raw * raw * (3 - 2 * raw);

  for (const k of Object.keys(out)) delete out[k];
  return blendPose(a.pose, b.pose, f, out);
}

/** Interpoliert die Wurzelspur. */
export function sampleRoot(clip, t) {
  const r = clip.root;
  if (!r || r.length === 0) return _rp.set(0, 0, 0);
  if (t <= r[0].t) return _rp.fromArray(r[0].p);
  for (let i = 0; i < r.length - 1; i++) {
    if (t <= r[i + 1].t) {
      const a = r[i], b = r[i + 1];
      const f = (t - a.t) / Math.max(1e-5, b.t - a.t);
      const s = f * f * (3 - 2 * f);
      return _rp.set(
        a.p[0] + (b.p[0] - a.p[0]) * s,
        a.p[1] + (b.p[1] - a.p[1]) * s,
        a.p[2] + (b.p[2] - a.p[2]) * s,
      );
    }
  }
  return _rp.fromArray(r[r.length - 1].p);
}
