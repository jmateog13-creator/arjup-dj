/* ═══════════════════════════════════════════════════════════════
   WAVEFORM STRIP · Rhythm waves estilo VDJ (§4).

   Owner: WAVE-BPM.
   Dos tiras superpuestas (A #38aaff arriba, B #ff4433 abajo) en un
   solo canvas: scroll horizontal con playhead central FIJO, marcas
   de beatgrid, zoom con rueda, click = seek (solo con deck en pausa).
   Consume deck.position cada frame (pull) y track.peaks.bands
   (energía low/mid/high por bucket — Peaks §4).

   renderOverview(canvas, peaks, color) — mini-waveform estática
   para DeckPane (también como export de función).
═══════════════════════════════════════════════════════════════ */

const COLOR_A = '#38aaff';
const COLOR_B = '#ff4433';
const MIN_PPS = 20;      // px por segundo (zoom out)
const MAX_PPS = 400;     // zoom in
const DEF_PPS = 90;

export class WaveformStrip {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{a: Deck, b: Deck}} decks
   */
  constructor(canvas, decks) {
    this.canvas = canvas;
    this.decks = decks;
    this._ctx = canvas.getContext('2d');
    this._pps = DEF_PPS;
    this._dpr = Math.max(1, window.devicePixelRatio || 1);
    this._running = true;
    this._locked = false;

    this._onWheel = (e) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      this._pps = Math.min(MAX_PPS, Math.max(MIN_PPS, this._pps * f));
    };
    this._onClick = (e) => this._seekFromClick(e);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    canvas.addEventListener('click', this._onClick);

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas);
    this._resize();

    const frame = () => {
      if (!this._running) return;
      this.render();
      this._raf = requestAnimationFrame(frame);
    };
    this._raf = requestAnimationFrame(frame);
  }

  setLocked(v) { this._locked = !!v; }

  _resize() {
    this._dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 120;
    this.canvas.width = Math.round(w * this._dpr);
    this.canvas.height = Math.round(h * this._dpr);
  }

  /** Click = seek del deck cuya mitad se ha clicado (solo en pausa). */
  _seekFromClick(e) {
    if (this._locked) return;
    const r = this.canvas.getBoundingClientRect();
    const deck = (e.clientY - r.top) < r.height / 2 ? this.decks.a : this.decks.b;
    if (!deck.track || deck.playing) return;
    const dx = (e.clientX - r.left) - r.width / 2;         // px desde el playhead
    deck.seek(deck.position + dx / this._pps);
  }

  render() {
    const ctx = this._ctx;
    const W = this.canvas.width, H = this.canvas.height;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);

    const half = H / 2;
    this._renderDeck(ctx, this.decks.a, COLOR_A, 0, half, W);
    this._renderDeck(ctx, this.decks.b, COLOR_B, half, half, W);

    // separador y playhead central fijo
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, half - 1, W, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(W / 2 - this._dpr, 0, this._dpr * 2, H);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(W / 2 - 6 * this._dpr, 0, 12 * this._dpr, 2 * this._dpr);
    ctx.fillRect(W / 2 - 6 * this._dpr, H - 2 * this._dpr, 12 * this._dpr, 2 * this._dpr);
  }

  _renderDeck(ctx, deck, color, y0, h, W) {
    const track = deck.track;
    if (!track?.peaks) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = `${11 * this._dpr}px -apple-system, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(`DECK ${deck.id.toUpperCase()}`, 10 * this._dpr, y0 + h / 2 + 4 * this._dpr);
      return;
    }
    const { bands, secondsPerBucket, bandsLength } = track.peaks;
    const pps = this._pps * this._dpr;
    const pos = deck.position;
    const t0 = pos - (W / 2) / pps;                 // segundos en x=0
    const mid = y0 + h / 2;
    const amp = h * 0.46;

    // rhythm wave: graves anchos (color deck), mids, agudos finos claros
    const bucketPx = secondsPerBucket * pps;
    const step = Math.max(1, Math.floor(1 / bucketPx));   // decimación si hay zoom out
    const b0 = Math.max(0, Math.floor(t0 / secondsPerBucket));
    const bMax = Math.min(bandsLength, Math.ceil((t0 + W / pps) / secondsPerBucket) + 1);

    for (let b = b0; b < bMax; b += step) {
      const x = ((b * secondsPerBucket) - t0) * pps;
      const w = Math.max(1, bucketPx * step - 0.5);
      const lo = bands.low[b], mi = bands.mid[b], hi = bands.high[b];
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, mid - lo * amp, w, lo * amp * 2);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x, mid - mi * amp * 0.8, w, mi * amp * 1.6);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#eef4ff';
      ctx.fillRect(x, mid - hi * amp * 0.5, w, hi * amp);
      ctx.globalAlpha = 1;
    }

    // beatgrid
    if (track.bpm) {
      const spb = 60 / track.bpm;
      const first = track.firstBeat || 0;
      let n = Math.max(0, Math.ceil((t0 - first) / spb));
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      for (;; n++) {
        const t = first + n * spb;
        const x = (t - t0) * pps;
        if (x > W) break;
        if (x < 0) continue;
        const isBar = n % 4 === 0;
        ctx.globalAlpha = isBar ? 0.5 : 0.22;
        ctx.fillRect(x, y0, this._dpr, isBar ? h : h * 0.5);
      }
      ctx.globalAlpha = 1;
    }

    // zona ya reproducida ligeramente atenuada
    ctx.fillStyle = 'rgba(13,15,20,0.35)';
    ctx.fillRect(0, y0, W / 2, h);

    // etiqueta
    ctx.fillStyle = color;
    ctx.font = `700 ${10 * this._dpr}px -apple-system, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(
      `${deck.id.toUpperCase()} · ${track.title} · ${deck.effectiveBPM.toFixed(1)} BPM`,
      8 * this._dpr, y0 + 13 * this._dpr);
  }

  dispose() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('click', this._onClick);
    this._ro.disconnect();
  }
}

/** Mini-overview estática (DeckPane): min/max de peaks.overview. */
export function renderOverview(canvas, peaks, color = '#38aaff', progress = 0) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 200, h = canvas.clientHeight || 36;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!peaks?.overview) return;
  const { overview, overviewLength } = peaks;
  const mid = H / 2;
  const px = W / overviewLength;
  for (let i = 0; i < overviewLength; i++) {
    const mn = overview[i * 2], mx = overview[i * 2 + 1];
    const played = i / overviewLength <= progress;
    ctx.fillStyle = color;
    ctx.globalAlpha = played ? 1 : 0.38;
    ctx.fillRect(i * px, mid - mx * mid * 0.92, Math.max(1, px - 0.3), (mx - mn) * mid * 0.92);
  }
  ctx.globalAlpha = 1;
  // marcador de posición
  ctx.fillStyle = '#fff';
  ctx.fillRect(progress * W - 1, 0, 2, H);
}

WaveformStrip.renderOverview = renderOverview;
export default WaveformStrip;
