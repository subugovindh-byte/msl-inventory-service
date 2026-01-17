import { fetchJson, fetchExpectOk, makeTable, showToast, formField, serializeForm, addFallbackBanner, waitForAgGrid, getPersistedPageSize, setPersistedPageSize, bindGlobalSearch, cleanupRoot, registerCleanup, createBusyController, confirmUnsavedChanges, createDirtyTracker, enableAgGridResponsiveColumns } from '../utils.js';

export async function renderSuppliers(root) {
  cleanupRoot(root);
  while (root.firstChild) root.removeChild(root.firstChild);
  const header = document.createElement('div'); header.className = 'view-header';
  const title = document.createElement('h2'); title.textContent = 'Suppliers'; header.appendChild(title);
  const toolbar = document.createElement('div'); toolbar.className = 'grid-toolbar';
  const btnCsv = document.createElement('button'); btnCsv.textContent = 'Export CSV';
  const btnXlsx = document.createElement('button'); btnXlsx.textContent = 'Export Excel'; btnXlsx.style.marginLeft = '8px';
  const pageSizeSel = document.createElement('select'); pageSizeSel.setAttribute('data-pagesize','true'); pageSizeSel.style.marginLeft = '8px';
  const defaultPage = getPersistedPageSize('suppliers', 20);
  ;[20,60,120,240].forEach(n => { const opt = document.createElement('option'); opt.value = String(n); opt.textContent = `Page ${n}`; if (n === defaultPage) opt.selected = true; pageSizeSel.appendChild(opt); });
  const quickInput = document.createElement('input'); quickInput.type = 'text'; quickInput.placeholder = 'Search...'; quickInput.style.marginLeft = '8px';
  const addBtn = document.createElement('button'); addBtn.textContent = 'Create Supplier'; addBtn.style.marginLeft = '8px'; addBtn.onclick = () => showSupplierForm(root, null);
  toolbar.appendChild(btnCsv); toolbar.appendChild(btnXlsx); toolbar.appendChild(pageSizeSel); toolbar.appendChild(addBtn); toolbar.appendChild(quickInput);
  root.appendChild(header); root.appendChild(toolbar);

  // Load data
  const rows = await fetchJson('/api/suppliers');

  // Fallback simple table for now (AG Grid not necessary for small lookup)
  if (!(await waitForAgGrid(1200))) {
    addFallbackBanner(root, 'Suppliers');
    const columns = ['id','name','contact','material','quarry_location','address','phone','email','notes'];
    const actions = [
      { label: '✏️', title: 'Edit', onClick: (r) => showSupplierForm(root, r) },
      { label: '🗑️', title: 'Delete', onClick: async (r) => {
        if (!confirm('Delete supplier ' + r.name + '?')) return;
        try { await fetchExpectOk('/suppliers/' + r.id, { method: 'DELETE' }); showToast('Deleted', 'success'); renderSuppliers(root); } catch (e) { showToast('Delete failed: ' + e, 'error'); }
      } }
    ];
    let table = makeTable(columns, rows, actions);
    root.appendChild(table);
    // Fallback toolbar wiring
    registerCleanup(root, bindGlobalSearch(quickInput, (q) => {
      const term = q && String(q).toLowerCase();
      const filtered = (!term) ? rows : rows.filter(r => Object.values(r).some(v => String(v || '').toLowerCase().includes(term)));
      const newTable = makeTable(columns, filtered, actions);
      table.replaceWith(newTable);
      table = newTable;
    }));
    btnCsv.onclick = () => {
      const keys = columns;
      const lines = rows.map(r => keys.map(k => JSON.stringify(String(r[k] ?? ''))).join(','));
      const csv = [keys.join(',')].concat(lines).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'suppliers.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    btnXlsx.onclick = () => {
      const out = rows.map(r => ({ id: r.id, name: r.name, contact: r.contact, material: r.material, quarry_location: r.quarry_location, address: r.address, phone: r.phone, email: r.email, notes: r.notes }));
      // eslint-disable-next-line no-undef
      const ws = XLSX.utils.json_to_sheet(out);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Suppliers'); XLSX.writeFile(wb, 'suppliers.xlsx');
    };
    pageSizeSel.addEventListener('change', () => { setPersistedPageSize('suppliers', Number(pageSizeSel.value || defaultPage)); });
    return;
  }

  // If AG Grid available, use grid with toolbar features
  const gridDiv = document.createElement('div'); gridDiv.className = 'ag-theme-alpine'; gridDiv.style.width = '100%'; root.appendChild(gridDiv);
  const columnDefs = [
    { headerName: 'Actions', field: '_actions', pinned: 'left', width: 120, minWidth: 110, maxWidth: 140, suppressHeaderMenuButton: true, sortable: false, filter: false, resizable: false, cellRenderer: (p) => {
      const wrap = document.createElement('div');
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'action-btn'; edit.textContent = '✏️'; edit.title = 'Edit'; edit.style.marginRight = '6px';
      edit.onclick = () => showSupplierForm(root, p.data);
      const del = document.createElement('button'); del.type = 'button'; del.className = 'action-btn'; del.textContent = '🗑️'; del.title = 'Delete';
      del.onclick = async () => {
        if (!confirm('Delete supplier ' + p.data.name + '?')) return;
        try { await fetchExpectOk('/suppliers/' + p.data.id, { method: 'DELETE' }); showToast('Deleted', 'success'); renderSuppliers(root); } catch (e) { showToast('Delete failed: ' + e, 'error'); }
      };
      wrap.appendChild(edit); wrap.appendChild(del); return wrap;
    } },
    { headerName: 'ID', valueGetter: (p) => (p && p.node && typeof p.node.rowIndex === 'number') ? (p.node.rowIndex + 1) : '', width: 80, minWidth: 70, maxWidth: 90, pinned: 'left', suppressHeaderMenuButton: true, sortable: false, filter: false, resizable: false },
    { headerName: 'Supplier ID', field: 'id' },
    { headerName: 'Name', field: 'name' },
    { headerName: 'Contact', field: 'contact' },
    { headerName: 'Material', field: 'material' },
    { headerName: 'Quarry', field: 'quarry_location' },
    { headerName: 'Address', field: 'address' },
    { headerName: 'Phone', field: 'phone' },
    { headerName: 'Email', field: 'email' },
    { headerName: 'Notes', field: 'notes' },
  ];
  const persisted = getPersistedPageSize('suppliers', 20);
  const gridOptions = { columnDefs, rowData: rows, defaultColDef: { sortable: true, filter: true, resizable: true, minWidth: 110 }, pagination: true, paginationPageSize: persisted, domLayout: 'autoHeight' };
  const gridApi = (window.agGrid.createGrid ? window.agGrid.createGrid(gridDiv, gridOptions) : new window.agGrid.Grid(gridDiv, gridOptions));

  enableAgGridResponsiveColumns(root, gridApi, gridOptions);

  // Wire toolbar controls
  registerCleanup(root, bindGlobalSearch(quickInput, (q) => {
    if (gridApi && gridApi.setGridOption) gridApi.setGridOption('quickFilterText', q || '');
    else if (gridApi && gridApi.setQuickFilter) gridApi.setQuickFilter(q || '');
  }));
  pageSizeSel.addEventListener('change', () => {
    const v = Number(pageSizeSel.value || persisted);
    if (gridApi && gridApi.setGridOption) gridApi.setGridOption('paginationPageSize', v);
    else if (gridApi && gridApi.paginationSetPageSize) gridApi.paginationSetPageSize(v);
    setPersistedPageSize('suppliers', v);
  });
  btnCsv.onclick = () => { if (gridApi && gridApi.exportDataAsCsv) gridApi.exportDataAsCsv({ fileName: 'suppliers.csv' }); };
  btnXlsx.onclick = () => {
    const cols = columnDefs.filter(c => c.field && !c.cellRenderer).map(c => c.field);
    const out = [];
    if (gridApi && gridApi.forEachNodeAfterFilterAndSort) gridApi.forEachNodeAfterFilterAndSort(node => { const obj = {}; cols.forEach(f => { obj[f] = node.data[f]; }); out.push(obj); });
    // eslint-disable-next-line no-undef
    const ws = XLSX.utils.json_to_sheet(out);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Suppliers'); XLSX.writeFile(wb, 'suppliers.xlsx');
  };
}

async function showSupplierForm(root, row) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';

  const header = document.createElement('div');
  header.className = 'modal-header';
  const title = document.createElement('h3');
  title.textContent = row ? ('Edit Supplier ' + row.name) : 'Create Supplier';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.innerHTML = '&times;';
  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body';

  const form = document.createElement('form');
  form.className = 'edit-form gx-edit-form';
  form.id = 'supplier-form-' + Math.random().toString(16).slice(2);

  const name = formField('name', 'Name', row ? row.name : '');
  name.classList.add('gx-span-2');
  const contact = formField('contact', 'Primary Contact', row ? row.contact : '');
  const material = formField('material', 'Material', row ? row.material : '');
  const quarry = formField('quarry_location', 'Quarry / Location', row ? row.quarry_location : '');
  const address = formField('address', 'Address', row ? row.address : '');
  address.classList.add('gx-span-2');
  const phone = formField('phone', 'Phone', row ? row.phone : '');
  const email = formField('email', 'Email', row ? row.email : '');
  const notes = formField('notes', 'Notes', row ? row.notes : '');
  notes.classList.add('gx-span-2');
  form.appendChild(name);
  form.appendChild(contact);
  form.appendChild(material);
  form.appendChild(quarry);
  form.appendChild(address);
  form.appendChild(phone);
  form.appendChild(email);
  form.appendChild(notes);

  const actions = document.createElement('div');
  actions.className = 'gx-edit-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = row ? 'Save' : 'Create';
  save.setAttribute('form', form.id);
  actions.appendChild(cancel);
  actions.appendChild(save);

  body.appendChild(form);
  body.appendChild(actions);
  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const busy = createBusyController({ form, primaryButton: save, secondaryButtons: [cancel, closeBtn] });

  const dirty = createDirtyTracker(form, { includeDisabled: true });

  const closeAndRefresh = async () => {
    if (busy.isBusy()) return;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    try {
      if (typeof renderSuppliers === 'function') await renderSuppliers(root);
      else if (typeof window !== 'undefined' && typeof window.renderSuppliers === 'function') await window.renderSuppliers(root);
      else location.hash = '#suppliers?' + Date.now();
    } catch (_) {
      location.hash = '#suppliers?' + Date.now();
    }
  };

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

  const close = () => guardedClose();
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy.isBusy()) return;
    try {
      const payload = serializeForm(form);
      busy.setBusy(true, row ? 'Saving…' : 'Creating…');
      if (row && row.id) {
        await fetchExpectOk('/suppliers/' + row.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        showToast('Supplier updated', 'success');
      } else {
        await fetchExpectOk('/suppliers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        showToast('Supplier created', 'success');
      }
      busy.setBusy(false);
      try { dirty.markClean(); } catch (_) {}
      await closeAndRefresh();
    } catch (err) { showToast('Save failed: ' + err, 'error'); }
    finally { busy.setBusy(false); }
  });
}
