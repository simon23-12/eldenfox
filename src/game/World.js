import {
  Group, Vector3, Vector2, MathUtils, Mesh, SphereGeometry, IcosahedronGeometry,
  MeshStandardNodeMaterial, Color, CylinderGeometry, ConeGeometry,
} from 'three/webgpu';
import { Enemy } from './Enemy.js';

const _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3();

/**
 * Weltzustand und Kampfschiedsrichter.
 *
 * Hält Gelände, Wasser, Figuren, Geschosse und Effekte zusammen und stellt
 * den Figuren die Abfragen bereit, die sie brauchen: Bodenhöhe, Kollisionen,
 * Zielsuche, Treffermeldungen.
 */
export class World {
  constructor(engine) {
    this.engine = engine;
    this.scene = engine.scene;
    this.terrain = null;
    this.ocean = null;
    this.grass = null;
    this.player = null;
    this.combatants = [];
    this.projectiles = [];
    this.effects = [];
    this.seaLevel = 0;
    this.gravity = 22;
    this.arenaBounds = null;
    this.onEnemyDeath = null;
    this.audio = null;

    this.fxGroup = new Group();
    this.fxGroup.name = 'fx';
    this.scene.add(this.fxGroup);

    this._sparkGeo = new IcosahedronGeometry(0.055, 0);
    this._boltGeo = new IcosahedronGeometry(0.16, 1);
    this._arrowGeo = new CylinderGeometry(0.014, 0.006, 0.85, 5);
    this._arrowGeo.rotateX(Math.PI / 2);
    this._pool = [];
  }

  /* ------------------------------------------------------------------ Abfragen */

  /** Bodenhöhe: Gelände, aber nie unter dem Wasserspiegel begehbar. */
  heightAt(x, z) {
    const t = this.terrain ? this.terrain.heightAt(x, z) : 0;
    return Math.max(t, this.walkableSea ? this.seaLevel : -60);
  }

  /** Trennt Figuren, damit sie nicht ineinander stehen. */
  resolveCollisions(char) {
    for (const other of this.combatants) {
      if (other === char || other.dead) continue;
      _v.set(char.position.x - other.position.x, 0, char.position.z - other.position.z);
      const d = _v.length();
      const minD = char.radius + other.radius;
      if (d > 1e-4 && d < minD) {
        const push = (minD - d) * (other.isBoss ? 1.0 : 0.5);
        _v.divideScalar(d).multiplyScalar(push);
        char.position.x += _v.x;
        char.position.z += _v.z;
        if (!other.isBoss && !other.dead) {
          other.position.x -= _v.x * 0.6;
          other.position.z -= _v.z * 0.6;
        }
      }
    }

    if (this.arenaBounds) {
      const b = this.arenaBounds;
      _v.set(char.position.x - b.center.x, 0, char.position.z - b.center.z);
      const d = _v.length();
      if (d > b.radius - char.radius) {
        _v.setLength(b.radius - char.radius);
        char.position.x = b.center.x + _v.x;
        char.position.z = b.center.z + _v.z;
      }
    }
  }

  /** Nächstes sinnvolles Ziel im Blickfeld. */
  findLockTarget(from, cam) {
    let best = null, bestScore = -Infinity;
    const camDir = _v3.set(Math.sin(cam.yaw), 0, Math.cos(cam.yaw)).negate();
    for (const c of this.combatants) {
      if (c === from || c.dead || c.faction === from.faction) continue;
      _v.copy(c.position).sub(from.position);
      const dist = _v.length();
      if (dist > 30) continue;
      _v.y = 0; _v.normalize();
      const facing = _v.dot(camDir);
      if (facing < 0.15) continue;
      const score = facing * 2.2 - dist * 0.055 + (c.isBoss ? 0.6 : 0);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  /** Sichtprüfung für die Kamera; 0..1 = zulässiger Anteil der Strecke. */
  cameraSweep(from, to, radius) {
    // Nur gegen das Gelände: Figuren blockieren die Kamera bewusst nicht.
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = MathUtils.lerp(from.x, to.x, t);
      const y = MathUtils.lerp(from.y, to.y, t);
      const z = MathUtils.lerp(from.z, to.z, t);
      if (y < this.heightAt(x, z) + radius) return Math.max(0.2, (i - 1) / steps);
    }
    return 1;
  }

  /* ------------------------------------------------------------------ Spawn */

  addCombatant(c) {
    this.combatants.push(c);
    this.scene.add(c.object);
    if (c !== this.player) {
      c.onDeath = () => {
        this.player && (this.player.runes += c.runeReward ?? 0);
        this.onEnemyDeath?.(c);
      };
    }
    return c;
  }

  spawnEnemy(type, x, z, opts = {}) {
    const def = { ...type, ...opts };
    const e = new Enemy(def, this);
    e.place(x, z, this, opts.facing ?? 0);
    return this.addCombatant(e);
  }

  /* ------------------------------------------------------------------ Effekte */

  spawnProjectile(owner, kind) {
    const cfg = PROJECTILES[kind] ?? PROJECTILES.bolt;
    const geo = cfg.arrow ? this._arrowGeo : this._boltGeo;
    const mat = new MeshStandardNodeMaterial({
      color: new Color(cfg.color),
      emissive: new Color(cfg.color),
      emissiveIntensity: cfg.glow,
      roughness: 0.4,
      metalness: 0.0,
    });
    const m = new Mesh(geo, mat);
    m.scale.setScalar(cfg.scale);
    m.castShadow = false;

    const hand = owner.rig.bones[cfg.arrow ? 'handL' : 'handR'];
    hand.getWorldPosition(_v);
    m.position.copy(_v);

    // Richtung: auf das Ziel, sonst geradeaus
    if (owner.lockTarget && !owner.lockTarget.dead) {
      owner.lockTarget.chestPos(_v2);
    } else if (owner.target && !owner.target.dead) {
      owner.target.chestPos(_v2);
    } else {
      _v2.copy(owner.position)
        .add(_v3.set(Math.sin(owner.facing), 1.1, Math.cos(owner.facing)).multiplyScalar(24));
    }
    const dir = _v2.sub(_v).normalize();

    this.fxGroup.add(m);
    this.projectiles.push({
      mesh: m, dir: dir.clone(), speed: cfg.speed, life: cfg.life,
      damage: cfg.damage * (owner.weaponStats.baseDamage / 24)
        * (owner.st.intScale ?? 1), owner,
      radius: cfg.radius, gravity: cfg.gravity ?? 0, poise: cfg.poise ?? 12,
      stagger: cfg.stagger ?? 1, burst: cfg.burst ?? 0, color: cfg.color,
    });
  }

  spawnShockwave(owner, radius) {
    for (const c of this.combatants) {
      if (c === owner || c.dead || c.faction === owner.faction) continue;
      const d = c.position.distanceTo(owner.position);
      if (d < radius) {
        c.applyDamage(owner.weaponStats.baseDamage * 0.55, {
          from: owner.position, poise: 30, stagger: 1.6, attacker: owner,
        });
      }
    }
    this.spawnBurst(owner.position, 0xffcc88, 26, 5.5, 0.55);
    this.engine.cameraRig?.addShake(0.55);
  }

  spawnHealBurst(owner) {
    owner.chestPos(_v);
    this.spawnBurst(_v, 0xd8b060, 22, 2.2, 0.9);
  }

  onHitEffect(attacker, target, at) {
    this.spawnBurst(at, target.blocking ? 0xffe8b0 : 0xff8060, 12, 3.2, 0.35);
    if (attacker.isPlayer) this.engine.cameraRig?.addShake(0.18);
    else this.engine.cameraRig?.addShake(0.10);
  }

  /** Kurzlebige Funken; bewusst simpel gehalten und wiederverwendet. */
  spawnBurst(pos, color, count, speed, life) {
    for (let i = 0; i < count; i++) {
      const m = this._pool.pop() ?? new Mesh(this._sparkGeo, new MeshStandardNodeMaterial({
        roughness: 0.5, metalness: 0.0,
      }));
      m.material.color.set(color);
      m.material.emissive.set(color);
      m.material.emissiveIntensity = 5.0;
      m.visible = true;
      m.position.copy(pos);
      m.scale.setScalar(0.6 + Math.random() * 0.9);
      this.fxGroup.add(m);
      const dir = new Vector3(
        Math.random() * 2 - 1, Math.random() * 1.4 + 0.15, Math.random() * 2 - 1,
      ).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this.effects.push({ mesh: m, vel: dir, life, maxLife: life });
    }
  }

  /* ------------------------------------------------------------------ Abräumen */

  /**
   * Entfernt alles, was zum aktuellen Abschnitt gehört.
   * Der Spieler bleibt erhalten und wandert in den nächsten Abschnitt mit.
   */
  clearLevel() {
    for (const c of this.combatants) {
      if (c === this.player) continue;
      this.scene.remove(c.object);
      c.mesh.geometry.dispose();
      c.mesh.material.dispose();
    }
    this.combatants = this.player ? [this.player] : [];

    for (const p of this.projectiles) {
      this.fxGroup.remove(p.mesh);
      p.mesh.material.dispose();
    }
    this.projectiles.length = 0;

    for (const e of this.effects) this.fxGroup.remove(e.mesh);
    this.effects.length = 0;

    for (const name of ['terrain', 'ocean', 'grass', 'clouds', 'fog']) {
      const o = this[name];
      if (o?.mesh) { this.scene.remove(o.mesh); o.mesh.geometry?.dispose?.(); }
      this[name] = null;
    }
    for (const p of this.props ?? []) {
      this.scene.remove(p);
      p.geometry?.dispose?.();
    }
    this.props = [];

    // Level-2-Gelände hängt als eigenes Mesh in der Szene
    for (let i = this.scene.children.length - 1; i >= 0; i--) {
      const c = this.scene.children[i];
      if (c.name === 'Terrain' || c.name === 'Ocean' || c.name === 'Grass') {
        this.scene.remove(c);
        c.geometry?.dispose?.();
      }
    }

    this.arenaBounds = null;
    this.boss = null;
    this.miniBoss = null;
  }

  /* ------------------------------------------------------------------ Update */

  update(dt) {
    for (const c of this.combatants) c.update(dt, this);

    /* --- Geschosse --- */
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.gravity) p.dir.y -= p.gravity * dt * 0.02;
      p.mesh.position.addScaledVector(p.dir, p.speed * dt);
      p.mesh.lookAt(_v.copy(p.mesh.position).add(p.dir));
      p.mesh.rotateZ(dt * 12);

      let hit = null;
      for (const c of this.combatants) {
        if (c.dead || c === p.owner || c.faction === p.owner.faction) continue;
        c.chestPos(_v);
        if (p.mesh.position.distanceTo(_v) < c.radius + p.radius) { hit = c; break; }
      }

      const ground = this.heightAt(p.mesh.position.x, p.mesh.position.z);
      const grounded = p.mesh.position.y < ground;

      if (hit || grounded || p.life <= 0) {
        if (hit) {
          hit.applyDamage(p.damage, {
            from: p.mesh.position, poise: p.poise, stagger: p.stagger, attacker: p.owner,
          });
          this.spawnBurst(p.mesh.position, p.color, 14, 3.5, 0.4);
        } else if (grounded && p.burst > 0) {
          this.spawnBurst(p.mesh.position, p.color, 20, 4.0, 0.5);
        }
        this.fxGroup.remove(p.mesh);
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
      }
    }

    /* --- Funken --- */
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      e.vel.y -= 12 * dt;
      e.mesh.position.addScaledVector(e.vel, dt);
      const g = this.heightAt(e.mesh.position.x, e.mesh.position.z);
      if (e.mesh.position.y < g) { e.mesh.position.y = g; e.vel.multiplyScalar(0.25); e.vel.y = Math.abs(e.vel.y) * 0.3; }
      const k = Math.max(0, e.life / e.maxLife);
      e.mesh.scale.setScalar(0.15 + k * 0.9);
      e.mesh.material.emissiveIntensity = 5.0 * k;
      if (e.life <= 0) {
        this.fxGroup.remove(e.mesh);
        e.mesh.visible = false;
        this._pool.push(e.mesh);
        this.effects.splice(i, 1);
      }
    }
  }
}

const PROJECTILES = {
  bolt: { color: 0x9fd0ff, glow: 6, scale: 1.0, speed: 26, life: 3.5, damage: 24, radius: 0.4, poise: 14, stagger: 1, burst: 1 },
  dart: { color: 0xbfe0ff, glow: 5, scale: 0.7, speed: 34, life: 2.5, damage: 14, radius: 0.32, poise: 8, stagger: 0.6 },
  comet: { color: 0xffd0ea, glow: 9, scale: 1.9, speed: 19, life: 4.5, damage: 58, radius: 0.75, poise: 42, stagger: 1.8, burst: 1 },
  arrow: { color: 0xcfc4a8, glow: 0.2, scale: 1.0, speed: 46, life: 3.0, damage: 26, radius: 0.26, arrow: true, gravity: 1.0, poise: 12, stagger: 0.8 },
  arrowHeavy: { color: 0xffe0a0, glow: 2.2, scale: 1.35, speed: 54, life: 3.0, damage: 56, radius: 0.34, arrow: true, gravity: 0.7, poise: 34, stagger: 1.6 },
};
