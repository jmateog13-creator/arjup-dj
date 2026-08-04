/* FLANGER · Delay corto (0.5–5 ms) modulado por LFO + feedback (§5).
   Owner: FX-SAMPLER. Parámetro principal: rate del LFO. */

const SMOOTH = 0.02;

export class FlangerFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = 'flanger';
    this.name = 'Flanger';

    this._dry = ctx.createGain();
    this._wetG = ctx.createGain();
    this._delay = ctx.createDelay(0.05);
    this._delay.delayTime.value = 0.00275;      // centro del barrido
    this._fb = ctx.createGain();
    this._fb.gain.value = 0.55;

    this._lfo = ctx.createOscillator();
    this._lfo.type = 'sine';
    this._lfo.frequency.value = 0.4;
    this._depth = ctx.createGain();
    this._depth.gain.value = 0.00225;            // ±2.25 ms → 0.5–5 ms
    this._lfo.connect(this._depth);
    this._depth.connect(this._delay.delayTime);

    this._delay.connect(this._wetG);
    this._delay.connect(this._fb);
    this._fb.connect(this._delay);

    this.setWet(0.5);
  }

  connect(input, output) {
    this._input = input;
    input.connect(this._dry);
    input.connect(this._delay);
    this._dry.connect(output);
    this._wetG.connect(output);
  }

  setWet(v) {
    const t = this.ctx.currentTime;
    this._wetG.gain.setTargetAtTime(v * 0.85, t, SMOOTH);
    this._dry.gain.setTargetAtTime(1 - v * 0.3, t, SMOOTH);
  }

  /** v 0..1 → rate LFO 0.05..4 Hz (exponencial) */
  setParam(v) {
    this._lfo.frequency.setTargetAtTime(0.05 * Math.pow(80, v), this.ctx.currentTime, SMOOTH);
  }

  setBPM() { /* el flanger de VDJ no es beat-synced en básico */ }

  start() { try { this._lfo.start(); } catch { /* ya arrancado */ } }
  stop() { this._fb.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); }

  dispose() {
    try { this._lfo.stop(); } catch { /* noop */ }
    for (const n of [this._dry, this._wetG, this._delay, this._fb, this._lfo, this._depth]) {
      try { n.disconnect(); } catch { /* noop */ }
    }
    try { this._input?.disconnect(this._dry); } catch { /* noop */ }
    try { this._input?.disconnect(this._delay); } catch { /* noop */ }
  }
}

export default FlangerFX;
