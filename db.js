const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Database selection: allow override via env
// - DB_FILE: absolute or relative path to the SQLite file
// - DB_NAME: logical name; file will be <name>.db under this directory
const resolveDbFile = () => {
  const envFile = process.env.DB_FILE;
  const envName = process.env.DB_NAME;
  if (envFile && envFile.trim()) {
    const p = envFile.includes(path.sep) ? envFile : path.join(__dirname, envFile);
    return path.resolve(p);
  }
  if (envName && envName.trim()) {
    return path.join(__dirname, `${envName}.db`);
  }
  return path.join(__dirname, 'dev.db');
};

const DB_FILE = resolveDbFile();
const db = new Database(DB_FILE);

function migrate() {
  try { console.log('db file:', DB_FILE); } catch (e) {}
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS qbids (
      qbid TEXT PRIMARY KEY,
      supplier TEXT,
      quarry TEXT,
      weight_kg REAL,
      size_mm TEXT,
      grade TEXT,
      received_date TEXT
    );

    -- add cost columns to qbids (gross, transport, other, total)
    -- stored as REAL; total_cost computed/maintained by the API


    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      contact TEXT,
      material TEXT,
      quarry_location TEXT,
      notes TEXT,
      address TEXT,
      phone TEXT,
      email TEXT
    );

    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS blocks (
      block_id TEXT PRIMARY KEY,
      parent_qbid TEXT,
      grade TEXT,
      FOREIGN KEY(parent_qbid) REFERENCES qbids(qbid)
    );

    -- ensure common metadata columns exist for blocks (safe add)
  `);

  // Add commonly requested block metadata columns safely.
  // IMPORTANT: do each ALTER separately; otherwise a single "duplicate column" error
  // prevents later columns from being added, which can cause runtime 500s.
  const safeAlter = (sql) => {
    try { db.exec(sql); } catch (e) {}
  };
  safeAlter("ALTER TABLE blocks ADD COLUMN short_code TEXT;");
  safeAlter("ALTER TABLE blocks ADD COLUMN local_block_code TEXT;");
  safeAlter("ALTER TABLE blocks ADD COLUMN global_block_code TEXT;");
  safeAlter("ALTER TABLE blocks ADD COLUMN receipt_id TEXT;");
  safeAlter("ALTER TABLE blocks ADD COLUMN receipt_date TEXT;");
  safeAlter("ALTER TABLE blocks ADD COLUMN source_id TEXT;");
  safeAlter("ALTER TABLE blocks ADD COLUMN source_name TEXT;");
  safeAlter("ALTER TABLE blocks ADD COLUMN global_block_id TEXT;");
  safeAlter("ALTER TABLE blocks ADD COLUMN material TEXT;");
  safeAlter("ALTER TABLE blocks ADD COLUMN description TEXT;");
  safeAlter("ALTER TABLE blocks ADD COLUMN length_mm REAL;");
  safeAlter("ALTER TABLE blocks ADD COLUMN width_mm REAL;");
  safeAlter("ALTER TABLE blocks ADD COLUMN height_mm REAL;");
  safeAlter("ALTER TABLE blocks ADD COLUMN volume_m3 REAL;");
  safeAlter("ALTER TABLE blocks ADD COLUMN no_slabs INTEGER;");
  safeAlter("ALTER TABLE blocks ADD COLUMN no_wastage_slabs INTEGER;");
  safeAlter("ALTER TABLE blocks ADD COLUMN yard_location TEXT;");
  safeAlter("ALTER TABLE blocks ADD COLUMN status TEXT;");
  safeAlter("ALTER TABLE blocks ADD COLUMN notes TEXT;");

    try {
      // Add material_type to qbids table if missing
      db.exec("ALTER TABLE qbids ADD COLUMN material_type TEXT;");
      // Add normalized material_id (FK) to qbids
      db.exec("ALTER TABLE qbids ADD COLUMN material_id INTEGER;");
      // Add supplier_id to qbids for normalized suppliers
      try { db.exec("ALTER TABLE qbids ADD COLUMN supplier_id INTEGER;"); } catch (e) {}
      // Add cost columns to qbids
      try { db.exec("ALTER TABLE qbids ADD COLUMN gross_cost REAL;"); } catch (e) {}
      try { db.exec("ALTER TABLE qbids ADD COLUMN transport_cost REAL;"); } catch (e) {}
      try { db.exec("ALTER TABLE qbids ADD COLUMN other_cost REAL;"); } catch (e) {}
      try { db.exec("ALTER TABLE qbids ADD COLUMN total_cost REAL;"); } catch (e) {}
    } catch (e) {
      // ignore if exists
    }
    try {
      // Add contact details to suppliers if missing
      db.exec("ALTER TABLE suppliers ADD COLUMN address TEXT;");
      db.exec("ALTER TABLE suppliers ADD COLUMN phone TEXT;");
      db.exec("ALTER TABLE suppliers ADD COLUMN email TEXT;");
      db.exec("ALTER TABLE suppliers ADD COLUMN material TEXT;");
      db.exec("ALTER TABLE suppliers ADD COLUMN quarry_location TEXT;");
    } catch (e) {}
    try {
      // Add splitable block count column to qbids
      db.exec("ALTER TABLE qbids ADD COLUMN splitable_blk_count INTEGER;");
    } catch (e) {
      // ignore if exists
    }
    try {
      // Add short_code to materials for normalized short names
      db.exec("ALTER TABLE materials ADD COLUMN short_code TEXT;");
    } catch (e) {
      // ignore if exists
    }
  db.exec(`

    CREATE TABLE IF NOT EXISTS parent_child (
      parent_qbid TEXT,
      child_block_id TEXT,
      PRIMARY KEY (parent_qbid, child_block_id)
    );

    CREATE TABLE IF NOT EXISTS slabs (
      slid TEXT PRIMARY KEY,
      block_id TEXT,
      thickness_mm REAL,
      machine_id TEXT,
      slabs_yield INTEGER,
      FOREIGN KEY(block_id) REFERENCES blocks(block_id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      ref_type TEXT,
      ref_id TEXT,
      event_type TEXT,
      payload TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS slab_events (
      id TEXT PRIMARY KEY,
      slid TEXT,
      action TEXT,
      payload TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS dispatches (
      id TEXT PRIMARY KEY,
      slid TEXT,
      customer TEXT,
      bundle_no TEXT,
      container_no TEXT,
      dispatched_at TEXT
    );

    -- Derived products
    CREATE TABLE IF NOT EXISTS tiles (
      tile_id TEXT PRIMARY KEY,
      block_id TEXT,
      slid TEXT,
      thickness_mm REAL,
      length_mm REAL,
      width_mm REAL,
      finish TEXT,
      yield_count INTEGER,
      batch_id TEXT,
      yard_location TEXT,
      status TEXT,
      qc_status TEXT,
      FOREIGN KEY(block_id) REFERENCES blocks(block_id),
      FOREIGN KEY(slid) REFERENCES slabs(slid)
    );

    CREATE TABLE IF NOT EXISTS cobbles (
      cobble_id TEXT PRIMARY KEY,
      block_id TEXT,
      slid TEXT,
      length_mm REAL,
      width_mm REAL,
      height_mm REAL,
      shape TEXT,
      finish TEXT,
      pieces_count INTEGER,
      batch_id TEXT,
      yard_location TEXT,
      status TEXT,
      qc_status TEXT,
      FOREIGN KEY(block_id) REFERENCES blocks(block_id),
      FOREIGN KEY(slid) REFERENCES slabs(slid)
    );

    CREATE TABLE IF NOT EXISTS monuments (
      monument_id TEXT PRIMARY KEY,
      block_id TEXT,
      slid TEXT,
      length_mm REAL,
      width_mm REAL,
      height_mm REAL,
      style TEXT,
      customer TEXT,
      order_no TEXT,
      batch_id TEXT,
      yard_location TEXT,
      status TEXT,
      qc_status TEXT,
      FOREIGN KEY(block_id) REFERENCES blocks(block_id),
      FOREIGN KEY(slid) REFERENCES slabs(slid)
    );

    CREATE TABLE IF NOT EXISTS pavers (
      paver_id TEXT PRIMARY KEY,
      block_id TEXT,
      slid TEXT,
      thickness_mm REAL,
      length_mm REAL,
      width_mm REAL,
      height_mm REAL,
      finish TEXT,
      pattern TEXT,
      pieces_count INTEGER,
      batch_id TEXT,
      yard_location TEXT,
      status TEXT,
      qc_status TEXT,
      FOREIGN KEY(block_id) REFERENCES blocks(block_id),
      FOREIGN KEY(slid) REFERENCES slabs(slid)
    );
  `);
  // Safe schema evolution for slabs: add optional batch_id and yard_location
  try { db.exec("ALTER TABLE slabs ADD COLUMN batch_id TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE slabs ADD COLUMN yard_location TEXT;"); } catch (e) {}
  // Add status and qc_status columns to slabs
  try { db.exec("ALTER TABLE slabs ADD COLUMN status TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE slabs ADD COLUMN qc_status TEXT;"); } catch (e) {}
  // Add stone_type columns across entities
  try { db.exec("ALTER TABLE qbids ADD COLUMN stone_type TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE slabs ADD COLUMN stone_type TEXT;"); } catch (e) {}
  // Tiles and Cobblers no longer persist stone_type; remove columns if present
  try {
    // Ensure dispatches has item_type and item_id columns to track dispatched item identity
    try { db.exec("ALTER TABLE dispatches ADD COLUMN item_type TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE dispatches ADD COLUMN item_id TEXT;"); } catch (e) {}
    const hasColumn = (table, col) => {
      const rows = db.prepare(`PRAGMA table_info(${table})`).all();
      return rows.some(r => r.name === col);
    };
    if (hasColumn('tiles', 'stone_type')) {
      // Recreate tiles table without stone_type
      db.exec('BEGIN TRANSACTION;');
      db.exec(`CREATE TABLE IF NOT EXISTS tiles_new (
        tile_id TEXT PRIMARY KEY,
        block_id TEXT,
        slid TEXT,
        thickness_mm REAL,
        length_mm REAL,
        width_mm REAL,
        finish TEXT,
        yield_count INTEGER,
        batch_id TEXT,
        yard_location TEXT,
        status TEXT,
        qc_status TEXT,
        FOREIGN KEY(block_id) REFERENCES blocks(block_id),
        FOREIGN KEY(slid) REFERENCES slabs(slid)
      );`);
      db.exec(`INSERT INTO tiles_new (tile_id, block_id, slid, thickness_mm, length_mm, width_mm, finish, yield_count, batch_id, yard_location, status, qc_status)
        SELECT tile_id, block_id, slid, thickness_mm, length_mm, width_mm, finish, yield_count, batch_id, yard_location, status, qc_status FROM tiles;`);
      db.exec('DROP TABLE tiles;');
      db.exec('ALTER TABLE tiles_new RENAME TO tiles;');
      db.exec('COMMIT;');
    }
    if (hasColumn('cobbles', 'stone_type')) {
      // Recreate cobbles table without stone_type
      db.exec('BEGIN TRANSACTION;');
      db.exec(`CREATE TABLE IF NOT EXISTS cobbles_new (
        cobble_id TEXT PRIMARY KEY,
        block_id TEXT,
        slid TEXT,
        length_mm REAL,
        width_mm REAL,
        height_mm REAL,
        shape TEXT,
        finish TEXT,
        pieces_count INTEGER,
        batch_id TEXT,
        yard_location TEXT,
        status TEXT,
        qc_status TEXT,
        FOREIGN KEY(block_id) REFERENCES blocks(block_id),
        FOREIGN KEY(slid) REFERENCES slabs(slid)
      );`);
      db.exec(`INSERT INTO cobbles_new (cobble_id, block_id, slid, length_mm, width_mm, height_mm, shape, finish, pieces_count, batch_id, yard_location, status, qc_status)
        SELECT cobble_id, block_id, slid, length_mm, width_mm, height_mm, shape, finish, pieces_count, batch_id, yard_location, status, qc_status FROM cobbles;`);
      db.exec('DROP TABLE cobbles;');
      db.exec('ALTER TABLE cobbles_new RENAME TO cobbles;');
      db.exec('COMMIT;');
    }
    if (hasColumn('pavers', 'stone_type')) {
      // Recreate pavers table without stone_type
      db.exec('BEGIN TRANSACTION;');
      db.exec(`CREATE TABLE IF NOT EXISTS pavers_new (
        paver_id TEXT PRIMARY KEY,
        block_id TEXT,
        slid TEXT,
        thickness_mm REAL,
        length_mm REAL,
        width_mm REAL,
        height_mm REAL,
        finish TEXT,
        pattern TEXT,
        pieces_count INTEGER,
        batch_id TEXT,
        yard_location TEXT,
        status TEXT,
        qc_status TEXT,
        FOREIGN KEY(block_id) REFERENCES blocks(block_id),
        FOREIGN KEY(slid) REFERENCES slabs(slid)
      );`);
      db.exec(`INSERT INTO pavers_new (paver_id, block_id, slid, thickness_mm, length_mm, width_mm, height_mm, finish, pattern, pieces_count, batch_id, yard_location, status, qc_status)
        SELECT paver_id, block_id, slid, thickness_mm, length_mm, width_mm, height_mm, finish, pattern, pieces_count, batch_id, yard_location, status, qc_status FROM pavers;`);
      db.exec('DROP TABLE pavers;');
      db.exec('ALTER TABLE pavers_new RENAME TO pavers;');
      db.exec('COMMIT;');
    }
  } catch (e) {
    // If anything fails, rollback and continue — migrations should be best-effort
    try { db.exec('ROLLBACK;'); } catch (e2) {}
  }
  // Remove legacy block code columns if present: local_block_code, global_block_id, global_block_code
  try {
    const has = (col) => db.prepare("PRAGMA table_info('blocks')").all().some(r => r.name === col);
    if (has('local_block_code') || has('global_block_id') || has('global_block_code')) {
      db.exec('BEGIN TRANSACTION;');
      db.exec(`CREATE TABLE IF NOT EXISTS blocks_new (
        block_id TEXT PRIMARY KEY,
        parent_qbid TEXT,
        grade TEXT,
        short_code TEXT,
        receipt_id TEXT,
        receipt_date TEXT,
        source_id TEXT,
        source_name TEXT,
        material TEXT,
        description TEXT,
        length_mm REAL,
        width_mm REAL,
        height_mm REAL,
        volume_m3 REAL,
        no_slabs INTEGER,
        no_wastage_slabs INTEGER,
        yard_location TEXT,
        status TEXT,
        notes TEXT
      );`);
      db.exec(`INSERT INTO blocks_new (block_id, parent_qbid, grade, short_code, receipt_id, receipt_date, source_id, source_name, material, description, length_mm, width_mm, height_mm, volume_m3, no_slabs, no_wastage_slabs, yard_location, status, notes)
        SELECT block_id, parent_qbid, grade, short_code, receipt_id, receipt_date, source_id, source_name, material, description, length_mm, width_mm, height_mm, volume_m3, no_slabs, no_wastage_slabs, yard_location, status, notes FROM blocks;`);
      db.exec('DROP TABLE blocks;');
      db.exec('ALTER TABLE blocks_new RENAME TO blocks;');
      db.exec('COMMIT;');
    }
  } catch (e) {
    try { db.exec('ROLLBACK;'); } catch (e2) {}
  }
  try { db.exec("ALTER TABLE tiles ADD COLUMN source TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE cobbles ADD COLUMN source TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE monuments ADD COLUMN source TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE pavers ADD COLUMN source TEXT;"); } catch (e) {}
  // Ensure supplier_id exists (run again in case earlier add missed it)
  try { db.exec("ALTER TABLE qbids ADD COLUMN supplier_id INTEGER;"); } catch (e) {}
  console.log('migrate: ok');
}

function seed() {
  const q = db.prepare('INSERT OR IGNORE INTO qbids (qbid, supplier, quarry, weight_kg, size_mm, grade, received_date, material_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  q.run('QBID-DEMO1', 'Acme Stone', 'Quarry A', 12000, '2000x1200x1500', 'A', '2025-10-01', 'Paradiso');
  // ensure materials table has the seeded material and link QBID to it
  const im = db.prepare('INSERT OR IGNORE INTO materials (name, description) VALUES (?, ?)');
  im.run('Paradiso', 'Paradiso: Granite, multicolored with swirls of purple, grey, and black');
  const mid = db.prepare('SELECT id FROM materials WHERE name = ?').get('Paradiso').id;
  if (mid) {
    db.prepare('UPDATE qbids SET material_id = ? WHERE qbid = ?').run(mid, 'QBID-DEMO1');
  }
  // sample blocks matching user-provided rows
  const b = db.prepare(`INSERT OR IGNORE INTO blocks (
    block_id, parent_qbid, grade, short_code, description,
    receipt_id, receipt_date, source_id, source_name,
    material, length_mm, width_mm, height_mm, volume_m3,
    yard_location, status, notes, no_slabs, no_wastage_slabs
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  // Row 1
  b.run(
    'PAR-BLOCK-0001', 'QBID-DEMO1', 'Economy', 'PAR', 'Paradiso: Granite, multicolored with swirls of purple, grey, and black',
    'RCPT-001', '2025-12-23', 'SRC-001', 'Vatsin Granite Quarry',
    'Paradiso', 3000, 2000, 1600, 9.6,
    'Yard A', 'Received', 'Quality with black patches', 0, 0
  );

  // Row 2
  b.run(
    'PAR-BLOCK-0002', 'QBID-DEMO1', 'Medium', 'PAR', 'Paradiso: Granite, multicolored with swirls of purple, grey, and black',
    'RCPT-001', '2025-12-27', 'SRC-001', 'Vatsin Granite Quarry',
    'Paradiso', 3000, 2000, 1100, 6.6,
    'Yard A', 'Received', 'quality block', 0, 0
  );

  // Row 3
  b.run(
    'PAR-BLOCK-0003', 'QBID-DEMO1', 'Medium', 'PAR', 'Paradiso: Granite, multicolored with swirls of purple, grey, and black',
    'RCPT-001', '2025-12-27', 'SRC-001', 'Vatsin Granite Quarry',
    'Paradiso', 3000, 2000, 1100, 6.6,
    'Yard A', 'Received', 'quality block (See <attachments> above for file contents.)', 0, 0
  );
  console.log('seed: ok');
}

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--migrate') migrate();
  else if (arg === '--seed') { migrate(); seed(); }
}

module.exports = db;

// Ensure migrations are applied when required by the app (safe no-op if already applied)
try { migrate(); } catch (e) { /* ignore migration errors at require-time */ }
