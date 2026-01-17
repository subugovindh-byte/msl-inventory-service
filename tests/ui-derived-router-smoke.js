/* UI router smoke test for derived views (Tiles, Cobbles, Monuments) */
const { JSDOM } = require('jsdom');
const request = require('supertest');
const path = require('path');
const fs = require('fs');
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

async function setupData() {
  const mats = await request(app).get('/api/materials');
  const materialId = mats.body[0] ? mats.body[0].id : null;
  const cq = await request(app).post('/qbids').send({ supplier: 'DerivedRouter', quarry: 'Q', weight_kg: 1, size_mm: '1x1x1', grade: 'A', received_date: '2026-01-04', material_id: materialId, splitable_blk_count: 2 });
  const qbid = cq.body.qbid;
  const blkId = `${qbid}-BLOCK-R01`;
  await request(app).post('/blocks').send({ block_id: blkId, parent_qbid: qbid });
  // Create separate slabs for each derived family (a single SLID cannot be shared).
  const csTiles = await request(app).post('/slabs').send({ block_id: blkId, thickness_mm: 20, machine_id: 'M1', slabs_yield: 3, batch_id: 'B0', stone_type: 'tiles' });
  const csCobbles = await request(app).post('/slabs').send({ block_id: blkId, thickness_mm: 30, machine_id: 'M2', slabs_yield: 3, batch_id: 'B0', stone_type: 'cobbles' });
  const csMonuments = await request(app).post('/slabs').send({ block_id: blkId, thickness_mm: 40, machine_id: 'M3', slabs_yield: 3, batch_id: 'B0', stone_type: 'monuments' });
  const csPavers = await request(app).post('/slabs').send({ block_id: blkId, thickness_mm: 50, machine_id: 'M4', slabs_yield: 3, batch_id: 'B0', stone_type: 'pavers' });
  const tilesSlid = csTiles.body.slid;
  const cobblesSlid = csCobbles.body.slid;
  const monumentsSlid = csMonuments.body.slid;
  const paversSlid = csPavers.body.slid;
  await request(app).post('/tiles').send({ slid: tilesSlid, thickness_mm: 10, length_mm: 600, width_mm: 600, finish: 'polished', yield_count: 4, batch_id: 'B1' });
  await request(app).post('/cobbles').send({ slid: cobblesSlid, length_mm: 100, width_mm: 100, height_mm: 80, shape: 'square', finish: 'tumbled', pieces_count: 50, batch_id: 'B2' });
  await request(app).post('/monuments').send({ slid: monumentsSlid, length_mm: 1800, width_mm: 800, height_mm: 1000, style: 'classic', customer: 'ClientX', order_no: 'ORD-R001', batch_id: 'B3' });
  await request(app).post('/pavers').send({ slid: paversSlid, thickness_mm: 60, length_mm: 200, width_mm: 100, height_mm: 60, finish: 'tumbled', pattern: 'rect', pieces_count: 20, batch_id: 'B4' });
  return { qbid, blkId, tilesSlid, cobblesSlid, monumentsSlid, paversSlid };
}

(function(){
  (async () => {
    await setupData();

    const dom = new JSDOM(`<!doctype html><html><body>
    <header>
      <nav>
        <button data-view="tiles">Tiles</button>
        <button data-view="cobbles">Cobbles</button>
        <button data-view="monuments">Monuments</button>
        <button data-view="pavers">Pavers</button>
      </nav>
    </header>
    <main id="app"><section id="content"></section></main>
    </body></html>`, { url: 'http://localhost/' });

    const sandbox = {
      window: dom.window,
      document: dom.window.document,
      location: dom.window.location,
      fetch: superFetch(app),
      console,
      setTimeout,
      clearTimeout,
      XLSX: { utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: () => {} }, writeFile: () => {} }
    };

    // Stub AG Grid UMD with minimal API used by views
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
      },
      createGrid: undefined // to exercise new Grid() path if needed
    };
    sandbox.window.agGrid = sandbox.agGrid;

    // Load utils and views in sandbox by stripping ESM
    const uiBase = path.join(__dirname, '../ui');
    function runTransformed(filePath, transform) {
      let code = fs.readFileSync(filePath, 'utf8');
      if (transform) code = transform(code);
      vm.runInNewContext(code, sandbox, { filename: filePath });
    }
    runTransformed(path.join(uiBase, 'utils.js'), (code) => code.replace(/export\s+/g, ''));
    runTransformed(path.join(uiBase, 'views/tiles.js'), (code) => code.replace(/import[^\n]+\n/g, '').replace(/export\s+async\s+function\s+renderTiles\s*\(/, 'window.renderTiles = async function('));
    runTransformed(path.join(uiBase, 'views/cobbles.js'), (code) => code.replace(/import[^\n]+\n/g, '').replace(/export\s+async\s+function\s+renderCobbles\s*\(/, 'window.renderCobbles = async function('));
    runTransformed(path.join(uiBase, 'views/monuments.js'), (code) => code.replace(/import[^\n]+\n/g, '').replace(/export\s+async\s+function\s+renderMonuments\s*\(/, 'window.renderMonuments = async function('));
    runTransformed(path.join(uiBase, 'views/pavers.js'), (code) => code.replace(/import[^\n]+\n/g, '').replace(/export\s+async\s+function\s+renderPavers\s*\(/, 'window.renderPavers = async function('));

    // Minimal router
    const routes = new Map();
    function registerRoute(path, render) { routes.set(path, render); }
    function setDefaultRoute(path) { sandbox.__default = path; }
    async function handleRoute() {
      const hash = sandbox.location.hash.replace(/^#/, '');
      const [path, query] = hash.split('?');
      const render = routes.get(path || sandbox.__default);
      const root = sandbox.document.getElementById('content');
      while (root.firstChild) root.removeChild(root.firstChild);
      const params = {};
      if (query) new URLSearchParams(query).forEach((v,k) => params[k]=v);
      await render(root, params);
    }
    function startRouter() {
      sandbox.window.addEventListener('hashchange', handleRoute);
      if (!sandbox.location.hash && sandbox.__default) sandbox.location.hash = '#' + sandbox.__default;
      handleRoute().catch(() => {});
    }

    registerRoute('tiles', sandbox.window.renderTiles);
    registerRoute('cobbles', sandbox.window.renderCobbles);
    registerRoute('monuments', sandbox.window.renderMonuments);
    registerRoute('pavers', sandbox.window.renderPavers);
    setDefaultRoute('tiles');

    // Wire nav buttons
    Array.from(sandbox.document.querySelectorAll('nav button')).forEach(btn => {
      const view = btn.getAttribute('data-view');
      btn.addEventListener('click', () => { sandbox.location.hash = '#' + view; handleRoute().catch(() => {}); });
    });
    startRouter();
    await new Promise(r => setTimeout(r, 30));

    // Tiles view
    let ths = Array.from(sandbox.document.querySelectorAll('thead th')).map(th => th.textContent);
    ok(ths.includes('Tile ID') && ths.includes('SLID'), 'Tiles router view has key columns');
    let rows = Array.from(sandbox.document.querySelectorAll('tbody tr'));
    ok(rows.length >= 1, 'Tiles router view rendered rows');

    // Navigate to Cobble
    sandbox.document.querySelector('nav button[data-view="cobbles"]').click();
    await new Promise(r => setTimeout(r, 50));
    ths = Array.from(sandbox.document.querySelectorAll('thead th')).map(th => th.textContent);
    ok(ths.includes('Cobble ID') && ths.includes('SLID'), 'Cobbles router view has key columns');
    rows = Array.from(sandbox.document.querySelectorAll('tbody tr'));
    ok(rows.length >= 1, 'Cobbles router view rendered rows');

    // Navigate to Monuments
    sandbox.document.querySelector('nav button[data-view="monuments"]').click();
    await new Promise(r => setTimeout(r, 50));
    ths = Array.from(sandbox.document.querySelectorAll('thead th')).map(th => th.textContent);
    ok(ths.includes('Monument ID') && ths.includes('Style'), 'Monuments router view has key columns');
    rows = Array.from(sandbox.document.querySelectorAll('tbody tr'));
    ok(rows.length >= 1, 'Monuments router view rendered rows');

    // Navigate to Pavers
    sandbox.document.querySelector('nav button[data-view="pavers"]').click();
    await new Promise(r => setTimeout(r, 50));
    ths = Array.from(sandbox.document.querySelectorAll('thead th')).map(th => th.textContent);
    ok(ths.includes('Paver ID') && ths.includes('SLID'), 'Pavers router view has key columns');
    rows = Array.from(sandbox.document.querySelectorAll('tbody tr'));
    ok(rows.length >= 1, 'Pavers router view rendered rows');

    console.log('UI derived router smoke tests passed');
  })();
})();
