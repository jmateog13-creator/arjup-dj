/* ═══════════════════════════════════════════════════════════════
   RECORDER WORKLET · Captura PCM del màster (v2, §13).

   Copia l'entrada (masterGain) a blocs Float32 i els envia al fil
   principal, que els acumula i codifica un WAV sense pèrdues.
   Acumula ~8192 samples abans de postar per reduir missatgeria.
   Control per port: 'start' | 'stop'.
═══════════════════════════════════════════════════════════════ */

const FLUSH = 8192;

class PCMRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.l = new Float32Array(FLUSH);
    this.r = new Float32Array(FLUSH);
    this.fill = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.recording = true; this.fill = 0; }
      else if (e.data === 'stop') { this._flush(); this.recording = false; }
    };
  }

  _flush() {
    if (this.fill === 0) return;
    this.port.postMessage({
      l: this.l.slice(0, this.fill),
      r: this.r.slice(0, this.fill),
    });
    this.fill = 0;
  }

  process(inputs) {
    if (!this.recording) return true;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch0 = input[0];
    const ch1 = input[1] || input[0];
    const n = ch0.length;
    for (let i = 0; i < n; i++) {
      this.l[this.fill] = ch0[i];
      this.r[this.fill] = ch1[i];
      this.fill++;
      if (this.fill >= FLUSH) this._flush();
    }
    return true;
  }
}

registerProcessor('pcm-recorder', PCMRecorderProcessor);
