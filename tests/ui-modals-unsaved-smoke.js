/* Modal unsaved-changes smoke test (jsdom)
   Validates that closing a dirty modal prompts Save/Discard/Cancel.
*/
const { JSDOM } = require('jsdom');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const app = require('../index');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('PASS:', msg);
  }
}

function superFetch(app) {
  return async function (url, options = {}) {
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
    Object.entries(headers).forEach(([k, v]) => req.set(k, v));
    if (body) req.send(typeof body === 'string' ? body : body);
    const res = await req;
    const json = () => Promise.resolve(res.body);
    return { ok: res.status >= 200 && res.status < 300, status: res.status, statusText: '', json };
  };
}

function loadViews(sandbox) {
  function runTransformed(filePath, transform) {
    let code = fs.readFileSync(filePath, 'utf8');
    if (transform) code = transform(code);
    vm.runInNewContext(code, sandbox, { filename: filePath });
  }

  const uiBase = path.join(__dirname, '../ui');
  runTransformed(path.join(uiBase, 'utils.js'), (code) => code.replace(/export\s+/g, ''));
  runTransformed(path.join(uiBase, 'views/suppliers.js'), (code) => code
    .replace(/import[^\n]+\n/g, '')
    .replace(/export\s+async\s+function\s+renderSuppliers\s*\(/, 'window.renderSuppliers = async function(')
  );
}

function findUnsavedChangesOverlay(doc) {
  const overlays = Array.from(doc.querySelectorAll('.modal-overlay'));
  return overlays.find((o) => {
    const txt = (o.textContent || '').toLowerCase();
    return txt.includes('unsaved changes') && txt.includes('save') && txt.includes('discard');
  }) || null;
}

async function tick(ms = 0) {
  await new Promise((r) => setTimeout(r, ms));
}

async function testSupplierModalUnsavedPrompt() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="content"></div></body></html>`);
  const sandbox = {
    window: dom.window,
    document: dom.window.document,
    fetch: superFetch(app),
    console,
    setTimeout,
    clearTimeout,
  };

  // Minimal stubs used by some views.
  sandbox.window.HashChangeEvent = sandbox.window.HashChangeEvent || sandbox.window.Event;

  loadViews(sandbox);

  const root = dom.window.document.getElementById('content');
  await sandbox.window.renderSuppliers(root);

  const createBtn = Array.from(dom.window.document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Create Supplier');
  ok(!!createBtn, 'Suppliers view shows Create Supplier button');
  createBtn.click();

  const form = dom.window.document.querySelector('.modal-overlay form');
  ok(!!form, 'Supplier modal form opened');

  const nameInput = dom.window.document.querySelector('.modal-overlay input[name="name"]');
  ok(!!nameInput, 'Supplier modal has name input');
  nameInput.value = 'Unsaved Supplier Name';
  nameInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  nameInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

  const closeBtn = dom.window.document.querySelector('.modal-overlay .modal-close');
  ok(!!closeBtn, 'Supplier modal has close button');
  closeBtn.click();
  await tick(0);

  const unsaved = findUnsavedChangesOverlay(dom.window.document);
  ok(!!unsaved, 'Closing dirty modal shows Unsaved changes prompt');

  // Cancel should keep the edit modal open.
  const cancel = Array.from(unsaved.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Cancel');
  ok(!!cancel, 'Unsaved changes prompt has Cancel');
  cancel.click();
  await tick(0);
  ok(!findUnsavedChangesOverlay(dom.window.document), 'Cancel closes the prompt');
  ok(!!dom.window.document.querySelector('.modal-overlay form'), 'Cancel keeps the edit modal open');

  // Discard should close everything.
  dom.window.document.querySelector('.modal-overlay .modal-close').click();
  await tick(0);
  const unsaved2 = findUnsavedChangesOverlay(dom.window.document);
  ok(!!unsaved2, 'Prompt appears again on close');
  const discard = Array.from(unsaved2.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Discard');
  ok(!!discard, 'Unsaved changes prompt has Discard');
  discard.click();
  await tick(0);
  ok(dom.window.document.querySelectorAll('.modal-overlay').length === 0, 'Discard closes the edit modal');
}

(async () => {
  try {
    await testSupplierModalUnsavedPrompt();
  } catch (e) {
    console.error('UI modal smoke test error:', e);
    process.exitCode = 1;
  }

  if (!process.exitCode || process.exitCode === 0) console.log('UI modal smoke tests passed');
  else console.error('UI modal smoke tests failed');
})();
