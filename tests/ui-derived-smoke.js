/* UI derived products AG Grid smoke test */
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
  // Seed minimum references
  const mats = await request(app).get('/api/materials');
  const materialId = mats.body[0] ? mats.body[0].id : null;
  const cq = await request(app).post('/qbids').send({ supplier: 'DerivedTest', quarry: 'Q', weight_kg: 1, size_mm: '1x1x1', grade: 'A', received_date: '2026-01-04', material_id: materialId, splitable_blk_count: 1 });
  const qbid = cq.body.qbid;
  await request(app).post('/blocks').send({ block_id: `${qbid}-BLOCK-D1`, parent_qbid: qbid });
  // Create separate slabs per derived family (a single SLID cannot be shared).
  const csTiles = await request(app).post('/slabs').send({ block_id: `${qbid}-BLOCK-D1`, thickness_mm: 20, machine_id: 'M1', slabs_yield: 2, stone_type: 'tiles' });
  const csCobbles = await request(app).post('/slabs').send({ block_id: `${qbid}-BLOCK-D1`, thickness_mm: 30, machine_id: 'M2', slabs_yield: 2, stone_type: 'cobbles' });
  const csMonuments = await request(app).post('/slabs').send({ block_id: `${qbid}-BLOCK-D1`, thickness_mm: 40, machine_id: 'M3', slabs_yield: 2, stone_type: 'monuments' });
  const csPavers = await request(app).post('/slabs').send({ block_id: `${qbid}-BLOCK-D1`, thickness_mm: 50, machine_id: 'M4', slabs_yield: 2, stone_type: 'pavers' });
  const tilesSlid = csTiles.body.slid;
  const cobblesSlid = csCobbles.body.slid;
  const monumentsSlid = csMonuments.body.slid;
  const paversSlid = csPavers.body.slid;
  // Create derived products via API using SLID
  await request(app).post('/tiles').send({ slid: tilesSlid, thickness_mm: 10, length_mm: 600, width_mm: 600, finish: 'polished', yield_count: 4 });
  await request(app).post('/cobbles').send({ slid: cobblesSlid, length_mm: 100, width_mm: 100, height_mm: 80, shape: 'square', finish: 'tumbled', pieces_count: 50 });
  await request(app).post('/monuments').send({ slid: monumentsSlid, length_mm: 1800, width_mm: 800, height_mm: 1000, style: 'classic', customer: 'ClientX', order_no: 'ORD-001' });
  await request(app).post('/pavers').send({ slid: paversSlid, thickness_mm: 60, length_mm: 200, width_mm: 100, height_mm: 60, finish: 'tumbled', pattern: 'rect', pieces_count: 20 });

  const dom = new JSDOM(`<!doctype html><html><body><div id="content"></div></body></html>`);
  const sandbox = { window: dom.window, document: dom.window.document, fetch: superFetch(app), console, setTimeout, clearTimeout };

  // Stub AG Grid
  sandbox.agGrid = {
    Grid: function(div, options) {
      options.api = {
        exportDataAsCsv: () => {},
        forEachNodeAfterFilterAndSort: (cb) => {
          (options.rowData || []).forEach((row, idx) => cb({ data: row, rowIndex: idx }));
        },
        setQuickFilter: () => {},
        paginationSetPageSize: () => {}
      };
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
  sandbox.window.agGrid = sandbox.agGrid;
  sandbox.XLSX = { utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: () => {} }, writeFile: () => {} };

  const uiBase = path.join(__dirname, '../ui');
  let utils = fs.readFileSync(path.join(uiBase, 'utils.js'), 'utf8').split('export ').join('');
  vm.runInNewContext(utils, sandbox, { filename: path.join(uiBase, 'utils.js') });
  function stripImports(src) { return src.split('\n').filter(line => !line.startsWith('import ')).join('\n'); }
  function loadView(file, exportName) { let src = fs.readFileSync(path.join(uiBase, 'views', file), 'utf8'); src = stripImports(src); src = src.split(`export async function ${exportName}(`).join(`window.${exportName} = async function(`); vm.runInNewContext(src, sandbox, { filename: path.join(uiBase, 'views', file) }); }

  loadView('tiles.js', 'renderTiles');
  loadView('cobbles.js', 'renderCobbles');
  loadView('monuments.js', 'renderMonuments');
  loadView('pavers.js', 'renderPavers');

  const root = dom.window.document.getElementById('content');

  await sandbox.window.renderTiles(root);
  let grid = dom.window.document.querySelector('.ag-theme-alpine');
  ok(!!grid, 'Tiles grid container exists');
  ok(grid.children.length > 0, 'Tiles grid rendered content');
  let rows = Array.from(dom.window.document.querySelectorAll('tbody tr'));
  ok(rows.length >= 1, 'Tiles grid rendered rows');
  let search = dom.window.document.querySelector('input[placeholder="Search..."]');
  ok(!!search, 'Tiles toolbar search exists');
  let pageSel = dom.window.document.querySelector('select[data-pagesize]');
  ok(!!pageSel, 'Tiles toolbar page size exists');

  while (root.firstChild) root.removeChild(root.firstChild);
  await sandbox.window.renderCobbles(root);
  grid = dom.window.document.querySelector('.ag-theme-alpine');
  ok(!!grid, 'Cobbles grid container exists');
  ok(grid.children.length > 0, 'Cobbles grid rendered content');
  rows = Array.from(dom.window.document.querySelectorAll('tbody tr'));
  ok(rows.length >= 1, 'Cobbles grid rendered rows');
  search = dom.window.document.querySelector('input[placeholder="Search..."]');
  ok(!!search, 'Cobbles toolbar search exists');
  pageSel = dom.window.document.querySelector('select[data-pagesize]');
  ok(!!pageSel, 'Cobbles toolbar page size exists');

  while (root.firstChild) root.removeChild(root.firstChild);
  await sandbox.window.renderMonuments(root);
  grid = dom.window.document.querySelector('.ag-theme-alpine');
  ok(!!grid, 'Monuments grid container exists');
  ok(grid.children.length > 0, 'Monuments grid rendered content');
  rows = Array.from(dom.window.document.querySelectorAll('tbody tr'));
  ok(rows.length >= 1, 'Monuments grid rendered rows');
  search = dom.window.document.querySelector('input[placeholder="Search..."]');
  ok(!!search, 'Monuments toolbar search exists');
  pageSel = dom.window.document.querySelector('select[data-pagesize]');
  ok(!!pageSel, 'Monuments toolbar page size exists');

  while (root.firstChild) root.removeChild(root.firstChild);
  await sandbox.window.renderPavers(root);
  grid = dom.window.document.querySelector('.ag-theme-alpine');
  ok(!!grid, 'Pavers grid container exists');
  ok(grid.children.length > 0, 'Pavers grid rendered content');
  rows = Array.from(dom.window.document.querySelectorAll('tbody tr'));
  ok(rows.length >= 1, 'Pavers grid rendered rows');
  search = dom.window.document.querySelector('input[placeholder="Search..."]');
  ok(!!search, 'Pavers toolbar search exists');
  pageSel = dom.window.document.querySelector('select[data-pagesize]');
  ok(!!pageSel, 'Pavers toolbar page size exists');

  console.log('UI derived products AG Grid smoke tests passed');
})();
