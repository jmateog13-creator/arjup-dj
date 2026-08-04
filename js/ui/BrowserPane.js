/* ═══════════════════════════════════════════════════════════════
   BROWSER PANE · Biblioteca (§8). Owner: UI-MIXER.
   Tabla de la Library (title, artist, BPM, key, durada), doble
   click / botons →A →B / drag al deck per carregar, botó
   "Carrega àudio local" amb barra de progrés de l'anàlisi.
═══════════════════════════════════════════════════════════════ */

const AUDIO_RE = /\.(mp3|m4a|aac|mp4|wav|flac|ogg|oga|opus|aiff?|webm)$/i;

/** Recorre recursivament una entry del DataTransfer i acumula fitxers d'àudio. */
async function collectAudio(entry, out) {
  if (entry.isFile) {
    const f = await new Promise((res, rej) => entry.file(res, rej)).catch(() => null);
    if (f && AUDIO_RE.test(f.name) && !f.name.startsWith('.')) out.push(f);
    return;
  }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  for (;;) {
    // readEntries retorna com a molt 100 entrades per crida: cal repetir fins a buit
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej)).catch(() => []);
    if (!batch.length) break;
    for (const e of batch) await collectAudio(e, out);
  }
}

function fmtDur(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export class BrowserPane extends EventTarget {
  /**
   * @param {HTMLElement} container #browser
   * @param {Library} library
   * @param {AudioEngine} engine
   */
  constructor(container, library, engine) {
    super();
    this.library = library;
    this.engine = engine;
    this._controls = new Map();
    this._loading = new Set();

    const root = document.createElement('div');
    root.className = 'browser-pane';
    container.appendChild(root);
    this._root = root;

    // header: título + carga local + progreso
    const head = document.createElement('div');
    head.className = 'browser-head';
    const title = document.createElement('span');
    title.className = 'browser-title';
    title.textContent = 'BROWSER';

    const loadWrap = document.createElement('div');
    loadWrap.className = 'browser-load-wrap';
    loadWrap.dataset.control = 'browser.load';
    const loadBtn = document.createElement('button');
    loadBtn.className = 'browser-load-btn';
    loadBtn.textContent = 'Carrega àudio local';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.multiple = true;
    input.hidden = true;
    loadBtn.addEventListener('click', () => {
      if (loadWrap.classList.contains('locked')) return;
      input.click();
    });
    input.addEventListener('change', async () => {
      const files = [...input.files];
      input.value = '';
      await library.addFiles(files);
    });
    loadWrap.append(loadBtn, input);
    this._controls.set('browser.load', { el: loadWrap });

    this._progress = document.createElement('div');
    this._progress.className = 'browser-progress';
    this._progress.hidden = true;
    this._progressFill = document.createElement('div');
    this._progressFill.className = 'browser-progress-fill';
    this._progressLabel = document.createElement('span');
    this._progressLabel.className = 'browser-progress-label';
    this._progress.append(this._progressFill, this._progressLabel);

    head.append(title, this._progress, loadWrap);
    root.appendChild(head);

    // tabla
    this._tableWrap = document.createElement('div');
    this._tableWrap.className = 'browser-table-wrap';
    root.appendChild(this._tableWrap);

    this._wireFolderDrop(root, library);

    this._onTracks = () => this._renderTable();
    this._onAnalyzing = (e) => this._renderProgress(e.detail);
    library.addEventListener('tracks-changed', this._onTracks);
    library.addEventListener('analyzing', this._onAnalyzing);
    this._renderTable();
  }

  /** Arrossega carpetes (o fitxers) del Finder cap al browser. */
  _wireFolderDrop(root, library) {
    const hasFiles = (e) => e.dataTransfer?.types?.includes('Files');
    root.addEventListener('dragover', (e) => {
      if (!hasFiles(e) || root.classList.contains('locked')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      root.classList.add('drop-hover');
    });
    root.addEventListener('dragleave', (e) => {
      if (e.target === root) root.classList.remove('drop-hover');
    });
    root.addEventListener('drop', async (e) => {
      if (!hasFiles(e) || root.classList.contains('locked')) return;
      e.preventDefault();
      root.classList.remove('drop-hover');
      // items s'ha de llegir de forma síncrona, abans de qualsevol await
      const entries = [...e.dataTransfer.items]
        .map((it) => it.webkitGetAsEntry?.())
        .filter(Boolean);
      const files = [];
      if (entries.length) {
        for (const en of entries) await collectAudio(en, files);
      } else {
        files.push(...[...e.dataTransfer.files].filter((f) => AUDIO_RE.test(f.name)));
      }
      if (files.length) await library.addFiles(files);
    });
  }

  _renderProgress({ file, stage, progress, batch }) {
    const done = stage === 'done';
    this._progress.hidden = done;
    if (!done) {
      this._progressFill.style.width = `${Math.round(progress * 100)}%`;
      const n = batch ? `${batch.i}/${batch.n} · ` : '';
      this._progressLabel.textContent = `Analitzant ${n}${file}…`;
    }
  }

  _renderTable() {
    const wrap = this._tableWrap;
    wrap.innerHTML = '';
    const tracks = this.library.tracks;

    if (!tracks.length) {
      const empty = document.createElement('div');
      empty.className = 'browser-empty';
      empty.textContent = 'Cap pista disponible. Carrega àudio local o afegeix el pack de demostració.';
      wrap.appendChild(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'browser-table';
    table.innerHTML = `<thead><tr>
      <th></th><th>TITLE</th><th>ARTIST</th><th>BPM</th><th>KEY</th><th>TIME</th><th></th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');

    tracks.forEach((t, i) => {
      const tr = document.createElement('tr');
      tr.draggable = true;
      tr.innerHTML = `
        <td class="browser-num">${i + 1}</td>
        <td class="browser-t-title">${escapeHtml(t.title)}</td>
        <td>${escapeHtml(t.artist)}</td>
        <td class="browser-bpm">${t.bpm ? t.bpm.toFixed(2) : '—'}</td>
        <td>${escapeHtml(t.key)}${t.camelot && t.camelot !== '—' ? ` <span class="browser-camelot">${escapeHtml(t.camelot)}</span>` : ''}</td>
        <td>${t.duration ? fmtDur(t.duration) : '—'}</td>`;
      const actions = document.createElement('td');
      actions.className = 'browser-actions';
      for (const deckId of ['a', 'b']) {
        const b = document.createElement('button');
        b.className = `browser-to-deck browser-to-${deckId}`;
        b.textContent = `→${deckId.toUpperCase()}`;
        b.setAttribute('data-midi-target', `browser.load${deckId.toUpperCase()}.${i}`);
        b.addEventListener('click', (ev) => { ev.stopPropagation(); this._loadTo(t, deckId, tr); });
        actions.appendChild(b);
      }
      tr.appendChild(actions);

      // doble click → primer deck sense pista (o A)
      tr.addEventListener('dblclick', () => {
        const target = !this.engine.decks.a.track ? 'a' : (!this.engine.decks.b.track ? 'b' : 'a');
        this._loadTo(t, target, tr);
      });
      // drag → deck (main.js registra els drop targets als panes)
      tr.addEventListener('dragstart', (ev) => {
        ev.dataTransfer.setData('text/atdj-track', String(i));
        ev.dataTransfer.effectAllowed = 'copy';
      });
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  async _loadTo(track, deckId, row) {
    const key = `${track.title}→${deckId}`;
    if (this._loading.has(key)) return;
    this._loading.add(key);
    row?.classList.add('loading');
    try {
      await this.library.loadToDeck(track, this.engine.decks[deckId]);
      this.dispatchEvent(new CustomEvent('track-loaded', { detail: { track, deckId } }));
    } catch (err) {
      console.warn('[Browser] càrrega fallida', err);
    } finally {
      this._loading.delete(key);
      row?.classList.remove('loading');
    }
  }

  /** Permet a main.js resoldre un índex de drag a track. */
  trackAt(i) { return this.library.tracks[i] ?? null; }
  loadTo(track, deckId) { return this._loadTo(track, deckId, null); }

  get controls() { return this._controls; }

  setControlPolicy(allow) {
    const all = allow === '*';
    const set = all ? null : new Set(allow);
    for (const [id, c] of this._controls) {
      c.el.classList.toggle('locked', !all && !set.has(id));
    }
    // en lliçons restrictives també es bloqueja la taula
    this._tableWrap.classList.toggle('locked',
      !all && !set.has('browser.table'));
  }

  highlightControl(id, on) {
    if (id === 'browser.table') {
      this._tableWrap.classList.toggle('mission-highlight', !!on);
      return;
    }
    const c = this._controls.get(id);
    if (c) c.el.classList.toggle('mission-highlight', !!on);
  }

  destroy() {
    this.library.removeEventListener('tracks-changed', this._onTracks);
    this.library.removeEventListener('analyzing', this._onAnalyzing);
    this._root.remove();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default BrowserPane;
