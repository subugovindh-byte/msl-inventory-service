import { fetchJson, fetchExpectOk, makeTable, formField, formSelect, showToast, serializeForm, waitForAgGrid, getPersistedPageSize, setPersistedPageSize, fetchSlabById, fetchSlabUsage, addFallbackBanner, bindGlobalSearch, cleanupRoot, registerCleanup, createBusyController, confirmUnsavedChanges, createDirtyTracker, enableAgGridResponsiveColumns } from '../utils.js';

export async function renderMonuments(root) {
  cleanupRoot(root);
  while (root.firstChild) root.removeChild(root.firstChild);
  if (root && root.classList) root.classList.add('fade-in');
  const header = document.createElement('div'); header.className = 'view-header';
  const title = document.createElement('h2'); title.textContent = 'Monuments'; header.appendChild(title);
  root.appendChild(header);

  const onScanned = (e) => {
    const d = e && e.detail ? e.detail : null;
    if (!d || d.action !== 'create' || d.view !== 'monuments') return;
    const slid = d.slid ? String(d.slid).trim() : '';
    if (!slid || !/^SLID-/i.test(slid)) return;
    try {
      showMonumentForm(root, null);
      const slidInput = document.querySelector('.modal-overlay .modal input[name="slid"]');
      if (slidInput) {
        slidInput.value = slid;
        slidInput.dispatchEvent(new Event('input', { bubbles: true }));
        slidInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } catch (_) {}
  };
  window.addEventListener('inventory:scanned', onScanned);
  registerCleanup(root, () => window.removeEventListener('inventory:scanned', onScanned));

  const rows = await fetchJson('/api/monuments');

  if (!(await waitForAgGrid(1200))) {
    const columns = [
      { key: 'monument_id', label: 'Monument ID' },
      { key: 'block_id', label: 'Block ID' },
      { key: 'slid', label: 'SLID' },
      { key: 'source', label: 'Source' },
      { key: 'stone_type', label: 'Stone Type' },
      { key: 'length_mm', label: 'Length (mm)' },
      { key: 'width_mm', label: 'Width (mm)' },
      { key: 'height_mm', label: 'Height (mm)' },
      { key: 'style', label: 'Style' },
      { key: 'customer', label: 'Customer' },
      { key: 'order_no', label: 'Order No' },
      { key: 'batch_id', label: 'Batch' },
      { key: 'yard_location', label: 'Yard' },
      { key: 'status', label: 'Status' },
      { key: 'qc_status', label: 'QC' }
    ];
    const actions = [
      { label: '✏️', title: 'Edit Monument', ariaLabel: 'Edit Monument', className: 'action-btn', onClick: (r) => showMonumentForm(root, r) },
      { label: '🗑️', title: 'Delete Monument', ariaLabel: 'Delete Monument', className: 'action-btn', onClick: async (r) => { if (!confirm('Delete monument ' + r.monument_id + '?')) return; try { await fetchExpectOk('/monuments/' + encodeURIComponent(r.monument_id), { method: 'DELETE' }); showToast('Deleted monument ' + r.monument_id, 'success'); await renderMonuments(root); } catch (e) { showToast('Delete failed: ' + e, 'error'); } } }
    ];

    const toolbar = document.createElement('div'); toolbar.className = 'grid-toolbar';
    const btnCsv = document.createElement('button'); btnCsv.textContent = 'Export CSV';
    const btnXlsx = document.createElement('button'); btnXlsx.textContent = 'Export Excel'; btnXlsx.style.marginLeft = '8px';
    const pageSizeSel = document.createElement('select'); pageSizeSel.setAttribute('data-pagesize','true'); pageSizeSel.style.marginLeft = '8px';
    const quickInput = document.createElement('input'); quickInput.type = 'text'; quickInput.placeholder = 'Search...'; quickInput.style.marginLeft = '8px';
    const defaultPage = getPersistedPageSize('monuments', 20);
    [20,60,120,240].forEach(n => { const opt = document.createElement('option'); opt.value = String(n); opt.textContent = `Page ${n}`; if (n === defaultPage) opt.selected = true; pageSizeSel.appendChild(opt); });
    const addBtn = document.createElement('button'); addBtn.textContent = 'Create Monument'; addBtn.style.marginLeft = '8px'; addBtn.onclick = () => showMonumentForm(root, null);
    toolbar.appendChild(btnCsv); toolbar.appendChild(btnXlsx); toolbar.appendChild(pageSizeSel); toolbar.appendChild(addBtn); toolbar.appendChild(quickInput); root.appendChild(toolbar);
    // Explicit fallback banner to clarify mode
    addFallbackBanner(root, 'Monuments');

    let term = ''; let pageSize = defaultPage; let tableEl = null;
    const renderSimple = () => {
      const filtered = rows.filter(r => {
        if (!term) return true;
        const t = term.toLowerCase();
        return Object.keys(r).some(k => String(r[k] ?? '').toLowerCase().includes(t));
      });
      const page = filtered.slice(0, pageSize);
      const table = makeTable(columns, page, actions);
      if (tableEl) tableEl.remove(); tableEl = table; root.appendChild(table);
    };
    renderSimple();
    registerCleanup(root, bindGlobalSearch(quickInput, (q) => { term = q || ''; renderSimple(); }));
    pageSizeSel.addEventListener('change', () => { pageSize = Number(pageSizeSel.value || defaultPage); setPersistedPageSize('monuments', pageSize); renderSimple(); });
    btnCsv.onclick = () => {
      const keys = columns.map(c => c.key).filter(Boolean);
      const filtered = rows.filter(r => { const t = term.toLowerCase(); return !t || Object.keys(r).some(k => String(r[k] ?? '').toLowerCase().includes(t)); }).slice(0, pageSize);
      const header = keys.join(',');
      const lines = filtered.map(r => keys.map(k => JSON.stringify(String(r[k] ?? ''))).join(','));
      const csv = [header].concat(lines).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'monuments.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    btnXlsx.onclick = () => {
      const keys = columns.map(c => c.key).filter(Boolean);
      const filtered = rows.filter(r => { const t = term.toLowerCase(); return !t || Object.keys(r).some(k => String(r[k] ?? '').toLowerCase().includes(t)); }).slice(0, pageSize);
      const out = filtered.map(r => { const o = {}; keys.forEach(k => o[k] = r[k]); return o; });
      // eslint-disable-next-line no-undef
      const ws = XLSX.utils.json_to_sheet(out);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Monuments'); XLSX.writeFile(wb, 'monuments.xlsx');
    };
    return;
  }

  const toolbar = document.createElement('div'); toolbar.className = 'grid-toolbar';
  const btnCsv = document.createElement('button'); btnCsv.textContent = 'Export CSV';
  const btnXlsx = document.createElement('button'); btnXlsx.textContent = 'Export Excel'; btnXlsx.style.marginLeft = '8px';
  const pageSizeSel = document.createElement('select'); pageSizeSel.setAttribute('data-pagesize','true'); pageSizeSel.style.marginLeft = '8px';
  const persistedPageSize = getPersistedPageSize('monuments', 20);
  ;[20,60,120,240].forEach(n => { const opt = document.createElement('option'); opt.value = String(n); opt.textContent = `Page ${n}`; if (n === persistedPageSize) opt.selected = true; pageSizeSel.appendChild(opt); });
  const quickInput = document.createElement('input'); quickInput.type = 'text'; quickInput.placeholder = 'Search...'; quickInput.style.marginLeft = '8px';
  const addBtn = document.createElement('button'); addBtn.textContent = 'Create Monument'; addBtn.style.marginLeft = '8px'; addBtn.onclick = () => showMonumentForm(root, null);
  toolbar.appendChild(btnCsv); toolbar.appendChild(btnXlsx); toolbar.appendChild(pageSizeSel); toolbar.appendChild(addBtn); toolbar.appendChild(quickInput); root.appendChild(toolbar);


  const gridDiv = document.createElement('div'); gridDiv.className = 'ag-theme-alpine'; gridDiv.style.width = '100%';
  root.appendChild(gridDiv);

  const columnDefs = [
    { headerName: 'Actions', field: '_actions', pinned: 'left', width: 120, minWidth: 110, maxWidth: 140, suppressHeaderMenuButton: true, sortable: false, filter: false, resizable: false, cellRenderer: (p) => {
      const wrap = document.createElement('div');
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'action-btn'; edit.textContent = '✏️'; edit.title = 'Edit Monument'; edit.setAttribute('aria-label','Edit Monument'); edit.style.marginRight = '6px'; edit.onclick = () => showMonumentForm(root, p.data);
      const del = document.createElement('button'); del.type = 'button'; del.className = 'action-btn'; del.textContent = '🗑️'; del.title = 'Delete Monument'; del.setAttribute('aria-label','Delete Monument'); del.onclick = async () => { const r = p.data; if (!confirm('Delete monument ' + r.monument_id + '?')) return; try { await fetchExpectOk('/monuments/' + encodeURIComponent(r.monument_id), { method: 'DELETE' }); showToast('Deleted monument ' + r.monument_id, 'success'); await renderMonuments(root); } catch (e) { showToast('Delete failed: ' + e, 'error'); } };
      wrap.appendChild(edit); wrap.appendChild(del); return wrap;
    } },
    { headerName: 'ID', valueGetter: (p) => (p && p.node && typeof p.node.rowIndex === 'number') ? (p.node.rowIndex + 1) : '', width: 80, minWidth: 70, maxWidth: 90, pinned: 'left', suppressHeaderMenuButton: true, sortable: false, filter: false, resizable: false },
    { headerName: 'Monument ID', field: 'monument_id' },
    { headerName: 'Block ID', field: 'block_id' },
    { headerName: 'SLID', field: 'slid' },
    { headerName: 'Source', field: 'source' },
    { headerName: 'Stone Type', field: 'stone_type' },
    { headerName: 'Length (mm)', field: 'length_mm' },
    { headerName: 'Width (mm)', field: 'width_mm' },
    { headerName: 'Height (mm)', field: 'height_mm' },
    { headerName: 'Style', field: 'style' },
    { headerName: 'Customer', field: 'customer' },
    { headerName: 'Order No', field: 'order_no' },
    { headerName: 'Batch', field: 'batch_id' },
    { headerName: 'Yard', field: 'yard_location' },
    { headerName: 'Status', field: 'status' },
    { headerName: 'QC', field: 'qc_status' },
  ];

  const gridOptions = {
    columnDefs,
    rowData: rows,
    defaultColDef: { sortable: true, filter: true, resizable: true, minWidth: 110 },
    pagination: true,
    paginationPageSize: persistedPageSize,
    domLayout: 'autoHeight',
  };
  const gridApi = (window.agGrid.createGrid ? window.agGrid.createGrid(gridDiv, gridOptions) : new window.agGrid.Grid(gridDiv, gridOptions));

  enableAgGridResponsiveColumns(root, gridApi, gridOptions);

  registerCleanup(root, bindGlobalSearch(quickInput, (q) => { if (gridApi && gridApi.setGridOption) gridApi.setGridOption('quickFilterText', q || ''); }));
  pageSizeSel.addEventListener('change', () => { const v = Number(pageSizeSel.value || persistedPageSize); if (gridApi && gridApi.setGridOption) gridApi.setGridOption('paginationPageSize', v); setPersistedPageSize('monuments', v); });
  btnCsv.onclick = () => { gridApi.exportDataAsCsv({ fileName: 'monuments.csv' }); };
  btnXlsx.onclick = () => { const cols = columnDefs.filter(c => c.field && !c.cellRenderer).map(c => c.field); const out = []; gridApi.forEachNodeAfterFilterAndSort(node => { const obj = {}; cols.forEach(f => { obj[f] = node.data[f]; }); out.push(obj); }); const ws = XLSX.utils.json_to_sheet(out); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Monuments'); XLSX.writeFile(wb, 'monuments.xlsx'); };
}

function showMonumentForm(root, row) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';

  const modalHeader = document.createElement('div');
  modalHeader.className = 'modal-header';
  const modalTitle = document.createElement('h3');
  modalTitle.textContent = row ? `Edit Monument ${row.monument_id}` : 'Create Monument';
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
  form.id = 'monument-form-' + Math.random().toString(16).slice(2);

  if (row) {
    form.appendChild(formField('block_id', 'Block ID', row.block_id || ''));
    form.appendChild(formField('slid', 'SLID', row.slid || ''));
    form.appendChild(formField('length_mm', 'Length (mm)', row.length_mm || '', 'number'));
    form.appendChild(formField('width_mm', 'Width (mm)', row.width_mm || '', 'number'));
    form.appendChild(formField('height_mm', 'Height (mm)', row.height_mm || '', 'number'));
    form.appendChild(formField('style', 'Style', row.style || ''));
    form.appendChild(formField('customer', 'Customer', row.customer || ''));
    form.appendChild(formField('order_no', 'Order No', row.order_no || ''));
    form.appendChild(formField('batch_id', 'Batch', row.batch_id || ''));
    form.appendChild(formField('yard_location', 'Yard', row.yard_location || ''));
    form.appendChild(formSelect('status', 'Status', [
      { value: '', label: '-- choose --' },
      { value: 'unfinished', label: 'Unfinished' },
      { value: 'finished', label: 'Finished' },
      { value: 'ready_for_sale', label: 'Ready for Sale' },
      { value: 'ready_for_dispatch', label: 'Ready for Dispatch' }
    ], row.status || ''));
    form.appendChild(formSelect('qc_status', 'QC', [
      { value: '', label: '-- choose --' },
      { value: 'pending', label: 'Pending' },
      { value: 'passed', label: 'Passed' },
      { value: 'failed', label: 'Failed' }
    ], row.qc_status || ''));
  } else {
    form.appendChild(formField('block_id', 'Block ID', ''));
    // Inline searchable slab picker (search by SLID)
    const picker = document.createElement('div'); picker.className = 'form-row gx-span-2';
    const slabSearchInput = document.createElement('input'); slabSearchInput.type = 'text'; slabSearchInput.placeholder = 'Search slab by SLID…'; slabSearchInput.style.marginRight = '6px';
    const slabSelect = document.createElement('select'); slabSelect.id = 'slab_select'; slabSelect.style.minWidth = '320px';
    const slabRefreshBtn = document.createElement('button'); slabRefreshBtn.type = 'button'; slabRefreshBtn.textContent = 'Refresh Slabs'; slabRefreshBtn.style.marginLeft = '6px';
    picker.appendChild(slabSearchInput); picker.appendChild(slabSelect); picker.appendChild(slabRefreshBtn);
    form.appendChild(picker);

    let allSlabs = [];
    function renderSlabOptions() {
      const term = (slabSearchInput.value || '').trim().toLowerCase();
      const filtered = allSlabs.filter(s => {
        // Strict: only show slabs explicitly marked for 'monuments'
        const st = (s.stone_type || '').toString().trim().toLowerCase();
        if (st !== 'monuments') return false;
        if (!term) return true;
        const text = [s.slid, s.block_id, s.material, s.notes || ''].map(x => String(x || '')).join(' ').toLowerCase();
        return text.includes(term);
      }).slice(0, 500);
      while (slabSelect.firstChild) slabSelect.removeChild(slabSelect.firstChild);
      const empty = document.createElement('option'); empty.value = ''; empty.textContent = filtered.length ? '-- choose slab (SLID) --' : '(no matches)'; slabSelect.appendChild(empty);
      filtered.forEach(s => { const opt = document.createElement('option'); opt.value = s.slid; opt.textContent = `${s.slid} (block: ${s.block_id || '-'}, material: ${s.material || '-'})`; slabSelect.appendChild(opt); });
    }
    async function loadAndRenderSlabs() { try { allSlabs = await fetchJson('/api/slabs'); renderSlabOptions(); } catch (e) { showToast('Failed to load slabs: ' + e, 'error'); } }
    slabSearchInput.addEventListener('input', renderSlabOptions);
    slabRefreshBtn.onclick = loadAndRenderSlabs;
    slabSelect.addEventListener('change', () => {
      const blockInput = form.querySelector('#block_id');
      const slidInput = form.querySelector('input[name="slid"]');
      const v = slabSelect.value || '';
      if (slidInput) slidInput.value = v;
      if (blockInput) {
        const s = allSlabs.find(x => String(x.slid) === String(v));
        blockInput.value = s ? s.block_id || '' : '';
      }
    });
    loadAndRenderSlabs();
    form.appendChild(formField('slid', 'SLID', ''));
    form.appendChild(formField('length_mm', 'Length (mm)', '', 'number'));
    form.appendChild(formField('width_mm', 'Width (mm)', '', 'number'));
    form.appendChild(formField('height_mm', 'Height (mm)', '', 'number'));
    form.appendChild(formField('style', 'Style', ''));
    form.appendChild(formField('customer', 'Customer', ''));
    form.appendChild(formField('order_no', 'Order No', ''));
    form.appendChild(formField('batch_id', 'Batch', ''));
    form.appendChild(formField('yard_location', 'Yard', ''));
    form.appendChild(formSelect('status', 'Status', [
      { value: '', label: '-- choose --' },
      { value: 'unfinished', label: 'Unfinished' },
      { value: 'finished', label: 'Finished' },
      { value: 'ready_for_sale', label: 'Ready for Sale' },
      { value: 'ready_for_dispatch', label: 'Ready for Dispatch' }
    ], ''));
    form.appendChild(formSelect('qc_status', 'QC', [
      { value: '', label: '-- choose --' },
      { value: 'pending', label: 'Pending' },
      { value: 'passed', label: 'Passed' },
      { value: 'failed', label: 'Failed' }
    ], ''));
  }

  const save = document.createElement('button'); save.type = 'submit'; save.textContent = row ? 'Save' : 'Create';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  const slidNote = document.createElement('div'); slidNote.className = 'field-note'; slidNote.style.color = 'crimson'; slidNote.style.marginTop = '6px';
  cancel.onclick = () => close();

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

  const busy = createBusyController({ form, primaryButton: save, secondaryButtons: [cancel, closeBtn] });

  const dirty = createDirtyTracker(form, { includeDisabled: true });

  async function closeAndRefresh() {
    if (busy.isBusy()) return;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    try {
      if (typeof renderMonuments === 'function') await renderMonuments(root);
      else if (typeof window !== 'undefined' && typeof window.renderMonuments === 'function') await window.renderMonuments(root);
      else location.hash = '#monuments?' + Date.now();
    } catch (_) { location.hash = '#monuments?' + Date.now(); }
  }

  const guardedClose = async () => {
    if (busy.isBusy()) {
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
  cancel.onclick = close;
  setTimeout(() => {
    const firstInput = form.querySelector('input, select, textarea');
    if (firstInput) firstInput.focus();
  }, 0);

  // Snapshot after the form is fully built.
  try { dirty.markClean(); } catch (_) {}

  // Auto-fill block_id from SLID when possible
  const slidInput = form.querySelector('input[name="slid"]');
  const blockInput = form.querySelector('input[name="block_id"]');
  async function validateSlidForMonument(v) {
    if (!v) { slidNote.textContent = ''; save.disabled = false; return; }
    try {
      // fetch slab to enforce family-level restrictions
      const slab = await fetchSlabById(v);
      const slabType = slab && slab.stone_type ? String(slab.stone_type).trim().toLowerCase() : null;
      // If slab explicitly reserved for another derived family, block
      if (slabType && ['tiles','cobbles','monuments'].includes(slabType) && slabType !== 'monuments') {
        slidNote.textContent = `SLID ${v} is reserved for ${slabType}; cannot create monuments from it`;
        save.disabled = true;
        return;
      }
      // also ensure SLID hasn't been used by other families
      const u = await fetchSlabUsage(v);
      if ((u.tiles || 0) > 0 || (u.cobbles || 0) > 0) {
        slidNote.textContent = `SLID ${v} is already used by other derived product(s)`;
        save.disabled = true;
      } else {
        slidNote.textContent = '';
        save.disabled = false;
      }
    } catch (e) { slidNote.textContent = ''; save.disabled = false; }
  }
  async function resolveBlockFromSlid() {
    if (!slidInput) return;
    const v = (slidInput.value || '').trim();
    if (!v) return;
    try {
      const s = await fetchSlabById(v);
      if (s && blockInput) { blockInput.value = s.block_id || ''; }
      else showToast('No slab found for SLID ' + v, 'error');
    } catch (e) { /* ignore */ }
  }
  if (slidInput) { slidInput.addEventListener('change', resolveBlockFromSlid); slidInput.addEventListener('blur', resolveBlockFromSlid); }
  if (slidInput) { slidInput.addEventListener('change', () => validateSlidForMonument(slidInput.value.trim())); slidInput.addEventListener('blur', () => validateSlidForMonument(slidInput.value.trim())); }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy.isBusy()) return;
    try {
      const payload = serializeForm(form);
      ['length_mm','width_mm','height_mm'].forEach(k => { if (payload[k] === '') delete payload[k]; else payload[k] = Number(payload[k]); });
      if (!payload.block_id && payload.slid) {
        try { const s = await fetchSlabById(payload.slid); if (s) payload.block_id = s.block_id; } catch (_) {}
      }
      if (!payload.block_id) {
        showToast('Block ID is required (derived from SLID or set directly).', 'error');
        return;
      }
      busy.setBusy(true, row ? 'Saving…' : 'Creating…');
      if (row && row.monument_id) {
        await fetchExpectOk('/monuments/' + encodeURIComponent(row.monument_id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        showToast('Saved monument ' + row.monument_id, 'success');
      } else {
        await fetchExpectOk('/monuments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        showToast('Created monument', 'success');
      }
      busy.setBusy(false);
      try { dirty.markClean(); } catch (_) {}
      await closeAndRefresh();
      try { window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (_) {}
    } catch (err) { showToast('Error: ' + (err && err.message ? err.message : err), 'error'); }
    finally { busy.setBusy(false); }
  });

  const sInput = form.querySelector('input[name="slid"]'); if (sInput && sInput.parentNode) sInput.parentNode.appendChild(slidNote);
  if (!row) validateSlidForMonument((slidInput && slidInput.value) ? slidInput.value.trim() : '');
}
