/**
 * Eingabe: Tastatur, Maus (Pointer Lock) und Gamepad in einer Schnittstelle.
 * Aktionen sind semantisch benannt, damit die Spiellogik nie Tastencodes kennt.
 */

const KEYMAP = {
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Space: 'dodge', ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyQ: 'lockon', KeyE: 'interact', KeyR: 'heal', KeyF: 'switchArt',
  KeyC: 'crouch', Digit1: 'item1', Digit2: 'item2',
  KeyG: 'gesture', Tab: 'menu', Escape: 'pause',
};

const PAD_BUTTON = {
  0: 'dodge',      // A / Kreuz
  1: 'heavy',      // B
  2: 'light',      // X
  3: 'heal',       // Y
  4: 'block',      // LB
  5: 'light',      // RB
  6: 'special',    // LT
  7: 'heavy',      // RT
  9: 'menu',
  10: 'lockon',
  12: 'up', 13: 'down', 14: 'left', 15: 'right',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    /** aktuell gedrückt */
    this.down = new Set();
    /** in diesem Frame neu gedrückt */
    this.pressed = new Set();
    /** in diesem Frame losgelassen */
    this.released = new Set();
    /** Puffer für Angriffseingaben (Souls-typisches Input-Buffering) */
    this.buffer = [];
    this.mouse = { dx: 0, dy: 0, wheel: 0 };
    this.locked = false;
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.sensitivity = 0.0022;
    this.padIndex = null;
    this._padPrev = [];
    this.enabled = true;

    this._bind();
  }

  _bind() {
    const c = this.canvas;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const a = KEYMAP[e.code];
      if (a) { this._press(a); e.preventDefault(); }
    });
    addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this._release(a);
    });
    addEventListener('blur', () => { this.down.clear(); });

    c.addEventListener('mousedown', (e) => {
      if (!this.locked) { c.requestPointerLock?.(); return; }
      if (e.button === 0) this._press('light');
      if (e.button === 2) this._press('block');
      if (e.button === 1) { this._press('special'); e.preventDefault(); }
      if (e.button === 3) this._press('heavy');
      if (e.button === 4) this._press('lockon');
    });
    c.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._release('light');
      if (e.button === 2) this._release('block');
      if (e.button === 1) this._release('special');
      if (e.button === 3) this._release('heavy');
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });

    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    // Shift + Linksklick = schwerer Angriff, wenn keine Extramaustasten da sind
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyJ') this._press('light');
      if (e.code === 'KeyK') this._press('heavy');
      if (e.code === 'KeyL') this._press('special');
      if (e.code === 'KeyH') this._press('block');
    });
    addEventListener('keyup', (e) => {
      if (e.code === 'KeyJ') this._release('light');
      if (e.code === 'KeyK') this._release('heavy');
      if (e.code === 'KeyL') this._release('special');
      if (e.code === 'KeyH') this._release('block');
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
    });

    addEventListener('gamepadconnected', (e) => { this.padIndex = e.gamepad.index; });
    addEventListener('gamepaddisconnected', () => { this.padIndex = null; });
  }

  _press(a) {
    if (!this.enabled) return;
    if (!this.down.has(a)) this.pressed.add(a);
    this.down.add(a);
    if (a === 'light' || a === 'heavy' || a === 'dodge' || a === 'special') {
      this.buffer.push({ action: a, t: performance.now() });
      if (this.buffer.length > 4) this.buffer.shift();
    }
  }

  _release(a) {
    this.down.delete(a);
    this.released.add(a);
  }

  /** Holt eine gepufferte Aktion (max. `windowMs` alt) und verbraucht sie. */
  consumeBuffered(action, windowMs = 320) {
    const now = performance.now();
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const b = this.buffer[i];
      if (b.action === action && now - b.t <= windowMs) {
        this.buffer.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  clearBuffer() { this.buffer.length = 0; }

  has(a) { return this.down.has(a); }
  justPressed(a) { return this.pressed.has(a); }
  justReleased(a) { return this.released.has(a); }

  /** Muss einmal pro Frame *vor* der Spiellogik laufen. */
  begin() {
    // Gamepad einlesen
    const pads = navigator.getGamepads?.() ?? [];
    const pad = this.padIndex != null ? pads[this.padIndex] : pads.find?.((p) => p);
    let ax = 0, ay = 0, lx = 0, ly = 0;
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
      ax = dz(pad.axes[0] ?? 0); ay = dz(pad.axes[1] ?? 0);
      lx = dz(pad.axes[2] ?? 0); ly = dz(pad.axes[3] ?? 0);
      for (let i = 0; i < pad.buttons.length; i++) {
        const nowDown = pad.buttons[i].pressed || pad.buttons[i].value > 0.5;
        const was = this._padPrev[i] ?? false;
        const a = PAD_BUTTON[i];
        if (a) {
          if (nowDown && !was) this._press(a);
          else if (!nowDown && was) this._release(a);
        }
        this._padPrev[i] = nowDown;
      }
      if (pad.buttons[10]?.pressed) this.down.add('sprint');
    }

    // Bewegungsvektor
    let mx = (this.down.has('right') ? 1 : 0) - (this.down.has('left') ? 1 : 0);
    let my = (this.down.has('down') ? 1 : 0) - (this.down.has('up') ? 1 : 0);
    if (ax || ay) { mx = ax; my = ay; }
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.move.x = mx; this.move.y = my;

    // Blickvektor
    this.look.x = this.mouse.dx * this.sensitivity + lx * 0.055;
    this.look.y = this.mouse.dy * this.sensitivity + ly * 0.045;
    this.mouse.dx = 0; this.mouse.dy = 0;
  }

  /** Muss einmal pro Frame *nach* der Spiellogik laufen. */
  end() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.wheel = 0;
  }
}
