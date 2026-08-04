/* ═══════════════════════════════════════════════════════════════
   AUDIO ENGINE · UN solo AudioContext (ARCHITECTURE §2).

   Owner: CORE-AUDIO.
   - Contexto único `latencyHint:'interactive'`, creado en el primer
     gesto de usuario via init(). Nada suena antes.
   - Routing por deck (ver Deck.js) → crossfadeGain → masterGain.
   - Crossfader equal-power: gainA = cos(x·π/2), gainB = sin(x·π/2).
   - masterAnalyser (espectro) + splitter L/R para VU (getMasterLevels).
   - Recorder: MediaRecorder sobre MediaStreamDestination del master
     → descarga `mescla_YYYYMMDD.webm` (§6).
   - Sampler (owner FX-SAMPLER) y FXChain se cargan por import dinámico:
     el core funciona standalone si aún no existen.
═══════════════════════════════════════════════════════════════ */

import { Deck } from './Deck.js';
import { encodeWav } from '../audio/wav.js';

const SMOOTH = 0.01;   // time constant setTargetAtTime (anti-click)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function stampName(ext) {
  const d = new Date();
  const s = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `mescla_${s}.${ext}`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ─── Recorder (§6 + §13) ──────────────────────────────────────
   Primari: WAV sense pèrdues via AudioWorklet PCM (pcm-recorder).
   Fallback: MediaRecorder (webm/opus) si el worklet no està. */

export class Recorder extends EventTarget {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} sourceNode nodo a grabar (masterGain)
   * @param {boolean} workletReady mòdul pcm-recorder carregat
   */
  constructor(ctx, sourceNode, workletReady) {
    super();
    this.ctx = ctx;
    this.source = sourceNode;
    this.recording = false;
    this.format = 'wav';
    this._l = [];
    this._r = [];

    if (workletReady) {
      try {
        this.node = new AudioWorkletNode(ctx, 'pcm-recorder',
          { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
        this.node.port.onmessage = (e) => {
          if (!this.recording) return;
          this._l.push(e.data.l); this._r.push(e.data.r);
        };
        sourceNode.connect(this.node);
        // manté el node "viu" en el graf sense sonar
        this._silent = ctx.createGain(); this._silent.gain.value = 0;
        this.node.connect(this._silent); this._silent.connect(ctx.destination);
      } catch { this.node = null; }
    }

    if (!this.node) {
      this.format = 'webm';
      this.dest = ctx.createMediaStreamDestination();
      sourceNode.connect(this.dest);
      this._mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) || '';
    }
  }

  start() {
    if (this.recording) return;
    if (this.node) {
      this._l = []; this._r = [];
      this.recording = true;
      this.node.port.postMessage('start');
    } else if (typeof MediaRecorder !== 'undefined') {
      this._chunks = [];
      this._rec = new MediaRecorder(this.dest.stream, this._mime ? { mimeType: this._mime } : undefined);
      this._rec.ondataavailable = (e) => { if (e.data && e.data.size) this._chunks.push(e.data); };
      this._rec.onstop = () => this._finishWebm();
      this._rec.start(250);
      this.recording = true;
    } else return;
    this.dispatchEvent(new CustomEvent('start'));
  }

  stop() {
    if (!this.recording) return;
    this.recording = false;
    if (this.node) {
      this.node.port.postMessage('stop');
      // dona temps al darrer flush del worklet abans de codificar
      setTimeout(() => this._finishWav(), 60);
    } else if (this._rec) {
      try { this._rec.stop(); } catch { /* ja parat */ }
    }
    this.dispatchEvent(new CustomEvent('stop'));
  }

  _finishWav() {
    if (!this._l.length) { this.dispatchEvent(new CustomEvent('saved', { detail: { blob: null } })); return; }
    const blob = encodeWav(this._l, this._r, this.ctx.sampleRate);
    this._l = []; this._r = [];
    downloadBlob(blob, stampName('wav'));
    this.dispatchEvent(new CustomEvent('saved', { detail: { blob } }));
  }

  _finishWebm() {
    const blob = new Blob(this._chunks, { type: this._mime || 'audio/webm' });
    this._chunks = []; this._rec = null;
    downloadBlob(blob, stampName('webm'));
    this.dispatchEvent(new CustomEvent('saved', { detail: { blob } }));
  }
}

/* ─── AudioEngine ──────────────────────────────────────────── */

export class AudioEngine {
  /** Singleton tras init(). */
  static instance = null;

  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.masterAnalyser = null;
    this.decks = null;          // { a: Deck, b: Deck }
    this.sampler = null;        // owner FX-SAMPLER (carga dinámica)
    this.recorder = null;
    this._xf = 0.5;
    this._xfGainA = null;
    this._xfGainB = null;
    this._splitter = null;
    this._anL = null;
    this._anR = null;
    this._vuBuf = null;
    this._raf = 0;
    // v2 — worklets + cue bus (PFL)
    this.worklets = { pitch: false, recorder: false };
    this.cueGain = null;        // bus de pre-escolta (PFL)
    this.cueAudio = null;       // <audio> a la sortida d'auriculars
    this.cueDeviceId = null;
    this.masterDeviceId = null; // sortida del màster (AudioContext.setSinkId)
    this._splitOn = false;      // Split Cue (màster→L, cue→R en una sola sortida)
    this._splitMerger = null;
    this.devicesUnlocked = false;
  }

  /**
   * Debe llamarse desde un gesto de usuario (overlay "Activa l'àudio").
   * Idempotente: segundas llamadas devuelven la instancia existente.
   */
  async init() {
    if (this.ctx) return this;
    if (AudioEngine.instance) return AudioEngine.instance;

    this.ctx = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 'interactive',
    });
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* iOS: se resolverá al gesto */ }
    }

    // ── Master ──
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1;
    this.masterGain.connect(this.ctx.destination);
    this._toDest = true;        // masterGain conectado a destination (normal)

    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 2048;
    this.masterAnalyser.smoothingTimeConstant = 0.75;
    this.masterGain.connect(this.masterAnalyser);

    // VU estéreo: splitter + analyser por canal
    this._splitter = this.ctx.createChannelSplitter(2);
    this.masterGain.connect(this._splitter);
    this._anL = this.ctx.createAnalyser();
    this._anR = this.ctx.createAnalyser();
    this._anL.fftSize = this._anR.fftSize = 256;
    this._splitter.connect(this._anL, 0);
    this._splitter.connect(this._anR, 1);
    this._vuBuf = new Uint8Array(this._anL.fftSize);

    // ── AudioWorklets (v2): keylock + recorder PCM ──
    await this._loadWorklets();

    // ── Cue bus (PFL): sortida dual via <audio>.setSinkId ──
    this._buildCueBus();

    // ── FXChain (owner FX-SAMPLER) — import dinámico tolerante ──
    const FXChainClass = await import('../fx/FXChain.js')
      .then((m) => m.FXChain ?? m.default ?? null)
      .catch(() => null);

    // ── Decks + crossfader equal-power ──
    this._xfGainA = this.ctx.createGain();
    this._xfGainB = this.ctx.createGain();
    this._xfGainA.connect(this.masterGain);
    this._xfGainB.connect(this.masterGain);

    this.decks = {
      a: new Deck('a', this, FXChainClass),
      b: new Deck('b', this, FXChainClass),
    };
    this.decks.a.output.connect(this._xfGainA);
    this.decks.b.output.connect(this._xfGainB);
    this.setCrossfader(0.5);

    // ── Sampler (owner FX-SAMPLER) — directo a master, no cruza el xfader ──
    try {
      const SamplerClass = await import('../sampler/Sampler.js')
        .then((m) => m.Sampler ?? m.default ?? null)
        .catch(() => null);
      if (SamplerClass) this.sampler = new SamplerClass(this.ctx, this.masterGain);
    } catch { this.sampler = null; }

    // ── Recorder (WAV via worklet, o webm de fallback) ──
    this.recorder = new Recorder(this.ctx, this.masterGain, this.worklets.recorder);

    // ── Bucle rAF único compartido: transporte de ambos decks ──
    const frame = () => {
      this.decks.a._frame();
      this.decks.b._frame();
      this._raf = requestAnimationFrame(frame);
    };
    this._raf = requestAnimationFrame(frame);

    AudioEngine.instance = this;
    return this;
  }

  /* ─── Crossfader (0=A, 1=B), curva equal-power ───────────── */

  get crossfader() { return this._xf; }
  set crossfader(v) { this.setCrossfader(v); }

  setCrossfader(v) {
    this._xf = clamp(Number(v) || 0, 0, 1);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._xfGainA.gain.setTargetAtTime(Math.cos(this._xf * Math.PI / 2), t, SMOOTH);
    this._xfGainB.gain.setTargetAtTime(Math.sin(this._xf * Math.PI / 2), t, SMOOTH);
  }

  /* ─── VU master (pull desde el rAF de MixerPane) ─────────── */

  /** @returns {{l:number, r:number}} pico 0..1 por canal */
  getMasterLevels() {
    if (!this._anL) return { l: 0, r: 0 };
    const peak = (an) => {
      an.getByteTimeDomainData(this._vuBuf);
      let max = 0;
      for (let i = 0; i < this._vuBuf.length; i++) {
        const v = Math.abs(this._vuBuf[i] - 128) / 128;
        if (v > max) max = v;
      }
      return max;
    };
    return { l: peak(this._anL), r: peak(this._anR) };
  }

  /* ─── Worklets (v2) ──────────────────────────────────────── */

  async _loadWorklets() {
    if (!this.ctx.audioWorklet) return;
    const load = async (url, flag) => {
      try { await this.ctx.audioWorklet.addModule(url); this.worklets[flag] = true; }
      catch (err) { console.warn(`[AudioEngine] worklet ${url} no carregat`, err); }
    };
    await Promise.all([
      load('js/audio/pitchshift-worklet.js', 'pitch'),
      load('js/audio/recorder-worklet.js', 'recorder'),
    ]);
  }

  /* ─── Cue bus / PFL (v2, §13) ────────────────────────────── */

  _buildCueBus() {
    this.cueGain = this.ctx.createGain();
    this.cueGain.gain.value = 0.9;
    try {
      this._cueDest = this.ctx.createMediaStreamDestination();
      this.cueGain.connect(this._cueDest);
      this.cueAudio = new Audio();
      this.cueAudio.srcObject = this._cueDest.stream;
      this.cueAudio.autoplay = true;
      this.cueAudio.play?.().catch(() => { /* s'activarà amb el gest */ });
    } catch (err) {
      console.warn('[AudioEngine] cue bus no disponible', err);
      // fallback: la pre-escolta va al màster (millor que res)
      this.cueGain.connect(this.masterGain);
    }
  }

  get cuePFLSupported() {
    return !!(this.cueAudio && typeof this.cueAudio.setSinkId === 'function');
  }

  /** ¿El màster es pot fixar a un dispositiu concret? (Chrome 110+) */
  get masterCanSetSink() { return typeof this.ctx?.setSinkId === 'function'; }

  /** Demana permís una vegada per revelar l'etiqueta i llista completa de sortides. */
  async unlockDevices() {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());     // només volem el permís
      this.devicesUnlocked = true;
      return true;
    } catch { return false; }
  }

  /** Llista de sortides d'àudio { deviceId, label }. */
  async listOutputDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter((d) => d.kind === 'audiooutput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Sortida ${i + 1}` }));
    } catch { return []; }
  }

  /** Envia la pre-escolta (auriculars) a un dispositiu concret. */
  async setCueDevice(deviceId) {
    this.cueDeviceId = deviceId;
    if (!this.cuePFLSupported) return false;
    try { await this.cueAudio.setSinkId(deviceId || ''); return true; }
    catch (err) { console.warn('[AudioEngine] cue setSinkId', err); return false; }
  }

  /** Fixa la sortida del MÀSTER a un dispositiu (altaveus). */
  async setMasterDevice(deviceId) {
    this.masterDeviceId = deviceId;
    if (!this.masterCanSetSink) return false;
    try { await this.ctx.setSinkId(deviceId || ''); return true; }
    catch (err) { console.warn('[AudioEngine] master setSinkId', err); return false; }
  }

  setCueVolume(v) {
    this.cueGain?.gain.setTargetAtTime(clamp(Number(v) || 0, 0, 1.2), this.ctx.currentTime, SMOOTH);
  }

  /* ─── Split Cue (una sola sortida: màster→L, cue→R) ──────────
     Per a portàtils amb una única sortida + cable splitter (Y):
     L va als altaveus, R als auriculars. */

  get splitCue() { return this._splitOn; }

  setSplitCue(on) {
    on = !!on;
    if (on === this._splitOn || !this.ctx) return this._splitOn;
    const ctx = this.ctx;
    if (on) {
      const mono = () => {
        const g = ctx.createGain();
        g.channelCount = 1; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers';
        return g;
      };
      this._masterMono = mono();
      this._cueMono = mono();
      this._splitMerger = ctx.createChannelMerger(2);
      try { this.masterGain.disconnect(ctx.destination); } catch { /* noop */ }
      this._toDest = false;
      this.masterGain.connect(this._masterMono); this._masterMono.connect(this._splitMerger, 0, 0); // L
      this.cueGain.connect(this._cueMono);       this._cueMono.connect(this._splitMerger, 0, 1);    // R
      this._splitMerger.connect(ctx.destination);
      if (this.cueAudio) this.cueAudio.muted = true;   // evita doble via <audio>
    } else {
      try { this.masterGain.disconnect(this._masterMono); } catch { /* noop */ }
      try { this.cueGain.disconnect(this._cueMono); } catch { /* noop */ }
      try { this._masterMono?.disconnect(); this._cueMono?.disconnect(); this._splitMerger?.disconnect(); } catch { /* noop */ }
      this._masterMono = this._cueMono = this._splitMerger = null;
      if (!this._toDest) { this.masterGain.connect(ctx.destination); this._toDest = true; }
      if (this.cueAudio) this.cueAudio.muted = false;
    }
    this._splitOn = on;
    return on;
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this.recorder?.stop();
    this.decks?.a?.dispose();
    this.decks?.b?.dispose();
    try { this.ctx?.close(); } catch { /* noop */ }
    if (AudioEngine.instance === this) AudioEngine.instance = null;
  }
}
