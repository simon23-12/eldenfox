/**
 * Bereitschaftshaltungen je Waffenklasse.
 *
 * Anders als die Clips sind das *absolute* Posen, keine Deltas: sie ersetzen
 * die Grundhaltung, solange die Figur nicht angreift. Die Angriffsclips
 * bleiben dadurch weiter gegen NEUTRAL authorisiert und müssen nichts von
 * der Waffe wissen.
 *
 * Zur Geometrie: die Waffe liegt auf der Achse der Führungshand (rechts -X,
 * links +X). Ein hängender Arm heißt also Klinge im Boden. Die Arm-, Unter-
 * arm- und Handwinkel unten sind nicht geraten, sondern über eine Suche
 * bestimmt worden, die die Waffenachse auf eine Zielrichtung im Figurenraum
 * ausrichtet und dabei die Handhöhe im plausiblen Bereich hält.
 */

export const STANCES = {
  /** Zweihänder über der rechten Schulter, Klinge nach hinten oben. */
  GREATSWORD: {
    hips: [0, -12, 0], spine: [2, -7, 0], chest: [1, -15, 0], upperChest: [0, -11, 0],
    neck: [-4, 9, 0], head: [-2, 17, 0],
    shoulderR: [-10, 0, -14], armR: [10, -14, 70], forearmR: [-30, 0, -100], handR: [-20, 0, -20],
    shoulderL: [-8, 0, 10], armL: [-6, -30, 92], forearmL: [-46, 0, -70], handL: [0, 0, -24],
    thighL: [-3, 9, 4], thighR: [-6, -11, -3], shinL: [6, 0, 0], shinR: [8, 0, 0],
    footL: [-3, 0, 0], footR: [-4, 0, 0],
  },

  /** Langschwert schräg nach vorn unten, Schildarm angewinkelt. */
  LONGSWORD: {
    hips: [0, -16, 0], spine: [2, -9, 0], chest: [1, -13, 0], upperChest: [0, -9, 0],
    neck: [-3, 9, 0], head: [-1, 16, 0],
    shoulderR: [-6, 0, -10], armR: [10, -20, 140], forearmR: [-25, 0, -10], handR: [0, 0, 40],
    shoulderL: [-6, 0, 12], armL: [-24, -18, 44], forearmL: [-72, 0, -18], handL: [0, 0, -12],
    thighL: [-3, 11, 4], thighR: [-6, -13, -3], shinL: [7, 0, 0], shinR: [9, 0, 0],
    footL: [-3, 0, 0], footR: [-4, 0, 0],
  },

  /** Zwei Klingen tief und weit außen, Spitzen nach hinten unten. */
  DUAL: {
    hips: [0, -5, 0], spine: [3, -3, 0], chest: [3, -5, 0], upperChest: [1, -3, 0],
    neck: [-3, 3, 0], head: [-2, 7, 0],
    shoulderR: [-4, 0, -12], armR: [30, -40, 120], forearmR: [-25, 0, 30], handR: [0, 0, -80],
    shoulderL: [-4, 0, 12], armL: [30, 40, -120], forearmL: [-25, 0, -30], handL: [0, 0, 80],
    thighL: [-4, 8, 5], thighR: [-4, -8, -5], shinL: [8, 0, 0], shinR: [8, 0, 0],
    footL: [-4, 0, 0], footR: [-4, 0, 0],
  },

  /** Stab diagonal vor dem Körper, Spitze nach vorn oben. */
  STAFF: {
    hips: [0, -9, 0], spine: [2, -5, 0], chest: [2, -9, 0], upperChest: [1, -6, 0],
    neck: [-3, 6, 0], head: [-1, 11, 0],
    shoulderR: [-8, 0, -14], armR: [30, -40, 140], forearmR: [-25, 0, 30], handR: [0, 0, 60],
    shoulderL: [-10, 0, 10], armL: [4, -34, 96], forearmL: [-52, 0, -46], handL: [0, 0, -20],
    thighL: [-4, 10, 4], thighR: [-5, -10, -4], shinL: [7, 0, 0], shinR: [7, 0, 0],
    footL: [-3, 0, 0], footR: [-4, 0, 0],
  },

  /** Bogen in der linken Hand nach vorn, rechte Hand an der Sehne. */
  BOW: {
    hips: [0, 20, 0], spine: [1, 11, 0], chest: [0, 15, 0], upperChest: [0, 11, 0],
    neck: [-2, -11, 0], head: [-1, -19, 0],
    shoulderL: [-8, 0, 14], armL: [0, 0, -140], forearmL: [-25, 0, -10], handL: [0, 0, -40],
    shoulderR: [-4, 0, -10], armR: [-16, -22, 54], forearmR: [-70, 0, -26], handR: [0, 0, -10],
    thighL: [-3, -8, 4], thighR: [-5, 10, -3], shinL: [6, 0, 0], shinR: [7, 0, 0],
    footL: [-3, 0, 0], footR: [-4, 0, 0],
  },

  /** Katalysator senkrecht in der rechten Hand, linke Hand offen. */
  CATALYST: {
    hips: [0, -8, 0], spine: [1, -5, 0], chest: [0, -8, 0], upperChest: [0, -6, 0],
    neck: [-2, 6, 0], head: [-1, 10, 0],
    shoulderR: [-12, 0, -16], armR: [0, -40, 140], forearmR: [-25, 0, -110], handR: [0, 0, -100],
    shoulderL: [-4, 0, 10], armL: [-20, -22, 50], forearmL: [-64, 0, -28], handL: [0, 0, -14],
    thighL: [-3, 8, 4], thighR: [-5, -8, -3], shinL: [6, 0, 0], shinR: [6, 0, 0],
    footL: [-3, 0, 0], footR: [-4, 0, 0],
  },
};
