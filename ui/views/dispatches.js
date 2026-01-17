import { fetchJson, fetchExpectOk, makeTable, formField, showToast, agGridAvailable, addFallbackBanner, waitForAgGrid, getPersistedPageSize, setPersistedPageSize, bindGlobalSearch, cleanupRoot, registerCleanup, createBusyController, confirmUnsavedChanges, createDirtyTracker, enableAgGridResponsiveColumns } from '../utils.js';

export async function renderDispatches(root) {
  cleanupRoot(root);
  // Ensure fresh render when called directly (not via router)
  while (root.firstChild) root.removeChild(root.firstChild);
  if (root && root.classList) root.classList.add('fade-in');
  const header = document.createElement('div'); header.className = 'view-header';
  const title = document.createElement('h2'); title.textContent = 'Dispatches'; header.appendChild(title);
  root.appendChild(header);

  const onScanned = (e) => {
    const d = e && e.detail ? e.detail : null;
    if (!d || d.action !== 'create' || d.view !== 'dispatches') return;
    const slid = d.slid ? String(d.slid).trim() : '';
    const itemType = d.item_type ? String(d.item_type).trim() : '';
    const itemId = d.item_id ? String(d.item_id).trim() : '';
    if (!slid && !(itemType && itemId)) return;
    try { showDispatchForm(root, { slid, item_type: itemType, item_id: itemId }); } catch (_) {}
  };
  window.addEventListener('inventory:scanned', onScanned);
  registerCleanup(root, () => window.removeEventListener('inventory:scanned', onScanned));

  const rows = await fetchJson('/api/dispatches');

  // Fallback when AG Grid is not available in module/global scope (wait briefly to avoid race)
  if (!(await waitForAgGrid(1200))) {
    const columns = [
      { key: 'id', label: 'ID' }, { key: 'slid', label: 'SLID' }, { key: 'customer', label: 'Customer' }, { key: 'bundle_no', label: 'Bundle No' }, { key: 'container_no', label: 'Container No' }, { key: 'dispatched_at', label: 'Dispatched' }
    ];
    const actions = [
      { label: '🗑️', title: 'Delete Dispatch', ariaLabel: 'Delete Dispatch', className: 'action-btn', onClick: async (r) => { if (!confirm('Delete dispatch ' + r.id + '?')) return; try { await fetchExpectOk('/dispatches/' + encodeURIComponent(r.id), { method: 'DELETE' }); showToast('Deleted dispatch ' + r.id, 'success'); location.hash = '#dispatches'; } catch (e) { showToast('Delete failed: ' + e, 'error'); } } }
    ];

    const toolbar = document.createElement('div'); toolbar.className = 'grid-toolbar';
    const btnCsv = document.createElement('button'); btnCsv.textContent = 'Export CSV';
    const btnXlsx = document.createElement('button'); btnXlsx.textContent = 'Export Excel'; btnXlsx.style.marginLeft = '8px';
    const pageSizeSel = document.createElement('select'); pageSizeSel.setAttribute('data-pagesize','true'); pageSizeSel.style.marginLeft = '8px';
    const quickInput = document.createElement('input'); quickInput.type = 'text'; quickInput.placeholder = 'Search...'; quickInput.style.marginLeft = '8px';
    const defaultPage = getPersistedPageSize('dispatches', 20);
    [20,60,120,240].forEach(n => { const opt = document.createElement('option'); opt.value = String(n); opt.textContent = `Page ${n}`; if (n === defaultPage) opt.selected = true; pageSizeSel.appendChild(opt); });
    const addBtn = document.createElement('button'); addBtn.textContent = 'Create Dispatch'; addBtn.style.marginLeft = '8px'; addBtn.onclick = () => showDispatchForm(root);
    toolbar.appendChild(btnCsv); toolbar.appendChild(btnXlsx); toolbar.appendChild(pageSizeSel); toolbar.appendChild(addBtn); toolbar.appendChild(quickInput); root.appendChild(toolbar);
    // Explicit fallback banner to clarify mode
    addFallbackBanner(root, 'Dispatches');

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
    pageSizeSel.addEventListener('change', () => { pageSize = Number(pageSizeSel.value || defaultPage); setPersistedPageSize('dispatches', pageSize); renderSimple(); });
    btnCsv.onclick = () => {
      const keys = columns.map(c => c.key).filter(Boolean);
      const filtered = rows.filter(r => { const t = term.toLowerCase(); return !t || Object.keys(r).some(k => String(r[k] ?? '').toLowerCase().includes(t)); }).slice(0, pageSize);
      const header = keys.join(',');
      const lines = filtered.map(r => keys.map(k => JSON.stringify(String(r[k] ?? ''))).join(','));
      const csv = [header].concat(lines).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'dispatches.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    btnXlsx.onclick = () => {
      const keys = columns.map(c => c.key).filter(Boolean);
      const filtered = rows.filter(r => { const t = term.toLowerCase(); return !t || Object.keys(r).some(k => String(r[k] ?? '').toLowerCase().includes(t)); }).slice(0, pageSize);
      const out = filtered.map(r => { const o = {}; keys.forEach(k => o[k] = r[k]); return o; });
      // eslint-disable-next-line no-undef
      const ws = XLSX.utils.json_to_sheet(out);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Dispatches'); XLSX.writeFile(wb, 'dispatches.xlsx');
    };
    return;
  }

  const toolbar = document.createElement('div'); toolbar.className = 'grid-toolbar';
  const btnCsv = document.createElement('button'); btnCsv.textContent = 'Export CSV';
  const btnXlsx = document.createElement('button'); btnXlsx.textContent = 'Export Excel'; btnXlsx.style.marginLeft = '8px';
  const pageSizeSel = document.createElement('select'); pageSizeSel.setAttribute('data-pagesize','true'); pageSizeSel.style.marginLeft = '8px';
  const persistedPageSize = getPersistedPageSize('dispatches', 20);
  ;[20,60,120,240].forEach(n => { const opt = document.createElement('option'); opt.value = String(n); opt.textContent = `Page ${n}`; if (n === persistedPageSize) opt.selected = true; pageSizeSel.appendChild(opt); });
  const quickInput = document.createElement('input'); quickInput.type = 'text'; quickInput.placeholder = 'Search...'; quickInput.style.marginLeft = '8px';
  const addBtn = document.createElement('button'); addBtn.textContent = 'Create Dispatch'; addBtn.style.marginLeft = '8px'; addBtn.onclick = () => showDispatchForm(root);
  toolbar.appendChild(btnCsv); toolbar.appendChild(btnXlsx); toolbar.appendChild(pageSizeSel); toolbar.appendChild(addBtn); toolbar.appendChild(quickInput); root.appendChild(toolbar);

  const gridDiv = document.createElement('div'); gridDiv.className = 'ag-theme-alpine'; gridDiv.style.width = '100%';
  root.appendChild(gridDiv);

  const columnDefs = [
    { headerName: 'Actions', field: '_actions', pinned: 'left', width: 90, minWidth: 80, maxWidth: 110, suppressHeaderMenuButton: true, sortable: false, filter: false, resizable: false, cellRenderer: (p) => {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'action-btn'; btn.textContent = '🗑️'; btn.title = 'Delete Dispatch'; btn.setAttribute('aria-label','Delete Dispatch'); btn.onclick = async () => {
        const r = p.data; if (!confirm('Delete dispatch ' + r.id + '?')) return;
        try { await fetchExpectOk('/dispatches/' + encodeURIComponent(r.id), { method: 'DELETE' }); showToast('Deleted dispatch ' + r.id, 'success'); location.hash = '#dispatches'; } catch (e) { showToast('Delete failed: ' + e, 'error'); }
      };
      return btn;
    } },
    { headerName: 'ID', valueGetter: (p) => (p && p.node && typeof p.node.rowIndex === 'number') ? (p.node.rowIndex + 1) : '', width: 80, minWidth: 70, maxWidth: 90, pinned: 'left', suppressHeaderMenuButton: true, sortable: false, filter: false, resizable: false },
    { headerName: 'Dispatch ID', field: 'id' },
    { headerName: 'SLID', field: 'slid' },
    { headerName: 'Customer', field: 'customer' },
    { headerName: 'Bundle No', field: 'bundle_no' },
    { headerName: 'Container No', field: 'container_no' },
    { headerName: 'Dispatched', field: 'dispatched_at' },
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

  registerCleanup(root, bindGlobalSearch(quickInput, (q) => {
    if (gridApi && gridApi.setGridOption) gridApi.setGridOption('quickFilterText', q || '');
  }));
  pageSizeSel.addEventListener('change', () => {
    const v = Number(pageSizeSel.value || persistedPageSize);
    if (gridApi && gridApi.setGridOption) gridApi.setGridOption('paginationPageSize', v);
    setPersistedPageSize('dispatches', v);
  });

  btnCsv.onclick = () => { gridApi.exportDataAsCsv({ fileName: 'dispatches.csv' }); };
  btnXlsx.onclick = () => {
    const cols = columnDefs.filter(c => c.field && !c.cellRenderer).map(c => c.field);
    const out = [];
    gridApi.forEachNodeAfterFilterAndSort(node => { const obj = {}; cols.forEach(f => { obj[f] = node.data[f]; }); out.push(obj); });
    // eslint-disable-next-line no-undef
    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Dispatches'); XLSX.writeFile(wb, 'dispatches.xlsx');
  };
}

function showDispatchForm(root, prefill = null) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';

  const modalHeader = document.createElement('div');
  modalHeader.className = 'modal-header';
  const modalTitle = document.createElement('h3');
  modalTitle.textContent = 'Create Dispatch';
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
  form.id = 'dispatch-form-' + Math.random().toString(16).slice(2);

  let busy = null;

  const dirty = createDirtyTracker(form, { includeDisabled: true });

  async function closeAndRefresh() {
    if (busy && busy.isBusy && busy.isBusy()) return;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    try {
      if (typeof renderDispatches === 'function') await renderDispatches(root);
      else if (typeof window !== 'undefined' && typeof window.renderDispatches === 'function') await window.renderDispatches(root);
      else location.hash = '#dispatches?' + Date.now();
    } catch (_) { location.hash = '#dispatches?' + Date.now(); }
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

  // We'll provide a single picker that lets the user choose a slab or a derived item.
  const pickerRow = document.createElement('div'); pickerRow.className = 'form-row gx-span-2';
  const itemSelect = document.createElement('select'); itemSelect.name = 'dispatch_item'; itemSelect.style.minWidth = '420px';
  pickerRow.appendChild(itemSelect);
  const refreshBtn = document.createElement('button'); refreshBtn.type = 'button'; refreshBtn.textContent = 'Refresh items'; refreshBtn.style.marginLeft = '8px'; pickerRow.appendChild(refreshBtn);
  form.appendChild(pickerRow);
  form.appendChild(formField('customer', 'Customer', ''));
  form.appendChild(formField('bundle_no', 'Bundle no', ''));
  form.appendChild(formField('container_no', 'Container no', ''));
  // hidden fields for structured payload
  const hiddenType = document.createElement('input'); hiddenType.type = 'hidden'; hiddenType.name = 'item_type'; form.appendChild(hiddenType);
  const hiddenId = document.createElement('input'); hiddenId.type = 'hidden'; hiddenId.name = 'item_id'; form.appendChild(hiddenId);

  const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Create';
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
      const fd = Object.fromEntries(new FormData(form).entries());
      // fd.dispatch_item contains the selected option value in format `${type}::${id}` or `slab::SLID`.
      const sel = fd.dispatch_item || '';
      const parts = sel.split('::');
      const payload = { customer: fd.customer, bundle_no: fd.bundle_no, container_no: fd.container_no };
      if (parts.length === 2) {
        const t = parts[0]; const id = parts[1];
        if (t === 'slab') payload.slid = id;
        else { payload.item_type = t; payload.item_id = id; }
      }
      if (busy && busy.setBusy) busy.setBusy(true, 'Creating…');
      await fetchExpectOk('/dispatch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      showToast('Dispatch created', 'success');
      if (busy && busy.setBusy) busy.setBusy(false);
      try { dirty.markClean(); } catch (_) {}
      await closeAndRefresh();
      location.hash = '#dispatches';
    } catch (err) { showToast('Error: ' + (err && err.message ? err.message : err), 'error'); }
    finally { if (busy && busy.setBusy) busy.setBusy(false); }
  };
  // Load available items (slabs with material-type slabs and derived items) and exclude already dispatched items
  async function loadItems() {
    try {
      const [slabs, tiles, cobbles, monuments, pavers, dispatches] = await Promise.all([
        fetchJson('/api/slabs'),
        fetchJson('/api/tiles'),
        fetchJson('/api/cobbles'),
        fetchJson('/api/monuments'),
        fetchJson('/api/pavers'),
        fetchJson('/api/dispatches')
      ]);
      // build sets of already dispatched slab ids and item_type+id
      const dispatchedSlids = new Set(dispatches.map(d => String(d.slid || '').trim()).filter(Boolean));
      const dispatchedItems = new Set(dispatches.map(d => `${String(d.item_type||'').trim()}::${String(d.item_id||'').trim()}`).filter(x => x && x !== '::'));

      while (itemSelect.firstChild) itemSelect.removeChild(itemSelect.firstChild);
      const emptyOpt = document.createElement('option'); emptyOpt.value = ''; emptyOpt.textContent = '-- choose item to dispatch --'; itemSelect.appendChild(emptyOpt);

      // Slabs: only include slabs whose stone_type is not a derived-family marker
      const materialSlabs = (slabs || []).filter(s => {
        const st = (s.stone_type || '').toString().trim().toLowerCase();
        return st && ['tiles', 'cobbles', 'monuments', 'pavers'].indexOf(st) === -1;
      });
      if (materialSlabs.length) {
        const grp = document.createElement('optgroup'); grp.label = 'Slabs (material)';
        materialSlabs.forEach(s => {
          if (dispatchedSlids.has(String(s.slid))) return; // skip already dispatched slab
          const opt = document.createElement('option'); opt.value = `slab::${s.slid}`; opt.textContent = `${s.slid} (block: ${s.block_id || '-'}, material: ${s.material || s.stone_type || '-'})`; grp.appendChild(opt);
        });
        if (grp.children.length) itemSelect.appendChild(grp);
      }

      // Tiles
      if ((tiles || []).length) {
        const grp = document.createElement('optgroup'); grp.label = 'Tiles';
        tiles.forEach(t => {
          const key = `tile::${t.tile_id}`;
          if (dispatchedItems.has(key)) return; // skip
          const slidPart = t.slid ? ` (slab: ${t.slid})` : '';
          const opt = document.createElement('option'); opt.value = key; opt.textContent = `${t.tile_id}${slidPart}`; grp.appendChild(opt);
        });
        if (grp.children.length) itemSelect.appendChild(grp);
      }

      // Cobbles
      if ((cobbles || []).length) {
        const grp = document.createElement('optgroup'); grp.label = 'Cobbles';
        cobbles.forEach(c => {
          const key = `cobble::${c.cobble_id}`;
          if (dispatchedItems.has(key)) return;
          const slidPart = c.slid ? ` (slab: ${c.slid})` : '';
          const opt = document.createElement('option'); opt.value = key; opt.textContent = `${c.cobble_id}${slidPart}`; grp.appendChild(opt);
        });
        if (grp.children.length) itemSelect.appendChild(grp);
      }

      // Monuments
      if ((monuments || []).length) {
        const grp = document.createElement('optgroup'); grp.label = 'Monuments';
        monuments.forEach(m => {
          const key = `monument::${m.monument_id}`;
          if (dispatchedItems.has(key)) return;
          const slidPart = m.slid ? ` (slab: ${m.slid})` : '';
          const opt = document.createElement('option'); opt.value = key; opt.textContent = `${m.monument_id}${slidPart}`; grp.appendChild(opt);
        });
        if (grp.children.length) itemSelect.appendChild(grp);
      }

      // Pavers
      if ((pavers || []).length) {
        const grp = document.createElement('optgroup'); grp.label = 'Pavers';
        pavers.forEach(p => {
          const key = `paver::${p.paver_id}`;
          if (dispatchedItems.has(key)) return;
          const slidPart = p.slid ? ` (slab: ${p.slid})` : '';
          const opt = document.createElement('option'); opt.value = key; opt.textContent = `${p.paver_id}${slidPart}`; grp.appendChild(opt);
        });
        if (grp.children.length) itemSelect.appendChild(grp);
      }

      // Apply prefill selection if provided (after all options exist).
      if (prefill) {
        const wantSlid = prefill.slid ? String(prefill.slid).trim() : '';
        const wantType = prefill.item_type ? String(prefill.item_type).trim().toLowerCase() : '';
        const wantId = prefill.item_id ? String(prefill.item_id).trim() : '';
        let desired = '';
        if (wantSlid) desired = `slab::${wantSlid}`;
        else if (wantType && wantId) desired = `${wantType}::${wantId}`;
        if (desired) {
          // Only set if option exists; otherwise keep default.
          const optExists = Array.from(itemSelect.querySelectorAll('option')).some(o => o.value === desired);
          if (optExists) itemSelect.value = desired;
        }
      }

      // Reset dirty baseline after async option load/prefill.
      try { dirty.markClean(); } catch (_) {}
    } catch (e) { showToast('Failed to load dispatchable items: ' + e, 'error'); }
  }
  refreshBtn.onclick = loadItems;
  loadItems();
}
