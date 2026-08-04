// AULATECH DJ — JogWheel (owner: UI-DECKS)
// Canvas jog: rotación al reproducir, drag = nudge (play) / scrub (pausa),
// aro exterior = seek rápido. Render externo via render() dentro del rAF del DeckPane.

const TAU = Math.PI * 2;
const REV_SECONDS = 1.8;        // 1 vuelta de plato = 1.8 s de audio (33⅓ rpm vinilo)
const RING_THRESHOLD = 0.84;    // radio normalizado a partir del cual es "aro exterior"
const RING_REV_FRACTION = 8;    // 1 vuelta del aro exterior = duración/8

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function shortestDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

export class JogWheel {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Deck} deck
   * @param {string} color acento del deck (--deck-a / --deck-b)
   */
  constructor(canvas, deck, color) {
    this.canvas = canvas;
    this.deck = deck;
    this.color = color;
    this._locked = false;
    this._drag = null;
    this._flash = 0;
    this._dpr = Math.max(1, window.devicePixelRatio || 1);
    this._ctx = canvas.getContext('2d');

    this._onBeat = () => { this._flash = 1; };
    deck.addEventListener('beat', this._onBeat);

    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e);
    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup', this._onUp);
    canvas.addEventListener('pointercancel', this._onUp);

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas);
    this._resize();
  }

  setLocked(v) {
    this._locked = !!v;
    if (this._locked) this._drag = null;
  }

  dispose() {
    this.deck.removeEventListener('beat', this._onBeat);
    this.canvas.removeEventListener('pointerdown', this._onDown);
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerup', this._onUp);
    this.canvas.removeEventListener('pointercancel', this._onUp);
    this._ro.disconnect();
  }

  // ── Interacción ──────────────────────────────────────────────────────────
  _pointerInfo(e) {
    const r = this.canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    return {
      angle: Math.atan2(dy, dx),
      radius: Math.hypot(dx, dy) / (Math.min(r.width, r.height) / 2)
    };
  }

  _pointerDown(e) {
    if (this._locked || !this.deck.track) return;
    const { angle, radius } = this._pointerInfo(e);
    if (radius > 1.02) return;
    this.canvas.setPointerCapture(e.pointerId);
    const mode = radius >= RING_THRESHOLD ? 'ring' : (this.deck.playing ? 'nudge' : 'scrub');
    this._drag = { mode, lastAngle: angle, pointerId: e.pointerId };
    e.preventDefault();
  }

  _pointerMove(e) {
    if (!this._drag || e.pointerId !== this._drag.pointerId) return;
    const { angle } = this._pointerInfo(e);
    const d = shortestDelta(angle, this._drag.lastAngle);
    this._drag.lastAngle = angle;
    const deck = this.deck;
    const dur = deck.track ? deck.track.duration : 0;

    if (this._drag.mode === 'ring' && dur) {
      // aro exterior: seek rápido — 1 vuelta = duración/8
      deck.seek(clamp(deck.position + (d / TAU) * (dur / RING_REV_FRACTION), 0, dur));
    } else if (this._drag.mode === 'scrub' && dur) {
      // pausa: scrub frame-a-frame — 1 vuelta = 1.8 s
      deck.seek(clamp(deck.position + (d / TAU) * REV_SECONDS, 0, dur));
    } else if (this._drag.mode === 'nudge') {
      // reproducción: pitch bend proporcional a la velocidad angular
      deck.nudge(clamp(d * 0.08, -0.25, 0.25), 120);
    }
  }

  _pointerUp(e) {
    if (this._drag && e.pointerId === this._drag.pointerId) this._drag = null;
  }

  // ── Render (llamado desde el rAF del DeckPane) ───────────────────────────
  _resize() {
    const w = this.canvas.clientWidth || 180;
    const h = this.canvas.clientHeight || 180;
    this._dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this._dpr);
    this.canvas.height = Math.round(h * this._dpr);
  }

  render() {
    const ctx = this._ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (!W || !H) return;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) / 2 - 2 * this._dpr;
    const deck = this.deck;
    const pos = deck.track ? deck.position : 0;
    const dur = deck.track ? deck.track.duration : 0;
    const angle = ((pos % REV_SECONDS) / REV_SECONDS) * TAU - Math.PI / 2;

    this._flash *= 0.88;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(cx, cy);

    // aro exterior (zona seek)
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.93, 0, TAU);
    ctx.lineWidth = R * 0.12;
    ctx.strokeStyle = '#1a1f2a';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.93, 0, TAU);
    ctx.lineWidth = R * 0.12;
    ctx.strokeStyle = this.color;
    ctx.globalAlpha = 0.18 + this._flash * 0.45;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // ticks del aro
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(1, this._dpr);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88);
      ctx.lineTo(Math.cos(a) * R * 0.98, Math.sin(a) * R * 0.98);
      ctx.stroke();
    }

    // marcador de posición global sobre el aro
    if (dur > 0) {
      const pa = (pos / dur) * TAU - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(Math.cos(pa) * R * 0.93, Math.sin(pa) * R * 0.93, R * 0.05, 0, TAU);
      ctx.fillStyle = this.color;
      ctx.fill();
    }

    // plato
    const grad = ctx.createRadialGradient(0, 0, R * 0.05, 0, 0, R * 0.8);
    grad.addColorStop(0, '#232a38');
    grad.addColorStop(1, '#0a0c11');
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.8, 0, TAU);
    ctx.fillStyle = grad;
    ctx.fill();

    // surcos
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = Math.max(1, this._dpr);
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.8 * (i / 5), 0, TAU);
      ctx.stroke();
    }

    // aguja de rotación
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.24);
    ctx.lineTo(0, -R * 0.76);
    ctx.lineWidth = Math.max(2, 3 * this._dpr);
    ctx.lineCap = 'round';
    ctx.strokeStyle = this.color;
    if (deck.playing) {
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 8 * this._dpr;
    }
    ctx.stroke();
    ctx.restore();

    // hub central
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.2, 0, TAU);
    ctx.fillStyle = '#161a22';
    ctx.fill();
    ctx.lineWidth = Math.max(1, this._dpr);
    ctx.strokeStyle = this.color;
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.color;
    ctx.font = `700 ${Math.round(R * 0.22)}px -apple-system, "SF Pro Display", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(deck.id.toUpperCase(), 0, R * 0.01);

    ctx.restore();
  }
}
