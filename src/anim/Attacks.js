/**
 * Angriffsanimationen je Waffenklasse.
 *
 * Ereignisse steuern die Kampflogik:
 *   swing      – Trefferfenster auf, mit Bogenparametern
 *   swingEnd   – Trefferfenster zu
 *   step       – Wurzelversatz nach vorn (Vorwärtsdrang des Schlags)
 *   cast       – Zauber/Pfeil erzeugen
 *   sfx        – Klang
 *
 * `poise` gibt an, ab wann der Angriff nicht mehr unterbrochen werden kann,
 * `cancel` ab wann per Rolle abgebrochen werden darf.
 */

const K = (t, pose) => ({ t, pose });

/* ========================================================================== */
/* Großschwert – Viktor. Langsam, weit, brutal.                                */
/* ========================================================================== */

export const GREATSWORD = {
  light: [
    {
      name: 'gs_light1', dur: 1.05, stamina: 26, damage: 1.0, poise: 0.18, cancel: 0.78,
      keys: [
        K(0.00, { hips: [0, 26, 0], chest: [-4, 22, 0], armR: [-30, -30, -40], armL: [-40, -20, 30], forearmR: [-50, 0, 0], forearmL: [-60, 0, 0], head: [0, -18, 0] }),
        K(0.26, { hips: [0, 54, 0], spine: [-10, 26, 0], chest: [-16, 30, 0], armR: [-120, -50, -60], armL: [-110, -40, 50], forearmR: [-30, 0, 0], forearmL: [-40, 0, 0], head: [-8, -34, 0], thighR: [-10, 20, 0] }),
        K(0.44, { hips: [0, -34, 0], spine: [14, -22, 0], chest: [18, -26, 0], armR: [-6, 40, -18], armL: [-10, 30, 14], forearmR: [-14, 0, 0], forearmL: [-18, 0, 0], head: [12, 26, 0], thighL: [-16, -18, 0], shinL: [20, 0, 0] }),
        K(0.62, { hips: [0, -48, 0], spine: [22, -30, 0], chest: [26, -34, 0], armR: [16, 46, -10], armL: [10, 36, 8], head: [16, 30, 0], thighL: [-22, -22, 0] }),
        K(1.05, { hips: [0, -6, 0], spine: [4, -4, 0], chest: [4, -4, 0], armR: [-10, 6, -14], armL: [-14, 4, 10], head: [2, 4, 0] }),
      ],
      events: [
        { t: 0.10, type: 'sfx', sound: 'windup' },
        { t: 0.28, type: 'step', dist: 1.1 },
        { t: 0.30, type: 'swing', arc: 200, radius: 2.9, height: 1.15, from: 'handR' },
        { t: 0.52, type: 'swingEnd' },
      ],
    },
    {
      name: 'gs_light2', dur: 1.15, stamina: 28, damage: 1.1, poise: 0.16, cancel: 0.84,
      keys: [
        K(0.00, { hips: [0, -40, 0], chest: [12, -30, 0], armR: [10, 40, -14], armL: [6, 30, 10] }),
        K(0.30, { hips: [0, -66, 0], spine: [-12, -34, 0], chest: [-18, -40, 0], armR: [-130, 40, -50], armL: [-120, 30, 44], forearmR: [-40, 0, 0], head: [-10, 34, 0] }),
        K(0.50, { hips: [0, 46, 0], spine: [16, 30, 0], chest: [20, 34, 0], armR: [-4, -50, -20], armL: [-8, -40, 16], head: [14, -30, 0], thighR: [-18, 22, 0] }),
        K(0.70, { hips: [0, 56, 0], spine: [20, 34, 0], chest: [24, 38, 0], armR: [14, -56, -12], armL: [8, -44, 10] }),
        K(1.15, { hips: [0, 8, 0], chest: [4, 4, 0], armR: [-10, -6, -14], armL: [-14, -4, 10] }),
      ],
      events: [
        { t: 0.34, type: 'step', dist: 1.3 },
        { t: 0.36, type: 'swing', arc: 210, radius: 3.0, height: 1.2, from: 'handR' },
        { t: 0.58, type: 'swingEnd' },
      ],
    },
  ],
  heavy: [
    {
      name: 'gs_heavy1', dur: 1.55, stamina: 42, damage: 1.95, poise: 0.10, cancel: 1.22, stagger: 2.0,
      keys: [
        K(0.00, { hips: [0, 10, 0], chest: [-6, 8, 0], armR: [-40, -10, -30], armL: [-46, -8, 24] }),
        K(0.40, { hips: [-8, 14, 0], spine: [-24, 10, 0], chest: [-30, 12, 0], armR: [-170, -6, -26], armL: [-172, -4, 22], forearmR: [-16, 0, 0], forearmL: [-18, 0, 0], head: [-24, 0, 0], thighR: [-20, 0, 0], shinR: [26, 0, 0] }),
        K(0.62, { hips: [10, 12, 0], spine: [-30, 8, 0], chest: [-36, 10, 0], armR: [-186, -4, -24], armL: [-188, -2, 20], head: [-30, 0, 0] }),
        K(0.80, { hips: [26, 0, 0], spine: [34, 0, 0], chest: [38, 0, 0], armR: [-4, 0, -18], armL: [-6, 0, 16], head: [26, 0, 0], thighL: [-30, 0, 0], shinL: [40, 0, 0], thighR: [16, 0, 0] }),
        K(1.05, { hips: [22, 0, 0], spine: [30, 0, 0], chest: [32, 0, 0], armR: [-2, 0, -18], armL: [-4, 0, 16], head: [22, 0, 0], thighL: [-26, 0, 0], shinL: [36, 0, 0] }),
        K(1.55, { hips: [2, 0, 0], chest: [4, 0, 0], armR: [-16, 0, -16], armL: [-20, 0, 14] }),
      ],
      events: [
        { t: 0.20, type: 'sfx', sound: 'windupHeavy' },
        { t: 0.66, type: 'step', dist: 1.7 },
        { t: 0.68, type: 'swing', arc: 140, radius: 3.2, height: 1.5, from: 'handR', vertical: true },
        { t: 0.86, type: 'shockwave', radius: 3.4 },
        { t: 0.90, type: 'swingEnd' },
      ],
    },
  ],
  running: {
    name: 'gs_run', dur: 1.0, stamina: 30, damage: 1.3, poise: 0.12, cancel: 0.76,
    keys: [
      K(0.00, { hips: [6, 30, 0], chest: [-8, 24, 0], armR: [-60, -30, -40], armL: [-66, -24, 34] }),
      K(0.26, { hips: [4, -50, 0], spine: [12, -30, 0], chest: [16, -36, 0], armR: [-10, 46, -22], armL: [-16, 36, 18], head: [10, 30, 0] }),
      K(0.46, { hips: [0, -60, 0], chest: [20, -42, 0], armR: [12, 52, -14], armL: [4, 42, 12] }),
      K(1.00, { hips: [0, -8, 0], chest: [2, -4, 0], armR: [-14, 6, -16], armL: [-18, 4, 12] }),
    ],
    events: [
      { t: 0.06, type: 'step', dist: 2.6 },
      { t: 0.14, type: 'swing', arc: 230, radius: 3.0, height: 1.1, from: 'handR' },
      { t: 0.36, type: 'swingEnd' },
    ],
  },
};

/* ========================================================================== */
/* Langschwert – Sascha. Ausgewogen, schnelle Kette.                           */
/* ========================================================================== */

export const LONGSWORD = {
  light: [
    {
      name: 'ls_light1', dur: 0.66, stamina: 15, damage: 0.72, poise: 0.30, cancel: 0.44,
      keys: [
        K(0.00, { hips: [0, 16, 0], chest: [-2, 14, 0], armR: [-56, -26, -34], forearmR: [-70, 0, 0], armL: [-30, 0, 20] }),
        K(0.16, { hips: [0, 40, 0], spine: [-6, 22, 0], chest: [-10, 26, 0], armR: [-140, -34, -30], forearmR: [-84, 0, 0], head: [-6, -26, 0] }),
        K(0.30, { hips: [0, -30, 0], spine: [10, -20, 0], chest: [14, -24, 0], armR: [-24, 34, -30], forearmR: [-30, 0, 0], head: [8, 22, 0] }),
        K(0.42, { hips: [0, -40, 0], chest: [16, -30, 0], armR: [-8, 42, -24], forearmR: [-20, 0, 0] }),
        K(0.66, { hips: [0, -4, 0], chest: [2, -2, 0], armR: [-40, 6, -30], forearmR: [-50, 0, 0] }),
      ],
      events: [
        { t: 0.17, type: 'step', dist: 0.75 },
        { t: 0.18, type: 'swing', arc: 170, radius: 2.15, height: 1.15, from: 'handR' },
        { t: 0.34, type: 'swingEnd' },
      ],
    },
    {
      name: 'ls_light2', dur: 0.70, stamina: 15, damage: 0.78, poise: 0.30, cancel: 0.46,
      keys: [
        K(0.00, { hips: [0, -34, 0], chest: [12, -26, 0], armR: [-16, 38, -28], forearmR: [-26, 0, 0] }),
        K(0.16, { hips: [0, -52, 0], spine: [-8, -28, 0], chest: [-12, -32, 0], armR: [-130, 40, -36], forearmR: [-70, 0, 0], head: [-4, 26, 0] }),
        K(0.32, { hips: [0, 36, 0], spine: [12, 24, 0], chest: [16, 28, 0], armR: [-20, -40, -26], forearmR: [-26, 0, 0], head: [8, -24, 0] }),
        K(0.46, { hips: [0, 44, 0], chest: [18, 30, 0], armR: [-6, -46, -22] }),
        K(0.70, { hips: [0, 6, 0], chest: [2, 4, 0], armR: [-42, -6, -30], forearmR: [-52, 0, 0] }),
      ],
      events: [
        { t: 0.17, type: 'step', dist: 0.8 },
        { t: 0.19, type: 'swing', arc: 180, radius: 2.15, height: 1.1, from: 'handR' },
        { t: 0.36, type: 'swingEnd' },
      ],
    },
    {
      name: 'ls_light3', dur: 0.92, stamina: 19, damage: 0.95, poise: 0.24, cancel: 0.64,
      keys: [
        K(0.00, { hips: [0, 30, 0], chest: [10, 22, 0], armR: [-20, -34, -26] }),
        K(0.22, { hips: [-4, 10, 0], spine: [-18, 6, 0], chest: [-22, 8, 0], armR: [-168, -10, -22], forearmR: [-24, 0, 0], head: [-20, 0, 0] }),
        K(0.40, { hips: [16, 0, 0], spine: [26, 0, 0], chest: [30, 0, 0], armR: [-6, 0, -18], head: [20, 0, 0], thighL: [-24, 0, 0], shinL: [32, 0, 0] }),
        K(0.58, { hips: [12, 0, 0], chest: [24, 0, 0], armR: [-2, 0, -18] }),
        K(0.92, { hips: [0, 0, 0], chest: [2, 0, 0], armR: [-40, 0, -28] }),
      ],
      events: [
        { t: 0.26, type: 'step', dist: 1.15 },
        { t: 0.28, type: 'swing', arc: 150, radius: 2.3, height: 1.4, from: 'handR', vertical: true },
        { t: 0.46, type: 'swingEnd' },
      ],
    },
  ],
  heavy: [
    {
      name: 'ls_heavy1', dur: 1.15, stamina: 30, damage: 1.5, poise: 0.16, cancel: 0.9, stagger: 1.4,
      keys: [
        K(0.00, { hips: [0, 8, 0], chest: [-4, 6, 0], armR: [-46, -14, -30] }),
        K(0.34, { hips: [0, 74, 0], spine: [-8, 40, 0], chest: [-12, 46, 0], armR: [-120, -60, -50], forearmR: [-60, 0, 0], head: [-4, -40, 0], thighR: [-14, 26, 0] }),
        K(0.54, { hips: [0, -70, 0], spine: [14, -42, 0], chest: [18, -48, 0], armR: [-10, 62, -26], forearmR: [-14, 0, 0], head: [10, 40, 0], thighL: [-20, -26, 0] }),
        K(0.74, { hips: [0, -80, 0], chest: [20, -52, 0], armR: [8, 68, -20] }),
        K(1.15, { hips: [0, -8, 0], chest: [2, -4, 0], armR: [-40, 6, -30] }),
      ],
      events: [
        { t: 0.38, type: 'step', dist: 1.4 },
        { t: 0.40, type: 'swing', arc: 300, radius: 2.4, height: 1.1, from: 'handR' },
        { t: 0.66, type: 'swingEnd' },
      ],
    },
  ],
  running: {
    name: 'ls_run', dur: 0.78, stamina: 18, damage: 0.9, poise: 0.2, cancel: 0.56,
    keys: [
      K(0.00, { hips: [6, 20, 0], chest: [-4, 16, 0], armR: [-60, -22, -34] }),
      K(0.20, { hips: [4, -40, 0], spine: [10, -24, 0], chest: [14, -28, 0], armR: [-16, 42, -26], head: [8, 26, 0] }),
      K(0.78, { hips: [0, -6, 0], chest: [2, -2, 0], armR: [-42, 6, -30] }),
    ],
    events: [
      { t: 0.04, type: 'step', dist: 2.2 },
      { t: 0.10, type: 'swing', arc: 200, radius: 2.3, height: 1.05, from: 'handR' },
      { t: 0.28, type: 'swingEnd' },
    ],
  },
};

/* ========================================================================== */
/* Zwei Klingen – Max. Schnell, viele Treffer, wenig Reichweite.               */
/* ========================================================================== */

export const DUAL = {
  light: [
    {
      name: 'du_light1', dur: 0.52, stamina: 13, damage: 0.46, poise: 0.34, cancel: 0.34,
      keys: [
        K(0.00, { hips: [0, 14, 0], armR: [-50, -26, -36], armL: [-46, 22, 34], forearmR: [-64, 0, 0], forearmL: [-60, 0, 0] }),
        K(0.14, { hips: [0, 34, 0], chest: [-6, 22, 0], armR: [-124, -40, -34], forearmR: [-76, 0, 0], armL: [-30, 26, 30] }),
        K(0.26, { hips: [0, -26, 0], chest: [10, -18, 0], armR: [-20, 36, -30], forearmR: [-26, 0, 0], armL: [-40, 18, 32] }),
        K(0.52, { hips: [0, -2, 0], armR: [-46, 4, -32], armL: [-44, 6, 32] }),
      ],
      events: [
        { t: 0.13, type: 'step', dist: 0.65 },
        { t: 0.14, type: 'swing', arc: 160, radius: 1.75, height: 1.15, from: 'handR' },
        { t: 0.26, type: 'swingEnd' },
      ],
    },
    {
      name: 'du_light2', dur: 0.52, stamina: 13, damage: 0.46, poise: 0.34, cancel: 0.34,
      keys: [
        K(0.00, { hips: [0, -22, 0], armL: [-50, 26, 36], armR: [-46, -22, -34], forearmL: [-64, 0, 0] }),
        K(0.14, { hips: [0, -34, 0], chest: [-6, -22, 0], armL: [-124, 40, 34], forearmL: [-76, 0, 0], armR: [-30, -26, -30] }),
        K(0.26, { hips: [0, 26, 0], chest: [10, 18, 0], armL: [-20, -36, 30], forearmL: [-26, 0, 0], armR: [-40, -18, -32] }),
        K(0.52, { hips: [0, 2, 0], armL: [-46, -4, 32], armR: [-44, -6, -32] }),
      ],
      events: [
        { t: 0.13, type: 'step', dist: 0.65 },
        { t: 0.14, type: 'swing', arc: 160, radius: 1.75, height: 1.15, from: 'handL' },
        { t: 0.26, type: 'swingEnd' },
      ],
    },
    {
      name: 'du_light3', dur: 0.86, stamina: 22, damage: 0.44, hits: 3, poise: 0.28, cancel: 0.62,
      keys: [
        K(0.00, { hips: [0, 10, 0], armR: [-46, -20, -34], armL: [-46, 20, 34] }),
        K(0.18, { hips: [0, 130, 0], chest: [6, 40, 0], armR: [-16, -50, -50], armL: [-16, 50, 50] }),
        K(0.40, { hips: [0, 290, 0], chest: [8, 20, 0], armR: [-12, -60, -56], armL: [-12, 60, 56] }),
        K(0.60, { hips: [0, 380, 0], chest: [4, 0, 0], armR: [-30, -30, -40], armL: [-30, 30, 40] }),
        K(0.86, { hips: [0, 360, 0], armR: [-46, 0, -32], armL: [-46, 0, 32] }),
      ],
      events: [
        { t: 0.14, type: 'step', dist: 1.1 },
        { t: 0.16, type: 'swing', arc: 360, radius: 1.95, height: 1.1, from: 'handR', spin: true },
        { t: 0.30, type: 'swingEnd' },
        { t: 0.32, type: 'swing', arc: 360, radius: 1.95, height: 1.1, from: 'handL', spin: true },
        { t: 0.46, type: 'swingEnd' },
        { t: 0.48, type: 'swing', arc: 360, radius: 2.0, height: 1.1, from: 'handR', spin: true },
        { t: 0.62, type: 'swingEnd' },
      ],
    },
  ],
  heavy: [
    {
      name: 'du_heavy1', dur: 1.05, stamina: 32, damage: 0.62, hits: 4, poise: 0.2, cancel: 0.82,
      keys: [
        K(0.00, { hips: [0, 0, 0], armR: [-40, -18, -32], armL: [-40, 18, 32] }),
        K(0.18, { hips: [-4, 0, 0], spine: [-12, 0, 0], armR: [-150, -20, -30], armL: [-150, 20, 30] }),
        K(0.34, { hips: [8, 0, 0], spine: [16, 0, 0], armR: [-14, -30, -40], armL: [-14, 30, 40], thighL: [-26, 0, 0] }),
        K(0.52, { hips: [4, 0, 0], armR: [-130, -14, -28], armL: [-130, 14, 28] }),
        K(0.68, { hips: [10, 0, 0], spine: [18, 0, 0], armR: [-10, -34, -44], armL: [-10, 34, 44] }),
        K(1.05, { hips: [0, 0, 0], armR: [-44, 0, -32], armL: [-44, 0, 32] }),
      ],
      events: [
        { t: 0.20, type: 'step', dist: 1.0 },
        { t: 0.22, type: 'swing', arc: 130, radius: 1.9, height: 1.3, from: 'handR', vertical: true },
        { t: 0.34, type: 'swingEnd' },
        { t: 0.36, type: 'swing', arc: 130, radius: 1.9, height: 1.3, from: 'handL', vertical: true },
        { t: 0.46, type: 'swingEnd' },
        { t: 0.56, type: 'swing', arc: 130, radius: 1.9, height: 1.3, from: 'handR', vertical: true },
        { t: 0.66, type: 'swingEnd' },
        { t: 0.68, type: 'swing', arc: 130, radius: 1.9, height: 1.3, from: 'handL', vertical: true },
        { t: 0.80, type: 'swingEnd' },
      ],
    },
  ],
  running: {
    name: 'du_run', dur: 0.68, stamina: 18, damage: 0.5, hits: 2, poise: 0.24, cancel: 0.5,
    keys: [
      K(0.00, { hips: [8, 0, 0], armR: [-60, -20, -34], armL: [-60, 20, 34] }),
      K(0.18, { hips: [4, 40, 0], chest: [8, 24, 0], armR: [-14, -46, -40], armL: [-40, 20, 34] }),
      K(0.34, { hips: [4, -40, 0], chest: [8, -24, 0], armL: [-14, 46, 40], armR: [-40, -20, -34] }),
      K(0.68, { hips: [0, 0, 0], armR: [-46, 0, -32], armL: [-46, 0, 32] }),
    ],
    events: [
      { t: 0.04, type: 'step', dist: 2.3 },
      { t: 0.08, type: 'swing', arc: 170, radius: 1.85, height: 1.1, from: 'handR' },
      { t: 0.20, type: 'swingEnd' },
      { t: 0.24, type: 'swing', arc: 170, radius: 1.85, height: 1.1, from: 'handL' },
      { t: 0.36, type: 'swingEnd' },
    ],
  },
};

/* ========================================================================== */
/* Stab – Simi. Wukong-Schule: kreisend, weit, mit Stoßfinish.                 */
/* ========================================================================== */

export const STAFF = {
  light: [
    {
      name: 'st_light1', dur: 0.62, stamina: 14, damage: 0.62, poise: 0.32, cancel: 0.42,
      keys: [
        K(0.00, { hips: [0, 20, 0], armR: [-56, -30, -30], armL: [-40, -10, 40], forearmR: [-40, 0, 0], forearmL: [-70, 0, 0] }),
        K(0.16, { hips: [0, 56, 0], chest: [-6, 26, 0], armR: [-120, -46, -26], armL: [-96, -22, 36], head: [0, -30, 0] }),
        K(0.32, { hips: [0, -44, 0], chest: [12, -26, 0], armR: [-26, 48, -34], armL: [-20, 24, 44], head: [4, 30, 0] }),
        K(0.62, { hips: [0, -4, 0], armR: [-48, 6, -30], armL: [-38, 2, 40] }),
      ],
      events: [
        { t: 0.15, type: 'step', dist: 0.85 },
        { t: 0.16, type: 'swing', arc: 220, radius: 2.55, height: 1.1, from: 'handR' },
        { t: 0.34, type: 'swingEnd' },
      ],
    },
    {
      name: 'st_light2', dur: 0.62, stamina: 14, damage: 0.62, poise: 0.32, cancel: 0.42,
      keys: [
        K(0.00, { hips: [0, -30, 0], armR: [-40, 30, -34], armL: [-56, 10, 44] }),
        K(0.16, { hips: [0, -62, 0], chest: [-6, -28, 0], armR: [-96, 44, -30], armL: [-120, 24, 40], head: [0, 30, 0] }),
        K(0.32, { hips: [0, 48, 0], chest: [12, 28, 0], armR: [-20, -46, -40], armL: [-26, -22, 46], head: [4, -30, 0] }),
        K(0.62, { hips: [0, 4, 0], armR: [-44, -6, -32], armL: [-42, -2, 42] }),
      ],
      events: [
        { t: 0.15, type: 'step', dist: 0.85 },
        { t: 0.16, type: 'swing', arc: 220, radius: 2.55, height: 1.1, from: 'handL' },
        { t: 0.34, type: 'swingEnd' },
      ],
    },
    {
      name: 'st_light3', dur: 0.86, stamina: 20, damage: 0.85, poise: 0.26, cancel: 0.6,
      keys: [
        K(0.00, { hips: [0, 24, 0], armR: [-40, -24, -34], armL: [-46, -10, 42] }),
        K(0.22, { hips: [0, -14, 0], chest: [-8, -8, 0], armR: [-70, 6, -22], armL: [-80, 8, 30], forearmR: [-84, 0, 0], forearmL: [-30, 0, 0] }),
        K(0.38, { hips: [0, -4, 0], chest: [8, -2, 0], armR: [-64, 0, -14], armL: [-72, 0, 20], forearmR: [-16, 0, 0], forearmL: [-10, 0, 0], thighL: [-30, 0, 0], shinL: [36, 0, 0] }),
        K(0.86, { hips: [0, 0, 0], armR: [-46, 0, -32], armL: [-44, 0, 40] }),
      ],
      events: [
        { t: 0.26, type: 'step', dist: 1.6 },
        { t: 0.28, type: 'swing', arc: 40, radius: 3.1, height: 1.2, from: 'handR', thrust: true },
        { t: 0.44, type: 'swingEnd' },
      ],
    },
  ],
  heavy: [
    {
      name: 'st_heavy1', dur: 1.25, stamina: 34, damage: 0.72, hits: 3, poise: 0.16, cancel: 0.98,
      keys: [
        K(0.00, { hips: [0, 0, 0], armR: [-46, -20, -34], armL: [-46, -8, 42] }),
        K(0.22, { hips: [0, 160, 0], chest: [6, 30, 0], armR: [-20, -50, -46], armL: [-24, -30, 52] }),
        K(0.48, { hips: [0, 380, 0], chest: [8, 10, 0], armR: [-16, -56, -50], armL: [-20, -36, 56] }),
        K(0.72, { hips: [0, 620, 0], chest: [6, -10, 0], armR: [-18, -52, -48], armL: [-22, -32, 54] }),
        K(0.92, { hips: [0, 720, 0], chest: [2, 0, 0], armR: [-34, -30, -40], armL: [-36, -18, 46] }),
        K(1.25, { hips: [0, 720, 0], armR: [-46, 0, -32], armL: [-44, 0, 40] }),
      ],
      events: [
        { t: 0.16, type: 'swing', arc: 360, radius: 2.75, height: 1.05, from: 'handR', spin: true },
        { t: 0.34, type: 'swingEnd' },
        { t: 0.40, type: 'swing', arc: 360, radius: 2.75, height: 1.05, from: 'handR', spin: true },
        { t: 0.58, type: 'swingEnd' },
        { t: 0.64, type: 'swing', arc: 360, radius: 2.85, height: 1.05, from: 'handR', spin: true },
        { t: 0.84, type: 'swingEnd' },
      ],
    },
  ],
  running: {
    name: 'st_run', dur: 0.8, stamina: 18, damage: 0.85, poise: 0.22, cancel: 0.58,
    keys: [
      K(0.00, { hips: [8, 16, 0], armR: [-58, -20, -32], armL: [-58, -8, 40] }),
      K(0.18, { hips: [2, 0, 0], chest: [10, 0, 0], armR: [-64, 0, -14], armL: [-72, 0, 20], forearmR: [-14, 0, 0] }),
      K(0.80, { hips: [0, 0, 0], armR: [-46, 0, -32], armL: [-44, 0, 40] }),
    ],
    events: [
      { t: 0.04, type: 'step', dist: 2.6 },
      { t: 0.08, type: 'swing', arc: 50, radius: 3.2, height: 1.15, from: 'handR', thrust: true },
      { t: 0.26, type: 'swingEnd' },
    ],
  },
};

/* ========================================================================== */
/* Bogen – Basti, Christian. Auf Abstand, mit Zielzeit.                        */
/* ========================================================================== */

export const BOW = {
  light: [
    {
      name: 'bw_shot', dur: 1.05, stamina: 16, damage: 1.0, poise: 0.5, cancel: 0.78, ranged: true,
      keys: [
        K(0.00, { hips: [0, 30, 0], chest: [0, 24, 0], armL: [-84, -30, 30], forearmL: [-6, 0, 0], armR: [-60, -20, -30], forearmR: [-70, 0, 0], head: [0, -26, 0] }),
        K(0.30, { hips: [0, 36, 0], chest: [0, 30, 0], armL: [-88, -34, 26], forearmL: [-4, 0, 0], armR: [-70, 20, -40], forearmR: [-110, 0, 0], head: [0, -30, 0], thighR: [-8, 22, 0] }),
        K(0.52, { hips: [0, 36, 0], chest: [0, 30, 0], armL: [-88, -34, 26], armR: [-72, 26, -44], forearmR: [-120, 0, 0], head: [0, -30, 0] }),
        K(0.62, { hips: [0, 32, 0], chest: [-2, 26, 0], armL: [-86, -32, 28], armR: [-40, 40, -30], forearmR: [-70, 0, 0], head: [0, -28, 0] }),
        K(1.05, { hips: [0, 10, 0], chest: [0, 8, 0], armL: [-40, -10, 26], armR: [-44, 0, -30], forearmR: [-40, 0, 0] }),
      ],
      events: [
        { t: 0.32, type: 'sfx', sound: 'bowDraw' },
        { t: 0.56, type: 'cast', kind: 'arrow' },
      ],
    },
  ],
  heavy: [
    {
      name: 'bw_power', dur: 1.7, stamina: 30, damage: 2.1, poise: 0.5, cancel: 1.3, ranged: true,
      keys: [
        K(0.00, { hips: [0, 30, 0], chest: [0, 24, 0], armL: [-84, -30, 30], armR: [-60, -20, -30] }),
        K(0.50, { hips: [0, 38, 0], chest: [-2, 32, 0], armL: [-90, -36, 24], armR: [-74, 28, -46], forearmR: [-126, 0, 0], head: [-2, -32, 0] }),
        K(1.00, { hips: [0, 38, 0], chest: [-2, 32, 0], armL: [-92, -38, 22], armR: [-76, 32, -50], forearmR: [-132, 0, 0], head: [-2, -32, 0] }),
        K(1.12, { hips: [0, 32, 0], chest: [-2, 26, 0], armL: [-88, -34, 26], armR: [-40, 44, -30], forearmR: [-64, 0, 0] }),
        K(1.70, { hips: [0, 10, 0], chest: [0, 8, 0], armL: [-40, -10, 26], armR: [-44, 0, -30] }),
      ],
      events: [
        { t: 0.20, type: 'sfx', sound: 'bowDraw' },
        { t: 1.04, type: 'cast', kind: 'arrowHeavy' },
      ],
    },
  ],
  running: {
    name: 'bw_kick', dur: 0.7, stamina: 16, damage: 0.6, poise: 0.26, cancel: 0.5,
    keys: [
      K(0.00, { hips: [10, 0, 0], thighR: [-20, 0, 0] }),
      K(0.18, { hips: [-6, 0, 0], chest: [-14, 0, 0], thighR: [-96, 0, 0], shinR: [30, 0, 0], armL: [-30, 0, 40], armR: [-30, 0, -40] }),
      K(0.70, { hips: [0, 0, 0], thighR: [0, 0, 0] }),
    ],
    events: [
      { t: 0.06, type: 'step', dist: 1.8 },
      { t: 0.14, type: 'swing', arc: 60, radius: 1.6, height: 0.9, from: 'footR', kick: true },
      { t: 0.26, type: 'swingEnd' },
    ],
  },
};

/* ========================================================================== */
/* Katalysator – Vitali, Preuß. Zaubern statt schlagen.                        */
/* ========================================================================== */

export const CATALYST = {
  light: [
    {
      name: 'ct_bolt', dur: 0.95, stamina: 8, fp: 12, damage: 1.0, poise: 0.5, cancel: 0.7, ranged: true,
      keys: [
        K(0.00, { hips: [0, 14, 0], chest: [0, 10, 0], armR: [-50, -20, -34], forearmR: [-60, 0, 0] }),
        K(0.28, { hips: [0, 20, 0], chest: [-6, 16, 0], armR: [-104, -34, -22], forearmR: [-84, 0, 0], head: [-6, -16, 0], armL: [-30, -10, 26] }),
        K(0.46, { hips: [0, 6, 0], chest: [6, 4, 0], armR: [-72, 20, -20], forearmR: [-24, 0, 0], head: [2, -4, 0] }),
        K(0.95, { hips: [0, 8, 0], chest: [0, 6, 0], armR: [-48, 0, -32], forearmR: [-50, 0, 0] }),
      ],
      events: [
        { t: 0.20, type: 'sfx', sound: 'castCharge' },
        { t: 0.44, type: 'cast', kind: 'bolt' },
      ],
    },
  ],
  heavy: [
    {
      name: 'ct_comet', dur: 1.7, stamina: 14, fp: 30, damage: 2.4, poise: 0.4, cancel: 1.3, ranged: true,
      keys: [
        K(0.00, { hips: [0, 10, 0], armR: [-50, -20, -34] }),
        K(0.45, { hips: [-4, 0, 0], spine: [-10, 0, 0], chest: [-14, 0, 0], armR: [-160, -14, -24], armL: [-158, 14, 22], head: [-24, 0, 0] }),
        K(0.90, { hips: [-6, 0, 0], spine: [-14, 0, 0], chest: [-18, 0, 0], armR: [-172, -10, -20], armL: [-170, 10, 18], head: [-30, 0, 0] }),
        K(1.10, { hips: [10, 0, 0], spine: [20, 0, 0], chest: [24, 0, 0], armR: [-58, 0, -20], armL: [-56, 0, 18], head: [14, 0, 0], thighL: [-24, 0, 0] }),
        K(1.70, { hips: [0, 0, 0], armR: [-48, 0, -32], armL: [-46, 0, 30] }),
      ],
      events: [
        { t: 0.20, type: 'sfx', sound: 'castCharge' },
        { t: 1.02, type: 'cast', kind: 'comet' },
      ],
    },
  ],
  running: {
    name: 'ct_dart', dur: 0.66, stamina: 8, fp: 8, damage: 0.62, poise: 0.4, cancel: 0.48, ranged: true,
    keys: [
      K(0.00, { hips: [6, 16, 0], armR: [-56, -20, -32] }),
      K(0.18, { hips: [2, 4, 0], chest: [6, 2, 0], armR: [-70, 22, -20], forearmR: [-22, 0, 0] }),
      K(0.66, { hips: [0, 8, 0], armR: [-48, 0, -32] }),
    ],
    events: [{ t: 0.16, type: 'cast', kind: 'dart' }],
  },
};

export const MOVESETS = { GREATSWORD, LONGSWORD, DUAL, STAFF, BOW, CATALYST };
