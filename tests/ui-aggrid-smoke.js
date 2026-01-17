/* UI AG Grid smoke test: ensures grids render across views */
const { JSDOM } = require('jsdom');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const app = require('../index');

function ok(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else { console.log('PASS:', msg); } }

function superFetch(app) {
  return async function(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = options.headers || {};
    const body = options.body || undefined;
    const agent = request(app);
    let req;
    if (method === 'GET') req = agent.get(url);
    else if (method === 'POST') req = agent.post(url);
    else if (method === 'PUT') req = agent.put(url);
    else if (method === 'DELETE') req = agent.delete(url);
    else req = agent.get(url);
    Object.entries(headers).forEach(([k,v]) => req.set(k, v));
    if (body) req.send(typeof body === 'string' ? body : body);
    const res = await req;
    const json = () => Promise.resolve(res.body);
    return { ok: res.status >= 200 && res.status < 300, status: res.status, statusText: '', json };
  };
}

(async () => {
  // Seed minimal data for views
  const mats = await request(app).get('/api/materials');
  const materialId = mats.body[0] ? mats.body[0].id : null;
  const cq = await request(app).post('/qbids').send({ supplier: 'AGGridTest', quarry: 'Q', weight_kg: 1, size_mm: '1x1x1', grade: 'A', received_date: '2026-01-04', material_id: materialId, splitable_blk_count: 2 });
  const qbid = cq.body.qbid;
  await request(app).post('/blocks').send({ block_id: `${qbid}-BLOCK-AG-001`, parent_qbid: qbid });
  await request(app).post('/slabs').send({ block_id: `${qbid}-BLOCK-AG-001`, thickness_mm: 20, machine_id: 'M1', slabs_yield: 5 });
  const dom = new JSDOM(`<!doctype html><html><body><div id="content"></div></body></html>`);
  const sandbox = { window: dom.window, document: dom.window.document, fetch: superFetch(app), console, setTimeout, clearTimeout };

  // Stub AG Grid so views use the AG Grid path rather than fallback
  sandbox.agGrid = {
    Grid: function(div, options) {
      // Assign minimal API used by code
      options.api = {
        exportDataAsCsv: () => {},
        forEachNodeAfterFilterAndSort: (cb) => {
          (options.rowData || []).forEach((row, idx) => cb({ data: row, rowIndex: idx }));
        },
        setQuickFilter: () => {},
        paginationSetPageSize: () => {}
      };
      // Render a minimal table for visibility assertion
      const table = sandbox.document.createElement('table');
      const thead = sandbox.document.createElement('thead');
      const trh = sandbox.document.createElement('tr');
      (options.columnDefs || []).forEach(c => { const th = sandbox.document.createElement('th'); th.textContent = c.headerName || c.field; trh.appendChild(th); });
      thead.appendChild(trh); table.appendChild(thead);
      const tbody = sandbox.document.createElement('tbody');
      (options.rowData || []).slice(0, 3).forEach(row => {
        const tr = sandbox.document.createElement('tr');
        (options.columnDefs || []).forEach(c => { const td = sandbox.document.createElement('td'); td.textContent = row[c.field] !== undefined ? String(row[c.field]) : ''; tr.appendChild(td); });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      div.appendChild(table);
    }
  };
  // Expose stub on window for module code
  sandbox.window.agGrid = sandbox.agGrid;

  // Stub XLSX to avoid export errors
  sandbox.XLSX = {
    utils: {
      json_to_sheet: () => ({}),
      book_new: () => ({}),
      book_append_sheet: () => {}
    },
    writeFile: () => {}
  };

  // Load utils
  const uiBase = path.join(__dirname, '../ui');
  let utils = fs.readFileSync(path.join(uiBase, 'utils.js'), 'utf8').split('export ').join('');
  vm.runInNewContext(utils, sandbox, { filename: path.join(uiBase, 'utils.js') });

  function stripImports(src) {
    return src.split('\n').filter(line => !line.startsWith('import ')).join('\n');
  }

  function loadView(file, exportName) {
    let src = fs.readFileSync(path.join(uiBase, 'views', file), 'utf8');
    src = stripImports(src);
    src = src.split(`export async function ${exportName}(`).join(`window.${exportName} = async function(`);
    vm.runInNewContext(src, sandbox, { filename: path.join(uiBase, 'views', file) });
  }

  loadView('qbids.js', 'renderQbids');
  loadView('blocks.js', 'renderBlocks');
  loadView('slabs.js', 'renderSlabs');
  loadView('events.js', 'renderEvents');
  loadView('dispatches.js', 'renderDispatches');

  const root = dom.window.document.getElementById('content');

  // Render QBIDs
  await sandbox.window.renderQbids(root);
  let grid = dom.window.document.querySelector('.ag-theme-alpine');
  ok(!!grid, 'QBIDs AG Grid container exists');
  ok(grid.children.length > 0, 'QBIDs grid rendered content');
  let search = dom.window.document.querySelector('input[placeholder="Search..."]');
  ok(!!search, 'QBIDs toolbar search exists');
  let pageSel = dom.window.document.querySelector('select[data-pagesize]');
  ok(!!pageSel, 'QBIDs toolbar page size exists');
  search.value = 'AGGridTest'; search.dispatchEvent(new dom.window.Event('input'));
  pageSel.value = '60'; pageSel.dispatchEvent(new dom.window.Event('change'));

  // Clear root and render Blocks
  while (root.firstChild) root.removeChild(root.firstChild);
  await sandbox.window.renderBlocks(root);
  grid = dom.window.document.querySelector('.ag-theme-alpine');
  ok(!!grid, 'Blocks AG Grid container exists');
  ok(grid.children.length > 0, 'Blocks grid rendered content');
  search = dom.window.document.querySelector('input[placeholder="Search..."]');
  ok(!!search, 'Blocks toolbar search exists');
  pageSel = dom.window.document.querySelector('select[data-pagesize]');
  ok(!!pageSel, 'Blocks toolbar page size exists');
  search.value = 'BLOCK'; search.dispatchEvent(new dom.window.Event('input'));
  pageSel.value = '240'; pageSel.dispatchEvent(new dom.window.Event('change'));

  // Clear root and render Slabs
  while (root.firstChild) root.removeChild(root.firstChild);
  await sandbox.window.renderSlabs(root);
  grid = dom.window.document.querySelector('.ag-theme-alpine');
  ok(!!grid, 'Slabs AG Grid container exists');
  ok(grid.children.length > 0, 'Slabs grid rendered content');
  search = dom.window.document.querySelector('input[placeholder="Search..."]');
  ok(!!search, 'Slabs toolbar search exists');
  pageSel = dom.window.document.querySelector('select[data-pagesize]');
  ok(!!pageSel, 'Slabs toolbar page size exists');
  search.value = 'SLID'; search.dispatchEvent(new dom.window.Event('input'));
  pageSel.value = '120'; pageSel.dispatchEvent(new dom.window.Event('change'));

  // Clear root and render Events
  while (root.firstChild) root.removeChild(root.firstChild);
  await sandbox.window.renderEvents(root);
  grid = dom.window.document.querySelector('.ag-theme-alpine');
  ok(!!grid, 'Events AG Grid container exists');
  ok(grid.children.length > 0, 'Events grid rendered content');
  search = dom.window.document.querySelector('input[placeholder="Search..."]');
  ok(!!search, 'Events toolbar search exists');
  pageSel = dom.window.document.querySelector('select[data-pagesize]');
  ok(!!pageSel, 'Events toolbar page size exists');
  search.value = 'ADMIN'; search.dispatchEvent(new dom.window.Event('input'));
  pageSel.value = '60'; pageSel.dispatchEvent(new dom.window.Event('change'));

  // Clear root and render Dispatches
  while (root.firstChild) root.removeChild(root.firstChild);
  await sandbox.window.renderDispatches(root);
  grid = dom.window.document.querySelector('.ag-theme-alpine');
  ok(!!grid, 'Dispatches AG Grid container exists');
  ok(grid.children.length > 0, 'Dispatches grid rendered content');
  search = dom.window.document.querySelector('input[placeholder="Search..."]');
  ok(!!search, 'Dispatches toolbar search exists');
  pageSel = dom.window.document.querySelector('select[data-pagesize]');
  ok(!!pageSel, 'Dispatches toolbar page size exists');
  search.value = 'AG'; search.dispatchEvent(new dom.window.Event('input'));
  pageSel.value = '240'; pageSel.dispatchEvent(new dom.window.Event('change'));

  console.log('UI AG Grid smoke tests passed');
})();
