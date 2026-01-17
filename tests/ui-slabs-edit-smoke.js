/* UI slabs edit flow smoke test using jsdom */
const { JSDOM } = require('jsdom');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const app = require('../index');

function ok(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else { console.log('PASS:', msg); } }

async function waitFor(predicate, { timeoutMs = 2000, intervalMs = 25 } = {}) {
  const started = Date.now();
  while (true) {
    try {
      if (predicate()) return true;
    } catch (_) {
      // ignore transient DOM errors while re-rendering
    }
    if (Date.now() - started > timeoutMs) return false;
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

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
  // Setup: Create parent QBID, block, slab
  const mats = await request(app).get('/api/materials');
  const materialId = mats.body[0] ? mats.body[0].id : null;
  const cq = await request(app).post('/qbids').send({ supplier: 'SlabEdit', quarry: 'Q', weight_kg: 1, size_mm: '1x1x1', grade: 'A', received_date: '2026-01-04', material_id: materialId, splitable_blk_count: 1 });
  const qbid = cq.body.qbid;
  await request(app).post('/blocks').send({ block_id: `${qbid}-BLOCK-EDIT-001`, parent_qbid: qbid });
  const cs = await request(app).post('/slabs').send({ block_id: `${qbid}-BLOCK-EDIT-001`, thickness_mm: 20, machine_id: 'M1', slabs_yield: 5 });
  const slid = cs.body.slid;

  const dom = new JSDOM(`<!doctype html><html><body><div id="content"></div></body></html>`);
  const sandbox = { window: dom.window, document: dom.window.document, fetch: superFetch(app), console, setTimeout, clearTimeout };
  // Load utils and slabs view
  const uiBase = path.join(__dirname, '../ui');
  let utils = fs.readFileSync(path.join(uiBase, 'utils.js'), 'utf8').replace(/export\s+/g, '');
  vm.runInNewContext(utils, sandbox, { filename: path.join(uiBase, 'utils.js') });
  let slabsCode = fs.readFileSync(path.join(uiBase, 'views/slabs.js'), 'utf8')
    .replace(/import[^\n]+\n/g, '')
    .replace(/export\s+async\s+function\s+renderSlabs\s*\(/, 'window.renderSlabs = async function(');
  vm.runInNewContext(slabsCode, sandbox, { filename: path.join(uiBase, 'views/slabs.js') });

  // Initial render
  await sandbox.window.renderSlabs(dom.window.document.getElementById('content'));
  const psSel = dom.window.document.querySelector('select[data-pagesize="true"]');
  if (psSel) { psSel.value = '240'; psSel.dispatchEvent(new dom.window.Event('change')); }

  // Filter to the SLID we just created (table may be paginated/sorted)
  const quickInput = dom.window.document.querySelector('.grid-toolbar input[type="text"]');
  if (quickInput) {
    quickInput.value = slid;
    quickInput.dispatchEvent(new dom.window.Event('input'));
    await new Promise(r => setTimeout(r, 10));
  }

  let rows = Array.from(dom.window.document.querySelectorAll('tbody tr'));
  ok(rows.length >= 1, 'Slabs table rendered');
  // Find the row for our SLID
  const ths = Array.from(dom.window.document.querySelectorAll('thead th')).map(th => th.textContent);
  const slidIdx = ths.indexOf('SLID');
  const yardIdx = ths.indexOf('Yard');
  ok(slidIdx >= 0 && yardIdx >= 0, 'Table has SLID and Yard columns');
  const targetRow = rows.find(tr => tr.children[slidIdx].textContent === slid);
  ok(!!targetRow, 'Target SLID row present');

  // Click Edit action for this row
  const actionCell = targetRow.lastElementChild; // actions td
  const editBtn = Array.from(actionCell.querySelectorAll('button')).find(b => b.textContent === 'Edit' || b.textContent === '✏️' || b.getAttribute('aria-label') === 'Edit SLID');
  ok(!!editBtn, 'Edit button found');
  editBtn.click();
  await new Promise(r => setTimeout(r, 10));

  // Fill form and submit
  const yardInput = dom.window.document.querySelector('#yard_location');
  ok(!!yardInput, 'Yard input present');
  yardInput.value = 'Yard Z';
  const statusSel = dom.window.document.querySelector('#status');
  const qcSel = dom.window.document.querySelector('#qc_status');
  if (statusSel) statusSel.value = 'finished';
  if (qcSel) qcSel.value = 'passed';
  const form = dom.window.document.querySelector('form.edit-form');
  ok(!!form, 'Edit form present');
  // Use a real-ish submit event; many handlers call preventDefault(), which only
  // works when the event is cancelable.
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

  // Save triggers async fetch + re-render; CI can be slower than local.
  const closed = await waitFor(() => !dom.window.document.querySelector('form.edit-form'), { timeoutMs: 3000 });

  // After submit, editor should close and table should reflect updates
  const formAfter = dom.window.document.querySelector('form.edit-form');
  ok(closed && !formAfter, 'Edit form closed after save');
  const psSelAfter = dom.window.document.querySelector('select[data-pagesize="true"]');
  if (psSelAfter) { psSelAfter.value = '240'; psSelAfter.dispatchEvent(new dom.window.Event('change')); }

  // Re-apply filter after re-render
  const quickAfter = dom.window.document.querySelector('.grid-toolbar input[type="text"]');
  if (quickAfter) {
    quickAfter.value = slid;
    quickAfter.dispatchEvent(new dom.window.Event('input'));
    await new Promise(r => setTimeout(r, 10));
  }

  rows = Array.from(dom.window.document.querySelectorAll('tbody tr'));
  const updatedRow = rows.find(tr => tr.children[slidIdx].textContent === slid);
  ok(!!updatedRow, 'Updated SLID row present after re-render');
  ok(updatedRow.children[yardIdx].textContent === 'Yard Z', 'Yard updated in table');

  console.log('UI slabs edit flow smoke test passed');
})();
