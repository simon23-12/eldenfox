import {
  Fn, vec2, vec3, vec4, float, uniform, uv, screenUV, screenSize, rtt, texture,
  abs, max, min, clamp, saturate, mix, sin, cos, sqrt, pow, floor, fract, dot, length,
  smoothstep, step, Loop, If, PI, PI2, time, luminance, int, atan, exp, sign, select,
  perspectiveDepthToViewZ, cameraNear, cameraFar, cameraPosition,
} from 'three/tsl';

/* ============================================================================
 * Eigene Post-Effekte.
 *
 * Die entsprechenden Three.js-Addon-Knoten (DepthOfFieldNode,
 * ChromaticAberrationNode) rendern bzw. binden in `updateBefore` und
 * funktionieren daher nur mit einem echten Pass als Eingang – nicht mit einem
 * berechneten Knoten mitten im Graphen. Diese Varianten sind reine
 * TSL-Funktionen und lassen sich an jeder Stelle einhängen.
 * ========================================================================== */

const GOLDEN_ANGLE = 2.39996323;

/**
 * Schärfentiefe mit Streukreis-gewichteter Sammelabtastung.
 * Vordergrund-Unschärfe blutet bewusst über Kanten, Hintergrund nicht –
 * das ist der Unterschied zwischen "billiger Blur" und Bokeh.
 *
 * @param {Node<vec4>} colorNode  Eingangsbild (wird in ein RTT aufgelöst)
 * @param {Node<float>} viewZNode Sichtraumtiefe (negativ vor der Kamera)
 * @param {object} p              focus, range, bokeh, maxRadius, samples
 */
export function depthOfField(colorNode, depthTextureNode, {
  focus, range, bokeh, maxRadiusPx = 18, samples = 24,
  nearScale = 0.28, farLimit = 0.14,
} = {}) {
  const src = rtt(colorNode);

  const viewZAt = (uvNode) =>
    perspectiveDepthToViewZ(depthTextureNode.sample(uvNode).r, cameraNear, cameraFar);

  /** Signierter Streukreis: negativ vor der Fokusebene, positiv dahinter. */
  const cocOf = (vz) => {
    const dist = abs(vz).toVar();
    // Der Nahbereich fällt steiler ab als der Hintergrund – so bleibt die Welt
    // lesbar, während direkt vor der Kamera trotzdem sauber aufgelöst wird.
    const nearC = clamp(focus.sub(dist).div(max(0.001, range.mul(nearScale))), 0.0, 1.0).negate().toVar();
    const farC = clamp(dist.sub(focus).div(max(0.001, range)), 0.0, 1.0).mul(farLimit).toVar();
    return select(dist.lessThan(focus), nearC, farC).mul(bokeh);
  };

  return Fn(() => {
    const texel = vec2(1.0).div(screenSize).toVar();
    const centerCoc = cocOf(viewZAt(screenUV)).toVar();
    const centerColor = src.sample(screenUV).toVar();
    const radius = abs(centerCoc).mul(float(maxRadiusPx)).toVar();

    const sum = centerColor.rgb.toVar();
    const weightSum = float(1.0).toVar();

    // Rauschen bricht das Speichenmuster der Spirale auf
    const jitter = fract(sin(dot(screenUV.mul(screenSize), vec2(12.9898, 78.233))).mul(43758.5453)).toVar();

    Loop(samples, ({ i }) => {
      const t = float(i).add(jitter).div(float(samples)).toVar();
      const a = float(i).mul(GOLDEN_ANGLE).add(jitter.mul(PI2)).toVar();
      const rr = sqrt(t).mul(radius).toVar();
      const offset = vec2(cos(a), sin(a)).mul(rr).mul(texel).toVar();
      const suv = clamp(screenUV.add(offset), vec2(0.001), vec2(0.999)).toVar();

      const s = src.sample(suv).toVar();
      const sampleCoc = abs(cocOf(viewZAt(suv))).mul(float(maxRadiusPx)).toVar();

      // Eine Abtastung trägt nur bei, wenn ihr eigener Streukreis bis zur
      // Bildmitte reicht – sonst blutet scharfer Hintergrund in die Unschärfe.
      const reach = max(sampleCoc, radius).toVar();
      const w = smoothstep(rr.sub(1.5), rr.add(0.5), reach).toVar();
      sum.addAssign(s.rgb.mul(w));
      weightSum.addAssign(w);
    });

    const blurred = sum.div(max(1e-4, weightSum)).toVar();
    const amount = saturate(abs(centerCoc).mul(1.7)).toVar();
    return vec4(mix(centerColor.rgb, blurred, amount), centerColor.a);
  })();
}

/**
 * Chromatische Aberration mit radialer Verzeichnung und Randabfall.
 * Spektrale Abtastung: N Proben zwischen innerer und äußerer Skalierung,
 * jede mit einer RGB-Empfindlichkeitskurve gewichtet und pro Kanal normiert.
 */
export function chromaticAberration(colorNode, {
  strength, edgePower = 2.4, samples = 5,
} = {}) {
  const src = rtt(colorNode);
  const n = Math.max(3, samples | 0);

  return Fn(() => {
    const c = screenUV.sub(0.5).toVar();
    const d = saturate(length(c).mul(1.4142)).toVar();
    const amt = strength.mul(pow(d, float(edgePower))).mul(0.014).toVar();

    const acc = vec3(0.0).toVar();
    const wsum = vec3(0.0).toVar();

    Loop(n, ({ i }) => {
      const t = float(i).div(float(n - 1)).toVar();          // 0 = innen (blau), 1 = außen (rot)
      const scale = float(1.0).sub(amt).add(amt.mul(2.0).mul(t)).toVar();
      const suv = clamp(c.mul(scale).add(0.5), vec2(0.0005), vec2(0.9995)).toVar();
      const s = src.sample(suv).rgb.toVar();

      // dreieckige Empfindlichkeit: Blau bei t=0, Grün bei t=0.5, Rot bei t=1
      const w = vec3(
        saturate(float(1.0).sub(abs(t.sub(1.0)).mul(2.0))),
        saturate(float(1.0).sub(abs(t.sub(0.5)).mul(2.0))),
        saturate(float(1.0).sub(abs(t).mul(2.0))),
      ).toVar();

      acc.addAssign(s.mul(w));
      wsum.addAssign(w);
    });

    return vec4(acc.div(max(vec3(1e-4), wsum)), 1.0);
  })();
}

/**
 * Bewegungsunschärfe aus der Kamerabewegung.
 *
 * Bewusst *nicht* über den Velocity-Puffer: Wasser, Gras und die Figuren
 * verschieben ihre Scheitelpunkte im Shader, während `positionPrevious` die
 * unverschobene Vorframe-Position liefert. Die Differenz ist dann Unsinn und
 * verschmiert das halbe Bild.
 *
 * Stattdessen wird die Weltposition aus der Tiefe rekonstruiert, mit der
 * Sicht-Projektions-Matrix des letzten Frames erneut projiziert und die
 * Bildschirmdifferenz als Verschiebungsvektor benutzt. Das erfasst Schwenks,
 * Fahrten und Rollen exakt – also genau den Teil, der etwas beiträgt.
 */
export function cameraMotionBlur(colorNode, depthTextureNode, {
  strength, prevViewProj, camBasis, maxLengthPx = 26, samples = 10,
} = {}) {
  const src = rtt(colorNode);
  const n = Math.max(3, samples | 0);

  return Fn(() => {
    const d = depthTextureNode.sample(screenUV).r.toVar();

    // Hintergrund (leerer Tiefenpuffer) nicht verwischen
    const isBackground = d.lessThanEqual(0.0);

    // Weltpunkt aus Kamerabasis und linearer Tiefe rekonstruieren.
    // Die inverse Sicht-Projektions-Matrix als Uniform liefert im Postpfad
    // keinen aktuellen Wert; Basisvektoren und Tangenten dagegen schon.
    const ndcX = screenUV.x.mul(2.0).sub(1.0).toVar();
    const ndcY = screenUV.y.mul(2.0).sub(1.0).toVar();
    const ray = camBasis.forward
      .add(camBasis.right.mul(ndcX.mul(camBasis.tanX)))
      .add(camBasis.up.mul(ndcY.mul(camBasis.tanY)))
      .toVar();
    const viewZ = perspectiveDepthToViewZ(d, cameraNear, cameraFar).toVar();
    const world = cameraPosition.add(ray.mul(abs(viewZ))).toVar();

    const prev = prevViewProj.mul(vec4(world, 1.0)).toVar();
    const pw = select(abs(prev.w).lessThan(1e-6), float(1e-6), prev.w).toVar();
    const prevUV = prev.xy.div(pw).mul(0.5).add(0.5).toVar();

    const texel = vec2(1.0).div(screenSize).toVar();
    const delta = screenUV.sub(prevUV).mul(strength).toVar();
    const lenPx = length(delta.div(texel)).toVar();
    const scale = min(float(1.0), float(maxLengthPx).div(max(1e-3, lenPx))).toVar();
    const v = delta.mul(scale).toVar();

    const jitter = fract(sin(dot(screenUV.mul(screenSize), vec2(12.9898, 78.233)).add(time.mul(11.3))).mul(43758.5453)).toVar();

    const center = src.sample(screenUV).rgb.toVar();
    const acc = center.toVar();
    const wsum = float(1.0).toVar();

    Loop(n, ({ i }) => {
      const t = float(i).add(jitter).div(float(n)).sub(0.5).toVar();
      const suv = clamp(screenUV.sub(v.mul(t)), vec2(0.0005), vec2(0.9995)).toVar();
      const w = float(1.0).sub(abs(t).mul(2.0)).mul(0.85).add(0.15).toVar();
      acc.addAssign(src.sample(suv).rgb.mul(w));
      wsum.addAssign(w);
    });

    const blurred = acc.div(max(1e-4, wsum)).toVar();
    const k = saturate(lenPx.mul(0.22)).mul(select(isBackground, float(0.35), float(1.0))).toVar();
    return vec4(mix(center, blurred, k), 1.0);
  })();
}

/**
 * Anamorphotischer Lichtstreifen für sehr helle Stellen (Sonne, Magie).
 * Läuft auf einer stark verkleinerten Kopie und bleibt daher billig.
 */
export function anamorphicStreak(colorNode, { threshold, strength, length: len = 0.16, tint }) {
  const src = rtt(colorNode, null, null, { resolutionScale: 0.25 });

  return Fn(() => {
    const acc = vec3(0.0).toVar();
    const steps = 24;
    Loop(steps, ({ i }) => {
      const t = float(i).div(float(steps - 1)).sub(0.5).mul(2.0).toVar();
      const suv = clamp(screenUV.add(vec2(t.mul(len), 0.0)), vec2(0.001), vec2(0.999)).toVar();
      const s = src.sample(suv).rgb.toVar();
      const bright = max(vec3(0.0), s.sub(threshold)).toVar();
      const w = float(1.0).sub(abs(t)).toVar();
      acc.addAssign(bright.mul(w).mul(w));
    });
    return acc.div(float(steps)).mul(strength).mul(tint);
  })();
}
