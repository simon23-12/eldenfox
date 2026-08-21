# ELDEN FOX

Ein Souls-like in Three.js + WebGPU. Die spielbaren Figuren sind die acht
Füchse aus dem Füchsemon-Projekt, übersetzt in Souls-Archetypen: Zauberer,
Schwertkämpfer, Bogenschützen und ein Stabkämpfer.

Zwei Abschnitte: eine Küste im Abendlicht mit Gegnergruppen und einem
gefallenen Ritter am Ende, danach eine schwebende Insel über dem Wolkenmeer
gegen den Fürsten über den Wolken.

```bash
npm install
npm run dev      # http://localhost:5180
```

Braucht **WebGPU**: Chrome/Edge 113+, Safari 18+, oder Firefox mit
`dom.webgpu.enabled`. Ohne WebGPU bricht der Start mit einer Meldung ab –
ein WebGL-Rückfall würde die halbe Grafik stumm abschalten und wäre
irreführender als ein klarer Abbruch.

## Steuerung

| Eingabe | Wirkung |
|---|---|
| WASD | Laufen |
| Maus | Umsehen (Klick fängt den Zeiger) |
| Shift | Rennen (zehrt Ausdauer) |
| Leertaste | Ausweichrolle mit Unverwundbarkeitsfenster |
| Linksklick / J | Leichter Angriff, kettet sich |
| K | Schwerer Angriff |
| Rechtsklick / H | Blocken |
| Q | Ziel anvisieren |
| R | Trinken (heilt, 5 Ladungen) |
| O | Grafikstufe durchschalten |
| P | Pause |

Gamepad wird erkannt (Standardbelegung).

`?level=2` springt direkt in die Bossarena.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `src/core/` | Schleife, Eingabe, Zufall |
| `src/gfx/` | Renderpfad: Atmosphäre, Ozean, Gelände, Gras, Volumetrik, Post |
| `src/anim/` | Skelett, Posen, Animator, starres GPU-Skinning |
| `src/game/` | Figuren, Kampf, KI, Boss, Welt, Abschnitte |
| `src/ui/` | Anzeige und Menüs |
| `src/audio/` | Prozedurale Tonkulisse |

## Grafik

Alles läuft über den WebGPU-Backend von Three.js, geschrieben in TSL.

**Atmosphäre** – Modell nach Hillaire 2020 mit vier Nachschlagetabellen, alle
in Compute-Shadern: Transmission (256×64) und Mehrfachstreuung (32×32) werden
einmalig gebacken, Himmelsansicht (256×144) und Luftperspektive (32³) pro
Frame. Die Sonnenfarbe für das Direktlicht wird auf der CPU parallel
mitgerechnet, damit kein GPU-Rücklesen nötig ist.

**Ozean** – Wellenspektrum nach Tessendorf mit inverser Fouriertransformation
auf der GPU. Zwei Kaskaden (340 m und 38 m Kachel), pro Kaskade zwei komplexe
Transformationen über Schmetterlingsstufen. Daraus folgen Auslenkung, Normale
und die Jacobi-Determinante, die die Gischt auf den brechenden Kämmen setzt.
Beleuchtet wird mit explizitem Schlick-Fresnel gegen die Himmels-LUT plus
Streuung in den Wellenkämmen.

**Vegetation** – GPU-getrieben ohne CPU-Rückmeldung: ein Compute-Kernel prüft
pro Frame 1,7 Millionen Kandidaten gegen Höhenfeld, Hangneigung und
Sichtkegel, schreibt die Überlebenden per atomarem Zähler dicht in einen
Puffer und legt denselben Zähler als `instanceCount` in einen
Indirect-Draw-Puffer. Gezeichnet wird mit `drawIndexedIndirect`.

**Volumetrik** – Froxelgitter (176×96×80) über dem Sichtvolumen. Zwei
Compute-Durchgänge: Einspeisen mit Sonnensichtbarkeit aus einem Raymarch
durch die Geländehöhentextur, dann Integration je Bildschirmspalte. Trägt in
Abschnitt zwei zusätzlich die Wolkenbank.

**Figuren** – prozedurale Körper aus Grundformen, zusammengeführt zu einer
Geometrie mit Knochenindex je Vertex. Die Knochenmatrizen liegen als 3×4-Zeilen
in einem Storage-Buffer, den der Vertexshader liest: ein Draw-Call je Figur.
Animiert wird über handgeschriebene Posen mit Überblendung, additiven Ebenen,
Wurzelbewegung und Zwei-Knochen-IK für die Fußaufsetzung.

**Post** – TRAA direkt hinter dem Szenenpass, dann GTAO mit Entrauschung,
SSR (auf Metalle beschränkt), eigene Schärfentiefe mit streukreisgewichteter
Sammelabtastung, Kamera-Bewegungsunschärfe aus Tiefenreprojektion, Bloom,
AgX-Tonemapping, chromatische Aberration, Vignette und Filmkorn.
Intern wird in 72 % Auflösung gerendert und per FSR1 rekonstruiert.

## Was nicht drin ist

- **Wolken als eigener Raymarch.** `src/gfx/Clouds.js` enthält einen
  vollständigen Wolken-Raymarch mit Perlin-Worley-Formtextur, Powder-Term und
  Lichtmarsch. Er liefert in diesem TSL-Pfad kein Ergebnis, obwohl
  Strahlrekonstruktion, Schichtschnitt und Formtextur einzeln nachweisbar
  korrekt sind. Die Wolkendecke in Abschnitt zwei läuft deshalb über das
  Froxelvolumen, das dieselbe Formtextur benutzt. Der Raymarch bleibt im
  Projekt, weil die Fehlersuche dort weitergehen sollte.
- **SSGI.** Der Addon-Knoten liefert ein Vollbildergebnis ohne
  Hintergrundmaske und flutet additiv eingehängt das gesamte Bild. Der Pfad
  ist erhalten, aber in allen Stufen abgeschaltet.
- **Nanite-artige virtuelle Geometrie und virtuelles Texturing.** Der
  GPU-getriebene Pfad existiert für die Vegetation, wurde aber nicht auf
  Meshlet-Cluster mit hierarchischer Tiefenverdeckung ausgebaut.

## Bekannte Kanten

- Die Kamera prüft nur das Gelände auf Hindernisse, nicht die Säulen.
- Runen gehen beim Tod nicht verloren.
- Die Bildrate liegt auf einem Apple-Notebook je nach Stufe zwischen 20 und
  55 fps. `O` schaltet zwischen `low`, `medium`, `high` und `ultra`.
