import { Group, Object3D, Vector3, Quaternion, MathUtils, Color } from 'three/webgpu';
import { Rig, BONES, solveTwoBoneIK, LIMB_LENGTH } from '../anim/Rig.js';
import { Animator } from '../anim/Animator.js';
import * as C from '../anim/Clips.js';
import { MOVESETS } from '../anim/Attacks.js';
import { STANCES } from '../anim/Stances.js';
import { RigidSkinnedMesh } from '../anim/RigidSkin.js';
import { buildBody } from './Body.js';
import { WEAPONS, WEAPON_STATS, bladeAxisFor } from './Weapons.js';
import { derivedStats } from './Roster.js';

const BONE_ORDER = Object.keys(BONES);
/** name -> Elternname, fuer die weichen Gelenke im Skinning. */
const BONE_PARENTS = Object.fromEntries(
  Object.entries(BONES).map(([n, [parent]]) => [n, parent]),
);

const _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3();
const _q = new Quaternion();

/**
 * Grundlage für Spieler, Gegner und Bosse.
 *
 * Zustandsautomat, Bewegung, Trefferfenster und Werte in einem Objekt.
 * Abgeleitete Klassen liefern nur die Absicht (Eingabe oder KI) und lassen
 * `update()` den Rest erledigen.
 */
export class Character {
  /**
   * @param {object} def Eintrag aus dem Roster oder eine Gegnerdefinition
   * @param {object} world Weltschnittstelle: heightAt(), damage(), spawn...
   */
  constructor(def, world) {
    this.def = def;
    this.world = world;
    this.id = def.id;
    this.isPlayer = false;
    this.faction = def.faction ?? 'enemy';

    const st = derivedStats(def);
    this.st = st;
    this.hp = st.maxHp;
    this.maxHp = st.maxHp;
    this.stamina = st.maxStamina;
    this.fp = st.maxFp;
    this.poise = st.poise;
    this.poiseCurrent = st.poise;
    this.dead = false;

    /* --- Räumlicher Zustand --- */
    this.object = new Group();
    this.object.name = `char_${def.id}`;
    this.position = this.object.position;
    this.velocity = new Vector3();
    this.facing = 0;              // Gierwinkel in Radiant
    this.targetFacing = 0;
    this.grounded = true;
    this.radius = 0.42 * (def.body?.bulk ?? 1);
    this.height = 1.80 * (def.body?.scale ?? 1);

    /* --- Rig und Darstellung --- */
    this.rig = new Rig();
    this.object.add(this.rig.root);

    const weaponKind = def.weapon;
    this.weaponKind = weaponKind;
    this.weaponStats = WEAPON_STATS[weaponKind];
    const weapon = WEAPONS[weaponKind](undefined, def.weaponTint);
    this.weapon = weapon;

    const parts = [...buildBody(def.body ?? {}), ...weapon.parts];
    this.mesh = new RigidSkinnedMesh(parts, BONE_ORDER, { parents: BONE_PARENTS });
    this.mesh.name = `body_${def.id}`;
    this.object.add(this.mesh);

    /* --- Animation --- */
    this.anim = new Animator(this.rig);
    this.anim.onEvent = (ev) => this._onAnimEvent(ev);
    this.moveset = MOVESETS[this.weaponStats.moveset];
    this.anim.stancePose = STANCES[this.weaponStats.moveset] ?? null;
    this.anim.stanceWeight = 1;
    this.anim.stanceTarget = 1;
    this.anim.play(C.IDLE, { fade: 0 });

    /* --- Kampfzustand --- */
    this.state = 'idle';
    this.stateTime = 0;
    this.comboIndex = 0;
    this.comboWindow = 0;
    this.invulnerable = 0;
    this.hitStop = 0;
    this.activeSwing = null;
    this.swingHits = new Set();
    this.lockTarget = null;
    this.blocking = false;
    this.staggerResist = 0;
    this._prevTip = new Vector3();
    this._prevHilt = new Vector3();
    this._tipValid = false;

    /* --- Rückmeldung --- */
    this.flash = 0;
    this.onDeath = null;
    this.onHit = null;
  }

  /* ------------------------------------------------------------------ Werte */

  get alive() { return !this.dead; }

  /** Weltposition des Brustpunkts – Ziel für Anvisieren und Geschosse. */
  chestPos(out = new Vector3()) {
    return out.copy(this.position).add(_v.set(0, this.height * 0.62, 0));
  }

  /* ------------------------------------------------------------ Zustandslogik */

  canAct() {
    return !this.dead && this.state !== 'roll' && this.state !== 'hit'
      && this.state !== 'stagger' && this.state !== 'drink';
  }

  canAttack() {
    if (this.dead) return false;
    if (this.state === 'attack') return this.comboWindow > 0;
    return this.canAct();
  }

  /**
   * Wechselt in einen Zustand und startet den passenden Clip.
   *
   * Gleicher Zustand *und* gleicher Clip wird ignoriert: die
   * Fortbewegungslogik ruft das pro Frame auf, und ein zurückgesetzter
   * `stateTime` würde jede zeitabhängige Prüfung aushebeln.
   */
  setState(name, clip, opts = {}) {
    const same = this.state === name && this.anim.current === clip && !opts.restart;
    if (same) {
      if (opts.speed !== undefined) this.anim.speed = opts.speed;
      return;
    }
    this.state = name;
    this.stateTime = 0;
    // Angriffe und Rollen sind gegen die Grundhaltung authorisiert, alles
    // andere darf die Waffenhaltung behalten.
    this.anim.stanceTarget = (name === 'attack' || name === 'roll') ? 0 : 1;
    if (clip) this.anim.play(clip, opts);
  }

  /* ------------------------------------------------------------------ Aktionen */

  tryRoll(dirX, dirZ) {
    if (!this.canAct() || this.stamina < 22) return false;
    const moving = Math.abs(dirX) + Math.abs(dirZ) > 0.1;
    this.stamina -= moving ? 22 : 16;
    if (moving) {
      this.targetFacing = Math.atan2(dirX, dirZ);
      this.facing = this.targetFacing;
      this.setState('roll', C.ROLL, { fade: 0.05, restart: true });
      this.rollIFrames = C.ROLL.iframes;
    } else {
      this.setState('roll', C.BACKSTEP, { fade: 0.05, restart: true });
      this.rollIFrames = C.BACKSTEP.iframes;
    }
    this.activeSwing = null;
    this.comboWindow = 0;
    return true;
  }

  tryAttack(kind = 'light') {
    if (!this.canAttack()) return false;

    let clip;
    if (kind === 'running' && this.moveset.running) {
      clip = this.moveset.running;
      this.comboIndex = 0;
    } else if (kind === 'heavy') {
      const list = this.moveset.heavy;
      clip = list[Math.min(this.comboIndex, list.length - 1)];
      this.comboIndex = 0;
    } else {
      const list = this.moveset.light;
      const idx = this.state === 'attack' ? (this.comboIndex + 1) % list.length : 0;
      clip = list[idx];
      this.comboIndex = idx;
    }

    if (this.stamina < clip.stamina) return false;
    if (clip.fp && this.fp < clip.fp) return false;
    this.stamina -= clip.stamina;
    if (clip.fp) this.fp -= clip.fp;

    this.currentAttack = clip;
    this.comboWindow = 0;
    this.swingHits.clear();
    this._tipValid = false;
    this.setState('attack', clip, { fade: this.state === 'attack' ? 0.07 : 0.10, restart: true });
    return true;
  }

  tryDrink() {
    if (!this.canAct() || this.flasks <= 0) return false;
    this.flasks--;
    this.setState('drink', C.DRINK, { fade: 0.12, restart: true });
    return true;
  }

  /* ------------------------------------------------------------------ Treffer */

  /**
   * Schaden zufügen.
   * @param {number} amount
   * @param {object} src { from: Vector3, poise: number, stagger: number, type }
   */
  applyDamage(amount, src = {}) {
    if (this.dead || this.invulnerable > 0) return false;

    let dmg = amount;
    let blocked = false;

    if (this.blocking && src.from) {
      _v.copy(src.from).sub(this.position).setY(0).normalize();
      _v2.set(Math.sin(this.facing), 0, Math.cos(this.facing));
      if (_v.dot(_v2) > 0.25) {
        const guard = this.weaponStats.guard;
        const cost = dmg * (1 - guard) * 2.2;
        if (this.stamina >= cost) {
          this.stamina -= cost;
          dmg *= 1 - guard;
          blocked = true;
        } else {
          this.stamina = 0;
          dmg *= 1 - guard * 0.4;
          this.setState('stagger', C.HIT_HEAVY, { fade: 0.05, restart: true });
        }
      }
    }

    this.hp -= dmg;
    this.flash = 1;
    this.hitStop = blocked ? 0.05 : 0.085;
    this.onHit?.(dmg, blocked, src);

    if (this.hp <= 0) { this.die(src); return true; }

    if (!blocked) {
      this.poiseCurrent -= src.poise ?? 10;
      const heavy = (src.stagger ?? 1) >= 1.5 || this.poiseCurrent <= 0;
      if (heavy) {
        this.poiseCurrent = this.poise;
        this.setState('stagger', C.HIT_HEAVY, { fade: 0.04, restart: true });
        this.activeSwing = null;
      } else if (this.state !== 'attack' || this.anim.normalizedTime < (this.currentAttack?.poise ?? 0.2)) {
        this.setState('hit', C.HIT_LIGHT, { fade: 0.04, restart: true });
        this.activeSwing = null;
      }
      if (src.from) {
        _v.copy(this.position).sub(src.from).setY(0).normalize().multiplyScalar(heavy ? 3.2 : 1.4);
        this.velocity.x += _v.x;
        this.velocity.z += _v.z;
      }
    }
    return true;
  }

  die(src) {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    this.activeSwing = null;
    this.blocking = false;
    this.setState('dead', C.DEATH, { fade: 0.06, restart: true });
    this.onDeath?.(src);
  }

  /* ------------------------------------------------------------- Animationsevents */

  _onAnimEvent(ev) {
    switch (ev.type) {
      case 'swing':
        this.activeSwing = ev;
        this.swingHits.clear();
        this._tipValid = false;
        break;
      case 'swingEnd':
        this.activeSwing = null;
        break;
      case 'step': {
        const dir = _v.set(Math.sin(this.facing), 0, Math.cos(this.facing));
        this.velocity.addScaledVector(dir, ev.dist * 4.2);
        break;
      }
      case 'cast':
        this.world.spawnProjectile?.(this, ev.kind);
        break;
      case 'shockwave':
        this.world.spawnShockwave?.(this, ev.radius);
        break;
      case 'heal':
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.42);
        this.world.spawnHealBurst?.(this);
        break;
      case 'sfx':
        this.world.audio?.play(ev.sound, this.position);
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ Update */

  update(dt, world) {
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      dt *= 0.15;
    }

    this.stateTime += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.flash = Math.max(0, this.flash - dt * 4.5);

    // Ausdauer und Fokus erholen sich, außer beim Rennen und Blocken
    const regenScale = this.state === 'sprint' ? 0 : this.blocking ? 0.35 : 1;
    this.stamina = Math.min(this.st.maxStamina, this.stamina + this.st.staminaRegen * dt * regenScale);
    this.fp = Math.min(this.st.maxFp, this.fp + this.st.fpRegen * dt);
    if (this.poiseCurrent < this.poise) {
      this.poiseCurrent = Math.min(this.poise, this.poiseCurrent + this.poise * 0.55 * dt);
    }

    this._updateState(dt, world);
    this._integrate(dt, world);

    // Blickrichtung sanft nachziehen
    const diff = MathUtils.euclideanModulo(this.targetFacing - this.facing + Math.PI, Math.PI * 2) - Math.PI;
    const turnRate = this.state === 'attack' ? 3.0 : 11.0;
    this.facing += diff * Math.min(1, turnRate * dt);
    this.object.rotation.y = this.facing;

    const rootDelta = this.anim.update(dt);
    if (rootDelta.lengthSq() > 0) {
      // Die Clips sind mit "-Z ist vorne" gebaut (Kamerakonvention), die Figur
      // rechnet aber mit forward = (sin facing, 0, cos facing), also +Z. Ohne
      // die halbe Drehung rollt die Rolle rueckwaerts, der Backstep nach vorn,
      // und Treffer schieben in den Angreifer statt von ihm weg.
      _v.set(-rootDelta.x, rootDelta.y, -rootDelta.z)
        .applyAxisAngle(_v2.set(0, 1, 0), this.facing);
      this.position.add(_v);
    }

    this.rig.root.updateMatrixWorld(true);
    this._footIK(world);
    this.mesh.updateBones(this.rig);

    if (this.activeSwing) this._traceSwing(world);
  }

  _updateState(dt, world) {
    const a = this.anim;

    switch (this.state) {
      case 'roll':
        this.invulnerable = Math.max(
          this.invulnerable,
          (a.time >= this.rollIFrames[0] && a.time <= this.rollIFrames[1]) ? dt * 2 : 0,
        );
        if (a.finished) this.setState('idle', C.IDLE, { fade: 0.12 });
        break;

      case 'attack': {
        const clip = this.currentAttack;
        const nt = a.time / clip.dur;
        this.comboWindow = nt > (clip.cancel / clip.dur) ? 1 : 0;
        if (a.finished) {
          this.activeSwing = null;
          this.setState('idle', C.IDLE, { fade: 0.14 });
        }
        break;
      }

      case 'hit':
      case 'stagger':
        if (a.finished) this.setState('idle', C.IDLE, { fade: 0.12 });
        break;

      case 'drink':
        if (a.finished) this.setState('idle', C.IDLE, { fade: 0.14 });
        break;

      case 'dead':
        break;

      default:
        break;
    }
  }

  /** Bewegung, Schwerkraft, Bodenkontakt. */
  _integrate(dt, world) {
    const drag = this.grounded ? 9.5 : 1.2;
    this.velocity.x -= this.velocity.x * Math.min(1, drag * dt);
    this.velocity.z -= this.velocity.z * Math.min(1, drag * dt);
    this.velocity.y -= 22 * dt;

    this.position.addScaledVector(this.velocity, dt);

    const ground = world.heightAt(this.position.x, this.position.z);
    if (this.position.y <= ground + 1e-3) {
      this.position.y = ground;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    world.resolveCollisions?.(this);
  }

  /**
   * Setzt die Füße auf den Boden.
   * Ohne das schweben die Figuren an Hängen oder stecken im Gelände.
   */
  _footIK(world) {
    if (this.dead || this.state === 'roll' || !this.grounded) return;
    for (const side of ['L', 'R']) {
      const foot = this.rig.bones[`foot${side}`];
      foot.getWorldPosition(_v);
      const g = world.heightAt(_v.x, _v.z);
      const lift = g + 0.055 - _v.y;
      if (Math.abs(lift) < 0.02 || lift < -0.35) continue;
      _v.y += Math.min(0.35, lift);
      solveTwoBoneIK(
        this.rig.bones[`thigh${side}`],
        this.rig.bones[`shin${side}`],
        _v,
        _v2.set(Math.sin(this.facing), 0, Math.cos(this.facing)),
        LIMB_LENGTH.thigh, LIMB_LENGTH.shin,
      );
    }
    this.rig.root.updateMatrixWorld(true);
  }

  /**
   * Prüft das aktive Trefferfenster gegen alle Ziele.
   *
   * Die Klinge wird als Strecke zwischen Griff und Spitze behandelt und
   * zwischen zwei Frames verschliffen – sonst fliegt eine schnelle Klinge
   * bei niedriger Bildrate durch den Gegner hindurch.
   */
  _traceSwing(world) {
    const ev = this.activeSwing;
    const handBone = this.rig.bones[ev.from] ?? this.rig.bones.handR;
    handBone.getWorldPosition(_v);          // Griff
    const reach = ev.radius ?? this.weaponStats.reach;

    // Klingenachse im Handraum. Rechts zeigt die Waffe nach -X (siehe
    // Ausrichtungsschritt in Weapons.js), links nach +X. Tritte gehen nach -Y.
    if (ev.kick) _v2.set(0, -1, 0);
    else _v2.set(bladeAxisFor(ev.from), 0, 0);
    handBone.getWorldQuaternion(_q);
    _v2.applyQuaternion(_q).normalize();
    _v3.copy(_v).addScaledVector(_v2, reach);   // Spitze

    const steps = this._tipValid ? 3 : 1;
    for (const target of world.combatants) {
      if (target === this || target.dead || target.faction === this.faction) continue;
      if (this.swingHits.has(target)) continue;

      for (let s = 1; s <= steps; s++) {
        const f = s / steps;
        const hx = MathUtils.lerp(this._prevHilt.x, _v.x, f);
        const hy = MathUtils.lerp(this._prevHilt.y, _v.y, f);
        const hz = MathUtils.lerp(this._prevHilt.z, _v.z, f);
        const tx = MathUtils.lerp(this._prevTip.x, _v3.x, f);
        const ty = MathUtils.lerp(this._prevTip.y, _v3.y, f);
        const tz = MathUtils.lerp(this._prevTip.z, _v3.z, f);

        if (segmentHitsCapsule(hx, hy, hz, tx, ty, tz, target, 0.16)) {
          this.swingHits.add(target);
          const dmg = this.weaponStats.baseDamage
            * (this.currentAttack?.damage ?? 1)
            * (this.weaponStats.ranged ? this.st.intScale : this.st.damageScale)
            * (0.92 + Math.random() * 0.16);
          target.applyDamage(dmg, {
            from: this.position,
            poise: this.weaponStats.poiseDamage * (this.currentAttack?.damage ?? 1),
            stagger: this.currentAttack?.stagger ?? 1,
            attacker: this,
          });
          world.onHitEffect?.(this, target, _v3);
          break;
        }
      }
    }

    this._prevHilt.copy(_v);
    this._prevTip.copy(_v3);
    this._tipValid = true;
  }
}

/** Strecke gegen aufrechte Kapsel (Hurtbox der Figur). */
function segmentHitsCapsule(ax, ay, az, bx, by, bz, target, extra) {
  const r = target.radius + extra;
  const cy0 = target.position.y + 0.25;
  const cy1 = target.position.y + target.height * 0.92;

  // grob: horizontaler Abstand Strecke <-> senkrechte Achse
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = 0;
  if (len2 > 1e-8) {
    t = ((target.position.x - ax) * dx + (target.position.z - az) * dz) / (dx * dx + dz * dz || 1);
    t = MathUtils.clamp(t, 0, 1);
  }
  const px = ax + dx * t, py = ay + dy * t, pz = az + dz * t;
  const hx = px - target.position.x, hz = pz - target.position.z;
  if (hx * hx + hz * hz > r * r) return false;
  return py >= cy0 - r * 0.5 && py <= cy1 + r * 0.5;
}
