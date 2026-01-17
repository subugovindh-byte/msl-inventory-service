/* Additional UI views smoke tests for Slabs, Events, Dispatches */
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

async function setupData() {
  const mats = await request(app).get('/api/materials');
  const materialId = mats.body[0] ? mats.body[0].id : null;
  const cq = await request(app).post('/qbids').send({ supplier: 'UIView', quarry: 'Q', weight_kg: 1, size_mm: '1x1x1', grade: 'A', received_date: '2026-01-04', material_id: materialId, splitable_blk_count: 2 });
  const qbid = cq.body.qbid;
  const blkId = `${qbid}-BLOCK-TEST-010`;
  await request(app).post('/blocks').send({ block_id: blkId, parent_qbid: qbid });
  // Create slab
  await request(app).post('/slabs').send({ block_id: blkId, thickness_mm: 20, machine_id: 'M1', slabs_yield: 5 });
  // Log event
  await request(app).post('/events').send({ ref_type: 'blocks', ref_id: blkId, event_type: 'test', payload: { ok: true } });
  // Create dispatch
  const slabList = await request(app).get('/api/slabs');
  const slid = slabList.body[0] && slabList.body[0].slid;
  await request(app).post('/dispatch').send({ slid, customer: 'ACME', bundle_no: 'B1', container_no: 'C1' });
  return { qbid, blkId };
}

function loadView(filePath, exportName, sandbox) {
  let code = fs.readFileSync(filePath, 'utf8');
  code = code.replace(/import[^\n]+\n/g, '').replace(new RegExp(`export\\s+async\\s+function\\s+${exportName}\\s*\\(`), `window.${exportName} = async function(`);
  vm.runInNewContext(code, sandbox, { filename: filePath });
}

(async () => {
  await setupData();
  const dom = new JSDOM(`<!doctype html><html><body><div id="content"></div></body></html>`);
  const sandbox = { window: dom.window, document: dom.window.document, fetch: superFetch(app), console, setTimeout, clearTimeout };
  // Load utils and views
  const uiBase = path.join(__dirname, '../ui');
  let utils = fs.readFileSync(path.join(uiBase, 'utils.js'), 'utf8').replace(/export\s+/g, '');
  vm.runInNewContext(utils, sandbox, { filename: path.join(uiBase, 'utils.js') });
  loadView(path.join(uiBase, 'views/slabs.js'), 'renderSlabs', sandbox);
  loadView(path.join(uiBase, 'views/events.js'), 'renderEvents', sandbox);
  loadView(path.join(uiBase, 'views/dispatches.js'), 'renderDispatches', sandbox);

  // Slabs view
  await sandbox.window.renderSlabs(dom.window.document.getElementById('content'));
  let ths = Array.from(dom.window.document.querySelectorAll('thead th')).map(th => th.textContent);
  ok(ths.includes('SLID') && ths.includes('Block ID'), 'Slabs table has key columns');
  let rows = Array.from(dom.window.document.querySelectorAll('tbody tr'));
  ok(rows.length >= 1, 'Slabs table rendered rows');

  // Events view
  while (dom.window.document.getElementById('content').firstChild) dom.window.document.getElementById('content').removeChild(dom.window.document.getElementById('content').firstChild);
  await sandbox.window.renderEvents(dom.window.document.getElementById('content'));
  ths = Array.from(dom.window.document.querySelectorAll('thead th')).map(th => th.textContent);
  ok(ths.includes('ID') && ths.includes('Event Type'), 'Events table has key columns');
  rows = Array.from(dom.window.document.querySelectorAll('tbody tr'));
  ok(rows.length >= 1, 'Events table rendered rows');

  // Dispatches view
  while (dom.window.document.getElementById('content').firstChild) dom.window.document.getElementById('content').removeChild(dom.window.document.getElementById('content').firstChild);
  await sandbox.window.renderDispatches(dom.window.document.getElementById('content'));
  ths = Array.from(dom.window.document.querySelectorAll('thead th')).map(th => th.textContent);
  ok(ths.includes('SLID') && ths.includes('Customer'), 'Dispatches table has key columns');
  rows = Array.from(dom.window.document.querySelectorAll('tbody tr'));
  ok(rows.length >= 1, 'Dispatches table rendered rows');

  console.log('UI views smoke tests passed');
})();
