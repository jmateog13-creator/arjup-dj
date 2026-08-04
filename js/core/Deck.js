/* ═══════════════════════════════════════════════════════════════
   DECK · Transporte sample-accurate (ARCHITECTURE §3).

   Owner: CORE-AUDIO.
   Routing: BufferSource → trimGain → eqLow → eqMid → eqHigh
            → colorFilter → [FXChain] → faderGain (= .output)
   La posición se lleva CONTABLE: position = posAtPlay +
   (ctx.currentTime − timeAtPlay) · rate. Cada play/pause/seek/
   cambio de rate re-ancla. Las BufferSource son fire-and-forget.

   Eventos: 'loaded' 'play' 'pause' 'position' 'beat'
            'param-changed' {param, value}  (lo consume ConsoleGraph)
═══════════════════════════════════════════════════════════════ */

const SMOOTH = 0.01;
const KILL_DB = -40;
const PITCH_RANGE = 0.08;          // ±8% (VDJ default)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Deck extends EventTarget {
  /**
   * @param {'a'|'b'} id
   * @param {AudioEngine} engine
   * @param {Function|null} FXChainClass owner FX-SAMPLER (opcional)
   */
  constructor(id, engine, FXChainClass = null) {
    super();
    this.id = id;
    this.engine = engine;
    const ctx = engine.ctx;
    this.ctx = ctx;

    this.track = null;             // { title, artist, bpm, key, duration, buffer, peaks, firstBeat }
    this.playing = false;

    // ── Cadena de nodos fija (§2) ──
    this._trim = ctx.createGain();                         // GAIN 0..2
    this._eqLow = ctx.createBiquadFilter();
    this._eqLow.type = 'lowshelf';  this._eqLow.frequency.value = 200;
    this._eqMid = ctx.createBiquadFilter();
    this._eqMid.type = 'peaking';   this._eqMid.frequency.value = 1000; this._eqMid.Q.value = 0.8;
    this._eqHigh = ctx.createBiquadFilter();
    this._eqHigh.type = 'highshelf'; this._eqHigh.frequency.value = 4000;
    this._color = ctx.createBiquadFilter();                // filtro bipolar
    this._color.type = 'lowpass'; this._color.frequency.value = 20000;
    this._fader = ctx.createGain();                        // channel fader
    this.output = this._fader;

    // Keylock (v2): pitch-shift node entre BufferSource y trim.
    // ratio=1 → passthrough transparente; ratio=1/rate → corrige tono.
    this._pitchNode = null;
    this._keylock = false;
    if (engine.worklets?.pitch) {
      try {
        this._pitchNode = new AudioWorkletNode(ctx, 'pitch-shift',
          { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
        this._pitchNode.connect(this._trim);
      } catch { this._pitchNode = null; }
    }

    this._trim.connect(this._eqLow);
    this._eqLow.connect(this._eqMid);
    this._eqMid.connect(this._eqHigh);
    this._eqHigh.connect(this._color);

    // FXChain insertado entre colorFilter y fader (§5); bypass si no existe
    this.fx = null;
    if (FXChainClass) {
      try {
        this.fx = new FXChainClass(ctx);
        this._color.connect(this.fx.input);
        this.fx.output.connect(this._fader);
      } catch { this.fx = null; }
    }
    if (!this.fx) this._color.connect(this._fader);

    // PFL / cue de auriculars (v2): tap pre-fader → cue bus del engine.
    this._pfl = false;
    this._cueSend = ctx.createGain();
    this._cueSend.gain.value = 0;
    const preFader = this.fx ? this.fx.output : this._color;
    preFader.connect(this._cueSend);
    if (engine.cueGain) this._cueSend.connect(engine.cueGain);

    // ── Estado de transporte contable ──
    this._source = null;
    this._posAtPlay = 0;           // segundos de buffer en el último anclaje
    this._timeAtPlay = 0;          // ctx.currentTime del anclaje
    this._pitch = 0;               // −0.08..+0.08
    this._nudgeRate = 0;           // desviación temporal (jog)
    this._nudgeTimer = 0;
    this._lastBeat = -1;

    this._gainVal = 1;
    this._faderVal = 1;
    this._filterVal = 0;
    this._eqDb = { low: 0, mid: 0, high: 0 };
    this._fader.gain.value = 1;
    this._trim.gain.value = 1;

    // ── CUE / hot cues / loop ──
    this.cuePoint = 0;
    this.hotCues = [null, null, null, null];
    this.loop = { active: false, start: 0, end: 0, beats: 0 };

    // eq get/set en dB (contrato MixerPane: deck.eq.low = v)
    const self = this;
    this.eq = {};
    for (const [band, node] of [['low', this._eqLow], ['mid', this._eqMid], ['high', this._eqHigh]]) {
      Object.defineProperty(this.eq, band, {
        enumerable: true,
        get: () => self._eqDb[band],
        set: (v) => {
          v = clamp(Number(v) || 0, KILL_DB, 24);
          self._eqDb[band] = v;
          node.gain.setTargetAtTime(v, self.ctx.currentTime, SMOOTH);
          self._emitParam(band, v);
        },
      });
    }
  }

  /* ─── Parámetros de mezcla ───────────────────────────────── */

  get gain() { return this._gainVal; }
  set gain(v) {
    this._gainVal = clamp(Number(v) || 0, 0, 2);
    this._trim.gain.setTargetAtTime(this._gainVal, this.ctx.currentTime, SMOOTH);
    this._emitParam('gain', this._gainVal);
  }

  get fader() { return this._faderVal; }
  set fader(v) {
    this._faderVal = clamp(Number(v) || 0, 0, 1);
    this._fader.gain.setTargetAtTime(this._faderVal, this.ctx.currentTime, SMOOTH);
    this._emitParam('fader', this._faderVal);
  }

  /** Filtro bipolar −1..+1: negativo = LPF 20k→200, positivo = HPF 20→8k. */
  get filter() { return this._filterVal; }
  set filter(v) {
    v = clamp(Number(v) || 0, -1, 1);
    this._filterVal = v;
    const t = this.ctx.currentTime;
    if (v < -0.02) {
      this._color.type = 'lowpass';
      // exponencial 20 kHz → 200 Hz
      this._color.frequency.setTargetAtTime(20000 * Math.pow(200 / 20000, -v), t, SMOOTH);
    } else if (v > 0.02) {
      this._color.type = 'highpass';
      this._color.frequency.setTargetAtTime(20 * Math.pow(8000 / 20, v), t, SMOOTH);
    } else {
      this._color.type = 'lowpass';
      this._color.frequency.setTargetAtTime(20000, t, SMOOTH);   // transparente
    }
    this._emitParam('filter', v);
  }

  /* ─── Pitch / BPM / beatgrid ─────────────────────────────── */

  get pitch() { return this._pitch; }
  set pitch(v) {
    v = clamp(Number(v) || 0, -PITCH_RANGE, PITCH_RANGE);
    this._reanchor();
    this._pitch = v;
    this._applyRate();
    this.fx?.setBPM?.(this.effectiveBPM || 120);
    this._emitParam('pitch', v);
  }

  get rate() { return (1 + this._pitch) * (1 + this._nudgeRate); }
  get effectiveBPM() { return this.track ? this.track.bpm * (1 + this._pitch) : 0; }

  /* ─── Keylock / Master Tempo (v2) ────────────────────────── */

  get keylockAvailable() { return !!this._pitchNode; }
  get keylock() { return this._keylock; }
  set keylock(v) {
    this._keylock = !!v && !!this._pitchNode;
    this._applyKeylock();
    this._emitParam('keylock', this._keylock ? 1 : 0);
  }

  _applyKeylock() {
    if (!this._pitchNode) return;
    const ratio = this._keylock ? 1 / this.rate : 1;
    this._pitchNode.parameters.get('ratio').setTargetAtTime(ratio, this.ctx.currentTime, 0.02);
  }

  /* ─── PFL / cue de auriculars (v2) ───────────────────────── */

  get pfl() { return this._pfl; }
  set pfl(v) {
    this._pfl = !!v;
    this._cueSend.gain.setTargetAtTime(this._pfl ? 1 : 0, this.ctx.currentTime, SMOOTH);
    this._emitParam('pfl', this._pfl ? 1 : 0);
  }

  /** 0..1 dentro del beat actual según beatgrid. */
  get beatPhase() {
    if (!this.track?.bpm) return 0;
    const spb = 60 / this.track.bpm;
    const rel = (this.position - (this.track.firstBeat || 0)) / spb;
    return rel - Math.floor(rel);
  }

  _beatIndex(pos = this.position) {
    if (!this.track?.bpm) return 0;
    return Math.floor((pos - (this.track.firstBeat || 0)) / (60 / this.track.bpm));
  }

  beatTime(n) {
    return (this.track?.firstBeat || 0) + n * (60 / this.track.bpm);
  }

  /* ─── Posición contable ──────────────────────────────────── */

  get position() {
    if (!this.playing) return this._posAtPlay;
    return this._posAtPlay + (this.ctx.currentTime - this._timeAtPlay) * this._lastRate;
  }

  _reanchor() {
    this._posAtPlay = this.position;
    this._timeAtPlay = this.ctx.currentTime;
  }

  _applyRate() {
    this._lastRate = this.rate;
    if (this._source) {
      this._source.playbackRate.setTargetAtTime(this._lastRate, this.ctx.currentTime, 0.005);
    }
    this._applyKeylock();   // el ratio del keylock depèn del rate
  }

  _lastRate = 1;

  /* ─── Transporte ─────────────────────────────────────────── */

  async load(track) {
    if (!track) return;
    if (!track.buffer && typeof track.ensureBuffer === 'function') {
      await track.ensureBuffer();
    }
    this.pause();
    this.track = track;
    this._posAtPlay = 0;
    this._timeAtPlay = this.ctx.currentTime;
    this.cuePoint = track.firstBeat || 0;
    this.hotCues = [null, null, null, null];
    this.exitLoop();
    this._lastBeat = -1;
    this.fx?.setBPM?.(this.effectiveBPM || 120);
    this._emitParam('trackLoaded', 1);
    this._emitParam('bpm', track.bpm);
    this.dispatchEvent(new CustomEvent('loaded', { detail: { track } }));
  }

  play() {
    if (this.playing || !this.track?.buffer) return;
    if (this._posAtPlay >= this.track.duration - 0.01) this._posAtPlay = 0;
    this._startSource(this._posAtPlay);
    this.playing = true;
    this._timeAtPlay = this.ctx.currentTime;
    this._emitParam('playing', 1);
    this.dispatchEvent(new CustomEvent('play'));
  }

  pause() {
    if (!this.playing) return;
    this._posAtPlay = this.position;
    this.playing = false;
    this._stopSource();
    this._emitParam('playing', 0);
    this.dispatchEvent(new CustomEvent('pause'));
  }

  /** stop = pause + torna al CUE (VDJ). */
  stop() {
    this.pause();
    this.seek(this.cuePoint);
  }

  seek(seconds) {
    if (!this.track) return;
    const pos = clamp(Number(seconds) || 0, 0, this.track.duration);
    if (this.playing) {
      this._stopSource();
      this._posAtPlay = pos;
      this._timeAtPlay = this.ctx.currentTime;
      this._startSource(pos);
    } else {
      this._posAtPlay = pos;
      this._timeAtPlay = this.ctx.currentTime;
    }
    this._emitParam('position', pos);
    this.dispatchEvent(new CustomEvent('position'));
  }

  _startSource(offset) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.track.buffer;
    src.playbackRate.value = this.rate;
    this._lastRate = this.rate;
    src.connect(this._pitchNode ?? this._trim);   // keylock inline si existe
    src.start(0, clamp(offset, 0, this.track.duration));
    src.onended = () => {
      if (this._source === src && this.playing && this.position >= this.track.duration - 0.05) {
        // fin de pista natural
        this.playing = false;
        this._posAtPlay = this.track.duration;
        this._emitParam('playing', 0);
        this.dispatchEvent(new CustomEvent('pause'));
      }
    };
    this._source = src;
  }

  _stopSource() {
    if (!this._source) return;
    const s = this._source;
    this._source = null;
    s.onended = null;
    try { s.stop(); } catch { /* ya parado */ }
    try { s.disconnect(); } catch { /* noop */ }
  }

  /* ─── Nudge (jog / pitch bend) ───────────────────────────── */

  nudge(deltaRate, ms = 120) {
    if (!this.playing) return;
    this._reanchor();
    this._nudgeRate = clamp(Number(deltaRate) || 0, -0.5, 0.5);
    this._applyRate();
    clearTimeout(this._nudgeTimer);
    this._nudgeTimer = setTimeout(() => {
      this._reanchor();
      this._nudgeRate = 0;
      this._applyRate();
    }, ms);
  }

  /* ─── SYNC (§3) ──────────────────────────────────────────── */

  sync() {
    const other = this.engine.decks[this.id === 'a' ? 'b' : 'a'];
    if (!this.track?.bpm || !other?.track?.bpm) return;
    // 1. Igualar effectiveBPM (clamp a ±8%)
    const targetRatio = other.effectiveBPM / this.track.bpm;
    this.pitch = targetRatio - 1;
    // 2. Alinear fase al beatgrid del deck master
    if (this.playing && other.playing) {
      const spb = 60 / this.track.bpm;
      let delta = (other.beatPhase - this.beatPhase);
      if (delta > 0.5) delta -= 1;
      if (delta < -0.5) delta += 1;
      this.seek(this.position + delta * spb);
    }
    this._emitParam('sync', 1);
  }

  /* ─── CUE / Hot cues ─────────────────────────────────────── */

  setCue() {
    if (this.playing) return;
    this.cuePoint = this.position;
    this._emitParam('cuePoint', this.cuePoint);
  }

  gotoCue() {
    if (this.playing) this.pause();
    this.seek(this.cuePoint);
  }

  setHotCue(i) {
    if (i < 0 || i > 3) return;
    this.hotCues[i] = this.position;
    this._emitParam('hotCueCount', this.hotCues.filter((c) => c != null).length);
  }

  jumpHotCue(i) {
    const t = this.hotCues[i];
    if (t == null) return;
    this.seek(t);
    if (!this.playing) this.play();
  }

  clearHotCue(i) {
    if (i < 0 || i > 3) return;
    this.hotCues[i] = null;
    this._emitParam('hotCueCount', this.hotCues.filter((c) => c != null).length);
  }

  /* ─── Loop por beatgrid (§3: por reloj, en _frame) ───────── */

  setLoop(beats) {
    if (!this.track?.bpm) return;
    const spb = 60 / this.track.bpm;
    const startBeat = this._beatIndex();
    this.loop = {
      active: true,
      beats,
      start: this.beatTime(startBeat),
      end: this.beatTime(startBeat) + beats * spb,
    };
    this._emitParam('loopActive', 1);
    this._emitParam('loopBeats', beats);
  }

  exitLoop() {
    if (!this.loop.active && this.loop.beats === 0) return;
    this.loop = { active: false, start: 0, end: 0, beats: 0 };
    this._emitParam('loopActive', 0);
  }

  /* ─── Frame del rAF compartido (lo llama AudioEngine) ────── */

  _frame() {
    if (!this.playing || !this.track) return;
    const pos = this.position;
    // loop por reloj
    if (this.loop.active && pos >= this.loop.end) {
      this.seek(this.loop.start + (pos - this.loop.end) % (this.loop.end - this.loop.start));
    }
    // evento 'beat' del grid
    const b = this._beatIndex(pos);
    if (b !== this._lastBeat) {
      this._lastBeat = b;
      this.dispatchEvent(new CustomEvent('beat', { detail: { beat: b } }));
    }
    this.dispatchEvent(new CustomEvent('position'));
  }

  /* ─── ConsoleGraph bridge ────────────────────────────────── */

  _emitParam(param, value) {
    this.dispatchEvent(new CustomEvent('param-changed', { detail: { param, value } }));
  }

  dispose() {
    clearTimeout(this._nudgeTimer);
    this._stopSource();
    this.fx?.dispose?.();
    for (const n of [this._pitchNode, this._cueSend, this._trim, this._eqLow,
                     this._eqMid, this._eqHigh, this._color, this._fader]) {
      try { n?.disconnect(); } catch { /* noop */ }
    }
  }
}
