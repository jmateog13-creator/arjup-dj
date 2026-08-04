/* SAMPLER PANE · 8 pads + botón REC (§6/§8). Owner: UI-DECKS.
   Teclas 1–8 disparan pads (las registra main.js).
   Hooks docentes: setControlPolicy / highlightControl. */

const PAD_NAMES = [
  ['AIR', 'RWD', 'SCR', 'RISE', 'SUB', 'CLAP', 'LASER', 'BELL'],
  ['SIREN', 'HORN', 'RISE', 'DOWN', 'DROP', 'ZAP', 'SWEEP', 'CROWD'],
];

export class SamplerPane {
  /**
   * @param {HTMLElement} container #sampler-pane
   * @param {AudioEngine} engine (sampler + recorder)
   */
  constructor(container, engine) {
    this.engine = engine;
    this._controls = new Map();

    const root = document.createElement('div');
    root.className = 'sampler-pane';
    container.appendChild(root);
    this._root = root;

    const head = document.createElement('div');
    head.className = 'sampler-head';
    const title = document.createElement('span');
    title.className = 'sampler-title';
    title.textContent = 'SAMPLER';
    head.appendChild(title);

    // REC
    const recWrap = document.createElement('div');
    recWrap.className = 'sampler-rec-wrap';
    recWrap.dataset.control = 'mixer.rec';
    this._recBtn = document.createElement('button');
    this._recBtn.className = 'sampler-rec';
    this._recBtn.textContent = 'REC';
    this._recBtn.setAttribute('data-midi-target', 'mixer.rec');
    this._recBtn.addEventListener('click', () => {
      if (recWrap.classList.contains('locked')) return;
      const rec = engine.recorder;
      if (!rec) return;
      rec.recording ? rec.stop() : rec.start();
    });
    recWrap.appendChild(this._recBtn);

    // conmutador de banco (kit original ↔ FX)
    const bankWrap = document.createElement('div');
    bankWrap.className = 'sampler-bank-wrap';
    bankWrap.dataset.control = 'sampler.bank';
    this._bankBtn = document.createElement('button');
    this._bankBtn.className = 'sampler-bank';
    this._bankBtn.textContent = 'B1';
    this._bankBtn.title = 'Banc de pads: B1 kit · B2 FX';
    this._bankBtn.setAttribute('data-midi-target', 'sampler.bank');
    this._bankBtn.addEventListener('click', () => {
      if (bankWrap.classList.contains('locked')) return;
      this.nextBank();
    });
    bankWrap.appendChild(this._bankBtn);
    this._controls.set('sampler.bank', { el: bankWrap, press: () => this.nextBank() });

    head.append(bankWrap, recWrap);
    this._controls.set('mixer.rec', { el: recWrap });
    root.appendChild(head);

    engine.recorder?.addEventListener('start', () => this._recBtn.classList.add('recording'));
    engine.recorder?.addEventListener('stop', () => this._recBtn.classList.remove('recording'));

    // pads
    const grid = document.createElement('div');
    grid.className = 'sampler-grid';
    this._pads = [];
    for (let i = 0; i < 8; i++) {
      const id = `sampler.pad${i + 1}`;
      const wrap = document.createElement('div');
      wrap.className = 'sampler-pad-wrap';
      wrap.dataset.control = id;
      const pad = document.createElement('button');
      pad.className = 'sampler-pad';
      pad.setAttribute('data-midi-target', id);
      pad.innerHTML = `<span class="sampler-pad-num">${i + 1}</span><span class="sampler-pad-name">${PAD_NAMES[0][i]}</span>`;
      pad.addEventListener('click', () => {
        if (wrap.classList.contains('locked')) return;
        this.trigger(i);
      });
      wrap.appendChild(pad);
      grid.appendChild(wrap);
      this._pads.push(pad);
      this._controls.set(id, { el: wrap, press: () => this.trigger(i) });
    }
    root.appendChild(grid);
  }

  /** Rota al siguiente banco de pads y reetiqueta la rejilla. */
  async nextBank() {
    const s = this.engine.sampler;
    if (!s) return;
    const bank = (s.bank + 1) % s.bankCount;
    this._bankBtn.textContent = `B${bank + 1}`;
    this._bankBtn.classList.toggle('alt', bank > 0);
    const names = PAD_NAMES[bank] || PAD_NAMES[0];
    this._pads.forEach((pad, i) => {
      pad.querySelector('.sampler-pad-name').textContent = names[i];
    });
    await s.setBank(bank);
  }

  /** Dispara pad i con flash visual (también desde teclado/MIDI). */
  trigger(i) {
    if (i < 0 || i > 7) return;
    this.engine.sampler?.trigger(i);
    const pad = this._pads[i];
    pad.classList.remove('hit');
    void pad.offsetWidth;
    pad.classList.add('hit');
  }

  get controls() { return this._controls; }

  setControlPolicy(allow) {
    const all = allow === '*';
    const set = all ? null : new Set(allow);
    for (const [id, c] of this._controls) {
      c.el.classList.toggle('locked', !all && !set.has(id));
    }
  }

  highlightControl(id, on) {
    const c = this._controls.get(id);
    if (c) c.el.classList.toggle('mission-highlight', !!on);
  }

  destroy() { this._root.remove(); }
}

export default SamplerPane;
