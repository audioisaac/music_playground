// Self-contained formant-preserving pitch-shifter AudioWorklet (no imports, no
// vendored library — written from scratch so addModule can't fail on a parse of
// some big third-party file like the old SoundTouch worklet did).
//
// It's a phase vocoder (Bernsee-style smbPitchShift structure) with an added
// cepstral FORMANT-PRESERVATION step: the spectral envelope (formants) is
// estimated, the excitation is whitened by it, pitch-shifted, then the ORIGINAL
// envelope is re-applied — so shifting up an octave does NOT chipmunk.
//
// One mono voice per node; the harmony note is set via the k-rate `ratio` param
// (target/sung frequency). The FFT here mirrors src/lib/fft.ts (unit-tested).

const FFT_SIZE = 1024;
const OSAMP = 4; // overlap factor
const STEP = FFT_SIZE / OSAMP; // hop size
const HALF = FFT_SIZE / 2;
const LIFTER = 30; // cepstral low-quefrency cutoff (formant smoothness)
const FORMANT_PRESERVE = true; // flip off to get a plain (chipmunky) PV shift
const RATIO_MIN = 0.5;
const RATIO_MAX = 2.6;

// In-place iterative radix-2 FFT (mirror of src/lib/fft.ts).
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k;
        const b = a + (len >> 1);
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

class FormantShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "ratio", defaultValue: 1, automationRate: "k-rate" }];
  }

  constructor() {
    super();
    this.freqPerBin = sampleRate / FFT_SIZE;
    this.expct = (2 * Math.PI * STEP) / FFT_SIZE;
    this.rover = FFT_SIZE - STEP; // inFifoLatency

    this.inFifo = new Float32Array(FFT_SIZE);
    this.outFifo = new Float32Array(FFT_SIZE);
    this.outAccum = new Float32Array(2 * FFT_SIZE);
    this.lastPhase = new Float64Array(HALF + 1);
    this.sumPhase = new Float64Array(HALF + 1);

    this.anaMagn = new Float64Array(HALF + 1);
    this.anaFreq = new Float64Array(HALF + 1);
    this.synMagn = new Float64Array(HALF + 1);
    this.synFreq = new Float64Array(HALF + 1);
    this.env = new Float64Array(HALF + 1);

    this.re = new Float64Array(FFT_SIZE);
    this.im = new Float64Array(FFT_SIZE);
    this.cre = new Float64Array(FFT_SIZE);
    this.cim = new Float64Array(FFT_SIZE);

    this.window = new Float64Array(FFT_SIZE);
    for (let k = 0; k < FFT_SIZE; k++) {
      this.window[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / FFT_SIZE);
    }
  }

  // Cepstral spectral envelope of the analysis magnitudes -> this.env.
  computeEnvelope() {
    const { cre, cim, anaMagn, env } = this;
    for (let k = 0; k <= HALF; k++) {
      cre[k] = Math.log(anaMagn[k] + 1e-6);
      cim[k] = 0;
    }
    for (let k = 1; k < HALF; k++) {
      cre[FFT_SIZE - k] = cre[k]; // mirror (real, even spectrum)
      cim[FFT_SIZE - k] = 0;
    }
    fft(cre, cim, true); // -> real cepstrum in cre
    for (let q = 0; q < FFT_SIZE; q++) {
      if (q >= LIFTER && q <= FFT_SIZE - LIFTER) {
        cre[q] = 0;
        cim[q] = 0;
      } else {
        cim[q] = 0;
      }
    }
    fft(cre, cim, false); // -> smoothed log-magnitude in cre
    for (let k = 0; k <= HALF; k++) env[k] = Math.exp(cre[k]);
  }

  processFrame(ratio) {
    const {
      inFifo, window, re, im, anaMagn, anaFreq, synMagn, synFreq, env,
      lastPhase, sumPhase, outAccum, outFifo,
    } = this;
    const { freqPerBin, expct } = this;

    for (let k = 0; k < FFT_SIZE; k++) {
      re[k] = inFifo[k] * window[k];
      im[k] = 0;
    }
    fft(re, im, false);

    // Analysis: magnitude + true frequency per bin.
    for (let k = 0; k <= HALF; k++) {
      const real = re[k];
      const imag = im[k];
      const magn = 2 * Math.hypot(real, imag);
      const phase = Math.atan2(imag, real);
      let tmp = phase - lastPhase[k];
      lastPhase[k] = phase;
      tmp -= k * expct;
      let qpd = Math.trunc(tmp / Math.PI);
      if (qpd >= 0) qpd += qpd & 1;
      else qpd -= qpd & 1;
      tmp -= Math.PI * qpd;
      tmp = (OSAMP * tmp) / (2 * Math.PI);
      anaMagn[k] = magn;
      anaFreq[k] = k * freqPerBin + tmp * freqPerBin;
    }

    if (FORMANT_PRESERVE) this.computeEnvelope();

    // Synthesis: shift the excitation, keep the envelope fixed.
    for (let k = 0; k <= HALF; k++) {
      synMagn[k] = 0;
      synFreq[k] = 0;
    }
    for (let k = 0; k <= HALF; k++) {
      const index = Math.round(k * ratio);
      if (index <= HALF) {
        const src = FORMANT_PRESERVE ? anaMagn[k] / (env[k] || 1e-6) : anaMagn[k];
        synMagn[index] += src;
        synFreq[index] = anaFreq[k] * ratio;
      }
    }
    if (FORMANT_PRESERVE) {
      for (let k = 0; k <= HALF; k++) synMagn[k] *= env[k];
    }

    // Resynthesis: rebuild phases.
    for (let k = 0; k <= HALF; k++) {
      const magn = synMagn[k];
      let tmp = synFreq[k];
      tmp -= k * freqPerBin;
      tmp /= freqPerBin;
      tmp = (2 * Math.PI * tmp) / OSAMP;
      tmp += k * expct;
      sumPhase[k] += tmp;
      const phase = sumPhase[k];
      re[k] = magn * Math.cos(phase);
      im[k] = magn * Math.sin(phase);
    }
    for (let k = HALF + 1; k < FFT_SIZE; k++) {
      re[k] = 0;
      im[k] = 0;
    }
    fft(re, im, true);

    // Windowed overlap-add.
    const norm = 2 / (HALF * OSAMP);
    for (let k = 0; k < FFT_SIZE; k++) {
      outAccum[k] += window[k] * re[k] * norm;
    }
    for (let k = 0; k < STEP; k++) outFifo[k] = outAccum[k];
    for (let k = 0; k < FFT_SIZE; k++) outAccum[k] = outAccum[k + STEP];
    for (let k = 0; k < FFT_SIZE - STEP; k++) inFifo[k] = inFifo[k + STEP];
  }

  process(inputs, outputs, params) {
    const input = inputs[0] && inputs[0][0];
    const output = outputs[0][0];
    if (!output) return true;
    if (!input) {
      output.fill(0);
      return true;
    }
    let ratio = params.ratio[0];
    if (!(ratio > 0)) ratio = 1;
    ratio = Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio));

    const latency = FFT_SIZE - STEP;
    for (let i = 0; i < input.length; i++) {
      this.inFifo[this.rover] = input[i];
      output[i] = this.outFifo[this.rover - latency];
      this.rover++;
      if (this.rover >= FFT_SIZE) {
        this.rover = latency;
        this.processFrame(ratio);
      }
    }
    return true;
  }
}

registerProcessor("formant-shifter", FormantShifter);
