/* UI smoke test using jsdom with inline-transformed modular views */
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
  const cq = await request(app).post('/qbids').send({ supplier: 'UISmoke', quarry: 'Q', weight_kg: 1, size_mm: '1x1x1', grade: 'A', received_date: '2026-01-04', material_id: materialId, splitable_blk_count: 3 });
  const qbid = cq.body.qbid;
  await request(app).post('/blocks').send({ block_id: `${qbid}-BLOCK-TEST-001`, parent_qbid: qbid });
  await request(app).post('/blocks').send({ block_id: `${qbid}-BLOCK-TEST-002`, parent_qbid: qbid });
  return qbid;
}

function loadViews(sandbox) {
  function runTransformed(filePath, transform) {
    let code = fs.readFileSync(filePath, 'utf8');
    if (transform) code = transform(code);
    vm.runInNewContext(code, sandbox, { filename: filePath });
  }
  const uiBase = path.join(__dirname, '../ui');
  runTransformed(path.join(uiBase, 'utils.js'), (code) => code.replace(/export\s+/g, ''));
  runTransformed(path.join(uiBase, 'views/qbids.js'), (code) => code
    .replace(/import[^\n]+\n/g, '')
    .replace(/export\s+async\s+function\s+renderQbids\s*\(/, 'window.renderQbids = async function(')
  );
  runTransformed(path.join(uiBase, 'views/blocks.js'), (code) => code
    .replace(/import[^\n]+\n/g, '')
    .replace(/export\s+async\s+function\s+renderBlocks\s*\(/, 'window.renderBlocks = async function(')
  );
}

async function testBlocksCapacity() {
  const qbid = await setupData();
  const dom = new JSDOM(`<!doctype html><html><body><div id="content"></div></body></html>`);
  const sandbox = { window: dom.window, document: dom.window.document, fetch: superFetch(app), console, setTimeout, clearTimeout };
  loadViews(sandbox);
  await sandbox.window.renderBlocks(dom.window.document.getElementById('content'), { parent: qbid });
  const doc = dom.window.document;
  const psSelB = doc.querySelector('select[data-pagesize="true"]');
  if (psSelB) { psSelB.value = '240'; psSelB.dispatchEvent(new dom.window.Event('change')); }
  const ths = Array.from(doc.querySelectorAll('thead th')).map(th => th.textContent);
  const parentIdx = ths.indexOf('Parent QBID');
  const capIdx = ths.indexOf('Capacity');
  ok(parentIdx >= 0 && capIdx >= 0, 'Blocks table has Parent QBID and Capacity columns');
  const rows = Array.from(doc.querySelectorAll('tbody tr'));
  ok(rows.length === 2, 'Two child blocks rendered');
  const caps = rows.map(tr => tr.children[capIdx].textContent);
  ok(caps[0] === '1/3' && caps[1] === '2/3', 'Capacity shows used/cap per sibling');
}

async function testQbidsCapacity() {
  const qbid = await setupData();
  const dom = new JSDOM(`<!doctype html><html><body><div id="content"></div></body></html>`);
  const sandbox = { window: dom.window, document: dom.window.document, fetch: superFetch(app), console, setTimeout, clearTimeout };
  loadViews(sandbox);
  await sandbox.window.renderQbids(dom.window.document.getElementById('content'));
  const doc = dom.window.document;
  const psSelQ = doc.querySelector('select[data-pagesize="true"]');
  if (psSelQ) { psSelQ.value = '240'; psSelQ.dispatchEvent(new dom.window.Event('change')); }
  const ths = Array.from(doc.querySelectorAll('thead th')).map(th => th.textContent);
  const qbidIdx = ths.indexOf('QBID');
  const capIdx = ths.indexOf('Capacity');
  ok(qbidIdx >= 0 && capIdx >= 0, 'QBIDs table has QBID and Capacity columns');
  const rows = Array.from(doc.querySelectorAll('tbody tr'));
  ok(rows.length > 0, 'QBIDs table renders rows');
  if (rows.length > 0) {
    // Verify capacity column is rendered (check any row for capacity format)
    const firstCap = rows[0].children[capIdx]?.textContent;
    ok(firstCap && /\d+\/\d+/.test(firstCap), 'QBIDs capacity shows format used/cap');
  }
}

(async () => {
  try { await testBlocksCapacity(); await testQbidsCapacity(); }
  catch (e) { console.error('UI smoke test error:', e); process.exitCode = 1; }
  if (!process.exitCode || process.exitCode === 0) console.log('UI smoke tests passed');
  else console.error('UI smoke tests failed');
})();
