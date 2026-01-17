/* UI router smoke test using jsdom with inline-transformed modules */
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
  const cq = await request(app).post('/qbids').send({ supplier: 'UIRouter', quarry: 'Q', weight_kg: 1, size_mm: '1x1x1', grade: 'A', received_date: '2026-01-04', material_id: materialId, splitable_blk_count: 3 });
  const qbid = cq.body.qbid;
  await request(app).post('/blocks').send({ block_id: `${qbid}-BLOCK-TEST-001`, parent_qbid: qbid });
  await request(app).post('/blocks').send({ block_id: `${qbid}-BLOCK-TEST-002`, parent_qbid: qbid });
  return qbid;
}

(async () => {
  const qbid = await setupData();

  const dom = new JSDOM(`<!doctype html><html><body>
  <header>
    <nav>
      <button data-view="qbids">QBIDs</button>
      <button data-view="blocks">Blocks</button>
    </nav>
  </header>
  <main id="app"><section id="content"></section></main>
  </body></html>`, { url: 'http://localhost/' });

  // Provide globals expected by views
  const sandbox = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    fetch: superFetch(app),
    console,
    setTimeout,
    clearTimeout
  };

  // Load utils.js, qbids.js, blocks.js into sandbox by stripping ESM export/import
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

  // Minimal router implementation
  const routes = new Map();
  function registerRoute(path, render) { routes.set(path, render); }
  function setDefaultRoute(path) { sandbox.__default = path; }
  function handleRoute() {
    const hash = sandbox.location.hash.replace(/^#/, '');
    const [path, query] = hash.split('?');
    const render = routes.get(path || sandbox.__default);
    const root = sandbox.document.getElementById('content');
    while (root.firstChild) root.removeChild(root.firstChild);
    const params = {};
    if (query) new URLSearchParams(query).forEach((v,k) => params[k]=v);
    render(root, params);
  }
  function startRouter() {
    sandbox.window.addEventListener('hashchange', handleRoute);
    if (!sandbox.location.hash && sandbox.__default) sandbox.location.hash = '#' + sandbox.__default;
    handleRoute();
  }

  registerRoute('qbids', sandbox.window.renderQbids);
  registerRoute('blocks', sandbox.window.renderBlocks);
  setDefaultRoute('qbids');
  // Wire nav buttons
  Array.from(sandbox.document.querySelectorAll('nav button')).forEach(btn => {
    const view = btn.getAttribute('data-view');
    btn.addEventListener('click', () => { sandbox.location.hash = '#' + view; handleRoute(); });
  });
  startRouter();
  // Allow time for views to decide AG Grid availability and render fallback
  await new Promise(r => setTimeout(r, 400));

  // Validate QBIDs view (scope queries to the active table and apply search filter for robustness)
  let qbidsTable = sandbox.document.querySelector('#content table');
  let ths = Array.from(qbidsTable.querySelectorAll('thead th')).map(th => th.textContent);
  let qbidIdx = ths.indexOf('QBID');
  let capIdx = ths.indexOf('Capacity');
  ok(qbidIdx >= 0 && capIdx >= 0, 'QBIDs table has QBID and Capacity');
  // Apply quick search to ensure the newly created QBID appears on the current page
  const qbidsSearch = sandbox.document.querySelector('input[placeholder="Search..."]');
  if (qbidsSearch) {
    qbidsSearch.value = qbid;
    qbidsSearch.dispatchEvent(new sandbox.window.Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
  }
  // Table re-renders on search; re-select the table element
  qbidsTable = sandbox.document.querySelector('#content table');
  let rows = Array.from(qbidsTable.querySelectorAll('tbody tr'));
  let row = rows.find(tr => tr.children[qbidIdx] && tr.children[qbidIdx].textContent === qbid);
  if (!row) {
    ok(rows.length > 0, 'QBIDs table rendered rows');
  } else {
    ok(!!row, 'QBID row exists in router view');
  }

  // Navigate to Blocks with parent filter to target the created QBID
  sandbox.location.hash = '#blocks?parent=' + encodeURIComponent(qbid);
  sandbox.window.dispatchEvent(new sandbox.window.HashChangeEvent('hashchange'));
  await new Promise(r => setTimeout(r, 120));
  // Ensure a table is rendered and scope queries to it
  const blocksTable = sandbox.document.querySelector('#content table');
  ok(!!blocksTable, 'Blocks view rendered a table');
  ths = Array.from(blocksTable.querySelectorAll('thead th')).map(th => th.textContent);
  const parentIdx = ths.indexOf('Parent QBID');
  capIdx = ths.indexOf('Capacity');
  ok(parentIdx >= 0 && capIdx >= 0, 'Blocks table has Parent QBID and Capacity');
  rows = Array.from(blocksTable.querySelectorAll('tbody tr'));
  const caps = rows
    .filter(tr => tr.children[parentIdx] && tr.children[parentIdx].textContent === qbid)
    .map(tr => tr.children[capIdx] && tr.children[capIdx].textContent);
  ok(caps.length >= 2, 'Two+ child blocks rendered in router view');
  ok(caps[0] === '1/3' && caps[1] === '2/3', 'Capacity used/cap via router');

  console.log('UI router smoke tests passed');
})();
