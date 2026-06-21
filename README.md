# 🎹 Gesture Chord Synth

Play synthesizer chords with two-handed camera gestures in the browser.
Hand tracking runs fully client-side with [MediaPipe](https://ai.google.dev/edge/mediapipe)
`HandLandmarker`; audio is a [Tone.js](https://tonejs.github.io/) polyphonic synth.

## How it works

- **Pick a key** — choose a root note and major/minor.
- **Chord hand** (default: your right hand) — the **number of extended fingers**
  selects the scale degree: 1 finger → I, 2 → ii, … 5 → V. Degrees **6 (vi)** and
  **7 (vii°)** are reached with bound shapes (see *Gesture Mapping*).
- **Modifier hand** (default: left) — adds a "special chord":
  - ☝️ index → **sus2** (the "2nd")
  - index + middle → **sus4** (the "4th")
  - index + middle + ring → **7th**
  - four fingers → **add9**
  - 👍 thumb only → **force MAJOR** (borrow a chord outside the key)
  - 🤙 pinky only → **force MINOR** (e.g. play **Cm** while in **C major**)
- **Hold to sustain** — the chord rings while you hold the shape and stops when
  your hand changes or leaves the frame. A clenched fist = silence.
- **Record** — capture the synth output to a downloadable audio file **and** a
  replayable timeline of chord events. Replay any session in-app.

## Gesture Mapping (calibration)

Open the **Gesture Mapping** panel to see your live hand shapes and bind any
shape to a degree or modifier — this is how you assign degrees **6 and 7**, and
how you customize everything else. Bindings persist in `localStorage`.

## Run

```bash
npm install
npm run dev      # open the printed localhost URL, then press Start and allow camera
npm test         # unit tests for the music-theory + gesture-mapping logic
npm run build    # type-check + production build
```

The camera needs `localhost` or HTTPS (`getUserMedia`). Audio starts on the
**Start** button (browser autoplay policy).

## Architecture

```
src/
  lib/        pure logic: musicTheory, fingerPose, gestureMap, chordEngine, storage, handLandmarker
  hooks/      useHandTracking (camera + detect loop), useSynth, useRecorder
  components/ CameraView, KeySelector, ChordDisplay, GestureMappingPanel, RecorderPanel, StatusBar
  App.tsx     wires poses → chord engine → synth + recorder (with frame debouncing)
```

The pure `lib/musicTheory.ts` and `lib/gestureMap.ts` modules are covered by
Vitest; hand tracking and audio are validated manually with a real camera.

### MediaPipe assets

The WASM runtime and hand model load from a CDN at runtime (see
`src/lib/handLandmarker.ts`). If your network blocks CDNs, download those assets
into `public/` and point `WASM_BASE` / `MODEL_URL` at the local paths.
