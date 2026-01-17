const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const http = require('http');
const https = require('https');
const multer = require('multer');
const Jimp = require('jimp');
const QrCode = require('qrcode-reader');
const db = require('./db');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 4001;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 6 * 1024 * 1024
  }
});

app.get('/', (req, res) => {
  res.json({ service: 'modernex-inventory', version: '0.1.0' });
});

// QR code generator (server-side fallback for Labels view)
app.get('/api/qr', async (req, res) => {
  try {
    const text = String(req.query.text || '');
    if (!text.trim()) return res.status(400).json({ error: 'text query param required' });

    const size = Math.max(64, Math.min(512, Number(req.query.size || 128) || 128));
    const margin = Math.max(0, Math.min(8, Number(req.query.margin || 1) || 1));
    const ec = String(req.query.ec || 'M').toUpperCase();
    const errorCorrectionLevel = ['L', 'M', 'Q', 'H'].includes(ec) ? ec : 'M';

    const svg = await QRCode.toString(text, {
      type: 'svg',
      width: size,
      margin,
      errorCorrectionLevel
    });

    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

// QR decoder (server-side) for mobile HTTP fallback: capture/select an image and decode.
app.post('/api/qr/decode', upload.single('image'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'image file is required (multipart/form-data field: image)' });
    }

    const img = await Jimp.read(req.file.buffer);
    const qr = new QrCode();
    const decoded = await new Promise((resolve, reject) => {
      qr.callback = (err, value) => {
        if (err) return reject(err);
        resolve(value);
      };
      try {
        qr.decode(img.bitmap);
      } catch (e) {
        reject(e);
      }
    });

    const text = decoded && (decoded.result || decoded.text || decoded.data || decoded.rawValue);
    if (!text || !String(text).trim()) {
      return res.status(422).json({ error: 'No QR code detected in image' });
    }

    return res.json({ text: String(text) });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

// Utility helpers for ID generation and material normalization
function slugAlphaUpper(s) {
  return String(s || '').replace(/[^A-Za-z]/g, '').toUpperCase();
}

function materialShort(name) {
  // Material short-code used across IDs.
  // Rule (matches examples): first 3 letters of first word + first letter of second word.
  // - "Paradiso Multi"   -> PARM
  // - "Paradiso Classic" -> PARC
  // - "Kuppam Green"     -> KUPG
  // Fallback: first 4 letters of first word.
  const raw = String(name || '').trim();
  if (!raw) return 'MAT';
  const parts = raw.split(/[\s,/_-]+/).map(s => s.trim()).filter(Boolean);
  const w1 = slugAlphaUpper(parts[0] || '');
  const w2 = slugAlphaUpper(parts[1] || '');
  const a = w1.slice(0, 3);
  const b = w2 ? w2.slice(0, 1) : w1.slice(3, 4);
  const out = (a + b).slice(0, 4);
  return out || 'MAT';
}

function materialShortLower(name) {
  // Lowercased version of materialShort(). Keep [a-z0-9] only.
  const up = materialShort(name);
  const cleaned = String(up || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned || 'mat';
}

function stripQbidPrefix(qbid) {
  // Works for legacy (QBID-XXXX) and new (qbid-xxxx-00001) formats.
  return String(qbid || '').replace(/^QBID-/i, '').trim();
}

function parseNewQbid(qbid) {
  // qbid-<short>-<seq>
  const m = String(qbid || '').trim().match(/^qbid-([a-z0-9]{1,12})-(\d{1,})$/i);
  if (!m) return null;
  const short = String(m[1] || '').toLowerCase();
  const seqNum = Number(m[2]);
  if (!Number.isFinite(seqNum) || seqNum < 0) return null;
  return { short, seqNum };
}

function pad(num, size = 4) {
  const n = Number(num) || 0;
  return String(n).padStart(size, '0');
}

function nextQbidForMaterial(matShortLowerVal) {
  const short = String(matShortLowerVal || '').trim().toLowerCase() || 'mat';
  const like = `qbid-${short}-%`;
  const rows = db.prepare('SELECT qbid FROM qbids WHERE LOWER(qbid) LIKE ?').all(like);
  let max = 0;
  for (const r of rows) {
    const p = parseNewQbid(r.qbid);
    if (p && p.short === short && Number(p.seqNum) > max) max = Number(p.seqNum);
  }
  return `qbid-${short}-${pad(max + 1, 5)}`;
}

function nextBlockIdForQbid(qbid, index1Based) {
  const parsed = parseNewQbid(qbid);
  if (!parsed) return null;
  const base = stripQbidPrefix(qbid).toUpperCase(); // e.g. PARM-00001
  return `BLK-${base}-${pad(index1Based, 3)}`;
}

function nextBlockIdForQbidLetter(qbid, index1Based) {
  const parsed = parseNewQbid(qbid);
  if (!parsed) return null;
  const base = stripQbidPrefix(qbid).toUpperCase(); // e.g. PARM-00001
  return `BLK-${base}-${numberToLetters(index1Based)}`;
}

function parseNewBlockId(blockId) {
  // Supports:
  // - BLK-<MATSHORT-SEQ>-<BBB>  (legacy numeric)
  // - BLK-<MATSHORT-SEQ>-<A|B|...|AA|AB|...> (new letter)
  const raw = String(blockId || '').trim();
  const m = raw.match(/^BLK-([A-Z0-9]{1,20}-\d{1,})-((\d{3})|([A-Z]{1,6}))$/);
  if (!m) return null;
  const suffix = String(m[2] || '');
  if (/^\d{3}$/.test(suffix)) return { base: m[1], blockSeq: Number(suffix) };
  // letters -> 1-based index (A=1, Z=26, AA=27, ...)
  let n = 0;
  for (const ch of suffix) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) return null;
    n = (n * 26) + (code - 64);
  }
  return { base: m[1], blockSeq: n };
}

function nextSlidForBlock(blockId, qbidForBlock) {
  const qParsed = parseNewQbid(qbidForBlock);
  const bParsed = parseNewBlockId(blockId);
  if (!qParsed || !bParsed) return null;
  // Keep SLID- prefix to stay compatible with existing UI routing.
  const prefix = `SLID-${bParsed.base}-${pad(bParsed.blockSeq, 3)}-`;
  const rows = db.prepare('SELECT slid FROM slabs WHERE block_id = ? AND UPPER(slid) LIKE ?').all(blockId, (prefix + '%').toUpperCase());
  let max = 0;
  for (const r of rows) {
    const mm = String(r.slid || '').toUpperCase().match(new RegExp('^' + prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '(\\d{3})$'));
    if (mm && mm[1]) {
      const n = Number(mm[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${prefix}${pad(max + 1, 3)}`;
}

function ensureMaterial(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  const row = db.prepare('SELECT id FROM materials WHERE name = ?').get(n);
  if (row && row.id) return row.id;
  const short = materialShort(n);
  const stmt = db.prepare('INSERT INTO materials (name, description, short_code) VALUES (?, ?, ?)');
  const info = stmt.run(n, null, short);
  if (info.changes > 0) {
    const created = db.prepare('SELECT id FROM materials WHERE name = ?').get(n);
    return created ? created.id : null;
  }
  return null;
}

function numberToLetters(n) {
  let num = Math.max(1, Number(n) || 1);
  let out = '';
  while (num > 0) {
    num--; // 1-based
    out = String.fromCharCode(65 + (num % 26)) + out;
    num = Math.floor(num / 26);
  }
  return out;
}

function nextLetterIndexForParent(matShort, parentQbid) {
  // Use existing child count to derive next index
  const row = db.prepare('SELECT COUNT(1) as cnt FROM parent_child WHERE parent_qbid = ?').get(parentQbid);
  const cnt = row ? Number(row.cnt || 0) : 0;
  return cnt + 1;
}

function generateBlockIdLetter(matShort, parentQbid, index) {
  const parentPart = stripQbidPrefix(parentQbid).toUpperCase();
  const letters = numberToLetters(index || 1);
  return `${matShort}-${parentPart}-BLOCK-${letters}`;
}

function generateBlockIdForParent(prefix, parentQbid) {
  const parentPart = stripQbidPrefix(parentQbid).toUpperCase();
  // Find existing max sequence for this prefix + parent
  const likeStr = `${prefix.toUpperCase()}-${parentPart}-`;
  const rows = db.prepare('SELECT block_id FROM blocks WHERE parent_qbid = ? AND block_id LIKE ?').all(parentQbid, likeStr + '%');
  let maxSeq = 0;
  for (const r of rows) {
    const m = String(r.block_id || '').match(/^(.*-)?(\d{1,})$/);
    if (m && m[2]) {
      const v = Number(m[2]);
      if (!isNaN(v) && v > maxSeq) maxSeq = v;
    }
  }
  const next = maxSeq + 1;
  return `${likeStr}${pad(next)}`;
}

function generateBlockId(prefix) {
  const pre = String(prefix || 'PAR-BLOCK').toUpperCase();
  const rows = db.prepare('SELECT block_id FROM blocks WHERE block_id LIKE ?').all(pre + '-%');
  let maxSeq = 0;
  for (const r of rows) {
    const m = String(r.block_id || '').match(/^(.*-)?(\d{1,})$/);
    if (m && m[2]) {
      const v = Number(m[2]);
      if (!isNaN(v) && v > maxSeq) maxSeq = v;
    }
  }
  const next = maxSeq + 1;
  return `${pre}-${pad(next)}`;
}

function toNum(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function normalizeStoneType(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s || null;
}

// Densities are approximate and used for estimating weight from volume.
// Units: kg per m^3
const STONE_DENSITY_KG_M3 = {
  granite: 2700,
  marble: 2710,
  quartz: 2650,
  quartzite: 2650,
  limestone: 2500,
  travertine: 2500,
  sandstone: 2300,
  slate: 2800,
  basalt: 3000,
  gabbro: 3000
};

function densityKgM3ForStoneType(stoneType) {
  const key = normalizeStoneType(stoneType);
  if (!key) return null;
  const v = STONE_DENSITY_KG_M3[key];
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

function parseSizeMmTriplet(sizeMm) {
  const raw = String(sizeMm ?? '').trim();
  if (!raw) return null;
  // Accept: 2000x1200x1500, 2000 x 1200 x 1500, 2000×1200×1500
  const cleaned = raw.replace(/\s+/g, '');
  const parts = cleaned.split(/(?:x|×|\*)/i).filter(Boolean);
  if (parts.length !== 3) return null;
  const nums = parts.map(p => Number(p));
  if (nums.some(n => !Number.isFinite(n) || n <= 0)) return null;
  return { length_mm: nums[0], width_mm: nums[1], height_mm: nums[2] };
}

function computeWeightKgFromSizeMmAndStoneType(sizeMm, stoneType) {
  const dims = parseSizeMmTriplet(sizeMm);
  const density = densityKgM3ForStoneType(stoneType);
  if (!dims || !density) return null;
  const volume_m3 = (dims.length_mm * dims.width_mm * dims.height_mm) / 1e9;
  if (!Number.isFinite(volume_m3) || volume_m3 <= 0) return null;
  const weight_kg_raw = volume_m3 * density;
  if (!Number.isFinite(weight_kg_raw) || weight_kg_raw <= 0) return null;
  // Store a clean numeric estimate; keep as whole kg to avoid tiny floating noise.
  const weight_kg = Math.round(weight_kg_raw);
  return { weight_kg, volume_m3, density_kg_m3: density };
}

function sumCosts(g, t, o) {
  const gv = toNum(g) || 0;
  const tv = toNum(t) || 0;
  const ov = toNum(o) || 0;
  return gv + tv + ov;
}

// Serve admin UI (dev: disable caching so browsers pick up changes immediately)
app.use('/ui', express.static(path.join(__dirname, 'ui'), {
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
  }
}));

// API list endpoints for UI
app.get('/api/qbids', (req, res) => {
  const rows = db.prepare('SELECT q.*, m.name as material_name, COALESCE(s.name, q.supplier) as supplier_name FROM qbids q LEFT JOIN materials m ON q.material_id = m.id LEFT JOIN suppliers s ON q.supplier_id = s.id ORDER BY received_date DESC').all();
  res.json(rows);
});

// QBIDs eligible for block generation (only those with remaining capacity)
app.get('/api/qbids-eligible-block-generation', (req, res) => {
  const rows = db.prepare(`
    SELECT
      q.*, m.name as material_name, COALESCE(s.name, q.supplier) as supplier_name,
      COALESCE(bc.cnt, 0) as generated_blocks,
      (COALESCE(q.splitable_blk_count, 0) - COALESCE(bc.cnt, 0)) as remaining_blocks
    FROM qbids q
    LEFT JOIN (
      SELECT parent_qbid, COUNT(1) as cnt
      FROM blocks
      WHERE parent_qbid IS NOT NULL
      GROUP BY parent_qbid
    ) bc ON bc.parent_qbid = q.qbid
    LEFT JOIN materials m ON q.material_id = m.id
    LEFT JOIN suppliers s ON q.supplier_id = s.id
    WHERE COALESCE(q.splitable_blk_count, 0) >= 1
      AND (COALESCE(q.splitable_blk_count, 0) - COALESCE(bc.cnt, 0)) > 0
    ORDER BY q.received_date DESC
  `).all();
  res.json(rows);
});

// materials list
app.get('/api/materials', (req, res) => {
  const rows = db.prepare('SELECT * FROM materials ORDER BY name').all();
  res.json(rows);
});

// suppliers list + CRUD
app.get('/api/suppliers', (req, res) => {
  const rows = db.prepare('SELECT * FROM suppliers ORDER BY name').all();
  res.json(rows);
});

app.post('/suppliers', (req, res) => {
  const { name, contact, notes, address, phone, email, material, quarry_location } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const stmt = db.prepare('INSERT OR IGNORE INTO suppliers (name, contact, material, quarry_location, notes, address, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const info = stmt.run(name, contact || null, material || null, quarry_location || null, notes || null, address || null, phone || null, email || null);
  const row = db.prepare('SELECT * FROM suppliers WHERE name = ?').get(name);
  res.status(201).json(row || { id: null });
});

app.put('/suppliers/:id', (req, res) => {
  const { id } = req.params; const { name, contact, notes, address, phone, email, material, quarry_location } = req.body;
  const exists = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'not found' });
  const stmt = db.prepare('UPDATE suppliers SET name = COALESCE(?, name), contact = COALESCE(?, contact), material = COALESCE(?, material), quarry_location = COALESCE(?, quarry_location), notes = COALESCE(?, notes), address = COALESCE(?, address), phone = COALESCE(?, phone), email = COALESCE(?, email) WHERE id = ?');
  stmt.run(name || null, contact || null, material || null, quarry_location || null, notes || null, address || null, phone || null, email || null, id);
  const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  res.json(row);
});

app.delete('/suppliers/:id', (req, res) => {
  const { id } = req.params;
  const ref = db.prepare('SELECT COUNT(1) as cnt FROM qbids WHERE supplier_id = ?').get(id);
  if (ref && ref.cnt > 0) return res.status(400).json({ error: 'Supplier in use by QBIDs' });
  const stmt = db.prepare('DELETE FROM suppliers WHERE id = ?');
  const info = stmt.run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: id });
});

app.get('/api/blocks', (req, res) => {
  // return blocks with material_name and computed codes when missing
  const rows = db.prepare(`SELECT b.*, q.qbid as parent_qbid, q.material_type, m.name as material_name
    FROM blocks b
    LEFT JOIN qbids q ON b.parent_qbid = q.qbid
    LEFT JOIN materials m ON q.material_id = m.id
    ORDER BY b.block_id`).all();

  const out = rows.map(r => {
    const block = Object.assign({}, r);
    // ensure material present
    const mat = r.material || r.material_name || r.material_type || null;
    // legacy local/global codes removed; material fallback only
    if (!block.material && mat) block.material = mat;
    return block;
  });
  res.json(out);
});

app.get('/api/slabs', (req, res) => {
  const rows = db.prepare('SELECT * FROM slabs ORDER BY slid').all();
  res.json(rows);
});

// Fetch a single slab by SLID
app.get('/slabs/:slid', (req, res) => {
  const slidParam = String(req.params.slid || '').trim().toUpperCase();
  const row = db.prepare('SELECT * FROM slabs WHERE UPPER(TRIM(slid)) = ?').get(slidParam);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// Derived product list endpoints
app.get('/api/tiles', (req, res) => {
  const rows = db.prepare('SELECT * FROM tiles ORDER BY tile_id').all();
  res.json(rows);
});

app.get('/api/cobbles', (req, res) => {
  const rows = db.prepare('SELECT * FROM cobbles ORDER BY cobble_id').all();
  res.json(rows);
});

app.get('/api/monuments', (req, res) => {
  const rows = db.prepare('SELECT * FROM monuments ORDER BY monument_id').all();
  res.json(rows);
});

app.get('/api/pavers', (req, res) => {
  const rows = db.prepare('SELECT * FROM pavers ORDER BY paver_id').all();
  res.json(rows);
});

app.get('/api/events', (req, res) => {
  const rows = db.prepare('SELECT * FROM events ORDER BY created_at DESC').all();
  res.json(rows);
});

app.get('/api/dispatches', (req, res) => {
  const rows = db.prepare('SELECT * FROM dispatches ORDER BY dispatched_at DESC').all();
  res.json(rows);
});

// Update QBID
app.put('/qbids/:qbid', (req, res) => {
  const { qbid } = req.params;
  console.log('PUT /qbids body:', req.body);
  try { fs.writeFileSync('/tmp/last_put_qbid.json', JSON.stringify({ qbid, body: req.body }, null, 2)); } catch (e) { console.error('failed writing debug file', e && e.message); }
  const { supplier, supplier_id, quarry, weight_kg, size_mm, grade, received_date, material_type, material_id, splitable_blk_count, stone_type, gross_cost, transport_cost, other_cost } = req.body;
  const existing = db.prepare('SELECT * FROM qbids WHERE qbid = ?').get(qbid);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const childBlocksRow = db.prepare('SELECT COUNT(1) as cnt FROM blocks WHERE parent_qbid = ?').get(qbid);
  const hasBlocks = childBlocksRow && Number(childBlocksRow.cnt) > 0;
  const childSlabsRow = db.prepare('SELECT COUNT(1) as cnt FROM slabs WHERE block_id IN (SELECT block_id FROM blocks WHERE parent_qbid = ?)').get(qbid);
  const hasSlabs = childSlabsRow && Number(childSlabsRow.cnt) > 0;
  // Lock some QBID updates once children (blocks) or slabs exist.
  // Allow updating cost-related fields even when locked.
  if (hasBlocks || hasSlabs) {
    // Determine requested keys from body
    const requestedKeys = Object.keys(req.body || {}).map(k => String(k));
    const allowedWhenLocked = new Set(['gross_cost', 'transport_cost', 'other_cost', 'total_cost']);
    // If request contains any non-allowed keys, reject
    const nonAllowed = requestedKeys.filter(k => !allowedWhenLocked.has(k));
    if (nonAllowed.length > 0) {
      return res.status(400).json({ error: 'QBID updates are locked once child blocks/slabs exist; only cost fields may be updated', blocked_fields: nonAllowed });
    }
    // Proceed to update only provided cost fields (compute total server-side for consistency)
    const fields = [];
    const vals = [];
    const g = toNum(req.body.gross_cost);
    const t = toNum(req.body.transport_cost);
    const o = toNum(req.body.other_cost);
    // if any of the cost values are present, include them
    if (typeof req.body.gross_cost !== 'undefined') { fields.push('gross_cost = ?'); vals.push(isFinite(g) ? g : null); }
    if (typeof req.body.transport_cost !== 'undefined') { fields.push('transport_cost = ?'); vals.push(isFinite(t) ? t : null); }
    if (typeof req.body.other_cost !== 'undefined') { fields.push('other_cost = ?'); vals.push(isFinite(o) ? o : null); }
    // compute total and always update total_cost when any component provided
    if (fields.length > 0) {
      const total = sumCosts(g, t, o);
      fields.push('total_cost = ?'); vals.push(isFinite(total) ? total : null);
      const sql = `UPDATE qbids SET ${fields.join(', ')} WHERE qbid = ?`;
      const stmt = db.prepare(sql);
      stmt.run(...vals, qbid);
      return res.json({ updated: qbid });
    }
    // nothing to update
    return res.status(400).json({ error: 'No updatable cost fields provided' });
  }

  // if material_type supplied but no material_id, ensure material row
  let mid = material_id || null;
  if (!mid && material_type) mid = ensureMaterial(material_type);

  // Auto-calc weight_kg when caller didn't provide it, based on stone_type + size_mm
  const hasWeight = Object.prototype.hasOwnProperty.call(req.body || {}, 'weight_kg');
  const hasSize = Object.prototype.hasOwnProperty.call(req.body || {}, 'size_mm');
  const hasStone = Object.prototype.hasOwnProperty.call(req.body || {}, 'stone_type');
  const mergedSizeMm = hasSize ? (size_mm ?? null) : (existing.size_mm ?? null);
  const mergedStoneType = hasStone ? (stone_type ?? null) : (existing.stone_type ?? null);
  let weightParam = hasWeight ? toNum(weight_kg) : null;
  const existingWeight = toNum(existing.weight_kg);
  const sizeChanged = hasSize && String(existing.size_mm ?? '') !== String(size_mm ?? '');
  const stoneChanged = hasStone && String(existing.stone_type ?? '') !== String(stone_type ?? '');
  const looksLikeUneditedWeight = (hasWeight && existingWeight !== null && weightParam !== null && Math.abs(weightParam - existingWeight) <= 5);
  const manualWeight = !!(req.body && (req.body.manual_weight || req.body.weight_manual || req.body.weight_kg_manual));
  // If size/stone changes, recompute weight by default (UI commonly submits stale weight_kg).
  // Allow opting out via { manual_weight: true }.
  if (!manualWeight && (sizeChanged || stoneChanged)) {
    const computed = computeWeightKgFromSizeMmAndStoneType(mergedSizeMm, mergedStoneType);
    if (computed && Number.isFinite(computed.weight_kg)) weightParam = computed.weight_kg;
  } else {
    const shouldAutoCompute = (!hasWeight || weightParam === null || weightParam <= 0 || ((sizeChanged || stoneChanged) && looksLikeUneditedWeight));
    if (shouldAutoCompute) {
      const computed = computeWeightKgFromSizeMmAndStoneType(mergedSizeMm, mergedStoneType);
      if (computed && Number.isFinite(computed.weight_kg)) weightParam = computed.weight_kg;
    }
  }

  // compute costs server-side for consistency
  const g = toNum(gross_cost);
  const t = toNum(transport_cost);
  const o = toNum(other_cost);
  const total = sumCosts(g, t, o);
  const stmt = db.prepare('UPDATE qbids SET supplier = COALESCE(?, supplier), supplier_id = COALESCE(?, supplier_id), quarry = COALESCE(?, quarry), weight_kg = COALESCE(?, weight_kg), size_mm = COALESCE(?, size_mm), grade = COALESCE(?, grade), received_date = COALESCE(?, received_date), material_type = COALESCE(?, material_type), material_id = COALESCE(?, material_id), splitable_blk_count = COALESCE(?, splitable_blk_count), stone_type = COALESCE(?, stone_type), gross_cost = COALESCE(?, gross_cost), transport_cost = COALESCE(?, transport_cost), other_cost = COALESCE(?, other_cost), total_cost = COALESCE(?, total_cost) WHERE qbid = ?');
  stmt.run(supplier || null, supplier_id || null, quarry || null, weightParam, (size_mm ?? null), grade || null, received_date || null, material_type || null, mid, (splitable_blk_count ?? null), (stone_type ?? null), (isFinite(g) ? g : null), (isFinite(t) ? t : null), (isFinite(o) ? o : null), (isFinite(total) ? total : null), qbid);
  res.json({ updated: qbid });
});

// Delete QBID (and cascade children/blocks if desired)
app.delete('/qbids/:qbid', (req, res) => {
  const { qbid } = req.params;
  // if this QBID has child blocks, block deletion (rule enforcement)
  const childCnt = db.prepare('SELECT COUNT(1) as cnt FROM blocks WHERE parent_qbid = ?').get(qbid);
  if (childCnt && childCnt.cnt > 0) return res.status(400).json({ error: 'QBID has child blocks; deletion is disabled' });

  // delete parent_child links and blocks, slabs, events, dispatches referencing them
  const delDispatch = db.prepare('DELETE FROM dispatches WHERE slid IN (SELECT slid FROM slabs WHERE block_id IN (SELECT block_id FROM blocks WHERE parent_qbid = ?))');
  const delSlabEvents = db.prepare('DELETE FROM slab_events WHERE slid IN (SELECT slid FROM slabs WHERE block_id IN (SELECT block_id FROM blocks WHERE parent_qbid = ?))');
  const delSlabs = db.prepare('DELETE FROM slabs WHERE block_id IN (SELECT block_id FROM blocks WHERE parent_qbid = ?)');
  const delParentChild = db.prepare('DELETE FROM parent_child WHERE parent_qbid = ?');
  const delBlocks = db.prepare('DELETE FROM blocks WHERE parent_qbid = ?');
  const delEvents = db.prepare('DELETE FROM events WHERE ref_type = ? AND ref_id = ?');
  const delQbid = db.prepare('DELETE FROM qbids WHERE qbid = ?');

  const tran = db.transaction((q) => {
    delDispatch.run(q);
    delSlabEvents.run(q);
    delSlabs.run(q);
    delParentChild.run(q);
    delBlocks.run(q);
    delEvents.run('qbids', q);
    delQbid.run(q);
  });

  tran(qbid);
  res.json({ deleted: qbid });
});

// Fetch a single block by block_id
app.get('/blocks/:block_id', (req, res) => {
  const blockId = String(req.params.block_id || '').trim();
  if (!blockId) return res.status(400).json({ error: 'block_id required' });
  try {
    const row = db.prepare('SELECT * FROM blocks WHERE block_id = ?').get(blockId);
    if (!row) return res.status(404).json({ error: 'block not found' });
    res.json(row);
  } catch (err) {
    console.error('GET /blocks/:block_id failed', err);
    res.status(500).json({ error: 'failed to fetch block' });
  }
});

// Update Block
app.put('/blocks/:block_id', (req, res) => {
  const { block_id } = req.params;
  const existing = db.prepare('SELECT * FROM blocks WHERE block_id = ?').get(block_id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (Object.prototype.hasOwnProperty.call(req.body, 'source') && req.body.source !== existing.source) return res.status(400).json({ error: 'source is read-only' });
  const merged = Object.assign({}, existing, req.body);
  // block no longer stores component cost or weight/size here
  const newParent = merged.parent_qbid || null;
  const oldParent = existing.parent_qbid || null;
  // If parent is changing, enforce splitable_blk_count and capacity
  if (newParent && newParent !== oldParent) {
    const p = db.prepare('SELECT splitable_blk_count FROM qbids WHERE qbid = ?').get(newParent);
    if (!p) return res.status(404).json({ error: 'new parent QBID not found' });
    // allow parent assignment regardless of splitable_blk_count value
  }
  // ...existing code for updating block fields...
  const updateStmt = db.prepare(
    `UPDATE blocks SET
      parent_qbid = ?, grade = ?, short_code = ?, receipt_id = ?, receipt_date = ?,
      source_id = ?, source_name = ?, material = ?, description = ?,
      length_mm = ?, width_mm = ?, height_mm = ?, volume_m3 = ?,
      no_slabs = ?, no_wastage_slabs = ?,
      yard_location = ?, status = ?, notes = ?
     WHERE block_id = ?`
  );
  const delParentChild = db.prepare('DELETE FROM parent_child WHERE child_block_id = ?');
  const insertParentChild = db.prepare('INSERT OR IGNORE INTO parent_child (parent_qbid, child_block_id) VALUES (?, ?)');
  const tran = db.transaction(() => {
    const info = updateStmt.run(
      newParent, merged.grade, merged.short_code, merged.receipt_id, merged.receipt_date,
      merged.source_id, merged.source_name, merged.material, merged.description,
      merged.length_mm, merged.width_mm, merged.height_mm, merged.volume_m3,
      merged.no_slabs ?? null, merged.no_wastage_slabs ?? null,
      merged.yard_location, merged.status, merged.notes,
      block_id
    );
    if (info.changes === 0) throw new Error('not found');
    if ((oldParent || null) !== (newParent || null)) {
      if (oldParent) delParentChild.run(block_id);
      if (newParent) insertParentChild.run(newParent, block_id);
    }
  });
  try {
    tran();
    res.json({ updated: block_id });
  } catch (err) {
    console.error(err);
    if (String(err.message).includes('not found')) return res.status(404).json({ error: 'not found' });
    // Surface the underlying DB error for easier debugging in the UI.
    // (The UI uses fetchExpectOk() which will show `error` text.)
    return res.status(500).json({ error: String((err && err.message) ? err.message : err) || 'update failed' });
  }
});

// Delete Block
app.delete('/blocks/:block_id', (req, res) => {
  const { block_id } = req.params;
  const delSlabs = db.prepare('DELETE FROM slabs WHERE block_id = ?');
  const delTilesByBlock = db.prepare('DELETE FROM tiles WHERE block_id = ?');
  const delCobblesByBlock = db.prepare('DELETE FROM cobbles WHERE block_id = ?');
  const delMonumentsByBlock = db.prepare('DELETE FROM monuments WHERE block_id = ?');
  const delParentChild = db.prepare('DELETE FROM parent_child WHERE child_block_id = ?');
  const delBlock = db.prepare('DELETE FROM blocks WHERE block_id = ?');
  const delEvents = db.prepare('DELETE FROM events WHERE ref_type = ? AND ref_id = ?');

  const tran = db.transaction((b) => {
    delSlabs.run(b);
    delTilesByBlock.run(b);
    delCobblesByBlock.run(b);
    delMonumentsByBlock.run(b);
    delParentChild.run(b);
    delEvents.run('blocks', b);
    delBlock.run(b);
  });

  tran(block_id);
  res.json({ deleted: block_id });
});

// Update Slab
app.put('/slabs/:slid', (req, res) => {
  const { slid } = req.params;
  const { thickness_mm, machine_id, slabs_yield, batch_id, yard_location, status, qc_status, stone_type } = req.body;
  const stmt = db.prepare('UPDATE slabs SET thickness_mm = COALESCE(?, thickness_mm), machine_id = COALESCE(?, machine_id), slabs_yield = COALESCE(?, slabs_yield), batch_id = COALESCE(?, batch_id), yard_location = COALESCE(?, yard_location), status = COALESCE(?, status), qc_status = COALESCE(?, qc_status), stone_type = COALESCE(?, stone_type) WHERE slid = ?');
  const info = stmt.run(thickness_mm ?? null, machine_id ?? null, slabs_yield ?? null, batch_id ?? null, yard_location ?? null, status ?? null, qc_status ?? null, stone_type ?? null, slid);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ updated: slid });
});

// Delete Slab
app.delete('/slabs/:slid', (req, res) => {
  const { slid } = req.params;
  // No QBID update needed when deleting a slab; proceed to delete slab and related records.
  const delCobblesBySlab = db.prepare('DELETE FROM cobbles WHERE slid = ?');
  const delMonumentsBySlab = db.prepare('DELETE FROM monuments WHERE slid = ?');
  const delSlab = db.prepare('DELETE FROM slabs WHERE slid = ?');
  const delEvents = db.prepare('DELETE FROM events WHERE ref_type = ? AND ref_id = ?');
  const delSlabEvents = db.prepare('DELETE FROM slab_events WHERE slid = ?');
  const delDispatch = db.prepare('DELETE FROM dispatches WHERE slid = ?');
  const delTilesBySlab = db.prepare('DELETE FROM tiles WHERE slid = ?');

  const tran = db.transaction((s) => {
    delSlabEvents.run(s);
    delDispatch.run(s);
    delTilesBySlab.run(s);
    delCobblesBySlab.run(s);
    delMonumentsBySlab.run(s);
    delEvents.run('slabs', s);
    delSlab.run(s);
  });

  tran(slid);
  res.json({ deleted: slid });
});

// Delete dispatch
app.delete('/dispatches/:id', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare('DELETE FROM dispatches WHERE id = ?');
  const info = stmt.run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: id });
});

// Delete event
app.delete('/events/:id', (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare('DELETE FROM events WHERE id = ?');
  const info = stmt.run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: id });
});

// Create QBID (Block master record)
app.post('/qbids', (req, res) => {
  const {
    supplier, supplier_id, quarry, weight_kg, size_mm, grade, received_date,
    material_type, material_id, material_short, splitable_blk_count, stone_type,
    gross_cost, transport_cost, other_cost
  } = req.body;
  // Resolve material + short-code for deterministic QBID generation.
  let mid = material_id || null;
  let matName = null;
  let matShortOverride = null;
  if (material_short && String(material_short).trim()) matShortOverride = String(material_short).trim();
  if (mid) {
    const m = db.prepare('SELECT name, short_code FROM materials WHERE id = ?').get(mid);
    if (m && m.name) matName = m.name;
    // Optional override: only prefer materials.short_code when it's already a 4+ char code.
    if (!matShortOverride && m && m.short_code && String(m.short_code).trim().length >= 4) {
      matShortOverride = String(m.short_code).trim();
    }
  }
  if (!matName && material_type) {
    // Keep material_type as the raw name; it also seeds materials table.
    matName = String(material_type).trim();
  }
  if (!mid && material_type) mid = ensureMaterial(material_type);
  const shortLower = materialShortLower(matShortOverride || matName || material_type || 'MAT');
  const g = Number(gross_cost) || 0;
  const t = Number(transport_cost) || 0;
  const o = Number(other_cost) || 0;
  const total = g + t + o;

  // Auto-calc weight_kg when omitted/invalid and stone_type+size_mm are provided
  const hasWeight = Object.prototype.hasOwnProperty.call(req.body || {}, 'weight_kg');
  let weightVal = hasWeight ? toNum(weight_kg) : null;
  if (!hasWeight || weightVal === null || weightVal <= 0) {
    const computed = computeWeightKgFromSizeMmAndStoneType(size_mm, stone_type);
    if (computed && Number.isFinite(computed.weight_kg)) weightVal = computed.weight_kg;
  }
  if (weightVal === null) weightVal = 0;

  // Build INSERT dynamically to tolerate older DBs that may not have cost columns yet
  const baseCols = ['qbid','supplier','supplier_id','quarry','weight_kg','size_mm','grade','received_date','material_type','material_id','splitable_blk_count','stone_type'];
  const baseVals = [null, supplier || null, supplier_id || null, quarry || null, weightVal, (size_mm ?? null), grade || null, received_date || null, material_type || null, mid, (splitable_blk_count ?? null), (stone_type ?? null)];
  // Determine which optional cost columns exist in this DB
  let existingCols = [];
  try { existingCols = db.prepare("PRAGMA table_info('qbids')").all().map(r => r.name); } catch (e) { existingCols = []; }
  const costCols = [];
  if (existingCols.includes('gross_cost')) { costCols.push('gross_cost'); baseVals.push(g); }
  if (existingCols.includes('transport_cost')) { costCols.push('transport_cost'); baseVals.push(t); }
  if (existingCols.includes('other_cost')) { costCols.push('other_cost'); baseVals.push(o); }
  if (existingCols.includes('total_cost')) { costCols.push('total_cost'); baseVals.push(total); }

  const allCols = baseCols.concat(costCols);
  const placeholders = allCols.map(() => '?').join(', ');
  const sql = `INSERT INTO qbids (${allCols.join(',')}) VALUES (${placeholders})`;
  const stmt = db.prepare(sql);

  // Allocate QBID + insert atomically (prevents duplicate IDs under concurrency).
  const createdQbid = db.transaction(() => {
    const qbid = nextQbidForMaterial(shortLower);
    baseVals[0] = qbid;
    stmt.run(...baseVals);
    return qbid;
  })();

  res.status(201).json({ qbid: createdQbid });
});

// Get QBID
app.get('/qbids/:qbid', (req, res) => {
  const row = db.prepare('SELECT q.*, s.name as supplier_name FROM qbids q LEFT JOIN suppliers s ON q.supplier_id = s.id WHERE qbid = ?').get(req.params.qbid);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// QBID lock-state: indicates if updates are locked due to children/slabs
app.get('/qbids/:qbid/lock-state', (req, res) => {
  const { qbid } = req.params;
  const exists = db.prepare('SELECT qbid FROM qbids WHERE qbid = ?').get(qbid);
  if (!exists) return res.status(404).json({ error: 'not found' });
  const childBlocksRow = db.prepare('SELECT COUNT(1) as cnt FROM blocks WHERE parent_qbid = ?').get(qbid);
  const hasBlocks = childBlocksRow && Number(childBlocksRow.cnt) > 0;
  const childSlabsRow = db.prepare('SELECT COUNT(1) as cnt FROM slabs WHERE block_id IN (SELECT block_id FROM blocks WHERE parent_qbid = ?)').get(qbid);
  const hasSlabs = childSlabsRow && Number(childSlabsRow.cnt) > 0;
  res.json({ qbid, hasBlocks, hasSlabs, locked: (hasBlocks || hasSlabs) });
});

// Log an event for an object (qbids, blocks, slabs)
app.post('/events', (req, res) => {
  const { ref_type, ref_id, event_type, payload } = req.body; // payload optional JSON
  const id = uuidv4();
  const stmt = db.prepare('INSERT INTO events (id, ref_type, ref_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)');
  stmt.run(id, ref_type, ref_id, event_type, JSON.stringify(payload || {}));
  res.status(201).json({ id });
});

// Split a block (create child blocks from parent) - updated: do NOT change qbids.splitable_blk_count
app.post('/blocks/:qbid/split', (req, res) => {
  const { qbid } = req.params;
  let { children } = req.body;
  const parent = db.prepare('SELECT q.*, m.name as material_name, m.short_code as material_short FROM qbids q LEFT JOIN materials m ON q.material_id = m.id WHERE q.qbid = ?').get(qbid);
  if (!parent) return res.status(404).json({ error: 'parent QBID not found' });

    // allow block creation regardless of splitable_blk_count value

  // ensure no existing child blocks are present — do not allow creating further children
  const existing = db.prepare('SELECT COUNT(1) as cnt FROM parent_child WHERE parent_qbid = ?').get(qbid);
  const existingCount = existing ? Number(existing.cnt || 0) : 0;
  if (existingCount > 0) return res.status(400).json({ error: 'child blocks already exist for this QBID; cannot create additional split children' });

  // default to parent.splitable_blk_count children if none provided
  if (!children || !Array.isArray(children) || children.length === 0) {
    const n = Number(parent.splitable_blk_count) || 1;
    children = Array.from({ length: n }, () => ({}));
  }

  if (Number(parent.splitable_blk_count) && children.length > Number(parent.splitable_blk_count)) {
    return res.status(400).json({ error: 'provided children exceed parent.splitable_blk_count' });
  }

  const insert = db.prepare(`INSERT OR IGNORE INTO blocks (
    block_id, parent_qbid, grade, short_code, description,
    receipt_id, receipt_date, source_id, source_name,
    material, length_mm, width_mm, height_mm, volume_m3, no_slabs, no_wastage_slabs,
    yard_location, status, notes
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const link = db.prepare('INSERT OR IGNORE INTO parent_child (parent_qbid, child_block_id) VALUES (?, ?)');

  const created = [];
  const tran = db.transaction((childrenList) => {
    childrenList.forEach((c, idx) => {
      const matName = parent.material_name || parent.material_type || 'MAT';
      // For new QBIDs, generate numeric block IDs that include material short + parent sequence.
      const blockSeq = idx + 1;
      const autoBlockId = nextBlockIdForQbid(qbid, blockSeq);
      const mShort = parent.material_short || materialShort(matName);
      const letterIndex = nextLetterIndexForParent(mShort, qbid) + idx;
      const blockId = autoBlockId || generateBlockIdLetter(mShort, qbid, letterIndex);

      const status = 'Dressed';
      const material = matName;
      const description = parent.quarry ? `${material} from ${parent.quarry}` : material;

      insert.run(
        blockId, qbid, c.grade || null, c.short_code || null, c.description || description || null,
        c.receipt_id || parent.receipt_id || null, c.receipt_date || parent.receipt_date || null,
        c.source_id || parent.source_id || null, c.source_name || parent.source_name || null, material || null,
        c.length_mm || null, c.width_mm || null, c.height_mm || null, c.volume_m3 || null, c.no_slabs ?? null, c.no_wastage_slabs ?? null,
        c.yard_location || parent.yard_location || null, c.status || status, c.notes || null
      );

      link.run(qbid, blockId);
      created.push(blockId);
    });
  });

  try {
    tran(children);
    res.status(201).json({ created });
  } catch (err) {
    console.error('split failed', err);
    res.status(500).json({ error: 'split failed' });
  }
});

// Create a single block record directly (optional parent linkage)
app.post('/blocks', (req, res) => {
  const {
    block_id, parent_qbid, grade, short_code, receipt_id, receipt_date,
    source_id, source_name, material, description,
    length_mm, width_mm, height_mm, volume_m3,
    yard_location, status, notes
  } = req.body;
  if (!block_id) return res.status(400).json({ error: 'block_id required' });
  // if parent_qbid provided, require that the parent QBID exists and has splitable_blk_count set and not exceeded
  if (parent_qbid) {
    const parentRow = db.prepare('SELECT splitable_blk_count FROM qbids WHERE qbid = ?').get(parent_qbid);
    if (!parentRow) return res.status(404).json({ error: 'parent QBID not found' });
    const cap = Number(parentRow.splitable_blk_count);
    if (!cap || cap < 1) return res.status(400).json({ error: 'parent QBID split count not set or < 1' });
    const current = db.prepare('SELECT COUNT(1) as cnt FROM blocks WHERE parent_qbid = ?').get(parent_qbid);
    const cnt = current ? Number(current.cnt || 0) : 0;
    if (cnt >= cap) return res.status(400).json({ error: 'split cap reached for parent QBID' });
  }
  const insert = db.prepare(`INSERT OR IGNORE INTO blocks (
    block_id, parent_qbid, grade, short_code, description,
    receipt_id, receipt_date, source_id, source_name,
    material, length_mm, width_mm, height_mm, volume_m3, no_slabs, no_wastage_slabs,
    yard_location, status, notes
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const link = db.prepare('INSERT OR IGNORE INTO parent_child (parent_qbid, child_block_id) VALUES (?, ?)');
  const tranCreate = db.transaction((payload) => {
    const info = insert.run(
      payload.block_id, payload.parent_qbid || null, payload.grade || null, payload.short_code || null, payload.description || null,
      payload.receipt_id || null, payload.receipt_date || null, payload.source_id || null, payload.source_name || null,
      payload.material || null, payload.length_mm || null, payload.width_mm || null, payload.height_mm || null, payload.volume_m3 || null, payload.no_slabs ?? null, payload.no_wastage_slabs ?? null,
      payload.yard_location || null, payload.status || null, payload.notes || null
    );
    if (payload.parent_qbid) link.run(payload.parent_qbid, payload.block_id);
    if (info.changes === 0) throw new Error('block exists');
  });
  try {
    tranCreate({ block_id, parent_qbid, grade, short_code, receipt_id, receipt_date, source_id, source_name, material, description, length_mm, width_mm, height_mm, volume_m3, yard_location, status, notes });
    res.status(201).json({ block_id });
  } catch (err) {
    if (String(err.message).includes('block exists')) return res.status(409).json({ error: 'block exists' });
    console.error(err);
    res.status(500).json({ error: 'insert failed' });
  }
});

// Bulk generate blocks for a QBID up to splitable_blk_count
app.post('/blocks/generate/:qbid', (req, res) => {
  const { qbid } = req.params;
  const parent = db.prepare('SELECT q.*, m.name as material_name, m.short_code as material_short FROM qbids q LEFT JOIN materials m ON q.material_id = m.id WHERE q.qbid = ?').get(qbid);
  if (!parent) return res.status(404).json({ error: 'QBID not found' });
  const cap = Number(parent.splitable_blk_count) || 0;
  if (cap < 1) return res.status(400).json({ error: 'QBID does not have splitable_blk_count >= 1' });

  const existingRows = db.prepare('SELECT block_id FROM blocks WHERE parent_qbid = ?').all(qbid);
  const currentTotal = Array.isArray(existingRows) ? existingRows.length : 0;
  const remainingSlots = cap - currentTotal;
  if (remainingSlots <= 0) return res.status(400).json({ error: 'All blocks already generated for this QBID' });

  const used = new Set();
  let hasNumeric = false;
  let hasLetter = false;
  const expectedBase = stripQbidPrefix(qbid).toUpperCase();
  for (const r of (existingRows || [])) {
    const bid = String(r.block_id || '').trim();
    if (!bid) continue;
    if (/^BLK-/.test(bid) && /-\d{3}$/.test(bid)) hasNumeric = true;
    if (/^BLK-/.test(bid) && /-[A-Z]{1,6}$/.test(bid)) hasLetter = true;
    const parsed = parseNewBlockId(bid);
    if (!parsed) continue;
    if (String(parsed.base || '').toUpperCase() !== expectedBase) continue;
    const seq = Number(parsed.blockSeq);
    if (!Number.isFinite(seq) || seq < 1) continue;
    if (seq <= cap) used.add(seq);
  }

  const missing = [];
  for (let i = 1; i <= cap; i++) {
    if (!used.has(i)) missing.push(i);
  }
  const indicesToCreate = missing.slice(0, remainingSlots);
  if (!indicesToCreate.length) return res.status(400).json({ error: 'All blocks already generated for this QBID' });

  // Keep style stable per QBID: if numeric IDs already exist, continue numeric; otherwise use letters.
  // If both exist (rare), prefer letters going forward.
  const useLetter = hasLetter || !hasNumeric;

  const insert = db.prepare(`INSERT OR IGNORE INTO blocks (
    block_id, parent_qbid, material, status
  ) VALUES (?, ?, ?, ?)`);
  const link = db.prepare('INSERT OR IGNORE INTO parent_child (parent_qbid, child_block_id) VALUES (?, ?)');
  const updExisting = db.prepare(`UPDATE blocks SET
    parent_qbid = COALESCE(parent_qbid, ?),
    material = COALESCE(material, ?),
    status = COALESCE(status, ?)
  WHERE block_id = ?`);

  const created = [];
  const matShort = parent.material_short || materialShort(parent.material_name || parent.material_type || 'MAT');

  for (const blockSeq of indicesToCreate) {
    const autoBlockId = useLetter ? nextBlockIdForQbidLetter(qbid, blockSeq) : nextBlockIdForQbid(qbid, blockSeq);
    const letter = numberToLetters(blockSeq);
    const fallbackBlockId = `${matShort}-${stripQbidPrefix(qbid).toUpperCase()}-BLOCK-${letter}`;
    const block_id = autoBlockId || fallbackBlockId;

    const info = insert.run(block_id, qbid, parent.material_name || parent.material_type || 'MAT', 'Dressed');
    link.run(qbid, block_id);
    if (!info.changes || info.changes === 0) {
      updExisting.run(
        qbid,
        parent.material_name || parent.material_type || 'MAT',
        'Dressed',
        block_id
      );
      continue;
    }
    created.push(block_id);
  }

  res.json({ created });
});

// Generate a new block id with prefix and sequential number, e.g. PAR-BLOCK-0001
app.get('/blocks/generate', (req, res) => {
  const prefix = String(req.query.prefix || 'PAR-BLOCK').toUpperCase();
  const parent = req.query.parent_qbid || null;
  const style = String(req.query.style || '').toLowerCase();
  if (style === 'letter' && parent) {
    // need material short for parent
    const parentRow = db.prepare('SELECT q.*, m.short_code as material_short, m.name as material_name FROM qbids q LEFT JOIN materials m ON q.material_id = m.id WHERE q.qbid = ?').get(parent);
    if (!parentRow) return res.status(404).json({ error: 'parent QBID not found' });
    const matShort = parentRow.material_short || materialShort(parentRow.material_name || parentRow.material_type || 'MAT');
    const idx = nextLetterIndexForParent(matShort, parent);
    const id = generateBlockIdLetter(matShort, parent, idx);
    return res.json({ block_id: id });
  }

  const id = parent ? generateBlockIdForParent(prefix, parent) : generateBlockId(prefix);
  res.json({ block_id: id });
});

// Admin: set splitable_blk_count = 0 for specified QBIDs or all where NULL
app.post('/admin/set-split-count-zero', (req, res) => {
  const { all, qbids } = req.body || {};
  if (all) {
    const info = db.prepare('UPDATE qbids SET splitable_blk_count = 0 WHERE splitable_blk_count IS NULL').run();
    return res.json({ updated: info.changes || 0 });
  }
  if (Array.isArray(qbids) && qbids.length) {
    const stmt = db.prepare('UPDATE qbids SET splitable_blk_count = 0 WHERE qbid = ? AND splitable_blk_count IS NULL');
    let updated = 0;
    const tran = db.transaction((ids) => {
      for (const q of ids) {
        const info = stmt.run(q);
        updated += info.changes;
      }
    });
    tran(qbids);
    return res.json({ updated });
  }
  res.status(400).json({ error: 'provide { all: true } or { qbids: [..] }' });
});

// Admin: normalize/persist block code columns to canonical derivation from block_id
function normalizeBlockCodes() {
  // Legacy block code columns removed; keep material normalization only
  const updMat = db.prepare(`UPDATE blocks SET material = COALESCE(material, (
    SELECT m.name FROM qbids q LEFT JOIN materials m ON q.material_id = m.id WHERE q.qbid = blocks.parent_qbid
  )) WHERE material IS NULL`);
  const r = updMat.run();
  return { material_updated: r.changes || 0 };
}

app.post('/admin/normalize-block-codes', (req, res) => {
  try {
    const result = normalizeBlockCodes();
    res.json(Object.assign({}, result, { total_updated: result.material_updated || 0 }));
  } catch (err) {
    console.error('normalizeBlockCodes failed', err);
    res.status(500).json({ error: 'normalize failed' });
  }
});

// Admin: cleanup orphaned blocks whose parent QBID does not have splitable_blk_count set
function cleanupOrphanedBlocks() {
  // find blocks where parent_qbid exists and its qbids.splitable_blk_count is NULL
  const rows = db.prepare(`SELECT b.block_id, b.parent_qbid FROM blocks b JOIN qbids q ON b.parent_qbid = q.qbid WHERE q.splitable_blk_count IS NULL`).all();
  if (!rows || !rows.length) return 0;

  const delSlabs = db.prepare('DELETE FROM slabs WHERE block_id = ?');
  const delParentChild = db.prepare('DELETE FROM parent_child WHERE child_block_id = ?');
  const delEvents = db.prepare('DELETE FROM events WHERE ref_type = ? AND ref_id = ?');
  const delBlock = db.prepare('DELETE FROM blocks WHERE block_id = ?');

  const tran = db.transaction((ids) => {
    for (const idObj of ids) {
      const id = idObj.block_id;
      delSlabs.run(id);
      delParentChild.run(id);
      delEvents.run('blocks', id);
      delBlock.run(id);
    }
  });

  tran(rows);
  return rows.length;
}

app.post('/admin/cleanup-orphaned-blocks', (req, res) => {
  const deleted = cleanupOrphanedBlocks();
  res.json({ deleted });
});

// List child blocks for a parent QBID
app.get('/blocks/:qbid/children', (req, res) => {
  const { qbid } = req.params;
  const parent = db.prepare('SELECT * FROM qbids WHERE qbid = ?').get(qbid);
  if (!parent) return res.status(404).json({ error: 'parent QBID not found' });

  // Prefer blocks table so UI works even if parent_child links are missing.
  const rows = db.prepare('SELECT b.* FROM blocks b WHERE b.parent_qbid = ? ORDER BY b.block_id').all(qbid);
  res.json({ parent: qbid, children: rows });
});

// Create SLID (Slab lot) from block
app.post('/slabs', (req, res) => {
  const { block_id, thickness_mm, machine_id, slabs_yield, batch_id, yard_location, status, qc_status, stone_type } = req.body;
  const block = db.prepare('SELECT * FROM blocks WHERE block_id = ?').get(block_id);
  if (!block) return res.status(404).json({ error: 'block not found' });
  // Prefer deterministic SLID when block belongs to a new-style QBID.
  const parentQbid = block.parent_qbid || null;
  const autoSlid = parentQbid ? nextSlidForBlock(block_id, parentQbid) : null;
  const slid = autoSlid || `SLID-${uuidv4().split('-')[0].toUpperCase()}`;
  const stmt = db.prepare('INSERT INTO slabs (slid, block_id, thickness_mm, machine_id, slabs_yield, batch_id, yard_location, status, qc_status, stone_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  stmt.run(slid, block_id, thickness_mm || null, machine_id || null, slabs_yield || 0, batch_id || null, yard_location || null, status || null, qc_status || null, stone_type || null);
  res.status(201).json({ slid });
});

// Finishing events like resin, polish, QC — move location/status
app.post('/slabs/:slid/finish', (req, res) => {
  const { slid } = req.params;
  const { action, payload } = req.body; // action: RESIN_APPLIED, MESH_APPLIED, POLISHED, QC
  const slab = db.prepare('SELECT * FROM slabs WHERE slid = ?').get(slid);
  if (!slab) return res.status(404).json({ error: 'slab not found' });
  const id = uuidv4();
  const stmt = db.prepare('INSERT INTO slab_events (id, slid, action, payload, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)');
  stmt.run(id, slid, action, JSON.stringify(payload || {}));
  res.status(201).json({ id });
});

// Dispatch final product
app.post('/dispatch', (req, res) => {
  // Accept either legacy { slid } or structured { item_type, item_id }
  const { slid: rawSlid, item_type, item_id, customer, bundle_no, container_no } = req.body;
  const slid = rawSlid ? String(rawSlid).trim().toUpperCase() : null;

  // Determine dispatch target and validate existence
  let targetType = null;
  let targetId = null;
  if (slid && (!item_type && !item_id)) {
    targetType = 'slab';
    targetId = slid;
    // verify slab exists
    const s = db.prepare('SELECT slid, stone_type FROM slabs WHERE UPPER(TRIM(slid)) = ?').get(slid);
    if (!s) return res.status(404).json({ error: 'slab not found' });
  } else if (item_type && item_id) {
    targetType = String(item_type).trim().toLowerCase();
    targetId = String(item_id).trim();
    // verify item exists in its table
    if (targetType === 'tile') {
      const t = db.prepare('SELECT tile_id, slid FROM tiles WHERE tile_id = ?').get(targetId);
      if (!t) return res.status(404).json({ error: 'tile not found' });
      // also set slid for traceability
      // targetId remains tile id
    } else if (targetType === 'cobble') {
      const c = db.prepare('SELECT cobble_id, slid FROM cobbles WHERE cobble_id = ?').get(targetId);
      if (!c) return res.status(404).json({ error: 'cobble not found' });
    } else if (targetType === 'monument') {
      const m = db.prepare('SELECT monument_id, slid FROM monuments WHERE monument_id = ?').get(targetId);
      if (!m) return res.status(404).json({ error: 'monument not found' });
    } else if (targetType === 'paver') {
      const p = db.prepare('SELECT paver_id, slid FROM pavers WHERE paver_id = ?').get(targetId);
      if (!p) return res.status(404).json({ error: 'paver not found' });
    } else {
      return res.status(400).json({ error: 'invalid item_type' });
    }
  } else {
    return res.status(400).json({ error: 'provide slid or item_type+item_id' });
  }

  // Prevent duplicate dispatch of the same physical item
  if (targetType === 'slab') {
    const exists = db.prepare('SELECT COUNT(1) as cnt FROM dispatches WHERE slid = ?').get(targetId);
    if (exists && Number(exists.cnt) > 0) return res.status(400).json({ error: 'This slab has already been dispatched' });
  } else {
    const exists = db.prepare('SELECT COUNT(1) as cnt FROM dispatches WHERE item_type = ? AND item_id = ?').get(targetType, targetId);
    if (exists && Number(exists.cnt) > 0) return res.status(400).json({ error: 'This item has already been dispatched' });
  }

  const eventId = uuidv4();
  const stmt = db.prepare('INSERT INTO dispatches (id, slid, item_type, item_id, customer, bundle_no, container_no, dispatched_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)');
  // For derived items we may still keep the slab's slid for traceability when available
  let traceSlid = null;
  if (targetType === 'slab') traceSlid = targetId;
  else {
    const row = db.prepare('SELECT slid FROM tiles WHERE tile_id = ?').get(targetId) || db.prepare('SELECT slid FROM cobbles WHERE cobble_id = ?').get(targetId) || db.prepare('SELECT slid FROM monuments WHERE monument_id = ?').get(targetId) || db.prepare('SELECT slid FROM pavers WHERE paver_id = ?').get(targetId);
    traceSlid = row ? row.slid : null;
  }
  stmt.run(eventId, traceSlid, targetType, targetId, customer || null, bundle_no || null, container_no || null);
  res.status(201).json({ id: eventId });
});

// Create derived products
app.post('/tiles', (req, res) => {
  let { block_id, slid, thickness_mm, length_mm, width_mm, finish, yield_count, batch_id, yard_location, status, qc_status, stone_type } = req.body;
  if (slid) slid = String(slid).trim().toUpperCase();
  if (!block_id && !slid) return res.status(400).json({ error: 'block_id or slid required' });
  // Resolve block_id from SLID when not provided; validate consistency when provided
  if (slid) {
    const slabRow = db.prepare('SELECT slid, block_id FROM slabs WHERE UPPER(TRIM(slid)) = ?').get(slid);
    if (!slabRow) return res.status(404).json({ error: 'slab not found' });
    if (!block_id) block_id = slabRow.block_id;
    else if (String(block_id) !== String(slabRow.block_id)) return res.status(400).json({ error: 'block_id does not match slab\'s block_id' });
  }
  // When creating from a SLID:
  // - If the slab has a stone_type, enforce match (and inherit when missing)
  // - If slab stone_type is a derived-family marker (tiles/cobbles/monuments/pavers), only allow this family
  if (slid) {
    const slabRowFull = db.prepare('SELECT stone_type FROM slabs WHERE UPPER(TRIM(slid)) = ?').get(slid);
    const slabType = slabRowFull && slabRowFull.stone_type ? String(slabRowFull.stone_type).trim().toLowerCase() : null;
    if (!slabType) {
      return res.status(400).json({ error: 'slab stone_type is required when creating tiles from a SLID' });
    }
    if (slabType) {
      if (['tiles', 'cobbles', 'monuments', 'pavers'].includes(slabType) && slabType !== 'tiles') {
        return res.status(400).json({ error: `This SLID is reserved for ${slabType}; cannot create tiles from it` });
      }
      if (stone_type && String(stone_type).trim().toLowerCase() !== slabType) {
        return res.status(400).json({ error: `slab stone_type (${slabType}) incompatible with requested derived stone_type (${stone_type})` });
      }
      stone_type = slabType;
    }
  }
  // If using a SLID, ensure this slab hasn't been used to create other derived product types
  if (slid) {
    const cobbleCnt = db.prepare('SELECT COUNT(1) as cnt FROM cobbles WHERE UPPER(TRIM(slid)) = ?').get(slid);
    const monCnt = db.prepare('SELECT COUNT(1) as cnt FROM monuments WHERE UPPER(TRIM(slid)) = ?').get(slid);
    const pavCnt = db.prepare('SELECT COUNT(1) as cnt FROM pavers WHERE UPPER(TRIM(slid)) = ?').get(slid);
    if ((cobbleCnt && Number(cobbleCnt.cnt) > 0) || (monCnt && Number(monCnt.cnt) > 0) || (pavCnt && Number(pavCnt.cnt) > 0)) {
      return res.status(400).json({ error: 'This SLID already has cobbles, monuments, or pavers; create tiles from slabs that have no other derived products' });
    }
  }
  // Verify block exists
  const b = db.prepare('SELECT block_id FROM blocks WHERE block_id = ?').get(block_id);
  if (!b) return res.status(404).json({ error: 'block not found' });
  // If this block already has slabs, require creation via SLID (don't allow direct block->derived creation)
  if (!slid) {
    const slabCnt = db.prepare('SELECT COUNT(1) as cnt FROM slabs WHERE block_id = ?').get(block_id);
    if (slabCnt && Number(slabCnt.cnt) > 0) return res.status(400).json({ error: 'Block has slabs; create derived products from slabs using their SLID' });
  }
  const tile_id = `TILE-${uuidv4().split('-')[0].toUpperCase()}`;
  const source = slid ? 'slab' : 'block';
  const normSlid = slid ? String(slid).trim().toUpperCase() : null;
  const stmt = db.prepare('INSERT INTO tiles (tile_id, block_id, slid, thickness_mm, length_mm, width_mm, finish, yield_count, batch_id, yard_location, status, qc_status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  stmt.run(tile_id, block_id || null, normSlid, thickness_mm || null, length_mm || null, width_mm || null, finish || null, yield_count || 0, batch_id || null, yard_location || null, status || null, qc_status || null, source);
  res.status(201).json({ tile_id });
});

app.post('/cobbles', (req, res) => {
  let { block_id, slid, length_mm, width_mm, height_mm, shape, finish, pieces_count, batch_id, yard_location, status, qc_status, stone_type } = req.body;
  if (slid) slid = String(slid).trim().toUpperCase();
  if (!block_id && !slid) return res.status(400).json({ error: 'block_id or slid required' });
  if (slid) {
    const slabRow = db.prepare('SELECT slid, block_id FROM slabs WHERE UPPER(TRIM(slid)) = ?').get(slid);
    if (!slabRow) return res.status(404).json({ error: 'slab not found' });
    if (!block_id) block_id = slabRow.block_id;
    else if (String(block_id) !== String(slabRow.block_id)) return res.status(400).json({ error: 'block_id does not match slab\'s block_id' });
  }
  // Enforce slab stone_type presence and reservation when creating from SLID
  if (slid) {
    const slabRowFull = db.prepare('SELECT stone_type FROM slabs WHERE UPPER(TRIM(slid)) = ?').get(slid);
    const slabType = slabRowFull && slabRowFull.stone_type ? String(slabRowFull.stone_type).trim().toLowerCase() : null;
    if (!slabType) {
      return res.status(400).json({ error: 'slab stone_type is required when creating cobbles from a SLID' });
    }
    if (['tiles', 'cobbles', 'monuments', 'pavers'].includes(slabType) && slabType !== 'cobbles') {
      return res.status(400).json({ error: `This SLID is reserved for ${slabType}; cannot create cobbles from it` });
    }
    if (stone_type && String(stone_type).trim().toLowerCase() !== slabType) {
      return res.status(400).json({ error: `slab stone_type (${slabType}) incompatible with requested derived stone_type (${stone_type})` });
    }
  }
  if (slid) {
    const tileCnt = db.prepare('SELECT COUNT(1) as cnt FROM tiles WHERE UPPER(TRIM(slid)) = ?').get(slid);
    const monCnt = db.prepare('SELECT COUNT(1) as cnt FROM monuments WHERE UPPER(TRIM(slid)) = ?').get(slid);
    const pavCnt = db.prepare('SELECT COUNT(1) as cnt FROM pavers WHERE UPPER(TRIM(slid)) = ?').get(slid);
    if ((tileCnt && Number(tileCnt.cnt) > 0) || (monCnt && Number(monCnt.cnt) > 0) || (pavCnt && Number(pavCnt.cnt) > 0)) {
      return res.status(400).json({ error: 'This SLID already has tiles, monuments, or pavers; create cobbles from slabs that have no other derived products' });
    }
  }
  const b = db.prepare('SELECT block_id FROM blocks WHERE block_id = ?').get(block_id);
  if (!b) return res.status(404).json({ error: 'block not found' });
  if (!slid) {
    const slabCnt = db.prepare('SELECT COUNT(1) as cnt FROM slabs WHERE block_id = ?').get(block_id);
    if (slabCnt && Number(slabCnt.cnt) > 0) return res.status(400).json({ error: 'Block has slabs; create derived products from slabs using their SLID' });
  }
  const cobble_id = `COB-${uuidv4().split('-')[0].toUpperCase()}`;
  const source = slid ? 'slab' : 'block';
  const normSlid = slid ? String(slid).trim().toUpperCase() : null;
  const stmt = db.prepare('INSERT INTO cobbles (cobble_id, block_id, slid, length_mm, width_mm, height_mm, shape, finish, pieces_count, batch_id, yard_location, status, qc_status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  stmt.run(cobble_id, block_id || null, normSlid, length_mm || null, width_mm || null, height_mm || null, shape || null, finish || null, pieces_count || 0, batch_id || null, yard_location || null, status || null, qc_status || null, source);
  res.status(201).json({ cobble_id });
});

app.post('/monuments', (req, res) => {
  let { block_id, slid, length_mm, width_mm, height_mm, style, customer, order_no, batch_id, yard_location, status, qc_status } = req.body;
  if (slid) slid = String(slid).trim().toUpperCase();
  if (!block_id && !slid) return res.status(400).json({ error: 'block_id or slid required' });
  if (slid) {
    const slabRow = db.prepare('SELECT slid, block_id FROM slabs WHERE UPPER(TRIM(slid)) = ?').get(slid);
    if (!slabRow) return res.status(404).json({ error: 'slab not found' });
    if (!block_id) block_id = slabRow.block_id;
    else if (String(block_id) !== String(slabRow.block_id)) return res.status(400).json({ error: 'block_id does not match slab\'s block_id' });
  }
  if (slid) {
    const tileCnt = db.prepare('SELECT COUNT(1) as cnt FROM tiles WHERE UPPER(TRIM(slid)) = ?').get(slid);
    const cobbleCnt = db.prepare('SELECT COUNT(1) as cnt FROM cobbles WHERE UPPER(TRIM(slid)) = ?').get(slid);
    const pavCnt = db.prepare('SELECT COUNT(1) as cnt FROM pavers WHERE UPPER(TRIM(slid)) = ?').get(slid);
    if ((tileCnt && Number(tileCnt.cnt) > 0) || (cobbleCnt && Number(cobbleCnt.cnt) > 0) || (pavCnt && Number(pavCnt.cnt) > 0)) {
      return res.status(400).json({ error: 'This SLID already has tiles, cobbles, or pavers; create monuments from slabs that have no other derived products' });
    }
  }
  // Enforce slab -> derived stone_type presence and reservation when creating from SLID
  if (slid) {
    const slabRowFull = db.prepare('SELECT stone_type FROM slabs WHERE UPPER(TRIM(slid)) = ?').get(slid);
    const slabType = slabRowFull && slabRowFull.stone_type ? String(slabRowFull.stone_type).trim().toLowerCase() : null;
    if (!slabType) {
      return res.status(400).json({ error: 'slab stone_type is required when creating monuments from a SLID' });
    }
    if (['tiles', 'cobbles', 'monuments', 'pavers'].includes(slabType) && slabType !== 'monuments') {
      return res.status(400).json({ error: `This SLID is reserved for ${slabType}; cannot create monuments from it` });
    }
    if (slabType) {
      // monuments POST doesn't accept stone_type in body historically, but be strict: reject if caller supplied conflicting stone_type
      if (req.body.stone_type && String(req.body.stone_type).trim().toLowerCase() !== slabType) {
        return res.status(400).json({ error: `slab stone_type (${slabType}) incompatible with requested derived stone_type (${req.body.stone_type})` });
      }
      // ensure monuments created inherit slab type if DB column exists (some schemas may not have stone_type column)
      // If monuments table has stone_type column, include it when inserting
      // We'll set a local variable to be used in insert (monuments table currently doesn't store stone_type in many DBs)
      // For safety, set stone_type variable here for potential future columns
      var inheritedStoneTypeForMonument = slabType;
    }
  }
  // slab stone_type reservation handled above
  const b = db.prepare('SELECT block_id FROM blocks WHERE block_id = ?').get(block_id);
  if (!b) return res.status(404).json({ error: 'block not found' });
  if (!slid) {
    const slabCnt = db.prepare('SELECT COUNT(1) as cnt FROM slabs WHERE block_id = ?').get(block_id);
    if (slabCnt && Number(slabCnt.cnt) > 0) return res.status(400).json({ error: 'Block has slabs; create derived products from slabs using their SLID' });
  }
  const monument_id = `MON-${uuidv4().split('-')[0].toUpperCase()}`;
  const source = slid ? 'slab' : 'block';
  const normSlid = slid ? String(slid).trim().toUpperCase() : null;
  const stmt = db.prepare('INSERT INTO monuments (monument_id, block_id, slid, length_mm, width_mm, height_mm, style, customer, order_no, batch_id, yard_location, status, qc_status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  stmt.run(monument_id, block_id || null, normSlid, length_mm || null, width_mm || null, height_mm || null, style || null, customer || null, order_no || null, batch_id || null, yard_location || null, status || null, qc_status || null, source);
  res.status(201).json({ monument_id });
});

app.post('/pavers', (req, res) => {
  let { block_id, slid, thickness_mm, length_mm, width_mm, height_mm, finish, pattern, pieces_count, batch_id, yard_location, status, qc_status, stone_type } = req.body;
  if (slid) slid = String(slid).trim().toUpperCase();
  if (!block_id && !slid) return res.status(400).json({ error: 'block_id or slid required' });
  if (slid) {
    const slabRow = db.prepare('SELECT slid, block_id FROM slabs WHERE UPPER(TRIM(slid)) = ?').get(slid);
    if (!slabRow) return res.status(404).json({ error: 'slab not found' });
    if (!block_id) block_id = slabRow.block_id;
    else if (String(block_id) !== String(slabRow.block_id)) return res.status(400).json({ error: 'block_id does not match slab\'s block_id' });
  }
  // Require slab stone_type when creating from SLID; enforce family reservation
  if (slid) {
    const slabRowFull = db.prepare('SELECT stone_type FROM slabs WHERE UPPER(TRIM(slid)) = ?').get(slid);
    const slabType = slabRowFull && slabRowFull.stone_type ? String(slabRowFull.stone_type).trim().toLowerCase() : null;
    if (!slabType) {
      return res.status(400).json({ error: 'slab stone_type is required when creating pavers from a SLID' });
    }
    if (['tiles', 'cobbles', 'monuments', 'pavers'].includes(slabType) && slabType !== 'pavers') {
      return res.status(400).json({ error: `This SLID is reserved for ${slabType}; cannot create pavers from it` });
    }
    if (stone_type && String(stone_type).trim().toLowerCase() !== slabType) {
      return res.status(400).json({ error: `slab stone_type (${slabType}) incompatible with requested derived stone_type (${stone_type})` });
    }
  }
  // SLID exclusivity across derived families
  if (slid) {
    const tileCnt = db.prepare('SELECT COUNT(1) as cnt FROM tiles WHERE UPPER(TRIM(slid)) = ?').get(slid);
    const cobbleCnt = db.prepare('SELECT COUNT(1) as cnt FROM cobbles WHERE UPPER(TRIM(slid)) = ?').get(slid);
    const monCnt = db.prepare('SELECT COUNT(1) as cnt FROM monuments WHERE UPPER(TRIM(slid)) = ?').get(slid);
    const pavCnt = db.prepare('SELECT COUNT(1) as cnt FROM pavers WHERE UPPER(TRIM(slid)) = ?').get(slid);
    if ((tileCnt && Number(tileCnt.cnt) > 0) || (cobbleCnt && Number(cobbleCnt.cnt) > 0) || (monCnt && Number(monCnt.cnt) > 0) || (pavCnt && Number(pavCnt.cnt) > 0)) {
      return res.status(400).json({ error: 'This SLID already has derived products; create pavers from slabs that have no other derived products' });
    }
  }
  const b = db.prepare('SELECT block_id FROM blocks WHERE block_id = ?').get(block_id);
  if (!b) return res.status(404).json({ error: 'block not found' });
  if (!slid) {
    const slabCnt = db.prepare('SELECT COUNT(1) as cnt FROM slabs WHERE block_id = ?').get(block_id);
    if (slabCnt && Number(slabCnt.cnt) > 0) return res.status(400).json({ error: 'Block has slabs; create derived products from slabs using their SLID' });
  }
  const paver_id = `PAV-${uuidv4().split('-')[0].toUpperCase()}`;
  const source = slid ? 'slab' : 'block';
  const normSlid = slid ? String(slid).trim().toUpperCase() : null;
  const stmt = db.prepare('INSERT INTO pavers (paver_id, block_id, slid, thickness_mm, length_mm, width_mm, height_mm, finish, pattern, pieces_count, batch_id, yard_location, status, qc_status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  stmt.run(paver_id, block_id || null, normSlid, thickness_mm || null, length_mm || null, width_mm || null, height_mm || null, finish || null, pattern || null, pieces_count || 0, batch_id || null, yard_location || null, status || null, qc_status || null, source);
  res.status(201).json({ paver_id });
});

// Update derived products
app.put('/tiles/:tile_id', (req, res) => {
  const { tile_id } = req.params;
  const existing = db.prepare('SELECT * FROM tiles WHERE tile_id = ?').get(tile_id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (Object.prototype.hasOwnProperty.call(req.body, 'source') && req.body.source !== existing.source) return res.status(400).json({ error: 'source is read-only' });
  const merged = Object.assign({}, existing, req.body);
  // Resolve/validate block_id relative to slid
  if (merged.slid) {
    merged.slid = String(merged.slid).trim().toUpperCase();
    const slabRow = db.prepare('SELECT slid, block_id FROM slabs WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
    if (!slabRow) return res.status(404).json({ error: 'slab not found' });
    if (!merged.block_id) merged.block_id = slabRow.block_id;
    else if (String(merged.block_id) !== String(slabRow.block_id)) return res.status(400).json({ error: 'block_id does not match slab\'s block_id' });
  }
  // Enforce SLID exclusivity when changing/setting slid
  if (merged.slid) {
    const existingSlidNorm = existing.slid ? String(existing.slid).trim().toUpperCase() : null;
    if (existingSlidNorm !== merged.slid) {
      const cobbleCnt = db.prepare('SELECT COUNT(1) as cnt FROM cobbles WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
      const monCnt = db.prepare('SELECT COUNT(1) as cnt FROM monuments WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
      const pavCnt = db.prepare('SELECT COUNT(1) as cnt FROM pavers WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
      if ((cobbleCnt && Number(cobbleCnt.cnt) > 0) || (monCnt && Number(monCnt.cnt) > 0) || (pavCnt && Number(pavCnt.cnt) > 0)) {
        return res.status(400).json({ error: 'This SLID already has cobbles, monuments, or pavers; cannot assign to tile' });
      }
    }
  }
  if (merged.block_id) {
    const b = db.prepare('SELECT block_id FROM blocks WHERE block_id = ?').get(merged.block_id);
    if (!b) return res.status(404).json({ error: 'block not found' });
    // Prevent linking/updating derived product directly to a block that already has slabs
    if (!merged.slid) {
      const slabCnt = db.prepare('SELECT COUNT(1) as cnt FROM slabs WHERE block_id = ?').get(merged.block_id);
      if (slabCnt && Number(slabCnt.cnt) > 0) return res.status(400).json({ error: 'Block already has slabs; update derived product using SLID instead of block_id' });
    }
  }
  const stmt = db.prepare('UPDATE tiles SET block_id = COALESCE(?, block_id), slid = COALESCE(?, slid), thickness_mm = COALESCE(?, thickness_mm), length_mm = COALESCE(?, length_mm), width_mm = COALESCE(?, width_mm), finish = COALESCE(?, finish), yield_count = COALESCE(?, yield_count), batch_id = COALESCE(?, batch_id), yard_location = COALESCE(?, yard_location), status = COALESCE(?, status), qc_status = COALESCE(?, qc_status) WHERE tile_id = ?');
  const info = stmt.run(merged.block_id ?? null, merged.slid ?? null, merged.thickness_mm ?? null, merged.length_mm ?? null, merged.width_mm ?? null, merged.finish ?? null, merged.yield_count ?? null, merged.batch_id ?? null, merged.yard_location ?? null, merged.status ?? null, merged.qc_status ?? null, tile_id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ updated: tile_id });
});


app.put('/cobbles/:cobble_id', (req, res) => {
  const { cobble_id } = req.params;
  const existing = db.prepare('SELECT * FROM cobbles WHERE cobble_id = ?').get(cobble_id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (Object.prototype.hasOwnProperty.call(req.body, 'source') && req.body.source !== existing.source) return res.status(400).json({ error: 'source is read-only' });
  const merged = Object.assign({}, existing, req.body);
  if (merged.slid) {
    merged.slid = String(merged.slid).trim().toUpperCase();
    const slabRow = db.prepare('SELECT slid, block_id FROM slabs WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
    if (!slabRow) return res.status(404).json({ error: 'slab not found' });
    if (!merged.block_id) merged.block_id = slabRow.block_id;
    else if (String(merged.block_id) !== String(slabRow.block_id)) return res.status(400).json({ error: 'block_id does not match slab\'s block_id' });
    const existingSlidNorm = existing.slid ? String(existing.slid).trim().toUpperCase() : null;
    if (existingSlidNorm !== merged.slid) {
      const tileCnt = db.prepare('SELECT COUNT(1) as cnt FROM tiles WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
      const monCnt = db.prepare('SELECT COUNT(1) as cnt FROM monuments WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
      const pavCnt = db.prepare('SELECT COUNT(1) as cnt FROM pavers WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
      if ((tileCnt && Number(tileCnt.cnt) > 0) || (monCnt && Number(monCnt.cnt) > 0) || (pavCnt && Number(pavCnt.cnt) > 0)) {
        return res.status(400).json({ error: 'This SLID already has tiles, monuments, or pavers; cannot assign to cobble' });
      }
    }
    // stone_type is not stored on cobbles; slab material checks happen server-side earlier and assignments are not persisted here
  }
  if (merged.block_id) {
    const b = db.prepare('SELECT block_id FROM blocks WHERE block_id = ?').get(merged.block_id);
    if (!b) return res.status(404).json({ error: 'block not found' });
    if (!merged.slid) {
      const slabCnt = db.prepare('SELECT COUNT(1) as cnt FROM slabs WHERE block_id = ?').get(merged.block_id);
      if (slabCnt && Number(slabCnt.cnt) > 0) return res.status(400).json({ error: 'Block already has slabs; update derived product using SLID instead of block_id' });
    }
  }
  const stmt = db.prepare('UPDATE cobbles SET block_id = COALESCE(?, block_id), slid = COALESCE(?, slid), length_mm = COALESCE(?, length_mm), width_mm = COALESCE(?, width_mm), height_mm = COALESCE(?, height_mm), shape = COALESCE(?, shape), finish = COALESCE(?, finish), pieces_count = COALESCE(?, pieces_count), batch_id = COALESCE(?, batch_id), yard_location = COALESCE(?, yard_location), status = COALESCE(?, status), qc_status = COALESCE(?, qc_status) WHERE cobble_id = ?');
  const info = stmt.run(merged.block_id ?? null, merged.slid ?? null, merged.length_mm ?? null, merged.width_mm ?? null, merged.height_mm ?? null, merged.shape ?? null, merged.finish ?? null, merged.pieces_count ?? null, merged.batch_id ?? null, merged.yard_location ?? null, merged.status ?? null, merged.qc_status ?? null, cobble_id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ updated: cobble_id });
});

app.put('/monuments/:monument_id', (req, res) => {
  const { monument_id } = req.params;
  const existing = db.prepare('SELECT * FROM monuments WHERE monument_id = ?').get(monument_id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (Object.prototype.hasOwnProperty.call(req.body, 'source') && req.body.source !== existing.source) return res.status(400).json({ error: 'source is read-only' });
  const merged = Object.assign({}, existing, req.body);
  if (merged.slid) {
    merged.slid = String(merged.slid).trim().toUpperCase();
    const slabRow = db.prepare('SELECT slid, block_id FROM slabs WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
    if (!slabRow) return res.status(404).json({ error: 'slab not found' });
    if (!merged.block_id) merged.block_id = slabRow.block_id;
    else if (String(merged.block_id) !== String(slabRow.block_id)) return res.status(400).json({ error: 'block_id does not match slab\'s block_id' });
    const existingSlidNorm = existing.slid ? String(existing.slid).trim().toUpperCase() : null;
    if (existingSlidNorm !== merged.slid) {
      const tileCnt = db.prepare('SELECT COUNT(1) as cnt FROM tiles WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
      const cobbleCnt = db.prepare('SELECT COUNT(1) as cnt FROM cobbles WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
      const pavCnt = db.prepare('SELECT COUNT(1) as cnt FROM pavers WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
      if ((tileCnt && Number(tileCnt.cnt) > 0) || (cobbleCnt && Number(cobbleCnt.cnt) > 0) || (pavCnt && Number(pavCnt.cnt) > 0)) {
        return res.status(400).json({ error: 'This SLID already has tiles, cobbles, or pavers; cannot assign to monument' });
      }
    }
    // enforce stone_type consistency with slab on update
    const slabRowFull = db.prepare('SELECT stone_type FROM slabs WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
    const slabType = slabRowFull && slabRowFull.stone_type ? String(slabRowFull.stone_type).trim().toLowerCase() : null;
    if (slabType) {
      if (merged.stone_type && String(merged.stone_type).trim().toLowerCase() !== slabType) {
        return res.status(400).json({ error: `slab stone_type (${slabType}) incompatible with requested derived stone_type (${merged.stone_type})` });
      }
      merged.stone_type = slabType;
    }
  }
  if (merged.block_id) {
    const b = db.prepare('SELECT block_id FROM blocks WHERE block_id = ?').get(merged.block_id);
    if (!b) return res.status(404).json({ error: 'block not found' });
    if (!merged.slid) {
      const slabCnt = db.prepare('SELECT COUNT(1) as cnt FROM slabs WHERE block_id = ?').get(merged.block_id);
      if (slabCnt && Number(slabCnt.cnt) > 0) return res.status(400).json({ error: 'Block already has slabs; update derived product using SLID instead of block_id' });
    }
  }
  const stmt = db.prepare('UPDATE monuments SET block_id = COALESCE(?, block_id), slid = COALESCE(?, slid), length_mm = COALESCE(?, length_mm), width_mm = COALESCE(?, width_mm), height_mm = COALESCE(?, height_mm), style = COALESCE(?, style), customer = COALESCE(?, customer), order_no = COALESCE(?, order_no), batch_id = COALESCE(?, batch_id), yard_location = COALESCE(?, yard_location), status = COALESCE(?, status), qc_status = COALESCE(?, qc_status) WHERE monument_id = ?');
  const info = stmt.run(merged.block_id ?? null, merged.slid ?? null, merged.length_mm ?? null, merged.width_mm ?? null, merged.height_mm ?? null, merged.style ?? null, merged.customer ?? null, merged.order_no ?? null, merged.batch_id ?? null, merged.yard_location ?? null, merged.status ?? null, merged.qc_status ?? null, monument_id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ updated: monument_id });
});

app.put('/pavers/:paver_id', (req, res) => {
  const { paver_id } = req.params;
  const existing = db.prepare('SELECT * FROM pavers WHERE paver_id = ?').get(paver_id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (Object.prototype.hasOwnProperty.call(req.body, 'source') && req.body.source !== existing.source) return res.status(400).json({ error: 'source is read-only' });
  const merged = Object.assign({}, existing, req.body);
  if (merged.slid) {
    merged.slid = String(merged.slid).trim().toUpperCase();
    const slabRow = db.prepare('SELECT slid, block_id FROM slabs WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
    if (!slabRow) return res.status(404).json({ error: 'slab not found' });
    if (!merged.block_id) merged.block_id = slabRow.block_id;
    else if (String(merged.block_id) !== String(slabRow.block_id)) return res.status(400).json({ error: 'block_id does not match slab\'s block_id' });

    // Require slab stone_type and enforce family reservation
    const slabRowFull = db.prepare('SELECT stone_type FROM slabs WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
    const slabType = slabRowFull && slabRowFull.stone_type ? String(slabRowFull.stone_type).trim().toLowerCase() : null;
    if (!slabType) return res.status(400).json({ error: 'slab stone_type is required when assigning a SLID' });
    if (['tiles', 'cobbles', 'monuments', 'pavers'].includes(slabType) && slabType !== 'pavers') {
      return res.status(400).json({ error: `This SLID is reserved for ${slabType}; cannot assign to paver` });
    }
    if (merged.stone_type && String(merged.stone_type).trim().toLowerCase() !== slabType) {
      return res.status(400).json({ error: `slab stone_type (${slabType}) incompatible with requested derived stone_type (${merged.stone_type})` });
    }

    const existingSlidNorm = existing.slid ? String(existing.slid).trim().toUpperCase() : null;
    if (existingSlidNorm !== merged.slid) {
      const tileCnt = db.prepare('SELECT COUNT(1) as cnt FROM tiles WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
      const cobbleCnt = db.prepare('SELECT COUNT(1) as cnt FROM cobbles WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
      const monCnt = db.prepare('SELECT COUNT(1) as cnt FROM monuments WHERE UPPER(TRIM(slid)) = ?').get(merged.slid);
      if ((tileCnt && Number(tileCnt.cnt) > 0) || (cobbleCnt && Number(cobbleCnt.cnt) > 0) || (monCnt && Number(monCnt.cnt) > 0)) {
        return res.status(400).json({ error: 'This SLID already has other derived products; cannot assign to paver' });
      }
    }
  }
  if (merged.block_id) {
    const b = db.prepare('SELECT block_id FROM blocks WHERE block_id = ?').get(merged.block_id);
    if (!b) return res.status(404).json({ error: 'block not found' });
    if (!merged.slid) {
      const slabCnt = db.prepare('SELECT COUNT(1) as cnt FROM slabs WHERE block_id = ?').get(merged.block_id);
      if (slabCnt && Number(slabCnt.cnt) > 0) return res.status(400).json({ error: 'Block already has slabs; update derived product using SLID instead of block_id' });
    }
  }
  const stmt = db.prepare('UPDATE pavers SET block_id = COALESCE(?, block_id), slid = COALESCE(?, slid), thickness_mm = COALESCE(?, thickness_mm), length_mm = COALESCE(?, length_mm), width_mm = COALESCE(?, width_mm), height_mm = COALESCE(?, height_mm), finish = COALESCE(?, finish), pattern = COALESCE(?, pattern), pieces_count = COALESCE(?, pieces_count), batch_id = COALESCE(?, batch_id), yard_location = COALESCE(?, yard_location), status = COALESCE(?, status), qc_status = COALESCE(?, qc_status) WHERE paver_id = ?');
  const info = stmt.run(merged.block_id ?? null, merged.slid ?? null, merged.thickness_mm ?? null, merged.length_mm ?? null, merged.width_mm ?? null, merged.height_mm ?? null, merged.finish ?? null, merged.pattern ?? null, merged.pieces_count ?? null, merged.batch_id ?? null, merged.yard_location ?? null, merged.status ?? null, merged.qc_status ?? null, paver_id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ updated: paver_id });
});

// Delete derived products
app.delete('/tiles/:tile_id', (req, res) => {
  const { tile_id } = req.params;
  const info = db.prepare('DELETE FROM tiles WHERE tile_id = ?').run(tile_id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: tile_id });
});

app.delete('/cobbles/:cobble_id', (req, res) => {
  const { cobble_id } = req.params;
  const info = db.prepare('DELETE FROM cobbles WHERE cobble_id = ?').run(cobble_id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: cobble_id });
});

app.delete('/monuments/:monument_id', (req, res) => {
  const { monument_id } = req.params;
  const info = db.prepare('DELETE FROM monuments WHERE monument_id = ?').run(monument_id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: monument_id });
});

app.delete('/pavers/:paver_id', (req, res) => {
  const { paver_id } = req.params;
  const info = db.prepare('DELETE FROM pavers WHERE paver_id = ?').run(paver_id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ deleted: paver_id });
});

// Admin: set split cap for QBIDs even if children exist; logs an event per change
app.post('/admin/set-split-cap', (req, res) => {
  const { qbid, cap, qbids } = req.body || {};
  const stmt = db.prepare('UPDATE qbids SET splitable_blk_count = ? WHERE qbid = ?');
  const insEvent = db.prepare('INSERT INTO events (id, ref_type, ref_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)');
  const doOne = (id, value) => {
    const slabCnt = db.prepare('SELECT COUNT(1) as cnt FROM slabs WHERE block_id IN (SELECT block_id FROM blocks WHERE parent_qbid = ?)').get(id);
    if (slabCnt && Number(slabCnt.cnt) > 0) throw new Error('locked: slabs established for ' + id);
    const prev = db.prepare('SELECT splitable_blk_count FROM qbids WHERE qbid = ?').get(id);
    if (!prev) throw new Error('qbid not found: ' + id);
    stmt.run(value, id);
    const payload = JSON.stringify({ old_cap: prev.splitable_blk_count, new_cap: value });
    insEvent.run(uuidv4(), 'qbids', id, 'ADMIN_SET_SPLIT_CAP', payload);
  };
  try {
    if (qbid !== undefined && cap !== undefined) {
      doOne(String(qbid), Number(cap));
      return res.json({ updated: 1 });
    }
    if (Array.isArray(qbids) && qbids.length) {
      const tran = db.transaction((list) => {
        for (const item of list) doOne(String(item.qbid), Number(item.cap));
      });
      tran(qbids);
      return res.json({ updated: qbids.length });
    }
    return res.status(400).json({ error: 'provide { qbid, cap } or { qbids: [{qbid, cap}, ...] }' });
  } catch (err) {
    console.error('set-split-cap failed', err);
    return res.status(500).json({ error: 'set-split-cap failed' });
  }
});

// Admin: set stone type regardless of child blocks
app.post('/admin/set-stone-type', (req, res) => {
  const { qbid, stone_type } = req.body || {};
  if (!qbid) return res.status(400).json({ error: 'qbid required' });
  const row = db.prepare('SELECT * FROM qbids WHERE qbid = ?').get(String(qbid));
  if (!row) return res.status(404).json({ error: 'QBID not found' });
  const slabCnt = db.prepare('SELECT COUNT(1) as cnt FROM slabs WHERE block_id IN (SELECT block_id FROM blocks WHERE parent_qbid = ?)').get(String(qbid));
  if (slabCnt && Number(slabCnt.cnt) > 0) return res.status(400).json({ error: 'QBID updates are locked once slabs exist' });
  const allowed = [null, '', ...Object.keys(STONE_DENSITY_KG_M3)];
  const val = (stone_type === undefined || stone_type === null) ? null : String(stone_type).toLowerCase();
  if (!allowed.includes(val)) return res.status(400).json({ error: 'invalid stone_type' });
  // If weight isn't set (or is 0) and size is available, auto-calc weight on stone_type update.
  const existingWeight = toNum(row.weight_kg);
  const shouldAutoWeight = (existingWeight === null || existingWeight === 0) && row.size_mm && val;
  const computed = shouldAutoWeight ? computeWeightKgFromSizeMmAndStoneType(row.size_mm, val) : null;
  if (computed && Number.isFinite(computed.weight_kg)) {
    db.prepare('UPDATE qbids SET stone_type = ?, weight_kg = ? WHERE qbid = ?').run(val, computed.weight_kg, String(qbid));
  } else {
    db.prepare('UPDATE qbids SET stone_type = ? WHERE qbid = ?').run(val, String(qbid));
  }
  const payload = JSON.stringify({ stone_type: val, ...(computed ? { weight_kg: computed.weight_kg } : {}) });
  db.prepare('INSERT INTO events (id, ref_type, ref_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
    .run(uuidv4(), 'qbids', String(qbid), 'ADMIN_SET_STONE_TYPE', payload);
  res.json({ updated: String(qbid), stone_type: val });
});

// Admin: recompute QBID weight_kg from size_mm + stone_type for existing records.
// Useful for older rows created before auto-calculation existed.
// Body options:
// - { qbid: 'qbid-...' } recompute one
// - { qbids: ['qbid-...','qbid-...'] } recompute many
// - { only_when_zero: true } (default true) only update rows with weight_kg NULL/0
app.post('/admin/recompute-qbid-weights', (req, res) => {
  try {
    const body = req.body || {};
    const onlyWhenZero = (body.only_when_zero === undefined) ? true : !!body.only_when_zero;

    let targets = [];
    if (body.qbid) targets = [String(body.qbid)];
    else if (Array.isArray(body.qbids) && body.qbids.length) targets = body.qbids.map(x => String(x));

    let rows;
    if (targets.length) {
      const inClause = targets.map(() => '?').join(',');
      rows = db.prepare(`SELECT qbid, stone_type, size_mm, weight_kg FROM qbids WHERE qbid IN (${inClause})`).all(...targets);
    } else {
      rows = db.prepare('SELECT qbid, stone_type, size_mm, weight_kg FROM qbids').all();
    }

    const update = db.prepare('UPDATE qbids SET weight_kg = ? WHERE qbid = ?');
    const updated = [];
    const skipped = [];

    const tran = db.transaction(() => {
      for (const r of rows) {
        const existingWeight = toNum(r.weight_kg);
        if (onlyWhenZero && !(existingWeight === null || existingWeight === 0)) {
          skipped.push({ qbid: r.qbid, reason: 'weight_nonzero' });
          continue;
        }
        const computed = computeWeightKgFromSizeMmAndStoneType(r.size_mm, r.stone_type);
        if (!computed || !Number.isFinite(computed.weight_kg)) {
          skipped.push({ qbid: r.qbid, reason: 'insufficient_data' });
          continue;
        }
        update.run(computed.weight_kg, r.qbid);
        updated.push({ qbid: r.qbid, weight_kg: computed.weight_kg, density_kg_m3: computed.density_kg_m3, volume_m3: computed.volume_m3 });
      }
    });

    tran();
    res.json({ updated_count: updated.length, skipped_count: skipped.length, updated, skipped });
  } catch (err) {
    console.error('recompute-qbid-weights failed', err);
    res.status(500).json({ error: 'recompute-qbid-weights failed' });
  }
});

// Simple inventory queries
app.get('/inventory/blocks', (req, res) => {
  const rows = db.prepare('SELECT * FROM blocks').all();
  res.json(rows);
});

app.get('/inventory/slabs', (req, res) => {
  const rows = db.prepare('SELECT * FROM slabs').all();
  res.json(rows);
});

app.get('/inventory/tiles', (req, res) => {
  const rows = db.prepare('SELECT * FROM tiles').all();
  res.json(rows);
});

app.get('/inventory/cobbles', (req, res) => {
  const rows = db.prepare('SELECT * FROM cobbles').all();
  res.json(rows);
});

app.get('/inventory/monuments', (req, res) => {
  const rows = db.prepare('SELECT * FROM monuments').all();
  res.json(rows);
});

// Returns usage counts of a SLID across derived-product families
app.get('/slabs/:slid/usage', (req, res) => {
  const { slid } = req.params;
  const slab = db.prepare('SELECT slid FROM slabs WHERE slid = ?').get(slid);
  if (!slab) return res.status(404).json({ error: 'slab not found' });
  const tiles = db.prepare('SELECT COUNT(1) as cnt FROM tiles WHERE slid = ?').get(slid);
  const cobbles = db.prepare('SELECT COUNT(1) as cnt FROM cobbles WHERE slid = ?').get(slid);
  const monuments = db.prepare('SELECT COUNT(1) as cnt FROM monuments WHERE slid = ?').get(slid);
  const pavers = db.prepare('SELECT COUNT(1) as cnt FROM pavers WHERE slid = ?').get(slid);
  res.json({ tiles: Number(tiles.cnt || 0), cobbles: Number(cobbles.cnt || 0), monuments: Number(monuments.cnt || 0), pavers: Number(pavers.cnt || 0) });
});

// Start server
// run a cleanup at startup to remove any orphaned blocks (safe no-op when none)
try {
  const deleted = cleanupOrphanedBlocks();
  if (deleted && deleted > 0) console.log(`cleanup: deleted ${deleted} orphaned blocks at startup`);
} catch (err) {
  console.error('cleanup at startup failed', err);
}

if (require.main === module) {
  const sslKeyPath = process.env.SSL_KEY_PATH;
  const sslCertPath = process.env.SSL_CERT_PATH;
  const enableHttps = !!(sslKeyPath && sslCertPath);

  if (enableHttps) {
    try {
      const key = fs.readFileSync(String(sslKeyPath));
      const cert = fs.readFileSync(String(sslCertPath));
      https.createServer({ key, cert }, app).listen(PORT, () => {
        console.log(`modernex-inventory listening on https://localhost:${PORT}`);
      });
    } catch (e) {
      console.error('Failed to start HTTPS server. Check SSL_KEY_PATH and SSL_CERT_PATH.', e);
      process.exitCode = 1;
    }
  } else {
    http.createServer(app).listen(PORT, () => {
      console.log(`modernex-inventory listening on http://localhost:${PORT}`);
    });
  }
}

module.exports = app;
