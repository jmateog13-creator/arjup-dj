/* ═══════════════════════════════════════════════════════════════
   MAIN · Bootstrap de AULATECH DJ (§8). Owner: UI-SHELL.

   Flujo: overlay "Activa el so" (gesto) → AudioEngine.init() →
   Library + ConsoleGraph + panes + ModesFacade + MIDI.
   Cada módulo se monta en try/catch: uno roto no tumba la mesa.
═══════════════════════════════════════════════════════════════ */

import { AudioEngine } from './core/AudioEngine.js';

const $ = (sel) => document.querySelector(sel);

async function boot() {
  const engine = await new AudioEngine().init();
  const app = { engine, panes: {} };
  window.atdj = app;                       // consola de depuración

  // ── Library ──
  try {
    const { Library } = await import('./core/Library.js');
    app.library = await new Library(engine).init();
  } catch (err) { console.warn('[main] Library', err); }

  // ── ConsoleGraph (adaptador shared_lib) ──
  try {
    const { ConsoleGraph } = await import('./core/ConsoleGraph.js');
    app.graph = new ConsoleGraph(engine);
  } catch (err) { console.warn('[main] ConsoleGraph', err); }

  // ── Waveform strips ──
  try {
    const { WaveformStrip } = await import('./ui/WaveformStrip.js');
    app.waveform = new WaveformStrip($('#waveform-strip'), engine.decks);
  } catch (err) { console.warn('[main] WaveformStrip', err); }

  // ── Deck panes ──
  try {
    const { DeckPane } = await import('./ui/DeckPane.js');
    const css = getComputedStyle(document.documentElement);
    app.panes.deckA = new DeckPane($('#deck-a'), engine.decks.a, css.getPropertyValue('--deck-a').trim() || '#38aaff');
    app.panes.deckB = new DeckPane($('#deck-b'), engine.decks.b, css.getPropertyValue('--deck-b').trim() || '#ff4433');
  } catch (err) { console.warn('[main] DeckPane', err); }

  // ── Mixer ──
  try {
    const { MixerPane } = await import('./ui/MixerPane.js');
    app.panes.mixer = new MixerPane($('#mixer'), engine);
  } catch (err) { console.warn('[main] MixerPane', err); }

  // ── Sampler + REC ──
  try {
    const { SamplerPane } = await import('./ui/SamplerPane.js');
    app.panes.sampler = new SamplerPane($('#sampler-pane'), engine);
  } catch (err) { console.warn('[main] SamplerPane', err); }

  // ── Browser ──
  try {
    const { BrowserPane } = await import('./ui/BrowserPane.js');
    app.panes.browser = new BrowserPane($('#browser'), app.library, engine);
    wireDragAndDrop(app);
  } catch (err) { console.warn('[main] BrowserPane', err); }

  // ── Crossfader → ConsoleGraph (los decks ya se auto-notifican) ──
  if (app.graph) {
    const origSet = engine.setCrossfader.bind(engine);
    engine.setCrossfader = (v) => { origSet(v); app.graph.notify('mixer', 'crossfader', engine.crossfader); };
  }

  // ── MIDI Learn ──
  try {
    const { midiLearn } = await import('./midi/MIDILearn.js');
    app.midi = midiLearn;
    registerMidiTargets(app);
    const btn = $('#midi-btn');
    btn?.addEventListener('click', async () => {
      const ok = await midiLearn.enable();
      if (!ok) { btn.title = 'Web MIDI no disponible en aquest navegador'; return; }
      const on = midiLearn.toggleLearnMode();
      btn.classList.toggle('active', !!on);
      btn.setAttribute('aria-pressed', String(!!on));
    });
    btn?.addEventListener('contextmenu', (e) => { e.preventDefault(); midiLearn.openDialog(); });
  } catch (err) { console.warn('[main] MIDILearn', err); }

  wireKeyboard(app);
}

/* ─── Drag & drop del browser a los decks ──────────────────── */

function wireDragAndDrop(app) {
  for (const [sel, deckId] of [['#deck-a', 'a'], ['#deck-b', 'b']]) {
    const zone = $(sel);
    if (!zone) continue;
    zone.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/atdj-track')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        zone.classList.add('drop-hover');
      }
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drop-hover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drop-hover');
      const i = parseInt(e.dataTransfer.getData('text/atdj-track'), 10);
      const track = app.panes.browser?.trackAt(i);
      if (track) app.panes.browser.loadTo(track, deckId);
    });
  }
}

/* ─── Registro de controles continuos para MIDI (pickup) ───── */

function registerMidiTargets(app) {
  const { engine, midi } = app;
  const decks = { deckA: engine.decks.a, deckB: engine.decks.b };
  for (const [D, deck] of Object.entries(decks)) {
    midi.register(`${D}.pitch`, {
      set: (v) => { deck.pitch = v * 0.16 - 0.08; },
      get: () => (deck.pitch + 0.08) / 0.16,
    });
    midi.register(`${D}.fader`, { set: (v) => { deck.fader = v; }, get: () => deck.fader });
    midi.register(`${D}.gain`, { set: (v) => { deck.gain = v * 2; }, get: () => deck.gain / 2 });
    for (const band of ['low', 'mid', 'high']) {
      midi.register(`${D}.${band}`, {
        set: (v) => { deck.eq[band] = v * 48 - 24; },
        get: () => (deck.eq[band] + 24) / 48,
      });
    }
    midi.register(`${D}.filter`, { set: (v) => { deck.filter = v * 2 - 1; }, get: () => (deck.filter + 1) / 2 });
    midi.register(`${D}.fx.wet`, { set: (v) => deck.fx?.setWet(v), get: () => deck.fx?.wet ?? 0 });
    midi.register(`${D}.fx.param`, { set: (v) => deck.fx?.setParam(v), get: () => deck.fx?.param ?? 0 });
    midi.register(`${D}.keylock`, { press: () => { deck.keylock = !deck.keylock; } });
    midi.register(`${D}.pfl`, { press: () => { deck.pfl = !deck.pfl; } });
  }
  midi.register('mixer.crossfader', {
    set: (v) => engine.setCrossfader(v),
    get: () => engine.crossfader,
  });
  // botones (play/cue/sync/hotcues/loops/pads) usan el fallback DOM
  // de MIDILearn via data-midi-target → click().
}

/* ─── Teclado: espai=PLAY A · ⏎=PLAY B · 1–8 pads ──────────── */

function wireKeyboard(app) {
  const { engine } = app;
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.code === 'Space') {
      e.preventDefault();
      const d = engine.decks.a;
      d.playing ? d.pause() : d.play();
    } else if (e.code === 'Enter') {
      e.preventDefault();
      const d = engine.decks.b;
      d.playing ? d.pause() : d.play();
    } else if (/^Digit[1-8]$/.test(e.code)) {
      app.panes.sampler?.trigger(Number(e.code.slice(5)) - 1);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   ENTRADA: landing → boot(). El clic a "Comença" ÉS el gest
   d'usuari que activa l'AudioContext. Taula lliure, sense modes.
═══════════════════════════════════════════════════════════════ */

const overlay = $('#audio-overlay');
const landingView = $('#start-landing');
const startBtn = $('#start-btn');

let _booting = false;
startBtn?.addEventListener('click', async () => {
  if (_booting) return;
  _booting = true;
  landingView?.classList.add('busy');
  try {
    await boot();
    overlay?.classList.add('closing');
    setTimeout(() => overlay?.remove(), 600);
  } catch (err) {
    console.error('[main] arrencada fallida', err);
    landingView?.classList.remove('busy');
    _booting = false;
  }
});
