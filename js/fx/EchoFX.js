/* ECHO · Delay beat-synced con feedback + LP en el lazo (§5).
   Owner: FX-SAMPLER. Parámetro principal: beats ¼ ½ 1. */

const BEAT_STEPS = [0.25, 0.5, 1];
const SMOOTH = 0.02;

export class EchoFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = 'echo';
    this.name = 'Echo';
    this._bpm = 120;
    this._beats = 0.5;

    this._dry = ctx.createGain();
    this._wetG = ctx.createGain();
    this._delay = ctx.createDelay(4);
    this._fb = ctx.createGain();
    this._fb.gain.value = 0.45;
    this._lp = ctx.createBiquadFilter();
    this._lp.type = 'lowpass';
    this._lp.frequency.value = 4500;

    this._delay.connect(this._wetG);
    this._delay.connect(this._fb);
    this._fb.connect(this._lp);
    this._lp.connect(this._delay);

    this.setWet(0.5);
  }

  connect(input, output) {
    this._input = input;
    this._output = output;
    input.connect(this._dry);
    input.connect(this._delay);
    this._dry.connect(output);
    this._wetG.connect(output);
  }

  setWet(v) {
    const t = this.ctx.currentTime;
    this._wetG.gain.setTargetAtTime(v, t, SMOOTH);
    this._dry.gain.setTargetAtTime(1 - v * 0.4, t, SMOOTH);   // dry casi intacto (estilo VDJ)
  }

  /** v 0..1 → ¼ ½ 1 beat */
  setParam(v) {
    this._beats = BEAT_STEPS[Math.min(BEAT_STEPS.length - 1, Math.floor(v * BEAT_STEPS.length))];
    this._applyTime();
  }

  setBPM(bpm) { this._bpm = bpm; this._applyTime(); }

  _applyTime() {
    this._delay.delayTime.setTargetAtTime(
      Math.min(4, this._beats * 60 / this._bpm), this.ctx.currentTime, SMOOTH);
  }

  start() { /* pasivo: suena con la señal */ }
  stop() {
    // corta el feedback para no dejar cola infinita colgando
    this._fb.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  dispose() {
    for (const n of [this._dry, this._wetG, this._delay, this._fb, this._lp]) {
      try { n.disconnect(); } catch { /* noop */ }
    }
    try { this._input?.disconnect(this._dry); } catch { /* noop */ }
    try { this._input?.disconnect(this._delay); } catch { /* noop */ }
  }
}

export default EchoFX;
