/**
 * Prozedurale Tonkulisse.
 *
 * Kein einziges Audiofile: alles wird aus Rauschen, Oszillatoren und Filtern
 * erzeugt. Das hält das Projekt bei null Assets und lässt sich frei
 * modulieren – Brandung wird lauter, wenn man ans Wasser geht, der Wind
 * folgt der Höhe, und der Bosskampf legt eine Streicherfläche darunter.
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.55;
    this._steps = 0;
    this._lastStep = 0;
    this._musicNodes = [];
    this._menu = null;          // HTMLAudioElement des Hauptmenüs
    this._menuFade = 0;         // laufender Fade-Timer
    this._menuArm = null;       // wartet auf die erste Nutzergeste
  }

  /** Muss aus einer Nutzeraktion heraus laufen (Autoplay-Sperre). */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this._buildAmbience();
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  /* ------------------------------------------------------------ Bausteine */

  _noiseBuffer(seconds = 2) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      // leicht rosa gefärbtes Rauschen klingt natürlicher als weißes
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  _env(node, { attack = 0.005, decay = 0.2, peak = 1, sustain = 0, hold = 0 }) {
    const g = this.ctx.createGain();
    const t = this.t;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + attack);
    if (hold > 0) g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001),
      t + attack + hold + decay);
    node.connect(g);
    return g;
  }

  /* ------------------------------------------------------------ Kulisse */

  _buildAmbience() {
    const ctx = this.ctx;

    /* --- Brandung: gefiltertes Rauschen mit langsamer Amplitudenwelle --- */
    const surf = ctx.createBufferSource();
    surf.buffer = this._noiseBuffer(6);
    surf.loop = true;
    const surfFilter = ctx.createBiquadFilter();
    surfFilter.type = 'lowpass';
    surfFilter.frequency.value = 620;
    surfFilter.Q.value = 0.4;
    const surfGain = ctx.createGain();
    surfGain.gain.value = 0.16;
    surf.connect(surfFilter).connect(surfGain).connect(this.master);
    surf.start();

    // Wellenrhythmus über einen sehr langsamen Oszillator
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.085;
    lfo.connect(lfoGain).connect(surfGain.gain);
    lfo.start();

    /* --- Wind: höher gefiltertes Rauschen --- */
    const wind = ctx.createBufferSource();
    wind.buffer = this._noiseBuffer(5);
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 480;
    windFilter.Q.value = 0.8;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.05;
    wind.connect(windFilter).connect(windGain).connect(this.master);
    wind.start();

    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.07;
    const windLfoGain = ctx.createGain();
    windLfoGain.gain.value = 260;
    windLfo.connect(windLfoGain).connect(windFilter.frequency);
    windLfo.start();

    this.surfGain = surfGain;
    this.windGain = windGain;
    this.windFilter = windFilter;
  }

  /* ------------------------------------------------------------ Effekte */

  /** Schwungrauschen einer Klinge. */
  swing(weight = 1) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.5);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.6;
    const t = this.t;
    f.frequency.setValueAtTime(400 / weight, t);
    f.frequency.exponentialRampToValueAtTime(2200 / weight, t + 0.14);
    const g = this._env(f, { attack: 0.02, decay: 0.22, peak: 0.28 });
    src.connect(f);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 0.5);
  }

  /** Treffer: kurzer Impuls, geblockt klingt metallischer. */
  hit(blocked = false) {
    if (!this.ctx) return;
    const t = this.t;
    const osc = this.ctx.createOscillator();
    osc.type = blocked ? 'square' : 'sawtooth';
    osc.frequency.setValueAtTime(blocked ? 720 : 190, t);
    osc.frequency.exponentialRampToValueAtTime(blocked ? 240 : 62, t + 0.16);
    const g = this._env(osc, { attack: 0.002, decay: blocked ? 0.28 : 0.18, peak: blocked ? 0.20 : 0.30 });
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.5);

    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.3);
    const f = this.ctx.createBiquadFilter();
    f.type = blocked ? 'highpass' : 'lowpass';
    f.frequency.value = blocked ? 1800 : 900;
    const ng = this._env(f, { attack: 0.001, decay: 0.12, peak: 0.24 });
    src.connect(f);
    ng.connect(this.master);
    src.start(t);
    src.stop(t + 0.3);
  }

  /** Schritt auf Sand oder Gras. */
  step() {
    if (!this.ctx) return;
    const t = this.t;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.2);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700 + Math.random() * 500;
    const g = this._env(f, { attack: 0.002, decay: 0.09, peak: 0.09 });
    src.connect(f);
    g.connect(this.master);
    src.start(t);
    src.stop(t + 0.2);
  }

  death() {
    if (!this.ctx) return;
    const t = this.t;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.7);
    const g = this._env(osc, { attack: 0.01, decay: 0.8, peak: 0.22 });
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 1.2);
  }

  /* ------------------------------------------------------------ Hauptmenü */

  /**
   * Titelmusik für Bootscreen und Fuchsauswahl.
   *
   * Das einzige echte Audiofile im Projekt, deshalb läuft es bewusst nicht
   * über den AudioContext, sondern über ein <audio>-Element: so muss der
   * Kontext (und damit die prozedurale Kulisse) noch nicht wach sein,
   * während das Menü offen ist. Autoplay ist in Browsern gesperrt, also
   * versuchen wir es sofort und hängen uns sonst an die erste Geste –
   * spätestens der Klick auf einen Fuchs startet die Musik.
   */
  menuStart(volume = 0.5) {
    if (this._menu) return;
    const el = new window.Audio('menumusic.mp3');
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
    this._menu = el;
    this._menuTarget = volume;

    const rampIn = () => this._fadeMenu(volume, 2.5);
    const tryPlay = () => el.play().then(rampIn).catch(() => false);

    tryPlay();
    // Fallback: Autoplay verweigert – auf die erste Nutzergeste warten.
    const arm = () => { tryPlay(); disarm(); };
    const disarm = () => {
      removeEventListener('pointerdown', arm);
      removeEventListener('keydown', arm);
      this._menuArm = null;
    };
    addEventListener('pointerdown', arm);
    addEventListener('keydown', arm);
    this._menuArm = disarm;
  }

  /** Blendet die Titelmusik aus und gibt das Element frei. */
  menuStop(seconds = 2.0) {
    if (this._menuArm) this._menuArm();
    const el = this._menu;
    if (!el) return;
    this._menu = null;
    this._fadeElement(el, 0, seconds, () => {
      el.pause();
      el.removeAttribute('src');    // Puffer freigeben, ohne die Seite neu zu laden
      el.load();
    });
  }

  _fadeMenu(to, seconds) {
    if (this._menu) this._fadeElement(this._menu, to, seconds);
  }

  /** Lautstärkerampe für ein <audio>-Element, unabhängig vom AudioContext. */
  _fadeElement(el, to, seconds, done) {
    if (el._fadeTimer) clearInterval(el._fadeTimer);
    const from = el.volume;
    const steps = Math.max(1, Math.round(seconds * 30));
    let i = 0;
    el._fadeTimer = setInterval(() => {
      i++;
      const k = Math.min(1, i / steps);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k >= 1) {
        clearInterval(el._fadeTimer);
        el._fadeTimer = null;
        done?.();
      }
    }, 1000 / 30);
  }

  /* ------------------------------------------------------------ Musik */

  /** Tiefe Streicherfläche für den Bosskampf. */
  bossStart() {
    if (!this.ctx || this._musicNodes.length) return;
    const t = this.t;
    const root = 55;                          // A1
    const voices = [1, 1.5, 2, 3, 4.5];       // Quinten und Oktaven
    const bus = this.ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(0.13, t + 3.5);
    bus.connect(this.master);

    for (const m of voices) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = root * m;
      o.detune.value = (Math.random() - 0.5) * 14;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 340;
      f.Q.value = 1.1;
      const g = this.ctx.createGain();
      g.gain.value = 0.9 / voices.length;
      o.connect(f).connect(g).connect(bus);
      o.start(t);
      this._musicNodes.push(o, f, g);

      // langsames Schweben, damit die Fläche nicht steht
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.06;
      const lg = this.ctx.createGain();
      lg.gain.value = 90;
      lfo.connect(lg).connect(f.frequency);
      lfo.start(t);
      this._musicNodes.push(lfo, lg);
    }
    this._musicBus = bus;
  }

  /** Phase zwei: Fläche wird heller und lauter. */
  bossPhase() {
    if (!this._musicBus) return;
    const t = this.t;
    this._musicBus.gain.exponentialRampToValueAtTime(0.21, t + 1.5);
    for (const n of this._musicNodes) {
      if (n.frequency && n.type === 'lowpass') {
        n.frequency.exponentialRampToValueAtTime(760, t + 1.8);
      }
    }
    // Paukenschlag
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(34, t + 0.9);
    const g = this._env(osc, { attack: 0.004, decay: 1.1, peak: 0.42 });
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 1.4);
  }

  stopMusic() {
    if (!this._musicBus) return;
    const t = this.t;
    this._musicBus.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
    for (const n of this._musicNodes) {
      if (n.stop) try { n.stop(t + 2.2); } catch { /* bereits gestoppt */ }
    }
    this._musicNodes = [];
    this._musicBus = null;
  }

  victory() {
    this.stopMusic();
    if (!this.ctx) return;
    const t = this.t;
    // aufsteigende Quinte, sehr sparsam – Souls feiert leise
    [220, 330, 440].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.55);
      g.gain.exponentialRampToValueAtTime(0.14, t + i * 0.55 + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.55 + 2.4);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.55);
      o.stop(t + i * 0.55 + 2.6);
    });
  }

  levelTwo() {
    this.stopMusic();
    if (!this.surfGain) return;
    const t = this.t;
    // Kein Meer mehr, dafür deutlich mehr Wind
    this.surfGain.gain.exponentialRampToValueAtTime(0.012, t + 3.0);
    this.windGain.gain.exponentialRampToValueAtTime(0.14, t + 3.0);
    this.windFilter.frequency.value = 720;
  }

  /** Wird jeden Frame gerufen: Schritte und Lautstärkeanpassung. */
  update(dt, player, world) {
    if (!this.ctx || !player) return;

    // Schrittgeräusche aus der Laufanimation ableiten
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    if (speed > 0.7 && player.grounded && !player.dead) {
      this._steps += dt * speed * 0.55;
      if (this._steps > 1) { this._steps = 0; this.step(); }
    }

    // Brandung wird lauter, je näher man am Wasser steht
    if (this.surfGain && world?.seaLevel !== undefined && world.seaLevel > -1e5) {
      const h = Math.max(0, player.position.y - world.seaLevel);
      const target = 0.055 + 0.16 * Math.max(0, 1 - h / 26);
      const g = this.surfGain.gain;
      g.value += (target - g.value) * Math.min(1, dt * 1.5);
    }
  }

  /** Von Animationsereignissen aufgerufen. */
  play(name) {
    switch (name) {
      case 'windup': this.swing(1.6); break;
      case 'windupHeavy': this.swing(2.2); break;
      case 'bowDraw': this.swing(0.6); break;
      case 'castCharge': this.cast(); break;
      default: break;
    }
  }

  cast() {
    if (!this.ctx) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.35);
    const g = this._env(o, { attack: 0.08, decay: 0.3, peak: 0.12 });
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.7);
  }
}
