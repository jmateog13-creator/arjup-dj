/**
 * BPMDetector — detección de BPM y firstBeat sobre AudioBuffer decodificado.
 * Contrato §4: onset envelope (paso-banda 60–130 Hz, RMS 512, half-wave diff),
 * autocorrelación 70–180 BPM, interpolación parabólica sub-BPM,
 * firstBeat = fase que maximiza correlación tren-de-impulsos ↔ envelope.
 *
 * Corre en el hilo principal troceado con `await` cooperativo (pistas ≤5 min).
 * Uso: const { bpm, firstBeat, confidence } = await BPMDetector.detect(buffer);
 */

const HOP = 512;              // samples por ventana RMS
const BPM_MIN = 70;
const BPM_MAX = 180;
const YIELD_EVERY = 262144;   // samples procesados entre yields cooperativos

function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Coeficientes biquad RBJ (Audio EQ Cookbook). */
function biquadCoeffs(type, fc, sampleRate, Q = Math.SQRT1_2) {
  const w0 = 2 * Math.PI * (fc / sampleRate);
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const alpha = sinw / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') {
    b0 = (1 - cosw) / 2; b1 = 1 - cosw; b2 = (1 - cosw) / 2;
  } else { // highpass
    b0 = (1 + cosw) / 2; b1 = -(1 + cosw); b2 = (1 + cosw) / 2;
  }
  a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
  return {
    b0: b0 / a0, b1: b1 / a0, b2: b2 / a0,
    a1: a1 / a0, a2: a2 / a0,
  };
}

/** Estado streaming de un biquad (Direct Form II transposed). */
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

export class BPMDetector {
  /**
   * @param {AudioBuffer} buffer
   * @returns {Promise<{ bpm:number, firstBeat:number, confidence:number }>}
   */
  static async detect(buffer) {
    const sr = buffer.sampleRate;
    const n = buffer.length;
    if (!n || buffer.duration < 2) {
      return { bpm: 0, firstBeat: 0, confidence: 0 };
    }

    // ── 1. Onset envelope: mono → BP 60–130 Hz → RMS(512) → HWR diff ──────
    const chans = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
    const invCh = 1 / chans.length;

    const hp = makeBiquad(biquadCoeffs('highpass', 60, sr));
    const lp = makeBiquad(biquadCoeffs('lowpass', 130, sr));

    const numFrames = Math.floor(n / HOP);
    const rms = new Float32Array(numFrames);

    let processed = 0;
    for (let f = 0; f < numFrames; f++) {
      const base = f * HOP;
      let acc = 0;
      for (let i = 0; i < HOP; i++) {
        let s = 0;
        const idx = base + i;
        for (let c = 0; c < chans.length; c++) s += chans[c][idx];
        const y = lp(hp(s * invCh));
        acc += y * y;
      }
      rms[f] = Math.sqrt(acc / HOP);
      processed += HOP;
      if (processed >= YIELD_EVERY) { processed = 0; await yieldToMain(); }
    }

    // Half-wave rectified first difference → envelope de onsets.
    const env = new Float32Array(numFrames);
    for (let f = 1; f < numFrames; f++) {
      const d = rms[f] - rms[f - 1];
      env[f] = d > 0 ? d : 0;
    }

    // Quita media y normaliza (autocorrelación más estable).
    let mean = 0;
    for (let f = 0; f < numFrames; f++) mean += env[f];
    mean /= numFrames;
    let maxAbs = 1e-12;
    for (let f = 0; f < numFrames; f++) {
      env[f] -= mean;
      const a = Math.abs(env[f]);
      if (a > maxAbs) maxAbs = a;
    }
    for (let f = 0; f < numFrames; f++) env[f] /= maxAbs;

    await yieldToMain();

    // ── 2. Autocorrelación en lags equivalentes a 70–180 BPM ──────────────
    const envRate = sr / HOP;                              // frames/s (~86 Hz)
    const lagMin = Math.max(2, Math.floor((60 / BPM_MAX) * envRate));
    const lagMax = Math.min(numFrames - 2, Math.ceil((60 / BPM_MIN) * envRate));
    if (lagMax <= lagMin + 2) return { bpm: 0, firstBeat: 0, confidence: 0 };

    // Necesitamos también ac(2·lag) para el score armónico.
    const acLen = Math.min(numFrames - 1, lagMax * 2 + 2);
    const ac = new Float32Array(acLen + 1);
    let e0 = 0;
    for (let f = 0; f < numFrames; f++) e0 += env[f] * env[f];
    e0 = Math.max(e0, 1e-12);
    for (let lag = 1; lag <= acLen; lag++) {
      let s = 0;
      const lim = numFrames - lag;
      for (let f = 0; f < lim; f++) s += env[f] * env[f + lag];
      ac[lag] = (s / lim) * (numFrames / e0);              // normalizado ~[−1,1]
      if ((lag & 15) === 0) await Promise.resolve();
      if ((lag & 63) === 0) await yieldToMain();
    }

    // Score con refuerzo del armónico doble (mitiga errores de octava).
    let bestLag = lagMin, bestScore = -Infinity;
    let scoreSum = 0, scoreCount = 0;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let score = ac[lag];
      const dbl = lag * 2;
      if (dbl <= acLen) score += 0.5 * ac[dbl];
      scoreSum += score; scoreCount++;
      if (score > bestScore) { bestScore = score; bestLag = lag; }
    }

    // ── 3. Interpolación parabólica sub-BPM sobre la autocorrelación cruda ─
    let lagRefined = bestLag;
    if (bestLag > 1 && bestLag < acLen) {
      const ym1 = ac[bestLag - 1], y0 = ac[bestLag], yp1 = ac[bestLag + 1];
      const denom = ym1 - 2 * y0 + yp1;
      if (Math.abs(denom) > 1e-12) {
        const delta = 0.5 * (ym1 - yp1) / denom;
        if (Math.abs(delta) < 1) lagRefined = bestLag + delta;
      }
    }

    let bpm = (60 * envRate) / lagRefined;
    while (bpm < BPM_MIN) bpm *= 2;
    while (bpm > BPM_MAX) bpm /= 2;
    bpm = Math.round(bpm * 100) / 100;

    // Confianza: prominencia del pico frente a la media del rango, 0..1.
    const scoreMean = scoreSum / Math.max(1, scoreCount);
    const confidence = Math.max(0, Math.min(1,
      (bestScore - scoreMean) / (Math.abs(bestScore) + 1e-12)));

    await yieldToMain();

    // ── 4. firstBeat: fase del tren de impulsos que maximiza la correlación ─
    const periodFrames = (60 / bpm) * envRate;             // frames por beat
    const phaseSteps = Math.max(8, Math.floor(periodFrames));
    const phaseScore = new Float32Array(phaseSteps);
    // Solo los primeros ~30 s bastan y ancla el beat al inicio de la pista.
    const scanFrames = Math.min(numFrames, Math.floor(30 * envRate));
    for (let p = 0; p < phaseSteps; p++) {
      const phi = (p / phaseSteps) * periodFrames;
      let s = 0, count = 0;
      for (let t = phi; t < scanFrames - 1; t += periodFrames) {
        const i = Math.floor(t);
        const frac = t - i;
        s += env[i] * (1 - frac) + env[i + 1] * frac;      // lectura interpolada
        count++;
      }
      phaseScore[p] = count ? s / count : 0;
    }

    let bestP = 0;
    for (let p = 1; p < phaseSteps; p++) {
      if (phaseScore[p] > phaseScore[bestP]) bestP = p;
    }
    // Refinado parabólico circular de la fase.
    const pm1 = phaseScore[(bestP - 1 + phaseSteps) % phaseSteps];
    const p0 = phaseScore[bestP];
    const pp1 = phaseScore[(bestP + 1) % phaseSteps];
    let pRefined = bestP;
    const pd = pm1 - 2 * p0 + pp1;
    if (Math.abs(pd) > 1e-12) {
      const delta = 0.5 * (pm1 - pp1) / pd;
      if (Math.abs(delta) < 1) pRefined = bestP + delta;
    }

    // Frames → segundos; +HOP/2 compensa el centrado de la ventana RMS.
    const phiFrames = (pRefined / phaseSteps) * periodFrames;
    let firstBeat = (phiFrames * HOP + HOP / 2) / sr;
    const beatDur = 60 / bpm;
    firstBeat = ((firstBeat % beatDur) + beatDur) % beatDur;
    firstBeat = Math.round(firstBeat * 10000) / 10000;

    return { bpm, firstBeat, confidence: Math.round(confidence * 100) / 100 };
  }
}

export default BPMDetector;
