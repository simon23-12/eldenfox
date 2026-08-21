import { Vector3, MathUtils } from 'three/webgpu';
import { Character } from './Character.js';
import * as C from '../anim/Clips.js';

const _v = new Vector3(), _v2 = new Vector3();

/**
 * Vom Spieler gesteuerte Figur.
 *
 * Souls-Konventionen: Ausweichen kostet Ausdauer und gibt Unverwundbarkeit,
 * gehaltenes Rennen zehrt Ausdauer, Angriffe puffern Eingaben und lassen
 * sich per Rolle abbrechen, sobald das Fenster offen ist.
 */
export class Player extends Character {
  constructor(def, world) {
    super(def, world);
    this.isPlayer = true;
    this.faction = 'player';
    this.flasks = 5;
    this.maxFlasks = 5;

    this.sprintHold = 0;
    this.wantsSprint = false;
    this.lockOn = false;
    this.lockCandidates = [];
    this.moveInput = new Vector3();
    this.moveAmount = 0;
    this.runes = 0;
  }

  /**
   * @param {import('../core/Input.js').Input} input
   * @param {object} cam Kamerarig mit yaw
   */
  control(input, cam, dt) {
    if (this.dead) return;

    /* --- Bewegungsvektor in Kamerakoordinaten --- */
    const ix = input.move.x, iy = input.move.y;
    const amount = Math.min(1, Math.hypot(ix, iy));
    this.moveAmount = amount;

    const yaw = cam.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    // (sin yaw, cos yaw) zeigt vom Spieler zur Kamera, also nach hinten – die
    // Kamera sitzt in CameraRig auf `look + dir * distance`. Nach vorn geht es
    // demnach mit +iy, nicht mit -iy. Mit -iy lief W rueckwaerts und S vorwaerts.
    // Das Seitwaertsglied (ix) bleibt unveraendert, es stimmte schon.
    this.moveInput.set(fx * iy + fz * ix, 0, fz * iy - fx * ix);
    if (this.moveInput.lengthSq() > 1e-6) this.moveInput.normalize();

    /* --- Anvisieren umschalten --- */
    if (input.justPressed('lockon')) {
      if (this.lockTarget) { this.lockTarget = null; this.lockOn = false; }
      else {
        const t = this.world.findLockTarget(this, cam);
        if (t) { this.lockTarget = t; this.lockOn = true; }
      }
    }
    if (this.lockTarget && (this.lockTarget.dead
      || this.lockTarget.position.distanceTo(this.position) > 34)) {
      this.lockTarget = null;
      this.lockOn = false;
    }

    /* --- Rennen --- */
    const sprintKey = input.has('sprint');
    if (sprintKey && amount > 0.15 && this.stamina > 2) this.sprintHold += dt;
    else this.sprintHold = 0;
    this.wantsSprint = this.sprintHold > 0.16;

    /* --- Ausweichen (gepuffert) --- */
    if (input.consumeBuffered('dodge', 260)) {
      const canCancel = this.state !== 'attack' || this.comboWindow > 0;
      if (canCancel) this.tryRoll(this.moveInput.x, this.moveInput.z);
    }

    /* --- Angriffe --- */
    if (input.consumeBuffered('light', 320)) {
      const running = this.wantsSprint && amount > 0.4;
      this.tryAttack(running ? 'running' : 'light');
    }
    if (input.consumeBuffered('heavy', 320)) this.tryAttack('heavy');
    if (input.consumeBuffered('special', 320)) this.tryAttack('heavy');

    /* --- Blocken --- */
    this.blocking = input.has('block') && this.canAct() && this.stamina > 4;

    /* --- Heilen --- */
    if (input.justPressed('heal')) this.tryDrink();
  }

  update(dt, world) {
    if (!this.dead && this.canAct()) {
      const st = this.st;
      let speed = 0;

      if (this.moveAmount > 0.05) {
        if (this.wantsSprint) {
          speed = st.sprintSpeed;
          this.stamina -= 12 * dt;
          if (this.stamina <= 0) { this.stamina = 0; this.wantsSprint = false; }
        } else {
          speed = st.moveSpeed * (this.blocking ? 0.55 : 1) * this.moveAmount;
        }
      }

      if (speed > 0) {
        const accel = this.grounded ? 26 : 6;
        _v.copy(this.moveInput).multiplyScalar(speed);
        this.velocity.x = MathUtils.lerp(this.velocity.x, _v.x, Math.min(1, accel * dt));
        this.velocity.z = MathUtils.lerp(this.velocity.z, _v.z, Math.min(1, accel * dt));
      }

      /* --- Ausrichtung --- */
      if (this.lockTarget) {
        _v2.copy(this.lockTarget.position).sub(this.position);
        this.targetFacing = Math.atan2(_v2.x, _v2.z);
      } else if (this.moveAmount > 0.05) {
        this.targetFacing = Math.atan2(this.moveInput.x, this.moveInput.z);
      }

      this._chooseLocomotion(speed);
    }

    super.update(dt, world);
  }

  /** Wählt den Fortbewegungsclip anhand von Tempo und Anvisieren. */
  _chooseLocomotion(speed) {
    if (this.state !== 'idle' && this.state !== 'move') return;

    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    if (planar < 0.35) {
      this.setState('idle', this.blocking ? C.BLOCK_IDLE : C.IDLE, { fade: 0.16 });
      return;
    }

    if (this.lockTarget && !this.wantsSprint) {
      // Seitwärtsbewegung relativ zur Blickrichtung
      const fwd = _v.set(Math.sin(this.facing), 0, Math.cos(this.facing));
      const right = _v2.set(fwd.z, 0, -fwd.x);
      const lateral = this.velocity.x * right.x + this.velocity.z * right.z;
      const forward = this.velocity.x * fwd.x + this.velocity.z * fwd.z;
      if (Math.abs(lateral) > Math.abs(forward) * 1.25) {
        const clip = lateral > 0 ? C.STRAFE_R : C.STRAFE_L;
        this.setState('move', clip, { fade: 0.18, keepPhase: true, speed: Math.min(1.6, planar / 3.0) });
        return;
      }
    }

    const st = this.st;
    // Hysterese: hochschalten spaeter als runterschalten. Ohne das flattert
    // der Clip im Grenzbereich zwischen Laufen und Rennen mehrmals pro
    // Sekunde hin und her, was sichtbar hakt.
    const rennt = this._gait === C.SPRINT;
    const laeuft = rennt || this._gait === C.RUN;
    const sprintSchwelle = st.sprintSpeed * (rennt ? 0.72 : 0.88);
    const runSchwelle = st.moveSpeed * (laeuft ? 0.44 : 0.60);

    let clip = C.WALK, rate = planar / (st.moveSpeed * 0.62);
    if (planar > sprintSchwelle) { clip = C.SPRINT; rate = planar / st.sprintSpeed; }
    else if (planar > runSchwelle) { clip = C.RUN; rate = planar / st.moveSpeed; }
    this._gait = clip;
    this.setState('move', clip, { fade: 0.18, keepPhase: true, speed: MathUtils.clamp(rate, 0.55, 1.8) });
  }
}
