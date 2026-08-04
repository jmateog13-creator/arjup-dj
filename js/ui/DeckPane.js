/* ═══════════════════════════════════════════════════════════════
   DECK PANE · Panel completo de un deck (§8). Owner: UI-DECKS.

   Título/BPM/tiempo, mini-overview clicable, JogWheel, pitch fader
   vertical ±8% con LED de match, PLAY/CUE/SYNC, 4 HOT CUES,
   botonera LOOP ½ 1 2 4 8 + EXIT, y FXPane.
   Hooks docentes: setControlPolicy(allow|'*') + highlightControl.
   La UI NUNCA toca nodos de audio: solo la API pública de Deck.
═══════════════════════════════════════════════════════════════ */

import { JogWheel } from './JogWheel.js';
import { FXPane } from './FXPane.js';
import { renderOverview } from './WaveformStrip.js';

const PITCH_RANGE = 0.08;
const LOOP_SIZES = [0.5, 1, 2, 4, 8];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export class DeckPane {
  /**
   * @param {HTMLElement} container #deck-a | #deck-b
   * @param {Deck} deck
   * @param {string} color var CSS resuelta (#38aaff | #ff4433)
   */
  constructor(container, deck, color) {
    this.deck = deck;
    this.color = color;
    this.D = deck.id === 'a' ? 'deckA' : 'deckB';
    this._controls = new Map();
    this._destroyed = false;

    container.classList.add('deck-pane');
    this._build(container);

    this._onLoaded = () => this._refreshTrackInfo();
    deck.addEventListener('loaded', this._onLoaded);

    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
  }

  /* ─── DOM ────────────────────────────────────────────────── */

  _build(container) {
    const D = this.D;

    // fila 1: info de pista
    const info = el('div', 'deck-info');
    this._title = el('div', 'deck-title', '—');
    this._meta = el('div', 'deck-meta', '');
    this._time = el('div', 'deck-time', '0:00 / −0:00');
    info.append(this._title, this._meta, this._time);

    // mini-overview clicable
    this._overview = document.createElement('canvas');
    this._overview.className = 'deck-overview';
    this._overview.addEventListener('click', (e) => {
      const t = this.deck.track;
      if (!t?.duration || this._overviewLocked()) return;
      const r = this._overview.getBoundingClientRect();
      this.deck.seek(((e.clientX - r.left) / r.width) * t.duration);
    });

    // fila central: jog + pitch
    const mid = el('div', 'deck-mid');
    const jogWrap = el('div', 'deck-jog-wrap');
    const jogCanvas = document.createElement('canvas');
    jogCanvas.className = 'deck-jog';
    jogCanvas.setAttribute('data-midi-target', `${D}.jog`);
    jogWrap.appendChild(jogCanvas);
    this.jog = new JogWheel(jogCanvas, this.deck, this.color);
    this._controls.set(`${D}.jog`, { el: jogWrap });

    mid.append(jogWrap, this._buildPitch());

    // transporte
    const transport = el('div', 'deck-transport');
    this._playBtn = this._btn(`${D}.play`, 'PLAY', 'deck-btn deck-btn-play', () => {
      this.deck.playing ? this.deck.pause() : this.deck.play();
    });
    const cueBtn = this._btn(`${D}.cue`, 'CUE', 'deck-btn deck-btn-cue', () => {
      // VDJ: en pausa fija el CUE; en reproducción vuelve al CUE
      this.deck.playing ? this.deck.gotoCue() : this.deck.setCue();
    });
    this._syncBtn = this._btn(`${D}.sync`, 'SYNC', 'deck-btn deck-btn-sync', () => this.deck.sync());
    transport.append(cueBtn, this._playBtn, this._syncBtn);

    // hot cues
    const hotcues = el('div', 'deck-hotcues');
    this._hotBtns = [];
    for (let i = 0; i < 4; i++) {
      const b = this._btn(`${D}.hotcue${i + 1}`, String(i + 1), 'deck-hotcue', (ev) => {
        if (ev.shiftKey) this.deck.clearHotCue(i);
        else if (this.deck.hotCues[i] == null) this.deck.setHotCue(i);
        else this.deck.jumpHotCue(i);
      });
      this._hotBtns.push(b.firstChild);
      hotcues.appendChild(b);
    }

    // loops
    const loops = el('div', 'deck-loops');
    this._loopBtns = new Map();
    for (const size of LOOP_SIZES) {
      const label = size === 0.5 ? '½' : String(size);
      const key = String(size).replace('.', '');
      const b = this._btn(`${D}.loop${key}`, label, 'deck-loop-btn', () => this.deck.setLoop(size));
      this._loopBtns.set(size, b.firstChild);
      loops.appendChild(b);
    }
    const exit = this._btn(`${D}.loopExit`, 'EXIT', 'deck-loop-btn deck-loop-exit', () => this.deck.exitLoop());
    this._loopExitBtn = exit.firstChild;
    loops.appendChild(exit);

    // FX
    const fxHost = el('div', 'deck-fx-host');
    this.fxPane = new FXPane(fxHost, this.deck, D);
    for (const [id, c] of this.fxPane.controls) this._controls.set(id, c);

    container.append(info, this._overview, mid, transport, hotcues, loops, fxHost);
  }

  _buildPitch() {
    const D = this.D;
    const wrap = el('div', 'deck-pitch-wrap');
    wrap.dataset.control = `${D}.pitch`;

    this._pitchLed = el('div', 'deck-pitch-led');
    this._pitchLabel = el('div', 'deck-pitch-value', '+0.0%');
    const track = el('div', 'deck-pitch-track');
    track.setAttribute('data-midi-target', `${D}.pitch`);
    const handle = el('div', 'deck-pitch-handle');
    const zero = el('div', 'deck-pitch-zero');
    track.append(zero, handle);
    wrap.append(this._pitchLed, track, this._pitchLabel, el('div', 'deck-pitch-cap', 'PITCH'));

    // KEYLOCK (v2): master tempo — cambia tempo sin tocar el tono
    const keyBtn = document.createElement('button');
    keyBtn.className = 'deck-keylock-btn';
    keyBtn.textContent = 'KEYLOCK';
    keyBtn.setAttribute('data-midi-target', `${D}.keylock`);
    if (!this.deck.keylockAvailable) { keyBtn.disabled = true; keyBtn.title = 'Keylock no disponible (AudioWorklet)'; }
    keyBtn.addEventListener('click', () => {
      if (wrap.classList.contains('locked') || keyBtn.disabled) return;
      this.deck.keylock = !this.deck.keylock;
      keyBtn.classList.toggle('active', this.deck.keylock);
    });
    this._keyBtn = keyBtn;
    wrap.append(keyBtn);

    const paint = (p) => {
      const y = (1 - (p + PITCH_RANGE) / (2 * PITCH_RANGE)) * 100;
      handle.style.top = `calc(${y}% - 7px)`;
      this._pitchLabel.textContent = `${p >= 0 ? '+' : ''}${(p * 100).toFixed(1)}%`;
    };
    paint(0);
    this._paintPitch = paint;

    const fromEvent = (ev) => {
      const r = track.getBoundingClientRect();
      const y = clamp((ev.clientY - r.top) / r.height, 0, 1);
      return (1 - y) * 2 * PITCH_RANGE - PITCH_RANGE;
    };
    track.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || wrap.classList.contains('locked')) return;
      e.preventDefault();
      track.setPointerCapture(e.pointerId);
      this._pitchDrag = true;
      const move = (ev) => { const p = fromEvent(ev); this.deck.pitch = p; paint(p); };
      move(e);
      const up = (ev) => {
        track.releasePointerCapture(ev.pointerId);
        track.removeEventListener('pointermove', move);
        track.removeEventListener('pointerup', up);
        track.removeEventListener('pointercancel', up);
        this._pitchDrag = false;
      };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
      track.addEventListener('pointercancel', up);
    });
    track.addEventListener('dblclick', () => {
      if (wrap.classList.contains('locked')) return;
      this.deck.pitch = 0; paint(0);
    });

    this._controls.set(`${D}.pitch`, {
      el: wrap,
      set: (v) => { const p = v * 2 * PITCH_RANGE - PITCH_RANGE; this.deck.pitch = p; paint(p); },
      get: () => (this.deck.pitch + PITCH_RANGE) / (2 * PITCH_RANGE),
    });
    return wrap;
  }

  _btn(id, label, cls, onClick) {
    const wrap = el('div', 'deck-btn-wrap');
    wrap.dataset.control = id;
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    b.setAttribute('data-midi-target', id);
    b.addEventListener('click', (ev) => {
      if (wrap.classList.contains('locked')) return;
      onClick(ev);
    });
    wrap.appendChild(b);
    this._controls.set(id, { el: wrap });
    return wrap;
  }

  /* ─── Estado → UI (rAF) ──────────────────────────────────── */

  _refreshTrackInfo() {
    const t = this.deck.track;
    this._title.textContent = t ? t.title : '—';
    const cam = t?.camelot && t.camelot !== '—' ? ` (${t.camelot})` : '';
    this._meta.textContent = t ? `${t.artist} · ${t.bpm.toFixed(2)} BPM · ${t.key}${cam}` : '';
  }

  _tick() {
    if (this._destroyed) return;
    try { this._tickBody(); }
    catch (err) { if (!this._tickWarned) { this._tickWarned = true; console.error('[DeckPane] _tick', err); } }
    this._raf = requestAnimationFrame(this._tick);
  }

  _tickBody() {
    const deck = this.deck;
    const t = deck.track;

    this._playBtn.firstChild.classList.toggle('active', deck.playing);
    this._playBtn.firstChild.textContent = deck.playing ? 'PAUSE' : 'PLAY';

    if (t) {
      const pos = deck.position;
      this._time.textContent = `${fmtTime(pos)} / −${fmtTime(t.duration - pos)}`;
      renderOverview(this._overview, t.peaks, this.color, pos / t.duration);
      // LED de match (verd si |ΔBPM| < 0.1 amb l'altre deck)
      const other = deck.engine.decks[deck.id === 'a' ? 'b' : 'a'];
      const match = other?.track && Math.abs(deck.effectiveBPM - other.effectiveBPM) < 0.1;
      this._pitchLed.classList.toggle('match', !!match);
      if (!this._pitchDrag) this._paintPitch(deck.pitch);
    }

    // hot cues activos
    for (let i = 0; i < 4; i++) {
      this._hotBtns[i].classList.toggle('set', deck.hotCues[i] != null);
    }
    // loop activo
    for (const [size, btn] of this._loopBtns) {
      btn.classList.toggle('active', deck.loop.active && deck.loop.beats === size);
    }
    this._loopExitBtn.classList.toggle('armed', deck.loop.active);
    this._keyBtn?.classList.toggle('active', deck.keylock);

    this.jog.render();
  }

  _overviewLocked() {
    return this._policy !== '*' && !this._policySet?.has(`${this.D}.seek`);
  }

  /* ─── Hooks docentes (§8) ────────────────────────────────── */

  setControlPolicy(allow) {
    this._policy = allow;
    const all = allow === '*';
    this._policySet = all ? null : new Set(allow);
    for (const [id, c] of this._controls) {
      c.el.classList.toggle('locked', !all && !this._policySet.has(id));
    }
    this.jog.setLocked(!all && !this._policySet.has(`${this.D}.jog`));
  }

  highlightControl(id, on) {
    const c = this._controls.get(id);
    if (c) c.el.classList.toggle('mission-highlight', !!on);
  }

  get controls() { return this._controls; }

  destroy() {
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    this.deck.removeEventListener('loaded', this._onLoaded);
    this.jog.dispose();
    this.fxPane.dispose();
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export default DeckPane;
