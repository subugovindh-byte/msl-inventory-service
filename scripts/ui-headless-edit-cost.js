const puppeteer = require('puppeteer');

(async () => {
  const base = 'http://localhost:4001/ui/#qbids';
  const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  console.log('Opening UI...');
  await page.goto(base, { waitUntil: 'networkidle2' });

  // Create a QBID via in-page fetch so the UI updates consistently
  console.log('Creating a new QBID via UI fetch...');
  const qbid = await page.evaluate(async () => {
    const payload = { supplier: 'PUptest', quarry: 'Q', weight_kg: 123, size_mm: '1000x1000x1000', grade: 'A', received_date: '2026-01-04' };
    const resp = await fetch('/qbids', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await resp.json();
    return j.qbid;
  });
  console.log('Created QBID:', qbid);
  console.log('Created QBID:', qbid);
  // Reload page so the UI fetches fresh data and shows the new QBID
  console.log('Reloading page to pick up new QBID...');
  await page.goto(base, { waitUntil: 'networkidle2' });
  // Wait for grid/table and the row containing the QBID
  console.log('Waiting for QBID row to appear...');
  // Ensure the API returns the new qbid and log the result (helps debug rendering issues)
  const apiList = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/qbids');
      return await r.json();
    } catch (e) { return { error: String(e) }; }
  });
  console.log('API /api/qbids returned', Array.isArray(apiList) ? apiList.length + ' items' : apiList);
  // Diagnostic: collect table/AG Grid row counts and sample texts
  const diag = await page.evaluate(() => {
    const tableRows = Array.from(document.querySelectorAll('table tbody tr')).map(r => r.innerText.trim()).slice(0,5);
    const agRowsEls = Array.from(document.querySelectorAll('.ag-center-cols-container .ag-row'));
    const agRows = agRowsEls.map(r => r.innerText.trim()).slice(0,5);
    return { tableCount: document.querySelectorAll('table tbody tr').length, tableRows, agCount: agRowsEls.length, agRows };
  });
  console.log('UI diagnostic:', diag);
  // If AG Grid is present, set the quick-search input to the qbid so grid filters to it
  const filtered = await page.evaluate(async (q) => {
    const quick = document.querySelector('.grid-toolbar input[placeholder="Search..."]') || document.querySelector('.grid-toolbar input');
    if (quick) {
      quick.value = q;
      quick.dispatchEvent(new Event('input', { bubbles: true }));
      // allow grid to process
      await new Promise(r => setTimeout(r, 500));
    }
    // check AG Grid rows for the qbid
    const agRowsEls = Array.from(document.querySelectorAll('.ag-center-cols-container .ag-row'));
    if (agRowsEls.some(r => r.innerText && r.innerText.includes(q))) return true;
    // check fallback table rows
    const tableRows = Array.from(document.querySelectorAll('table tbody tr'));
    if (tableRows.some(r => r.innerText && r.innerText.includes(q))) return true;
    return false;
  }, qbid);
  console.log('Filtered UI contains qbid?', filtered);
  if (!filtered) {
    console.error('QBID not present in UI DOM after filtering — cannot proceed with click-based edit test.');
    await browser.close();
    process.exit(6);
  }

  // Click the edit button for that row (action-btn)
  console.log('Clicking edit button for the QBID row...');
  const clicked = await page.evaluate((q) => {
    // find an element containing the qbid text
    const el = Array.from(document.querySelectorAll('td,div')).find(n => n.textContent && n.textContent.trim() === q);
    if (!el) return false;
    // traverse up to row
    let row = el.parentElement;
    while (row && !row.matches('.ag-row') && row.tagName !== 'TR') row = row.parentElement;
    if (!row) return false;
    // find edit button inside row
    const btn = row.querySelector('button.action-btn');
    if (!btn) {
      // try any button with ✏️ text
      const btn2 = Array.from(row.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('✏'));
      if (btn2) { btn2.click(); return true; }
      return false;
    }
    btn.click();
    return true;
  }, qbid);

  if (!clicked) {
    console.error('Failed to find or click edit button for QBID row');
    await browser.close();
    process.exit(2);
  }

  // Wait for edit form
  console.log('Waiting for edit form...');
  await page.waitForSelector('.edit-form');

  // Fill cost fields
  const gross = 111.5; const transport = 22.25; const other = 3.75;
  console.log('Filling cost inputs...');
  await page.evaluate((g,t,o) => {
    const gEl = document.querySelector('#gross_cost'); if (gEl) gEl.value = String(g);
    const tEl = document.querySelector('#transport_cost'); if (tEl) tEl.value = String(t);
    const oEl = document.querySelector('#other_cost'); if (oEl) oEl.value = String(o);
    const totalEl = document.querySelector('#total_cost'); if (totalEl) totalEl.value = String(Number(g)+Number(t)+Number(o));
  }, gross, transport, other);

  // Submit the form
  console.log('Submitting form...');
  await page.evaluate(() => {
    const form = document.querySelector('.edit-form');
    const submit = form && form.querySelector('button[type="submit"]');
    if (submit) submit.click();
  });

  // Wait for toast or re-render: wait for /api/qbids to contain updated values
  console.log('Waiting for API to reflect updated costs...');
  await page.waitForResponse(resp => resp.url().endsWith('/api/qbids') && resp.status() === 200, { timeout: 10000 });

  // Fetch updated QBID record via page context
  const updated = await page.evaluate(async (q) => {
    const resp = await fetch('/api/qbids');
    const arr = await resp.json();
    return arr.find(x => x.qbid === q) || null;
  }, qbid);

  if (!updated) {
    console.error('Updated QBID not found via /api/qbids');
    await browser.close();
    process.exit(3);
  }

  console.log('Updated QBID record:', updated.qbid, 'gross:', updated.gross_cost, 'transport:', updated.transport_cost, 'other:', updated.other_cost, 'total:', updated.total_cost);

  // Verify values approximately
  const ok = Number(updated.gross_cost) === gross && Number(updated.transport_cost) === transport && Number(updated.other_cost) === other;
  if (!ok) {
    console.error('Cost values do not match expected');
    await browser.close();
    process.exit(4);
  }

  // Also verify UI shows updated total in the row
  console.log('Verifying UI displays updated total...');
  const uiHas = await page.evaluate((q, expectedTotal) => {
    const el = Array.from(document.querySelectorAll('td,div,span')).find(n => n.textContent && n.textContent.trim() === q);
    if (!el) return false;
    let row = el.parentElement;
    while (row && !row.matches('.ag-row') && row.tagName !== 'TR') row = row.parentElement;
    if (!row) return false;
    return row.textContent && row.textContent.includes(String(expectedTotal));
  }, qbid, Number(gross+transport+other));

  if (!uiHas) {
    console.error('UI row did not show expected total');
    await browser.close();
    process.exit(5);
  }

  console.log('Headless UI edit smoke test PASSED');
  await browser.close();
  process.exit(0);
})();
