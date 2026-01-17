import { registerCleanup } from '../utils.js';

function safeToast(msg, type = 'info') {
  try {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') window.showToast(msg);
    else console.log(type.toUpperCase() + ':', msg);
  } catch (_) {}
}

function parseIds(text) {
  return String(text || '')
    .split(/\r?\n|,|\t|\s{2,}/g)
    .map(s => s.trim())
    .filter(Boolean);
}

function looksLikeInventoryId(token) {
  const t = String(token || '').trim();
  if (!t) return false;
  const up = t.toUpperCase();
  return (
    up.startsWith('QBID-') ||
    up.startsWith('BLK-') ||
    up.startsWith('SLID-') ||
    up.startsWith('TILE-') ||
    up.startsWith('COB-') ||
    up.startsWith('MON-') ||
    up.includes('-BLOCK-') ||
    /-SP[A-Z0-9]+$/.test(up)
  );
}

function parseLabelLines(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/g);
  for (const line of lines) {
    const s = String(line || '').trim();
    if (!s) continue;

    // If the line is clearly just a comma-separated list of IDs, keep old behavior.
    if (s.includes(',') && !s.includes('|') && !s.includes('\t')) {
      s.split(',').map(x => x.trim()).filter(Boolean).forEach(id => out.push({ id, subtitle: '' }));
      continue;
    }

    let id = s;
    let subtitle = '';

    if (s.includes('\t')) {
      const parts = s.split('\t');
      id = (parts.shift() || '').trim();
      subtitle = parts.join('\t').trim();
    } else if (s.includes('|')) {
      const parts = s.split('|');
      id = (parts.shift() || '').trim();
      subtitle = parts.join('|').trim();
    } else if (/\s{2,}/.test(s)) {
      const parts = s.split(/\s{2,}/);
      id = (parts.shift() || '').trim();
      subtitle = parts.join(' ').trim();
    } else {
      // Single-space separated: treat first token as ID if it looks like one.
      const parts = s.split(/\s+/);
      if (parts.length > 1 && looksLikeInventoryId(parts[0])) {
        id = parts[0].trim();
        subtitle = parts.slice(1).join(' ').trim();
      }
    }

    if (id) out.push({ id, subtitle });
  }
  return out;
}

async function renderQrInto(canvas, value, sizePx = 128) {
  if (!canvas) return;
  const v = String(value || '');
  try {
    // `qrcode` library from CDN exposes `window.QRCode` with `toCanvas`.
    if (typeof window !== 'undefined' && window.QRCode && typeof window.QRCode.toCanvas === 'function') {
      await window.QRCode.toCanvas(canvas, v, {
        width: sizePx,
        margin: 1,
        errorCorrectionLevel: 'M'
      });
    } else {
      // Fallback: server-generated SVG (no CDN dependency)
      const wrap = canvas.parentElement;
      if (!wrap) return;

      let img = wrap.querySelector('img.label-qr-img');
      if (!img) {
        img = document.createElement('img');
        img.className = 'label-qr-img';
        img.alt = 'QR code';
        img.decoding = 'async';
        img.loading = 'lazy';
        wrap.appendChild(img);
      }

      img.width = sizePx;
      img.height = sizePx;
      canvas.style.display = 'none';
      img.style.display = '';

      img.onerror = () => {
        // Last-resort placeholder box if server route fails
        try {
          img.style.display = 'none';
          canvas.style.display = '';
          const ctx = canvas.getContext('2d');
          canvas.width = sizePx;
          canvas.height = sizePx;
          if (!ctx) return;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, sizePx, sizePx);
          ctx.strokeStyle = '#111';
          ctx.strokeRect(0.5, 0.5, sizePx - 1, sizePx - 1);
          ctx.fillStyle = '#111';
          ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
          ctx.fillText('QR', 8, 18);
        } catch (_) {}
      };

      img.src = `/api/qr?text=${encodeURIComponent(v)}&size=${encodeURIComponent(sizePx)}`;
    }
  } catch (e) {
    safeToast('Failed generating QR: ' + e, 'error');
  }
}

function makeLabelCard(id, { title = '', subtitle = '' } = {}) {
  const card = document.createElement('div');
  card.className = 'label-card';

  const qrWrap = document.createElement('div');
  qrWrap.className = 'label-qr';
  const canvas = document.createElement('canvas');
  qrWrap.appendChild(canvas);

  const meta = document.createElement('div');
  meta.className = 'label-meta';

  const h = document.createElement('div');
  h.className = 'label-title';
  h.textContent = title || 'Inventory Label';

  const code = document.createElement('div');
  code.className = 'label-code';
  code.textContent = id;

  const sub = document.createElement('div');
  sub.className = 'label-sub';
  sub.textContent = subtitle || '';

  meta.appendChild(h);
  meta.appendChild(code);
  if (subtitle) meta.appendChild(sub);

  card.appendChild(qrWrap);
  card.appendChild(meta);

  // render QR async
  setTimeout(() => { renderQrInto(canvas, id, 128); }, 0);

  return card;
}

function defaultTitleForId(id) {
  const v = String(id || '').toUpperCase();
  if (v.startsWith('SLID-')) return 'SLAB (SLID)';
  if (v.startsWith('BLK-') || v.includes('-BLOCK-') || /-SP[A-Z0-9]+$/.test(v)) return 'BLOCK';
  if (v.startsWith('QBID-')) return 'QBID';
  return 'LABEL';
}

export async function renderLabels(root) {
  while (root.firstChild) root.removeChild(root.firstChild);
  if (root && root.classList) root.classList.add('fade-in');

  const header = document.createElement('div');
  header.className = 'view-header';
  const title = document.createElement('h2');
  title.textContent = 'Labels';
  header.appendChild(title);

  const controls = document.createElement('div');
  controls.className = 'controls';

  const btnScan = document.createElement('button');
  btnScan.textContent = 'Scan QR';
  btnScan.onclick = () => {
    try { window.dispatchEvent(new CustomEvent('inventory:openScanner', { detail: { mode: 'search' } })); } catch (_) {}
  };

  const btnPrint = document.createElement('button');
  btnPrint.textContent = 'Print';
  btnPrint.onclick = () => window.print();

  controls.appendChild(btnScan);
  controls.appendChild(btnPrint);
  header.appendChild(controls);
  root.appendChild(header);

  const form = document.createElement('div');
  form.className = 'label-form';

  const row = document.createElement('div');
  row.className = 'label-form-row';

  const copiesWrap = document.createElement('label');
  copiesWrap.textContent = 'Copies per ID';
  const copies = document.createElement('input');
  copies.type = 'number';
  copies.min = '1';
  copies.value = '1';
  copiesWrap.appendChild(copies);

  const sizeWrap = document.createElement('label');
  sizeWrap.textContent = 'Size';
  const size = document.createElement('select');
  ;[
    { v: 'small', t: 'Small (2x1 in)' },
    { v: 'medium', t: 'Medium (3x2 in)' }
  ].forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.v;
    opt.textContent = o.t;
    size.appendChild(opt);
  });
  sizeWrap.appendChild(size);

  const subtitleWrap = document.createElement('label');
  subtitleWrap.textContent = 'Subtitle (optional)';
  const subtitle = document.createElement('input');
  subtitle.type = 'text';
  subtitle.placeholder = 'e.g., Granite / 20mm / Yard A';
  subtitleWrap.appendChild(subtitle);

  row.appendChild(copiesWrap);
  row.appendChild(sizeWrap);
  row.appendChild(subtitleWrap);
  form.appendChild(row);

  const idsWrap = document.createElement('label');
  idsWrap.textContent = 'IDs (one per line; optionally: ID + subtitle)';
  const ids = document.createElement('textarea');
  ids.rows = 6;
  ids.placeholder = 'qbid-parm-00001 Granite / Yard A\nBLK-PARM-00001-001 | Granite / Yard A\nSLID-PARM-00001-001-001\nTILE-XXXX';
  idsWrap.appendChild(ids);
  form.appendChild(idsWrap);

  const actions = document.createElement('div');
  actions.className = 'label-actions';
  const btnGen = document.createElement('button');
  btnGen.textContent = 'Generate';
  const btnClear = document.createElement('button');
  btnClear.textContent = 'Clear';
  btnClear.className = 'secondary';
  btnClear.onclick = () => {
    ids.value = '';
    subtitle.value = '';
    copies.value = '1';
    preview.innerHTML = '';
  };

  actions.appendChild(btnGen);
  actions.appendChild(btnClear);
  form.appendChild(actions);
  root.appendChild(form);

  const preview = document.createElement('div');
  preview.className = 'label-sheet';
  root.appendChild(preview);

  const onGenerate = () => {
    const entries = parseLabelLines(ids.value);
    const nCopies = Math.max(1, Number(copies.value || 1));
    const sub = String(subtitle.value || '').trim();
    const sizeVal = String(size.value || 'small');

    preview.innerHTML = '';
    preview.setAttribute('data-size', sizeVal);

    if (!entries.length) {
      safeToast('Enter at least one ID.', 'info');
      return;
    }

    entries.forEach(({ id, subtitle: lineSubtitle }) => {
      const effectiveSubtitle = String(lineSubtitle || '').trim() || sub;
      for (let i = 0; i < nCopies; i++) {
        preview.appendChild(makeLabelCard(id, { title: defaultTitleForId(id), subtitle: effectiveSubtitle }));
      }
    });
  };

  btnGen.onclick = onGenerate;

  // Allow Ctrl/Cmd+Enter to generate
  const onKey = (e) => {
    if (!e) return;
    const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
    const accel = isMac ? e.metaKey : e.ctrlKey;
    if (accel && e.key === 'Enter') onGenerate();
  };
  ids.addEventListener('keydown', onKey);

  registerCleanup(root, () => ids.removeEventListener('keydown', onKey));
}
