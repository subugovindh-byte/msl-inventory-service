#!/usr/bin/env bash
# Sync DB schema across dev, test and prod DB files by running migrations.
# Usage: ./scripts/sync-dbs.sh
set -euo pipefail
cwd="$(cd "$(dirname "$0")/.." && pwd)"
cd "$cwd"
echo "Migrating development DB (dev.db)..."
DB_NAME=dev node db.js --migrate
# Ensure qbids cost columns exist (add if missing)
DB_NAME=dev node <<'NODE'
const Database = require('better-sqlite3');
const path = require('path');
const base = path.join(process.cwd());
const dbFile = path.join(base, process.env.DB_NAME + '.db');
const db = new Database(dbFile);
const cols = db.prepare("PRAGMA table_info('qbids')").all().map(r => r.name);
['gross_cost','transport_cost','other_cost','total_cost'].forEach(c => {
	if (!cols.includes(c)) {
		try { db.exec(`ALTER TABLE qbids ADD COLUMN ${c} REAL;`); console.log('added', c, 'to', dbFile); } catch (e) { console.error('failed to add', c, e.message); }
	}
});
db.close();
NODE
echo "Migrating test DB (test_ui.db)..."
DB_NAME=test_ui node db.js --migrate
# Ensure qbids cost columns exist (add if missing)
DB_NAME=test_ui node <<'NODE'
const Database = require('better-sqlite3');
const path = require('path');
const base = path.join(process.cwd());
const dbFile = path.join(base, process.env.DB_NAME + '.db');
const db = new Database(dbFile);
const cols = db.prepare("PRAGMA table_info('qbids')").all().map(r => r.name);
['gross_cost','transport_cost','other_cost','total_cost'].forEach(c => {
	if (!cols.includes(c)) {
		try { db.exec(`ALTER TABLE qbids ADD COLUMN ${c} REAL;`); console.log('added', c, 'to', dbFile); } catch (e) { console.error('failed to add', c, e.message); }
	}
});
db.close();
NODE
echo "Migrating production DB (prod.db)..."
DB_NAME=prod node db.js --migrate
# Ensure qbids cost columns exist (add if missing)
DB_NAME=prod node <<'NODE'
const Database = require('better-sqlite3');
const path = require('path');
const base = path.join(process.cwd());
const dbFile = path.join(base, process.env.DB_NAME + '.db');
const db = new Database(dbFile);
const cols = db.prepare("PRAGMA table_info('qbids')").all().map(r => r.name);
['gross_cost','transport_cost','other_cost','total_cost'].forEach(c => {
	if (!cols.includes(c)) {
		try { db.exec(`ALTER TABLE qbids ADD COLUMN ${c} REAL;`); console.log('added', c, 'to', dbFile); } catch (e) { console.error('failed to add', c, e.message); }
	}
});
db.close();
NODE
echo "All migrations applied."
