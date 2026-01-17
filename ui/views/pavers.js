import { fetchJson, fetchExpectOk, makeTable, formField, formSelect, showToast, serializeForm, waitForAgGrid, getPersistedPageSize, setPersistedPageSize, addFallbackBanner, bindGlobalSearch, cleanupRoot, registerCleanup, createBusyController, confirmUnsavedChanges, createDirtyTracker, enableAgGridResponsiveColumns } from '../utils.js';

export async function renderPavers(root) {
  cleanupRoot(root);
  while (root.firstChild) root.removeChild(root.firstChild);
  if (root && root.classList) root.classList.add('fade-in');
  const header = document.createElement('div'); header.className = 'view-header';
  const title = document.createElement('h2'); title.textContent = 'Pavers'; header.appendChild(title);
  root.appendChild(header);

  const onScanned = (e) => {
    const d = e && e.detail ? e.detail : null;
    if (!d || d.action !== 'create' || d.view !== 'pavers') return;
    const slid = d.slid ? String(d.slid).trim() : '';
    if (!slid || !/^SLID-/i.test(slid)) return;
    try {
      showPaverForm(root, null);
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

  const rows = await fetchJson('/api/pavers');

  if (!(await waitForAgGrid(1200))) {
    const columns = [
      { key: 'paver_id', label: 'Paver ID' },
      { key: 'block_id', label: 'Block ID' },
      { key: 'slid', label: 'SLID' },
      { key: 'source', label: 'Source' },
      { key: 'thickness_mm', label: 'Thickness (mm)' },
      { key: 'length_mm', label: 'Length (mm)' },
      { key: 'width_mm', label: 'Width (mm)' },
      { key: 'height_mm', label: 'Height (mm)' },
      { key: 'finish', label: 'Finish' },
      { key: 'pattern', label: 'Pattern' },
      { key: 'pieces_count', label: 'Pieces' },
      { key: 'batch_id', label: 'Batch' },
      { key: 'yard_location', label: 'Yard' },
      { key: 'status', label: 'Status' },
      { key: 'qc_status', label: 'QC' }
    ];

    const actions = [
      { label: '✏️', title: 'Edit Paver', ariaLabel: 'Edit Paver', className: 'action-btn', onClick: (r) => showPaverForm(root, r) },
      { label: '🗑️', title: 'Delete Paver', ariaLabel: 'Delete Paver', className: 'action-btn', onClick: async (r) => {
        if (!confirm('Delete paver ' + r.paver_id + '?')) return;
        try {
          await fetchExpectOk('/pavers/' + encodeURIComponent(r.paver_id), { method: 'DELETE' });
          showToast('Deleted paver ' + r.paver_id, 'success');
          await renderPavers(root);
        } catch (e) {
          showToast('Delete failed: ' + e, 'error');
        }
      } }
    ];

    const toolbar = document.createElement('div'); toolbar.className = 'grid-toolbar';
    const btnCsv = document.createElement('button'); btnCsv.textContent = 'Export CSV';
    const btnXlsx = document.createElement('button'); btnXlsx.textContent = 'Export Excel'; btnXlsx.style.marginLeft = '8px';
    const pageSizeSel = document.createElement('select'); pageSizeSel.setAttribute('data-pagesize','true'); pageSizeSel.style.marginLeft = '8px';
    const quickInput = document.createElement('input'); quickInput.type = 'text'; quickInput.placeholder = 'Search...'; quickInput.style.marginLeft = '8px';
    const defaultPage = getPersistedPageSize('pavers', 20);
    [20,60,120,240].forEach(n => {
      const opt = document.createElement('option'); opt.value = String(n); opt.textContent = `Page ${n}`;
      if (n === defaultPage) opt.selected = true;
      pageSizeSel.appendChild(opt);
    });
    const addBtn = document.createElement('button'); addBtn.textContent = 'Create Paver'; addBtn.style.marginLeft = '8px'; addBtn.onclick = () => showPaverForm(root, null);
    toolbar.appendChild(btnCsv); toolbar.appendChild(btnXlsx); toolbar.appendChild(pageSizeSel); toolbar.appendChild(addBtn); toolbar.appendChild(quickInput);
    root.appendChild(toolbar);
    addFallbackBanner(root, 'Pavers');

    let term = ''; let pageSize = defaultPage; let tableEl = null;
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
    pageSizeSel.addEventListener('change', () => {
      pageSize = Number(pageSizeSel.value || defaultPage);
      setPersistedPageSize('pavers', pageSize);
      renderSimple();
    });

    btnCsv.onclick = () => {
      const keys = columns.map(c => c.key).filter(Boolean);
      const filtered = rows.filter(r => {
        const t = term.toLowerCase();
        return !t || Object.keys(r).some(k => String(r[k] ?? '').toLowerCase().includes(t));
      }).slice(0, pageSize);
      const header = keys.join(',');
      const lines = filtered.map(r => keys.map(k => JSON.stringify(String(r[k] ?? ''))).join(','));
      const csv = [header].concat(lines).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'pavers.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    btnXlsx.onclick = () => {
      const keys = columns.map(c => c.key).filter(Boolean);
      const filtered = rows.filter(r => {
        const t = term.toLowerCase();
        return !t || Object.keys(r).some(k => String(r[k] ?? '').toLowerCase().includes(t));
      }).slice(0, pageSize);
      const out = filtered.map(r => {
        const o = {}; keys.forEach(k => o[k] = r[k]); return o;
      });
      // eslint-disable-next-line no-undef
      const ws = XLSX.utils.json_to_sheet(out);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Pavers'); XLSX.writeFile(wb, 'pavers.xlsx');
    };

    return;
  }

  const toolbar = document.createElement('div'); toolbar.className = 'grid-toolbar';
  const btnCsv = document.createElement('button'); btnCsv.textContent = 'Export CSV';
  const btnXlsx = document.createElement('button'); btnXlsx.textContent = 'Export Excel'; btnXlsx.style.marginLeft = '8px';
  const pageSizeSel = document.createElement('select'); pageSizeSel.setAttribute('data-pagesize','true'); pageSizeSel.style.marginLeft = '8px';
  const persistedPageSize = getPersistedPageSize('pavers', 20);
  ;[20,60,120,240].forEach(n => {
    const opt = document.createElement('option'); opt.value = String(n); opt.textContent = `Page ${n}`;
    if (n === persistedPageSize) opt.selected = true;
    pageSizeSel.appendChild(opt);
  });
  const quickInput = document.createElement('input'); quickInput.type = 'text'; quickInput.placeholder = 'Search...'; quickInput.style.marginLeft = '8px';
  const addBtn = document.createElement('button'); addBtn.textContent = 'Create Paver'; addBtn.style.marginLeft = '8px'; addBtn.onclick = () => showPaverForm(root, null);
  toolbar.appendChild(btnCsv); toolbar.appendChild(btnXlsx); toolbar.appendChild(pageSizeSel); toolbar.appendChild(addBtn); toolbar.appendChild(quickInput);
  root.appendChild(toolbar);

  const gridDiv = document.createElement('div'); gridDiv.className = 'ag-theme-alpine'; gridDiv.style.width = '100%';
  root.appendChild(gridDiv);

  const columnDefs = [
    { headerName: 'Actions', field: '_actions', pinned: 'left', width: 120, minWidth: 110, maxWidth: 140, suppressHeaderMenuButton: true, sortable: false, filter: false, resizable: false, cellRenderer: (p) => {
      const wrap = document.createElement('div');
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'action-btn'; edit.textContent = '✏️'; edit.title = 'Edit Paver'; edit.setAttribute('aria-label','Edit Paver'); edit.style.marginRight = '6px'; edit.onclick = () => showPaverForm(root, p.data);
      const del = document.createElement('button'); del.type = 'button'; del.className = 'action-btn'; del.textContent = '🗑️'; del.title = 'Delete Paver'; del.setAttribute('aria-label','Delete Paver'); del.onclick = async () => {
        const r = p.data;
        if (!confirm('Delete paver ' + r.paver_id + '?')) return;
        try {
          await fetchExpectOk('/pavers/' + encodeURIComponent(r.paver_id), { method: 'DELETE' });
          showToast('Deleted paver ' + r.paver_id, 'success');
          await renderPavers(root);
        } catch (e) {
          showToast('Delete failed: ' + e, 'error');
        }
      };
      wrap.appendChild(edit); wrap.appendChild(del);
      return wrap;
    } },
    { headerName: 'ID', valueGetter: (p) => (p && p.node && typeof p.node.rowIndex === 'number') ? (p.node.rowIndex + 1) : '', width: 80, minWidth: 70, maxWidth: 90, pinned: 'left', suppressHeaderMenuButton: true, sortable: false, filter: false, resizable: false },
    { headerName: 'Paver ID', field: 'paver_id' },
    { headerName: 'Block ID', field: 'block_id' },
    { headerName: 'SLID', field: 'slid' },
    { headerName: 'Source', field: 'source' },
    { headerName: 'Thickness (mm)', field: 'thickness_mm' },
    { headerName: 'Length (mm)', field: 'length_mm' },
    { headerName: 'Width (mm)', field: 'width_mm' },
    { headerName: 'Height (mm)', field: 'height_mm' },
    { headerName: 'Finish', field: 'finish' },
    { headerName: 'Pattern', field: 'pattern' },
    { headerName: 'Pieces', field: 'pieces_count' },
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
  pageSizeSel.addEventListener('change', () => {
    const v = Number(pageSizeSel.value || persistedPageSize);
    if (gridApi && gridApi.setGridOption) gridApi.setGridOption('paginationPageSize', v);
    setPersistedPageSize('pavers', v);
  });
  btnCsv.onclick = () => { gridApi.exportDataAsCsv({ fileName: 'pavers.csv' }); };
  btnXlsx.onclick = () => {
    const cols = columnDefs.filter(c => c.field && !c.cellRenderer).map(c => c.field);
    const out = [];
    gridApi.forEachNodeAfterFilterAndSort(node => {
      const obj = {}; cols.forEach(f => { obj[f] = node.data[f]; });
      out.push(obj);
    });
    // eslint-disable-next-line no-undef
    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Pavers'); XLSX.writeFile(wb, 'pavers.xlsx');
  };
}

function showPaverForm(root, row) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';

  const modalHeader = document.createElement('div');
  modalHeader.className = 'modal-header';
  const modalTitle = document.createElement('h3');
  modalTitle.textContent = row ? `Edit Paver ${row.paver_id}` : 'Create Paver';
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
  form.id = 'paver-form-' + Math.random().toString(16).slice(2);

  let busy = null;

  const dirty = createDirtyTracker(form, { includeDisabled: true });

  async function closeAndRefresh() {
    if (busy && busy.isBusy && busy.isBusy()) return;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    try { await renderPavers(root); } catch (_) { location.hash = '#pavers?' + Date.now(); }
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
          const submitBtn = body.querySelector('.gx-edit-actions button[type="submit"]');
          if (submitBtn && typeof form.requestSubmit === 'function') form.requestSubmit(submitBtn);
          else if (submitBtn) submitBtn.click();
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

  if (row) {
    form.appendChild(formField('block_id', 'Block ID', row.block_id || ''));
    form.appendChild(formField('slid', 'SLID', row.slid || ''));
    form.appendChild(formField('thickness_mm', 'Thickness (mm)', row.thickness_mm || '', 'number'));
    form.appendChild(formField('length_mm', 'Length (mm)', row.length_mm || '', 'number'));
    form.appendChild(formField('width_mm', 'Width (mm)', row.width_mm || '', 'number'));
    form.appendChild(formField('height_mm', 'Height (mm)', row.height_mm || '', 'number'));
    form.appendChild(formField('finish', 'Finish', row.finish || ''));
    form.appendChild(formField('pattern', 'Pattern', row.pattern || ''));
    form.appendChild(formField('pieces_count', 'Pieces', row.pieces_count || '', 'number'));
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
        const st = (s.stone_type || '').toString().trim().toLowerCase();
        if (st !== 'pavers') return false;
        if (!term) return true;
        const text = [s.slid, s.block_id, s.material, s.notes || ''].map(x => String(x || '')).join(' ').toLowerCase();
        return text.includes(term);
      }).slice(0, 500);
      while (slabSelect.firstChild) slabSelect.removeChild(slabSelect.firstChild);
      const empty = document.createElement('option'); empty.value = ''; empty.textContent = filtered.length ? '-- choose slab (SLID) --' : '(no matches)';
      slabSelect.appendChild(empty);
      filtered.forEach(s => {
        const opt = document.createElement('option'); opt.value = s.slid;
        opt.textContent = `${s.slid} (block: ${s.block_id || '-'}, material: ${s.material || '-'})`;
        slabSelect.appendChild(opt);
      });
    }
    async function loadAndRenderSlabs() {
      try {
        allSlabs = await fetchJson('/api/slabs');
        renderSlabOptions();
      } catch (e) {
        showToast('Failed to load slabs: ' + e, 'error');
      }
    }
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
    form.appendChild(formField('thickness_mm', 'Thickness (mm)', '', 'number'));
    form.appendChild(formField('length_mm', 'Length (mm)', '', 'number'));
    form.appendChild(formField('width_mm', 'Width (mm)', '', 'number'));
    form.appendChild(formField('height_mm', 'Height (mm)', '', 'number'));
    form.appendChild(formField('finish', 'Finish', ''));
    form.appendChild(formField('pattern', 'Pattern', ''));
    form.appendChild(formField('pieces_count', 'Pieces', '', 'number'));
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

  const actions = document.createElement('div');
  actions.className = 'gx-edit-actions';
  const btnCancel = document.createElement('button'); btnCancel.type = 'button'; btnCancel.textContent = 'Cancel';
  btnCancel.onclick = close;
  const btnSave = document.createElement('button'); btnSave.type = 'submit'; btnSave.textContent = row ? 'Save' : 'Create';
  btnSave.setAttribute('form', form.id);
  actions.appendChild(btnCancel);
  actions.appendChild(btnSave);

  body.appendChild(form);
  body.appendChild(actions);
  modal.appendChild(modalHeader);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  busy = createBusyController({ form, primaryButton: btnSave, secondaryButtons: [btnCancel, closeBtn] });

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
      const payload = serializeForm(form);
      if (payload.slid) payload.slid = String(payload.slid).trim().toUpperCase();
      if (busy && busy.setBusy) busy.setBusy(true, row ? 'Saving…' : 'Creating…');
      if (row) {
        await fetchExpectOk('/pavers/' + encodeURIComponent(row.paver_id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        showToast('Updated paver ' + row.paver_id, 'success');
      } else {
        await fetchExpectOk('/pavers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        showToast('Created paver', 'success');
      }
      if (busy && busy.setBusy) busy.setBusy(false);
      try { dirty.markClean(); } catch (_) {}
      await closeAndRefresh();
    } catch (err) {
      showToast('Save failed: ' + err, 'error');
    } finally {
      if (busy && busy.setBusy) busy.setBusy(false);
    }
  };
}
