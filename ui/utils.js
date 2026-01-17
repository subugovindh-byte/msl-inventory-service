// Common UI utilities and helpers
export async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
  return await res.json();
}

// Fetch a single slab by SLID
export async function fetchSlabById(slid) {
  const res = await fetch('/slabs/' + encodeURIComponent(slid));
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
  return await res.json();
}

// Fetch usage counts for a SLID across derived-product tables
export async function fetchSlabUsage(slid) {
  const res = await fetch('/slabs/' + encodeURIComponent(slid) + '/usage');
  if (!res.ok) {
    try { const j = await res.json(); throw new Error(j && j.error ? j.error : JSON.stringify(j)); } catch (_) { throw new Error(res.status + ' ' + res.statusText); }
  }
  return await res.json();
}

export async function fetchExpectOk(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    try {
      const j = await res.json();
      throw new Error(j && j.error ? j.error : JSON.stringify(j));
    } catch (_) {
      throw new Error(res.status + ' ' + res.statusText);
    }
  }
  try { return await res.json(); } catch (_) { return null; }
}

export function makeTable(columns, rows, actions, options = {}) {
  const includeSerial = (options && Object.prototype.hasOwnProperty.call(options, 'includeSerial'))
    ? !!options.includeSerial
    : true;

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  if (includeSerial) {
    const th = document.createElement('th');
    th.textContent = 'ID';
    trh.appendChild(th);
  }
  columns.forEach(c => {
    const th = document.createElement('th');
    const label = (typeof c === 'object' && c.label) ? c.label : (typeof c === 'object' ? c.key : c);
    th.textContent = label;
    trh.appendChild(th);
  });
  if (actions) { const th = document.createElement('th'); th.textContent = 'Actions'; trh.appendChild(th); }
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  rows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    if (includeSerial) {
      const td = document.createElement('td');
      td.textContent = String(idx + 1);
      tr.appendChild(td);
    }
    columns.forEach(c => {
      const key = (typeof c === 'object') ? c.key : c;
      const td = document.createElement('td');
      if (typeof c === 'object' && typeof c.render === 'function') {
        const result = c.render(r);
        if (result && typeof result === 'object' && typeof result.nodeType === 'number') {
          td.appendChild(result);
        } else {
          td.textContent = (result === undefined || result === null) ? '' : String(result);
        }
      } else {
        const v = r[key];
        td.textContent = (v === undefined || v === null) ? '' : String(v);
      }
      tr.appendChild(td);
    });
    if (actions) {
      const td = document.createElement('td');
      actions.forEach(a => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = a.label;
        const titleVal = typeof a.title === 'function' ? a.title(r) : a.title;
        if (titleVal) btn.title = titleVal;
        const ariaVal = typeof a.ariaLabel === 'function' ? a.ariaLabel(r) : a.ariaLabel;
        if (ariaVal) btn.setAttribute('aria-label', ariaVal);
        if (a.className) btn.className = a.className;
        const disabledVal = typeof a.disabled === 'function' ? a.disabled(r) : a.disabled;
        if (disabledVal) { btn.disabled = true; btn.setAttribute('aria-disabled','true'); }
        btn.onclick = () => a.onClick(r);
        btn.style.marginRight = '6px';
        td.appendChild(btn);
      });
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

export function formField(name, label, value = '', type = 'text') {
  const wrap = document.createElement('div'); wrap.className = 'form-row';
  const lab = document.createElement('label'); lab.textContent = label; lab.htmlFor = name;
  const input = document.createElement('input'); input.id = name; input.name = name; input.type = type; input.value = value === null ? '' : String(value || '');
  wrap.appendChild(lab); wrap.appendChild(input); return wrap;
}

export function formSelect(name, label, options = [], selected = '') {
  const wrap = document.createElement('div'); wrap.className = 'form-row';
  const lab = document.createElement('label'); lab.textContent = label; lab.htmlFor = name;
  const select = document.createElement('select'); select.id = name; select.name = name;
  const empty = document.createElement('option'); empty.value = ''; empty.textContent = '-- choose --'; select.appendChild(empty);
  options.forEach(o => { const opt = document.createElement('option'); opt.value = o.id || o.value || o; opt.textContent = o.name || o.label || o; if (String(opt.value) === String(selected)) opt.selected = true; select.appendChild(opt); });
  wrap.appendChild(lab); wrap.appendChild(select); return wrap;
}

export function addCostAutoCalc(form) {
  const g = form.querySelector('#gross_cost');
  const t = form.querySelector('#transport_cost');
  const o = form.querySelector('#other_cost');
  const total = form.querySelector('#total_cost');
  if (total) total.readOnly = true;
  function recalc() {
    const gv = g ? parseFloat(g.value) : 0;
    const tv = t ? parseFloat(t.value) : 0;
    const ov = o ? parseFloat(o.value) : 0;
    const sum = (isNaN(gv) ? 0 : gv) + (isNaN(tv) ? 0 : tv) + (isNaN(ov) ? 0 : ov);
    if (total) total.value = String(sum);
  }
  ['input','change'].forEach(ev => {
    if (g) g.addEventListener(ev, recalc);
    if (t) t.addEventListener(ev, recalc);
    if (o) o.addEventListener(ev, recalc);
  });
  recalc();
}

export function showToast(message, type = 'info', timeout = 2500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.remove(); if (!container.children.length) container.remove(); }, timeout);
}

// Prevent double-submit and improve save UX.
// Usage:
//   const busy = createBusyController({ form, primaryButton: save, secondaryButtons: [cancel, closeBtn] });
//   if (busy.isBusy()) return;
//   busy.setBusy(true, 'Saving…');
//   try { await ... } finally { busy.setBusy(false); }
export function createBusyController({
  form = null,
  primaryButton = null,
  secondaryButtons = [],
} = {}) {
  let busy = false;
  const primaryText = primaryButton ? String(primaryButton.textContent || '') : '';

  function setDisabled(el, v) {
    if (!el) return;
    el.disabled = !!v;
    try { el.setAttribute('aria-disabled', v ? 'true' : 'false'); } catch (_) {}
  }

  function setBusy(nextBusy, busyText = 'Saving…') {
    busy = !!nextBusy;

    if (primaryButton) {
      setDisabled(primaryButton, busy);
      primaryButton.textContent = busy ? String(busyText || 'Saving…') : primaryText;
    }

    (secondaryButtons || []).forEach((b) => setDisabled(b, busy));

    if (form && form.elements && typeof form.elements.length === 'number') {
      try {
        Array.from(form.elements).forEach((el) => {
          if (!el) return;
          // Keep the primary/secondary buttons managed above.
          if (primaryButton && el === primaryButton) return;
          if ((secondaryButtons || []).some((b) => b && el === b)) return;
          // Only disable form controls.
          if (typeof el.disabled === 'boolean') el.disabled = busy;
        });
      } catch (_) {}
    }
  }

  function isBusy() {
    return busy;
  }

  return { isBusy, setBusy };
}

// Snapshot form values for dirty-tracking.
// Unlike FormData, can include disabled controls (important when the UI disables inputs during save).
export function snapshotFormValues(form, { includeDisabled = true } = {}) {
  const out = {};
  if (!form) return out;
  const elements = form.querySelectorAll('input, select, textarea');
  elements.forEach((el) => {
    if (!el || !el.name) return;
    if (!includeDisabled && el.disabled) return;

    if (el.type === 'checkbox') {
      out[el.name] = el.checked ? (el.value || 'on') : '';
      return;
    }
    if (el.type === 'radio') {
      // only record the selected value, but keep key stable
      if (el.checked) out[el.name] = el.value;
      else if (!Object.prototype.hasOwnProperty.call(out, el.name)) out[el.name] = '';
      return;
    }
    if (el.tagName === 'SELECT' && el.multiple) {
      const vals = Array.from(el.selectedOptions || []).map((o) => String(o && o.value ? o.value : '')).filter(Boolean);
      vals.sort();
      out[el.name] = vals;
      return;
    }
    out[el.name] = (el.value === undefined || el.value === null) ? '' : String(el.value);
  });
  return out;
}

export function createDirtyTracker(form, { includeDisabled = true } = {}) {
  let baseline = null;
  const snap = () => {
    try { return JSON.stringify(snapshotFormValues(form, { includeDisabled })); }
    catch (_) { return ''; }
  };

  function markClean() {
    baseline = snap();
  }

  function isDirty() {
    const current = snap();
    if (baseline === null) {
      baseline = current;
      return false;
    }
    return current !== baseline;
  }

  return { isDirty, markClean };
}

// Confirm close when there are unsaved changes.
// Returns one of: 'save' | 'discard' | 'cancel'
export function confirmUnsavedChanges({
  title = 'Unsaved changes',
  message = 'You have unsaved changes. Save before closing?',
  saveLabel = 'Save & Close',
  discardLabel = 'Discard',
  cancelLabel = 'Cancel',
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const modal = document.createElement('div');
    modal.className = 'modal';
    overlay.appendChild(modal);

    const header = document.createElement('div');
    header.className = 'modal-header';
    const hTitle = document.createElement('div');
    hTitle.style.fontWeight = '700';
    hTitle.textContent = String(title || 'Unsaved changes');
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '✕';
    header.appendChild(hTitle);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    const body = document.createElement('div');
    body.className = 'modal-body';
    const p = document.createElement('div');
    p.textContent = String(message || 'You have unsaved changes.');
    body.appendChild(p);

    const actions = document.createElement('div');
    actions.className = 'gx-edit-actions';
    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.textContent = String(cancelLabel || 'Cancel');
    const btnDiscard = document.createElement('button');
    btnDiscard.type = 'button';
    btnDiscard.textContent = String(discardLabel || 'Discard');
    const btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.textContent = String(saveLabel || 'Save & Close');

    actions.appendChild(btnCancel);
    actions.appendChild(btnDiscard);
    actions.appendChild(btnSave);
    body.appendChild(actions);
    modal.appendChild(body);

    function cleanup(next) {
      try { document.removeEventListener('keydown', onKey); } catch (_) {}
      overlay.remove();
      resolve(next);
    }

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup('cancel');
      }
    };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup('cancel');
    });

    closeBtn.onclick = () => cleanup('cancel');
    btnCancel.onclick = () => cleanup('cancel');
    btnDiscard.onclick = () => cleanup('discard');
    btnSave.onclick = () => cleanup('save');

    document.body.appendChild(overlay);
    setTimeout(() => {
      try { btnSave.focus(); } catch (_) {}
    }, 0);
  });
}

// --- Lightweight prompt modal (type-to-filter suggestions) -----------------

// Replacement for window.prompt() when we want autocomplete UX.
// Returns the chosen string, or null if cancelled.
export function promptWithSuggestions({
  title = 'Select',
  note = '',
  placeholder = 'Type to search…',
  suggestions = [],
  initialValue = '',
  maxSuggestions = 12,
} = {}) {
  return new Promise((resolve) => {
    const all = Array.isArray(suggestions)
      ? suggestions
        .map((s) => {
          if (s && typeof s === 'object' && (s.value || s.label)) {
            const value = String(s.value || '').trim();
            const label = String(s.label || s.value || '').trim();
            if (!value || !label) return null;
            return { value, label, searchText: (label + ' ' + value).toLowerCase() };
          }
          const v = String(s || '').trim();
          if (!v) return null;
          return { value: v, label: v, searchText: v.toLowerCase() };
        })
        .filter(Boolean)
      : [];

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'presentation');

    const modal = document.createElement('div');
    modal.className = 'modal gx-prompt-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', String(title || 'Select'));

    const header = document.createElement('div');
    header.className = 'modal-header';
    const h = document.createElement('strong');
    h.textContent = String(title || 'Select');
    const close = document.createElement('button');
    close.className = 'modal-close';
    close.type = 'button';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close');
    header.appendChild(h);
    header.appendChild(close);

    const body = document.createElement('div');
    body.className = 'modal-body';

    if (note) {
      const noteEl = document.createElement('div');
      noteEl.className = 'modal-note';
      noteEl.textContent = String(note);
      body.appendChild(noteEl);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = String(placeholder || 'Type to search…');
    input.className = 'gx-prompt-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = String(initialValue || '');
    body.appendChild(input);

    const hint = document.createElement('div');
    hint.className = 'gx-prompt-hint';
    hint.textContent = 'Tip: type a few characters, then press Enter.';
    body.appendChild(hint);

    const suggWrap = document.createElement('div');
    suggWrap.className = 'gx-prompt-suggestions';
    body.appendChild(suggWrap);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const btnOk = document.createElement('button');
    btnOk.type = 'button';
    btnOk.textContent = 'OK';
    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'secondary';
    btnCancel.textContent = 'Cancel';
    actions.appendChild(btnOk);
    actions.appendChild(btnCancel);
    body.appendChild(actions);

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      try { cleanup(); } catch (_) {}
      try { overlay.remove(); } catch (_) {}
      resolve(value);
    };

    const renderSuggestions = () => {
      const q = String(input.value || '').trim().toLowerCase();
      const matches = (!q)
        ? all.slice(0, maxSuggestions)
        : all.filter(o => o.searchText.includes(q)).slice(0, maxSuggestions);

      while (suggWrap.firstChild) suggWrap.removeChild(suggWrap.firstChild);

      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'gx-prompt-empty';
        empty.textContent = q ? 'No matches.' : (all.length ? 'Start typing to filter…' : 'No options.');
        suggWrap.appendChild(empty);
        return;
      }

      matches.forEach(o => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'gx-prompt-suggestion';
        b.textContent = o.label;
        b.onclick = () => {
          input.value = o.value;
          finish(o.value);
        };
        suggWrap.appendChild(b);
      });
    };

    const onKeyDown = (e) => {
      if (!e) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const typed = String(input.value || '').trim();
        if (!typed) {
          // If empty, accept first visible suggestion if any.
          const q = '';
          const matches = all.slice(0, maxSuggestions);
          finish(matches.length ? matches[0].value : null);
          return;
        }

        // Exact value match
        const exact = all.find(o => o.value === typed);
        if (exact) { finish(exact.value); return; }

        // If user typed a partial query, pick the top match.
        const q = typed.toLowerCase();
        const matches = all.filter(o => o.searchText.includes(q)).slice(0, maxSuggestions);
        if (matches.length) { finish(matches[0].value); return; }

        // Otherwise return raw input.
        finish(typed);
      }
    };

    const cleanup = () => {
      try { overlay.removeEventListener('click', onOverlayClick); } catch (_) {}
      try { close.removeEventListener('click', onCancel); } catch (_) {}
      try { btnCancel.removeEventListener('click', onCancel); } catch (_) {}
      try { btnOk.removeEventListener('click', onOk); } catch (_) {}
      try { input.removeEventListener('input', renderSuggestions); } catch (_) {}
      try { input.removeEventListener('keydown', onKeyDown); } catch (_) {}
    };

    const onCancel = () => finish(null);
    const onOk = () => {
      const v = String(input.value || '').trim();
      finish(v ? v : null);
    };
    const onOverlayClick = (e) => { if (e && e.target === overlay) finish(null); };

    overlay.addEventListener('click', onOverlayClick);
    close.addEventListener('click', onCancel);
    btnCancel.addEventListener('click', onCancel);
    btnOk.addEventListener('click', onOk);
    input.addEventListener('input', renderSuggestions);
    input.addEventListener('keydown', onKeyDown);

    renderSuggestions();
    setTimeout(() => {
      try { input.focus(); input.select(); } catch (_) {}
    }, 0);
  });
}

// --- Global search wiring ----------------------------------------------------

export function registerCleanup(root, fn) {
  if (!root || typeof fn !== 'function') return;
  if (!root.__modernexCleanups) root.__modernexCleanups = [];
  root.__modernexCleanups.push(fn);
}

export function cleanupRoot(root) {
  try {
    const list = root && root.__modernexCleanups;
    if (Array.isArray(list)) {
      list.splice(0).forEach(fn => {
        try { fn(); } catch (_) {}
      });
    }
  } catch (_) {}
}

export function getGlobalSearchInput() {
  try { return document.getElementById('global-search'); } catch (_) { return null; }
}

export function getGlobalSearchQuery() {
  const el = getGlobalSearchInput();
  return el ? String(el.value || '').trim() : '';
}

export function dispatchInventorySearch(query) {
  try {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('inventory:search', { detail: { query: String(query || '') } }));
  } catch (_) {}
}

export function setGlobalSearchQuery(query, { emit = false } = {}) {
  const q = String(query || '');
  const el = getGlobalSearchInput();
  if (el) el.value = q;
  if (emit) dispatchInventorySearch(q);
}

// Binds a local quick search input to the header search.
// - Keeps both inputs in sync
// - Calls applyQuery(query) on changes (from either input)
// Returns cleanup function.
export function bindGlobalSearch(localInput, applyQuery) {
  const safeApply = (q) => {
    try { if (typeof applyQuery === 'function') applyQuery(String(q || '')); } catch (_) {}
  };

  const initial = getGlobalSearchQuery();
  if (localInput) localInput.value = initial;
  safeApply(initial);

  const onEvent = (e) => {
    const q = e && e.detail && typeof e.detail.query === 'string' ? e.detail.query : '';
    if (localInput) localInput.value = q;
    safeApply(q);
  };

  const onLocalInput = () => {
    const q = localInput ? String(localInput.value || '') : '';
    setGlobalSearchQuery(q, { emit: true });
    // safeApply will run via the emitted event
  };

  const onLocalKeydown = (e) => {
    if (!e) return;
    if (e.key === 'Escape') {
      if (localInput) localInput.value = '';
      setGlobalSearchQuery('', { emit: true });
    }
  };

  try {
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('inventory:search', onEvent);
    }
  } catch (_) {}
  if (localInput && localInput.addEventListener) {
    localInput.addEventListener('input', onLocalInput);
    localInput.addEventListener('keydown', onLocalKeydown);
  }

  return () => {
    try {
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('inventory:search', onEvent);
      }
    } catch (_) {}
    if (localInput && localInput.removeEventListener) {
      localInput.removeEventListener('input', onLocalInput);
      localInput.removeEventListener('keydown', onLocalKeydown);
    }
  };
}

// Lightweight supplier search helper: fetch all suppliers and optionally filter by name token(s)
export async function fetchSuppliers(query = '') {
  const qs = String(query || '').trim().toLowerCase();
  const rows = await fetchJson('/api/suppliers');
  if (!qs) return rows;
  const tokens = qs.split(' ').map(s => s.trim()).filter(Boolean);
  return rows.filter(r => tokens.every(t => (String(r.name || '') + ' ' + String(r.contact || '') + ' ' + String(r.notes || '')).toLowerCase().includes(t)));
}

// Serialize form values into a plain object without relying on FormData.
// Works in both browser and jsdom environments.
export function serializeForm(form) {
  const data = {};
  const elements = form.querySelectorAll('input, select, textarea');
  elements.forEach(el => {
    if (!el.name) return;
    if (el.disabled) return;
    if (el.type === 'checkbox') {
      data[el.name] = el.checked ? (el.value || 'on') : '';
    } else if (el.type === 'radio') {
      if (el.checked) data[el.name] = el.value;
    } else {
      data[el.name] = el.value;
    }
  });
  return data;
}

// Utility: detect AG Grid availability (UMD exposed via window.agGrid)
export function agGridAvailable() {
  try {
    const ag = typeof window !== 'undefined' ? window.agGrid : undefined;
    return !!(ag && (ag.Grid || ag.createGrid));
  } catch (_) { return false; }
}

// Utility: wait briefly for AG Grid to load (handles script race conditions)
export async function waitForAgGrid(timeoutMs = 2000) {
  const start = Date.now();
  if (agGridAvailable()) return true;
  // If timers are not available (e.g., minimal jsdom), do a single check.
  if (typeof setInterval !== 'function' || typeof clearInterval !== 'function') {
    return agGridAvailable();
  }
  return await new Promise(resolve => {
    const iv = setInterval(() => {
      if (agGridAvailable()) { clearInterval(iv); resolve(true); }
      else if (Date.now() - start >= timeoutMs) { clearInterval(iv); resolve(false); }
    }, 50);
  });
}

// Persist page size per view using localStorage when available
export function getPersistedPageSize(viewName, fallback = 20) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const k = 'modernex.pagesize.' + String(viewName || 'default');
      const v = Number(window.localStorage.getItem(k));
      return v && v > 0 ? v : fallback;
    }
  } catch (_) {}
  return fallback;
}

export function setPersistedPageSize(viewName, value) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const k = 'modernex.pagesize.' + String(viewName || 'default');
      window.localStorage.setItem(k, String(value));
    }
  } catch (_) {}
}

// Utility: add a visible banner when AG Grid is not available
export function addFallbackBanner(root, viewName = 'View') {
  const banner = document.createElement('div');
  banner.className = 'filter-banner';
  const msg = document.createElement('span');
  msg.textContent = `${viewName}: AG Grid not available; showing basic table.`;
  banner.appendChild(msg);
  root.appendChild(banner);
}

// AG Grid: responsive column sizing
// - Auto-sizes non-pinned columns to content on first paint
// - Fits columns to viewport on resize
export function enableAgGridResponsiveColumns(root, gridApiOrGrid, gridOptions = {}, {
  autoSize = true,
  fitOnResize = true,
  debounceMs = 150,
} = {}) {
  const api = (gridApiOrGrid && gridApiOrGrid.api) ? gridApiOrGrid.api
    : (gridOptions && gridOptions.api) ? gridOptions.api
      : gridApiOrGrid;

  const columnApi = (api && api.columnApi) ? api.columnApi
    : (gridApiOrGrid && gridApiOrGrid.columnApi) ? gridApiOrGrid.columnApi
      : (gridOptions && gridOptions.columnApi) ? gridOptions.columnApi
        : null;

  const safeGetColId = (col) => {
    try {
      if (!col) return null;
      if (typeof col.getColId === 'function') return col.getColId();
      if (typeof col.colId === 'string') return col.colId;
      if (col.colDef && typeof col.colDef.field === 'string') return col.colDef.field;
      return null;
    } catch (_) { return null; }
  };

  const safeIsPinned = (col) => {
    try {
      if (!col) return false;
      if (typeof col.getPinned === 'function') return !!col.getPinned();
      if (col.colDef && col.colDef.pinned) return true;
      return false;
    } catch (_) { return false; }
  };

  const runAutoSize = () => {
    if (!autoSize || !columnApi) return;
    try {
      if (typeof columnApi.getAllColumns !== 'function') {
        if (typeof columnApi.autoSizeAllColumns === 'function') columnApi.autoSizeAllColumns(false);
        return;
      }
      const cols = columnApi.getAllColumns() || [];
      const ids = cols
        .filter((c) => {
          const id = safeGetColId(c);
          if (!id) return false;
          if (id === '_actions') return false;
          if (safeIsPinned(c)) return false;
          return true;
        })
        .map((c) => safeGetColId(c))
        .filter(Boolean);

      if (ids.length && typeof columnApi.autoSizeColumns === 'function') {
        columnApi.autoSizeColumns(ids, false);
      } else if (typeof columnApi.autoSizeAllColumns === 'function') {
        columnApi.autoSizeAllColumns(false);
      }
    } catch (_) {}
  };

  const runFit = () => {
    if (!api || typeof api.sizeColumnsToFit !== 'function') return;
    try { api.sizeColumnsToFit(); } catch (_) {}
  };

  // Initial sizing after first paint
  try {
    setTimeout(() => {
      runAutoSize();
      runFit();
    }, 0);
  } catch (_) {}

  // Resize handling
  if (fitOnResize && typeof window !== 'undefined' && window.addEventListener) {
    let t = null;
    const onResize = () => {
      try { if (t) clearTimeout(t); } catch (_) {}
      t = setTimeout(() => {
        runFit();
      }, Math.max(0, Number(debounceMs || 0)));
    };
    try { window.addEventListener('resize', onResize); } catch (_) {}
    registerCleanup(root, () => {
      try { window.removeEventListener('resize', onResize); } catch (_) {}
      try { if (t) clearTimeout(t); } catch (_) {}
      t = null;
    });
  }
}
