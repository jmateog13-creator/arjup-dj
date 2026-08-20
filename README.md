# Arjup DJ

Mesa de DJ de doble deck para el aula — un clon fiel de **VirtualDJ Pro**: el objetivo es
que quien domine esta app abra VirtualDJ real y no note la diferencia. Términos de mesa
en inglés VDJ (SYNC, CUE, HOT CUE, LOOP, GAIN, LOW/MID/HIGH, FX…), capa docente en
català. **Vanilla JS + Web Audio API nativa** (sin Tone.js: control sample-accurate del
buffer), cero dependencias, sin bundler.

Forma parte de la **Suite Aulatech** (flux d'entrada estàndard: landing → selector de
3 modes → app) y comparte el núcleo docente canónico de `../shared_lib/`
(`MasterAnalyzer.js` + `LevelManager.js`, vendorizados sin cambios en `js/modes/`).

## Cómo servirla

```bash
# desde 2.2.Aulatech_Studio/
python3 -m http.server 8133 --directory aulatech_dj
# → http://localhost:8133
```

O con la config `aulatech-dj` de `.claude/launch.json` (puerto 8133). La app trae
además su propio `serve_nocache.py` (servidor estático con `Cache-Control: no-store`,
para que los ES modules no se queden stale durante el desarrollo):
`python3 serve_nocache.py 8133`. Requiere servidor (ES modules + AudioWorklets);
abrir `index.html` con `file://` no funciona.

**Atajo (macOS):** doble clic en `Arjup DJ.command` (Finder) arranca el servidor en el
puerto 8151 y abre la mesa en el navegador. Si ya está servido, solo abre la pestaña.
Cerrar la ventana de Terminal para la app.

## App de escritorio (Windows / macOS)

Para el aula hay una versión empaquetada con Electron: doble clic al icono, sin
navegador, sin Python, sin servidor. La mesa se sirve por un esquema propio
(`arjup://`) porque Chromium bloquea ES modules y AudioWorklets sobre `file://`.

```bash
npm install          # una vez
npm start            # abrir la app en desarrollo
ARJUP_SMOKE=1 npm start   # check: arranca, carga el motor y sale (SMOKE OK / FAIL)
npm run dist:mac     # .dmg  (solo desde macOS)
npm run dist:win     # .exe  (solo desde Windows)
```

Los instaladores de las dos plataformas se compilan en CI: pestaña **Actions →
Desktop installers → Run workflow**, o empujando un tag `v*`. Los `.dmg` / `.exe`
quedan como artifacts del run.

Sin firma digital: Windows mostrará el aviso de SmartScreen ("Más información →
Ejecutar de todas formas") y macOS pedirá abrir con clic derecho la primera vez.

## Los 3 modos

- **ACADÈMIA** — 8 lliçons guiadas (de "La taula i el deck" a "FX i la transició
  completa"), con policy de controles por paso (candados) y highlights.
- **LABORATORI** — 15 reptes en tiempo real validados por el MasterAnalyzer sobre el
  ConsoleGraph + ActionTimeline: estados mantenidos con hold (1.5–3 s) y retos
  temporales ("transició neta sense clash de greus", "tempo sostingut"…).
- **SANDBOX** — mesa libre: carga de audio local, MIDI Learn, grabación de la mezcla y
  5 sessions d'exemple precargadas ("Sessió house 124", "Transició a mig fer —
  acaba-la tu"…). El progreso docente (lliçons/reptes completados) vive en
  `localStorage['atdj-progress']`. **Sin sistema de puntos/XP** — por diseño.

## Controles

| Control | Acción |
|---|---|
| `Espacio` / `⏎` | PLAY/PAUSE del deck A / deck B |
| `1–8` | Dispara los pads del sampler |
| Jog (interior) | Reproduciendo = nudge (pitch bend) · en pausa = scrub fino |
| Jog (aro exterior) | Seek rápido (1 vuelta = duración/8) |
| HOT CUE (×4) | Clic = set si está vacío / jump si está lleno · `Shift`+clic = borrar |
| Knobs EQ/GAIN/FILTER | Drag vertical (`Shift` = fino) · doble clic o clic derecho = **kill** |
| LOOP ½ 1 2 4 8 + EXIT | Loop por beatgrid |
| Waveform superior | Rueda = zoom · clic = seek (con el deck en pausa) |
| SYNC | Iguala effectiveBPM al otro deck y alinea la fase de beat |
| KEYLOCK | Master tempo: cambia el tempo sin cambiar el tono (AudioWorklet) |
| 🎧 PFL / SORTIDES | Preescucha pre-fader por segunda salida, Split Cue, selector de dispositivos |
| MIDI (header) | MIDI Learn: clic en un control + mover el físico (mapa en `localStorage`) |
| REC | Graba el master a WAV 16-bit (`mescla_YYYYMMDD.wav`; fallback webm/opus) |

## Estructura

```
index.html · css/ (app · decks · mixer)      shell VDJ: waveforms / decks+mixer / browser
js/core/      AudioEngine (ctx único, routing) · Deck · Library · ConsoleGraph+ActionTimeline
js/analysis/  BPMDetector (autocorrelación) · Peaks (rhythm waves) · KeyDetector (Camelot)
js/fx/ · js/sampler/   Echo · Flanger · BeatRoll · FilterLFO · 8 pads one-shot
js/audio/     AudioWorklets: pitchshift (keylock) · recorder PCM · encoder WAV
js/ui/        DeckPane · JogWheel · FXPane · MixerPane · BrowserPane · WaveformStrip · SamplerPane
js/modes/     lliçons (8) · reptes (15) · exemples (5) · shared_lib vendored · js/midi/ · js/i18n/ca.js
assets/tracks/   8 pistes demo .m4a + tracks.json (bpm/key/firstBeat) + samples de pads
```

El contrato completo está en `ARCHITECTURE.md`.

## Limitaciones conocidas

- **Assets pesados**: la carpeta `assets/` ocupa ~162 MB, de los cuales ~143 MB son los
  **WAV originales** en `assets/tracks/_wav_originals/` (masters de las 8 pistas demo).
  La app solo carga las versiones `.m4a` (~19 MB) — los WAV se pueden excluir de un
  deploy sin tocar nada.
- **No hay proyecto guardable** (por diseño): la mesa es un instrumento en directo, no
  un documento. Lo que persiste es la mezcla grabada (REC → WAV), el progreso docente
  (`atdj-progress`) y el mapa MIDI (`atdj-midi-map`), todo en `localStorage`.
- **Audio solo tras gesto de usuario**: el clic en la mode-card del selector es el
  gesto que crea el `AudioContext` — nada suena antes (política de autoplay).
- **Sin keylock en pistas fuera de rango**: el pitch fader es ±8 % (default VDJ); el
  pitch-shifter granular está afinado para ese rango, más allá aparecen artefactos.
- **PFL/salidas duales** dependen de `setSinkId` (Chrome/Edge); sin soporte, el diálogo
  de SORTIDES degrada con avisos y queda el **Split Cue** (L→altavoces, R→auriculares).
- **MIDI Learn** requiere Web MIDI API (Chrome/Edge); en otros navegadores se degrada
  en silencio.
