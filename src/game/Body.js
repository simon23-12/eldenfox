import {
  BufferGeometry, CapsuleGeometry, BoxGeometry, SphereGeometry, CylinderGeometry,
  ConeGeometry, TorusGeometry, LatheGeometry, Vector2, Vector3, Matrix4, Euler, Color,
} from 'three/webgpu';

/**
 * Baut den Körper einer Figur aus Grundformen.
 *
 * Jedes Teil wird im *lokalen Raum seines Knochens* erzeugt und bekommt
 * Farbe und Materialparameter mit. RigidSkinnedMesh führt alles zu einer
 * einzigen Geometrie zusammen.
 */

const _m = new Matrix4();
const _e = new Euler();

/** Verschiebt, dreht und skaliert eine Geometrie im lokalen Raum. */
function place(geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = null } = {}) {
  const g = geo.clone();
  if (scale) g.scale(scale[0], scale[1], scale[2]);
  if (rot[0] || rot[1] || rot[2]) {
    _e.set(rot[0] * Math.PI / 180, rot[1] * Math.PI / 180, rot[2] * Math.PI / 180, 'YXZ');
    g.applyMatrix4(_m.makeRotationFromEuler(_e));
  }
  g.translate(pos[0], pos[1], pos[2]);
  if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  return g;
}

/** Konisches Glied: unten dicker als oben, wie ein echter Arm oder Schenkel. */
/**
 * @param {number} ringe Hoehensegmente. Fuer Gliedmassen mit weicher
 *   Gelenkbindung braucht es Zwischenringe - mit nur zwei Ringen hat die
 *   Ueberblendung keine Vertices, an denen sie eine Beugung ausbilden kann.
 */
function limb(rTop, rBot, len, seg = 10, ringe = 1) {
  const g = new CylinderGeometry(rTop, rBot, len, seg, ringe, false);
  g.translate(0, -len / 2, 0);
  return g;
}

function plate(w, h, d, bevel = 0.012) {
  return new BoxGeometry(w - bevel, h - bevel, d - bevel, 1, 1, 1);
}

/** Gedrehte Form aus einem Profil – für Helme, Schulterstücke, Knäufe. */
function lathe(points, seg = 12) {
  return new LatheGeometry(points.map(([x, y]) => new Vector2(x, y)), seg);
}

/**
 * Baut die Teileliste.
 *
 * @param {object} d Charakterdefinition (siehe Roster.js)
 * @returns {Array} Teile für RigidSkinnedMesh
 */
export function buildBody(d) {
  const P = [];
  const push = (bone, geometry, color, roughness = 0.72, metalness = 0.0, emissive = 0.0) =>
    P.push({ bone, geometry, color, roughness, metalness, emissive });

  /**
   * Wie `push`, aber mit weicher Bindung ans Elternteil. `blend` ist der
   * Radius um den Drehpunkt, in dem die Oberflaeche zwischen Knochen und
   * Elternknochen ueberblendet - so knickt ein Glied am Gelenk, statt als
   * starres Segment abzustehen.
   */
  const pushWeich = (bone, geometry, color, roughness, blend, metalness = 0.0) =>
    P.push({ bone, geometry, color, roughness, metalness, emissive: 0.0, blend });

  const s = d.scale ?? 1.0;
  const bulk = d.bulk ?? 1.0;                 // Breite von Brustkorb und Gliedern
  const skin = d.skin ?? 0xc79a76;
  const cloth = d.cloth ?? 0x3a3f4a;
  const cloth2 = d.cloth2 ?? 0x23262e;
  const armor = d.armor ?? 0x6d7480;
  const trim = d.trim ?? 0xb99247;
  const leather = d.leather ?? 0x4a3524;
  const hair = d.hair ?? 0x3a2c22;

  const armorRough = 0.34, armorMetal = 0.92;
  const clothRough = 0.88, leatherRough = 0.62;

  /* ------------------------------ Rumpf ------------------------------ */
  // Becken
  push('hips', place(limb(0.145 * bulk, 0.132 * bulk, 0.17), { pos: [0, 0.085, 0] }), cloth2, clothRough);
  push('hips', place(plate(0.30 * bulk, 0.075, 0.20), { pos: [0, 0.02, 0] }), leather, leatherRough);
  push('hips', place(plate(0.088, 0.05, 0.028), { pos: [0, 0.02, 0.10] }), trim, 0.36, 0.85);

  // Bauch und Brustkorb: nach oben breiter
  push('spine', place(limb(0.152 * bulk, 0.142 * bulk, 0.17), { pos: [0, 0.16, 0] }), cloth, clothRough);
  push('chest', place(limb(0.178 * bulk, 0.150 * bulk, 0.19), { pos: [0, 0.175, 0] }), cloth, clothRough);

  if (d.chestPlate !== false) {
    push('chest', place(new SphereGeometry(0.20 * bulk, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
      { pos: [0, 0.20, 0.008], scale: [1.0, 0.92, 0.80] }), armor, armorRough, armorMetal);
    push('upperChest', place(plate(0.13, 0.026, 0.10), { pos: [0, 0.03, 0.115] }), trim, 0.36, 0.85);
  }

  push('upperChest', place(limb(0.150 * bulk, 0.172 * bulk, 0.13), { pos: [0, 0.115, 0] }), cloth, clothRough);

  /* ------------------------------ Kopf ------------------------------ */
  push('neck', place(limb(0.052, 0.062, 0.10), { pos: [0, 0.095, 0] }), skin, 0.62);
  push('head', place(new SphereGeometry(0.108, 16, 14), { pos: [0, 0.085, 0.006], scale: [0.94, 1.06, 1.0] }), skin, 0.58);
  // Kiefer
  push('head', place(plate(0.11, 0.06, 0.10), { pos: [0, 0.035, 0.018] }), skin, 0.58);

  if (d.helmet === 'full') {
    push('head', place(new SphereGeometry(0.122, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.72),
      { pos: [0, 0.078, 0], scale: [1.0, 1.08, 1.02] }), armor, armorRough, armorMetal);
    push('head', place(plate(0.026, 0.10, 0.028), { pos: [0, 0.085, 0.108] }), armor, armorRough, armorMetal);
    push('head', place(plate(0.15, 0.022, 0.02), { pos: [0, 0.128, 0.086] }), trim, 0.3, 0.9);
  } else if (d.helmet === 'hood') {
    push('head', place(new SphereGeometry(0.135, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.66),
      { pos: [0, 0.072, -0.014], scale: [1.02, 1.10, 1.14] }), cloth2, clothRough);
    push('neck', place(new ConeGeometry(0.19, 0.22, 12, 1, true), { pos: [0, 0.06, -0.03] }), cloth2, clothRough);
  } else if (d.helmet === 'circlet') {
    push('head', place(new TorusGeometry(0.108, 0.011, 6, 18), { pos: [0, 0.108, 0], rot: [90, 0, 0] }), trim, 0.3, 0.9);
  }

  if (d.hairStyle === 'long') {
    push('head', place(new SphereGeometry(0.118, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
      { pos: [0, 0.085, -0.01], scale: [1.02, 1.0, 1.06] }), hair, 0.9);
    push('head', place(plate(0.19, 0.24, 0.10), { pos: [0, -0.02, -0.075] }), hair, 0.9);
  } else if (d.hairStyle === 'short') {
    push('head', place(new SphereGeometry(0.115, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      { pos: [0, 0.088, -0.008], scale: [1.02, 0.92, 1.04] }), hair, 0.9);
  } else if (d.hairStyle === 'curly') {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      push('head', place(new SphereGeometry(0.052, 8, 6), {
        pos: [Math.cos(a) * 0.075, 0.125 + Math.sin(i * 2.3) * 0.02, Math.sin(a) * 0.075 - 0.01],
      }), hair, 0.92);
    }
  }
  if (d.beard) {
    push('head', place(new SphereGeometry(0.072, 10, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55),
      { pos: [0, 0.028, 0.028], scale: [1.05, 1.35, 1.0] }), hair, 0.94);
  }
  if (d.glasses) {
    push('head', place(new TorusGeometry(0.026, 0.005, 5, 12), { pos: [-0.036, 0.086, 0.096] }), 0x1a1a20, 0.4, 0.3);
    push('head', place(new TorusGeometry(0.026, 0.005, 5, 12), { pos: [0.036, 0.086, 0.096] }), 0x1a1a20, 0.4, 0.3);
    push('head', place(plate(0.026, 0.005, 0.005), { pos: [0, 0.086, 0.096] }), 0x1a1a20, 0.4, 0.3);
  }
  // Augen: leicht leuchtend, das gibt den Figuren Präsenz
  push('head', place(new SphereGeometry(0.016, 8, 6), { pos: [-0.038, 0.088, 0.088] }), d.eye ?? 0xdfe6ee, 0.25, 0.0, d.eyeGlow ?? 0.25);
  push('head', place(new SphereGeometry(0.016, 8, 6), { pos: [0.038, 0.088, 0.088] }), d.eye ?? 0xdfe6ee, 0.25, 0.0, d.eyeGlow ?? 0.25);

  /* ------------------------------ Arme ------------------------------ */
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const pauldron = d.pauldrons ?? 'plate';

    if (pauldron === 'plate') {
      push(`shoulder${side}`, place(
        new SphereGeometry(0.105 * bulk, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6),
        { pos: [sx * 0.055, 0.012, 0], rot: [0, 0, sx * -70], scale: [1.0, 0.85, 1.05] },
      ), armor, armorRough, armorMetal);
    } else if (pauldron === 'cloth') {
      push(`shoulder${side}`, place(new ConeGeometry(0.10 * bulk, 0.14, 10, 1, true),
        { pos: [sx * 0.07, -0.01, 0], rot: [0, 0, sx * -95] }), cloth2, clothRough);
    }

    // Gelenkkugeln im Drehpunkt: die Glieder sind starr an je einen Knochen
    // gebunden, zwischen ihnen klafft beim Beugen eine Luecke. Eine Kugel im
    // Drehpunkt bleibt beim Drehen an Ort und Stelle und schliesst sie.
    push(`arm${side}`, place(new SphereGeometry(0.054 * bulk, 10, 8), { pos: [0, 0, 0] }), cloth, clothRough);
    // place() dreht zuerst und verschiebt danach: die Drehung setzt das Glied
    // bereits an den Knochenursprung. Die zusaetzliche Verschiebung um die
    // volle Gliedlaenge schob Arm und Unterarm ein zweites Mal nach aussen -
    // sie standen dadurch frei in der Luft, eine Armlaenge vom Gelenk entfernt.
    pushWeich(`arm${side}`, place(limb(0.052 * bulk, 0.046 * bulk, 0.245, 10, 5), { rot: [0, 0, sx * 90] }), cloth, clothRough, 0.085);
    push(`forearm${side}`, place(new SphereGeometry(0.049 * bulk, 10, 8), { pos: [0, 0, 0] }), leather, leatherRough);
    pushWeich(`forearm${side}`, place(limb(0.048 * bulk, 0.040 * bulk, 0.225, 10, 5), { rot: [0, 0, sx * 90] }), leather, leatherRough, 0.080);
    if (d.bracers !== false) {
      push(`forearm${side}`, place(new CylinderGeometry(0.056, 0.050, 0.13, 10),
        { pos: [sx * 0.16, 0, 0], rot: [0, 0, sx * 90] }), armor, armorRough, armorMetal);
    }
    push(`hand${side}`, place(new SphereGeometry(0.048, 10, 8), { pos: [sx * 0.045, 0, 0], scale: [1.25, 0.85, 1.0] }), d.gloves ?? leather, leatherRough);
  }

  /* ------------------------------ Beine ------------------------------ */
  for (const side of ['L', 'R']) {
    push(`thigh${side}`, place(new SphereGeometry(0.084 * bulk, 10, 8), { pos: [0, 0, 0] }), cloth2, clothRough);
    pushWeich(`thigh${side}`, place(limb(0.082 * bulk, 0.070 * bulk, 0.40, 10, 6), { pos: [0, 0, 0] }), cloth2, clothRough, 0.130);
    push(`shin${side}`, place(new SphereGeometry(0.068 * bulk, 10, 8), { pos: [0, 0, 0] }), cloth2, clothRough);
    pushWeich(`shin${side}`, place(limb(0.066 * bulk, 0.050 * bulk, 0.39, 10, 6), { pos: [0, 0, 0] }), cloth2, clothRough, 0.110);
    if (d.greaves !== false) {
      push(`shin${side}`, place(new CylinderGeometry(0.074, 0.058, 0.24, 10), { pos: [0, -0.10, 0.004] }), armor, armorRough, armorMetal);
    }
    push(`foot${side}`, place(plate(0.10, 0.06, 0.20), { pos: [0, -0.028, 0.045] }), leather, leatherRough);
    push(`toe${side}`, place(plate(0.09, 0.045, 0.07), { pos: [0, 0.005, 0.015] }), leather, leatherRough);
  }

  /* ------------------------------ Rock / Wappenrock ------------------------------ */
  if (d.tabard !== false) {
    push('hips', place(new CylinderGeometry(0.155 * bulk, 0.235 * bulk, 0.42, 12, 1, true),
      { pos: [0, -0.20, 0] }), d.tabardColor ?? cloth2, clothRough);
  }

  /* ------------------------------ Gürtel und Zierrat ------------------------------ */
  push('hips', place(new TorusGeometry(0.152 * bulk, 0.018, 6, 14), { pos: [0, 0.045, 0], rot: [90, 0, 0] }), leather, leatherRough);

  if (d.accent === 'runes') {
    for (let i = 0; i < 5; i++) {
      const a = -0.6 + i * 0.3;
      push('chest', place(plate(0.018, 0.05, 0.012), { pos: [Math.sin(a) * 0.17, 0.19 + Math.cos(a) * 0.02, 0.155] }),
        d.accentColor ?? 0x7ea9ff, 0.3, 0.0, 1.7);
    }
  }

  // Geometrien ohne Index nachrüsten (Kegel/Lathe liefern teils keinen)
  for (const p of P) {
    if (!p.geometry.index) {
      const n = p.geometry.attributes.position.count;
      p.geometry.setIndex([...Array(n).keys()]);
    }
    if (!p.geometry.attributes.normal) p.geometry.computeVertexNormals();
  }

  if (s !== 1) for (const p of P) p.geometry.scale(s, s, s);
  return P;
}
