/* ═══════════════════════════════════════════════════════════════
   FX CHAIN · Slot de FX por deck (§5).

   Owner: FX-SAMPLER.
   Insertado entre colorFilter y fader: deck conecta a .input y
   .output. 1 slot activo (como VDJ básico): selector de efecto,
   dry/wet, parámetro principal, ON beat-synced.
   Bypass REAL: cuando OFF la señal va directa input→output y los
   nodos del efecto quedan desconectados (dispose al cambiar).
═══════════════════════════════════════════════════════════════ */

import { EchoFX } from './EchoFX.js';
import { FlangerFX } from './FlangerFX.js';
import { BeatRollFX } from './BeatRollFX.js';
import { FilterLFOFX } from './FilterLFOFX.js';

export const FX_REGISTRY = [
  { id: 'echo',      name: 'Echo',       cls: EchoFX },
  { id: 'flanger',   name: 'Flanger',    cls: FlangerFX },
  { id: 'beatroll',  name: 'Beat Roll',  cls: BeatRollFX },
  { id: 'filterlfo', name: 'Filter LFO', cls: FilterLFOFX },
];

export class FXChain extends EventTarget {
  /** @param {AudioContext} ctx */
  constructor(ctx) {
    super();
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.output);      // bypass por defecto

    this._fx = null;
    this._fxId = FX_REGISTRY[0].id;
    this._on = false;
    this._wet = 0.5;
    this._param = 0.5;
    this._bpm = 120;
  }

  get fxId() { return this._fxId; }
  get on() { return this._on; }
  get wet() { return this._wet; }
  get param() { return this._param; }

  /** Cambia el efecto del slot (si estaba ON, rearma el nuevo). */
  select(fxId) {
    if (fxId === this._fxId) return;
    const wasOn = this._on;
    if (wasOn) this.toggle(false);
    this._fxId = FX_REGISTRY.some((f) => f.id === fxId) ? fxId : this._fxId;
    if (wasOn) this.toggle(true);
    this.dispatchEvent(new CustomEvent('changed'));
  }

  toggle(on = !this._on) {
    on = !!on;
    if (on === this._on) return;
    this._on = on;
    if (on) {
      const entry = FX_REGISTRY.find((f) => f.id === this._fxId);
      this._fx = new entry.cls(this.ctx);
      this._fx.setBPM(this._bpm);
      this._fx.setParam(this._param);
      this._fx.setWet(this._wet);
      // señal: input deja de ir directa; pasa por el FX (que gestiona dry/wet)
      try { this.input.disconnect(this.output); } catch { /* noop */ }
      this._fx.connect(this.input, this.output);
      this._fx.start();
    } else if (this._fx) {
      this._fx.stop();
      this._fx.dispose();
      this._fx = null;
      this.input.connect(this.output);    // bypass real
    }
    this.dispatchEvent(new CustomEvent('changed'));
  }

  setWet(v) {
    this._wet = Math.min(1, Math.max(0, Number(v) || 0));
    this._fx?.setWet(this._wet);
  }

  setParam(v) {
    this._param = Math.min(1, Math.max(0, Number(v) || 0));
    this._fx?.setParam(this._param);
  }

  setBPM(bpm) {
    if (!bpm || !isFinite(bpm)) return;
    this._bpm = bpm;
    this._fx?.setBPM(bpm);
  }

  dispose() {
    if (this._fx) { this._fx.stop(); this._fx.dispose(); this._fx = null; }
    try { this.input.disconnect(); } catch { /* noop */ }
    try { this.output.disconnect(); } catch { /* noop */ }
  }
}

export default FXChain;
