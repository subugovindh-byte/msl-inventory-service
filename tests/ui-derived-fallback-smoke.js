/* UI derived products fallback smoke test (no AG Grid) */
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
  const cq = await request(app).post('/qbids').send({ supplier: 'DerivedFallback', quarry: 'Q', weight_kg: 1, size_mm: '1x1x1', grade: 'A', received_date: '2026-01-04', material_id: materialId, splitable_blk_count: 1 });
  const qbid = cq.body.qbid;
  await request(app).post('/blocks').send({ block_id: `${qbid}-BLOCK-F1`, parent_qbid: qbid });
  // Create separate slabs per derived family (a single SLID cannot be shared).
  const csTiles = await request(app).post('/slabs').send({ block_id: `${qbid}-BLOCK-F1`, thickness_mm: 20, machine_id: 'M1', slabs_yield: 2, stone_type: 'tiles' });
  const csPavers = await request(app).post('/slabs').send({ block_id: `${qbid}-BLOCK-F1`, thickness_mm: 30, machine_id: 'M2', slabs_yield: 2, stone_type: 'pavers' });
  const tilesSlid = csTiles.body.slid;
  const paversSlid = csPavers.body.slid;
  // Create derived products via API
  await request(app).post('/tiles').send({ slid: tilesSlid, thickness_mm: 10, length_mm: 600, width_mm: 600, finish: 'polished', yield_count: 4 });
  await request(app).post('/cobbles').send({ block_id: `${qbid}-BLOCK-F1`, length_mm: 100, width_mm: 100, height_mm: 80, shape: 'square', finish: 'tumbled', pieces_count: 50 });
  await request(app).post('/monuments').send({ block_id: `${qbid}-BLOCK-F1`, length_mm: 1800, width_mm: 800, height_mm: 1000, style: 'classic', customer: 'ClientX', order_no: 'ORD-F001' });
  await request(app).post('/pavers').send({ slid: paversSlid, thickness_mm: 60, length_mm: 200, width_mm: 100, height_mm: 60, finish: 'tumbled', pattern: 'rect', pieces_count: 20 });

  const dom = new JSDOM(`<!doctype html><html><body><div id="content"></div></body></html>`);
  const sandbox = { window: dom.window, document: dom.window.document, fetch: superFetch(app), console, setTimeout, clearTimeout };

  const uiBase = path.join(__dirname, '../ui');
  // Load utils and force AG Grid unavailability
  let utils = fs.readFileSync(path.join(uiBase, 'utils.js'), 'utf8').replace(/export\s+/g, '');
  vm.runInNewContext(utils, sandbox, { filename: path.join(uiBase, 'utils.js') });
  // Stub waitForAgGrid to force fallback path
  sandbox.waitForAgGrid = async () => false;
  sandbox.window.waitForAgGrid = sandbox.waitForAgGrid;

  function stripImports(src) { return src.split('\n').filter(line => !line.startsWith('import ')).join('\n'); }
  function loadView(file, exportName) {
    let src = fs.readFileSync(path.join(uiBase, 'views', file), 'utf8');
    src = stripImports(src);
    src = src.split(`export async function ${exportName}(`).join(`window.${exportName} = async function(`);
    vm.runInNewContext(src, sandbox, { filename: path.join(uiBase, 'views', file) });
  }

  loadView('tiles.js', 'renderTiles');
  loadView('cobbles.js', 'renderCobbles');
  loadView('monuments.js', 'renderMonuments');
  loadView('pavers.js', 'renderPavers');

  const root = dom.window.document.getElementById('content');

  // Tiles fallback
  await sandbox.window.renderTiles(root);
  let toolbar = dom.window.document.querySelector('.grid-toolbar');
  ok(!!toolbar, 'Tiles fallback toolbar exists');
  let table = dom.window.document.querySelector('table');
  ok(!!table, 'Tiles fallback table exists');
  let ths = Array.from(dom.window.document.querySelectorAll('thead th')).map(th => th.textContent);
  ok(ths.includes('Tile ID') && !ths.includes('Stone Type'), 'Tiles fallback has key columns and does not include Stone Type');
  // Open create form and ensure stone_type select exists
  const btnCreateTile = Array.from(dom.window.document.querySelectorAll('button')).find(b => b.textContent.includes('Create Tile'));
  ok(!!btnCreateTile, 'Tiles create button exists');
  btnCreateTile.click();
  let stoneSelect = dom.window.document.querySelector('select#stone_type');
  ok(!stoneSelect, 'Tiles form does not have stone_type select');

  // Cobbles fallback
  while (root.firstChild) root.removeChild(root.firstChild);
  await sandbox.window.renderCobbles(root);
  toolbar = dom.window.document.querySelector('.grid-toolbar');
  ok(!!toolbar, 'Cobbles fallback toolbar exists');
  table = dom.window.document.querySelector('table');
  ok(!!table, 'Cobbles fallback table exists');
  ths = Array.from(dom.window.document.querySelectorAll('thead th')).map(th => th.textContent);
  ok(ths.includes('Cobble ID') && !ths.includes('Stone Type'), 'Cobbles fallback has key columns and does not include Stone Type');
  const btnCreateCobble = Array.from(dom.window.document.querySelectorAll('button')).find(b => b.textContent.includes('Create Cobble'));
  ok(!!btnCreateCobble, 'Cobbles create button exists');
  btnCreateCobble.click();
  stoneSelect = dom.window.document.querySelector('select#stone_type');
  ok(!stoneSelect, 'Cobbles form does not have stone_type select');

  // Monuments fallback
  while (root.firstChild) root.removeChild(root.firstChild);
  await sandbox.window.renderMonuments(root);
  toolbar = dom.window.document.querySelector('.grid-toolbar');
  ok(!!toolbar, 'Monuments fallback toolbar exists');
  table = dom.window.document.querySelector('table');
  ok(!!table, 'Monuments fallback table exists');
  ths = Array.from(dom.window.document.querySelectorAll('thead th')).map(th => th.textContent);
  ok(ths.includes('Monument ID') && ths.includes('Style'), 'Monuments fallback has key columns');

  // Pavers fallback
  while (root.firstChild) root.removeChild(root.firstChild);
  await sandbox.window.renderPavers(root);
  toolbar = dom.window.document.querySelector('.grid-toolbar');
  ok(!!toolbar, 'Pavers fallback toolbar exists');
  table = dom.window.document.querySelector('table');
  ok(!!table, 'Pavers fallback table exists');
  ths = Array.from(dom.window.document.querySelectorAll('thead th')).map(th => th.textContent);
  ok(ths.includes('Paver ID') && ths.includes('SLID') && !ths.includes('Stone Type'), 'Pavers fallback has key columns and does not include Stone Type');
  const btnCreatePaver = Array.from(dom.window.document.querySelectorAll('button')).find(b => b.textContent.includes('Create Paver'));
  ok(!!btnCreatePaver, 'Pavers create button exists');
  btnCreatePaver.click();
  stoneSelect = dom.window.document.querySelector('select#stone_type');
  ok(!stoneSelect, 'Pavers form does not have stone_type select');

  console.log('UI derived products fallback smoke tests passed');
})();
