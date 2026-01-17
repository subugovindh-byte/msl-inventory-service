import { fetchJson, fetchExpectOk, makeTable, formField, formSelect, showToast, serializeForm, addFallbackBanner, waitForAgGrid, getPersistedPageSize, setPersistedPageSize, bindGlobalSearch, cleanupRoot, registerCleanup, createBusyController, confirmUnsavedChanges, createDirtyTracker, enableAgGridResponsiveColumns } from '../utils.js';

export async function renderSlabs(root) {
  cleanupRoot(root);
  while (root.firstChild) root.removeChild(root.firstChild);
  if (root && root.classList) root.classList.add('fade-in');
  const header = document.createElement('div'); header.className = 'view-header';
  const title = document.createElement('h2'); title.textContent = 'Slabs'; header.appendChild(title);
  root.appendChild(header);

  const rows = await fetchJson('/api/slabs');
  const tiles = await fetchJson('/api/tiles');
  const cobbles = await fetchJson('/api/cobbles');
  const monuments = await fetchJson('/api/monuments');
  const dispatches = await fetchJson('/api/dispatches');
  const withChildren = rows.map(r => {
    const t = tiles.filter(x => (x.slab_id === r.slid) || (x.slid === r.slid)).length;
    const c = cobbles.filter(x => (x.slab_id === r.slid) || (x.slid === r.slid)).length;
    const m = monuments.filter(x => (x.slab_id === r.slid) || (x.slid === r.slid)).length;
    const d = dispatches.filter(x => (x.slab_id === r.slid) || (x.slid === r.slid)).length;
    const children_count = t + c + m + d;
    return { ...r, children_count };
  });

  if (!(await waitForAgGrid(1200))) {
    const columns = [
      { key: 'slid', label: 'SLID' },
      { key: 'block_id', label: 'Block ID' },
      { key: 'thickness_mm', label: 'Thickness (mm)' },
      { key: 'machine_id', label: 'Machine ID' },
      { key: 'slabs_yield', label: 'Slabs Yield' },
      { key: 'batch_id', label: 'Batch ID' },
      { key: 'yard_location', label: 'Yard' },
      { key: 'status', label: 'Status' },
      { key: 'qc_status', label: 'QC' },
      { key: 'stone_type', label: 'Stone Type' }
    ];
    const actions = [
      { label: '✏️', title: 'Edit SLID', ariaLabel: 'Edit SLID', className: 'action-btn', onClick: (r) => showSlabForm(root, r) },
      { label: '🗑️', title: (r) => (r.children_count > 0 ? 'Delete disabled: child items are split/dressed.' : 'Delete SLID'), ariaLabel: (r) => (r.children_count > 0 ? 'Delete SLID (disabled)' : 'Delete SLID'), className: 'action-btn', disabled: (r) => r.children_count > 0, onClick: async (r) => { if (r.children_count > 0) { showToast('Cannot delete: child items exist.', 'error'); return; } if (!confirm('Delete ' + r.slid + '?')) return; try { await fetchExpectOk('/slabs/' + encodeURIComponent(r.slid), { method: 'DELETE' }); showToast('Deleted SLID ' + r.slid, 'success'); await renderSlabs(root); } catch (e) { showToast('Delete failed: ' + e, 'error'); } } }
    ];

    const toolbar = document.createElement('div'); toolbar.className = 'grid-toolbar';
    const btnCsv = document.createElement('button'); btnCsv.textContent = 'Export CSV';
    const btnXlsx = document.createElement('button'); btnXlsx.textContent = 'Export Excel'; btnXlsx.style.marginLeft = '8px';
    const pageSizeSel = document.createElement('select'); pageSizeSel.setAttribute('data-pagesize','true'); pageSizeSel.style.marginLeft = '8px';
    const quickInput = document.createElement('input'); quickInput.type = 'text'; quickInput.placeholder = 'Search...'; quickInput.style.marginLeft = '8px';
    const defaultPage = getPersistedPageSize('slabs', 20);
    [20,60,120,240].forEach(n => { const opt = document.createElement('option'); opt.value = String(n); opt.textContent = `Page ${n}`; if (n === defaultPage) opt.selected = true; pageSizeSel.appendChild(opt); });
    const addBtn = document.createElement('button'); addBtn.textContent = 'Create SLID'; addBtn.style.marginLeft = '8px'; addBtn.onclick = () => showSlabForm(root, null);
    toolbar.appendChild(btnCsv); toolbar.appendChild(btnXlsx); toolbar.appendChild(pageSizeSel); toolbar.appendChild(addBtn); toolbar.appendChild(quickInput);
    root.appendChild(toolbar);
    addFallbackBanner(root, 'Slabs');

    let term = '';
    let pageSize = defaultPage;
    let tableEl = null;
    const renderSimple = () => {
      const filtered = withChildren.filter(r => {
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
    pageSizeSel.addEventListener('change', () => { pageSize = Number(pageSizeSel.value || defaultPage); setPersistedPageSize('slabs', pageSize); renderSimple(); });
    btnCsv.onclick = () => {
      const keys = columns.map(c => c.key).filter(Boolean);
      const filtered = rows.filter(r => { const t = term.toLowerCase(); return !t || Object.keys(r).some(k => String(r[k] ?? '').toLowerCase().includes(t)); }).slice(0, pageSize);
      const header = keys.join(',');
      const lines = filtered.map(r => keys.map(k => JSON.stringify(String(r[k] ?? ''))).join(','));
      const csv = [header].concat(lines).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'slabs.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    btnXlsx.onclick = () => {
      const keys = columns.map(c => c.key).filter(Boolean);
      const filtered = rows.filter(r => { const t = term.toLowerCase(); return !t || Object.keys(r).some(k => String(r[k] ?? '').toLowerCase().includes(t)); }).slice(0, pageSize);
      const out = filtered.map(r => { const o = {}; keys.forEach(k => o[k] = r[k]); return o; });
      const ws = XLSX.utils.json_to_sheet(out);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Slabs'); XLSX.writeFile(wb, 'slabs.xlsx');
    };
    return;
  }

  const toolbar = document.createElement('div'); toolbar.className = 'grid-toolbar';
  const btnCsv = document.createElement('button'); btnCsv.textContent = 'Export CSV';
  const btnXlsx = document.createElement('button'); btnXlsx.textContent = 'Export Excel'; btnXlsx.style.marginLeft = '8px';
  const pageSizeSel = document.createElement('select'); pageSizeSel.setAttribute('data-pagesize','true'); pageSizeSel.style.marginLeft = '8px';
  const persistedPageSize = getPersistedPageSize('slabs', 20);
  ;[20,60,120,240].forEach(n => { const opt = document.createElement('option'); opt.value = String(n); opt.textContent = `Page ${n}`; if (n === persistedPageSize) opt.selected = true; pageSizeSel.appendChild(opt); });
  const quickInput = document.createElement('input'); quickInput.type = 'text'; quickInput.placeholder = 'Search...'; quickInput.style.marginLeft = '8px';
  const addBtn = document.createElement('button'); addBtn.textContent = 'Create SLID'; addBtn.style.marginLeft = '8px'; addBtn.onclick = () => showSlabForm(root, null);
  toolbar.appendChild(btnCsv); toolbar.appendChild(btnXlsx); toolbar.appendChild(pageSizeSel); toolbar.appendChild(addBtn); toolbar.appendChild(quickInput); root.appendChild(toolbar);

  const gridDiv = document.createElement('div'); gridDiv.className = 'ag-theme-alpine'; gridDiv.style.width = '100%';
  root.appendChild(gridDiv);

  const columnDefs = [
    { headerName: 'Actions', field: '_actions', pinned: 'left', width: 120, minWidth: 110, maxWidth: 140, suppressHeaderMenuButton: true, sortable: false, filter: false, resizable: false, cellRenderer: (p) => {
      const wrap = document.createElement('div');
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'action-btn'; edit.textContent = '✏️'; edit.title = 'Edit SLID'; edit.setAttribute('aria-label','Edit SLID'); edit.style.marginRight = '6px'; edit.onclick = () => showSlabForm(root, p.data);
      const del = document.createElement('button'); del.type = 'button'; del.className = 'action-btn'; del.textContent = '🗑️'; del.title = 'Delete SLID'; del.setAttribute('aria-label','Delete SLID');
      if (p.data.children_count > 0) { del.disabled = true; del.setAttribute('aria-disabled','true'); del.title = 'Deletion disabled: child items exist'; del.setAttribute('aria-label','Delete SLID (disabled)'); }
      del.onclick = async () => {
        const r = p.data; if (r.children_count > 0) { showToast('Cannot delete: child items exist.', 'error'); return; }
        if (!confirm('Delete ' + r.slid + '?')) return;
        try { await fetchExpectOk('/slabs/' + encodeURIComponent(r.slid), { method: 'DELETE' }); showToast('Deleted SLID ' + r.slid, 'success'); await renderSlabs(root); } catch (e) { showToast('Delete failed: ' + e, 'error'); }
      };
      wrap.appendChild(edit); wrap.appendChild(del); return wrap;
    } },
    { headerName: 'ID', valueGetter: (p) => (p && p.node && typeof p.node.rowIndex === 'number') ? (p.node.rowIndex + 1) : '', width: 80, minWidth: 70, maxWidth: 90, pinned: 'left', suppressHeaderMenuButton: true, sortable: false, filter: false, resizable: false },
    { headerName: 'SLID', field: 'slid' },
    { headerName: 'Block ID', field: 'block_id' },
    { headerName: 'Thickness (mm)', field: 'thickness_mm' },
    { headerName: 'Machine ID', field: 'machine_id' },
    { headerName: 'Slabs Yield', field: 'slabs_yield' },
    { headerName: 'Batch ID', field: 'batch_id' },
    { headerName: 'Yard', field: 'yard_location' },
    { headerName: 'Status', field: 'status' },
    { headerName: 'QC', field: 'qc_status' },
    { headerName: 'Stone Type', field: 'stone_type' },
  ];

  const gridOptions = {
    columnDefs,
    rowData: withChildren,
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
    setPersistedPageSize('slabs', v);
  });

  btnCsv.onclick = () => { gridApi.exportDataAsCsv({ fileName: 'slabs.csv' }); };
  btnXlsx.onclick = () => {
    const cols = columnDefs.filter(c => c.field && !c.cellRenderer).map(c => c.field);
    const out = [];
    gridApi.forEachNodeAfterFilterAndSort(node => { const obj = {}; cols.forEach(f => { obj[f] = node.data[f]; }); out.push(obj); });
    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Slabs'); XLSX.writeFile(wb, 'slabs.xlsx');
  };

}

function showSlabForm(root, row) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const modal = document.createElement('div');
  modal.className = 'modal';
  overlay.appendChild(modal);

  const header = document.createElement('div');
  header.className = 'modal-header';
  const title = document.createElement('div');
  title.style.fontWeight = '700';
  title.textContent = row ? `Edit SLID ${row.slid}` : 'Create SLID';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '✕';
  header.appendChild(title);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement('div');
  body.className = 'modal-body';
  modal.appendChild(body);

  const form = document.createElement('form');
  form.className = 'edit-form gx-edit-form';
  form.id = 'gx-slab-form-' + Date.now();
  body.appendChild(form);

  const close = async () => {
    try { document.removeEventListener('keydown', onKey); } catch (_) {}
    overlay.remove();
    try {
      if (typeof renderSlabs === 'function') await renderSlabs(root);
      else if (typeof window !== 'undefined' && typeof window.renderSlabs === 'function') await window.renderSlabs(root);
      else location.hash = '#slabs?' + Date.now();
    } catch (_) { location.hash = '#slabs?' + Date.now(); }
  };

  // Busy/save UX is wired after action buttons exist.

  if (row) {
    form.appendChild(formField('block_id', 'Block ID', row.block_id || ''));
    const bi = form.querySelector('#block_id'); if (bi) { bi.readOnly = true; bi.setAttribute('aria-readonly','true'); }
    try {
      const biRow = bi && bi.closest('.form-row');
      if (biRow) biRow.classList.add('gx-span-2');
    } catch (_) {}
    form.appendChild(formField('thickness_mm', 'Thickness (mm)', row.thickness_mm || '', 'number'));
    form.appendChild(formField('machine_id', 'Machine ID', row.machine_id || ''));
    form.appendChild(formField('slabs_yield', 'Slabs yield', row.slabs_yield || '', 'number'));
    form.appendChild(formField('batch_id', 'Batch ID', row.batch_id || ''));
    form.appendChild(formField('yard_location', 'Yard', row.yard_location || ''));
    form.appendChild(formSelect('stone_type', 'Stone Type', [
      { value: '', label: '-- choose --' },
      { value: 'granite', label: 'Granite' },
      { value: 'marble', label: 'Marble' },
      { value: 'quartz', label: 'Quartz' },
      { value: 'tiles', label: 'Tiles' },
      { value: 'cobbles', label: 'Cobbles' },
      { value: 'monuments', label: 'Monuments' }
    ], row.stone_type || ''));
    form.appendChild(formSelect('status', 'Status', [
      { value: '', label: '-- choose --' },
      { value: 'unfinished', label: 'Unfinished' },
      { value: 'finished', label: 'Finished' },
      { value: 'qc_passed', label: 'QC Passed' },
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
    try {
      const bi = form.querySelector('#block_id');
      const biRow = bi && bi.closest('.form-row');
      if (biRow) biRow.classList.add('gx-span-2');
    } catch (_) {}

    const pickerRow = document.createElement('div');
    pickerRow.className = 'form-row gx-span-2';
    const pickerLabel = document.createElement('label');
    pickerLabel.textContent = 'Pick Block (optional helper)';
    pickerRow.appendChild(pickerLabel);
    const picker = document.createElement('div');
    picker.style.display = 'flex';
    picker.style.gap = '6px';
    picker.style.flexWrap = 'wrap';
    picker.style.alignItems = 'center';

    const parentInput = document.createElement('input'); parentInput.type = 'text'; parentInput.placeholder = 'Parent QBID (optional)';
    const searchInput = document.createElement('input'); searchInput.type = 'text'; searchInput.placeholder = 'Search block…';
    const select = document.createElement('select'); select.id = 'block_id_select'; select.style.minWidth = '280px';
    const refreshBtn = document.createElement('button'); refreshBtn.type = 'button'; refreshBtn.textContent = 'Refresh Blocks';

    // Responsive sizing for the picker controls
    parentInput.style.flex = '1 1 160px';
    searchInput.style.flex = '1 1 180px';
    select.style.flex = '2 1 280px';
    refreshBtn.style.flex = '0 0 auto';

    picker.appendChild(parentInput);
    picker.appendChild(searchInput);
    picker.appendChild(select);
    picker.appendChild(refreshBtn);
    pickerRow.appendChild(picker);
    form.appendChild(pickerRow);

    let allBlocks = [];
    function renderOptions() {
      const parent = (parentInput.value || '').trim();
      const term = (searchInput.value || '').trim().toLowerCase();
      const filtered = allBlocks.filter(b => {
        if (parent && String(b.parent_qbid) !== String(parent)) return false;
        if (!term) return true;
        const text = [b.block_id, b.material].map(x => String(x || '')).join(' ').toLowerCase();
        return text.includes(term);
      }).slice(0, 500);
      while (select.firstChild) select.removeChild(select.firstChild);
      const empty = document.createElement('option'); empty.value = ''; empty.textContent = filtered.length ? '-- choose block --' : '(no matches)'; select.appendChild(empty);
      filtered.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.block_id;
        opt.textContent = `${b.block_id} (parent: ${b.parent_qbid || '-'}, material: ${b.material || '-'})`;
        select.appendChild(opt);
      });
    }

    async function loadAndRender() {
      try {
        allBlocks = await fetchJson('/api/blocks');
        renderOptions();
      } catch (e) {
        showToast('Failed to load blocks: ' + e, 'error');
      }
    }
    parentInput.addEventListener('input', renderOptions);
    searchInput.addEventListener('input', renderOptions);
    refreshBtn.onclick = loadAndRender;
    select.addEventListener('change', () => {
      const blockInput = form.querySelector('#block_id');
      const v = select.value || '';
      if (blockInput) blockInput.value = v;
    });
    loadAndRender();

    form.appendChild(formField('thickness_mm', 'Thickness (mm)', '', 'number'));
    form.appendChild(formField('machine_id', 'Machine ID', ''));
    form.appendChild(formField('slabs_yield', 'Slabs yield', '', 'number'));
    form.appendChild(formField('batch_id', 'Batch ID', ''));
    form.appendChild(formField('yard_location', 'Yard', ''));
    form.appendChild(formSelect('stone_type', 'Stone Type', [
      { value: '', label: '-- choose --' },
      { value: 'granite', label: 'Granite' },
      { value: 'marble', label: 'Marble' },
      { value: 'quartz', label: 'Quartz' },
      { value: 'tiles', label: 'Tiles' },
      { value: 'cobbles', label: 'Cobbles' },
      { value: 'monuments', label: 'Monuments' }
    ], ''));
    form.appendChild(formSelect('status', 'Status', [
      { value: '', label: '-- choose --' },
      { value: 'unfinished', label: 'Unfinished' },
      { value: 'finished', label: 'Finished' },
      { value: 'qc_passed', label: 'QC Passed' },
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

  const actions = document.createElement('div');
  actions.className = 'gx-edit-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  const save = document.createElement('button'); save.type = 'submit'; save.textContent = row ? 'Save' : 'Create';
  save.setAttribute('form', form.id);
  cancel.onclick = close;
  actions.appendChild(cancel);
  actions.appendChild(save);
  body.appendChild(actions);

  const busy = createBusyController({ form, primaryButton: save, secondaryButtons: [cancel, closeBtn] });

  const dirty = createDirtyTracker(form, { includeDisabled: true });
  dirty.markClean();

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
    await close();
  };

  closeBtn.onclick = guardedClose;
  cancel.onclick = guardedClose;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) guardedClose();
  });
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      guardedClose();
    }
  };
  document.addEventListener('keydown', onKey);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy.isBusy()) return;
    try {
      const payload = serializeForm(form);
      ['thickness_mm','slabs_yield'].forEach(k => { if (payload[k] === '') delete payload[k]; else payload[k] = Number(payload[k]); });
      busy.setBusy(true, row ? 'Saving…' : 'Creating…');
      if (row && row.slid) {
        await fetchExpectOk('/slabs/' + encodeURIComponent(row.slid), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        showToast('Saved SLID ' + row.slid, 'success');
      } else {
        await fetchExpectOk('/slabs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        showToast('Created SLID', 'success');
      }
      // Mark form as clean after successful save.
      try { dirty.markClean(); } catch (_) {}
      await close();
    } catch (err) {
      showToast('Error: ' + (err && err.message ? err.message : err), 'error');
    } finally {
      busy.setBusy(false);
    }
  });

  document.body.appendChild(overlay);
  setTimeout(() => {
    const first = form.querySelector('input, select, textarea, button');
    if (first && typeof first.focus === 'function') first.focus();
  }, 0);
}
