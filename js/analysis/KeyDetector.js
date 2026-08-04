/* ═══════════════════════════════════════════════════════════════
   KEY DETECTOR · Detecció de tonalitat real (v2, §13).

   Pipeline: mono → STFT (FFT radix-2, finestra Hann) → chromagram
   de 12 classes (bins 65–2000 Hz plegats a pitch-class) → correlació
   amb els perfils Krumhansl-Schmuckler (major/menor) rotats a les 12
   tonalitats → millor tonalitat + notació Camelot (mescla harmònica).

   API estàtica (offline, troços amb yield cooperatiu):
     KeyDetector.detect(buffer) → { key:'Am', camelot:'8A', confidence }
     KeyDetector.camelotOf('Am') → '8A'   (per a pistes bundled)
═══════════════════════════════════════════════════════════════ */

const FFT_SIZE = 4096;
const HOP = 2048;
const F_MIN = 65;     // ~C2
const F_MAX = 2000;   // ~B6
const YIELD_EVERY = 40;

const NOTE_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Perfils Krumhansl-Kessler
const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Roda Camelot: pitch-class (C=0) → codi. B = majors, A = menors.
const CAMELOT_MAJ = { 0: '8B', 1: '3B', 2: '10B', 3: '5B', 4: '12B', 5: '7B', 6: '2B', 7: '9B', 8: '4B', 9: '11B', 10: '6B', 11: '1B' };
const CAMELOT_MIN = { 0: '5A', 1: '12A', 2: '7A', 3: '2A', 4: '9A', 5: '4A', 6: '11A', 7: '6A', 8: '1A', 9: '8A', 10: '3A', 11: '10A' };

const yieldToMain = () => new Promise((r) => setTimeout(r, 0));

/* ─── FFT radix-2 iterativa (Cooley-Tukey) ─────────────────── */

function makeFFT(N) {
  const cos = new Float32Array(N / 2);
  const sin = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    cos[i] = Math.cos(-2 * Math.PI * i / N);
    sin[i] = Math.sin(-2 * Math.PI * i / N);
  }
  const rev = new Uint32Array(N);
  const bits = Math.log2(N);
  for (let i = 0; i < N; i++) {
    let x = i, r = 0;
    for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  // re/im in-place; retorna magnituds al primer N/2
  return (re, im) => {
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const half = len >> 1;
      const stride = N / len;
      for (let i = 0; i < N; i += len) {
        for (let k = 0, idx = 0; k < half; k++, idx += stride) {
          const cr = cos[idx], ci = sin[idx];
          const a = i + k, b = a + half;
          const tr = re[b] * cr - im[b] * ci;
          const ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  };
}

function pearson(a, b) {
  let ma = 0, mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
  ma /= 12; mb /= 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 1e-9 ? num / den : 0;
}

export class KeyDetector {
  /**
   * @param {AudioBuffer} buffer
   * @returns {Promise<{key:string, camelot:string, confidence:number}>}
   */
  static async detect(buffer) {
    const sr = buffer.sampleRate;
    if (!buffer.length || buffer.duration < 2) return { key: '—', camelot: '—', confidence: 0 };

    // mono
    const chans = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
    const invCh = 1 / chans.length;

    // finestra Hann + mapa bin→pitchClass
    const N = FFT_SIZE;
    const hann = new Float32Array(N);
    for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    const binPC = new Int8Array(N / 2);
    for (let k = 0; k < N / 2; k++) {
      const f = k * sr / N;
      if (f < F_MIN || f > F_MAX) { binPC[k] = -1; continue; }
      const midi = Math.round(69 + 12 * Math.log2(f / 440));
      binPC[k] = ((midi % 12) + 12) % 12;
    }

    const fft = makeFFT(N);
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    const chroma = new Float64Array(12);
    const len = buffer.length;
    let frame = 0;

    for (let start = 0; start + N <= len; start += HOP) {
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let c = 0; c < chans.length; c++) s += chans[c][start + i];
        re[i] = s * invCh * hann[i];
        im[i] = 0;
      }
      fft(re, im);
      for (let k = 1; k < N / 2; k++) {
        const pc = binPC[k];
        if (pc < 0) continue;
        chroma[pc] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      }
      if (++frame % YIELD_EVERY === 0) await yieldToMain();
    }

    // normalitza el chroma
    let max = 1e-9;
    for (let i = 0; i < 12; i++) if (chroma[i] > max) max = chroma[i];
    const chN = new Float64Array(12);
    for (let i = 0; i < 12; i++) chN[i] = chroma[i] / max;

    // correlació amb els 24 perfils (12 majors + 12 menors)
    let best = { score: -2, pc: 0, minor: false };
    let second = -2;
    const rot = new Float64Array(12);
    for (let t = 0; t < 12; t++) {
      for (let i = 0; i < 12; i++) rot[i] = MAJ[(i - t + 12) % 12];
      let sc = pearson(chN, rot);
      if (sc > best.score) { second = best.score; best = { score: sc, pc: t, minor: false }; }
      else if (sc > second) second = sc;
      for (let i = 0; i < 12; i++) rot[i] = MIN[(i - t + 12) % 12];
      sc = pearson(chN, rot);
      if (sc > best.score) { second = best.score; best = { score: sc, pc: t, minor: true }; }
      else if (sc > second) second = sc;
    }

    const key = best.minor ? `${NOTE_SHARP[best.pc]}m` : NOTE_SHARP[best.pc];
    const camelot = (best.minor ? CAMELOT_MIN : CAMELOT_MAJ)[best.pc];
    const confidence = Math.max(0, Math.min(1, (best.score - second) * 2 + best.score * 0.3));
    return { key, camelot, confidence: Math.round(confidence * 100) / 100 };
  }

  /** Camelot a partir d'una tonalitat coneguda ('Am', 'C', 'F#m', 'Bbm'…). */
  static camelotOf(keyStr) {
    if (!keyStr || typeof keyStr !== 'string') return '—';
    const m = keyStr.trim().match(/^([A-Ga-g])([#b]?)(m?)$/);
    if (!m) return '—';
    // nota base + alteració → nom amb sostingut
    const FLAT = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
    let root = m[1].toUpperCase() + (m[2] === '#' ? '#' : '');
    if (m[2] === 'b') root = FLAT[m[1].toUpperCase() + 'b'] ?? m[1].toUpperCase();
    const pc = NOTE_SHARP.indexOf(root);
    if (pc < 0) return '—';
    const minor = m[3].toLowerCase() === 'm';
    return (minor ? CAMELOT_MIN : CAMELOT_MAJ)[pc] ?? '—';
  }
}

export default KeyDetector;
