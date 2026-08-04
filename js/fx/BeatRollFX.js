/* BEAT ROLL · Captura el último tramo del grid y lo repite (§5).
   Owner: FX-SAMPLER. Parámetro principal: tamaño ⅛ ¼ ½ 1 beat.

   Implementación: lazo delay+feedback≈1 con puerta de entrada —
   la entrada alimenta el lazo solo durante 1 ciclo (captura) y
   después se cierra: el tramo capturado se repite limpio. */

const SIZE_STEPS = [0.125, 0.25, 0.5, 1];
const SMOOTH = 0.008;

export class BeatRollFX {
  constructor(ctx) {
    this.ctx = ctx;
    this.id = 'beatroll';
    this.name = 'Beat Roll';
    this._bpm = 120;
    this._size = 0.25;
    this._wet = 1;
    this._running = false;

    this._dry = ctx.createGain();
    this._wetG = ctx.createGain();
    this._gate = ctx.createGain();       // puerta de captura
    this._gate.gain.value = 0;
    this._delay = ctx.createDelay(4);
    this._fb = ctx.createGain();
    this._fb.gain.value = 0.995;

    this._gate.connect(this._delay);
    this._delay.connect(this._fb);
    this._fb.connect(this._delay);
    this._delay.connect(this._wetG);
  }

  connect(input, output) {
    this._input = input;
    input.connect(this._dry);
    input.connect(this._gate);
    this._dry.connect(output);
    this._wetG.connect(output);
  }

  setWet(v) {
    this._wet = v;
    if (this._running) this._applyMix();
  }

  _applyMix() {
    const t = this.ctx.currentTime;
    // roll clásico: el wet SUSTITUYE al dry proporcionalmente
    this._wetG.gain.setTargetAtTime(this._wet, t, SMOOTH);
    this._dry.gain.setTargetAtTime(1 - this._wet, t, SMOOTH);
  }

  /** v 0..1 → ⅛ ¼ ½ 1 beat */
  setParam(v) {
    this._size = SIZE_STEPS[Math.min(SIZE_STEPS.length - 1, Math.floor(v * SIZE_STEPS.length))];
    if (this._running) this._recapture();
  }

  setBPM(bpm) { this._bpm = bpm; }

  _loopLen() { return Math.min(4, this._size * 60 / this._bpm); }

  _recapture() {
    const t = this.ctx.currentTime;
    const len = this._loopLen();
    this._delay.delayTime.setValueAtTime(len, t);
    // abre la puerta exactamente 1 ciclo para capturar el tramo
    this._gate.gain.cancelScheduledValues(t);
    this._gate.gain.setValueAtTime(1, t);
    this._gate.gain.setValueAtTime(0, t + len);
  }

  start() {
    this._running = true;
    this._recapture();
    this._applyMix();
  }

  stop() {
    this._running = false;
    const t = this.ctx.currentTime;
    this._gate.gain.cancelScheduledValues(t);
    this._gate.gain.setValueAtTime(0, t);
    this._fb.gain.setTargetAtTime(0, t, 0.03);
    this._wetG.gain.setTargetAtTime(0, t, SMOOTH);
    this._dry.gain.setTargetAtTime(1, t, SMOOTH);
  }

  dispose() {
    for (const n of [this._dry, this._wetG, this._gate, this._delay, this._fb]) {
      try { n.disconnect(); } catch { /* noop */ }
    }
    try { this._input?.disconnect(this._dry); } catch { /* noop */ }
    try { this._input?.disconnect(this._gate); } catch { /* noop */ }
  }
}

export default BeatRollFX;
