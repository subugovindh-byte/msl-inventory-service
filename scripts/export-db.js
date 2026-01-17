#!/usr/bin/env node

/*
  Export an entire SQLite database used by inventory-service.

  Formats:
  - db  (default): copies the .db file (fastest, includes schema + data)
  - sql: generates a portable .sql dump (schema + INSERTs)

  DB selection matches the app:
  - DB_FILE: absolute or relative path
  - DB_NAME: <name>.db under project root
  - default: test_ui.db

  Examples:
    node scripts/export-db.js --out ./exports/dev-snapshot.db
    DB_NAME=dev node scripts/export-db.js --format sql --out ./exports/dev.sql
    node scripts/export-db.js --db-name test_ui --out ./exports/test_ui.db
*/

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function projectRoot() {
  return path.resolve(__dirname, '..');
}

function resolveDbFileFromEnv(root) {
  const envFile = process.env.DB_FILE;
  const envName = process.env.DB_NAME;
  if (envFile && envFile.trim()) {
    const p = envFile.includes(path.sep) ? envFile : path.join(root, envFile);
    return path.resolve(p);
  }
  if (envName && envName.trim()) {
    return path.join(root, `${envName}.db`);
  }
  return path.join(root, 'test_ui.db');
}

function resolveDbFile({ root, dbName, dbFile }) {
  if (dbFile && dbFile.trim()) {
    const p = dbFile.includes(path.sep) ? dbFile : path.join(root, dbFile);
    return path.resolve(p);
  }
  if (dbName && dbName.trim()) {
    return path.join(root, `${dbName}.db`);
  }
  return resolveDbFileFromEnv(root);
}

function ensureDir(p) {
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
}

function tsSafe() {
  const d = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad2(d.getMonth() + 1),
    pad2(d.getDate()),
    '-',
    pad2(d.getHours()),
    pad2(d.getMinutes()),
    pad2(d.getSeconds())
  ].join('');
}

function defaultOutPath(root, dbFile, format) {
  const base = path.basename(dbFile, '.db');
  const dir = path.join(root, 'exports');
  const ext = format === 'sql' ? 'sql' : 'db';
  return path.join(dir, `${base}-${tsSafe()}.${ext}`);
}

function sqlEscapeValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'NULL';
    return String(v);
  }
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  // Dates are typically stored as text; stringify.
  const s = String(v);
  return `'${s.replace(/'/g, "''")}'`;
}

function preferredTableOrder() {
  // Rough parent->child ordering to reduce FK issues for imports.
  return [
    'materials',
    'suppliers',
    'qbids',
    'blocks',
    'parent_child',
    'slabs',
    'tiles',
    'cobbles',
    'monuments',
    'pavers',
    'events',
    'slab_events',
    'dispatches'
  ];
}

function listUserTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(r => r.name);
}

function dumpSql(dbFile, outFile) {
  const db = new Database(dbFile, { readonly: true });
  try {
    const lines = [];
    lines.push('-- ModernEx inventory-service export (SQL dump)');
    lines.push(`-- Source: ${path.basename(dbFile)}`);
    lines.push(`-- Created: ${new Date().toISOString()}`);
    lines.push('PRAGMA foreign_keys=OFF;');
    lines.push('BEGIN;');

    // Schema objects (tables, indexes, triggers, views)
    const objects = db
      .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'trigger' THEN 3 WHEN 'view' THEN 4 ELSE 9 END, name")
      .all();

    for (const obj of objects) {
      const stmt = String(obj.sql || '').trim();
      if (!stmt) continue;
      // Use IF NOT EXISTS for tables/indexes when possible.
      if (obj.type === 'table' && !/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(stmt)) {
        lines.push(stmt.replace(/^CREATE\s+TABLE/i, 'CREATE TABLE IF NOT EXISTS') + ';');
      } else if (obj.type === 'index' && !/^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i.test(stmt)) {
        lines.push(stmt.replace(/^CREATE\s+INDEX/i, 'CREATE INDEX IF NOT EXISTS') + ';');
      } else {
        lines.push(stmt.endsWith(';') ? stmt : (stmt + ';'));
      }
    }

    lines.push('');
    lines.push('-- Data');

    const tables = listUserTables(db);
    const preferred = preferredTableOrder();
    const ordered = [];
    for (const t of preferred) if (tables.includes(t)) ordered.push(t);
    for (const t of tables) if (!ordered.includes(t)) ordered.push(t);

    for (const table of ordered) {
      const cols = db.prepare(`PRAGMA table_info('${table.replace(/'/g, "''")}')`).all().map(r => r.name);
      if (!cols.length) continue;
      const colList = cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(', ');
      const rows = db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}"`).all();
      if (!rows.length) continue;
      lines.push(`-- ${table} (${rows.length} row(s))`);
      for (const row of rows) {
        const values = cols.map(c => sqlEscapeValue(row[c]));
        lines.push(`INSERT INTO "${table.replace(/"/g, '""')}" (${colList}) VALUES (${values.join(', ')});`);
      }
      lines.push('');
    }

    lines.push('COMMIT;');
    lines.push('PRAGMA foreign_keys=ON;');

    ensureDir(outFile);
    fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf8');
  } finally {
    try { db.close(); } catch (_) {}
  }
}

function main() {
  const root = projectRoot();
  const formatRaw = (argValue('--format', 'db') || 'db').toLowerCase();
  const format = (formatRaw === 'sql') ? 'sql' : 'db';

  const dbName = argValue('--db-name', null);
  const dbFileArg = argValue('--db-file', null);

  const dbFile = resolveDbFile({ root, dbName, dbFile: dbFileArg });
  if (!fs.existsSync(dbFile)) {
    console.error(`DB file not found: ${dbFile}`);
    process.exit(2);
  }

  const out = argValue('--out', null) || defaultOutPath(root, dbFile, format);

  ensureDir(out);

  if (format === 'db') {
    fs.copyFileSync(dbFile, out);
    console.log(`[OK] Exported DB snapshot: ${dbFile} -> ${out}`);
    return;
  }

  dumpSql(dbFile, out);
  console.log(`[OK] Exported SQL dump: ${dbFile} -> ${out}`);
}

main();
