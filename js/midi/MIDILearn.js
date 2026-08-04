/**
 * MIDILearn — Web MIDI mapping layer for AULATECH DJ (contract §9).
 *
 * - Silent degradation: if the Web MIDI API is missing or permission is
 *   denied, the module stays inert (no throws, no console spam).
 * - Learn mode: `startLearn(targetId)` arms the module; the NEXT CC or
 *   Note-On received from any connected device is mapped to that target.
 *   `toggleLearnMode()` gives the header button a one-call flow: while
 *   armed, clicking any element with `data-midi-target` calls startLearn.
 * - CC → continuous control with soft-takeover ("pickup" mode): incoming
 *   values are ignored until the physical knob/fader reaches (or crosses)
 *   the current logical value, so nothing jumps.
 * - Note-On → button: calls the registered `press()` handler, or falls
 *   back to `element.click()` on the matching `[data-midi-target]`.
 * - Persistence: localStorage['atdj-midi-map'], keyed per device name.
 * - Dialog: mapping table (device / type / channel / number / target)
 *   with per-row clear and clear-all. Teaching strings in català via
 *   i18n/ca.js when available, with local català fallbacks.
 *
 * Public API (contract): enable(), startLearn(targetId), clear(targetId),
 * register(targetId, { set(v), press(), get() }), openDialog().
 */

const STORAGE_KEY = 'atdj-midi-map';
const LEARN_TIMEOUT_MS = 15000;
const PICKUP_THRESHOLD = 4 / 127; // |in − target| within ~4 CC steps engages

/* ------------------------------------------------------------------ i18n */

let CA = null;
// ca.js is owned by CONTENT; its shape is not part of this contract, so we
// probe common export shapes and keep català fallbacks either way.
import('../i18n/ca.js')
  .then((m) => { CA = m.default || m.ca || m.strings || m.i18n || null; })
  .catch(() => { /* silent degradation */ });

function t(key, fallback) {
  if (CA) {
    const midi = CA.midi;
    if (midi && typeof midi[key] === 'string') return midi[key];
    if (typeof CA[`midi.${key}`] === 'string') return CA[`midi.${key}`];
  }
  return fallback;
}

/* --------------------------------------------------------------- helpers */

function mapKey(kind, channel, number) {
  return `${kind}:${channel}:${number}`;
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function saveStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode — mappings simply won't persist */
  }
}

/* ---------------------------------------------------------------- class */

export class MIDILearn extends EventTarget {
  constructor() {
    super();

    /** @type {MIDIAccess|null} */
    this.access = null;
    this.enabled = false;
    this.supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

    /** targetId → { set?, press?, get? } — filled by the UI panes. */
    this._handlers = new Map();

    /** deviceName → { mapKey → { targetId, type, channel, number } } */
    this._store = loadStore();

    /** Last logical value (0..1) written per targetId — pickup reference. */
    this._values = new Map();

    /** `${device}::${mapKey}` → { engaged, lastIn } — soft-takeover state. */
    this._pickup = new Map();

    /** Learn state. */
    this._learnTarget = null;
    this._learnTimer = 0;

    /** Learn-mode (armed header button) state. */
    this._learnModeOn = false;
    this._onLearnClick = this._handleLearnClick.bind(this);

    /** Bound listeners so inputs are never double-bound. */
    this._boundInputs = new WeakSet();
    this._onMIDIMessage = this._handleMIDIMessage.bind(this);

    /** Dialog element (lazy). */
    this._dialog = null;
  }

  /* ------------------------------------------------------------- enable */

  /**
   * Request MIDI access. Safe to call unconditionally: resolves to `true`
   * if MIDI is live, `false` otherwise (unsupported browser, denied
   * permission, no devices). Never throws.
   */
  async enable() {
    if (this.enabled) return true;
    if (!this.supported) return false;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      return false; // permission denied / platform failure — stay inert
    }
    this.enabled = true;
    this._bindAllInputs();
    this.access.addEventListener('statechange', () => {
      this._bindAllInputs();
      this._refreshDialog();
      this.dispatchEvent(new CustomEvent('devices-changed', {
        detail: { devices: this.deviceNames() },
      }));
    });
    this.dispatchEvent(new CustomEvent('enabled'));
    return true;
  }

  deviceNames() {
    if (!this.access) return [];
    const names = [];
    this.access.inputs.forEach((input) => names.push(input.name || input.id));
    return names;
  }

  _bindAllInputs() {
    if (!this.access) return;
    this.access.inputs.forEach((input) => {
      if (this._boundInputs.has(input)) return;
      this._boundInputs.add(input);
      input.addEventListener('midimessage', this._onMIDIMessage);
    });
  }

  /* ----------------------------------------------------------- registry */

  /**
   * Central registry, filled by the panes for each `data-midi-target`.
   * @param {string} targetId  e.g. 'deckA.pitch'
   * @param {{set?:(v:number)=>void, press?:()=>void, get?:()=>number}} handler
   */
  register(targetId, handler) {
    if (!targetId || !handler) return;
    this._handlers.set(targetId, handler);
  }

  unregister(targetId) {
    this._handlers.delete(targetId);
  }

  /* -------------------------------------------------------------- learn */

  /**
   * Arm learn for one target: the next CC or Note-On received from any
   * device gets mapped to `targetId`. Auto-cancels after 15 s.
   */
  startLearn(targetId) {
    if (!targetId) return;
    this.cancelLearn();
    this._learnTarget = targetId;
    this._markLearnTarget(targetId, true);
    this._learnTimer = setTimeout(() => this.cancelLearn(), LEARN_TIMEOUT_MS);
    this.dispatchEvent(new CustomEvent('learn-start', { detail: { targetId } }));
    // Learning is pointless without access — try to enable lazily.
    if (!this.enabled) this.enable();
  }

  cancelLearn() {
    if (this._learnTimer) { clearTimeout(this._learnTimer); this._learnTimer = 0; }
    if (this._learnTarget) {
      this._markLearnTarget(this._learnTarget, false);
      const targetId = this._learnTarget;
      this._learnTarget = null;
      this.dispatchEvent(new CustomEvent('learn-cancel', { detail: { targetId } }));
    }
  }

  /**
   * Header-button flow: while learn mode is ON, clicking any element with
   * `data-midi-target` arms startLearn for it (and swallows the click so
   * the control does not actuate). Returns the new state.
   */
  toggleLearnMode(force) {
    const next = typeof force === 'boolean' ? force : !this._learnModeOn;
    if (next === this._learnModeOn) return next;
    this._learnModeOn = next;
    injectStyles();
    document.body.classList.toggle('midi-learn-mode', next);
    if (next) {
      document.addEventListener('click', this._onLearnClick, true);
      if (!this.enabled) this.enable();
    } else {
      document.removeEventListener('click', this._onLearnClick, true);
      this.cancelLearn();
    }
    this.dispatchEvent(new CustomEvent('learn-mode', { detail: { on: next } }));
    return next;
  }

  get learnModeOn() { return this._learnModeOn; }
  get learningTarget() { return this._learnTarget; }

  _handleLearnClick(e) {
    const el = e.target instanceof Element
      ? e.target.closest('[data-midi-target]')
      : null;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    this.startLearn(el.dataset.midiTarget);
  }

  _markLearnTarget(targetId, on) {
    injectStyles();
    document.querySelectorAll('[data-midi-target]').forEach((el) => {
      if (el.dataset.midiTarget === targetId) {
        el.classList.toggle('midi-learn-armed', on);
      } else if (on) {
        el.classList.remove('midi-learn-armed');
      }
    });
  }

  /* ------------------------------------------------------------ mapping */

  /** Remove every binding pointing at `targetId` (all devices). */
  clear(targetId) {
    let changed = false;
    for (const device of Object.keys(this._store)) {
      const maps = this._store[device];
      for (const key of Object.keys(maps)) {
        if (maps[key].targetId === targetId) {
          delete maps[key];
          changed = true;
        }
      }
      if (Object.keys(maps).length === 0) delete this._store[device];
    }
    if (changed) {
      saveStore(this._store);
      this._refreshDialog();
      this.dispatchEvent(new CustomEvent('cleared', { detail: { targetId } }));
    }
  }

  /** Remove one exact binding (used by the dialog rows). */
  clearBinding(device, key) {
    const maps = this._store[device];
    if (!maps || !maps[key]) return;
    const { targetId } = maps[key];
    delete maps[key];
    if (Object.keys(maps).length === 0) delete this._store[device];
    saveStore(this._store);
    this._refreshDialog();
    this.dispatchEvent(new CustomEvent('cleared', { detail: { targetId, device, key } }));
  }

  clearAll() {
    this._store = {};
    this._pickup.clear();
    saveStore(this._store);
    this._refreshDialog();
    this.dispatchEvent(new CustomEvent('cleared', { detail: { targetId: null } }));
  }

  /** Flat list of bindings for the dialog / debugging. */
  mappings() {
    const rows = [];
    for (const device of Object.keys(this._store)) {
      const maps = this._store[device];
      for (const key of Object.keys(maps)) {
        rows.push({ device, key, ...maps[key] });
      }
    }
    rows.sort((a, b) => a.device.localeCompare(b.device)
      || a.targetId.localeCompare(b.targetId));
    return rows;
  }

  _saveMapping(deviceName, kind, channel, number, targetId) {
    // A physical control maps to one target; a target may keep bindings on
    // several devices, but only one per device (VDJ behaviour): drop any
    // previous binding of this target on this same device first.
    const maps = this._store[deviceName] || (this._store[deviceName] = {});
    for (const key of Object.keys(maps)) {
      if (maps[key].targetId === targetId) delete maps[key];
    }
    const key = mapKey(kind, channel, number);
    maps[key] = { targetId, type: kind, channel, number };
    this._pickup.delete(`${deviceName}::${key}`);
    saveStore(this._store);
    this._refreshDialog();
    this.dispatchEvent(new CustomEvent('mapped', {
      detail: { device: deviceName, type: kind, channel, number, targetId },
    }));
  }

  /* ----------------------------------------------------- MIDI reception */

  _handleMIDIMessage(e) {
    const data = e.data;
    if (!data || data.length < 2) return;
    const status = data[0] & 0xf0;
    const channel = data[0] & 0x0f;
    const deviceName = (e.target && (e.target.name || e.target.id)) || 'MIDI';

    let kind = null;
    let number = 0;
    let value = 0;

    if (status === 0xb0) {                       // Control Change
      kind = 'cc';
      number = data[1];
      value = (data[2] || 0) / 127;
    } else if (status === 0x90 && (data[2] || 0) > 0) { // Note-On
      kind = 'note';
      number = data[1];
      value = data[2] / 127;
    } else if (status === 0x80 || (status === 0x90 && (data[2] || 0) === 0)) {
      return; // Note-Off — buttons act on Note-On only
    } else {
      return; // other messages (pitchbend, aftertouch…) out of v1 scope
    }

    // Learn intercepts the message instead of executing it.
    if (this._learnTarget) {
      const targetId = this._learnTarget;
      if (this._learnTimer) { clearTimeout(this._learnTimer); this._learnTimer = 0; }
      this._markLearnTarget(targetId, false);
      this._learnTarget = null;
      this._saveMapping(deviceName, kind, channel, number, targetId);
      this.dispatchEvent(new CustomEvent('learned', {
        detail: { targetId, device: deviceName, type: kind, channel, number },
      }));
      return;
    }

    const maps = this._store[deviceName];
    if (!maps) return;
    const key = mapKey(kind, channel, number);
    const binding = maps[key];
    if (!binding) return;

    if (kind === 'note') {
      this._press(binding.targetId);
    } else {
      this._applyCC(deviceName, key, binding.targetId, value);
    }
  }

  _press(targetId) {
    const handler = this._handlers.get(targetId);
    if (handler && typeof handler.press === 'function') {
      handler.press();
    } else {
      const el = document.querySelector(
        `[data-midi-target="${CSS.escape(targetId)}"]`,
      );
      if (el) el.click();
    }
    this._flash(targetId);
  }

  _applyCC(deviceName, key, targetId, incoming) {
    const handler = this._handlers.get(targetId);

    // Some controllers send CC from buttons: if the target only knows how
    // to be pressed, treat the rising edge past centre as a press.
    if (handler && !handler.set && typeof handler.press === 'function') {
      const stateKey = `${deviceName}::${key}`;
      const st = this._pickup.get(stateKey) || { engaged: false, lastIn: 0 };
      if (incoming >= 0.5 && st.lastIn < 0.5) handler.press();
      st.lastIn = incoming;
      this._pickup.set(stateKey, st);
      return;
    }

    // Soft takeover (pickup): ignore until the hardware reaches or crosses
    // the current logical value, then follow 1:1.
    const stateKey = `${deviceName}::${key}`;
    let st = this._pickup.get(stateKey);
    if (!st) { st = { engaged: false, lastIn: null }; this._pickup.set(stateKey, st); }

    if (!st.engaged) {
      const current = this._currentValue(targetId, handler);
      if (current == null) {
        st.engaged = true; // nothing to protect — engage immediately
      } else {
        const near = Math.abs(incoming - current) <= PICKUP_THRESHOLD;
        const crossed = st.lastIn != null
          && ((st.lastIn <= current && incoming >= current)
            || (st.lastIn >= current && incoming <= current));
        if (near || crossed) st.engaged = true;
      }
      st.lastIn = incoming;
      if (!st.engaged) return;
    }
    st.lastIn = incoming;

    this._values.set(targetId, incoming);
    if (handler && typeof handler.set === 'function') {
      handler.set(incoming);
      this._flash(targetId);
    }
  }

  _currentValue(targetId, handler) {
    if (handler && typeof handler.get === 'function') {
      const v = handler.get();
      if (typeof v === 'number' && Number.isFinite(v)) {
        return Math.min(1, Math.max(0, v));
      }
    }
    const v = this._values.get(targetId);
    return typeof v === 'number' ? v : null;
  }

  _flash(targetId) {
    const el = document.querySelector(
      `[data-midi-target="${CSS.escape(targetId)}"]`,
    );
    if (!el) return;
    injectStyles();
    el.classList.add('midi-active');
    clearTimeout(el._midiFlashTimer);
    el._midiFlashTimer = setTimeout(
      () => el.classList.remove('midi-active'), 120,
    );
  }

  /* -------------------------------------------------------------- dialog */

  openDialog() {
    injectStyles();
    if (!this._dialog) this._dialog = this._buildDialog();
    this._refreshDialog();
    if (!this._dialog.open) this._dialog.showModal();
  }

  closeDialog() {
    if (this._dialog && this._dialog.open) this._dialog.close();
  }

  _buildDialog() {
    const dlg = document.createElement('dialog');
    dlg.className = 'midi-dialog';
    dlg.innerHTML = `
      <header class="midi-dialog__header">
        <h2>${t('dialogTitle', 'Mapes MIDI')}</h2>
        <button type="button" class="midi-dialog__close" data-action="close"
                aria-label="${t('close', 'Tanca')}">&times;</button>
      </header>
      <p class="midi-dialog__status"></p>
      <div class="midi-dialog__tablewrap">
        <table class="midi-dialog__table">
          <thead>
            <tr>
              <th>${t('device', 'Dispositiu')}</th>
              <th>${t('type', 'Tipus')}</th>
              <th>CH</th>
              <th>#</th>
              <th>${t('target', 'Control')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <footer class="midi-dialog__footer">
        <button type="button" class="midi-dialog__clearall" data-action="clear-all">
          ${t('clearAll', 'Esborra tots els mapes')}
        </button>
      </footer>`;

    dlg.addEventListener('click', (e) => {
      const btn = e.target instanceof Element ? e.target.closest('[data-action]') : null;
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'close') this.closeDialog();
      else if (action === 'clear-all') this.clearAll();
      else if (action === 'clear-row') this.clearBinding(btn.dataset.device, btn.dataset.key);
    });

    document.body.appendChild(dlg);
    return dlg;
  }

  _refreshDialog() {
    if (!this._dialog) return;

    const status = this._dialog.querySelector('.midi-dialog__status');
    if (!this.supported) {
      status.textContent = t('unsupported',
        'Aquest navegador no suporta Web MIDI (prova Chrome o Edge).');
    } else if (!this.enabled) {
      status.textContent = t('disabled', 'MIDI no activat.');
    } else {
      const devices = this.deviceNames();
      status.textContent = devices.length
        ? `${t('connected', 'Dispositius connectats:')} ${devices.join(', ')}`
        : t('noDevices', 'Cap dispositiu MIDI connectat.');
    }

    const tbody = this._dialog.querySelector('tbody');
    tbody.textContent = '';
    const rows = this.mappings();

    if (rows.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.className = 'midi-dialog__empty';
      td.textContent = t('empty',
        'Cap mapa encara. Activa el mode Learn, clica un control de la taula i mou el control físic.');
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (const row of rows) {
      const tr = document.createElement('tr');

      const cells = [
        row.device,
        row.type === 'cc' ? 'CC' : 'NOTE',
        String(row.channel + 1),
        String(row.number),
        row.targetId,
      ];
      for (const text of cells) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      }

      const tdBtn = document.createElement('td');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'midi-dialog__clear';
      btn.dataset.action = 'clear-row';
      btn.dataset.device = row.device;
      btn.dataset.key = row.key;
      btn.textContent = t('clear', 'Esborra');
      tdBtn.appendChild(btn);
      tr.appendChild(tdBtn);

      tbody.appendChild(tr);
    }
  }
}

/* ------------------------------------------------- self-contained styles */

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'midi-learn-styles';
  style.textContent = `
    body.midi-learn-mode [data-midi-target] {
      outline: 1px dashed var(--accent, #ffb340);
      outline-offset: 2px;
      cursor: crosshair;
    }
    .midi-learn-armed {
      outline: 2px solid var(--accent, #ffb340) !important;
      outline-offset: 2px;
      animation: midi-learn-pulse 0.9s ease-in-out infinite;
    }
    @keyframes midi-learn-pulse {
      0%, 100% { outline-color: var(--accent, #ffb340); }
      50% { outline-color: transparent; }
    }
    .midi-active {
      box-shadow: 0 0 0 2px var(--accent, #ffb340);
      transition: box-shadow 0.12s ease-out;
    }
    dialog.midi-dialog {
      background: var(--panel, #161a22);
      color: #e8ecf4;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 0;
      min-width: min(560px, 92vw);
      max-height: 80vh;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
    }
    dialog.midi-dialog::backdrop {
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(4px);
    }
    .midi-dialog__header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 18px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .midi-dialog__header h2 {
      margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0.02em;
    }
    .midi-dialog__close {
      background: none; border: none; color: #9aa3b2;
      font-size: 20px; line-height: 1; cursor: pointer; padding: 2px 6px;
    }
    .midi-dialog__close:hover { color: #fff; }
    .midi-dialog__status {
      margin: 10px 18px 0; color: #9aa3b2; font-size: 12px;
    }
    .midi-dialog__tablewrap {
      overflow: auto; max-height: 48vh; margin: 10px 18px;
      border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px;
    }
    .midi-dialog__table {
      width: 100%; border-collapse: collapse; font-size: 12px;
    }
    .midi-dialog__table th, .midi-dialog__table td {
      padding: 7px 10px; text-align: left; white-space: nowrap;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .midi-dialog__table th {
      position: sticky; top: 0; background: var(--panel, #161a22);
      color: #9aa3b2; font-weight: 500; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    .midi-dialog__empty { color: #9aa3b2; white-space: normal; }
    .midi-dialog__clear, .midi-dialog__clearall {
      background: rgba(255, 255, 255, 0.06); color: #e8ecf4;
      border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px;
      padding: 3px 10px; font-size: 11px; cursor: pointer;
    }
    .midi-dialog__clear:hover, .midi-dialog__clearall:hover {
      background: rgba(255, 68, 51, 0.18); border-color: var(--deck-b, #ff4433);
    }
    .midi-dialog__footer {
      display: flex; justify-content: flex-end; padding: 0 18px 16px;
    }`;
  document.head.appendChild(style);
}

/** Shared singleton — main.js wires the header button and panes to this. */
export const midiLearn = new MIDILearn();
export default midiLearn;
