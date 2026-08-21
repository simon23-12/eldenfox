/**
 * Posen- und Animationsbibliothek.
 *
 * Posen sind Deltas zur Grundhaltung NEUTRAL, angegeben in Grad als
 * `[rx, ry, rz]` je Knochen (Reihenfolge YXZ). Das Verrechnen übernimmt
 * der Animator; Clips bleiben dadurch lesbar und gut mischbar.
 *
 * Clipformat:
 *   { dur, loop, keys: [{ t, pose }], events: [{ t, type, ... }],
 *     root: [{ t, p:[x,y,z], yaw }] }
 */

/* -------------------------------------------------------------------------- */
/* Grundhaltung                                                                */
/* -------------------------------------------------------------------------- */

/** Arme hängen herunter, Beine leicht auseinander, minimale Vorlage. */
export const NEUTRAL = {
  hips: [0, 0, 0],
  spine: [2, 0, 0],
  chest: [2, 0, 0],
  upperChest: [1, 0, 0],
  neck: [-2, 0, 0],
  head: [-1, 0, 0],

  shoulderL: [0, 0, -8],
  shoulderR: [0, 0, 8],
  armL: [0, 0, -72],
  armR: [0, 0, 72],
  forearmL: [0, -14, -18],
  forearmR: [0, 14, 18],
  handL: [0, 0, -6],
  handR: [0, 0, 6],

  thighL: [-2, 0, 3],
  thighR: [-2, 0, -3],
  shinL: [4, 0, 0],
  shinR: [4, 0, 0],
  footL: [-2, 0, 0],
  footR: [-2, 0, 0],
};

/** Spiegelt eine Pose an der Körpermittelachse (L <-> R). */
export function mirror(pose) {
  const out = {};
  for (const [k, v] of Object.entries(pose)) {
    const r = Array.isArray(v) ? v : v.r;
    const nk = k.endsWith('L') ? `${k.slice(0, -1)}R` : k.endsWith('R') ? `${k.slice(0, -1)}L` : k;
    const nr = [r[0], -r[1], -r[2]];
    if (Array.isArray(v)) out[nk] = nr;
    else out[nk] = { r: nr, p: v.p ? [-v.p[0], v.p[1], v.p[2]] : undefined };
  }
  return out;
}

const K = (t, pose) => ({ t, pose });

/* -------------------------------------------------------------------------- */
/* Grundbewegung                                                               */
/* -------------------------------------------------------------------------- */

/** Atmung und leichtes Gewichtsverlagern, damit nie ein Standbild entsteht. */
export const IDLE = {
  dur: 4.4, loop: true,
  keys: [
    K(0.0, { chest: [1.2, 0, 0], upperChest: [0.8, 0, 0], head: [1, 3, 0], hips: [0, 0, 0.6], armL: [0, 0, -1.5], armR: [0, 0, 1.5] }),
    K(1.1, { chest: [-1.0, 0, 0], upperChest: [-0.6, 0, 0], head: [-1, 1, 1], hips: [0, 0, -0.4], armL: [1, 0, 1], armR: [1, 0, -1] }),
    K(2.2, { chest: [1.4, 0, 0], upperChest: [0.9, 0, 0], head: [0, -3, 0], hips: [0, 0, -0.8], armL: [0, 0, -1], armR: [0, 0, 1] }),
    K(3.3, { chest: [-0.8, 0, 0], upperChest: [-0.5, 0, 0], head: [-1, -1, -1], hips: [0, 0, 0.3], armL: [1.5, 0, 1.5], armR: [1.5, 0, -1.5] }),
    K(4.4, { chest: [1.2, 0, 0], upperChest: [0.8, 0, 0], head: [1, 3, 0], hips: [0, 0, 0.6], armL: [0, 0, -1.5], armR: [0, 0, 1.5] }),
  ],
};

/** Ein voller Schritt; der Animator spiegelt für den zweiten. */
function gaitKeys(scale, lean, armSwing) {
  const s = scale;
  return [
    K(0.00, {
      hips: [lean, 0, 0], spine: [lean * 0.4, 6 * s, 0], chest: [0, -4 * s, 0],
      thighL: [-34 * s, 0, 2], shinL: [22 * s, 0, 0], footL: [10 * s, 0, 0],
      thighR: [26 * s, 0, -2], shinR: [16 * s, 0, 0], footR: [-16 * s, 0, 0],
      armL: [-armSwing, 0, 0], armR: [armSwing, 0, 0],
      forearmL: [-12 * s, 0, 0], forearmR: [-20 * s, 0, 0],
    }),
    K(0.25, {
      hips: [lean, 0, 0], spine: [lean * 0.4, 0, 0], chest: [0, 0, 0],
      thighL: [-6 * s, 0, 2], shinL: [8 * s, 0, 0], footL: [-4 * s, 0, 0],
      thighR: [6 * s, 0, -2], shinR: [34 * s, 0, 0], footR: [-10 * s, 0, 0],
      armL: [0, 0, 0], armR: [0, 0, 0],
      forearmL: [-16 * s, 0, 0], forearmR: [-16 * s, 0, 0],
    }),
    K(0.50, {
      hips: [lean, 0, 0], spine: [lean * 0.4, -6 * s, 0], chest: [0, 4 * s, 0],
      thighL: [26 * s, 0, 2], shinL: [16 * s, 0, 0], footL: [-16 * s, 0, 0],
      thighR: [-34 * s, 0, -2], shinR: [22 * s, 0, 0], footR: [10 * s, 0, 0],
      armL: [armSwing, 0, 0], armR: [-armSwing, 0, 0],
      forearmL: [-20 * s, 0, 0], forearmR: [-12 * s, 0, 0],
    }),
    K(0.75, {
      hips: [lean, 0, 0], spine: [lean * 0.4, 0, 0], chest: [0, 0, 0],
      thighL: [6 * s, 0, 2], shinL: [34 * s, 0, 0], footL: [-10 * s, 0, 0],
      thighR: [-6 * s, 0, -2], shinR: [8 * s, 0, 0], footR: [-4 * s, 0, 0],
      armL: [0, 0, 0], armR: [0, 0, 0],
      forearmL: [-16 * s, 0, 0], forearmR: [-16 * s, 0, 0],
    }),
    K(1.00, {
      hips: [lean, 0, 0], spine: [lean * 0.4, 6 * s, 0], chest: [0, -4 * s, 0],
      thighL: [-34 * s, 0, 2], shinL: [22 * s, 0, 0], footL: [10 * s, 0, 0],
      thighR: [26 * s, 0, -2], shinR: [16 * s, 0, 0], footR: [-16 * s, 0, 0],
      armL: [-armSwing, 0, 0], armR: [armSwing, 0, 0],
      forearmL: [-12 * s, 0, 0], forearmR: [-20 * s, 0, 0],
    }),
  ];
}

export const WALK = { dur: 1.05, loop: true, keys: gaitKeys(0.62, 3, 16) };
export const RUN = { dur: 0.68, loop: true, keys: gaitKeys(1.0, 9, 34) };
export const SPRINT = { dur: 0.52, loop: true, keys: gaitKeys(1.22, 16, 46) };

/** Seitwärts, für den Umkreisen-Modus bei aktivem Ziel. */
export const STRAFE_L = {
  dur: 0.9, loop: true,
  keys: [
    K(0.0, { hips: [0, 0, 4], thighL: [-6, 0, 16], thighR: [-6, 0, 4], shinL: [10, 0, 0], shinR: [16, 0, 0] }),
    K(0.5, { hips: [0, 0, -2], thighL: [-6, 0, 3], thighR: [-6, 0, 16], shinL: [18, 0, 0], shinR: [8, 0, 0] }),
    K(1.0, { hips: [0, 0, 4], thighL: [-6, 0, 16], thighR: [-6, 0, 4], shinL: [10, 0, 0], shinR: [16, 0, 0] }),
  ],
};
export const STRAFE_R = { dur: 0.9, loop: true, keys: STRAFE_L.keys.map((k) => K(k.t, mirror(k.pose))) };

/* -------------------------------------------------------------------------- */
/* Ausweichen                                                                  */
/* -------------------------------------------------------------------------- */

export const ROLL = {
  dur: 0.72, loop: false,
  iframes: [0.10, 0.44],
  keys: [
    K(0.00, { hips: [10, 0, 0], spine: [8, 0, 0], chest: [8, 0, 0], armL: [-20, 0, 20], armR: [-20, 0, -20], thighL: [-20, 0, 0], thighR: [-20, 0, 0] }),
    K(0.15, { hips: [70, 0, 0], spine: [26, 0, 0], chest: [24, 0, 0], head: [22, 0, 0], armL: [-60, 0, 55], armR: [-60, 0, -55], thighL: [-95, 0, 0], thighR: [-95, 0, 0], shinL: [110, 0, 0], shinR: [110, 0, 0] }),
    K(0.36, { hips: [200, 0, 0], spine: [30, 0, 0], chest: [26, 0, 0], head: [26, 0, 0], armL: [-70, 0, 60], armR: [-70, 0, -60], thighL: [-115, 0, 0], thighR: [-115, 0, 0], shinL: [125, 0, 0], shinR: [125, 0, 0] }),
    K(0.55, { hips: [330, 0, 0], spine: [16, 0, 0], chest: [12, 0, 0], head: [8, 0, 0], armL: [-30, 0, 26], armR: [-30, 0, -26], thighL: [-58, 0, 0], thighR: [-40, 0, 0], shinL: [70, 0, 0], shinR: [50, 0, 0] }),
    K(0.72, { hips: [360, 0, 0], spine: [4, 0, 0], chest: [2, 0, 0], head: [0, 0, 0], armL: [0, 0, 0], armR: [0, 0, 0], thighL: [-12, 0, 0], thighR: [-6, 0, 0], shinL: [14, 0, 0], shinR: [8, 0, 0] }),
  ],
  root: [
    { t: 0.00, p: [0, 0, 0] },
    { t: 0.20, p: [0, 0.16, -1.5] },
    { t: 0.45, p: [0, 0.10, -3.3] },
    { t: 0.72, p: [0, 0, -4.1] },
  ],
};

export const BACKSTEP = {
  dur: 0.46, loop: false,
  iframes: [0.05, 0.22],
  keys: [
    K(0.00, { hips: [4, 0, 0], chest: [4, 0, 0] }),
    K(0.12, { hips: [-16, 0, 0], spine: [-8, 0, 0], chest: [-10, 0, 0], armL: [-34, 0, 16], armR: [-34, 0, -16], thighL: [26, 0, 0], thighR: [22, 0, 0], shinL: [-30, 0, 0], shinR: [-26, 0, 0] }),
    K(0.30, { hips: [10, 0, 0], spine: [6, 0, 0], chest: [8, 0, 0], armL: [-10, 0, 6], armR: [-10, 0, -6], thighL: [-16, 0, 0], thighR: [-12, 0, 0], shinL: [20, 0, 0], shinR: [16, 0, 0] }),
    K(0.46, { hips: [0, 0, 0], chest: [0, 0, 0], armL: [0, 0, 0], armR: [0, 0, 0], thighL: [0, 0, 0], thighR: [0, 0, 0] }),
  ],
  root: [
    { t: 0.00, p: [0, 0, 0] },
    { t: 0.16, p: [0, 0.10, 1.9] },
    { t: 0.46, p: [0, 0, 2.6] },
  ],
};

/* -------------------------------------------------------------------------- */
/* Reaktionen                                                                  */
/* -------------------------------------------------------------------------- */

export const HIT_LIGHT = {
  dur: 0.34, loop: false,
  keys: [
    K(0.00, {}),
    K(0.08, { hips: [-8, 0, 0], spine: [-12, 4, 0], chest: [-14, 6, 0], head: [-16, 8, 0], armL: [-16, 0, 12], armR: [-14, 0, -10] }),
    K(0.20, { hips: [4, 0, 0], spine: [6, -2, 0], chest: [6, -3, 0], head: [6, -3, 0] }),
    K(0.34, {}),
  ],
};

export const HIT_HEAVY = {
  dur: 0.72, loop: false,
  keys: [
    K(0.00, {}),
    K(0.10, { hips: [-22, 0, 0], spine: [-26, 8, 0], chest: [-30, 12, 0], head: [-34, 14, 0], armL: [-40, 0, 30], armR: [-36, 0, -26], thighL: [16, 0, 0], thighR: [8, 0, 0], shinL: [-20, 0, 0] }),
    K(0.34, { hips: [-10, 0, 0], spine: [-12, 4, 0], chest: [-14, 6, 0], head: [-12, 6, 0], thighL: [8, 0, 0], shinL: [-10, 0, 0] }),
    K(0.72, {}),
  ],
  root: [{ t: 0, p: [0, 0, 0] }, { t: 0.18, p: [0, 0, 1.0] }, { t: 0.72, p: [0, 0, 1.3] }],
};

export const DEATH = {
  dur: 1.6, loop: false, hold: true,
  keys: [
    K(0.00, {}),
    K(0.18, { hips: [-14, 0, 0], spine: [-18, 6, 0], chest: [-22, 8, 0], head: [-26, 10, 0], armL: [-30, 0, 24], armR: [-28, 0, -20], thighL: [10, 0, 0], shinL: [-14, 0, 0] }),
    K(0.55, { hips: [30, 0, -14], spine: [16, 8, -8], chest: [12, 10, -10], head: [20, 12, -12], armL: [-70, 0, 50], armR: [-60, 0, -40], thighL: [-60, 0, 8], thighR: [-30, 0, -6], shinL: [80, 0, 0], shinR: [50, 0, 0] }),
    K(1.10, { hips: [86, 0, -22], spine: [8, 10, -10], chest: [4, 12, -12], head: [10, 14, -14], armL: [-90, 0, 62], armR: [-80, 0, -52], thighL: [-88, 0, 12], thighR: [-52, 0, -10], shinL: [100, 0, 0], shinR: [70, 0, 0] }),
    K(1.60, { hips: [90, 0, -24], spine: [6, 10, -10], chest: [2, 12, -12], head: [8, 14, -14], armL: [-92, 0, 64], armR: [-82, 0, -54], thighL: [-90, 0, 12], thighR: [-54, 0, -10], shinL: [102, 0, 0], shinR: [72, 0, 0] }),
  ],
  root: [
    { t: 0.00, p: [0, 0, 0] },
    { t: 0.55, p: [0, -0.30, 0.5] },
    { t: 1.10, p: [0, -0.72, 0.9] },
    { t: 1.60, p: [0, -0.76, 1.0] },
  ],
};

export const BLOCK_IDLE = {
  dur: 3.0, loop: true,
  keys: [
    K(0.0, { hips: [0, 14, 0], spine: [4, 10, 0], chest: [4, 12, 0], head: [0, -16, 0], armL: [-62, 10, 34], forearmL: [-70, 0, 0], armR: [-24, 0, -6], forearmR: [-40, 0, 0], thighL: [-6, 12, 0], thighR: [-10, -6, 0], shinL: [12, 0, 0], shinR: [16, 0, 0] }),
    K(1.5, { hips: [0, 14, 0], spine: [2, 10, 0], chest: [2, 12, 0], head: [0, -16, 0], armL: [-60, 10, 33], forearmL: [-69, 0, 0], armR: [-23, 0, -6], forearmR: [-39, 0, 0], thighL: [-6, 12, 0], thighR: [-10, -6, 0], shinL: [12, 0, 0], shinR: [16, 0, 0] }),
    K(3.0, { hips: [0, 14, 0], spine: [4, 10, 0], chest: [4, 12, 0], head: [0, -16, 0], armL: [-62, 10, 34], forearmL: [-70, 0, 0], armR: [-24, 0, -6], forearmR: [-40, 0, 0], thighL: [-6, 12, 0], thighR: [-10, -6, 0], shinL: [12, 0, 0], shinR: [16, 0, 0] }),
  ],
};

export const PARRY = {
  dur: 0.55, loop: false,
  parryWindow: [0.06, 0.24],
  keys: [
    K(0.00, {}),
    K(0.10, { hips: [0, -22, 0], chest: [0, -16, 0], armL: [-70, -40, 40], forearmL: [-50, 0, 0], head: [0, 18, 0] }),
    K(0.26, { hips: [0, 26, 0], chest: [0, 22, 0], armL: [-40, 60, 20], forearmL: [-30, 0, 0], head: [0, -20, 0] }),
    K(0.55, {}),
  ],
};

export const FALL = {
  dur: 0.6, loop: true,
  keys: [
    K(0.0, { hips: [-6, 0, 0], spine: [-4, 0, 0], armL: [-70, 0, 40], armR: [-70, 0, -40], thighL: [-30, 0, 0], thighR: [-14, 0, 0], shinL: [40, 0, 0], shinR: [20, 0, 0] }),
    K(0.3, { hips: [-4, 0, 0], spine: [-6, 0, 0], armL: [-80, 0, 46], armR: [-80, 0, -46], thighL: [-20, 0, 0], thighR: [-26, 0, 0], shinL: [26, 0, 0], shinR: [34, 0, 0] }),
    K(0.6, { hips: [-6, 0, 0], spine: [-4, 0, 0], armL: [-70, 0, 40], armR: [-70, 0, -40], thighL: [-30, 0, 0], thighR: [-14, 0, 0], shinL: [40, 0, 0], shinR: [20, 0, 0] }),
  ],
};

export const DRINK = {
  dur: 1.5, loop: false,
  keys: [
    K(0.00, {}),
    K(0.30, { armL: [-100, 20, 30], forearmL: [-110, 0, 0], head: [-10, 10, 0], chest: [-4, 8, 0] }),
    K(0.75, { armL: [-118, 26, 24], forearmL: [-128, 0, 0], head: [-22, 8, 0], chest: [-8, 6, 0], hips: [-2, 0, 0] }),
    K(1.10, { armL: [-100, 20, 30], forearmL: [-110, 0, 0], head: [-8, 8, 0], chest: [-2, 6, 0] }),
    K(1.50, {}),
  ],
  events: [{ t: 0.8, type: 'heal' }],
};
