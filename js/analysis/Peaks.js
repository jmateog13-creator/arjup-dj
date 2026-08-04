/**
 * Peaks — precálculo de picos y bandas para las waveforms (contrato §4).
 *
 * `Peaks.compute(buffer, {ppb, bpm})` →
 * {
 *   overview: Float32Array,      // pares intercalados [min,max] por bucket
 *   overviewLength: number,      // nº de buckets del overview
 *   bands: { low, mid, high },   // Float32Array, energía normalizada 0..1
 *   bandsLength: number,         // nº de buckets de banda
 *   secondsPerBucket: number,    // duración de cada bucket de banda
 *   duration: number,
 *   sampleRate: number,
 * }
 *
 * `ppb` = punts per beat de las bandas cuando se pasa `bpm` (default 8);
 * sin `bpm`, resolución temporal fija de 50 buckets/s. El overview usa
 * siempre OVERVIEW_BUCKETS pares min/max (mini-waveform del DeckPane).
 *
 * Bandas (rhythm wave estilo VDJ):
 *   low  → lowpass 250 Hz   (cuerpo ancho, color de deck)
 *   mid  → HP 250 + LP 3500 (capa media)
 *   high → highpass 3500 Hz (línea fina clara)
 * Biquads RBJ offline en un solo pase streaming, troceado con await cooperativo.
 */

const OVERVIEW_BUCKETS = 1024;
const YIELD_EVERY = 262144;

function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function biquadCoeffs(type, fc, sampleRate, Q = Math.SQRT1_2) {
  const w0 = 2 * Math.PI * (fc / sampleRate);
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = sinw / (2 * Q);
  let b0, b1, b2;
  if (type === 'lowpass') {
    b0 = (1 - cosw) / 2; b1 = 1 - cosw; b2 = (1 - cosw) / 2;
  } else { // highpass
    b0 = (1 + cosw) / 2; b1 = -(1 + cosw); b2 = (1 + cosw) / 2;
  }
  const a0 = 1 + alpha;
  return {
    b0: b0 / a0, b1: b1 / a0, b2: b2 / a0,
    a1: (-2 * cosw) / a0, a2: (1 - alpha) / a0,
  };
}

function makeBiquad(coeffs) {
  let z1 = 0, z2 = 0;
  const { b0, b1, b2, a1, a2 } = coeffs;
  return (x) => {
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  };
}

function normalizeInPlace(arr) {
  let max = 1e-12;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  const inv = 1 / max;
  for (let i = 0; i < arr.length; i++) arr[i] *= inv;
}

export class Peaks {
  /**
   * @param {AudioBuffer} buffer
   * @param {{ ppb?:number, bpm?:number }} [opts]
   */
  static async compute(buffer, opts = {}) {
    const sr = buffer.sampleRate;
    const n = buffer.length;
    const duration = buffer.duration;

    const chans = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
    const invCh = 1 / Math.max(1, chans.length);

    // Resolución de bandas: por beat si hay bpm, si no 50 buckets/s.
    let secondsPerBucket;
    if (opts.bpm && opts.bpm > 0) {
      const ppb = opts.ppb && opts.ppb > 0 ? opts.ppb : 8;
      secondsPerBucket = (60 / opts.bpm) / ppb;
    } else {
      secondsPerBucket = 1 / 50;
    }
    const bandsLength = Math.max(1, Math.ceil(duration / secondsPerBucket));
    const bandSamples = secondsPerBucket * sr;

    const low = new Float32Array(bandsLength);
    const mid = new Float32Array(bandsLength);
    const high = new Float32Array(bandsLength);
    const bucketCount = new Float32Array(bandsLength);

    const overview = new Float32Array(OVERVIEW_BUCKETS * 2);
    const ovSamples = n / OVERVIEW_BUCKETS;
    for (let i = 0; i < OVERVIEW_BUCKETS; i++) {
      overview[i * 2] = 0;       // min
      overview[i * 2 + 1] = 0;   // max
    }

    const lpLow = makeBiquad(biquadCoeffs('lowpass', 250, sr));
    const hpMid = makeBiquad(biquadCoeffs('highpass', 250, sr));
    const lpMid = makeBiquad(biquadCoeffs('lowpass', 3500, sr));
    const hpHigh = makeBiquad(biquadCoeffs('highpass', 3500, sr));

    let processed = 0;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < chans.length; c++) s += chans[c][i];
      s *= invCh;

      // Overview min/max (señal cruda).
      let ov = Math.floor(i / ovSamples);
      if (ov >= OVERVIEW_BUCKETS) ov = OVERVIEW_BUCKETS - 1;
      if (s < overview[ov * 2]) overview[ov * 2] = s;
      if (s > overview[ov * 2 + 1]) overview[ov * 2 + 1] = s;

      // Bandas (energía).
      let b = Math.floor(i / bandSamples);
      if (b >= bandsLength) b = bandsLength - 1;
      const yl = lpLow(s);
      const ym = lpMid(hpMid(s));
      const yh = hpHigh(s);
      low[b] += yl * yl;
      mid[b] += ym * ym;
      high[b] += yh * yh;
      bucketCount[b]++;

      if (++processed >= YIELD_EVERY) { processed = 0; await yieldToMain(); }
    }

    // RMS por bucket + normalización por banda (contraste visual estable).
    for (let b = 0; b < bandsLength; b++) {
      const cnt = Math.max(1, bucketCount[b]);
      low[b] = Math.sqrt(low[b] / cnt);
      mid[b] = Math.sqrt(mid[b] / cnt);
      high[b] = Math.sqrt(high[b] / cnt);
    }
    normalizeInPlace(low);
    normalizeInPlace(mid);
    normalizeInPlace(high);

    return {
      overview,
      overviewLength: OVERVIEW_BUCKETS,
      bands: { low, mid, high },
      bandsLength,
      secondsPerBucket,
      duration,
      sampleRate: sr,
    };
  }
}

export default Peaks;
