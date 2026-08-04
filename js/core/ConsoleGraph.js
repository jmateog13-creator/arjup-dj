/* ═══════════════════════════════════════════════════════════════
   CONSOLE GRAPH · Adaptador GraphLike + ActionTimeline (§7).

   Owner: CORE-AUDIO.
   Puente entre la mesa y shared_lib (LevelManager/MasterAnalyzer
   esperan un grafo). La mesa son OPS FIJOS — nunca se crean ni
   destruyen: deckA/deckB (type 'deck'), mixer, sampler.

   - GraphLike: ops Map (type/family/getParam/params), wires [],
     exports [] (routing fijo).
   - EventTarget: re-emite 'param-changed' (throttle 100 ms para
     params continuos) — es lo que escucha LevelManager.
   - ActionTimeline en graph.timeline: snapshots cada 100 ms +
     helpers para retos temporales (§7).
═══════════════════════════════════════════════════════════════ */

const THROTTLE_MS = 100;
const SNAPSHOT_MS = 100;
const RING_SIZE = 4096;             // ~7 min de snapshots

/* ─── ActionTimeline ───────────────────────────────────────── */

export class ActionTimeline {
  constructor(graph) {
    this.graph = graph;
    this._ring = new Array(RING_SIZE);
    this._head = 0;
    this._count = 0;
    this._events = [];               // eventos discretos {t, op, param, value}
    this._interval = setInterval(() => this._snapshot(), SNAPSHOT_MS);
  }

  get _now() { return this.graph.engine?.ctx?.currentTime ?? performance.now() / 1000; }

  record(op, param, value) {
    this._events.push({ t: this._now, op, param, value });
    if (this._events.length > RING_SIZE) this._events.splice(0, RING_SIZE / 4);
  }

  _snapshot() {
    const g = this.graph;
    const a = g.ops.get('deckA'), b = g.ops.get('deckB'), m = g.ops.get('mixer');
    const snap = {
      t: this._now,
      aPlaying: a.getParam('playing'), bPlaying: b.getParam('playing'),
      aLow: a.getParam('low'), bLow: b.getParam('low'),
      aFader: a.getParam('fader'), bFader: b.getParam('fader'),
      aBPM: a.getParam('effectiveBPM'), bBPM: b.getParam('effectiveBPM'),
      crossfader: m.getParam('crossfader'),
    };
    this._ring[this._head] = snap;
    this._head = (this._head + 1) % RING_SIZE;
    if (this._count < RING_SIZE) this._count++;
  }

  /** Snapshots de los últimos `seconds` (orden cronológico). */
  window(seconds) {
    const from = this._now - seconds;
    const out = [];
    for (let i = 0; i < this._count; i++) {
      const idx = (this._head - 1 - i + RING_SIZE * 2) % RING_SIZE;
      const s = this._ring[idx];
      if (!s || s.t < from) break;
      out.push(s);
    }
    return out.reverse();
  }

  /** Eventos discretos de los últimos `seconds`. */
  events(seconds) {
    const from = this._now - seconds;
    return this._events.filter((e) => e.t >= from);
  }

  /** ¿op.param ha cumplido `predicate` de forma continua N segundos? */
  paramHeldFor(op, param, predicate, seconds) {
    const snaps = this.window(seconds);
    if (!snaps.length || snaps[0].t > this._now - seconds + SNAPSHOT_MS * 2 / 1000) {
      // no hay historia suficiente
      if (snaps.length < Math.floor((seconds * 1000) / SNAPSHOT_MS) - 2) return false;
    }
    const key = this._snapKey(op, param);
    if (key) return snaps.every((s) => predicate(s[key]));
    // fallback: valor actual mantenido si no hay eventos contrarios
    const cur = this.graph.ops.get(op)?.getParam(param);
    return predicate(cur) &&
      !this.events(seconds).some((e) => e.op === op && e.param === param && !predicate(e.value));
  }

  _snapKey(op, param) {
    const p = op === 'deckA' ? 'a' : op === 'deckB' ? 'b' : null;
    if (op === 'mixer' && param === 'crossfader') return 'crossfader';
    if (!p) return null;
    return { playing: `${p}Playing`, low: `${p}Low`, fader: `${p}Fader`, effectiveBPM: `${p}BPM` }[param] ?? null;
  }

  /** true si NUNCA (en la ventana) ambos decks con low>−20, fader>0.5 y playing. */
  noBassClash(seconds) {
    const snaps = this.window(seconds);
    return !snaps.some((s) =>
      s.aPlaying && s.bPlaying &&
      s.aLow > -20 && s.bLow > -20 &&
      s.aFader > 0.5 && s.bFader > 0.5);
  }

  /** Recorrido total del crossfader en la ventana (suma de |Δ|). */
  crossfaderTravel(seconds) {
    const snaps = this.window(seconds);
    let travel = 0;
    for (let i = 1; i < snaps.length; i++) travel += Math.abs(snaps[i].crossfader - snaps[i - 1].crossfader);
    return travel;
  }

  dispose() { clearInterval(this._interval); }
}

/* ─── Op fijo ──────────────────────────────────────────────── */

class ConsoleOp {
  constructor(type, name, getParam) {
    this.type = type;              // 'deck' | 'mixer' | 'sampler'
    this.family = 'DJ';
    this.name = name;
    this.getParam = getParam;
    this.params = new Map();       // sin oprefs en la mesa (opRefersToType → false)
  }
}

/* ─── ConsoleGraph ─────────────────────────────────────────── */

export class ConsoleGraph extends EventTarget {
  /** @param {AudioEngine} engine tras init() */
  constructor(engine) {
    super();
    this.engine = engine;
    this.wires = [];               // routing fijo (§7)
    this.exports = [];

    const deckParam = (deck) => (id) => {
      switch (id) {
        case 'playing':      return deck.playing ? 1 : 0;
        case 'bpm':          return deck.track?.bpm ?? 0;
        case 'effectiveBPM': return deck.effectiveBPM;
        case 'pitch':        return deck.pitch;
        case 'position':     return deck.position;
        case 'beatPhase':    return deck.beatPhase;
        case 'fader':        return deck.fader;
        case 'gain':         return deck.gain;
        case 'low':          return deck.eq.low;
        case 'mid':          return deck.eq.mid;
        case 'high':         return deck.eq.high;
        case 'filter':       return deck.filter;
        case 'loopActive':   return deck.loop.active ? 1 : 0;
        case 'loopBeats':    return deck.loop.beats;
        case 'hotCueCount':  return deck.hotCues.filter((c) => c != null).length;
        case 'trackLoaded':  return deck.track ? 1 : 0;
        case 'fxOn':         return deck.fx?.on ? 1 : 0;
        case 'fxId':         return deck.fx?.fxId ?? '';
        case 'fxWet':        return deck.fx?.wet ?? 0;
        default:             return undefined;
      }
    };

    this.ops = new Map([
      ['deckA', new ConsoleOp('deck', 'deckA', deckParam(engine.decks.a))],
      ['deckB', new ConsoleOp('deck', 'deckB', deckParam(engine.decks.b))],
      ['mixer', new ConsoleOp('mixer', 'mixer', (id) => {
        if (id === 'crossfader') return engine.crossfader;
        if (id === 'recording') return engine.recorder?.recording ? 1 : 0;
        return undefined;
      })],
      ['sampler', new ConsoleOp('sampler', 'sampler', (id) => {
        if (id === 'lastPad') return engine.sampler?.lastPad ?? -1;
        return undefined;
      })],
    ]);

    this.timeline = new ActionTimeline(this);

    // Re-emisión de param-changed de los decks (throttle continuo)
    this._lastEmit = new Map();
    this._onDeckParam = (opName) => (e) => {
      const { param, value } = e.detail;
      this.timeline.record(opName, param, value);
      this._emitThrottled(`${opName}.${param}`);
    };
    this._hA = this._onDeckParam('deckA');
    this._hB = this._onDeckParam('deckB');
    engine.decks.a.addEventListener('param-changed', this._hA);
    engine.decks.b.addEventListener('param-changed', this._hB);
  }

  /** Notifica cambios de mixer/sampler (los llama la UI o main.js). */
  notify(op, param, value) {
    this.timeline.record(op, param, value);
    this._emitThrottled(`${op}.${param}`);
  }

  _emitThrottled(key) {
    const now = performance.now();
    const last = this._lastEmit.get(key) ?? 0;
    if (now - last < THROTTLE_MS) return;
    this._lastEmit.set(key, now);
    this.dispatchEvent(new CustomEvent('param-changed', { detail: { key } }));
  }

  /* LevelManager llama removeOp con clearGraph:true — la mesa es fija. */
  removeOp() { /* noop: ops fijos */ }

  dispose() {
    this.timeline.dispose();
    this.engine.decks.a.removeEventListener('param-changed', this._hA);
    this.engine.decks.b.removeEventListener('param-changed', this._hB);
  }
}
