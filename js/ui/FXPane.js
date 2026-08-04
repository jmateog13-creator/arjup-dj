/* FX PANE · Rack de FX de un deck (§5/§8). Owner: UI-DECKS.
   Selector de efecto, dry/wet, param principal, botón ON.
   Habla solo con deck.fx (FXChain). */

import { FX_REGISTRY } from '../fx/FXChain.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class FXPane {
  /**
   * @param {HTMLElement} container
   * @param {Deck} deck
   * @param {string} D 'deckA'|'deckB' (prefijo de midi targets)
   */
  constructor(container, deck, D) {
    this.deck = deck;
    this._controls = new Map();
    const fx = deck.fx;

    const root = document.createElement('div');
    root.className = 'fx-pane';
    container.appendChild(root);
    this._root = root;

    const title = document.createElement('span');
    title.className = 'fx-title';
    title.textContent = 'FX';
    root.appendChild(title);

    // selector
    const sel = document.createElement('select');
    sel.className = 'fx-select';
    sel.setAttribute('data-midi-target', `${D}.fx.select`);
    for (const f of FX_REGISTRY) {
      const o = document.createElement('option');
      o.value = f.id;
      o.textContent = f.name;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => fx?.select(sel.value));
    root.appendChild(sel);
    this._controls.set(`${D}.fx.select`, { el: sel });

    // knobs dry/wet y param
    root.appendChild(this._miniKnob(`${D}.fx.wet`, 'WET', () => fx?.wet ?? 0.5, (v) => fx?.setWet(v)));
    root.appendChild(this._miniKnob(`${D}.fx.param`, 'PARAM', () => fx?.param ?? 0.5, (v) => fx?.setParam(v)));

    // ON
    const on = document.createElement('button');
    on.className = 'fx-on-btn';
    on.textContent = 'ON';
    on.setAttribute('data-midi-target', `${D}.fx.on`);
    on.addEventListener('click', () => {
      if (on.closest('.locked')) return;
      fx?.toggle();
    });
    root.appendChild(on);
    this._controls.set(`${D}.fx.on`, { el: on });

    if (fx) {
      this._onChanged = () => {
        on.classList.toggle('active', fx.on);
        sel.value = fx.fxId;
      };
      fx.addEventListener('changed', this._onChanged);
    } else {
      root.classList.add('fx-unavailable');
      sel.disabled = on.disabled = true;
    }
  }

  _miniKnob(id, label, get, set) {
    const wrap = document.createElement('div');
    wrap.className = 'fx-knob-wrap';
    wrap.dataset.control = id;
    const knob = document.createElement('div');
    knob.className = 'fx-knob';
    knob.setAttribute('data-midi-target', id);
    const ptr = document.createElement('div');
    ptr.className = 'fx-knob-pointer';
    knob.appendChild(ptr);
    const lab = document.createElement('span');
    lab.className = 'fx-knob-label';
    lab.textContent = label;
    wrap.append(knob, lab);

    const paint = (v) => { ptr.style.transform = `rotate(${-135 + 270 * v}deg)`; };
    paint(get());

    knob.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || wrap.classList.contains('locked')) return;
      e.preventDefault();
      knob.setPointerCapture(e.pointerId);
      const y0 = e.clientY, v0 = get();
      const move = (ev) => { const v = clamp(v0 + (y0 - ev.clientY) / 140, 0, 1); set(v); paint(v); };
      const up = (ev) => {
        knob.releasePointerCapture(ev.pointerId);
        knob.removeEventListener('pointermove', move);
        knob.removeEventListener('pointerup', up);
        knob.removeEventListener('pointercancel', up);
      };
      knob.addEventListener('pointermove', move);
      knob.addEventListener('pointerup', up);
      knob.addEventListener('pointercancel', up);
    });
    knob.addEventListener('wheel', (e) => {
      if (wrap.classList.contains('locked')) return;
      e.preventDefault();
      const v = clamp(get() + (e.deltaY < 0 ? 0.04 : -0.04), 0, 1);
      set(v); paint(v);
    }, { passive: false });

    this._controls.set(id, { el: wrap, set: (v) => { set(v); paint(v); }, get });
    return wrap;
  }

  get controls() { return this._controls; }

  dispose() {
    if (this._onChanged) this.deck.fx?.removeEventListener('changed', this._onChanged);
    this._root.remove();
  }
}

export default FXPane;
