#!/usr/bin/env node
const db = require('../db');

function run() {
  const rows = db.prepare('SELECT parent_qbid, COUNT(*) as cnt FROM blocks GROUP BY parent_qbid').all();
  const upd = db.prepare('UPDATE qbids SET splitable_blk_count = ? WHERE qbid = ?');
  let updated = 0;
  const tran = db.transaction((rows) => {
    rows.forEach(r => {
      const info = upd.run(r.cnt, r.parent_qbid);
      if (info.changes && info.changes > 0) updated += 1;
    });
  });
  tran(rows);
  console.log('backfilled splitable_blk_count for', updated, 'qbids');
}

if (require.main === module) run();
