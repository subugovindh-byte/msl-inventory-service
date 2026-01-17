import { fetchJson, fetchExpectOk, makeTable, formField, showToast, agGridAvailable, addFallbackBanner, waitForAgGrid, getPersistedPageSize, setPersistedPageSize, bindGlobalSearch, cleanupRoot, registerCleanup, createBusyController, confirmUnsavedChanges, createDirtyTracker, enableAgGridResponsiveColumns } from '../utils.js';

export async function renderEvents(root) {
  cleanupRoot(root);
  // Ensure fresh render when called directly (not via router)
  while (root.firstChild) root.removeChild(root.firstChild);
  if (root && root.classList) root.classList.add('fade-in');
  const header = document.createElement('div'); header.className = 'view-header';
  const title = document.createElement('h2'); title.textContent = 'Events'; header.appendChild(title);
  root.appendChild(header);

  const rows = await fetchJson('/api/events');

  // Fallback when AG Grid is not available in module/global scope (wait briefly to avoid race)
  if (!(await waitForAgGrid(1200))) {
    const columns = [
      { key: 'id', label: 'ID' }, { key: 'ref_type', label: 'Ref Type' }, { key: 'ref_id', label: 'Ref ID' }, { key: 'event_type', label: 'Event Type' }, { key: 'payload', label: 'Payload' }, { key: 'created_at', label: 'Created' }
    ];
    const actions = [
      { label: '🗑️', title: 'Delete Event', ariaLabel: 'Delete Event', className: 'action-btn', onClick: async (r) => { if (!confirm('Delete event ' + r.id + '?')) return; try { await fetchExpectOk('/events/' + encodeURIComponent(r.id), { method: 'DELETE' }); showToast('Deleted event ' + r.id, 'success'); location.hash = '#events'; } catch (e) { showToast('Delete failed: ' + e, 'error'); } } }
    ];

    const toolbar = document.createElement('div'); toolbar.className = 'grid-toolbar';
    const btnCsv = document.createElement('button'); btnCsv.textContent = 'Export CSV';
    const btnXlsx = document.createElement('button'); btnXlsx.textContent = 'Export Excel'; btnXlsx.style.marginLeft = '8px';
    const pageSizeSel = document.createElement('select'); pageSizeSel.setAttribute('data-pagesize','true'); pageSizeSel.style.marginLeft = '8px';
    const quickInput = document.createElement('input'); quickInput.type = 'text'; quickInput.placeholder = 'Search...'; quickInput.style.marginLeft = '8px';
    const defaultPage = getPersistedPageSize('events', 20);
    [20,60,120,240].forEach(n => { const opt = document.createElement('option'); opt.value = String(n); opt.textContent = `Page ${n}`; if (n === defaultPage) opt.selected = true; pageSizeSel.appendChild(opt); });
    const addBtn = document.createElement('button'); addBtn.textContent = 'Log Event'; addBtn.style.marginLeft = '8px'; addBtn.onclick = () => showEventForm(root);
    toolbar.appendChild(btnCsv); toolbar.appendChild(btnXlsx); toolbar.appendChild(pageSizeSel); toolbar.appendChild(addBtn); toolbar.appendChild(quickInput); root.appendChild(toolbar);
    // Explicit fallback banner to clarify mode
    addFallbackBanner(root, 'Events');

    let term = '';
    let pageSize = defaultPage;
    let tableEl = null;
    const renderSimple = () => {
      const filtered = rows.filter(r => {
        if (!term) return true;
        const t = term.toLowerCase();
        return Object.keys(r).some(k => String(r[k] ?? '').toLowerCase().includes(t));
      });
      const page = filtered.slice(0, pageSize);
      const table = makeTable(columns, page, actions);
      if (tableEl) tableEl.remove();
      tableEl = table;
      root.appendChild(table);
    };
    renderSimple();
    registerCleanup(root, bindGlobalSearch(quickInput, (q) => { term = q || ''; renderSimple(); }));
    pageSizeSel.addEventListener('change', () => { pageSize = Number(pageSizeSel.value || defaultPage); setPersistedPageSize('events', pageSize); renderSimple(); });
    btnCsv.onclick = () => {
      const keys = columns.map(c => c.key).filter(Boolean);
      const filtered = rows.filter(r => { const t = term.toLowerCase(); return !t || Object.keys(r).some(k => String(r[k] ?? '').toLowerCase().includes(t)); }).slice(0, pageSize);
      const header = keys.join(',');
      const lines = filtered.map(r => keys.map(k => JSON.stringify(String(r[k] ?? ''))).join(','));
      const csv = [header].concat(lines).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'events.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    btnXlsx.onclick = () => {
      const keys = columns.map(c => c.key).filter(Boolean);
      const filtered = rows.filter(r => { const t = term.toLowerCase(); return !t || Object.keys(r).some(k => String(r[k] ?? '').toLowerCase().includes(t)); }).slice(0, pageSize);
      const out = filtered.map(r => { const o = {}; keys.forEach(k => o[k] = r[k]); return o; });
      // eslint-disable-next-line no-undef
      const ws = XLSX.utils.json_to_sheet(out);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Events'); XLSX.writeFile(wb, 'events.xlsx');
    };
    return;
  }

  const toolbar = document.createElement('div'); toolbar.className = 'grid-toolbar';
  const btnCsv = document.createElement('button'); btnCsv.textContent = 'Export CSV';
  const btnXlsx = document.createElement('button'); btnXlsx.textContent = 'Export Excel'; btnXlsx.style.marginLeft = '8px';
  const pageSizeSel = document.createElement('select'); pageSizeSel.setAttribute('data-pagesize','true'); pageSizeSel.style.marginLeft = '8px';
  const persistedPageSize = getPersistedPageSize('events', 20);
  ;[20,60,120,240].forEach(n => { const opt = document.createElement('option'); opt.value = String(n); opt.textContent = `Page ${n}`; if (n === persistedPageSize) opt.selected = true; pageSizeSel.appendChild(opt); });
  const quickInput = document.createElement('input'); quickInput.type = 'text'; quickInput.placeholder = 'Search...'; quickInput.style.marginLeft = '8px';
  const addBtn = document.createElement('button'); addBtn.textContent = 'Log Event'; addBtn.style.marginLeft = '8px'; addBtn.onclick = () => showEventForm(root);
  toolbar.appendChild(btnCsv); toolbar.appendChild(btnXlsx); toolbar.appendChild(pageSizeSel); toolbar.appendChild(addBtn); toolbar.appendChild(quickInput); root.appendChild(toolbar);

  const gridDiv = document.createElement('div'); gridDiv.className = 'ag-theme-alpine'; gridDiv.style.width = '100%';
  root.appendChild(gridDiv);

  const columnDefs = [
    { headerName: 'Actions', field: '_actions', pinned: 'left', width: 90, minWidth: 80, maxWidth: 110, suppressHeaderMenuButton: true, sortable: false, filter: false, resizable: false, cellRenderer: (p) => {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'action-btn'; btn.textContent = '🗑️'; btn.title = 'Delete Event'; btn.setAttribute('aria-label','Delete Event'); btn.onclick = async () => {
        const r = p.data; if (!confirm('Delete event ' + r.id + '?')) return;
        try { await fetchExpectOk('/events/' + encodeURIComponent(r.id), { method: 'DELETE' }); showToast('Deleted event ' + r.id, 'success'); location.hash = '#events'; } catch (e) { showToast('Delete failed: ' + e, 'error'); }
      };
      return btn;
    } },
    { headerName: 'ID', valueGetter: (p) => (p && p.node && typeof p.node.rowIndex === 'number') ? (p.node.rowIndex + 1) : '', width: 80, minWidth: 70, maxWidth: 90, pinned: 'left', suppressHeaderMenuButton: true, sortable: false, filter: false, resizable: false },
    { headerName: 'Event ID', field: 'id' },
    { headerName: 'Ref Type', field: 'ref_type' },
    { headerName: 'Ref ID', field: 'ref_id' },
    { headerName: 'Event Type', field: 'event_type' },
    { headerName: 'Payload', field: 'payload' },
    { headerName: 'Created', field: 'created_at' },
  ];

  const gridOptions = {
    columnDefs,
    rowData: rows,
    defaultColDef: { sortable: true, filter: true, resizable: true, minWidth: 110 },
    pagination: true,
    paginationPageSize: persistedPageSize,
    domLayout: 'autoHeight',
  };
  const gridApi = (window.agGrid.createGrid
    ? window.agGrid.createGrid(gridDiv, gridOptions)
    : new window.agGrid.Grid(gridDiv, gridOptions));

  enableAgGridResponsiveColumns(root, gridApi, gridOptions);

  // Wire toolbar controls
  registerCleanup(root, bindGlobalSearch(quickInput, (q) => {
    if (gridApi && gridApi.setGridOption) gridApi.setGridOption('quickFilterText', q || '');
  }));
  pageSizeSel.addEventListener('change', () => {
    const v = Number(pageSizeSel.value || persistedPageSize);
    if (gridApi && gridApi.setGridOption) gridApi.setGridOption('paginationPageSize', v);
    setPersistedPageSize('events', v);
  });

  btnCsv.onclick = () => { gridApi.exportDataAsCsv({ fileName: 'events.csv' }); };
  btnXlsx.onclick = () => {
    const cols = columnDefs.filter(c => c.field && !c.cellRenderer).map(c => c.field);
    const out = [];
    gridApi.forEachNodeAfterFilterAndSort(node => { const obj = {}; cols.forEach(f => { obj[f] = node.data[f]; }); out.push(obj); });
    // eslint-disable-next-line no-undef
    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Events'); XLSX.writeFile(wb, 'events.xlsx');
  };
}

function showEventForm(root) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';

  const modalHeader = document.createElement('div');
  modalHeader.className = 'modal-header';
  const modalTitle = document.createElement('h3');
  modalTitle.textContent = 'Log Event';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.innerHTML = '&times;';
  modalHeader.appendChild(modalTitle);
  modalHeader.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body';

  const form = document.createElement('form');
  form.className = 'edit-form gx-edit-form';
  form.id = 'event-form-' + Math.random().toString(16).slice(2);

  let busy = null;

  const dirty = createDirtyTracker(form, { includeDisabled: true });

  async function closeAndRefresh() {
    if (busy && busy.isBusy && busy.isBusy()) return;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    try {
      if (typeof renderEvents === 'function') await renderEvents(root);
      else if (typeof window !== 'undefined' && typeof window.renderEvents === 'function') await window.renderEvents(root);
      else location.hash = '#events?' + Date.now();
    } catch (_) { location.hash = '#events?' + Date.now(); }
  }

  const guardedClose = async () => {
    if (busy && busy.isBusy && busy.isBusy()) {
      showToast('Please wait — saving in progress…', 'error');
      return;
    }
    if (dirty.isDirty()) {
      const choice = await confirmUnsavedChanges();
      if (choice === 'cancel') return;
      if (choice === 'save') {
        try {
          if (typeof form.requestSubmit === 'function') form.requestSubmit(save);
          else save.click();
        } catch (_) {}
        return;
      }
      // discard
    }
    await closeAndRefresh();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      guardedClose();
    }
  };
  function close() { guardedClose(); }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  closeBtn.onclick = close;

  form.appendChild(formField('ref_type', 'Ref type (qbids|blocks|slabs)', ''));
  form.appendChild(formField('ref_id', 'Ref id', ''));
  form.appendChild(formField('event_type', 'Event type', ''));
  const payloadField = formField('payload', 'Payload (JSON)', '{}');
  payloadField.classList.add('gx-span-2');
  form.appendChild(payloadField);

  const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Log';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  cancel.onclick = close;

  const actions = document.createElement('div');
  actions.className = 'gx-edit-actions';
  save.setAttribute('form', form.id);
  actions.appendChild(cancel);
  actions.appendChild(save);

  body.appendChild(form);
  body.appendChild(actions);
  modal.appendChild(modalHeader);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  busy = createBusyController({ form, primaryButton: save, secondaryButtons: [cancel, closeBtn] });

  // Snapshot after the form is fully built.
  try { dirty.markClean(); } catch (_) {}

  setTimeout(() => {
    const firstInput = form.querySelector('input, select, textarea');
    if (firstInput) firstInput.focus();
  }, 0);

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (busy && busy.isBusy && busy.isBusy()) return;
    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      let parsed = {};
      try {
        parsed = payload.payload ? JSON.parse(payload.payload) : {};
      } catch (jsonErr) {
        showToast('Invalid JSON in Payload field', 'error');
        try {
          const input = form.querySelector('input[name="payload"], textarea[name="payload"], #payload');
          if (input) input.focus();
        } catch (_) {}
        return;
      }

      if (busy && busy.setBusy) busy.setBusy(true, 'Logging…');
      await fetchExpectOk('/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref_type: payload.ref_type, ref_id: payload.ref_id, event_type: payload.event_type, payload: parsed }) });
      showToast('Event logged', 'success');
      if (busy && busy.setBusy) busy.setBusy(false);
      try { dirty.markClean(); } catch (_) {}
      await closeAndRefresh();
      location.hash = '#events';
    } catch (err) { showToast('Error: ' + (err && err.message ? err.message : err), 'error'); }
    finally { if (busy && busy.setBusy) busy.setBusy(false); }
  };
}
