import { ROSTER } from '../game/Roster.js';

/**
 * Bildschirmanzeige und Menüs.
 *
 * Bewusst reines DOM: Balken, Text und Menüs gehören nicht in den
 * Renderpfad, und so bleiben sie scharf, zugänglich und billig.
 */
export class Hud {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      hpFill: document.getElementById('hpFill'),
      hpDelay: document.getElementById('hpDelay'),
      hpText: document.getElementById('hpText'),
      fpFill: document.getElementById('fpFill'),
      stFill: document.getElementById('stFill'),
      charTag: document.getElementById('charTag'),
      bossBar: document.getElementById('bossBar'),
      bossName: document.getElementById('bossName'),
      bossFill: document.getElementById('bossFill'),
      bossDelay: document.getElementById('bossDelay'),
      flask: document.getElementById('flaskCount'),
      msg: document.getElementById('msg'),
      perf: document.getElementById('stats'),
      died: document.getElementById('died'),
      won: document.getElementById('won'),
      wonSub: document.getElementById('wonSub'),
    };
    this._hpDelay = 1;
    this._bossDelay = 1;
    this._msgTimer = 0;
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  setCharacter(def) {
    this.el.charTag.textContent = `${def.name} — ${def.title}`;
    // Balkenbreite an die Werte koppeln: mehr Leben = längerer Balken
    const w = Math.round(210 + (def.stats.hp / 1200) * 190);
    this.el.hpFill.parentElement.style.width = `${w}px`;
    this.el.fpFill.parentElement.style.width = `${Math.round(150 + (def.stats.fp / 200) * 130)}px`;
    this.el.stFill.parentElement.style.width = `${Math.round(170 + (def.stats.stamina / 190) * 110)}px`;
  }

  /** @param {import('../game/Player.js').Player} p */
  update(p, dt) {
    const hp = Math.max(0, p.hp / p.maxHp);
    this._hpDelay += (hp - this._hpDelay) * Math.min(1, dt * (hp > this._hpDelay ? 12 : 1.6));
    this.el.hpFill.style.width = `${hp * 100}%`;
    this.el.hpDelay.style.width = `${Math.max(hp, this._hpDelay) * 100}%`;
    this.el.hpText.textContent = `${Math.ceil(Math.max(0, p.hp))}`;
    this.el.fpFill.style.width = `${(p.fp / p.st.maxFp) * 100}%`;
    this.el.stFill.style.width = `${(p.stamina / p.st.maxStamina) * 100}%`;
    this.el.flask.textContent = String(p.flasks);

    if (this._msgTimer > 0) {
      this._msgTimer -= dt;
      if (this._msgTimer <= 0) this.el.msg.classList.remove('show');
    }
  }

  setBoss(boss) {
    if (!boss) {
      this.el.bossBar.classList.add('hidden');
      this.boss = null;
      return;
    }
    this.boss = boss;
    this._bossDelay = 1;
    this.el.bossName.textContent = boss.healthBarName ?? boss.def.name;
    this.el.bossBar.classList.remove('hidden');
  }

  updateBoss(dt) {
    if (!this.boss) return;
    const hp = Math.max(0, this.boss.hp / this.boss.maxHp);
    this._bossDelay += (hp - this._bossDelay) * Math.min(1, dt * 1.4);
    this.el.bossFill.style.width = `${hp * 100}%`;
    this.el.bossDelay.style.width = `${Math.max(hp, this._bossDelay) * 100}%`;
  }

  message(text, seconds = 2.6) {
    this.el.msg.textContent = text;
    this.el.msg.classList.add('show');
    this._msgTimer = seconds;
  }

  showDeath() { this.el.died.classList.remove('hidden'); }
  hideDeath() { this.el.died.classList.add('hidden'); }
  showVictory(sub) {
    this.el.wonSub.textContent = sub ?? '';
    this.el.won.classList.remove('hidden');
  }

  perf(text) { this.el.perf.textContent = text; }
}

/**
 * Charakterauswahl. Liefert das gewählte Roster-Objekt.
 * @returns {Promise<object>}
 */
export function characterSelect() {
  const root = document.getElementById('select');
  const list = document.getElementById('roster');
  const nameEl = document.getElementById('selName');
  const classEl = document.getElementById('selClass');
  const descEl = document.getElementById('selDesc');
  const statsEl = document.getElementById('selStats');
  const movesEl = document.getElementById('selMoves');
  const beginBtn = document.getElementById('beginBtn');

  list.innerHTML = '';
  let selected = ROSTER[0];

  const cards = ROSTER.map((def) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<span class="glyph">${def.glyph}</span>`
      + `<span class="nm">${def.name}</span>`
      + `<span class="cl">${def.klass}</span>`;
    card.addEventListener('click', () => choose(def));
    card.addEventListener('mouseenter', () => preview(def));
    list.appendChild(card);
    return { card, def };
  });

  const STAT_LABEL = {
    hp: 'Leben', stamina: 'Ausdauer', fp: 'Fokus', poise: 'Stand',
    strength: 'Kraft', dex: 'Geschick', int: 'Verstand', speed: 'Tempo',
  };
  const STAT_MAX = {
    hp: 1200, stamina: 190, fp: 200, poise: 65,
    strength: 1.35, dex: 1.35, int: 1.45, speed: 1.2,
  };

  function preview(def) {
    nameEl.textContent = `${def.name}`;
    classEl.textContent = `${def.klass} · ${def.title}`;
    descEl.textContent = def.desc;

    statsEl.innerHTML = '';
    for (const [k, v] of Object.entries(def.stats)) {
      const row = document.createElement('div');
      row.className = 'stat';
      const pct = Math.round((v / STAT_MAX[k]) * 100);
      row.innerHTML = `<span>${STAT_LABEL[k]}</span>`
        + `<span class="track"><i style="width:${Math.min(100, pct)}%"></i></span>`
        + `<span>${typeof v === 'number' && v < 3 ? v.toFixed(2) : v}</span>`;
      statsEl.appendChild(row);
    }

    movesEl.innerHTML = '';
    const moves = MOVE_HINTS[def.weapon] ?? [];
    for (const [key, text] of moves) {
      const row = document.createElement('div');
      row.className = 'mv';
      row.innerHTML = `<b>${key}</b><span>${text}</span>`;
      movesEl.appendChild(row);
    }
  }

  function choose(def) {
    selected = def;
    for (const c of cards) c.card.classList.toggle('sel', c.def === def);
    preview(def);
  }

  choose(ROSTER[0]);
  root.classList.remove('hidden');

  return new Promise((resolve) => {
    const go = () => {
      root.classList.add('hidden');
      beginBtn.removeEventListener('click', go);
      removeEventListener('keydown', onKey);
      resolve(selected);
    };
    const onKey = (e) => {
      if (e.code === 'Enter' || e.code === 'Space') go();
      const i = cards.findIndex((c) => c.def === selected);
      if (e.code === 'ArrowRight') choose(ROSTER[(i + 1) % ROSTER.length]);
      if (e.code === 'ArrowLeft') choose(ROSTER[(i - 1 + ROSTER.length) % ROSTER.length]);
      if (e.code === 'ArrowDown') choose(ROSTER[(i + 4) % ROSTER.length]);
      if (e.code === 'ArrowUp') choose(ROSTER[(i + 4) % ROSTER.length]);
    };
    beginBtn.addEventListener('click', go);
    addEventListener('keydown', onKey);
  });
}

const MOVE_HINTS = {
  greatsword: [
    ['LMB', 'Weiter Bogenschlag, zwei Schläge in Folge'],
    ['RMB', 'Überkopfschlag mit Druckwelle'],
    ['Sprint+LMB', 'Rennangriff quer durch die Reihe'],
  ],
  longsword: [
    ['LMB', 'Dreierkette, schnell und sauber'],
    ['RMB', 'Weiter Rundschlag, hoher Standschaden'],
    ['Shift', 'Blocken kostet Ausdauer statt Leben'],
  ],
  dualBlades: [
    ['LMB', 'Wechselschläge, dritter ist ein Wirbel'],
    ['RMB', 'Vierfachsturm, hoher Ausdauerpreis'],
    ['Space', 'Rollen bricht die Kette jederzeit ab'],
  ],
  staff: [
    ['LMB', 'Kreisende Schläge, dann Stoß'],
    ['RMB', 'Dreifacher Wirbel um die eigene Achse'],
    ['—', 'Größte Reichweite im Roster'],
  ],
  bow: [
    ['LMB', 'Schneller Schuss'],
    ['RMB', 'Vollzug, doppelter Schaden'],
    ['Sprint+LMB', 'Tritt, um Abstand zu schaffen'],
  ],
  catalyst: [
    ['LMB', 'Lichtgeschoss, günstig im Fokus'],
    ['RMB', 'Komet, langsam und verheerend'],
    ['—', 'Fokus füllt sich langsam von allein'],
  ],
};
