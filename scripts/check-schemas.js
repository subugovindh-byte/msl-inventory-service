const Database = require('better-sqlite3');
const path = require('path');
const base = process.cwd();
const dbNames = ['dev','test_ui','prod'];
const tables = ['qbids','blocks','slabs'];

function colsFor(dbFile, table) {
  try {
    const db = new Database(dbFile, { readonly: true });
    const rows = db.prepare(`PRAGMA table_info('${table}')`).all();
    db.close();
    return rows.map(r => r.name);
  } catch (e) {
    return null;
  }
}

const schemas = {};
for (const name of dbNames) {
  const file = path.join(base, name + '.db');
  schemas[name] = {};
  for (const t of tables) {
    schemas[name][t] = colsFor(file, t);
  }
}

console.log('Schema summary for DBs:');
for (const name of dbNames) {
  console.log('\nDB:', name + '.db');
  for (const t of tables) {
    const cols = schemas[name][t];
    if (!cols) console.log(`  ${t}: MISSING`);
    else console.log(`  ${t}: ${cols.join(', ')}`);
  }
}

// Compare columns across DBs for each table
console.log('\nSchema diffs:');
for (const t of tables) {
  const map = {};
  for (const name of dbNames) {
    const cols = schemas[name][t] || [];
    map[name] = new Set(cols);
  }
  // union of all columns
  const union = new Set();
  for (const s of Object.values(map)) for (const c of s) union.add(c);
  const unionArr = Array.from(union).sort();
  const diffs = {};
  for (const name of dbNames) {
    const missing = unionArr.filter(c => !map[name].has(c));
    if (missing.length) diffs[name] = missing;
  }
  if (Object.keys(diffs).length === 0) console.log(`  ${t}: OK — all DBs have same columns`);
  else {
    console.log(`  ${t}: differences detected:`);
    for (const [dbn, miss] of Object.entries(diffs)) console.log(`    ${dbn}.db missing: ${miss.join(', ')}`);
  }
}
