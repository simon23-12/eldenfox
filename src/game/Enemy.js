import { Vector3, MathUtils } from 'three/webgpu';
import { Character } from './Character.js';
import * as C from '../anim/Clips.js';

const _v = new Vector3(), _v2 = new Vector3();

/**
 * Gegner mit Verhaltensautomat.
 *
 * Absicht statt Reflex: der Gegner entscheidet in Abständen neu, was er
 * vorhat, und zieht das dann durch. Dadurch entstehen lesbare Muster,
 * die man als Spieler lernen kann – das ist der Kern eines Souls-Kampfes.
 */
export class Enemy extends Character {
  constructor(def, world) {
    super(def, world);
    this.faction = def.faction ?? 'enemy';
    this.ai = {
      mode: 'idle',
      timer: 0,
      decideIn: 0,
      circleDir: Math.random() < 0.5 ? 1 : -1,
      aggression: def.ai?.aggression ?? 0.5,
      preferredRange: def.ai?.range ?? (this.weaponStats.reach * 0.72),
      sightRange: def.ai?.sight ?? 22,
      leashOrigin: new Vector3(),
      leashRange: def.ai?.leash ?? 30,
      reaction: def.ai?.reaction ?? 0.28,
      patrol: def.ai?.patrol ?? null,
      patrolIndex: 0,
    };
    this.target = null;
    this.runeReward = def.runes ?? 120;
    this.flasks = 0;
    this.healthBarName = def.displayName ?? def.name;
    this.isBoss = !!def.boss;
  }

  place(x, z, world, facing = 0) {
    this.position.set(x, world.heightAt(x, z), z);
    this.facing = facing;
    this.targetFacing = facing;
    this.ai.leashOrigin.copy(this.position);
    return this;
  }

  update(dt, world) {
    if (!this.dead) this._think(dt, world);
    super.update(dt, world);
  }

  _think(dt, world) {
    const ai = this.ai;
    ai.timer += dt;
    ai.decideIn -= dt;

    /* --- Ziel finden --- */
    if (!this.target || this.target.dead) {
      this.target = world.player && !world.player.dead ? world.player : null;
      if (this.target && this.target.position.distanceTo(this.position) > ai.sightRange) {
        this.target = null;
      }
    }

    if (!this.target) {
      this._patrol(dt, world);
      return;
    }

    const toTarget = _v.copy(this.target.position).sub(this.position);
    const dist = toTarget.length();
    toTarget.y = 0;
    const flatDist = toTarget.length();
    toTarget.normalize();

    // Leine: zu weit vom Startpunkt weg -> zurückziehen
    if (this.position.distanceTo(ai.leashOrigin) > ai.leashRange) {
      ai.mode = 'return';
    }

    if (!this.canAct()) return;

    this.targetFacing = Math.atan2(toTarget.x, toTarget.z);

    if (ai.decideIn <= 0) this._decide(flatDist);

    const st = this.st;
    switch (ai.mode) {
      case 'approach': {
        const speed = flatDist > 8 ? st.sprintSpeed * 0.86 : st.moveSpeed;
        this._move(toTarget, speed, dt);
        if (flatDist <= ai.preferredRange) { ai.mode = 'circle'; ai.decideIn = 0.2; }
        break;
      }
      case 'circle': {
        _v2.set(toTarget.z * ai.circleDir, 0, -toTarget.x * ai.circleDir);
        // leichter Zug nach innen oder außen, damit der Abstand stimmt
        const err = (flatDist - ai.preferredRange) * 0.5;
        _v2.addScaledVector(toTarget, MathUtils.clamp(err, -0.8, 0.8)).normalize();
        this._move(_v2, st.moveSpeed * 0.62, dt);
        break;
      }
      case 'retreat': {
        this._move(_v2.copy(toTarget).negate(), st.moveSpeed * 0.8, dt);
        break;
      }
      case 'attack':
        // Angriff läuft bereits, nur ausrichten
        break;
      case 'return': {
        _v2.copy(ai.leashOrigin).sub(this.position).setY(0);
        if (_v2.length() < 1.5) { ai.mode = 'idle'; this.target = null; break; }
        _v2.normalize();
        this.targetFacing = Math.atan2(_v2.x, _v2.z);
        this._move(_v2, st.moveSpeed * 0.9, dt);
        break;
      }
      default:
        ai.mode = 'approach';
        break;
    }

    this._locomotionClip();
  }

  /** Wählt das nächste Vorhaben. */
  _decide(dist) {
    const ai = this.ai;
    const r = Math.random();
    const inRange = dist <= this.weaponStats.reach * 0.92;
    const ranged = this.weaponStats.ranged;

    ai.decideIn = 0.35 + Math.random() * 0.7;

    if (ranged) {
      if (dist < 5.5 && r < 0.6) { ai.mode = 'retreat'; return; }
      if (dist < 26 && this.stamina > 25 && r < 0.35 + ai.aggression * 0.4) {
        if (this._attackNow(dist)) return;
      }
      ai.mode = dist > 16 ? 'approach' : 'circle';
      return;
    }

    if (inRange) {
      if (r < 0.28 + ai.aggression * 0.55 && this.stamina > 25) {
        if (this._attackNow(dist)) return;
      }
      ai.mode = r < 0.72 ? 'circle' : 'retreat';
      if (Math.random() < 0.3) ai.circleDir *= -1;
      return;
    }

    if (dist < this.weaponStats.reach * 1.9 && r < ai.aggression * 0.5 && this.stamina > 32) {
      if (this._attackNow(dist, true)) return;
    }
    ai.mode = 'approach';
  }

  _attackNow(dist, running = false) {
    const heavy = Math.random() < 0.28;
    const ok = this.tryAttack(running ? 'running' : heavy ? 'heavy' : 'light');
    if (ok) {
      this.ai.mode = 'attack';
      this.ai.decideIn = (this.currentAttack?.dur ?? 1) * 0.8 + 0.15 + Math.random() * 0.35;
    }
    return ok;
  }

  _move(dir, speed, dt) {
    _v2.copy(dir).setY(0).normalize().multiplyScalar(speed);
    const accel = 14;
    this.velocity.x = MathUtils.lerp(this.velocity.x, _v2.x, Math.min(1, accel * dt));
    this.velocity.z = MathUtils.lerp(this.velocity.z, _v2.z, Math.min(1, accel * dt));
  }

  _patrol(dt, world) {
    const ai = this.ai;
    if (!ai.patrol || ai.patrol.length < 2) {
      if (this.state === 'idle' || this.state === 'move') {
        this.setState('idle', C.IDLE, { fade: 0.2 });
      }
      return;
    }
    const p = ai.patrol[ai.patrolIndex];
    _v2.set(p[0] - this.position.x, 0, p[1] - this.position.z);
    if (_v2.length() < 1.2) {
      ai.patrolIndex = (ai.patrolIndex + 1) % ai.patrol.length;
      return;
    }
    _v2.normalize();
    this.targetFacing = Math.atan2(_v2.x, _v2.z);
    this._move(_v2, this.st.moveSpeed * 0.42, dt);
    this._locomotionClip();
  }

  _locomotionClip() {
    if (this.state !== 'idle' && this.state !== 'move') return;
    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    if (planar < 0.3) { this.setState('idle', C.IDLE, { fade: 0.2 }); return; }
    const st = this.st;
    const rennt = this._gait === C.SPRINT;
    const laeuft = rennt || this._gait === C.RUN;
    const sprintSchwelle = st.sprintSpeed * (rennt ? 0.70 : 0.86);
    const runSchwelle = st.moveSpeed * (laeuft ? 0.44 : 0.60);

    let clip = C.WALK, rate = planar / (st.moveSpeed * 0.62);
    if (planar > sprintSchwelle) { clip = C.SPRINT; rate = planar / st.sprintSpeed; }
    else if (planar > runSchwelle) { clip = C.RUN; rate = planar / st.moveSpeed; }
    this._gait = clip;
    this.setState('move', clip, { fade: 0.2, keepPhase: true, speed: MathUtils.clamp(rate, 0.5, 1.7) });
  }
}

/* ========================================================================== */
/* Gegnertypen                                                                */
/* ========================================================================== */

export const ENEMY_TYPES = {
  /** Strandwache – langsamer Nahkämpfer zum Steuerung lernen. */
  wache: {
    id: 'wache', name: 'Strandwache', displayName: 'Verlorene Wache',
    weapon: 'longsword', weaponTint: 0x8a8f96,
    stats: { hp: 240, stamina: 90, fp: 0, poise: 22, strength: 0.75, dex: 0.8, int: 0.5, speed: 0.72 },
    ai: { aggression: 0.35, range: 2.0, sight: 20, reaction: 0.4, leash: 26 },
    runes: 90,
    body: {
      bulk: 1.0, scale: 0.98, skin: 0x9a8a78, hair: 0x2a2420,
      cloth: 0x3a4048, cloth2: 0x24282e, armor: 0x5c6470, trim: 0x7a8290, leather: 0x352a20,
      helmet: 'full', hairStyle: 'none', tabardColor: 0x2e343c,
      pauldrons: 'plate', eye: 0x9fd8ff, eyeGlow: 1.4,
    },
  },

  /** Speerträger – hält Abstand, sticht zu. */
  speer: {
    id: 'speer', name: 'Küstenspeer', displayName: 'Küstenwache',
    weapon: 'staff', weaponTint: 0x4a3b28,
    stats: { hp: 210, stamina: 100, fp: 0, poise: 18, strength: 0.7, dex: 0.95, int: 0.5, speed: 0.85 },
    ai: { aggression: 0.5, range: 3.0, sight: 22, reaction: 0.3, leash: 28 },
    runes: 110,
    body: {
      bulk: 0.94, scale: 0.97, skin: 0x9a8a78, hair: 0x2a2420,
      cloth: 0x44403a, cloth2: 0x2a2824, armor: 0x66604e, trim: 0x8a8262, leather: 0x3a2e1e,
      helmet: 'hood', hairStyle: 'none', tabardColor: 0x38342c,
      pauldrons: 'cloth', chestPlate: false, eye: 0xffd08a, eyeGlow: 1.2,
    },
  },

  /** Hundeartig – schnell, aggressiv, wenig Leben. */
  streuner: {
    id: 'streuner', name: 'Strandstreuner', displayName: 'Strandstreuner',
    weapon: 'dualBlades', weaponTint: 0x6a6055,
    stats: { hp: 150, stamina: 120, fp: 0, poise: 10, strength: 0.6, dex: 1.1, int: 0.5, speed: 1.22 },
    ai: { aggression: 0.85, range: 1.5, sight: 26, reaction: 0.18, leash: 34 },
    runes: 70,
    body: {
      bulk: 0.82, scale: 0.88, skin: 0x8a7a68, hair: 0x1e1a16,
      cloth: 0x2e2a26, cloth2: 0x1c1a18, armor: 0x4a4238, trim: 0x6a5e4a, leather: 0x2a221a,
      helmet: 'none', hairStyle: 'curly', tabardColor: 0x24201c,
      pauldrons: 'cloth', chestPlate: false, greaves: false, eye: 0xff8a5a, eyeGlow: 1.6,
    },
  },

  /** Ritter – deutlich härter, Vorstufe zum Boss. */
  ritter: {
    id: 'ritter', name: 'Gefallener Ritter', displayName: 'Gefallener Ritter',
    weapon: 'greatsword', weaponTint: 0x9aa2ae,
    stats: { hp: 520, stamina: 130, fp: 0, poise: 48, strength: 1.0, dex: 0.7, int: 0.5, speed: 0.78 },
    ai: { aggression: 0.55, range: 2.6, sight: 24, reaction: 0.34, leash: 30 },
    runes: 320,
    body: {
      bulk: 1.16, scale: 1.06, skin: 0x8a7a68, hair: 0x2a2420,
      cloth: 0x33383f, cloth2: 0x1e2126, armor: 0x707886, trim: 0xb0a070, leather: 0x2e2620,
      helmet: 'full', hairStyle: 'none', tabardColor: 0x3a3038,
      pauldrons: 'plate', eye: 0xffc060, eyeGlow: 1.5, accent: 'runes', accentColor: 0xffb040,
    },
  },
};
