import { Vector3, Quaternion, MathUtils, Raycaster } from 'three/webgpu';

const _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3();

/**
 * Kamera hinter der Schulter mit Anvisiermodus.
 *
 * Ohne Ziel dreht die Maus frei; mit Ziel rahmt die Kamera Spieler und Gegner
 * gemeinsam und hält beide im Bild. Ein Federarm verhindert, dass die Kamera
 * im Gelände steckenbleibt.
 */
export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = 0;
    this.pitch = -0.13;
    this.distance = 4.6;
    this.targetDistance = 4.6;
    this.height = 1.55;
    this.shoulder = 0.55;
    this.pos = new Vector3();
    this.look = new Vector3();
    this.shake = 0;
    this.shakeDecay = 3.6;
    this.fovBase = 58;
    this.fovTarget = 58;
    this._t = 0;
  }

  /** Kurzer Kamerastoß, z. B. bei einem schweren Treffer. */
  addShake(amount) { this.shake = Math.min(1.4, this.shake + amount); }

  update(dt, player, input) {
    this._t += dt;

    if (!player.lockTarget) {
      this.yaw -= input.look.x;
      this.pitch = MathUtils.clamp(this.pitch - input.look.y, -1.15, 0.72);
    } else {
      // Kamera hinter den Spieler ziehen, Ziel im oberen Bilddrittel
      _v.copy(player.lockTarget.position).sub(player.position);
      const want = Math.atan2(_v.x, _v.z) + Math.PI;
      const diff = MathUtils.euclideanModulo(want - this.yaw + Math.PI, Math.PI * 2) - Math.PI;
      this.yaw += diff * Math.min(1, 7.0 * dt);

      const dist = Math.max(1.5, _v.length());
      const targetPitch = MathUtils.clamp(-0.10 - 0.32 / dist, -0.5, 0.05);
      this.pitch += (targetPitch - this.pitch) * Math.min(1, 5.0 * dt);
      // etwas weiter weg, damit beide ins Bild passen
      this.targetDistance = MathUtils.clamp(4.2 + dist * 0.16, 4.2, 7.2);
    }

    if (input.mouse.wheel) {
      this.targetDistance = MathUtils.clamp(this.targetDistance + input.mouse.wheel * 0.5, 2.2, 9.0);
    }

    /* --- Zielpunkt --- */
    const focusH = player.height * (player.lockTarget ? 0.82 : 0.72);
    _v3.copy(player.position).add(_v.set(0, focusH, 0));
    if (player.lockTarget) {
      player.lockTarget.chestPos(_v2);
      _v3.lerp(_v2, 0.30);
    }
    this.look.lerp(_v3, Math.min(1, 14 * dt));

    /* --- Federarm --- */
    this.distance += (this.targetDistance - this.distance) * Math.min(1, 6 * dt);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = _v.set(Math.sin(this.yaw) * cp, -sp, Math.cos(this.yaw) * cp).normalize();
    const right = _v2.set(dir.z, 0, -dir.x).normalize();

    const wanted = this.pos.copy(this.look)
      .addScaledVector(dir, this.distance)
      .addScaledVector(right, this.shoulder);

    // Gelände: nie unter den Boden tauchen
    const g = this.world.heightAt(wanted.x, wanted.z);
    if (wanted.y < g + 0.55) wanted.y = g + 0.55;

    // Hindernisse: Abstand verkürzen, wenn etwas dazwischen steht
    const blocked = this.world.cameraSweep?.(this.look, wanted, 0.35);
    if (blocked && blocked < 1) {
      wanted.lerpVectors(this.look, wanted, Math.max(0.25, blocked));
    }

    this.camera.position.copy(wanted);

    /* --- Erschütterung --- */
    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.16;
      this.camera.position.x += Math.sin(this._t * 61.3) * s;
      this.camera.position.y += Math.sin(this._t * 47.7 + 1.2) * s;
      this.camera.position.z += Math.sin(this._t * 53.1 + 2.4) * s;
      this.shake = Math.max(0, this.shake - dt * this.shakeDecay);
    }

    this.camera.lookAt(this.look);

    /* --- Blickwinkel: beim Rennen leicht öffnen --- */
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    this.fovTarget = this.fovBase + MathUtils.clamp((speed - 4.5) * 1.5, 0, 7);
    if (Math.abs(this.camera.fov - this.fovTarget) > 0.01) {
      this.camera.fov += (this.fovTarget - this.camera.fov) * Math.min(1, 4 * dt);
      this.camera.updateProjectionMatrix();
    }
  }
}
