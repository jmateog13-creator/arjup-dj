/* ═══════════════════════════════════════════════════════════════
   PITCH-SHIFT WORKLET · Keylock / Master Tempo (v2, §13).

   Pitch-shifter granular de delay-line con dos cabezales solapados
   y ventana triangular. Se inserta tras el BufferSource del deck:
   la reproducción va a `rate` (playbackRate) — que sube el tono —
   y este nodo lo baja por `ratio = 1/rate`, restaurando el tono
   original. Net: cambia el TEMPO sin cambiar el TONO (keylock).

   Param `ratio` (k-rate):
     · 1        → passthrough EXACTO (transparente; keylock OFF o pitch 0)
     · 1/rate   → corrige el tono cuando keylock ON

   Rango útil ±8% (el pitch fader del deck): artefactos mínimos.
═══════════════════════════════════════════════════════════════ */

class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'ratio', defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this.grain = 1536;          // mida del gra (samples) — compromís suavitat/smearing
    this.size = this.grain * 2; // buffer circular
    this.buf = null;            // Float32Array[] per canal
    this.write = 0;
    this.phase = 0;             // 0..1
  }

  _ensure(channels) {
    if (!this.buf || this.buf.length !== channels) {
      this.buf = Array.from({ length: channels }, () => new Float32Array(this.size));
      this.write = 0;
      this.phase = 0;
    }
  }

  _read(b, pos) {
    const len = b.length;
    pos = ((pos % len) + len) % len;
    const i0 = pos | 0;
    const i1 = (i0 + 1) % len;
    const f = pos - i0;
    return b[i0] * (1 - f) + b[i1] * f;
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const channels = output.length;
    const n = output[0].length;
    const ratio = params.ratio.length ? params.ratio[0] : 1;

    // Sense entrada: silenci.
    if (!input || input.length === 0) {
      for (let c = 0; c < channels; c++) output[c].fill(0);
      return true;
    }
    this._ensure(channels);

    const inCh = input.length;              // pot ser mono → duplica a estèreo
    const src = (c) => input[c] || input[inCh - 1] || input[0];

    // Passthrough exacte quan ratio≈1 (keylock OFF o tempo nominal).
    if (Math.abs(ratio - 1) < 1e-4) {
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < channels; c++) {
          const s = src(c)[i];
          this.buf[c][this.write] = s;          // manté continuïtat del gra
          output[c][i] = s;
        }
        this.write = (this.write + 1) % this.size;
      }
      return true;
    }

    const grain = this.grain;
    const step = (1 - ratio) / grain;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < channels; c++) {
        this.buf[c][this.write] = src(c)[i];
      }
      this.phase += step;
      if (this.phase >= 1) this.phase -= 1;
      else if (this.phase < 0) this.phase += 1;

      const p0 = this.phase;
      const p1 = p0 < 0.5 ? p0 + 0.5 : p0 - 0.5;
      const d0 = p0 * grain;
      const d1 = p1 * grain;
      const w0 = 1 - Math.abs(2 * p0 - 1);   // finestra triangular
      const w1 = 1 - Math.abs(2 * p1 - 1);
      for (let c = 0; c < channels; c++) {
        const b = this.buf[c];
        output[c][i] = this._read(b, this.write - d0) * w0 +
                       this._read(b, this.write - d1) * w1;
      }
      this.write = (this.write + 1) % this.size;
    }
    return true;
  }
}

registerProcessor('pitch-shift', PitchShiftProcessor);
