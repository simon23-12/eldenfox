/**
 * Verformen konvexer Körper zu Felsen und Trümmern.
 */

/**
 * Deterministischer Pseudozufall aus einer Position.
 * Gleiche Eingabe liefert immer denselben Wert in [0, 1).
 */
function hash3(x, y, z, seed) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 13.37) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Verformt einen konvexen Körper zu einem Felsen.
 *
 * Der Punkt, auf den es ankommt: die Polyeder aus three sind **nicht
 * indiziert**. Jede Ecke liegt rund fünfmal im Puffer, einmal je angrenzender
 * Fläche. Ein Zufallswert *je Vertex* gibt denselben Ecken damit verschiedene
 * Auslenkungen und reißt den Körper in lose Dreiecke – genau daher der
 * Papierschnipsel-Look, und der Grund, warum starke Verformung bisher nicht
 * benutzbar war.
 *
 * Der Hash hängt allein an der Position, deshalb bekommen alle Kopien einer
 * Ecke denselben Wert und der Körper bleibt geschlossen.
 *
 * @param {import('three/webgpu').BufferGeometry} geometry wird an Ort und Stelle verändert
 * @param {object} [o]
 * @param {number} [o.amount]  grobe Beulen, Anteil des Radius
 * @param {number} [o.detail]  feine Kanten, Anteil des Radius
 * @param {number} [o.flatten] Stauchung in der Höhe (1 = keine)
 * @param {number} [o.seed]
 */
export function roughenSolid(geometry, {
  amount = 0.32, detail = 0.13, flatten = 0.8, seed = 0,
} = {}) {
  const p = geometry.attributes.position;
  // Runden, damit Kopien einer Ecke auch bei Rundungsresten exakt gleich zählen
  const r = (v) => Math.round(v * 1e5) / 1e5;

  for (let i = 0; i < p.count; i++) {
    const x = r(p.getX(i)), y = r(p.getY(i)), z = r(p.getZ(i));
    const grob = hash3(x, y, z, seed) * 2 - 1;
    const fein = hash3(x * 3.7, y * 3.7, z * 3.7, seed + 11) * 2 - 1;
    const s = 1 + grob * amount + fein * detail;
    p.setXYZ(i, x * s, y * s * flatten, z * s);
  }

  p.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}
