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
  ambiguous thumb no longer breaks detection.) **Rotate** this hand to **invert**
  the triad: tilt it **away from your body** → 3rd in the bass (1st inversion, e.g.
  **C → C/E**); **toward your body** → 5th in the bass (2nd inversion, **C/G**);
  neutral → root position. (Forward/back tilt is read from landmark depth, the
  noisiest axis, so it uses a generous deadzone.)
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
  - **Harmonize** — a real-time **vocal harmonizer** (Antares Harmony Engine style):
    you hear **your own voice plus in-key harmony voices** that follow the gesture
    chord, generated live from your singing (no samples). The hard part — making
    shifted voices sound natural instead of chipmunky — is solved by a hand-written
    **formant-preserving phase-vocoder AudioWorklet** (`public/formant-shifter-worklet.js`):
    it estimates the spectral envelope (formants) via a cepstrum, shifts only the
    excitation, then re-applies the original envelope. Harmony notes are chosen by
    `src/lib/harmonyVoicing.ts` (each voice snaps to a chord tone above the sung
    note) after detecting your pitch (`src/lib/pitch.ts`). If the worklet fails to
    load, voices fall back to `Tone.PitchShift` (works, but not formant-corrected).
    🎧 Use headphones — your live voice is output, so speakers can feed back.
- **Voice Lab** (panel) — a staged diagnostic for the vocal pipeline, independent
  of gestures/chords, to prove the basics in order: **(1) Capture** — record 3s of
  your mic to a buffer (with a live level meter); **(2) Play original** — hear that
  recording back, unmodified; **(3) Play shifted** — hear it pitch-shifted with a
  −12…+12 semitone slider (drag it mid-playback to bend the pitch). Shifting uses
  `Tone.PitchShift`, which is **time-preserving** — the pitch changes but the
  tempo/length stay the same (no chipmunk). Two separate play buttons keep each
  capability testable on its own. Works on speakers (playback only starts after
  recording finishes, so there's no live loop).
- **Sustain trigger** (Sound panel):
  - **Hand up** — the chord rings while you hold the shape, stops when the hand
    leaves/changes. A clenched fist = silence.
  - **While singing** — the chord only sounds while mic input is detected
    (voice-activated gate, with a sensitivity slider).
- **Motion control** (MiMU-style expression) — hold a chord shape and *move* the
  chord hand to shape the sound, without changing the chord (recognition ignores
  position/size/rotation, so those drive expression instead): hand **height →
  volume**, **distance → brightness** (low-pass filter), **tilt → pitch bend**,
  **left/right → reverb**. Toggle the whole thing and each axis in the Motion panel.
- **Audio devices** — pick your **input** (mic) and **output** (speaker/earphones)
  in the Sound panel. Output selection needs a Chromium browser (`setSinkId`).
- **Record** — capture the post-FX master output (synth *or* vocals, including
  motion expression) to a downloadable audio file **and** a replayable timeline of
  chord events. Replay any session in-app.

> 🎧 **Use headphones for Harmonize.** The harmonizer outputs your live voice (the
> lead) plus the harmonies, so on speakers the mic can re-enter and feed back. The
> app requests the browser's **echo cancellation**, and the mic is pre-warmed at
> **Start** (so harmonies turn on instantly, not after a multi-second `getUserMedia`
> delay). On Bluetooth earbuds, using their *mic* forces the low-quality headset
> profile (a ~1-3s switch); prefer the built-in mic for input.
>
> The harmonizer's pitch shifting needs an **AudioWorklet**. If the browser console
> shows a `formant-shifter-worklet.js` load error, harmonies fall back to a
> (non-formant) `Tone.PitchShift` — paste that error in and it can be fixed.

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
  lib/        pure logic: musicTheory, handShape, defaultTemplates, gestureMap, chordEngine, harmonyVoicing, fft, pitch, storage, handLandmarker
  hooks/      useHandTracking (camera + detect loop), useInstrument (synth + harmonizer + mic), useRecorder
  public/     formant-shifter-worklet.js (formant-preserving phase-vocoder pitch shifter)
  components/ CameraView, KeySelector, ChordDisplay, GestureMappingPanel, RecorderPanel, StatusBar
  App.tsx     wires poses → chord engine → synth + recorder (with frame debouncing)
```

The pure `lib/musicTheory.ts` and `lib/gestureMap.ts` modules are covered by
Vitest; hand tracking and audio are validated manually with a real camera.

### MediaPipe assets

The WASM runtime and hand model load from a CDN at runtime (see
`src/lib/handLandmarker.ts`). If your network blocks CDNs, download those assets
into `public/` and point `WASM_BASE` / `MODEL_URL` at the local paths.
