const Database = require('better-sqlite3');
const path = require('path');
const dbFile = path.join(__dirname, '..', 'test_ui.db');
const db = new Database(dbFile, { readonly: true });
const q = process.argv[2];
const row = db.prepare('SELECT qbid,gross_cost,transport_cost,other_cost,total_cost FROM qbids WHERE qbid = ?').get(q);
console.log(row);
db.close();
