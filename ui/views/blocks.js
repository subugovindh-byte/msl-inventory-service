import { fetchJson, fetchExpectOk, makeTable, formField, formSelect, showToast, agGridAvailable, addFallbackBanner, waitForAgGrid, getPersistedPageSize, setPersistedPageSize, bindGlobalSearch, cleanupRoot, registerCleanup, promptWithSuggestions, createBusyController, confirmUnsavedChanges, createDirtyTracker, enableAgGridResponsiveColumns } from '../utils.js';

let blocksFilterParent = null;

export async function renderBlocks(root, params = {}) {
  cleanupRoot(root);
  // Ensure fresh render when called directly (not via router)
  while (root.firstChild) root.removeChild(root.firstChild);
  if (root && root.classList) root.classList.add('fade-in');
  blocksFilterParent = params.parent || blocksFilterParent;

  const header = document.createElement('div'); header.className = 'view-header';
  const title = document.createElement('h2'); title.textContent = 'Blocks'; header.appendChild(title);

  const genBtn = document.createElement('button'); genBtn.textContent = 'Generate Blocks';
  genBtn.onclick = async () => {
    const eligible = await fetchJson('/api/qbids-eligible-block-generation');
    const eligibleIds = eligible.map(q => ({
      value: q.qbid,
      label: `${q.qbid} (remaining ${Number(q.remaining_blocks || 0)})`,
    }));
    if (!eligibleIds.length) {
      showToast('No eligible QBIDs found (all blocks already generated, or split count is 0).', 'info');
      return;
    }
    const qbid = await promptWithSuggestions({
      title: 'Generate Blocks',
      placeholder: 'Type QBID (e.g. qbid-parm-00001)…',
      note: `Eligible QBIDs (remaining > 0): ${eligibleIds.length}. Type a few characters to filter, then press Enter.`,
      suggestions: eligibleIds,
      initialValue: (eligibleIds.length === 1 ? eligibleIds[0].value : ''),
      maxSuggestions: 18,
    });
    if (!qbid) return;
    const parent = eligible.find(q => q.qbid === qbid);
    if (!parent) { alert('Not eligible or not found.'); return; }
    try {
      const childrenInfoRes = await fetch(`/blocks/${encodeURIComponent(qbid)}/children`);
      const childrenInfo = await childrenInfoRes.json();
      const current = Array.isArray(childrenInfo.children) ? childrenInfo.children.length : 0;
      const cap = Number(parent.splitable_blk_count) || 0;
      const remaining = Math.max(0, cap - current);
      if (remaining <= 0) { showToast('No new blocks to generate for ' + qbid + ' (cap ' + cap + ', current ' + current + ')', 'info'); return; }
      const data = await fetchExpectOk(`/blocks/generate/${encodeURIComponent(qbid)}`, { method: 'POST' });
      if (data.created && data.created.length) {
        showToast('Created ' + data.created.length + ' block(s) for ' + qbid, 'success');
        blocksFilterParent = qbid; location.hash = '#blocks?parent=' + encodeURIComponent(qbid);
      } else {
        showToast('No new blocks created for ' + qbid + ' (already up to date).', 'info');
        blocksFilterParent = qbid; location.hash = '#blocks?parent=' + encodeURIComponent(qbid);
      }
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      if (/all blocks already generated/i.test(msg)) {
        showToast('No new blocks created for ' + qbid + ' (already fully generated).', 'info');
        blocksFilterParent = qbid; location.hash = '#blocks?parent=' + encodeURIComponent(qbid);
        return;
      }
      showToast('Generate failed: ' + msg, 'error');
    }
  };
  header.appendChild(genBtn);

  const filterBtn = document.createElement('button'); filterBtn.textContent = 'Filter Parent…'; filterBtn.style.marginLeft = '8px';
  filterBtn.onclick = () => {
    const target = prompt('Enter Parent QBID to filter:');
    if (!target) return;
    blocksFilterParent = target.trim();
    location.hash = '#blocks?parent=' + encodeURIComponent(blocksFilterParent);
  };
  header.appendChild(filterBtn);
  const clearFilterBtn = document.createElement('button'); clearFilterBtn.textContent = 'Clear Filter'; clearFilterBtn.style.marginLeft = '8px';
  clearFilterBtn.onclick = () => { blocksFilterParent = null; location.hash = '#blocks'; };
  header.appendChild(clearFilterBtn);

  if (blocksFilterParent) {
    const banner = document.createElement('div'); banner.className = 'filter-banner';
    const span = document.createElement('span'); span.textContent = 'Showing blocks for ' + blocksFilterParent;
    const clr = document.createElement('button'); clr.textContent = 'Clear Filter'; clr.style.marginLeft = '8px'; clr.onclick = () => { blocksFilterParent = null; location.hash = '#blocks'; };
    banner.appendChild(span); banner.appendChild(clr);
    header.appendChild(banner);
  }

  root.appendChild(header);

  let rows = await fetchJson('/api/blocks');
  const slabs = await fetchJson('/api/slabs');
  const tiles = await fetchJson('/api/tiles');
  const cobbles = await fetchJson('/api/cobbles');
  const monuments = await fetchJson('/api/monuments');
  const qbids = await fetchJson('/api/qbids');
  const capBy = Object.fromEntries(qbids.map(q => [q.qbid, q.splitable_blk_count]));
  if (blocksFilterParent) rows = rows.filter(r => r.parent_qbid === blocksFilterParent);

  const siblings = {};
  rows.forEach(r => { const p = r.parent_qbid || '__NONE__'; (siblings[p] = siblings[p] || []).push(r); });
  const indexByBlock = {};
  Object.keys(siblings).forEach(p => { const list = siblings[p].slice().sort((a,b) => String(a.block_id).localeCompare(String(b.block_id))); list.forEach((r, i) => { indexByBlock[r.block_id] = i + 1; }); });
  const withCapacity = rows.map(r => {
    const p = r.parent_qbid; const cap = p ? capBy[p] : null;
    if (!p || cap === null || cap === undefined) return { ...r, capacity_text: '-' , capacity_over: false };
    const used = indexByBlock[r.block_id] || 0; const over = used > Number(cap);
    const slabCount = slabs.filter(s => s.block_id === r.block_id).length;
    const tileCount = tiles.filter(t => t.block_id === r.block_id).length;
    const cobbleCount = cobbles.filter(c => c.block_id === r.block_id).length;
    const monumentCount = monuments.filter(m => m.block_id === r.block_id).length;
    const children_count = slabCount + tileCount + cobbleCount + monumentCount;
    const locked = slabCount > 0; // disable edit when slabs exist
    return { ...r, capacity_text: String(used) + '/' + String(cap), capacity_over: over, locked, children_count };
  });

  // Fallback when AG Grid is not available in module/global scope (wait briefly to avoid race)
  if (!(await waitForAgGrid(1200))) {
    const columns = [
      { key: 'block_id', label: 'Block ID' }, { key: 'parent_qbid', label: 'Parent QBID' }, { key: 'capacity_text', label: 'Capacity', render: (r) => { const s = document.createElement('span'); s.className = 'badge ' + (r.capacity_over ? 'over' : 'ok'); s.textContent = r.capacity_text; return s; } }, { key: 'no_slabs', label: 'No. Slabs' }, { key: 'no_wastage_slabs', label: 'No. Wastage Slabs' }, { key: 'grade', label: 'Grade' }, { key: 'short_code', label: 'Short code' }, { key: 'receipt_id', label: 'Receipt ID' }, { key: 'receipt_date', label: 'Receipt Date' }, { key: 'source_name', label: 'Source' }, { key: 'material', label: 'Material' }, { key: 'length_mm', label: 'L (mm)' }, { key: 'width_mm', label: 'W (mm)' }, { key: 'height_mm', label: 'H (mm)' }, { key: 'volume_m3', label: 'Volume (m3)' }, { key: 'yard_location', label: 'Yard' }, { key: 'status', label: 'Status' }
    ];
    const actions = [
      { label: '✏️', title: (r) => r.locked ? 'Edit disabled: blocks/slabs exist for this block.' : 'Edit Block', ariaLabel: (r) => r.locked ? 'Edit Block (disabled)' : 'Edit Block', className: 'action-btn', disabled: (r) => !!r.locked, onClick: async (r) => { if (r.locked) { showToast('Block is locked; cannot edit (slabs exist).', 'error'); return; } showEditForm(root, r); } },
      { label: '🗑️', title: (r) => (r.children_count > 0 ? 'Delete disabled: child blocks are split/dressed.' : 'Delete Block'), ariaLabel: (r) => (r.children_count > 0 ? 'Delete Block (disabled)' : 'Delete Block'), className: 'action-btn', disabled: (r) => r.children_count > 0, onClick: async (r) => {
        if (r.children_count > 0) { showToast('Cannot delete: child items exist.', 'error'); return; }
        if (!confirm('Delete ' + r.block_id + '?')) return;
        try {
          await fetchExpectOk('/blocks/' + encodeURIComponent(r.block_id), { method: 'DELETE' });
          showToast('Deleted block ' + r.block_id, 'success');
          location.hash = '#blocks' + (blocksFilterParent ? ('?parent=' + encodeURIComponent(blocksFilterParent)) : '');
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
    const defaultPage = getPersistedPageSize('blocks', 20);
    [20,60,120,240].forEach(n => { const opt = document.createElement('option'); opt.value = String(n); opt.textContent = `Page ${n}`; if (n === defaultPage) opt.selected = true; pageSizeSel.appendChild(opt); });
    toolbar.appendChild(btnCsv); toolbar.appendChild(btnXlsx); toolbar.appendChild(pageSizeSel); toolbar.appendChild(quickInput); root.appendChild(toolbar);
    // Explicit fallback banner to clarify mode
    addFallbackBanner(root, 'Blocks');

    let term = '';
    let pageSize = defaultPage;
    let tableEl = null;
    const renderSimple = () => {
      const filtered = withCapacity.filter(r => {
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
    pageSizeSel.addEventListener('change', () => { pageSize = Number(pageSizeSel.value || defaultPage); setPersistedPageSize('blocks', pageSize); renderSimple(); });
    btnCsv.onclick = () => {
      const keys = columns.map(c => c.key).filter(Boolean);
      const filtered = withCapacity.filter(r => { const t = term.toLowerCase(); return !t || Object.keys(r).some(k => String(r[k] ?? '').toLowerCase().includes(t)); }).slice(0, pageSize);
      const header = keys.join(',');
      const lines = filtered.map(r => keys.map(k => JSON.stringify(String(r[k] ?? ''))).join(','));
      const csv = [header].concat(lines).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'blocks.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    btnXlsx.onclick = () => {
      const keys = columns.map(c => c.key).filter(Boolean);
      const filtered = withCapacity.filter(r => { const t = term.toLowerCase(); return !t || Object.keys(r).some(k => String(r[k] ?? '').toLowerCase().includes(t)); }).slice(0, pageSize);
      const out = filtered.map(r => { const o = {}; keys.forEach(k => o[k] = r[k]); return o; });
      // eslint-disable-next-line no-undef
      const ws = XLSX.utils.json_to_sheet(out);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Blocks'); XLSX.writeFile(wb, 'blocks.xlsx');
    };
    return;
  }

  // AG Grid: toolbar and grid container
  const toolbar = document.createElement('div'); toolbar.className = 'grid-toolbar';
  const btnCsv = document.createElement('button'); btnCsv.textContent = 'Export CSV';
  const btnXlsx = document.createElement('button'); btnXlsx.textContent = 'Export Excel'; btnXlsx.style.marginLeft = '8px';
  const pageSizeSel = document.createElement('select'); pageSizeSel.setAttribute('data-pagesize','true'); pageSizeSel.style.marginLeft = '8px';
  const persistedPageSize = getPersistedPageSize('blocks', 20);
  ;[20,60,120,240].forEach(n => { const opt = document.createElement('option'); opt.value = String(n); opt.textContent = `Page ${n}`; if (n === persistedPageSize) opt.selected = true; pageSizeSel.appendChild(opt); });
  const quickInput = document.createElement('input'); quickInput.type = 'text'; quickInput.placeholder = 'Search...'; quickInput.style.marginLeft = '8px';
  toolbar.appendChild(btnCsv); toolbar.appendChild(btnXlsx); toolbar.appendChild(pageSizeSel); toolbar.appendChild(quickInput); root.appendChild(toolbar);

  const gridDiv = document.createElement('div'); gridDiv.className = 'ag-theme-alpine'; gridDiv.style.width = '100%';
  root.appendChild(gridDiv);

  const columnDefs = [
    { headerName: 'Actions', field: '_actions', pinned: 'left', width: 120, minWidth: 110, maxWidth: 140, suppressHeaderMenuButton: true, sortable: false, filter: false, resizable: false, cellRenderer: (p) => {
      const wrap = document.createElement('div');
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'action-btn'; edit.textContent = '✏️'; edit.title = 'Edit Block'; edit.setAttribute('aria-label','Edit Block'); edit.style.marginRight = '6px';
      if (p.data.locked) { edit.disabled = true; edit.setAttribute('aria-disabled','true'); edit.title = 'Locked: slabs exist'; edit.setAttribute('aria-label','Edit Block (locked)'); }
      edit.onclick = () => { if (p.data.locked) { showToast('Block is locked; cannot edit (slabs exist).', 'error'); return; } showEditForm(root, p.data); };
      const del = document.createElement('button'); del.type = 'button'; del.className = 'action-btn'; del.textContent = '🗑️'; del.title = 'Delete Block'; del.setAttribute('aria-label','Delete Block');
      if (p.data.children_count > 0) { del.disabled = true; del.setAttribute('aria-disabled','true'); del.title = 'Deletion disabled: child items exist'; del.setAttribute('aria-label','Delete Block (disabled)'); }
      del.onclick = async () => {
        const r = p.data; if (r.children_count > 0) { showToast('Cannot delete: child items exist.', 'error'); return; }
        if (!confirm('Delete ' + r.block_id + '?')) return;
        try { await fetchExpectOk('/blocks/' + encodeURIComponent(r.block_id), { method: 'DELETE' }); showToast('Deleted block ' + r.block_id, 'success'); location.hash = '#blocks' + (blocksFilterParent ? ('?parent=' + encodeURIComponent(blocksFilterParent)) : ''); } catch (e) { showToast('Delete failed: ' + e, 'error'); }
      };
      wrap.appendChild(edit); wrap.appendChild(del); return wrap;
    } },
    { headerName: 'ID', valueGetter: (p) => (p && p.node && typeof p.node.rowIndex === 'number') ? (p.node.rowIndex + 1) : '', width: 80, minWidth: 70, maxWidth: 90, pinned: 'left', suppressHeaderMenuButton: true, sortable: false, filter: false, resizable: false },
    { headerName: 'Block ID', field: 'block_id' },
    
    { headerName: 'Parent QBID', field: 'parent_qbid' },
    { headerName: 'Capacity', field: 'capacity_text', cellRenderer: (p) => { const s = document.createElement('span'); s.className = 'badge ' + (p.data.capacity_over ? 'over' : 'ok'); s.textContent = p.value; return s; } },
    { headerName: 'No. Slabs', field: 'no_slabs' },
    { headerName: 'No. Wastage Slabs', field: 'no_wastage_slabs' },
    { headerName: 'Grade', field: 'grade' },
    { headerName: 'Short code', field: 'short_code' },
    { headerName: 'Receipt ID', field: 'receipt_id' },
    { headerName: 'Receipt Date', field: 'receipt_date' },
    { headerName: 'Source', field: 'source_name' },
    { headerName: 'Material', field: 'material' },
    { headerName: 'L (mm)', field: 'length_mm' },
    { headerName: 'W (mm)', field: 'width_mm' },
    { headerName: 'H (mm)', field: 'height_mm' },
    { headerName: 'Volume (m3)', field: 'volume_m3' },
    { headerName: 'Yard', field: 'yard_location' },
    { headerName: 'Status', field: 'status' },
  ];

  const gridOptions = {
    columnDefs,
    rowData: withCapacity,
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
    setPersistedPageSize('blocks', v);
  });

  btnCsv.onclick = () => { gridApi.exportDataAsCsv({ fileName: 'blocks.csv' }); };
  btnXlsx.onclick = () => {
    const cols = columnDefs.filter(c => c.field && !c.cellRenderer).map(c => c.field);
    const out = [];
    gridApi.forEachNodeAfterFilterAndSort(node => { const obj = {}; cols.forEach(f => { obj[f] = node.data[f]; }); out.push(obj); });
    // eslint-disable-next-line no-undef
    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Blocks'); XLSX.writeFile(wb, 'blocks.xlsx');
  };

  const addBtn = document.createElement('button'); addBtn.textContent = 'Create Block';
  addBtn.onclick = () => showEditForm(root, null);
  root.appendChild(addBtn);
}

async function showEditForm(root, row) {
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
  title.textContent = row ? `Edit Block ${row.block_id}` : 'Create Block';
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
  form.className = 'gx-edit-form';
  form.id = 'gx-block-form-' + Date.now();
  body.appendChild(form);

  let busy = null;

  const close = async () => {
    overlay.remove();
    try {
      if (typeof renderBlocks === 'function') await renderBlocks(root, { parent: blocksFilterParent });
      else if (typeof window !== 'undefined' && typeof window.renderBlocks === 'function') await window.renderBlocks(root, { parent: blocksFilterParent });
      else location.hash = '#blocks' + (blocksFilterParent ? ('?parent=' + encodeURIComponent(blocksFilterParent)) : '') + '&' + Date.now();
    } catch (_) {
      location.hash = '#blocks' + (blocksFilterParent ? ('?parent=' + encodeURIComponent(blocksFilterParent)) : '') + '&' + Date.now();
    }
  };

  const dirty = createDirtyTracker(form, { includeDisabled: true });

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
  overlay.addEventListener('remove', () => document.removeEventListener('keydown', onKey));

  if (row) {
    // Supplier: select existing suppliers or provide manual name
    let supplier = formField('supplier_text', 'Supplier (manual)', row ? (row.supplier || '') : '');
    try {
      const suppliers = await fetchJson('/api/suppliers');
      const opts = (suppliers || []).map(s => ({ id: s.id, value: s.id, name: s.name }));
      const supplierSelect = formSelect('supplier_id', 'Supplier (choose)', opts, row ? (row.supplier_id || '') : '');
      supplier = supplierSelect;
      const manual = formField('supplier_text', 'Supplier (manual)', row ? (row.supplier || '') : '');
      supplier.__manual = manual;
    } catch (e) {
      supplier = formField('supplier_text', 'Supplier', row ? (row.supplier || '') : '');
    }
    form.appendChild(supplier);
    if (supplier && supplier.__manual) form.appendChild(supplier.__manual);
    form.appendChild(formField('grade', 'Grade', row.grade || ''));
    form.appendChild(formField('source_id', 'Source ID', row.source_id || ''));
    form.appendChild(formField('source_name', 'Source Name', row.source_name || ''));
    
    form.appendChild(formField('short_code', 'Short code', row.short_code || ''));
    form.appendChild(formField('receipt_id', 'Receipt ID', row.receipt_id || ''));
    form.appendChild(formField('receipt_date', 'Receipt date', row.receipt_date || '', 'date'));
    
    form.appendChild(formField('material', 'Material', row.material || ''));
    form.appendChild(formField('description', 'Description', row.description || ''));
    form.appendChild(formField('length_mm', 'Length (mm)', row.length_mm || '', 'number'));
    form.appendChild(formField('width_mm', 'Width (mm)', row.width_mm || '', 'number'));
    form.appendChild(formField('height_mm', 'Height (mm)', row.height_mm || '', 'number'));
    form.appendChild(formField('volume_m3', 'Volume (m3)', row.volume_m3 || '', 'number'));
    form.appendChild(formField('no_slabs', 'No. Slabs', row.no_slabs ?? ''));
    form.appendChild(formField('no_wastage_slabs', 'No. Wastage Slabs', row.no_wastage_slabs ?? ''));
    form.appendChild(formField('yard_location', 'Yard', row.yard_location || ''));
    form.appendChild(formSelect('status', 'Status', [
      { value: 'Dressed', label: 'Dressed' },
      { value: 'Sliced', label: 'Sliced' },
      { value: 'Ditached', label: 'Ditached' },
      { value: 'Ready to resin line', label: 'Ready to resin line' },
    ], row.status || ''));
    form.appendChild(formField('notes', 'Notes', row.notes || ''));
    
  } else {
    // Supplier: select existing suppliers or provide manual name
    let supplier = formField('supplier_text', 'Supplier (manual)', '');
    try {
      const suppliers = await fetchJson('/api/suppliers');
      const opts = (suppliers || []).map(s => ({ id: s.id, value: s.id, name: s.name }));
      const supplierSelect = formSelect('supplier_id', 'Supplier (choose)', opts, '');
      supplier = supplierSelect;
      const manual = formField('supplier_text', 'Supplier (manual)', '');
      supplier.__manual = manual;
    } catch (e) {
      supplier = formField('supplier_text', 'Supplier', '');
    }
    form.appendChild(supplier);
    if (supplier && supplier.__manual) form.appendChild(supplier.__manual);
    form.appendChild(formField('block_id', 'Local Block ID', ''));
    const parentWrap = document.createElement('div'); parentWrap.className = 'form-row';
    const parentLabel = document.createElement('label'); parentLabel.textContent = 'Parent QBID'; parentLabel.htmlFor = 'parent_qbid';
    const parentSelect = document.createElement('select'); parentSelect.id = 'parent_qbid'; parentSelect.name = 'parent_qbid';
    const emptyOpt = document.createElement('option'); emptyOpt.value = ''; emptyOpt.textContent = '-- choose --'; parentSelect.appendChild(emptyOpt);
    parentWrap.appendChild(parentLabel); parentWrap.appendChild(parentSelect); form.appendChild(parentWrap);
    try { const qbs = await fetchJson('/api/qbids'); qbs.forEach(q => { const opt = document.createElement('option'); opt.value = q.qbid; opt.textContent = q.qbid + (q.splitable_blk_count != null ? (' (split ' + q.splitable_blk_count + ')') : ''); parentSelect.appendChild(opt); }); } catch (e) {}
    form.appendChild(formField('suffix', 'Suffix', 'A'));
    form.appendChild(formField('grade', 'Grade', ''));
    form.appendChild(formField('short_code', 'Short code', ''));
    
    form.appendChild(formField('receipt_id', 'Receipt ID', ''));
    form.appendChild(formField('receipt_date', 'Receipt date', '', 'date'));
    form.appendChild(formField('source_name', 'Source name', ''));
    
    form.appendChild(formField('material', 'Material', ''));
    form.appendChild(formField('length_mm', 'Length (mm)', '', 'number'));
    form.appendChild(formField('width_mm', 'Width (mm)', '', 'number'));
    form.appendChild(formField('height_mm', 'Height (mm)', '', 'number'));
    form.appendChild(formField('volume_m3', 'Volume (m3)', '', 'number'));
    form.appendChild(formField('no_slabs', 'No. Slabs', ''));
    form.appendChild(formField('no_wastage_slabs', 'No. Wastage Slabs', ''));
    form.appendChild(formField('yard_location', 'Yard', ''));
    form.appendChild(formSelect('status', 'Status', [
      { value: 'Dressed', label: 'Dressed' },
      { value: 'Sliced', label: 'Sliced' },
      { value: 'Ditached', label: 'Ditached' },
      { value: 'Ready to resin line', label: 'Ready to resin line' },
    ], ''));
    
  }

  const actions = document.createElement('div');
  actions.className = 'gx-edit-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Close';
  const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Save';
  save.setAttribute('form', form.id);
  cancel.onclick = guardedClose;
  actions.appendChild(cancel);
  actions.appendChild(save);
  body.appendChild(actions);

  busy = createBusyController({ form, primaryButton: save, secondaryButtons: [cancel, closeBtn] });

  // Make long fields span full width (2 columns)
  for (const k of ['description', 'notes']) {
    const el = form.querySelector(`[name="${k}"]`);
    if (el && el.closest('.form-row')) el.closest('.form-row').classList.add('gx-span-2');
  }
  // Parent QBID selector row is constructed manually; make it span full width
  const parentSel = form.querySelector('[name="parent_qbid"]');
  if (parentSel && parentSel.closest('.form-row')) parentSel.closest('.form-row').classList.add('gx-span-2');

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (busy && busy.isBusy && busy.isBusy()) return;
    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      ['length_mm','width_mm','height_mm','volume_m3','no_slabs','no_wastage_slabs'].forEach(k => { if (payload[k] === '') delete payload[k]; else payload[k] = Number(payload[k]); });
      // Normalize supplier fields: prefer supplier_id if selected, otherwise use manual supplier_text
      if (payload.supplier_id === '') delete payload.supplier_id; else if (payload.supplier_id) payload.supplier_id = Number(payload.supplier_id);
      if (payload.supplier_text) payload.supplier = payload.supplier_text;
      delete payload.supplier_text;
      if (busy && busy.setBusy) busy.setBusy(true, row ? 'Saving…' : 'Creating…');
      if (row && row.block_id) {
        await fetchExpectOk('/blocks/' + encodeURIComponent(row.block_id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        showToast('Saved block ' + row.block_id, 'success');
      } else {
        await fetchExpectOk('/blocks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        showToast('Created block', 'success');
      }
      // Mark form as clean after successful save.
      try { dirty.markClean(); } catch (_) {}
      await close();
    } catch (err) { showToast('Error: ' + (err && err.message ? err.message : err), 'error'); }
    finally { if (busy && busy.setBusy) busy.setBusy(false); }
  };

  document.body.appendChild(overlay);
  // Snapshot after the form is fully built.
  try { dirty.markClean(); } catch (_) {}
  // Focus first input for faster editing
  setTimeout(() => {
    const first = form.querySelector('input, select, textarea, button');
    if (first && typeof first.focus === 'function') first.focus();
  }, 0);
}
