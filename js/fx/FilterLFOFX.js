/* FILTER LFO · Lowpass barrido por LFO sincronizado a BPM (§5).
   Owner: FX-SAMPLER. Parámetro principal: rate ½ 1 2 bars. */

const BAR_STEPS = [0.5, 1, 2];
const SMOOTH = 0.02;
const F_BASE = 900;      // centro del barrido (Hz)
const F_DEPTH = 750;     // ±depth alrededor del centro

export class FilterLFOFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = 'filterlfo';
    this.name = 'Filter LFO';
    this._bpm = 120;
    this._bars = 1;

    this._dry = ctx.createGain();
    this._wetG = ctx.createGain();
    this._filter = ctx.createBiquadFilter();
    this._filter.type = 'lowpass';
    this._filter.frequency.value = F_BASE;
    this._filter.Q.value = 4;

    this._lfo = ctx.createOscillator();
    this._lfo.type = 'sine';
    this._depth = ctx.createGain();
    this._depth.gain.value = F_DEPTH;
    this._lfo.connect(this._depth);
    this._depth.connect(this._filter.frequency);

    this._filter.connect(this._wetG);
    this.setWet(0.7);
    this._applyRate();
  }

  connect(input, output) {
    this._input = input;
    input.connect(this._dry);
    input.connect(this._filter);
    this._dry.connect(output);
    this._wetG.connect(output);
  }

  setWet(v) {
    const t = this.ctx.currentTime;
    this._wetG.gain.setTargetAtTime(v, t, SMOOTH);
    this._dry.gain.setTargetAtTime(1 - v, t, SMOOTH);
  }

  /** v 0..1 → ½ 1 2 compases por ciclo */
  setParam(v) {
    this._bars = BAR_STEPS[Math.min(BAR_STEPS.length - 1, Math.floor(v * BAR_STEPS.length))];
    this._applyRate();
  }

  setBPM(bpm) { this._bpm = bpm; this._applyRate(); }

  _applyRate() {
    // 1 ciclo de LFO = bars compases de 4 beats
    const hz = this._bpm / 60 / (4 * this._bars);
    this._lfo.frequency.setTargetAtTime(hz, this.ctx.currentTime, SMOOTH);
  }

  start() { try { this._lfo.start(); } catch { /* ya arrancado */ } }
  stop() { /* el dispose corta */ }

  dispose() {
    try { this._lfo.stop(); } catch { /* noop */ }
    for (const n of [this._dry, this._wetG, this._filter, this._lfo, this._depth]) {
      try { n.disconnect(); } catch { /* noop */ }
    }
    try { this._input?.disconnect(this._dry); } catch { /* noop */ }
    try { this._input?.disconnect(this._filter); } catch { /* noop */ }
  }
}

export default FilterLFOFX;
