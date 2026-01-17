/* UI exports smoke test (Fallback path without AG Grid) */
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
  // Seed data to ensure grids have content
  const mats = await request(app).get('/api/materials');
  const materialId = mats.body[0] ? mats.body[0].id : null;
  const cq = await request(app).post('/qbids').send({ supplier: 'ExportFB', quarry: 'Q', weight_kg: 1, size_mm: '1x1x1', grade: 'A', received_date: '2026-01-04', material_id: materialId, splitable_blk_count: 2 });
  const qbid = cq.body.qbid;
  await request(app).post('/blocks').send({ block_id: `${qbid}-BLOCK-F1`, parent_qbid: qbid });
  // Create separate slabs per derived family (a single SLID cannot be shared).
  const csTiles = await request(app).post('/slabs').send({ block_id: `${qbid}-BLOCK-F1`, thickness_mm: 20, machine_id: 'M1', slabs_yield: 2, stone_type: 'tiles' });
  const csCobbles = await request(app).post('/slabs').send({ block_id: `${qbid}-BLOCK-F1`, thickness_mm: 30, machine_id: 'M2', slabs_yield: 2, stone_type: 'cobbles' });
  const csMonuments = await request(app).post('/slabs').send({ block_id: `${qbid}-BLOCK-F1`, thickness_mm: 40, machine_id: 'M3', slabs_yield: 2, stone_type: 'monuments' });
  const csPavers = await request(app).post('/slabs').send({ block_id: `${qbid}-BLOCK-F1`, thickness_mm: 50, machine_id: 'M4', slabs_yield: 2, stone_type: 'pavers' });
  const slidTiles = csTiles.body.slid;
  const slidCobbles = csCobbles.body.slid;
  const slidMonuments = csMonuments.body.slid;
  const slidPavers = csPavers.body.slid;
  await request(app).post('/tiles').send({ slid: slidTiles, thickness_mm: 10, length_mm: 300, width_mm: 300, finish: 'polished', yield_count: 2 });
  await request(app).post('/cobbles').send({ slid: slidCobbles, length_mm: 100, width_mm: 100, height_mm: 80, shape: 'square', finish: 'tumbled', pieces_count: 20 });
  await request(app).post('/monuments').send({ slid: slidMonuments, length_mm: 500, width_mm: 200, height_mm: 300, style: 'classic', customer: 'ClientX', order_no: 'ORD-FB1' });
  await request(app).post('/pavers').send({ slid: slidPavers, thickness_mm: 60, length_mm: 200, width_mm: 100, height_mm: 60, finish: 'tumbled', pattern: 'rect', pieces_count: 20 });

  const dom = new JSDOM(`<!doctype html><html><body><div id="content"></div></body></html>`);
  const sandbox = { window: dom.window, document: dom.window.document, fetch: superFetch(app), console, setTimeout, clearTimeout };
  sandbox.__csvCalls = 0; sandbox.__xlsxCalls = 0;

  // Force fallback: no agGrid, waitForAgGrid returns false
  sandbox.window.agGrid = undefined;
  sandbox.waitForAgGrid = async () => false;
  sandbox.window.waitForAgGrid = sandbox.waitForAgGrid;

  // Stub URL and XLSX
  // Provide Blob for JSDOM environment
  sandbox.window.Blob = function() { return {}; };
  sandbox.Blob = sandbox.window.Blob;
  sandbox.window.URL = { createObjectURL: () => { sandbox.__csvCalls++; return 'blob://x'; }, revokeObjectURL: () => {} };
  sandbox.URL = sandbox.window.URL;
  sandbox.XLSX = { utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: () => {} }, writeFile: () => { sandbox.__xlsxCalls++; } };
  sandbox.window.XLSX = sandbox.XLSX;
  // Silence jsdom navigation warnings triggered by anchor downloads
  if (sandbox.window.HTMLAnchorElement && sandbox.window.HTMLAnchorElement.prototype) {
    sandbox.window.HTMLAnchorElement.prototype.click = function noop() {};
  }
  if (sandbox.window.location) {
    sandbox.window.location.assign = function noop() {};
  }

  const uiBase = path.join(__dirname, '../ui');
  function stripImports(src) { return src.split('\n').filter(line => !line.startsWith('import ')).join('\n'); }
  function loadView(file, exportName) {
    let src = fs.readFileSync(path.join(uiBase, file), 'utf8');
    src = stripImports(src);
    src = src.split(`export async function ${exportName}(`).join(`window.${exportName} = async function(`);
    vm.runInNewContext(src, sandbox, { filename: path.join(uiBase, file) });
  }

  // Load utils and derived views only
  let utils = fs.readFileSync(path.join(uiBase, 'utils.js'), 'utf8').replace(/export\s+/g, '');
  vm.runInNewContext(utils, sandbox, { filename: path.join(uiBase, 'utils.js') });
  loadView('views/tiles.js', 'renderTiles');
  loadView('views/cobbles.js', 'renderCobbles');
  loadView('views/monuments.js', 'renderMonuments');
  loadView('views/pavers.js', 'renderPavers');

  const root = dom.window.document.getElementById('content');
  async function renderAndExport(fn) {
    while (root.firstChild) root.removeChild(root.firstChild);
    await fn(root);
    const btnCsv = Array.from(dom.window.document.querySelectorAll('.grid-toolbar button')).find(b => b.textContent.includes('Export CSV'));
    const btnXls = Array.from(dom.window.document.querySelectorAll('.grid-toolbar button')).find(b => b.textContent.includes('Export Excel'));
    ok(!!btnCsv && !!btnXls, 'Fallback export buttons present');
    btnCsv.click(); btnXls.click();
  }

  await renderAndExport(sandbox.window.renderTiles);
  await renderAndExport(sandbox.window.renderCobbles);
  await renderAndExport(sandbox.window.renderMonuments);
  await renderAndExport(sandbox.window.renderPavers);

  ok(sandbox.__csvCalls >= 4, 'Fallback CSV export invoked for derived views');
  ok(sandbox.__xlsxCalls >= 4, 'Fallback XLSX export invoked for derived views');

  console.log('UI exports fallback smoke tests passed');
})();
