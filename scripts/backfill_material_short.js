#!/usr/bin/env node
const db = require('../db');

function shortFromName(name) {
  if (!name) return null;
  const s = String(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  return s.slice(0, 3).padEnd(3, 'X');
}

function run() {
  const mats = db.prepare('SELECT id, name, short_code FROM materials').all();
  const upd = db.prepare('UPDATE materials SET short_code = ? WHERE id = ?');
  let updated = 0;
  const tran = db.transaction((rows) => {
    rows.forEach(r => {
      const sc = r.short_code || shortFromName(r.name);
      if (sc && sc !== r.short_code) {
        upd.run(sc, r.id);
        updated += 1;
      }
    });
  });
  tran(mats);
  console.log('backfilled short_code for', updated, 'materials');
}

if (require.main === module) run();
