import { registerRoute, setDefaultRoute, startRouter } from './router.js';
import { setGlobalSearchQuery, dispatchInventorySearch } from './utils.js';
import { renderQbids } from './views/qbids.js';
import { renderBlocks } from './views/blocks.js';
import { renderSlabs } from './views/slabs.js';
import { renderLabels } from './views/labels.js';
import { renderTiles } from './views/tiles.js';
import { renderCobbles } from './views/cobbles.js';
import { renderMonuments } from './views/monuments.js';
import { renderPavers } from './views/pavers.js';
import { renderEvents } from './views/events.js';
import { renderDispatches } from './views/dispatches.js';
import { renderSuppliers } from './views/suppliers.js';
import NexaAI from './ainexaia.js';
// ensure the imported module is attached to window as a fallback
try { if (!window.NexaAI) window.NexaAI = NexaAI; console.debug && console.debug('main: ensured window.NexaAI'); } catch (e) { console.warn('main: could not attach NexaAI to window', e); }

registerRoute('qbids', renderQbids);
registerRoute('blocks', renderBlocks);
registerRoute('slabs', renderSlabs);
registerRoute('labels', renderLabels);
registerRoute('tiles', renderTiles);
registerRoute('cobbles', renderCobbles);
registerRoute('monuments', renderMonuments);
registerRoute('pavers', renderPavers);
registerRoute('suppliers', renderSuppliers);
registerRoute('events', renderEvents);
registerRoute('dispatches', renderDispatches);

setDefaultRoute('qbids');

// Main nav routing (use delegation so it survives DOM wrapping/moves)
const mainNav = document.getElementById('main-nav');
if (mainNav) {
  mainNav.addEventListener('click', (e) => {
    const btn = e && e.target && e.target.closest ? e.target.closest('button[data-view]') : null;
    if (!btn) return;
    const view = String(btn.getAttribute('data-view') || '').trim();
    if (!view) return;
    try { e.preventDefault(); } catch (_) {}
    location.hash = '#' + view;
  });
}

startRouter();

// Keep the top nav in sync with the current route
const navButtons = Array.from(document.querySelectorAll('#main-nav button[data-view]'));
function syncActiveNav() {
  const hash = location.hash.replace(/^#/, '');
  const [path] = hash.split('?');
  const current = (path || 'qbids').toLowerCase();
  navButtons.forEach((btn) => {
    const view = String(btn.getAttribute('data-view') || '').toLowerCase();
    const active = view === current;
    btn.classList.toggle('active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', syncActiveNav);
syncActiveNav();

// attach NexaAI to window (module also already sets window.NexaAI)
try { window.NexaAI = NexaAI; } catch (e) {}

// Global search: dispatch a custom event with the query
const globalSearchInput = document.getElementById('global-search');
const globalSearchCategory = document.getElementById('search-category');
const globalSearchButton = document.getElementById('search-btn');
if (globalSearchInput) {
  const getCurrentRoute = () => {
    const hash = String(location.hash || '').replace(/^#/, '');
    const [path] = hash.split('?');
    return (path || 'qbids').toLowerCase();
  };

  const getSelectedRoute = () => {
    const raw = globalSearchCategory ? String(globalSearchCategory.value || '') : 'all';
    const v = raw.trim().toLowerCase();
    return v || 'all';
  };

  const performSearch = ({ autoRoute = true } = {}) => {
    const query = String(globalSearchInput.value || '').trim();
    const selected = getSelectedRoute();

    // If user selects a specific category, route there.
    // If "all", search within the current view (no routing).
    let targetRoute = null;
    if (selected && selected !== 'all') targetRoute = selected;

    if (autoRoute && targetRoute) {
      const current = getCurrentRoute();
      if (targetRoute !== current) {
        location.hash = '#' + targetRoute;
        // Ensure new view receives the event even if it binds after navigation.
        setTimeout(() => dispatchInventorySearch(query), 30);
        return;
      }
    }

    dispatchInventorySearch(query);
  };

  // Amazon-style behavior: only run a search on Enter/🔍 (not every keystroke).
  // (Escape still clears and emits.)

  globalSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      globalSearchInput.value = '';
      setGlobalSearchQuery('', { emit: true });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      performSearch({ autoRoute: true });
    }
  });

  if (globalSearchButton) {
    globalSearchButton.addEventListener('click', () => performSearch({ autoRoute: true }));
  }

  if (globalSearchCategory) {
    globalSearchCategory.addEventListener('change', () => {
      const selected = getSelectedRoute();
      if (selected === 'all') {
        // No auto-run; keep Amazon-style click/Enter behavior.
      }
    });
  }
}

// --- QR scanner modal + routing --------------------------------------------

function guessRouteFromScannedValue(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  const up = v.toUpperCase();
  if (up.startsWith('TILE-')) return 'tiles';
  if (up.startsWith('COB-')) return 'cobbles';
  if (up.startsWith('MON-')) return 'monuments';
  if (up.startsWith('PAV-')) return 'pavers';
  if (up.startsWith('SLID-')) return 'slabs';
  if (up.startsWith('BLK-')) return 'blocks';
  if (up.startsWith('QBID-')) {
    if (up.includes('-BLOCK-') || /-SP[A-Z0-9]+$/.test(up)) return 'blocks';
    return 'qbids';
  }
  // If it contains a known view keyword, route there.
  if (up.includes('DISPATCH')) return 'dispatches';
  return null;
}

function parseScannedPayload(raw, { mode = 'search' } = {}) {
  const v = String(raw || '').trim();
  if (!v) return null;

  // JSON payload support (optional)
  if (v.startsWith('{') && v.endsWith('}')) {
    try {
      const obj = JSON.parse(v);
      if (obj && typeof obj === 'object') {
        const action = (obj.action || 'search').toString().toLowerCase();
        const view = obj.view ? String(obj.view).toLowerCase() : null;
        const query = obj.query ? String(obj.query).trim() : null;
        const slid = obj.slid ? String(obj.slid).trim() : null;
        const item_type = obj.item_type ? String(obj.item_type).trim().toLowerCase() : null;
        const item_id = obj.item_id ? String(obj.item_id).trim() : null;
        return { raw: v, action, view, query, slid, item_type, item_id };
      }
    } catch (_) {
      // ignore
    }
  }

  // Structured string payloads.
  // Examples:
  // - MODERNEX:SEARCH:SLID-0001
  // - MODERNEX:TILES:SLID-0001      (create tiles from slab)
  // - MODERNEX:COBBLES:SLID-0001    (create cobbles from slab)
  // - MODERNEX:MONUMENTS:SLID-0001  (create monuments from slab)
  // - MODERNEX:PAVERS:SLID-0001     (create pavers from slab)
  // - MODERNEX:DISPATCH:SLID-0001   (create dispatch for slab)
  // - MODERNEX:DISPATCH:TILE-XXXX   (create dispatch for derived item)
  if (/^MODERNEX:/i.test(v)) {
    const parts = v.split(':');
    const tag = (parts[0] || '').trim().toUpperCase();
    if (tag === 'MODERNEX' && parts.length >= 3) {
      const type = (parts[1] || '').trim().toUpperCase();
      const value = parts.slice(2).join(':').trim();
      const upValue = value.toUpperCase();

      if (type === 'SEARCH') {
        return { raw: v, action: 'search', query: value, view: guessRouteFromScannedValue(value) };
      }
      if (type === 'TILES' || type === 'TILE') {
        // Prefer create from SLID when given a slab.
        if (upValue.startsWith('SLID-')) return { raw: v, action: 'create', view: 'tiles', slid: value };
        return { raw: v, action: 'search', view: 'tiles', query: value };
      }
      if (type === 'COBBLES' || type === 'COBBLE') {
        if (upValue.startsWith('SLID-')) return { raw: v, action: 'create', view: 'cobbles', slid: value };
        return { raw: v, action: 'search', view: 'cobbles', query: value };
      }
      if (type === 'MONUMENTS' || type === 'MONUMENT') {
        if (upValue.startsWith('SLID-')) return { raw: v, action: 'create', view: 'monuments', slid: value };
        return { raw: v, action: 'search', view: 'monuments', query: value };
      }
      if (type === 'PAVERS' || type === 'PAVER') {
        if (upValue.startsWith('SLID-')) return { raw: v, action: 'create', view: 'pavers', slid: value };
        return { raw: v, action: 'search', view: 'pavers', query: value };
      }
      if (type === 'DISPATCH' || type === 'DISPATCHES') {
        // Create a dispatch for either a slab (SLID-*) or derived item ID.
        if (upValue.startsWith('SLID-')) return { raw: v, action: 'create', view: 'dispatches', slid: value };
        if (upValue.startsWith('TILE-')) return { raw: v, action: 'create', view: 'dispatches', item_type: 'tile', item_id: value };
        if (upValue.startsWith('COB-')) return { raw: v, action: 'create', view: 'dispatches', item_type: 'cobble', item_id: value };
        if (upValue.startsWith('MON-')) return { raw: v, action: 'create', view: 'dispatches', item_type: 'monument', item_id: value };
        if (upValue.startsWith('PAV-')) return { raw: v, action: 'create', view: 'dispatches', item_type: 'paver', item_id: value };
        return { raw: v, action: 'search', view: 'dispatches', query: value };
      }

      // Fall back to treating remaining structured values as a search.
      return { raw: v, action: 'search', query: value, view: guessRouteFromScannedValue(value) };
    }
  }

  // Fallback: derive behavior from selected mode.
  const up = v.toUpperCase();
  if (mode === 'create_tiles' && up.startsWith('SLID-')) return { raw: v, action: 'create', view: 'tiles', slid: v };
  if (mode === 'create_cobbles' && up.startsWith('SLID-')) return { raw: v, action: 'create', view: 'cobbles', slid: v };
  if (mode === 'create_monuments' && up.startsWith('SLID-')) return { raw: v, action: 'create', view: 'monuments', slid: v };
  if (mode === 'create_pavers' && up.startsWith('SLID-')) return { raw: v, action: 'create', view: 'pavers', slid: v };
  if (mode === 'create_dispatch') {
    if (up.startsWith('SLID-')) return { raw: v, action: 'create', view: 'dispatches', slid: v };
    if (up.startsWith('TILE-')) return { raw: v, action: 'create', view: 'dispatches', item_type: 'tile', item_id: v };
    if (up.startsWith('COB-')) return { raw: v, action: 'create', view: 'dispatches', item_type: 'cobble', item_id: v };
    if (up.startsWith('MON-')) return { raw: v, action: 'create', view: 'dispatches', item_type: 'monument', item_id: v };
    if (up.startsWith('PAV-')) return { raw: v, action: 'create', view: 'dispatches', item_type: 'paver', item_id: v };
  }

  return { raw: v, action: 'search', query: v, view: guessRouteFromScannedValue(v) };
}

function applyScannedValue(raw, { autoRoute = true, mode = 'search' } = {}) {
  const payload = parseScannedPayload(raw, { mode });
  if (!payload) return;

  const query = payload.query || payload.slid || payload.item_id || payload.raw;

  // Only push into global search for search actions.
  if ((payload.action || 'search') === 'search' && query) {
    setGlobalSearchQuery(query, { emit: false });
  }

  const route = (autoRoute ? (payload.view || guessRouteFromScannedValue(query)) : payload.view) || null;
  if (route) {
    location.hash = '#' + route;
    // Ensure new view receives the event even if it binds after navigation.
    setTimeout(() => {
      if ((payload.action || 'search') === 'search' && query) dispatchInventorySearch(query);
      window.dispatchEvent(new CustomEvent('inventory:scanned', { detail: payload }));
    }, 30);
    return;
  }

  if ((payload.action || 'search') === 'search' && query) dispatchInventorySearch(query);
  window.dispatchEvent(new CustomEvent('inventory:scanned', { detail: payload }));
}

function createQrScannerModal() {
  const overlay = document.createElement('div');
  overlay.id = 'qr-scan-modal';
  overlay.setAttribute('hidden', '');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-label', 'QR Scanner');

  const header = document.createElement('div');
  header.className = 'modal-header';
  const h = document.createElement('strong');
  h.textContent = 'Scan QR Code';
  const close = document.createElement('button');
  close.className = 'modal-close';
  close.type = 'button';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Close');
  header.appendChild(h);
  header.appendChild(close);

  const body = document.createElement('div');
  body.className = 'modal-body';

  const note = document.createElement('div');
  note.className = 'modal-note';
  note.textContent = 'Point the camera at a QR code. The scanned value will be applied to the global search.';

  const status = document.createElement('div');
  status.className = 'qr-status';
  status.setAttribute('aria-live', 'polite');

  const videoWrap = document.createElement('div');
  videoWrap.className = 'qr-video-wrap';
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.muted = true;
  videoWrap.appendChild(video);

  const controls = document.createElement('div');
  controls.className = 'modal-actions';

  const modeWrap = document.createElement('label');
  modeWrap.style.marginRight = '10px';
  modeWrap.appendChild(document.createTextNode('Mode: '));
  const modeSel = document.createElement('select');
  modeSel.id = 'qr-scan-mode';
  ;[
    { value: 'search', label: 'Search' },
    { value: 'create_tiles', label: 'Create Tiles (scan SLID)' },
    { value: 'create_cobbles', label: 'Create Cobbles (scan SLID)' },
    { value: 'create_monuments', label: 'Create Monuments (scan SLID)' },
    { value: 'create_pavers', label: 'Create Pavers (scan SLID)' },
    { value: 'create_dispatch', label: 'Create Dispatch (scan SLID / item ID)' }
  ].forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.value; opt.textContent = o.label;
    modeSel.appendChild(opt);
  });
  modeWrap.appendChild(modeSel);

  const autoRouteLabel = document.createElement('label');
  autoRouteLabel.className = 'checkbox';
  const autoRoute = document.createElement('input');
  autoRoute.type = 'checkbox';
  autoRoute.checked = true;
  autoRouteLabel.appendChild(autoRoute);
  autoRouteLabel.appendChild(document.createTextNode(' Auto-navigate (QBID/Block/SLID)'));

  const btnStart = document.createElement('button');
  btnStart.type = 'button';
  btnStart.textContent = 'Start Camera';
  const btnStop = document.createElement('button');
  btnStop.type = 'button';
  btnStop.textContent = 'Stop';
  btnStop.className = 'secondary';

  const btnPhoto = document.createElement('button');
  btnPhoto.type = 'button';
  btnPhoto.textContent = 'Scan Photo';
  btnPhoto.className = 'secondary';

  const photoInput = document.createElement('input');
  photoInput.type = 'file';
  photoInput.accept = 'image/*';
  try { photoInput.setAttribute('capture', 'environment'); } catch (_) {}
  photoInput.style.display = 'none';

  controls.appendChild(modeWrap);
  controls.appendChild(autoRouteLabel);
  controls.appendChild(btnStart);
  controls.appendChild(btnStop);
  controls.appendChild(btnPhoto);

  const manual = document.createElement('div');
  manual.className = 'qr-manual';
  const manualInput = document.createElement('input');
  manualInput.type = 'text';
  manualInput.placeholder = 'Or paste/type code here…';
  const manualBtn = document.createElement('button');
  manualBtn.type = 'button';
  manualBtn.textContent = 'Apply';
  manual.appendChild(manualInput);
  manual.appendChild(manualBtn);

  body.appendChild(note);
  body.appendChild(status);
  body.appendChild(videoWrap);
  body.appendChild(controls);
  body.appendChild(manual);
  body.appendChild(photoInput);

  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let stream = null;
  let scanning = false;
  let raf = null;
  let detector = null;

  const setStatus = (msg, { kind = 'info' } = {}) => {
    try {
      status.dataset.kind = String(kind || 'info');
      status.textContent = String(msg || '');
    } catch (_) {}
  };

  const isLikelyInAppBrowser = () => {
    try {
      const ua = String(navigator.userAgent || '');
      return (
        /FBAN|FBAV|Instagram|Line\//i.test(ua) ||
        /Snapchat/i.test(ua) ||
        /Twitter/i.test(ua) ||
        /GSA\//i.test(ua) || // Google Search App
        /; wv\)/i.test(ua) // Android WebView
      );
    } catch (_) {
      return false;
    }
  };

  const getUserMediaCompat = async (constraints) => {
    // Prefer standards-based API.
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      return navigator.mediaDevices.getUserMedia(constraints);
    }
    // Legacy fallback (older iOS / embedded webviews).
    const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
    if (typeof legacy === 'function') {
      return new Promise((resolve, reject) => {
        try {
          legacy.call(navigator, constraints, resolve, reject);
        } catch (e) {
          reject(e);
        }
      });
    }
    throw new Error('getUserMedia is not available');
  };

  function stop() {
    scanning = false;
    try { if (raf) cancelAnimationFrame(raf); } catch (_) {}
    raf = null;
    try {
      if (stream) stream.getTracks().forEach(t => t.stop());
    } catch (_) {}
    stream = null;
    try { video.pause(); } catch (_) {}
    try { video.srcObject = null; } catch (_) {}
  }

  async function scanLoop() {
    if (!scanning) return;
    try {
      if (detector) {
        const barcodes = await detector.detect(video);
        if (barcodes && barcodes.length) {
          const raw = barcodes[0].rawValue || '';
          if (raw) {
            applyScannedValue(raw, { autoRoute: !!autoRoute.checked, mode: String(modeSel.value || 'search') });
            window.showToast && window.showToast('Scanned: ' + raw);
            closeModal();
            return;
          }
        }
      }
    } catch (e) {
      // Ignore per-frame detect errors.
    }
    raf = requestAnimationFrame(scanLoop);
  }

  async function start() {
    if (scanning) return;

    // Most mobile browsers require a secure context for camera access.
    // `http://localhost` is OK on the same device, but `http://<LAN IP>` is NOT.
    try {
      if (!window.isSecureContext) {
        setStatus(
          `Camera requires HTTPS (secure context). Current origin is ${location.origin}. ` +
          'Open the UI over HTTPS (e.g., reverse proxy/ngrok) or use the manual input below.',
          { kind: 'error' }
        );
        window.showToast && window.showToast('Camera requires HTTPS (secure context).');
        return;
      }
    } catch (_) {}

    // Detect missing camera API (common in iOS in-app browsers / embedded webviews).
    const hasModernGUM = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
    const hasLegacyGUM = typeof (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia) === 'function';
    if (!hasModernGUM && !hasLegacyGUM) {
      const hint = isLikelyInAppBrowser()
        ? 'It looks like an in-app browser. Open this page in Safari/Chrome directly.'
        : 'Open this page in Safari/Chrome and ensure camera permission is allowed.';
      const msg = `Camera API not available in this browser. ${hint}`;
      setStatus(msg, { kind: 'error' });
      window.showToast && window.showToast('Camera API not available (try Safari/Chrome).');
      return;
    }

    // BarcodeDetector is not available on all mobile browsers (notably many iOS Safari versions).
    // We still start the camera preview even if we can't decode automatically.
    detector = null;
    if (typeof window.BarcodeDetector === 'function') {
      try {
        detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch (e) {
        detector = null;
      }
    }
    if (!detector) {
      setStatus(
        'Live preview can start, but auto-scan is not supported in this browser. ' +
          'Try Chrome/Edge (Android) or use manual input.',
        { kind: 'warn' }
      );
    } else {
      setStatus('Starting camera…', { kind: 'info' });
    }

    const requestCamera = async () => {
      const attempts = [
        { video: { facingMode: { exact: 'environment' } }, audio: false },
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        { video: { facingMode: 'environment' }, audio: false },
        { video: true, audio: false }
      ];
      let lastErr = null;
      for (const constraints of attempts) {
        try {
          return await getUserMediaCompat(constraints);
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
    };

    try {
      stream = await requestCamera();
      video.srcObject = stream;
      try { video.setAttribute('playsinline', ''); } catch (_) {}
      try { video.setAttribute('autoplay', ''); } catch (_) {}
      try { video.setAttribute('muted', ''); } catch (_) {}
      try { video.autoplay = true; } catch (_) {}
      try { video.muted = true; } catch (_) {}
      await video.play();
      if (detector) {
        scanning = true;
        raf = requestAnimationFrame(scanLoop);
      } else {
        // Preview only.
        scanning = false;
      }
    } catch (e) {
      const msg = 'Camera permission failed: ' + (e && e.message ? e.message : e);
      setStatus(msg, { kind: 'error' });
      window.showToast && window.showToast(msg);
      stop();
    }
  }

  function openModal() {
    overlay.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
    setTimeout(() => { try { manualInput.focus(); } catch (_) {} }, 50);
  }

  function closeModal() {
    stop();
    overlay.setAttribute('hidden', '');
    document.body.style.overflow = '';
  }

  close.onclick = () => closeModal();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  btnStart.onclick = () => start();
  btnStop.onclick = () => stop();
  btnPhoto.onclick = () => {
    try { photoInput.value = ''; } catch (_) {}
    try { photoInput.click(); } catch (_) {}
  };

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files && photoInput.files[0];
    if (!file) return;
    try {
      setStatus('Decoding photo…', { kind: 'info' });
      const form = new FormData();
      form.append('image', file, file.name || 'qr.jpg');
      const resp = await fetch('/api/qr/decode', { method: 'POST', body: form });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error((data && data.error) ? data.error : ('HTTP ' + resp.status));
      }
      const raw = data && (data.text || data.result || data.rawValue);
      if (!raw || !String(raw).trim()) throw new Error('No QR detected');
      applyScannedValue(String(raw).trim(), { autoRoute: !!autoRoute.checked, mode: String(modeSel.value || 'search') });
      window.showToast && window.showToast('Scanned: ' + String(raw).trim());
      closeModal();
    } catch (e) {
      setStatus('Decode failed: ' + (e && e.message ? e.message : e), { kind: 'error' });
    }
  });
  manualBtn.onclick = () => {
    const v = String(manualInput.value || '').trim();
    if (!v) return;
    applyScannedValue(v, { autoRoute: !!autoRoute.checked, mode: String(modeSel.value || 'search') });
    closeModal();
  };
  manualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') manualBtn.click();
    if (e.key === 'Escape') closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (!overlay.hasAttribute('hidden') && e.key === 'Escape') closeModal();
  });

  return { open: openModal, close: closeModal };
}

const qrModal = createQrScannerModal();

// Header button wiring
const qrScanBtn = document.getElementById('qr-scan-btn');
if (qrScanBtn) qrScanBtn.addEventListener('click', () => qrModal.open());

const labelsBtn = document.getElementById('labels-btn');
if (labelsBtn) labelsBtn.addEventListener('click', () => { location.hash = '#labels'; });

// Allow views to open the scanner
try {
  window.addEventListener('inventory:openScanner', () => qrModal.open());
} catch (_) {}

// Keyboard shortcuts:
// - Ctrl/Cmd+Shift+S: open scanner
// - Ctrl/Cmd+Shift+L: open labels
document.addEventListener('keydown', (e) => {
  try {
    const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
    const accel = isMac ? e.metaKey : e.ctrlKey;
    if (!accel || !e.shiftKey) return;
    if (e.key.toLowerCase() === 's') { e.preventDefault(); qrModal.open(); }
    if (e.key.toLowerCase() === 'l') { e.preventDefault(); location.hash = '#labels'; }
  } catch (_) {}
});

// Mobile menu toggle
const headerEl = document.querySelector('header');
const menuToggle = document.querySelector('.menu-toggle');
if (menuToggle && headerEl) {
  const navEl = document.getElementById('main-nav');
  // Wrap nav content once so mobile can scroll reliably (iOS-friendly).
  try {
    if (navEl && !navEl.querySelector('.gx-nav-scroll')) {
      const scroll = document.createElement('div');
      scroll.className = 'gx-nav-scroll';
      while (navEl.firstChild) scroll.appendChild(navEl.firstChild);
      navEl.appendChild(scroll);
    }
  } catch (_) {}
  let backdropEl = document.getElementById('mobile-nav-backdrop');
  let savedScrollY = 0;
  if (!backdropEl) {
    backdropEl = document.createElement('div');
    backdropEl.id = 'mobile-nav-backdrop';
    backdropEl.setAttribute('hidden', '');
    document.body.appendChild(backdropEl);
  }

  const lockBodyScroll = () => {
    // iOS Safari: overflow hidden is not enough; use position:fixed.
    try {
      savedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.width = '100%';
    } catch (_) {}
  };

  const unlockBodyScroll = () => {
    try {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
      window.scrollTo(0, savedScrollY || 0);
    } catch (_) {}
  };

  const closeMenu = () => {
    headerEl.classList.remove('menu-open');
    document.body.classList.remove('gx-nav-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    backdropEl.setAttribute('hidden', '');
    unlockBodyScroll();
  };

  const openMenu = () => {
    headerEl.classList.add('menu-open');
    document.body.classList.add('gx-nav-open');
    menuToggle.setAttribute('aria-expanded', 'true');
    backdropEl.removeAttribute('hidden');
    lockBodyScroll();
    // Focus first item for better mobile accessibility
    setTimeout(() => {
      try {
        const first = navEl ? navEl.querySelector('button') : null;
        if (first && typeof first.focus === 'function') first.focus();
      } catch (_) {}
    }, 50);
  };

  menuToggle.addEventListener('click', (e) => {
    try { e && e.preventDefault && e.preventDefault(); } catch (_) {}
    const isOpen = headerEl.classList.contains('menu-open');
    if (isOpen) closeMenu();
    else openMenu();
  });

  backdropEl.addEventListener('click', closeMenu);

  document.addEventListener('keydown', (e) => {
    if (e && e.key === 'Escape' && headerEl.classList.contains('menu-open')) {
      closeMenu();
      try { menuToggle.focus(); } catch (_) {}
    }
  });

  // Close menu after selecting a route on mobile widths
  Array.from(document.querySelectorAll('#main-nav button')).forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 900px)').matches) {
        closeMenu();
      }
    });
  });
}

// Header overflow actions (mobile): move action buttons into a "More" menu.
(() => {
  const moreBtn = document.getElementById('header-more-btn');
  const moreMenu = document.getElementById('header-more-menu');
  const actions = document.getElementById('header-actions');
  if (!moreBtn || !moreMenu || !actions) return;

  const positionMoreMenu = () => {
    try {
      if (moreMenu.hasAttribute('hidden')) return;
      const btnRect = moreBtn.getBoundingClientRect();
      // Force a stable measuring box for the menu
      moreMenu.style.position = 'fixed';
      moreMenu.style.right = 'auto';
      moreMenu.style.bottom = 'auto';
      moreMenu.style.left = '0px';
      moreMenu.style.top = '0px';

      const menuRect = moreMenu.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const margin = 10;
      const gap = 8;

      // Prefer aligning the menu's right edge to the button's right edge.
      let left = Math.round(btnRect.right - menuRect.width);
      left = Math.max(margin, Math.min(left, viewportW - menuRect.width - margin));

      // Prefer opening below; if it doesn't fit, open above.
      let top = Math.round(btnRect.bottom + gap);
      const fitsBelow = (top + menuRect.height + margin) <= viewportH;
      if (!fitsBelow) {
        const above = Math.round(btnRect.top - gap - menuRect.height);
        if (above >= margin) top = above;
        else top = Math.max(margin, viewportH - menuRect.height - margin);
      }

      moreMenu.style.left = `${left}px`;
      moreMenu.style.top = `${top}px`;
      moreMenu.style.zIndex = '6500';
    } catch (_) {}
  };

  const mq = window.matchMedia('(max-width: 520px)');
  const originalParent = actions.parentElement;
  const originalNextSibling = moreBtn; // insert actions before this when restoring

  const closeMore = () => {
    moreMenu.setAttribute('hidden', '');
    moreBtn.setAttribute('aria-expanded', 'false');
    // reset any fixed positioning overrides
    try {
      moreMenu.style.position = '';
      moreMenu.style.left = '';
      moreMenu.style.top = '';
      moreMenu.style.right = '';
      moreMenu.style.bottom = '';
      moreMenu.style.zIndex = '';
    } catch (_) {}
  };

  const openMore = () => {
    moreMenu.removeAttribute('hidden');
    moreBtn.setAttribute('aria-expanded', 'true');
    // Position after it becomes visible so we can measure dimensions
    requestAnimationFrame(positionMoreMenu);
  };

  const syncLayout = () => {
    const isSmall = !!mq.matches;
    if (isSmall) {
      // Move children into the menu once.
      if (actions.childNodes.length) {
        while (actions.firstChild) moreMenu.appendChild(actions.firstChild);
      }
      closeMore();
    } else {
      // Restore children back into actions wrapper.
      if (moreMenu.childNodes.length) {
        while (moreMenu.firstChild) actions.appendChild(moreMenu.firstChild);
      }
      closeMore();
      // Ensure actions wrapper sits where expected.
      try {
        if (originalParent && originalNextSibling && actions.parentElement === originalParent) {
          // already in correct place
        }
      } catch (_) {}
    }
  };

  moreBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isOpen = !moreMenu.hasAttribute('hidden');
    if (isOpen) closeMore(); else openMore();
  });

  // Use capture so it still runs even if inner menus call stopPropagation.
  // Close on the next tick so the clicked button's handler runs first.
  moreMenu.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!btn) return;
    if (btn.id === 'nexa-badge') return;
    setTimeout(closeMore, 0);
  }, true);

  document.addEventListener('click', (e) => {
    if (moreMenu.hasAttribute('hidden')) return;
    const t = e.target;
    if (t === moreBtn || moreBtn.contains(t) || moreMenu.contains(t)) return;
    closeMore();
  });

  document.addEventListener('keydown', (e) => {
    if (e && e.key === 'Escape') closeMore();
  });

  window.addEventListener('resize', () => { try { positionMoreMenu(); } catch (_) {} });
  window.addEventListener('scroll', () => { try { positionMoreMenu(); } catch (_) {} }, true);

  try { mq.addEventListener('change', syncLayout); } catch (_) { try { mq.addListener(syncLayout); } catch (_) {} }
  window.addEventListener('resize', syncLayout);
  syncLayout();
})();

// AIIIQ Chat: toggle, send, and stubbed replies
const aiiqToggle = document.getElementById('aiiq-chat-toggle');
const aiiqPanel = document.getElementById('aiiq-chat-panel');
const aiiqClose = document.querySelector('.aiiq-chat-close');
const aiiqForm = document.getElementById('aiiq-chat-form');
const aiiqInput = document.getElementById('aiiq-chat-text');
const aiiqMessages = document.getElementById('aiiq-chat-messages');

function aiiqOpen() {
  aiiqPanel.classList.add('open');
  aiiqPanel.removeAttribute('hidden');
  aiiqToggle.setAttribute('aria-expanded', 'true');
  // Focus input when opened
  setTimeout(() => aiiqInput && aiiqInput.focus(), 50);
}
function aiiqClosePanel() {
  aiiqPanel.classList.remove('open');
  aiiqPanel.setAttribute('hidden', '');
  aiiqToggle.setAttribute('aria-expanded', 'false');
}
function aiiqAppendMessage(text, who = 'ai') {
  const row = document.createElement('div');
  row.className = `aiiq-msg ${who}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  row.appendChild(bubble);
  aiiqMessages.appendChild(row);
  aiiqMessages.scrollTop = aiiqMessages.scrollHeight;
}
function aiiqSaveHistory() {
  const items = Array.from(aiiqMessages.querySelectorAll('.aiiq-msg')).map(el => ({
    who: el.classList.contains('user') ? 'user' : 'ai',
    text: el.querySelector('.bubble')?.textContent || ''
  }));
  try { localStorage.setItem('aiiqChatHistory', JSON.stringify(items)); } catch {}
}
function aiiqLoadHistory() {
  try {
    const raw = localStorage.getItem('aiiqChatHistory');
    if (!raw) return;
    const items = JSON.parse(raw);
    items.forEach(m => aiiqAppendMessage(m.text, m.who));
  } catch {}
}

if (aiiqToggle && aiiqPanel) {
  aiiqLoadHistory();
  aiiqToggle.addEventListener('click', () => {
    const isOpen = aiiqPanel.classList.contains('open');
    if (isOpen) aiiqClosePanel(); else aiiqOpen();
  });
}
if (aiiqClose) {
  aiiqClose.addEventListener('click', () => aiiqClosePanel());
}
if (aiiqForm && aiiqInput) {
  aiiqForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = aiiqInput.value.trim();
    if (!text) return;
    aiiqAppendMessage(text, 'user');
    aiiqInput.value = '';
    aiiqSaveHistory();
    (async () => {
      // Prefer NexaAI if available
      if (window.NexaAI && typeof window.NexaAI.answerQuestion === 'function') {
        const reply = await window.NexaAI.answerQuestion(text);
        aiiqAppendMessage(reply, 'ai');
        aiiqSaveHistory();
        return;
      }
      // Fallback stub
      setTimeout(() => {
        const reply = aiiqGenerateStubReply(text);
        aiiqAppendMessage(reply, 'ai');
        aiiqSaveHistory();
      }, 500);
    })();
  });
}

function aiiqGenerateStubReply(userText) {
  const t = userText.toLowerCase();
  if (t.includes('qbid')) return 'I can help query QBIDs: try typing a QBID id to locate its blocks and related slabs.';
  if (t.includes('block')) return 'Blocks link QBIDs to slabs. You can open Blocks view and filter by block id.';
  if (t.includes('slab') || t.includes('slid')) return 'To inspect slabs (SLIDs), open Slabs and use the search to drill into finish or dispatch info.';
  if (t.includes('dispatch')) return 'Dispatches track shipments. Try the Dispatches view to review bundles/containers for recent orders.';
  if (t.includes('export') || t.includes('excel')) return 'Use the Export option in grid toolbars to download data as Excel via SheetJS.';
  return 'Nexa is in preview. Ask about QBIDs, Blocks, Slabs, Tiles, or Dispatches, and I’ll point you to the right view or filter.';
}

// Nexa summary panel wiring
const nexaSummaryEl = document.getElementById('nexa-summary');
const nexaBody = nexaSummaryEl && nexaSummaryEl.querySelector('.nexa-summary-body');
// About panel element
const nexaAboutEl = document.getElementById('nexa-about');

// Simple toast helper (defined early so callers can use it)
function showToast(message, timeout = 3000) {
  try {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.position = 'fixed';
      container.style.right = '12px';
      container.style.bottom = '12px';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.gap = '6px';
      container.style.zIndex = '99999';
      document.body.appendChild(container);
    }
    const t = document.createElement('div');
    t.className = 'toast info';
    t.textContent = message;
    t.style.opacity = '0';
    t.style.transition = 'opacity 160ms ease-in-out';
    container.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '0.95'; });
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 220);
    }, timeout);
  } catch (e) {
    console.warn('toast failed', e);
  }
}
try { if (typeof window !== 'undefined') window.showToast = showToast; } catch (e) {}

function openNexaAbout() {
  if (!nexaAboutEl) return;
  nexaAboutEl.removeAttribute('hidden');
  // hide badge menu/summary when showing modal
  try { if (nexaSummaryEl) nexaSummaryEl.setAttribute('hidden',''); } catch(e) {}
  document.body.style.overflow = 'hidden';
}
function closeNexaAbout() {
  if (!nexaAboutEl) return;
  nexaAboutEl.setAttribute('hidden','');
  document.body.style.overflow = '';
}
// close about on outside click or Escape
if (nexaAboutEl) {
  nexaAboutEl.addEventListener('click', (ev) => {
    if (ev.target === nexaAboutEl) closeNexaAbout();
  });
  const abClose = nexaAboutEl.querySelector('.nexa-about-close');
  if (abClose) abClose.addEventListener('click', () => closeNexaAbout());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNexaAbout(); });
}

async function loadNexaSummary() {
  if (!nexaBody || !nexaSummaryEl) return;
  // show loading state and reveal summary immediately
  nexaBody.textContent = 'Loading Nexa summary…';
  nexaSummaryEl.removeAttribute('hidden');
  try {
    if (window.NexaAI && typeof window.NexaAI.summarizeInventory === 'function') {
      const s = await window.NexaAI.summarizeInventory();
      if (s && s.message) {
        nexaBody.textContent = s.message;
      } else {
        nexaBody.textContent = (s && JSON.stringify(s)) || 'Nexa: no summary available.';
        showToast('Nexa: no summary available.');
      }
    } else {
      nexaBody.textContent = 'Nexa not available.';
      showToast('Nexa not available.');
      return;
    }
  } catch (err) {
    showToast('Error loading Nexa summary.');
    nexaBody.textContent = 'Error loading Nexa summary.';
    return;
  }
  try { positionNexaSummary(); } catch (e) {}
}

async function showNexaInsights() {
  if (!nexaBody || !nexaSummaryEl) return;
  nexaBody.textContent = 'Loading insights…';
  nexaSummaryEl.removeAttribute('hidden');
  try {
    if (window.NexaAI && typeof window.NexaAI.recommendReorder === 'function') {
      const rec = await window.NexaAI.recommendReorder({ thresholdDays:30, minQty:5 });
      if (!rec || !Array.isArray(rec.recommendations) || !rec.recommendations.length) {
        nexaBody.textContent = rec && rec.message ? rec.message : 'No reorder recommendations found.';
        showToast('No reorder recommendations found.');
        try { positionNexaSummary(); } catch (e) {}
        return;
      }
      // render list (handle both old and new recommendation shapes)
      const list = document.createElement('ul');
      list.style.margin = '6px 0 0 18px';
      rec.recommendations.slice(0,50).forEach(r => {
        const id = r.key || r.id || r.slid || r.qbid || '(unknown)';
        const stock = r.stock ?? r.qty ?? 'n/a';
        const suggested = r.suggested ?? r.reorderQty ?? 'n/a';
        const extra = r.daysSince ? ` — ${r.daysSince} days since movement` : (r.avgDaily ? ` — avg/day:${r.avgDaily}` : '');
        const li = document.createElement('li');
        li.textContent = `${id} — stock: ${stock} — suggested: ${suggested}${extra}`;
        list.appendChild(li);
      });
      nexaBody.textContent = '';
      nexaBody.appendChild(list);
      try { positionNexaSummary(); } catch (e) {}
    } else {
      nexaBody.textContent = 'Nexa insights not available.';
      showToast('Nexa insights not available.');
    }
  } catch (err) {
    showToast('Error loading insights.');
    nexaBody.textContent = 'Error loading insights.';
  }
}

// Render inventory visibility into the summary card
async function renderVisibility() {
  if (!nexaBody || !nexaSummaryEl) return;
  nexaBody.textContent = 'Loading visibility…';
  try {
    if (window.NexaAI && typeof window.NexaAI.inventoryVisibility === 'function') {
      const v = await window.NexaAI.inventoryVisibility();
      nexaBody.textContent = '';
      const hdr = document.createElement('div');
      hdr.textContent = `Slabs: ${v.totalCount} — Estimated value $${v.totalValue}`;
      hdr.style.fontWeight = '600';
      nexaBody.appendChild(hdr);
      const list = document.createElement('div');
      list.style.marginTop = '8px';
      const byTh = document.createElement('div');
      byTh.innerHTML = `<strong>By thickness:</strong> ${Object.entries(v.byThickness||{}).slice(0,8).map(([k,val])=>`${k}: ${val}`).join(', ')}`;
      const byF = document.createElement('div');
      byF.innerHTML = `<strong>By finish:</strong> ${Object.entries(v.byFinish||{}).slice(0,8).map(([k,val])=>`${k}: ${val}`).join(', ')}`;
      list.appendChild(byTh);
      list.appendChild(byF);
      nexaBody.appendChild(list);
    } else {
      showToast('Visibility not available.');
      if (nexaSummaryEl) nexaSummaryEl.setAttribute('hidden', '');
    }
  } catch (e) {
    showToast('Error loading visibility.');
    if (nexaSummaryEl) nexaSummaryEl.setAttribute('hidden', '');
  }
  nexaSummaryEl.removeAttribute('hidden');
  try { positionNexaSummary(); } catch (e) {}
}

// Render reorder suggestions into the summary card
async function renderReorder() {
  if (!nexaBody || !nexaSummaryEl) return;
  nexaBody.textContent = 'Loading reorder suggestions…';
  try {
    if (window.NexaAI && typeof window.NexaAI.recommendReorder === 'function') {
      const rec = await window.NexaAI.recommendReorder({ thresholdDays:30, minQty:5 });
      if (!rec.recommendations || !rec.recommendations.length) {
        showToast('No reorder recommendations found.');
        if (nexaSummaryEl) nexaSummaryEl.setAttribute('hidden', '');
        return;
      }
      nexaBody.textContent = '';
      const list = document.createElement('ol');
      list.style.margin = '6px 0 0 18px';
      rec.recommendations.slice(0,20).forEach(r => {
        const li = document.createElement('li');
        li.textContent = `${r.key || r.id || '(unknown)'} — stock:${r.stock ?? 'n/a'} — suggested:${r.suggested ?? r.qty ?? 'n/a'}`;
        list.appendChild(li);
      });
      nexaBody.appendChild(list);
    } else {
      showToast('Reorder suggestions not available.');
      if (nexaSummaryEl) nexaSummaryEl.setAttribute('hidden', '');
    }
  } catch (e) {
    showToast('Error loading reorders.');
    if (nexaSummaryEl) nexaSummaryEl.setAttribute('hidden', '');
  }
  nexaSummaryEl.removeAttribute('hidden');
  try { positionNexaSummary(); } catch (e) {}
}

// Render slow-moving items into the summary card
async function renderSlowMoving() {
  if (!nexaBody || !nexaSummaryEl) return;
  nexaBody.textContent = 'Loading slow-moving items…';
  try {
    if (window.NexaAI && typeof window.NexaAI.detectSlowMoving === 'function') {
      const res = await window.NexaAI.detectSlowMoving(90);
      if (!res.count) {
        showToast('No slow-moving items detected.');
        if (nexaSummaryEl) nexaSummaryEl.setAttribute('hidden', '');
        return;
      }
      nexaBody.textContent = '';
      const p = document.createElement('div');
      p.textContent = `Detected ${res.count} slow-moving items.`;
      p.style.fontWeight = '600';
      nexaBody.appendChild(p);
      const list = document.createElement('ul');
      list.style.margin = '6px 0 0 18px';
      res.slow.slice(0,30).forEach(s => {
        const li = document.createElement('li');
        li.textContent = `${s.id} — ${s.daysSince ?? 'n/a'} days since movement`;
        list.appendChild(li);
      });
      nexaBody.appendChild(list);
    } else {
      showToast('Slow-moving detection not available.');
      if (nexaSummaryEl) nexaSummaryEl.setAttribute('hidden', '');
    }
  } catch (e) {
    showToast('Error loading slow-moving items.');
    if (nexaSummaryEl) nexaSummaryEl.setAttribute('hidden', '');
  }
  nexaSummaryEl.removeAttribute('hidden');
  try { positionNexaSummary(); } catch (e) {}
}

// Positioning helper: keeps the summary on-screen and flips to left when needed
function positionNexaSummary() {
  if (!nexaSummaryEl) return;
  if (nexaSummaryEl.hasAttribute('hidden')) return;
  const container = nexaBadge ? nexaBadge.parentElement : null;
  if (!container) return;
  // measure
  const badgeRect = container.getBoundingClientRect();
  // ensure the element has size by forcing a layout read
  nexaSummaryEl.style.position = 'fixed';
  nexaSummaryEl.style.transform = 'none';
  nexaSummaryEl.style.top = '0px';
  nexaSummaryEl.style.left = '0px';
  const summaryRect = nexaSummaryEl.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const margin = 12;
  // decide flip
  nexaSummaryEl.classList.remove('flip-left');
  const fitsRight = (viewportW - badgeRect.right - margin) >= summaryRect.width;
  const fitsLeft = (badgeRect.left - margin) >= summaryRect.width;
  const useLeft = !fitsRight && fitsLeft;
  // compute top to vertically center on badge, clamped to viewport
  const desiredTop = Math.round(badgeRect.top + (badgeRect.height / 2) - (summaryRect.height / 2));
  const topClamped = Math.max(8, Math.min(desiredTop, viewportH - summaryRect.height - 8));
  if (useLeft) {
    nexaSummaryEl.classList.add('flip-left');
    const left = Math.round(badgeRect.left - summaryRect.width - margin);
    nexaSummaryEl.style.left = `${left}px`;
    nexaSummaryEl.style.right = 'auto';
  } else {
    const left = Math.round(badgeRect.right + margin);
    nexaSummaryEl.style.left = `${left}px`;
    nexaSummaryEl.style.right = 'auto';
  }
  nexaSummaryEl.style.top = `${topClamped}px`;
}

window.addEventListener('resize', () => { try { positionNexaSummary(); } catch (e) {} });
window.addEventListener('scroll', () => { try { positionNexaSummary(); } catch (e) {} }, true);

// Note: summary/actions are triggered via the Nexa badge menu; no static buttons.

// Do not auto-load Nexa summary on page load; show only on hover or click via the badge menu

// Nexa badge menu wiring
const nexaBadge = document.getElementById('nexa-badge');
const nexaBadgeMenu = document.getElementById('nexa-badge-menu');
if (nexaBadge && nexaBadgeMenu) {
  const container = nexaBadge.parentElement;
  const closeMenu = () => {
    container.classList.remove('open');
    nexaBadgeMenu.setAttribute('hidden', '');
    nexaBadge.setAttribute('aria-expanded', 'false');
    // also hide the summary when menu is closed
    try {
      if (nexaSummaryEl) {
        nexaSummaryEl.setAttribute('hidden', '');
        nexaSummaryEl.classList.remove('flip-left');
        nexaSummaryEl.style.left = '';
        nexaSummaryEl.style.right = '';
        nexaSummaryEl.style.top = '';
      }
    } catch (e) {}
  };
  const openMenu = () => {
    container.classList.add('open');
    nexaBadgeMenu.removeAttribute('hidden');
    nexaBadge.setAttribute('aria-expanded', 'true');
    const first = nexaBadgeMenu.querySelector('button[role="menuitem"]');
    first && first.focus();
  };

  // click toggles persistent open state
  nexaBadge.addEventListener('click', (e) => {
    e.stopPropagation();
    if (container.classList.contains('open')) closeMenu(); else openMenu();
  });

  // clicking a menu item triggers its action and closes persistent state
  nexaBadgeMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = e.target.closest('button[role="menuitem"]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    closeMenu();
    if (action === 'open-chat') {
      if (typeof aiiqOpen === 'function') aiiqOpen();
      else if (aiiqToggle) aiiqToggle.click();
    } else if (action === 'show-summary') {
      loadNexaSummary();
    } else if (action === 'show-insights') {
      showNexaInsights();
    } else if (action === 'show-visibility') {
      renderVisibility();
    } else if (action === 'show-reorder') {
      renderReorder();
    } else if (action === 'show-slow') {
      renderSlowMoving();
    } else if (action === 'show-about') {
      // open the about panel
      try { openNexaAbout(); } catch (e) { console.warn(e); }
    }
  });

  // hover behavior: show on hover (CSS handles visibility) but manage aria/hidden for screen readers
  container.addEventListener('mouseenter', () => {
    // if not persistently open, reveal for accessibility
    if (!container.classList.contains('open')) {
      nexaBadgeMenu.removeAttribute('hidden');
      nexaBadge.setAttribute('aria-expanded', 'true');
    }
  });
  container.addEventListener('mouseleave', () => {
    if (!container.classList.contains('open')) {
      nexaBadgeMenu.setAttribute('hidden', '');
      nexaBadge.setAttribute('aria-expanded', 'false');
      // hide summary when moving away from the badge/menu
      try { if (nexaSummaryEl) nexaSummaryEl.setAttribute('hidden', ''); } catch(e) {}
    }
  });

  // close persistent menu on outside click or Escape
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  // show summary/insights on menu item hover (temporary while hovering)
  const showSummaryItem = nexaBadgeMenu.querySelector('button[data-action="show-summary"]');
  const showInsightsItem = nexaBadgeMenu.querySelector('button[data-action="show-insights"]');
  const showVisibilityItem = nexaBadgeMenu.querySelector('button[data-action="show-visibility"]');
  const showReorderItem = nexaBadgeMenu.querySelector('button[data-action="show-reorder"]');
  const showSlowItem = nexaBadgeMenu.querySelector('button[data-action="show-slow"]');
  let hoverHideTimer = null;
  if (showSummaryItem) {
    showSummaryItem.addEventListener('mouseenter', () => {
      clearTimeout(hoverHideTimer);
      loadNexaSummary();
    });
    showSummaryItem.addEventListener('mouseleave', () => {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = setTimeout(() => {
        if (!container.classList.contains('open') && nexaSummaryEl) nexaSummaryEl.setAttribute('hidden', '');
      }, 300);
    });
  }
  if (showInsightsItem) {
    showInsightsItem.addEventListener('mouseenter', () => {
      clearTimeout(hoverHideTimer);
      showNexaInsights();
    });
    showInsightsItem.addEventListener('mouseleave', () => {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = setTimeout(() => {
        if (!container.classList.contains('open') && nexaSummaryEl) nexaSummaryEl.setAttribute('hidden', '');
      }, 300);
    });
  }
  if (showVisibilityItem) {
    showVisibilityItem.addEventListener('mouseenter', () => {
      clearTimeout(hoverHideTimer);
      renderVisibility();
    });
    showVisibilityItem.addEventListener('mouseleave', () => {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = setTimeout(() => {
        if (!container.classList.contains('open') && nexaSummaryEl) nexaSummaryEl.setAttribute('hidden', '');
      }, 300);
    });
  }
  if (showReorderItem) {
    showReorderItem.addEventListener('mouseenter', () => {
      clearTimeout(hoverHideTimer);
      renderReorder();
    });
    showReorderItem.addEventListener('mouseleave', () => {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = setTimeout(() => {
        if (!container.classList.contains('open') && nexaSummaryEl) nexaSummaryEl.setAttribute('hidden', '');
      }, 300);
    });
  }
  if (showSlowItem) {
    showSlowItem.addEventListener('mouseenter', () => {
      clearTimeout(hoverHideTimer);
      renderSlowMoving();
    });
    showSlowItem.addEventListener('mouseleave', () => {
      clearTimeout(hoverHideTimer);
      hoverHideTimer = setTimeout(() => {
        if (!container.classList.contains('open') && nexaSummaryEl) nexaSummaryEl.setAttribute('hidden', '');
      }, 300);
    });
  }
}
