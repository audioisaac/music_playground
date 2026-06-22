# 🎹 Gesture Chord Synth

Play synthesizer chords with two-handed camera gestures in the browser.
Hand tracking runs fully client-side with [MediaPipe](https://ai.google.dev/edge/mediapipe)
`HandLandmarker`; audio is a [Tone.js](https://tonejs.github.io/) polyphonic synth.

## How it works

- **Pick a key** — choose a root note and major/minor.
- **Chord hand** (default: your right hand) — a **whole hand shape** selects the
  scale degree: index → I, peace → ii, three → iii, four → IV, open palm → V,
  shaka (thumb + pinky) → vi, horns (index + pinky) → vii°. A relaxed/closed hand
  is silent. (Shapes are recognized holistically, not by counting fingers, so an
  ambiguous thumb no longer breaks detection.)
- **Modifier hand** (default: left) — stacks **two** independent things:
  - **Shape → extension** ("special chord"):
    - ☝️ index → **sus2** (the "2nd")
    - index + middle → **sus4** (the "4th")
    - index + middle + ring → **7th**
    - four fingers → **add9**
  - **Orientation → quality** (borrow a chord outside the key):
    - point **up** → force **MAJOR**
    - point **down** → force **MINOR** (e.g. play **Cm** while in **C major**)
    - hold **sideways** → diatonic (in key)

  Because shape matching ignores orientation, the two combine — e.g. a 7th shape
  pointing up = a forced-major 7th. (A diatonic extension like a dominant V7 is
  the modifier hand held sideways, since up forces major.)
- **Sound source** (Sound panel):
  - **Synth** — a Tone.js polyphonic synth plays the chord.
  - **My vocals** — a live harmonizer. Your **dry voice is the lead** (you hear
    your actual words) and quieter pitch-shifted **harmony notes** are added on
    top, following the chord (relative harmony: stacked on whatever pitch you sing,
    so the *quality* matches even though the absolute pitch follows you). The dry
    lead is immediate; the harmony notes have some pitch-shift artifact and
    latency, which is inherent to real-time browser pitch-shifting.
- **Sustain trigger** (Sound panel):
  - **Hand up** — the chord rings while you hold the shape, stops when the hand
    leaves/changes. A clenched fist = silence.
  - **While singing** — the chord only sounds while mic input is detected
    (voice-activated gate, with a sensitivity slider).
- **Record** — capture the master output (synth *or* vocals) to a downloadable
  audio file **and** a replayable timeline of chord events. Replay any session in-app.

> 🎧 In vocal or voice-gated modes, use headphones — speaker output can re-enter
> the mic and feed back. The mic is pre-warmed at **Start** (so vocals turn on
> instantly, not after a multi-second `getUserMedia` delay). Best device combo:
> **earphones for output + your computer's built-in mic for input** — this avoids
> feedback *and* the Bluetooth headset-mic profile switch (a ~1-3s delay that
> recurs whenever the mic engages if the browser uses the Bluetooth mic).

## Gesture Mapping (calibration)

Recognition matches your hand against saved shape templates. The app ships with
built-in templates so it works immediately, but hands vary — open the **Gesture
Mapping** panel, hold a shape in front of the camera, and press **Recapture** to
teach any gesture to your own hand (or **reset** it to the built-in shape).
Templates persist in `localStorage`.

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
  lib/        pure logic: musicTheory, handShape, defaultTemplates, gestureMap, chordEngine, storage, handLandmarker
  hooks/      useHandTracking (camera + detect loop), useInstrument (synth + vocal harmonizer + mic), useRecorder
  components/ CameraView, KeySelector, ChordDisplay, GestureMappingPanel, RecorderPanel, StatusBar
  App.tsx     wires poses → chord engine → synth + recorder (with frame debouncing)
```

The pure `lib/musicTheory.ts` and `lib/gestureMap.ts` modules are covered by
Vitest; hand tracking and audio are validated manually with a real camera.

### MediaPipe assets

The WASM runtime and hand model load from a CDN at runtime (see
`src/lib/handLandmarker.ts`). If your network blocks CDNs, download those assets
into `public/` and point `WASM_BASE` / `MODEL_URL` at the local paths.
