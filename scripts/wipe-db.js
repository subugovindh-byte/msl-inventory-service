#!/usr/bin/env node

/*
  Wipe all application data from one or more SQLite DB files.

  Safety:
  - Does nothing unless you pass --yes
  - By default targets the same DB selection logic as the app (DB_FILE / DB_NAME / test_ui.db)
  - Use --all-local to wipe dev.db + test_ui.db (excludes prod.db unless --include-prod)

  Examples:
    node scripts/wipe-db.js --yes
    DB_NAME=test_ui node scripts/wipe-db.js --yes
    node scripts/wipe-db.js --all-local --yes
    node scripts/wipe-db.js --all-local --include-prod --yes
*/

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function resolveDbFileFromEnv(projectRoot) {
  const envFile = process.env.DB_FILE;
  const envName = process.env.DB_NAME;
  if (envFile && envFile.trim()) {
    const p = envFile.includes(path.sep) ? envFile : path.join(projectRoot, envFile);
    return path.resolve(p);
  }
  if (envName && envName.trim()) {
    return path.join(projectRoot, `${envName}.db`);
  }
  return path.join(projectRoot, 'test_ui.db');
}

function listTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(r => r.name);
}

function wipeOneDb(dbFile, { vacuum = false } = {}) {
  if (!fs.existsSync(dbFile)) {
    return { dbFile, ok: false, error: 'DB file not found' };
  }

  const db = new Database(dbFile);
  try {
    const tables = new Set(listTables(db));

    // Delete in child->parent order to avoid FK issues (even if FK enforcement is on).
    // We also disable foreign_keys during the wipe for robustness.
    const preferredOrder = [
      'dispatches',
      'slab_events',
      'events',
      'tiles',
      'cobbles',
      'monuments',
      'pavers',
      'slabs',
      'parent_child',
      'blocks',
      'qbids',
      'suppliers',
      'materials'
    ];

    const ordered = [];
    for (const t of preferredOrder) if (tables.has(t)) ordered.push(t);
    for (const t of Array.from(tables)) if (!ordered.includes(t)) ordered.push(t);

    const wipeTx = db.transaction(() => {
      db.pragma('foreign_keys = OFF');
      let deleted = 0;
      for (const t of ordered) {
        const info = db.prepare(`DELETE FROM ${t}`).run();
        deleted += Number(info.changes || 0);
      }

      // Reset AUTOINCREMENT counters if present.
      const hasSeq = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").get();
      if (hasSeq) {
        db.prepare('DELETE FROM sqlite_sequence').run();
      }

      db.pragma('foreign_keys = ON');
      return { deletedRows: deleted, tablesWiped: ordered };
    });

    const result = wipeTx();

    if (vacuum) {
      // VACUUM cannot run inside a transaction.
      db.exec('VACUUM;');
    }

    return { dbFile, ok: true, ...result };
  } catch (e) {
    return { dbFile, ok: false, error: String(e && e.message ? e.message : e) };
  } finally {
    try { db.close(); } catch (_) {}
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  const yes = args.has('--yes');
  const allLocal = args.has('--all-local');
  const includeProd = args.has('--include-prod');
  const vacuum = args.has('--vacuum');

  const projectRoot = path.resolve(__dirname, '..');

  let targets = [];
  if (allLocal) {
    targets.push(path.join(projectRoot, 'dev.db'));
    targets.push(path.join(projectRoot, 'test_ui.db'));
    if (includeProd) targets.push(path.join(projectRoot, 'prod.db'));
  } else {
    targets.push(resolveDbFileFromEnv(projectRoot));
  }

  targets = Array.from(new Set(targets.map(p => path.resolve(p))));

  if (!yes) {
    console.log('Refusing to wipe DB(s) without --yes');
    console.log('Targets:');
    for (const t of targets) console.log(' -', t);
    console.log('\nRe-run with: --yes (optionally --vacuum)');
    process.exit(2);
  }

  const results = [];
  for (const dbFile of targets) {
    const r = wipeOneDb(dbFile, { vacuum });
    results.push(r);
    if (r.ok) {
      console.log(`[OK] Wiped ${path.basename(dbFile)}: ${r.deletedRows} rows across ${r.tablesWiped.length} table(s)`);
    } else {
      console.error(`[ERR] ${path.basename(dbFile)}: ${r.error}`);
    }
  }

  const anyErr = results.some(r => !r.ok);
  process.exit(anyErr ? 1 : 0);
}

main();
