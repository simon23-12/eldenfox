/**
 * Die acht Füchse als spielbare Klassen.
 *
 * Aussehen, Werte und Moveset in einem Eintrag. Die Typenfarben und
 * Eigenheiten sind aus dem Füchsemon-Projekt übernommen und in
 * Souls-Archetypen übersetzt.
 */

export const ROSTER = [
  {
    id: 'viktor',
    name: 'Viktor',
    title: 'Der Eisbrecher',
    klass: 'Großschwertkämpfer',
    glyph: '🗡',
    desc: 'Trägt einen Zweihänder, der eher Türrahmen als Klinge ist. Jeder Schlag '
      + 'braucht eine Ansage, aber was er trifft, steht danach nicht mehr.',
    weapon: 'greatsword',
    weaponTint: 0xb8ccd8,
    stats: { hp: 1150, stamina: 130, fp: 40, poise: 62, strength: 1.28, dex: 0.82, int: 0.7, speed: 0.90 },
    body: {
      bulk: 1.16, scale: 1.05, skin: 0xc99a72, hair: 0xc8ad76,
      cloth: 0x2d4152, cloth2: 0x1c2a36, armor: 0x8fa8bc, trim: 0xbfd4e2, leather: 0x3a4450,
      helmet: 'none', hairStyle: 'short', tabardColor: 0x24384a,
      pauldrons: 'plate', eye: 0xa8e0ff, eyeGlow: 0.5, accent: 'runes', accentColor: 0x9fd8ff,
    },
  },
  {
    id: 'sascha',
    name: 'Sascha',
    title: 'Der Turbolader',
    klass: 'Schwertkämpfer',
    glyph: '⚔',
    desc: 'Langschwert, saubere Kette, kein überflüssiger Schnörkel. Wer ihn '
      + 'unterschätzt, kassiert drei Treffer, bevor der erste registriert ist.',
    weapon: 'longsword',
    weaponTint: 0xd8e2ee,
    stats: { hp: 1000, stamina: 155, fp: 60, poise: 44, strength: 1.0, dex: 1.10, int: 0.85, speed: 1.03 },
    body: {
      bulk: 1.0, scale: 1.0, skin: 0xc79a76, hair: 0x3a2c22, beard: true, glasses: true,
      cloth: 0x3b3f4b, cloth2: 0x22252c, armor: 0xa8b0bc, trim: 0xd8c070, leather: 0x4a3524,
      helmet: 'none', hairStyle: 'curly', tabardColor: 0x2b2f38,
      pauldrons: 'plate', eye: 0xffe8a8, eyeGlow: 0.35,
    },
  },
  {
    id: 'max',
    name: 'Max',
    title: 'Der Doppelte',
    klass: 'Zweiklingenkämpfer',
    glyph: '🔥',
    desc: 'Zwei Klingen, null Geduld. Sein Kampfstil besteht daraus, so lange '
      + 'zu schlagen, bis das Problem sich erledigt hat.',
    weapon: 'dualBlades',
    weaponTint: 0xe8c090,
    stats: { hp: 940, stamina: 175, fp: 55, poise: 32, strength: 0.92, dex: 1.30, int: 0.8, speed: 1.14 },
    body: {
      bulk: 0.96, scale: 0.99, skin: 0xc08a60, hair: 0x4a3524,
      cloth: 0x8c2f22, cloth2: 0x2a2a34, armor: 0xb06038, trim: 0xe8d040, leather: 0x5c2418,
      helmet: 'none', hairStyle: 'curly', tabardColor: 0x6e2418,
      pauldrons: 'cloth', gloves: 0xd03828, eye: 0xffb060, eyeGlow: 0.85,
      chestPlate: false, greaves: false, accent: 'runes', accentColor: 0xff8a3c,
    },
  },
  {
    id: 'simi',
    name: 'Simi',
    title: 'Der Stabführer',
    klass: 'Stabkämpfer',
    glyph: '🥢',
    desc: 'Ein Stab, endlose Kreise, und irgendwo dazwischen ein Treffer, den '
      + 'niemand kommen sah. Reichweite ist sein halber Sieg.',
    weapon: 'staff',
    weaponTint: 0x6b4a2a,
    stats: { hp: 1020, stamina: 168, fp: 80, poise: 40, strength: 0.95, dex: 1.18, int: 1.05, speed: 1.08 },
    body: {
      bulk: 0.98, scale: 1.0, skin: 0xc79a76, hair: 0xc2a069,
      cloth: 0x2f5a76, cloth2: 0x1e3a4e, armor: 0x9ab4c4, trim: 0xd8eaf4, leather: 0x8a5a2a,
      helmet: 'hood', hairStyle: 'short', tabardColor: 0x28506a,
      pauldrons: 'cloth', eye: 0xa8dcea, eyeGlow: 0.55,
      chestPlate: false,
    },
  },
  {
    id: 'basti',
    name: 'Basti',
    title: 'Der Fallensteller',
    klass: 'Bogenschütze',
    glyph: '🏹',
    desc: 'Bleibt auf Abstand und lässt andere die Arbeit machen. Wenn er '
      + 'anlegt, ist der Kampf meist schon entschieden.',
    weapon: 'bow',
    weaponTint: 0x3f3225,
    stats: { hp: 900, stamina: 150, fp: 70, poise: 26, strength: 0.9, dex: 1.32, int: 0.95, speed: 1.10 },
    body: {
      bulk: 0.94, scale: 1.0, skin: 0xc79a76, hair: 0xd4bb84, glasses: true,
      cloth: 0x5a6470, cloth2: 0x30343c, armor: 0x8a929e, trim: 0xb8bec6, leather: 0x2a2a30,
      helmet: 'none', hairStyle: 'short', tabardColor: 0x3a4048,
      pauldrons: 'cloth', chestPlate: false, greaves: false, eye: 0xd0d8e0, eyeGlow: 0.3,
    },
  },
  {
    id: 'christian',
    name: 'Christian',
    title: 'Der Schmetterer',
    klass: 'Bogenschütze',
    glyph: '🎯',
    desc: 'Ruhige Hand, harter Zug. Wo Basti auf Tricks setzt, verlässt '
      + 'Christian sich schlicht darauf, dass der Pfeil ankommt.',
    weapon: 'bow',
    weaponTint: 0x4a3b2a,
    stats: { hp: 980, stamina: 160, fp: 60, poise: 34, strength: 1.05, dex: 1.22, int: 0.85, speed: 1.02 },
    body: {
      bulk: 1.04, scale: 1.02, skin: 0xc99a72, hair: 0xc2a069,
      cloth: 0x3a5a88, cloth2: 0x2a3a52, armor: 0x9aa8b8, trim: 0xe8e4dc, leather: 0x7a4a28,
      helmet: 'none', hairStyle: 'short', tabardColor: 0x2f4a68,
      pauldrons: 'plate', eye: 0xcfe0ff, eyeGlow: 0.3,
    },
  },
  {
    id: 'vitali',
    name: 'Vitali',
    title: 'Der Feenmagier',
    klass: 'Zauberer',
    glyph: '✦',
    desc: 'Wirft Licht in Formen, die es eigentlich nicht annehmen sollte. '
      + 'Zerbrechlich im Nahkampf, verheerend auf Distanz.',
    weapon: 'catalyst',
    weaponTint: 0xffb8dc,
    stats: { hp: 820, stamina: 120, fp: 190, poise: 18, strength: 0.72, dex: 0.95, int: 1.42, speed: 1.0 },
    body: {
      bulk: 0.92, scale: 0.99, skin: 0xd0a888, hair: 0x6b4a2f, beard: true,
      cloth: 0xc888b0, cloth2: 0x7a4a68, armor: 0xe8c0d8, trim: 0xf0dcea, leather: 0x8a6a7a,
      helmet: 'circlet', hairStyle: 'long', tabardColor: 0xa86a92,
      pauldrons: 'cloth', chestPlate: false, greaves: false, bracers: false,
      eye: 0xffd0ea, eyeGlow: 1.5, accent: 'runes', accentColor: 0xffa8d8,
    },
  },
  {
    id: 'preuss',
    name: 'Preuß',
    title: 'Der Stahlbeter',
    klass: 'Zauberer',
    glyph: '⚙',
    desc: 'Magie aus Metall und Sturheit. Läuft in voller Rüstung ins Feuer '
      + 'und zaubert dabei so gelassen, als wäre es Feierabend.',
    weapon: 'catalyst',
    weaponTint: 0xa8c0d8,
    stats: { hp: 1080, stamina: 128, fp: 150, poise: 58, strength: 1.12, dex: 0.78, int: 1.24, speed: 0.88 },
    body: {
      bulk: 1.14, scale: 1.04, skin: 0xc08a60, hair: 0x8a6a44, beard: true,
      cloth: 0x5a6270, cloth2: 0x33383f, armor: 0x8a929e, trim: 0xbcc4cc, leather: 0x3a3a42,
      helmet: 'full', hairStyle: 'short', tabardColor: 0x424852,
      pauldrons: 'plate', eye: 0x9fd0ff, eyeGlow: 1.2, accent: 'runes', accentColor: 0x8fc4ff,
    },
  },
];

export const ROSTER_BY_ID = Object.fromEntries(ROSTER.map((r) => [r.id, r]));

/** Werte, mit denen die Kampflogik rechnet. */
export function derivedStats(def) {
  const s = def.stats;
  return {
    maxHp: s.hp,
    maxStamina: s.stamina,
    maxFp: s.fp,
    poise: s.poise,
    staminaRegen: 34 + s.stamina * 0.09,
    fpRegen: 1.6 + s.fp * 0.012,
    moveSpeed: 4.15 * s.speed,
    sprintSpeed: 7.2 * s.speed,
    rollSpeed: 1.0 * (0.85 + 0.3 * s.speed),
    damageScale: s.strength,
    dexScale: s.dex,
    intScale: s.int,
  };
}
