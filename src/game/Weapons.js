import {
  BoxGeometry, CylinderGeometry, SphereGeometry, ConeGeometry, TorusGeometry,
  LatheGeometry, ExtrudeGeometry, Shape, Vector2, Vector3, Matrix4, Euler,
} from 'three/webgpu';

/**
 * Waffen als Teilelisten im lokalen Raum der Führungshand.
 *
 * Die Klingenachse zeigt in +X, also entlang des Arms nach außen – so
 * greifen die Angriffsposen direkt.
 */

const _m = new Matrix4();
const _e = new Euler();

function place(geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = null } = {}) {
  const g = geo.clone();
  if (scale) g.scale(scale[0], scale[1], scale[2]);
  if (rot[0] || rot[1] || rot[2]) {
    _e.set(rot[0] * Math.PI / 180, rot[1] * Math.PI / 180, rot[2] * Math.PI / 180, 'YXZ');
    g.applyMatrix4(_m.makeRotationFromEuler(_e));
  }
  g.translate(pos[0], pos[1], pos[2]);
  return g;
}

/** Klingenprofil: Schneiden dünn, Mitte mit Grat. */
function blade(len, width, thick, taper = 0.55, tipLen = 0.16) {
  const shape = new Shape();
  const hw = width / 2;
  shape.moveTo(0, -hw);
  shape.lineTo(len - tipLen, -hw * taper);
  shape.lineTo(len, 0);
  shape.lineTo(len - tipLen, hw * taper);
  shape.lineTo(0, hw);
  shape.closePath();
  const g = new ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelSize: thick * 0.4, bevelThickness: thick * 0.35, bevelSegments: 1, steps: 1 });
  g.translate(0, 0, -thick / 2);
  // ExtrudeGeometry legt die Fläche in XY, die Dicke in Z – passt bereits.
  return g;
}

const STEEL = { color: 0xc3cbd6, roughness: 0.22, metalness: 1.0 };
const DARK_STEEL = { color: 0x6f7783, roughness: 0.34, metalness: 1.0 };
const GOLD = { color: 0xc8a44a, roughness: 0.28, metalness: 1.0 };
const GRIP = { color: 0x3a2a20, roughness: 0.85, metalness: 0.0 };
const WOOD = { color: 0x5a4127, roughness: 0.8, metalness: 0.0 };

function part(bone, geometry, m, emissive = 0) {
  return { bone, geometry, color: m.color, roughness: m.roughness, metalness: m.metalness, emissive };
}

/* -------------------------------------------------------------------------- */

export const WEAPONS = {
  greatsword(hand = 'handR', tint = 0xc3cbd6) {
    const P = [];
    const st = { ...STEEL, color: tint };
    P.push(part(hand, place(blade(1.58, 0.155, 0.038), { pos: [0.20, 0, 0] }), st));
    // Blutrinne
    P.push(part(hand, place(new BoxGeometry(1.18, 0.038, 0.044), { pos: [0.78, 0, 0] }), DARK_STEEL));
    // Parierstange
    P.push(part(hand, place(new BoxGeometry(0.065, 0.40, 0.052), { pos: [0.16, 0, 0] }), GOLD));
    P.push(part(hand, place(new SphereGeometry(0.042, 8, 6), { pos: [0.16, 0.205, 0] }), GOLD));
    P.push(part(hand, place(new SphereGeometry(0.042, 8, 6), { pos: [0.16, -0.205, 0] }), GOLD));
    // Griff
    P.push(part(hand, place(new CylinderGeometry(0.032, 0.036, 0.34, 8), { pos: [-0.02, 0, 0], rot: [0, 0, 90] }), GRIP));
    P.push(part(hand, place(new SphereGeometry(0.055, 10, 8), { pos: [-0.20, 0, 0], scale: [1.1, 1, 1] }), GOLD));
    return { parts: P, reach: 2.9, twoHanded: true, hand };
  },

  longsword(hand = 'handR', tint = 0xc3cbd6) {
    const P = [];
    const st = { ...STEEL, color: tint };
    P.push(part(hand, place(blade(1.06, 0.10, 0.024), { pos: [0.14, 0, 0] }), st));
    P.push(part(hand, place(new BoxGeometry(0.055, 0.28, 0.04), { pos: [0.11, 0, 0] }), GOLD));
    P.push(part(hand, place(new CylinderGeometry(0.026, 0.030, 0.22, 8), { pos: [-0.01, 0, 0], rot: [0, 0, 90] }), GRIP));
    P.push(part(hand, place(new SphereGeometry(0.042, 10, 8), { pos: [-0.13, 0, 0] }), GOLD));
    return { parts: P, reach: 2.15, twoHanded: false, hand };
  },

  dualBlades(hand = 'handR', tint = 0xd0c0a0) {
    const P = [];
    const st = { ...STEEL, color: tint };
    for (const h of ['handR', 'handL']) {
      P.push(part(h, place(blade(0.78, 0.085, 0.02), { pos: [0.12, 0, 0] }), st));
      P.push(part(h, place(new BoxGeometry(0.04, 0.20, 0.032), { pos: [0.09, 0, 0] }), DARK_STEEL));
      P.push(part(h, place(new CylinderGeometry(0.024, 0.027, 0.17, 8), { pos: [-0.02, 0, 0], rot: [0, 0, 90] }), GRIP));
      P.push(part(h, place(new SphereGeometry(0.034, 8, 6), { pos: [-0.10, 0, 0] }), DARK_STEEL));
    }
    return { parts: P, reach: 1.8, twoHanded: false, hand: 'handR', offHand: 'handL' };
  },

  staff(hand = 'handR', tint = 0x5a4127) {
    const P = [];
    const wd = { ...WOOD, color: tint };
    P.push(part(hand, place(new CylinderGeometry(0.030, 0.030, 2.30, 10), { pos: [0.30, 0, 0], rot: [0, 0, 90] }), wd));
    // Goldringe wie beim Wukong-Stab
    for (const x of [-0.72, -0.55, 1.12, 1.30]) {
      P.push(part(hand, place(new CylinderGeometry(0.040, 0.040, 0.075, 12), { pos: [x, 0, 0], rot: [0, 0, 90] }), GOLD));
    }
    P.push(part(hand, place(new CylinderGeometry(0.037, 0.030, 0.16, 10), { pos: [1.42, 0, 0], rot: [0, 0, 90] }), GOLD));
    P.push(part(hand, place(new CylinderGeometry(0.030, 0.037, 0.16, 10), { pos: [-0.83, 0, 0], rot: [0, 0, 90] }), GOLD));
    // Griffwicklung
    P.push(part(hand, place(new CylinderGeometry(0.034, 0.034, 0.26, 10), { pos: [0.06, 0, 0], rot: [0, 0, 90] }), GRIP));
    return { parts: P, reach: 3.1, twoHanded: true, hand };
  },

  bow(hand = 'handL', tint = 0x4a3b2a) {
    const P = [];
    const wd = { ...WOOD, color: tint };
    // Rekurvbogen aus Segmenten
    const seg = 9, span = 1.55;
    for (let i = 0; i < seg; i++) {
      const t = i / (seg - 1) - 0.5;
      const y = t * span;
      const curve = Math.cos(t * Math.PI) * 0.20 + Math.sin(t * Math.PI * 2) * 0.05;
      const rot = -t * 46;
      P.push(part(hand, place(new BoxGeometry(0.032, span / seg + 0.02, 0.05),
        { pos: [curve, y, 0], rot: [0, 0, rot] }), wd));
    }
    P.push(part(hand, place(new BoxGeometry(0.05, 0.24, 0.07), { pos: [0.20, 0, 0] }), GRIP));
    // Sehne
    P.push(part(hand, place(new BoxGeometry(0.008, span * 0.98, 0.008), { pos: [-0.02, 0, 0] }), { color: 0xd8d2c4, roughness: 0.9, metalness: 0 }));
    return { parts: P, reach: 1.5, twoHanded: true, hand, ranged: true };
  },

  catalyst(hand = 'handR', crystal = 0x7ea9ff) {
    const P = [];
    P.push(part(hand, place(new CylinderGeometry(0.026, 0.032, 1.42, 9), { pos: [0.42, 0, 0], rot: [0, 0, 90] }), WOOD));
    P.push(part(hand, place(new CylinderGeometry(0.036, 0.036, 0.20, 10), { pos: [0.04, 0, 0], rot: [0, 0, 90] }), GRIP));
    // Krone am Kopfende
    P.push(part(hand, place(new TorusGeometry(0.085, 0.014, 6, 14), { pos: [1.10, 0, 0], rot: [0, 90, 0] }), GOLD));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      P.push(part(hand, place(new ConeGeometry(0.018, 0.10, 6),
        { pos: [1.16, Math.cos(a) * 0.075, Math.sin(a) * 0.075], rot: [0, 0, -90] }), GOLD));
    }
    // Kristall
    P.push(part(hand, place(new ConeGeometry(0.055, 0.15, 6), { pos: [1.13, 0, 0], rot: [0, 0, -90] }),
      { color: crystal, roughness: 0.12, metalness: 0.0 }, 2.4));
    P.push(part(hand, place(new ConeGeometry(0.055, 0.09, 6), { pos: [1.06, 0, 0], rot: [0, 0, 90] }),
      { color: crystal, roughness: 0.12, metalness: 0.0 }, 2.4));
    return { parts: P, reach: 1.6, twoHanded: false, hand, ranged: true };
  },
};

/**
 * Richtungskonvention.
 *
 * Alle Waffen werden entlang +X modelliert – Griff im Ursprung, Spitze
 * bei +X. Im Rig zeigt der linke Arm nach +X, der rechte nach -X (die
 * Knochenversätze sind gespiegelt, die Orientierungen aber identisch).
 * Eine unverändert an die rechte Hand gehängte Waffe würde also hinter der
 * Figur herschwingen.
 *
 * Deshalb bekommen alle Teile an `handR` eine 180-Grad-Drehung um Y. Das ist
 * eine echte Drehung und keine Spiegelung: die Dreiecksorientierung bleibt
 * erhalten, es entstehen keine invertierten Normalen.
 */
const _rotY180 = new Matrix4().makeRotationY(Math.PI);

export function bladeAxisFor(bone) {
  return bone === 'handL' ? 1 : -1;
}

function orientForHands(result) {
  for (const p of result.parts) {
    if (p.bone !== 'handL') p.geometry = p.geometry.clone().applyMatrix4(_rotY180);
  }
  return result;
}

// Alle Bauer durch die Ausrichtung schleusen
for (const [key, fn] of Object.entries(WEAPONS)) {
  WEAPONS[key] = (...args) => orientForHands(fn(...args));
}

/** Kampfwerte je Waffenklasse. */
export const WEAPON_STATS = {
  greatsword: { moveset: 'GREATSWORD', baseDamage: 34, poiseDamage: 42, weight: 16, reach: 2.9, guard: 0.72 },
  longsword: { moveset: 'LONGSWORD', baseDamage: 22, poiseDamage: 22, weight: 8, reach: 2.15, guard: 0.62 },
  dualBlades: { moveset: 'DUAL', baseDamage: 15, poiseDamage: 12, weight: 7, reach: 1.8, guard: 0.42 },
  staff: { moveset: 'STAFF', baseDamage: 20, poiseDamage: 26, weight: 9, reach: 3.1, guard: 0.56 },
  bow: { moveset: 'BOW', baseDamage: 26, poiseDamage: 14, weight: 6, reach: 1.5, guard: 0.2, ranged: true },
  catalyst: { moveset: 'CATALYST', baseDamage: 30, poiseDamage: 16, weight: 5, reach: 1.6, guard: 0.28, ranged: true },
};
