// ============================================================================
// AULATECH DJ — MixerPane (owner: UI-MIXER)
// Central mixer: per-channel GAIN / HIGH / MID / LOW / FILTER / channel fader,
// horizontal equal-power crossfader, stereo master VU (canvas @ rAF).
// The UI NEVER touches audio nodes — only the public Deck / AudioEngine API.
// Mixer terms in ENGLISH (VDJ). Docent strings do not exist in this pane.
// ============================================================================

const KILL_DB = -40;
const EQ_MIN = -24;
const EQ_MAX = 24;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class MixerPane {
  /**
   * @param {HTMLElement} container — mixer container provided by the shell
   * @param {AudioEngine} engine   — AudioEngine.instance (decks a/b, crossfader)
   */
  constructor(container, engine) {
    this.container = container;
    this.engine = engine;
    /** @type {Map<string,{el:HTMLElement, sync:Function}>} id -> control */
    this._controls = new Map();
    this._dragging = null;          // control id currently under pointer drag
    this._killPrev = new Map();     // control id -> dB value before kill
    this._policy = '*';
    this._raf = 0;
    this._destroyed = false;
    this._vuPeak = { l: 0, r: 0 };
    this._vuLast = performance.now();

    this._build();

    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
  }

  // ------------------------------------------------------------------ build

  _build() {
    const root = document.createElement('div');
    root.className = 'mixer-pane';
    this.container.appendChild(root);
    this._root = root;

    const strips = document.createElement('div');
    strips.className = 'mixer-strips';
    root.appendChild(strips);

    strips.appendChild(this._buildChannel('a'));
    strips.appendChild(this._buildCenter());
    strips.appendChild(this._buildChannel('b'));

    root.appendChild(this._buildCrossfader());
  }

  _buildChannel(id) {
    const deck = this.engine.decks[id];
    const D = id === 'a' ? 'deckA' : 'deckB';
    const strip = document.createElement('div');
    strip.className = `mixer-channel mixer-channel-${id}`;

    const head = document.createElement('div');
    head.className = 'mixer-channel-label';
    head.textContent = id.toUpperCase();
    strip.appendChild(head);

    // GAIN — trim 0..2, double click = reset to 1
    strip.appendChild(this._makeKnob({
      id: `${D}.gain`, label: 'GAIN',
      min: 0, max: 2, def: 1,
      get: () => deck.gain,
      set: (v) => { deck.gain = v; },
      fmt: (v) => `${(20 * Math.log10(Math.max(v, 0.001))).toFixed(1)} dB`,
    }));

    // EQ — HIGH / MID / LOW, ±24 dB, double click / right click = kill (LED)
    for (const [band, label] of [['high', 'HIGH'], ['mid', 'MID'], ['low', 'LOW']]) {
      strip.appendChild(this._makeKnob({
        id: `${D}.${band}`, label,
        min: EQ_MIN, max: EQ_MAX, def: 0, kill: true,
        get: () => deck.eq[band],
        set: (v) => { deck.eq[band] = v; },
        fmt: (v) => (v <= KILL_DB + 1 ? 'KILL' : `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`),
      }));
    }

    // FILTER — bipolar −1..+1, double click = center (bypass)
    strip.appendChild(this._makeKnob({
      id: `${D}.filter`, label: 'FILTER',
      min: -1, max: 1, def: 0, bipolar: true,
      get: () => deck.filter,
      set: (v) => { deck.filter = v; },
      fmt: (v) => {
        if (Math.abs(v) < 0.02) return 'OFF';
        return v < 0 ? `LPF ${Math.round(-v * 100)}%` : `HPF ${Math.round(v * 100)}%`;
      },
    }));

    // Channel fader — 0..1 vertical
    strip.appendChild(this._makeChannelFader(id, D, deck));

    // PFL / cue de auriculars (v2)
    strip.appendChild(this._makePFL(id, D, deck));
    return strip;
  }

  // ------------------------------------------------------------------ PFL

  _makePFL(chId, D, deck) {
    const id = `${D}.pfl`;
    const wrap = document.createElement('div');
    wrap.className = 'mixer-pfl-wrap';
    wrap.dataset.control = id;
    const btn = document.createElement('button');
    btn.className = 'mixer-pfl-btn';
    btn.innerHTML = '<span class="mixer-pfl-ico">🎧</span>';
    btn.title = 'Pre-escolta (auriculars)';
    btn.setAttribute('data-midi-target', id);
    btn.addEventListener('click', () => {
      if (wrap.classList.contains('locked')) return;
      deck.pfl = !deck.pfl;
      btn.classList.toggle('active', deck.pfl);     // feedback instantani (<50ms)
    });
    wrap.appendChild(btn);
    this._controls.set(id, {
      el: wrap,
      press: () => { deck.pfl = !deck.pfl; btn.classList.toggle('active', deck.pfl); },
      sync: () => btn.classList.toggle('active', deck.pfl),
    });
    return wrap;
  }

  // -------------------------------------------------------------- knob

  _makeKnob({ id, label, min, max, def, get, set, fmt, kill = false, bipolar = false }) {
    const wrap = document.createElement('div');
    wrap.className = 'mixer-knob-wrap' + (bipolar ? ' mixer-knob-bipolar' : '');
    wrap.dataset.control = id;

    const lab = document.createElement('div');
    lab.className = 'mixer-knob-label';
    lab.textContent = label;

    const led = document.createElement('div');
    led.className = 'mixer-kill-led';
    if (!kill) led.classList.add('hidden');

    const knob = document.createElement('div');
    knob.className = 'mixer-knob';
    knob.dataset.midiTarget = id;
    knob.setAttribute('data-midi-target', id);
    const pointer = document.createElement('div');
    pointer.className = 'mixer-knob-pointer';
    knob.appendChild(pointer);

    const val = document.createElement('div');
    val.className = 'mixer-knob-value';

    wrap.append(led, knob, lab, val);

    const paint = (v) => {
      const deg = -135 + 270 * ((v - min) / (max - min));
      pointer.style.transform = `rotate(${deg}deg)`;
      val.textContent = fmt(v);
      if (kill) led.classList.toggle('on', v <= KILL_DB + 1);
    };
    paint(get());

    const apply = (v) => {
      v = clamp(v, kill ? KILL_DB : min, max);
      set(v);
      paint(v);
    };

    const locked = () => wrap.classList.contains('locked');

    knob.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || locked()) return;
      e.preventDefault();
      knob.setPointerCapture(e.pointerId);
      this._dragging = id;
      const startY = e.clientY;
      const startV = get();
      const range = max - min;
      const onMove = (ev) => {
        const fine = ev.shiftKey ? 0.2 : 1;
        apply(startV + (startY - ev.clientY) * (range / 160) * fine);
      };
      const onUp = (ev) => {
        knob.releasePointerCapture(ev.pointerId);
        knob.removeEventListener('pointermove', onMove);
        knob.removeEventListener('pointerup', onUp);
        knob.removeEventListener('pointercancel', onUp);
        this._dragging = null;
      };
      knob.addEventListener('pointermove', onMove);
      knob.addEventListener('pointerup', onUp);
      knob.addEventListener('pointercancel', onUp);
    });

    knob.addEventListener('wheel', (e) => {
      if (locked()) return;
      e.preventDefault();
      const step = (max - min) / (e.shiftKey ? 400 : 100);
      apply(get() + (e.deltaY < 0 ? step : -step));
    }, { passive: false });

    const doKill = () => {
      const cur = get();
      if (cur <= KILL_DB + 1) {
        apply(this._killPrev.get(id) ?? def);          // restore
      } else {
        this._killPrev.set(id, cur);
        apply(KILL_DB);                                 // kill
      }
    };

    knob.addEventListener('dblclick', (e) => {
      if (locked()) return;
      e.preventDefault();
      kill ? doKill() : apply(def);
    });

    knob.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (locked()) return;
      kill ? doKill() : apply(def);
    });

    this._controls.set(id, {
      el: wrap,
      sync: () => { if (this._dragging !== id) paint(get()); },
    });
    return wrap;
  }

  // ------------------------------------------------------------ channel fader

  _makeChannelFader(chId, D, deck) {
    const id = `${D}.fader`;
    const wrap = document.createElement('div');
    wrap.className = 'mixer-fader-wrap';
    wrap.dataset.control = id;

    const track = document.createElement('div');
    track.className = `mixer-fader-track mixer-fader-${chId}`;
    track.setAttribute('data-midi-target', id);
    const handle = document.createElement('div');
    handle.className = 'mixer-fader-handle';
    track.appendChild(handle);
    wrap.appendChild(track);

    const paint = (v) => { handle.style.bottom = `calc(${v * 100}% - ${v * 18}px)`; };
    paint(deck.fader);

    const fromEvent = (ev) => {
      const r = track.getBoundingClientRect();
      return clamp(1 - (ev.clientY - r.top) / r.height, 0, 1);
    };

    track.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || wrap.classList.contains('locked')) return;
      e.preventDefault();
      track.setPointerCapture(e.pointerId);
      this._dragging = id;
      const move = (ev) => { const v = fromEvent(ev); deck.fader = v; paint(v); };
      move(e);
      const up = (ev) => {
        track.releasePointerCapture(ev.pointerId);
        track.removeEventListener('pointermove', move);
        track.removeEventListener('pointerup', up);
        track.removeEventListener('pointercancel', up);
        this._dragging = null;
      };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
      track.addEventListener('pointercancel', up);
    });

    track.addEventListener('dblclick', () => {
      if (wrap.classList.contains('locked')) return;
      deck.fader = 1; paint(1);
    });

    this._controls.set(id, {
      el: wrap,
      sync: () => { if (this._dragging !== id) paint(deck.fader); },
    });
    return wrap;
  }

  // ------------------------------------------------------------------ center

  _buildCenter() {
    const center = document.createElement('div');
    center.className = 'mixer-center';

    const label = document.createElement('div');
    label.className = 'mixer-center-label';
    label.textContent = 'MASTER';
    center.appendChild(label);

    const vuWrap = document.createElement('div');
    vuWrap.className = 'mixer-vu-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'mixer-vu';
    vuWrap.appendChild(canvas);
    const lr = document.createElement('div');
    lr.className = 'mixer-vu-lr';
    lr.innerHTML = '<span>L</span><span>R</span>';
    vuWrap.appendChild(lr);
    center.appendChild(vuWrap);

    this._vuCanvas = canvas;
    this._vuCtx = canvas.getContext('2d');
    this._ro = new ResizeObserver(() => this._sizeVU());
    this._ro.observe(vuWrap);

    center.appendChild(this._buildCueControls());
    return center;
  }

  /* ─── Cue: botó que obre el diàleg de sortides (v2) ────────── */

  _buildCueControls() {
    const box = document.createElement('div');
    box.className = 'mixer-cue-box';

    const btn = document.createElement('button');
    btn.className = 'mixer-cue-open';
    btn.innerHTML = '🎧 <span>SORTIDES</span>';
    btn.title = 'Configura les sortides d’àudio (màster i auriculars)';
    btn.addEventListener('click', () => this._openAudioDialog());
    box.appendChild(btn);

    // volum de cue accessible directament
    const vol = document.createElement('input');
    vol.type = 'range'; vol.min = '0'; vol.max = '1.2'; vol.step = '0.01'; vol.value = '0.9';
    vol.className = 'mixer-cue-vol';
    vol.title = 'Volum de pre-escolta (auriculars)';
    vol.addEventListener('input', () => this.engine.setCueVolume?.(Number(vol.value)));
    box.appendChild(vol);

    return box;
  }

  /* ─── Diàleg de sortides d'àudio (màster · cue · split) ────── */

  _openAudioDialog() {
    if (!this._audioDialog) this._buildAudioDialog();
    this._audioDialog.classList.add('open');
    this._populateDeviceSelects();
  }

  _closeAudioDialog() { this._audioDialog?.classList.remove('open'); }

  _buildAudioDialog() {
    const e = this.engine;
    const back = document.createElement('div');
    back.className = 'atdj-audio-dialog-backdrop';
    back.addEventListener('click', (ev) => { if (ev.target === back) this._closeAudioDialog(); });

    const dlg = document.createElement('div');
    dlg.className = 'atdj-audio-dialog';
    dlg.innerHTML = `
      <div class="atdj-ad-head">
        <h3>Sortides d’àudio</h3>
        <button class="atdj-ad-close" aria-label="Tanca">✕</button>
      </div>
      <p class="atdj-ad-note">Per monitoritzar de veritat necessites <b>dues sortides</b>: els altaveus per al màster i uns auriculars (o targeta USB) per al cue. El jack propi del portàtil sol substituir els altaveus — no serveix com a segona sortida.</p>
      <button class="atdj-ad-detect">🔍 Detecta dispositius</button>
      <label class="atdj-ad-row"><span>MÀSTER → altaveus</span></label>
      <select class="atdj-ad-master"></select>
      <label class="atdj-ad-row"><span>🎧 CUE → auriculars</span></label>
      <select class="atdj-ad-cue"></select>
      <div class="atdj-ad-split">
        <button class="atdj-ad-split-btn">Split Cue: OFF</button>
        <p class="atdj-ad-note">Amb <b>una sola sortida</b> + cable splitter (Y): màster→canal <b>L</b>, cue→canal <b>R</b>. Connecta L als altaveus i R als auriculars.</p>
      </div>`;

    back.appendChild(dlg);
    document.body.appendChild(back);
    this._audioDialog = back;

    this._masterSelect = dlg.querySelector('.atdj-ad-master');
    this._cueSelect = dlg.querySelector('.atdj-ad-cue');
    const splitBtn = dlg.querySelector('.atdj-ad-split-btn');

    dlg.querySelector('.atdj-ad-close').addEventListener('click', () => this._closeAudioDialog());
    dlg.querySelector('.atdj-ad-detect').addEventListener('click', async (ev) => {
      ev.target.disabled = true; ev.target.textContent = 'Detectant…';
      await e.unlockDevices?.();
      await this._populateDeviceSelects();
      ev.target.disabled = false; ev.target.textContent = '🔍 Detecta dispositius';
    });
    this._masterSelect.addEventListener('change', () => e.setMasterDevice?.(this._masterSelect.value || undefined));
    this._cueSelect.addEventListener('change', () => e.setCueDevice?.(this._cueSelect.value || undefined));

    if (!e.masterCanSetSink) this._masterSelect.disabled = true;
    if (!e.cuePFLSupported) this._cueSelect.disabled = true;

    splitBtn.addEventListener('click', () => {
      const on = e.setSplitCue?.(!e.splitCue);
      splitBtn.textContent = `Split Cue: ${on ? 'ON' : 'OFF'}`;
      splitBtn.classList.toggle('active', !!on);
    });
  }

  async _populateDeviceSelects() {
    const e = this.engine;
    const devs = (await e.listOutputDevices?.()) ?? [];
    const fill = (sel, current, defaultLabel) => {
      if (!sel) return;
      sel.innerHTML = '';
      const o0 = document.createElement('option');
      o0.value = ''; o0.textContent = defaultLabel;
      sel.appendChild(o0);
      for (const d of devs) {
        if (!d.deviceId || d.deviceId === 'default') continue;
        const o = document.createElement('option');
        o.value = d.deviceId; o.textContent = d.label;
        sel.appendChild(o);
      }
      sel.value = current || '';
    };
    fill(this._masterSelect, e.masterDeviceId, 'Sortida per defecte (altaveus)');
    fill(this._cueSelect, e.cueDeviceId, 'Sortida per defecte');
  }

  _sizeVU() {
    const c = this._vuCanvas;
    const r = c.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(2, Math.floor((r.width - 16) * dpr));
    const h = Math.max(2, Math.floor((r.height - 22) * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  _drawVU() {
    const ctx = this._vuCtx;
    const c = this._vuCanvas;
    if (!ctx || c.width < 4) return;
    const { l, r } = this.engine.getMasterLevels();

    // peak hold with decay
    const now = performance.now();
    const dt = Math.min(0.1, (now - this._vuLast) / 1000);
    this._vuLast = now;
    const decay = 0.5 * dt;
    this._vuPeak.l = Math.max(this._vuPeak.l - decay, l);
    this._vuPeak.r = Math.max(this._vuPeak.r - decay, r);

    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    const barW = Math.floor(W * 0.38);
    const gap = W - barW * 2;
    const segs = 24;
    const segH = H / segs;

    const drawBar = (x, level, peak) => {
      // perceptual curve so low levels remain visible
      const lv = Math.pow(clamp(level, 0, 1), 0.6);
      const lit = Math.round(lv * segs);
      for (let i = 0; i < segs; i++) {
        const frac = (i + 1) / segs;
        let color;
        if (frac > 0.9) color = '#ff4433';
        else if (frac > 0.72) color = '#ffb340';
        else color = '#38e07a';
        ctx.fillStyle = i < lit ? color : 'rgba(255,255,255,0.07)';
        const y = H - (i + 1) * segH;
        ctx.fillRect(x, y + segH * 0.18, barW, segH * 0.64);
      }
      const pv = Math.pow(clamp(peak, 0, 1), 0.6);
      if (pv > 0.01) {
        ctx.fillStyle = pv > 0.9 ? '#ff4433' : '#ffffff';
        ctx.fillRect(x, H - pv * H - 1, barW, 2);
      }
    };
    drawBar(0, l, this._vuPeak.l);
    drawBar(barW + gap, r, this._vuPeak.r);
  }

  // -------------------------------------------------------------- crossfader

  _buildCrossfader() {
    const id = 'mixer.crossfader';
    const wrap = document.createElement('div');
    wrap.className = 'mixer-xfader-wrap';
    wrap.dataset.control = id;

    const labA = document.createElement('span');
    labA.className = 'mixer-xfader-lab mixer-xfader-lab-a';
    labA.textContent = 'A';
    const labB = document.createElement('span');
    labB.className = 'mixer-xfader-lab mixer-xfader-lab-b';
    labB.textContent = 'B';

    const track = document.createElement('div');
    track.className = 'mixer-xfader-track';
    track.setAttribute('data-midi-target', id);
    const handle = document.createElement('div');
    handle.className = 'mixer-xfader-handle';
    track.appendChild(handle);

    wrap.append(labA, track, labB);

    const paint = (v) => { handle.style.left = `calc(${v * 100}% - ${v * 34}px)`; };
    paint(this.engine.crossfader);

    const fromEvent = (ev) => {
      const r = track.getBoundingClientRect();
      return clamp((ev.clientX - r.left) / r.width, 0, 1);
    };

    track.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || wrap.classList.contains('locked')) return;
      e.preventDefault();
      track.setPointerCapture(e.pointerId);
      this._dragging = id;
      const move = (ev) => { const v = fromEvent(ev); this.engine.setCrossfader(v); paint(v); };
      move(e);
      const up = (ev) => {
        track.releasePointerCapture(ev.pointerId);
        track.removeEventListener('pointermove', move);
        track.removeEventListener('pointerup', up);
        track.removeEventListener('pointercancel', up);
        this._dragging = null;
      };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
      track.addEventListener('pointercancel', up);
    });

    track.addEventListener('dblclick', () => {
      if (wrap.classList.contains('locked')) return;
      this.engine.setCrossfader(0.5); paint(0.5);
    });

    this._controls.set(id, {
      el: wrap,
      sync: () => { if (this._dragging !== id) paint(this.engine.crossfader); },
    });
    return wrap;
  }

  // ------------------------------------------------------------------- rAF

  _tick() {
    if (this._destroyed) return;
    // reflect external state (MIDI, modes, examples) on idle controls.
    // try/catch: un throw transitori (layout inicial, dispositiu) mai
    // ha de matar el loop per a la resta de la sessió.
    try {
      for (const c of this._controls.values()) c.sync();
      this._drawVU();
    } catch (err) {
      if (!this._tickWarned) { this._tickWarned = true; console.error('[MixerPane] _tick', err); }
    }
    this._raf = requestAnimationFrame(this._tick);
  }

  // ------------------------------------------------------------ docent hooks

  /** @param {string[]|'*'} allow — control ids allowed; everything else locks */
  setControlPolicy(allow) {
    this._policy = allow;
    const all = allow === '*';
    const set = all ? null : new Set(allow);
    for (const [id, c] of this._controls) {
      c.el.classList.toggle('locked', !all && !set.has(id));
    }
  }

  /** @param {string} id @param {boolean} on */
  highlightControl(id, on) {
    const c = this._controls.get(id);
    if (c) c.el.classList.toggle('mission-highlight', !!on);
  }

  destroy() {
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    this._ro?.disconnect();
    this._audioDialog?.remove();
    this._root?.remove();
    this._controls.clear();
  }
}
