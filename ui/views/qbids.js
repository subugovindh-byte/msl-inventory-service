import { fetchJson, fetchExpectOk, makeTable, showToast, formField, formSelect, serializeForm, agGridAvailable, addFallbackBanner, waitForAgGrid, getPersistedPageSize, setPersistedPageSize, bindGlobalSearch, cleanupRoot, registerCleanup, setGlobalSearchQuery, createBusyController, confirmUnsavedChanges, createDirtyTracker, enableAgGridResponsiveColumns } from '../utils.js';

function formatTwoDecimals(value) {
  if (value === undefined || value === null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toFixed(2);
}

function formatTonsFromKg(kgValue) {
  if (kgValue === undefined || kgValue === null || kgValue === '') return '';
  const kg = Number(kgValue);
  if (!Number.isFinite(kg)) return '';
  return formatTwoDecimals(kg / 1000);
}

function formatVolumeM3(value) {
  if (value === undefined || value === null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '0';
  // For very small m³ volumes (e.g. 1x1x1 mm => 1e-9 m³), avoid rounding to 0.
  if (n < 0.01) {
    const s = n.toFixed(9);
    return s.replace(/0+$/,'').replace(/\.$/,'');
  }
  const s = n.toFixed(2);
  return s.replace(/0+$/,'').replace(/\.$/,'');
}

function parseSizeMmTriplet(sizeMmText) {
  if (sizeMmText === undefined || sizeMmText === null) return null;
  const raw = String(sizeMmText).trim();
  if (!raw) return null;
  // Accept: 3000x2000x1600, 3000 x 2000 x 1600, 3000×2000×1600
  const normalized = raw.replace(/×/g, 'x').replace(/\*/g, 'x').replace(/\s+/g, '');
  const parts = normalized.split('x').filter(Boolean);
  if (parts.length !== 3) return null;
  const nums = parts.map(p => Number(p));
  if (nums.some(n => !Number.isFinite(n) || n <= 0)) return null;
  return { length_mm: nums[0], width_mm: nums[1], height_mm: nums[2] };
}

function volumeM3FromSizeMm(sizeMmText) {
  const dims = parseSizeMmTriplet(sizeMmText);
  if (!dims) return null;
  // mm^3 -> m^3 : 1 m = 1000 mm, so divide by (1000^3) = 1e9
  return (dims.length_mm * dims.width_mm * dims.height_mm) / 1e9;
}

export async function renderQbids(root, params = {}) {
  cleanupRoot(root);
  // Ensure fresh render when called directly (not via router)
  while (root.firstChild) root.removeChild(root.firstChild);
  if (root && root.classList) root.classList.add('fade-in');
  const header = document.createElement('div'); header.className = 'view-header';
  const title = document.createElement('h2'); title.textContent = 'QBIDs'; header.appendChild(title);
  const controls = document.createElement('div'); controls.className = 'controls';
  const normalize = document.createElement('button'); normalize.textContent = 'Audit / Normalize Blocks';
  normalize.onclick = async () => {
    try {
      const r = await fetch('/admin/normalize-block-codes', { method: 'POST' });
      const j = await r.json();
      showToast('Normalize completed. Changes: ' + (j.total_updated || 0), 'success');
      location.hash = '#blocks';
    } catch (e) {
      showToast('Normalize failed: ' + e, 'error');
    }
  };
  controls.appendChild(normalize);
  // Prompt-based actions: Filter Blocks by QBID, Filter by QBID/Cap/Type/Material

  const filterPrompt = document.createElement('button'); filterPrompt.textContent = 'Filter Blocks…'; filterPrompt.style.marginLeft = '8px';
  filterPrompt.onclick = async () => {
    const target = prompt('Enter QBID to filter blocks:');
    if (!target) return;
    location.hash = '#blocks?parent=' + encodeURIComponent(target);
  };
  controls.appendChild(filterPrompt);
  const filterQbidPrompt = document.createElement('button'); filterQbidPrompt.textContent = 'Filter by QBID…'; filterQbidPrompt.style.marginLeft = '8px';
  filterQbidPrompt.onclick = () => {
    const v = prompt('Enter QBID to filter:');
    if (!v) return;
    location.hash = '#qbids?q=' + encodeURIComponent(v.trim());
  };
  controls.appendChild(filterQbidPrompt);
  const filterCapPrompt = document.createElement('button'); filterCapPrompt.textContent = 'Filter by Cap…'; filterCapPrompt.style.marginLeft = '8px';
  filterCapPrompt.onclick = () => {
    const v = prompt('Enter split count to filter:');
    if (v === null) return; const num = Number(v);
    if (isNaN(num) || num < 0) { showToast('Invalid cap', 'error'); return; }
    location.hash = '#qbids?cap=' + encodeURIComponent(String(num));
  };
  controls.appendChild(filterCapPrompt);
  const filterTypePrompt = document.createElement('button'); filterTypePrompt.textContent = 'Filter by Type…'; filterTypePrompt.style.marginLeft = '8px';
  filterTypePrompt.onclick = () => {
    const v = prompt('Enter stone type (granite/marble/quartz):');
    if (v === null) return; const val = String(v).trim().toLowerCase();
    if (val && !['granite','marble','quartz'].includes(val)) { showToast('Invalid type: ' + v, 'error'); return; }
    location.hash = '#qbids' + (val ? ('?type=' + encodeURIComponent(val)) : '');
  };
  controls.appendChild(filterTypePrompt);
  const filterMaterialPrompt = document.createElement('button'); filterMaterialPrompt.textContent = 'Filter by Material…'; filterMaterialPrompt.style.marginLeft = '8px';
  filterMaterialPrompt.onclick = () => {
    const v = prompt('Enter material names (comma-separated), e.g., Paradiso, Kuppam White:');
    if (v === null) return; const val = String(v).trim();
    location.hash = '#qbids' + (val ? ('?material=' + encodeURIComponent(val)) : '');
  };
  controls.appendChild(filterMaterialPrompt);
  const clearFilters = document.createElement('button'); clearFilters.textContent = 'Clear Filters'; clearFilters.style.marginLeft = '8px';
  clearFilters.onclick = () => { location.hash = '#qbids'; };
  controls.appendChild(clearFilters);
  header.appendChild(controls);
  root.appendChild(header);

  const qbids = await fetchJson('/api/qbids');
  const blocks = await fetchJson('/api/blocks');
  const slabs = await fetchJson('/api/slabs');

  const usedBy = {}; blocks.forEach(b => { const p = b.parent_qbid; if (p) usedBy[p] = (usedBy[p] || 0) + 1; });
  const slabsByParent = {};
  slabs.forEach(s => {
    const b = blocks.find(x => x.block_id === s.block_id);
    const p = b ? b.parent_qbid : null;
    if (p) slabsByParent[p] = (slabsByParent[p] || 0) + 1;
  });
  const rows = qbids.map(r => {
    const used = usedBy[r.qbid] || 0;
    const cap = r.splitable_blk_count;
    if (cap === null || cap === undefined) return { ...r, capacity_text: '-', capacity_over: false };
    const remain = Math.max(0, Number(cap) - Number(used));
    const over = (used > Number(cap));
    const hasSlabs = !!(slabsByParent[r.qbid]);
    const locked = (used > 0) || hasSlabs;
    return { ...r, volume_m3_from_size: volumeM3FromSizeMm(r.size_mm), capacity_text: String(remain) + '/' + String(cap), capacity_over: over, locked, children_count: used };
  });

  // Fallback when AG Grid is not available in module/global scope (wait briefly to avoid race)
  if (!(await waitForAgGrid(1200))) {
    // Basic fallback with toolbar: search, CSV/Excel export, page-size 120
    const columns = [
      { key: 'qbid', label: 'QBID' }, { key: 'supplier', label: 'Supplier', render: (r) => (r.supplier_name || r.supplier || '') }, { key: 'quarry', label: 'Quarry' }, { key: 'weight_kg', label: 'Weight (ton)', render: (r) => formatTonsFromKg(r.weight_kg) }, { key: 'gross_cost', label: 'Gross Cost' }, { key: 'transport_cost', label: 'Transport Cost' }, { key: 'other_cost', label: 'Other Cost' }, { key: 'total_cost', label: 'Total Cost' }, { key: 'size_mm', label: 'Size (mm)' }, { key: 'volume_m3_from_size', label: 'Volume (m³)', render: (r) => formatVolumeM3(r.volume_m3_from_size) }, { key: 'grade', label: 'Grade' }, { key: 'received_date', label: 'Received' }, { key: 'material_name', label: 'Material' }, { key: 'stone_type', label: 'Stone Type' }, { key: 'splitable_blk_count', label: 'Split Count' }, { key: 'capacity_text', label: 'Capacity', render: (r) => { const s = document.createElement('span'); s.className = 'badge ' + (r.capacity_over ? 'over' : 'ok'); s.textContent = r.capacity_text; return s; } }
    ];
    const actions = [
      { label: '✏️', title: (r) => r.locked ? 'Edit disabled: blocks/slabs exist for this QBID.' : 'Edit QBID', ariaLabel: (r) => r.locked ? 'Edit QBID (disabled)' : 'Edit QBID', className: 'action-btn', disabled: (r) => !!r.locked, onClick: async (r) => {
        if (r.locked) { showToast('QBID is locked; cannot edit.', 'error'); return; }
        showQbidForm(root, r);
      } },
      { label: '🗑️', title: (r) => (r.children_count > 0 ? 'Delete disabled: child blocks are split/dressed.' : 'Delete QBID'), ariaLabel: (r) => (r.children_count > 0 ? 'Delete QBID (disabled)' : 'Delete QBID'), className: 'action-btn', disabled: (r) => r.children_count > 0, onClick: async (r) => {
        if (r.children_count > 0) { showToast('Cannot delete: child blocks exist.', 'error'); return; }
        if (!confirm('Delete QBID ' + r.qbid + '?')) return;
        try {
          const resp = await fetch('/qbids/' + encodeURIComponent(r.qbid), { method: 'DELETE' });
          if (!resp.ok) {
            const j = await resp.json().catch(() => ({}));
            showToast('Delete failed: ' + (j.error || resp.statusText), 'error');
            return;
          }
          showToast('Deleted ' + r.qbid, 'success');
          location.hash = '#qbids';
        } catch (e) { showToast('Delete failed: ' + e, 'error'); }
      } },
    ];

    const toolbar = document.createElement('div'); toolbar.className = 'grid-toolbar';
    const btnCsv = document.createElement('button'); btnCsv.textContent = 'Export CSV';
    const btnXlsx = document.createElement('button'); btnXlsx.textContent = 'Export Excel'; btnXlsx.style.marginLeft = '8px';
    const pageSizeSel = document.createElement('select'); pageSizeSel.setAttribute('data-pagesize','true'); pageSizeSel.style.marginLeft = '8px';
    const quickInput = document.createElement('input'); quickInput.type = 'text'; quickInput.placeholder = 'Search...'; quickInput.style.marginLeft = '8px';
    const addBtn = document.createElement('button'); addBtn.textContent = 'Create QBID'; addBtn.style.marginLeft = '8px'; addBtn.onclick = () => showQbidForm(root, null);
    const defaultPage = getPersistedPageSize('qbids', 20);
    [20,60,120,240].forEach(n => { const opt = document.createElement('option'); opt.value = String(n); opt.textContent = `Page ${n}`; if (n === defaultPage) opt.selected = true; pageSizeSel.appendChild(opt); });
    toolbar.appendChild(btnCsv); toolbar.appendChild(btnXlsx); toolbar.appendChild(pageSizeSel); toolbar.appendChild(addBtn); toolbar.appendChild(quickInput); root.appendChild(toolbar);
    // Explicit fallback banner to clarify mode
    addFallbackBanner(root, 'QBIDs');

    let term = '';
    if (params && params.type) term = String(params.type).toLowerCase();
    const materialTokens = (params && params.material) ? String(params.material).toLowerCase().split(',').map(s => s.trim()).filter(Boolean) : [];
    let pageSize = defaultPage;
    let tableEl = null;
    const render = () => {
      const filtered = rows.filter(r => {
        const t = term.toLowerCase();
        if (params && params.type) return String(r.stone_type || '').toLowerCase() === t;
        if (materialTokens.length) {
          const m = String(r.material_name || '').toLowerCase();
          if (!materialTokens.some(tok => m.includes(tok))) return false;
        }
        if (params && params.cap !== undefined) return Number(r.splitable_blk_count) === Number(params.cap);
        if (!t) return true;
        return Object.keys(r).some(k => String(r[k] ?? '').toLowerCase().includes(t));
      });
      const page = filtered.slice(0, pageSize);
      const table = makeTable(columns, page, actions);
      if (tableEl) tableEl.remove();
      tableEl = table;
      root.appendChild(table);
    };
    if (quickInput && term) quickInput.value = term;
    if (quickInput && quickInput.value) setGlobalSearchQuery(String(quickInput.value), { emit: false });
    render();
    registerCleanup(root, bindGlobalSearch(quickInput, (q) => { term = q || ''; render(); }));
    pageSizeSel.addEventListener('change', () => { pageSize = Number(pageSizeSel.value || defaultPage); setPersistedPageSize('qbids', pageSize); render(); });
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
      const a = document.createElement('a'); a.href = url; a.download = 'qbids.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    btnXlsx.onclick = () => {
      const keys = columns.map(c => c.key).filter(Boolean);
      const filtered = rows.filter(r => {
        const t = term.toLowerCase();
        return !t || Object.keys(r).some(k => String(r[k] ?? '').toLowerCase().includes(t));
      }).slice(0, pageSize);
      const out = filtered.map(r => { const o = {}; keys.forEach(k => o[k] = r[k]); return o; });
      // eslint-disable-next-line no-undef
      const ws = XLSX.utils.json_to_sheet(out);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'QBIDs'); XLSX.writeFile(wb, 'qbids.xlsx');
    };
    return;
  }

  // Build AG Grid container
  const toolbar = document.createElement('div'); toolbar.className = 'grid-toolbar';
  const btnCsv = document.createElement('button'); btnCsv.textContent = 'Export CSV';
  const btnXlsx = document.createElement('button'); btnXlsx.textContent = 'Export Excel'; btnXlsx.style.marginLeft = '8px';
  const pageSizeSel = document.createElement('select'); pageSizeSel.setAttribute('data-pagesize','true'); pageSizeSel.style.marginLeft = '8px';
  const persistedPageSize = getPersistedPageSize('qbids', 20);
  ;[20,60,120,240].forEach(n => { const opt = document.createElement('option'); opt.value = String(n); opt.textContent = `Page ${n}`; if (n === persistedPageSize) opt.selected = true; pageSizeSel.appendChild(opt); });
  const quickInput = document.createElement('input'); quickInput.type = 'text'; quickInput.placeholder = 'Search...'; quickInput.style.marginLeft = '8px';
  const addBtn = document.createElement('button'); addBtn.textContent = 'Create QBID'; addBtn.style.marginLeft = '8px'; addBtn.onclick = () => showQbidForm(root, null);
  toolbar.appendChild(btnCsv); toolbar.appendChild(btnXlsx); toolbar.appendChild(pageSizeSel); toolbar.appendChild(addBtn); toolbar.appendChild(quickInput); root.appendChild(toolbar);

  const gridDiv = document.createElement('div'); gridDiv.className = 'ag-theme-alpine'; gridDiv.style.width = '100%';
  root.appendChild(gridDiv);

  const columnDefs = [
    { headerName: 'Actions', field: '_actions', pinned: 'left', width: 120, minWidth: 110, maxWidth: 140, suppressHeaderMenuButton: true, sortable: false, filter: false, resizable: false, cellRenderer: (p) => {
      const wrap = document.createElement('div');
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'action-btn'; edit.textContent = '✏️'; edit.title = 'Edit QBID'; edit.setAttribute('aria-label','Edit QBID');
      if (p.data.locked) { edit.disabled = true; edit.setAttribute('aria-disabled','true'); edit.title = 'Locked: blocks/slabs exist'; edit.setAttribute('aria-label','Edit QBID (locked)'); }
      edit.onclick = () => { if (p.data.locked) { showToast('QBID is locked; cannot edit.', 'error'); return; } showQbidForm(root, p.data); };
      const del = document.createElement('button'); del.type = 'button'; del.className = 'action-btn'; del.textContent = '🗑️'; del.title = 'Delete QBID'; del.setAttribute('aria-label','Delete QBID');
      if (p.data.children_count > 0) { del.disabled = true; del.setAttribute('aria-disabled','true'); del.title = 'Deletion disabled: child blocks exist'; del.setAttribute('aria-label','Delete QBID (disabled)'); }
      del.onclick = async () => {
        const r = p.data; if (r.children_count > 0) { showToast('Cannot delete: child blocks exist.', 'error'); return; }
        if (!confirm('Delete QBID ' + r.qbid + '?')) return;
        try { await fetchExpectOk('/qbids/' + encodeURIComponent(r.qbid), { method: 'DELETE' }); showToast('Deleted ' + r.qbid, 'success'); location.hash = '#qbids'; } catch (e) { showToast('Delete failed: ' + e, 'error'); }
      };
      wrap.appendChild(edit); wrap.appendChild(del); return wrap;
    } },
    { headerName: '#', headerTooltip: 'Row number (not a database ID)', valueGetter: (p) => (p && p.node && typeof p.node.rowIndex === 'number') ? (p.node.rowIndex + 1) : '', width: 70, minWidth: 60, maxWidth: 80, pinned: 'left', suppressHeaderMenuButton: true, sortable: false, filter: false, resizable: false },
    { headerName: 'ID', field: 'id', width: 90, minWidth: 80, maxWidth: 110, suppressHeaderMenuButton: true },
    { headerName: 'QBID', field: 'qbid' },
    { headerName: 'Supplier', field: 'supplier_name', valueGetter: (p) => p.data.supplier_name || p.data.supplier },
    { headerName: 'Quarry', field: 'quarry' },
    { headerName: 'Weight (ton)', field: 'weight_kg', valueFormatter: (p) => formatTonsFromKg(p && p.value) },
    { headerName: 'Gross Cost', field: 'gross_cost' },
    { headerName: 'Transport Cost', field: 'transport_cost' },
    { headerName: 'Other Cost', field: 'other_cost' },
    { headerName: 'Total Cost', field: 'total_cost' },
    { headerName: 'Size (mm)', field: 'size_mm' },
    { headerName: 'Volume (m³)', field: 'volume_m3_from_size', valueFormatter: (p) => formatVolumeM3(p && p.value) },
    { headerName: 'Grade', field: 'grade' },
    { headerName: 'Received', field: 'received_date' },
    { headerName: 'Material', field: 'material_name' },
    { headerName: 'Stone Type', field: 'stone_type' },
    { headerName: 'Split Count', field: 'splitable_blk_count' },
    { headerName: 'Capacity', field: 'capacity_text', cellRenderer: (p) => { const s = document.createElement('span'); s.className = 'badge ' + (p.data.capacity_over ? 'over' : 'ok'); s.textContent = p.value; return s; } },
  ];

  // Apply initial cap/material filter by pre-filtering rows if provided
  let initialRows = rows;
  if (params && params.cap !== undefined) initialRows = initialRows.filter(r => Number(r.splitable_blk_count) === Number(params.cap));
  if (params && params.material) {
    const tokens = String(params.material).toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (tokens.length) initialRows = initialRows.filter(r => {
      const m = String(r.material_name || '').toLowerCase();
      return tokens.some(t => m.includes(t));
    });
  }
  const gridOptions = {
    columnDefs,
    rowData: initialRows,
    defaultColDef: { sortable: true, filter: true, resizable: true, minWidth: 110 },
    pagination: true,
    paginationPageSize: persistedPageSize,
    domLayout: 'autoHeight',
  };
  const gridApi = (window.agGrid.createGrid
    ? window.agGrid.createGrid(gridDiv, gridOptions)
    : new window.agGrid.Grid(gridDiv, gridOptions));

  enableAgGridResponsiveColumns(root, gridApi, gridOptions);

  // Apply initial filter by type/q/material if provided via params
  // Apply initial filter by type if provided via params
  if (params && params.type) {
    quickInput.value = String(params.type);
    if (gridApi && gridApi.setGridOption) gridApi.setGridOption('quickFilterText', String(params.type));
  }
  if (params && params.q) {
    quickInput.value = String(params.q);
    if (gridApi && gridApi.setGridOption) gridApi.setGridOption('quickFilterText', String(params.q));
  }
  if (params && params.material) {
    quickInput.value = String(params.material);
    if (gridApi && gridApi.setGridOption) gridApi.setGridOption('quickFilterText', String(params.material));
  }
  if (quickInput && quickInput.value) setGlobalSearchQuery(String(quickInput.value), { emit: false });
  registerCleanup(root, bindGlobalSearch(quickInput, (q) => {
    if (gridApi && gridApi.setGridOption) gridApi.setGridOption('quickFilterText', q || '');
  }));
  pageSizeSel.addEventListener('change', () => {
    const v = Number(pageSizeSel.value || persistedPageSize);
    if (gridApi && gridApi.setGridOption) gridApi.setGridOption('paginationPageSize', v);
    setPersistedPageSize('qbids', v);
  });
  btnCsv.onclick = () => { gridApi.exportDataAsCsv({ fileName: 'qbids.csv' }); };
  btnXlsx.onclick = () => {
    const cols = columnDefs.filter(c => c.field && !c.cellRenderer).map(c => c.field);
    const out = [];
    gridApi.forEachNodeAfterFilterAndSort(node => {
      const obj = {}; cols.forEach(f => { obj[f] = node.data[f]; }); out.push(obj);
    });
    // eslint-disable-next-line no-undef
    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'QBIDs'); XLSX.writeFile(wb, 'qbids.xlsx');
  };

}

async function showQbidForm(root, row) {
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
  title.textContent = row ? ('Edit QBID ' + row.qbid) : 'Create QBID';
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
  form.id = 'gx-qbid-form-' + Date.now();
  body.appendChild(form);

  let busy = null;

  const dirty = createDirtyTracker(form, { includeDisabled: true });

  const close = async () => {
    if (busy && busy.isBusy && busy.isBusy()) return;
    try { document.removeEventListener('keydown', onKey); } catch (_) {}
    overlay.remove();
    try {
      if (typeof renderQbids === 'function') await renderQbids(root);
      else if (typeof window !== 'undefined' && typeof window.renderQbids === 'function') await window.renderQbids(root);
      else location.hash = '#qbids?' + Date.now();
    } catch (_) {
      location.hash = '#qbids?' + Date.now();
    }
  };

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
    await close();
  };

  closeBtn.onclick = guardedClose;
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

  // Supplier: select existing suppliers or provide manual name
  let supplier = formField('supplier_text', 'Supplier (manual)', row ? (row.supplier || '') : '');
  try {
    const suppliers = await fetchJson('/api/suppliers');
    const opts = [{ value: '', label: '-- choose or enter --' }].concat((suppliers || []).map(s => ({ id: s.id, value: s.id, name: s.name })));
    const supplierSelect = formSelect('supplier_id', 'Supplier (choose)', opts, row ? (row.supplier_id || '') : '');
    supplier = supplierSelect;
    const manual = formField('supplier_text', 'Supplier (manual)', row ? (row.supplier || '') : '');
    supplier.__manual = manual;
  } catch (e) {
    supplier = formField('supplier_text', 'Supplier', row ? (row.supplier || '') : '');
  }
  const quarry = formField('quarry', 'Quarry', row ? (row.quarry || '') : '');
  const weight = formField('weight_kg', 'Weight (ton)', row ? formatTonsFromKg(row.weight_kg) : '', 'number');
  try {
    const w = weight.querySelector('input');
    if (w) { w.step = '0.001'; w.inputMode = 'decimal'; }
  } catch (e) {}
  const size = formField('size_mm', 'Size (mm)', row ? (row.size_mm || '') : '');

  // Auto-calculated volume from size_mm (LxWxH in mm) -> m^3
  const initialVol = volumeM3FromSizeMm(row ? row.size_mm : '') ?? null;
  const volume = formField('volume_m3', 'Volume (m³)', formatVolumeM3(initialVol), 'text');
  try {
    const v = volume.querySelector('input');
    if (v) { v.readOnly = true; v.disabled = false; }
  } catch (_) {}

  try {
    const sizeInput = size.querySelector('input');
    const volInput = volume.querySelector('input');
    const recalcVol = () => {
      if (!volInput || !sizeInput) return;
      const m3 = volumeM3FromSizeMm(sizeInput.value);
      volInput.value = formatVolumeM3(m3);
    };
    if (sizeInput) {
      sizeInput.placeholder = 'e.g. 3000x2000x1600';
      sizeInput.addEventListener('input', recalcVol);
      sizeInput.addEventListener('change', recalcVol);
    }
    recalcVol();
  } catch (_) {}

  const grade = formField('grade', 'Grade', row ? (row.grade || '') : '');
  const received = formField('received_date', 'Received Date', row ? (row.received_date || '') : '', 'date');
  const materialType = formField('material_type', 'Material (name)', row ? (row.material_type || '') : '');
  const splitCap = formField('splitable_blk_count', 'Split Count (cap)', row ? (row.splitable_blk_count || '') : '', 'number');
  const gross = formField('gross_cost', 'Gross Cost', row ? (row.gross_cost || '') : '', 'number');
  const transport = formField('transport_cost', 'Transport Cost', row ? (row.transport_cost || '') : '', 'number');
  const other = formField('other_cost', 'Other Cost', row ? (row.other_cost || '') : '', 'number');
  const total = formField('total_cost', 'Total Cost', row ? (row.total_cost || '') : '', 'number');
  // make total read-only — computed from the three cost inputs
  try { const tinput = total.querySelector('input'); if (tinput) { tinput.readOnly = true; tinput.disabled = false; } } catch (e) {}
  const stoneSel = formSelect('stone_type', 'Stone Type', [
    { value: '', label: '-- choose --' },
    { value: 'granite', label: 'Granite' },
    { value: 'marble', label: 'Marble' },
    { value: 'quartz', label: 'Quartz' },
    { value: 'tiles', label: 'Tiles' },
    { value: 'cobbles', label: 'Cobbles' },
    { value: 'monuments', label: 'Monuments' }
  ], row ? (row.stone_type || '') : '');

  [supplier, quarry, weight, size, volume, grade, received, materialType, splitCap, gross, transport, other, total, stoneSel].forEach(el => form.appendChild(el));
  if (supplier && supplier.__manual) form.appendChild(supplier.__manual);

  // Make some long fields span full width (2 columns)
  const span2 = (name) => {
    try {
      const el = form.querySelector(`[name="${name}"]`);
      if (el && el.closest('.form-row')) el.closest('.form-row').classList.add('gx-span-2');
    } catch (_) {}
  };
  span2('supplier_id');
  span2('supplier_text');
  span2('size_mm');
  span2('material_type');

  // Insert lock-state banner if this QBID is locked
  let locked = false;
  if (row && row.qbid) {
    try {
      const state = await fetchJson('/qbids/' + encodeURIComponent(row.qbid) + '/lock-state');
      if (state && state.locked) {
        locked = true;
        const banner = document.createElement('div');
        banner.className = 'filter-banner';
        const msg = document.createElement('span');
        msg.textContent = 'This QBID is locked. Edits are disabled because blocks/slabs exist.';
        banner.appendChild(msg);
        const note = document.createElement('div');
        note.style.fontSize = '0.9em';
        note.style.marginTop = '6px';
        note.textContent = 'Note: This QBID is locked; only cost fields may be edited.';
        banner.appendChild(note);
        body.insertBefore(banner, form);
      }
    } catch (_) {}
  }

  const actions = document.createElement('div');
  actions.className = 'gx-edit-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  const save = document.createElement('button'); save.type = 'submit'; save.textContent = row ? 'Save' : 'Create';
  save.setAttribute('form', form.id);
  cancel.onclick = guardedClose;
  actions.appendChild(cancel);
  actions.appendChild(save);
  body.appendChild(actions);

  busy = createBusyController({ form, primaryButton: save, secondaryButtons: [cancel, closeBtn] });

  // If locked, disable all inputs/selects (allow cost fields only)
  if (locked) {
    const inputs = form.querySelectorAll('input, select, textarea');
    const editableWhenLocked = ['gross_cost','transport_cost','other_cost','total_cost'];
    inputs.forEach(el => {
      if (editableWhenLocked.includes(el.name)) el.disabled = false;
      else el.disabled = true;
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy && busy.isBusy && busy.isBusy()) return;
    try {
      const payload = serializeForm(form);
      ['weight_kg','splitable_blk_count','gross_cost','transport_cost','other_cost'].forEach(k => { if (payload[k] === '') delete payload[k]; else payload[k] = Number(payload[k]); });

      // UI uses tons; API/storage uses kg.
      if (payload.weight_kg !== undefined) {
        const tons = Number(payload.weight_kg);
        payload.weight_kg = Number.isFinite(tons) ? (tons * 1000) : payload.weight_kg;
      }

      // compute total client-side for immediate feedback and ensure server gets consistent value
      const g = Number(payload.gross_cost || 0);
      const t = Number(payload.transport_cost || 0);
      const o = Number(payload.other_cost || 0);
      payload.total_cost = g + t + o;
      // Normalize supplier fields: prefer supplier_id if selected, otherwise use manual supplier_text
      if (payload.supplier_id === '') delete payload.supplier_id; else if (payload.supplier_id) payload.supplier_id = Number(payload.supplier_id);
      if (payload.supplier_text) payload.supplier = payload.supplier_text;
      delete payload.supplier_text;

      if (busy && busy.setBusy) busy.setBusy(true, row ? 'Saving…' : 'Creating…');
      const isEdit = !!(row && row.qbid);
      const url = isEdit ? ('/qbids/' + encodeURIComponent(row.qbid)) : '/qbids';
      const method = isEdit ? 'PUT' : 'POST';
      const resp = await fetchExpectOk(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!isEdit) {
        if (resp && resp.qbid) showToast('Created QBID ' + resp.qbid, 'success'); else showToast('QBID created', 'success');
      } else {
        showToast('Updated QBID ' + row.qbid, 'success');
      }
      if (busy && busy.setBusy) busy.setBusy(false);
      try { dirty.markClean(); } catch (_) {}
      await close();
    } catch (err) {
      showToast((row ? 'Update failed: ' : 'Create failed: ') + err, 'error');
    } finally { if (busy && busy.setBusy) busy.setBusy(false); }
  });

  // Snapshot after the form is fully built (and any locked-state is applied).
  try { dirty.markClean(); } catch (_) {}
  // live-update total when cost inputs change
  try {
    const fGross = form.querySelector('[name="gross_cost"]');
    const fTransport = form.querySelector('[name="transport_cost"]');
    const fOther = form.querySelector('[name="other_cost"]');
    const fTotal = form.querySelector('[name="total_cost"]');
    const upd = () => {
      const gv = Number(fGross && fGross.value ? fGross.value : 0);
      const tv = Number(fTransport && fTransport.value ? fTransport.value : 0);
      const ov = Number(fOther && fOther.value ? fOther.value : 0);
      if (fTotal) fTotal.value = (gv + tv + ov) || '';
    };
    [fGross, fTransport, fOther].forEach(f => { if (f) f.addEventListener('input', upd); });
    upd();
  } catch (e) {}

  document.body.appendChild(overlay);
  setTimeout(() => {
    const first = form.querySelector('input, select, textarea, button');
    if (first && typeof first.focus === 'function') first.focus();
  }, 0);
}
