/* ═══════════════════════════════════════════════════════════════
   LIBRARY · Pistas bundled + carga local (§2/§4).

   Owner: CORE-AUDIO.
   - Carga assets/tracks/tracks.json (404 tolerado → lista vacía).
   - decodeAudioData bajo demanda (ensureBuffer), con caché.
   - Peaks se calculan tras el primer decode (bundled) o en el
     análisis completo (local: BPMDetector + Peaks).

   Track = { title, artist, bpm, key, duration, firstBeat,
             file?, buffer?, peaks?, local?, ensureBuffer() }

   Eventos: 'tracks-changed' · 'analyzing' {file, stage, progress}
═══════════════════════════════════════════════════════════════ */

import { BPMDetector } from '../analysis/BPMDetector.js';
import { Peaks } from '../analysis/Peaks.js';
import { KeyDetector } from '../analysis/KeyDetector.js';

const TRACKS_URL = 'assets/tracks/tracks.json';
const TRACKS_BASE = 'assets/tracks/';

/** Basura típica de los nombres de archivo descargados/rippeados. */
const NOISE_RE = /[([]\s*(official|video|audio|music|lyric[s]?|hd|4k|full|mv|clip|remaster(ed)?|visualizer|con letra|letra)[^)\]]*[)\]]/gi;

/**
 * "Artista - Títol (Official Video) [HD].mp3" → {artist, title}.
 * Sense guió, tot el nom és el títol i l'artista queda "—".
 */
export function parseFilename(name) {
  let s = name.replace(/\.[^.]+$/, '')      // extensió
    .replace(/^\d{1,3}[\s._-]+(?=\D)/, '')  // "07 - " de numeració d'àlbum
    .replace(NOISE_RE, '')
    .replace(/\s*[-–—]\s*\S+[\s.](com|net|org)\s*$/i, '')  // "- FooMusic com" de rips
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const m = s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!m) return { title: s || name, artist: '—' };
  return { artist: m[1].trim(), title: m[2].trim() || s };
}

export class Library extends EventTarget {
  /** @param {AudioEngine} engine tras init() */
  constructor(engine) {
    super();
    this.engine = engine;
    this.tracks = [];
    this._seen = new Set();   // name|size → evita duplicats en re-arrossegar carpeta
    this._batch = null;       // {i, n} durant una importació múltiple
  }

  async init() {
    try {
      const res = await fetch(TRACKS_URL);
      if (res.ok) {
        const meta = await res.json();
        this.tracks = meta.map((m) => this._makeTrack(m));
      }
    } catch { /* sin pack bundled: browser vacío */ }
    this.dispatchEvent(new CustomEvent('tracks-changed'));
    return this;
  }

  _makeTrack(m) {
    const track = {
      title: m.title ?? m.file,
      artist: m.artist ?? '—',
      bpm: Number(m.bpm) || 0,
      key: m.key ?? '—',
      camelot: m.camelot ?? KeyDetector.camelotOf(m.key),
      duration: Number(m.duration) || 0,
      firstBeat: Number(m.firstBeat) || 0,
      file: m.file,
      buffer: null,
      peaks: null,
      local: false,
    };
    track.ensureBuffer = async () => {
      if (track.buffer) return track.buffer;
      const res = await fetch(TRACKS_BASE + track.file);
      if (!res.ok) throw new Error(`No es pot carregar ${track.file}`);
      const raw = await res.arrayBuffer();
      track.buffer = await this.engine.ctx.decodeAudioData(raw);
      track.duration = track.buffer.duration;
      if (!track.peaks) {
        track.peaks = await Peaks.compute(track.buffer, { bpm: track.bpm });
      }
      return track.buffer;
    };
    return track;
  }

  /**
   * Carga un archivo local (Sandbox): decode + BPM detect + peaks.
   * @param {File} file
   * @returns {Promise<object>} track añadido
   */
  async addLocalFile(file) {
    const emit = (stage, progress) =>
      this.dispatchEvent(new CustomEvent('analyzing', {
        detail: { file: file.name, stage, progress, batch: this._batch },
      }));

    emit('decode', 0);
    const raw = await file.arrayBuffer();
    const buffer = await this.engine.ctx.decodeAudioData(raw);

    emit('bpm', 0.35);
    const { bpm, firstBeat, confidence } = await BPMDetector.detect(buffer);

    emit('peaks', 0.65);
    const peaks = await Peaks.compute(buffer, { bpm: bpm || undefined });

    emit('key', 0.85);
    const { key, camelot, confidence: keyConf } = await KeyDetector.detect(buffer);

    const { title, artist } = parseFilename(file.name);
    const track = {
      title,
      artist,
      bpm: bpm ? Math.round(bpm * 100) / 100 : 0,
      key,
      camelot,
      keyConfidence: keyConf,
      duration: buffer.duration,
      firstBeat,
      confidence,
      file: file.name,
      buffer: null,          // s'allibera després de l'anàlisi (veure _evictBuffers)
      peaks,
      local: true,
      handle: file,
    };
    // Re-decodifica des del File quan cal sonar. Un set de 100 pistes en RAM
    // decodificades són desenes de GB: només els decks carregats mantenen buffer.
    track.ensureBuffer = async () => {
      if (!track.buffer) track.buffer = await this.engine.ctx.decodeAudioData(await file.arrayBuffer());
      return track.buffer;
    };
    this._seen.add(`${file.name}|${file.size}`);
    this.tracks.push(track);
    emit('done', 1);
    this.dispatchEvent(new CustomEvent('tracks-changed'));
    return track;
  }

  /**
   * Importa muchos archivos (carpeta arrastrada o selección múltiple):
   * cola secuencial, ordenada por nombre, sin duplicados, tolerante a fallos.
   * @param {File[]|FileList} files
   * @returns {Promise<number>} pistas realmente añadidas
   */
  async addFiles(files) {
    const seen = new Set(this._seen);   // també dedupe dins del mateix lot
    const list = [...files]
      .filter((f) => {
        const k = `${f.name}|${f.size}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ca', { numeric: true }));
    let added = 0;
    for (let i = 0; i < list.length; i++) {
      this._batch = { i: i + 1, n: list.length };
      try { await this.addLocalFile(list[i]); added++; }
      catch (err) { console.warn('[Library] anàlisi fallida', list[i].name, err); }
    }
    this._batch = null;
    if (list.length) this.dispatchEvent(new CustomEvent('analyzing', { detail: { stage: 'done', progress: 1 } }));
    return added;
  }

  /** Carga completa de un track en un deck (decode + peaks si faltan). */
  async loadToDeck(track, deck) {
    await track.ensureBuffer();
    await deck.load(track);
    this._evictBuffers();
    return track;
  }

  /** Solo las pistas cargadas en un deck conservan su AudioBuffer decodificado. */
  _evictBuffers() {
    const live = new Set([this.engine.decks.a.track, this.engine.decks.b.track]);
    for (const t of this.tracks) if (!live.has(t)) t.buffer = null;
  }
}
