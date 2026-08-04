/* SAMPLER · 8 pads one-shot (§6).
   Owner: FX-SAMPLER.
   Carga assets/tracks/samples/pad1..8.wav (404 tolerado → beep
   sintético de fallback). Gain propio → masterGain directo (no
   cruza el crossfader). trigger(i); teclas 1–8 las gestiona la UI. */

const PAD_COUNT = 8;
/** Bancs de pads: 1 = kit original, 2 = FX sintetitzats (tools/make_fx.py). */
const BANKS = ['assets/tracks/samples/', 'assets/tracks/samples/bank2/'];
const EXTS = ['.wav', '.mp3'];

export class Sampler extends EventTarget {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} masterGain destino directo
   */
  constructor(ctx, masterGain) {
    super();
    this.ctx = ctx;
    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = 0.9;
    this.gainNode.connect(masterGain);
    this.buffers = new Array(PAD_COUNT).fill(null);
    this.lastPad = -1;
    this.bank = 0;
    this._loaded = false;
    this._cache = new Map();     // `${bank}:${pad}` → AudioBuffer
    this._load();
  }

  get bankCount() { return BANKS.length; }

  /** Canvia de banc de pads i recarrega (els buffers ja vistos surten de cache). */
  async setBank(n) {
    const bank = ((n % BANKS.length) + BANKS.length) % BANKS.length;
    if (bank === this.bank) return;
    this.bank = bank;
    this._loaded = false;
    await this._load();
    this.dispatchEvent(new CustomEvent('bank-changed', { detail: { bank } }));
  }

  get gain() { return this.gainNode.gain.value; }
  set gain(v) {
    this.gainNode.gain.setTargetAtTime(Math.min(1.5, Math.max(0, v)), this.ctx.currentTime, 0.01);
  }

  async _load() {
    const bank = this.bank;
    await Promise.all(Array.from({ length: PAD_COUNT }, async (_, i) => {
      const key = `${bank}:${i}`;
      if (this._cache.has(key)) { this.buffers[i] = this._cache.get(key); return; }
      this.buffers[i] = null;
      // .wav primer, .mp3 després: així un FX baixat es deixa caure a la carpeta
      // del banc sense convertir res (decodeAudioData accepta els dos).
      for (const ext of EXTS) {
        try {
          const res = await fetch(`${BANKS[bank]}pad${i + 1}${ext}`);
          if (!res.ok) continue;
          const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
          if (bank !== this.bank) return;   // s'ha canviat de banc mentre carregava
          this._cache.set(key, buf);
          this.buffers[i] = buf;
          return;
        } catch { /* prova la següent extensió */ }
      }
    }));
    this._loaded = true;
    this.dispatchEvent(new CustomEvent('loaded'));
  }

  /** Dispara el pad i (0..7). Fire-and-forget, sin cortar el anterior. */
  trigger(i) {
    if (i < 0 || i >= PAD_COUNT) return;
    this.lastPad = i;
    const buf = this.buffers[i];
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.gainNode);
      src.onended = () => { try { src.disconnect(); } catch { /* noop */ } };
      src.start();
    } else {
      this._beep(i);
    }
    this.dispatchEvent(new CustomEvent('trigger', { detail: { pad: i } }));
  }

  /** Fallback: beep corto con pitch distinto por pad. */
  _beep(i) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 220 * Math.pow(2, i / 4);
    env.gain.setValueAtTime(0.4, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(env);
    env.connect(this.gainNode);
    osc.start(t);
    osc.stop(t + 0.3);
    osc.onended = () => { try { osc.disconnect(); env.disconnect(); } catch { /* noop */ } };
  }

  dispose() {
    try { this.gainNode.disconnect(); } catch { /* noop */ }
  }
}

export default Sampler;
