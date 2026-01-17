/* Browser-less suppliers UI smoke test: create → edit → delete */
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
  // ensure clean suppliers table for tests
  await request(app).delete('/suppliers/1'); // ignore errors

  const dom = new JSDOM(`<!doctype html><html><body><div id="content"></div></body></html>`);
  const sandbox = { window: dom.window, document: dom.window.document, fetch: superFetch(app), console, setTimeout, clearTimeout };
  sandbox.fetch = superFetch(app);
  sandbox.__createdId = null;
  // Provide DOM dialog stubs used by UI (confirm/alert)
  sandbox.window.confirm = () => true;
  sandbox.window.alert = (msg) => { console.log('alert:', msg); };
  sandbox.confirm = sandbox.window.confirm;
  sandbox.alert = sandbox.window.alert;

  // load utils and suppliers view into sandbox (strip ES module imports/exports)
  const uiBase = path.join(__dirname, '../ui');
  function stripImports(src) { return src.split('\n').filter(line => !line.startsWith('import ')).join('\n'); }
  let utils = fs.readFileSync(path.join(uiBase, 'utils.js'), 'utf8').replace(/export\s+/g, '');
  vm.runInNewContext(utils, sandbox, { filename: path.join(uiBase, 'utils.js') });
  let src = fs.readFileSync(path.join(uiBase, 'views/suppliers.js'), 'utf8');
  src = stripImports(src);
  src = src.split("export async function renderSuppliers").join("window.renderSuppliers = async function");
  vm.runInNewContext(src, sandbox, { filename: path.join(uiBase, 'views/suppliers.js') });

  const root = dom.window.document.getElementById('content');
  await sandbox.window.renderSuppliers(root);
  ok(!!dom.window.document.querySelector('.view-header h2') && dom.window.document.querySelector('.view-header h2').textContent.includes('Suppliers'), 'Suppliers view header present');

  // Click Create Supplier
  const createBtn = Array.from(dom.window.document.querySelectorAll('.grid-toolbar button')).find(b => b.textContent.includes('Create'));
  ok(!!createBtn, 'Create button present');
  createBtn.click();
  ok(!!dom.window.document.querySelector('form.edit-form'), 'Create form opened');

  // Fill and submit form
  const nameInput = dom.window.document.querySelector('input[name="name"]');
  nameInput.value = 'Test Supplier X';
  const save = dom.window.document.querySelector('button[type=submit]');
  save.click();
  // wait a tick
  await new Promise(r => setTimeout(r, 50));

  // Re-render list and assert supplier present
  await sandbox.window.renderSuppliers(root);
  const found = Array.from(dom.window.document.querySelectorAll('tbody tr td')).some(td => td.textContent.includes('Test Supplier X'));
  ok(found, 'Created supplier present in list');

  // Edit the supplier: find edit button for that row
  const row = Array.from(dom.window.document.querySelectorAll('tbody tr')).find(tr => Array.from(tr.children).some(td => td.textContent.includes('Test Supplier X')));
  ok(!!row, 'Found created supplier row');
  const editBtn = row.querySelector('button');
  ok(!!editBtn, 'Edit button exists');
  editBtn.click();
  await new Promise(r => setTimeout(r, 20));
  const noteInput = dom.window.document.querySelector('input[name="notes"]');
  noteInput.value = 'Edited note';
  const submit = dom.window.document.querySelector('button[type=submit]');
  submit.click();
  await new Promise(r => setTimeout(r, 50));

  // Re-render and check notes
  await sandbox.window.renderSuppliers(root);
  const row2 = Array.from(dom.window.document.querySelectorAll('tbody tr')).find(tr => Array.from(tr.children).some(td => td.textContent.includes('Test Supplier X')));
  const hasNotes = row2 && Array.from(row2.children).some(td => td.textContent.includes('Edited note'));
  ok(hasNotes, 'Edited supplier notes present');

  // Delete supplier
  const delBtn = row2.querySelectorAll('button')[1];
  ok(!!delBtn, 'Delete button exists');
  // stub confirm to true
  sandbox.window.confirm = () => true;
  delBtn.click();
  await new Promise(r => setTimeout(r, 50));

  // Re-render and ensure gone
  await sandbox.window.renderSuppliers(root);
  const still = Array.from(dom.window.document.querySelectorAll('tbody tr td')).some(td => td.textContent.includes('Test Supplier X'));
  ok(!still, 'Supplier deleted');

  console.log('Suppliers UI smoke passed');
})();
