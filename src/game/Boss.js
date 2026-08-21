import { Vector3, MathUtils, Color } from 'three/webgpu';
import { Enemy } from './Enemy.js';
import * as C from '../anim/Clips.js';

const _v = new Vector3(), _v2 = new Vector3();

/**
 * Boss mit Phasen.
 *
 * Unterschied zum normalen Gegner: der Boss wählt aus einem Katalog von
 * Mustern statt aus einzelnen Angriffen, hält zwischen den Mustern bewusst
 * Pausen ein (damit man ihn lesen kann) und schaltet bei einem Lebens-
 * schwellwert in eine zweite Phase mit schnelleren und weiter reichenden
 * Angriffen.
 */
export class Boss extends Enemy {
  constructor(def, world) {
    super(def, world);
    this.isBoss = true;
    this.faction = 'boss';
    this.phase = 1;
    this.phaseThreshold = def.phaseThreshold ?? 0.5;
    this.patterns = def.patterns ?? DEFAULT_PATTERNS;
    this.currentPattern = null;
    this.patternStep = 0;
    this.patternTimer = 0;
    this.recovery = 0;
    this.onPhaseChange = null;
    this.arenaCenter = new Vector3();
    this.arenaRadius = def.arenaRadius ?? 28;
  }

  applyDamage(amount, src) {
    const wasAbove = this.hp / this.maxHp > this.phaseThreshold;
    const hit = super.applyDamage(amount, src);
    if (hit && this.phase === 1 && wasAbove && this.hp / this.maxHp <= this.phaseThreshold && !this.dead) {
      this._enterPhase2();
    }
    return hit;
  }

  _enterPhase2() {
    this.phase = 2;
    this.recovery = 1.6;
    this.currentPattern = null;
    this.invulnerable = 1.4;
    this.st.moveSpeed *= 1.22;
    this.st.sprintSpeed *= 1.18;
    this.ai.aggression = Math.min(1, this.ai.aggression + 0.3);
    this.poise *= 1.35;
    this.poiseCurrent = this.poise;
    this.setState('stagger', C.HIT_HEAVY, { fade: 0.1, restart: true });
    this.world.spawnShockwave?.(this, this.arenaRadius * 0.55);
    this.world.engine?.cameraRig?.addShake(1.2);
    this.onPhaseChange?.(2);
  }

  /**
   * Der Boss folgt Mustern statt Einzelentscheidungen: erst Anmarsch,
   * dann eine feste Schlagfolge, dann eine lesbare Erholungspause.
   */
  _think(dt, world) {
    const ai = this.ai;
    this.recovery = Math.max(0, this.recovery - dt);

    if (!this.target || this.target.dead) {
      this.target = world.player && !world.player.dead ? world.player : null;
    }
    if (!this.target) { this._locomotionClip(); return; }
    if (!this.canAct()) return;

    const toTarget = _v.copy(this.target.position).sub(this.position).setY(0);
    const dist = toTarget.length();
    toTarget.normalize();
    this.targetFacing = Math.atan2(toTarget.x, toTarget.z);

    if (this.recovery > 0) {
      // Erholung: langsam umkreisen, keine Angriffe
      _v2.set(toTarget.z * ai.circleDir, 0, -toTarget.x * ai.circleDir);
      this._move(_v2, this.st.moveSpeed * 0.45, dt);
      this._locomotionClip();
      return;
    }

    if (this.currentPattern) {
      this._runPattern(dt, dist, toTarget);
      return;
    }

    /* --- Neues Muster wählen --- */
    const pool = this.patterns.filter((p) => (p.phase ?? 1) <= this.phase
      && dist >= (p.minRange ?? 0) && dist <= (p.maxRange ?? 99));
    if (pool.length === 0) {
      this._move(toTarget, dist > 9 ? this.st.sprintSpeed * 0.8 : this.st.moveSpeed, dt);
      this._locomotionClip();
      return;
    }
    const total = pool.reduce((a, p) => a + (p.weight ?? 1), 0);
    let r = Math.random() * total;
    let chosen = pool[0];
    for (const p of pool) { r -= (p.weight ?? 1); if (r <= 0) { chosen = p; break; } }

    this.currentPattern = chosen;
    this.patternStep = 0;
    this.patternTimer = 0;
  }

  _runPattern(dt, dist, toTarget) {
    const pat = this.currentPattern;
    const step = pat.steps[this.patternStep];
    this.patternTimer += dt;

    if (!step) {
      this.currentPattern = null;
      this.recovery = (pat.recovery ?? 0.8) * (this.phase === 2 ? 0.65 : 1);
      if (Math.random() < 0.5) this.ai.circleDir *= -1;
      return;
    }

    switch (step.type) {
      case 'close':
        this._move(toTarget, this.st.sprintSpeed * (step.speed ?? 0.85), dt);
        this._locomotionClip();
        if (dist <= (step.range ?? 3.0) || this.patternTimer > (step.timeout ?? 3.5)) {
          this.patternStep++; this.patternTimer = 0;
        }
        break;

      case 'attack':
        if (this.state !== 'attack') {
          if (this.patternTimer > 0.05) {
            const ok = this.tryAttack(step.kind ?? 'light');
            if (!ok) { this.patternStep++; this.patternTimer = 0; }
          }
        } else if (this.anim.normalizedTime > (step.chain ?? 0.82)) {
          this.patternStep++; this.patternTimer = 0;
        }
        break;

      case 'wait':
        this._locomotionClip();
        if (this.patternTimer > (step.time ?? 0.5)) { this.patternStep++; this.patternTimer = 0; }
        break;

      case 'backoff':
        this._move(_v2.copy(toTarget).negate(), this.st.moveSpeed * 0.9, dt);
        this._locomotionClip();
        if (dist > (step.range ?? 8) || this.patternTimer > 1.6) { this.patternStep++; this.patternTimer = 0; }
        break;

      default:
        this.patternStep++;
        break;
    }
  }
}

/** Grundmuster: Anmarsch, Schlagfolge, Pause. */
const DEFAULT_PATTERNS = [
  {
    name: 'doppelschlag', weight: 3, maxRange: 26, recovery: 1.0,
    steps: [
      { type: 'close', range: 3.0 },
      { type: 'attack', kind: 'light' },
      { type: 'attack', kind: 'light' },
    ],
  },
  {
    name: 'schwerer_ueberkopf', weight: 2, maxRange: 20, recovery: 1.5,
    steps: [
      { type: 'close', range: 3.4 },
      { type: 'wait', time: 0.35 },
      { type: 'attack', kind: 'heavy' },
    ],
  },
  {
    name: 'sturmangriff', weight: 2, minRange: 6, maxRange: 30, recovery: 1.2,
    steps: [
      { type: 'close', range: 5.5, speed: 1.0 },
      { type: 'attack', kind: 'running' },
      { type: 'attack', kind: 'light' },
    ],
  },
  {
    name: 'dreierkette', weight: 2, phase: 2, maxRange: 22, recovery: 0.7,
    steps: [
      { type: 'close', range: 3.0, speed: 1.0 },
      { type: 'attack', kind: 'light' },
      { type: 'attack', kind: 'light' },
      { type: 'attack', kind: 'heavy' },
    ],
  },
  {
    name: 'abstand_neu_setzen', weight: 1, phase: 2, minRange: 0, maxRange: 8, recovery: 0.4,
    steps: [
      { type: 'backoff', range: 9 },
      { type: 'attack', kind: 'running' },
    ],
  },
];

/* ========================================================================== */

/** Der Endgegner von Level 2. */
export const BOSS_TYPES = {
  wolkenfuerst: {
    id: 'wolkenfuerst',
    name: 'Wolkenfürst',
    displayName: 'Der Fürst über den Wolken',
    weapon: 'greatsword',
    weaponTint: 0xd8c8a0,
    boss: true,
    faction: 'boss',
    phaseThreshold: 0.52,
    arenaRadius: 30,
    stats: {
      hp: 3200, stamina: 400, fp: 0, poise: 96,
      strength: 1.30, dex: 0.86, int: 0.6, speed: 0.94,
    },
    ai: { aggression: 0.62, range: 3.2, sight: 40, reaction: 0.25, leash: 60 },
    runes: 4200,
    body: {
      bulk: 1.42, scale: 1.26, skin: 0x8a7a68, hair: 0x1e1a18,
      cloth: 0x2a2634, cloth2: 0x161420, armor: 0x9a8e78, trim: 0xd8b860,
      leather: 0x241c16,
      helmet: 'full', hairStyle: 'none', tabardColor: 0x33203a,
      pauldrons: 'plate', eye: 0xffd070, eyeGlow: 3.0,
      accent: 'runes', accentColor: 0xffc45a,
    },
  },
};
