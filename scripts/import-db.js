#!/usr/bin/env node

/*
  Import/restore an inventory-service SQLite export.

  Input formats:
  - .db  : copies the snapshot into place (full restore)
  - .sql : executes SQL into the target DB (typically with --replace)

  Safety:
  - Refuses to run unless you pass --yes
  - For .db restores, keeps a timestamped backup by default (disable with --no-backup)

  DB selection matches the app:
  - DB_FILE: absolute or relative path
  - DB_NAME: <name>.db under project root
  - default: test_ui.db

  Examples:
    node scripts/import-db.js --yes --in ./exports/dev-20260116.db --db-name dev
    node scripts/import-db.js --yes --in ./exports/dev.sql --db-name dev --replace

  Tip:
    After importing, you can run migrations to bring schema forward:
      DB_NAME=dev node db.js --migrate
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

function main() {
  const yes = hasArg('--yes');
  if (!yes) {
    console.error('Refusing to import without --yes');
    console.error('Example: node scripts/import-db.js --yes --in ./exports/dev.db --db-name dev');
    process.exit(2);
  }

  const root = projectRoot();
  const input = argValue('--in', null);
  if (!input) {
    console.error('Missing required arg: --in <file>');
    process.exit(2);
  }

  const inputPath = path.resolve(process.cwd(), input);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input not found: ${inputPath}`);
    process.exit(2);
  }

  const dbName = argValue('--db-name', null);
  const dbFileArg = argValue('--db-file', null);
  const targetDbFile = resolveDbFile({ root, dbName, dbFile: dbFileArg });

  const replace = hasArg('--replace');
  const doBackup = !hasArg('--no-backup');

  const ext = path.extname(inputPath).toLowerCase();

  if (ext === '.db') {
    if (fs.existsSync(targetDbFile) && doBackup) {
      const backup = targetDbFile.replace(/\.db$/i, '') + `.backup-${tsSafe()}.db`;
      fs.copyFileSync(targetDbFile, backup);
      console.log(`[OK] Backed up existing DB: ${backup}`);
    }

    fs.mkdirSync(path.dirname(targetDbFile), { recursive: true });
    fs.copyFileSync(inputPath, targetDbFile);
    console.log(`[OK] Restored DB snapshot: ${inputPath} -> ${targetDbFile}`);
    return;
  }

  if (ext === '.sql') {
    if (fs.existsSync(targetDbFile) && doBackup) {
      const backup = targetDbFile.replace(/\.db$/i, '') + `.backup-${tsSafe()}.db`;
      fs.copyFileSync(targetDbFile, backup);
      console.log(`[OK] Backed up existing DB: ${backup}`);
    }

    if (replace && fs.existsSync(targetDbFile)) {
      fs.unlinkSync(targetDbFile);
      console.log(`[OK] Removed existing DB (replace): ${targetDbFile}`);
    }

    const sql = fs.readFileSync(inputPath, 'utf8');
    const db = new Database(targetDbFile);
    try {
      db.exec(sql);
      console.log(`[OK] Imported SQL dump: ${inputPath} -> ${targetDbFile}`);
    } finally {
      try { db.close(); } catch (_) {}
    }
    return;
  }

  console.error(`Unsupported input format: ${ext} (expected .db or .sql)`);
  process.exit(2);
}

main();
