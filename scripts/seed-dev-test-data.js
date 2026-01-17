#!/usr/bin/env node

/*
  Seed the dev DB with realistic test data across:
  materials -> qbids -> blocks -> slabs -> derived (tiles) -> events -> dispatches

  Uses the API (supertest) so all ID-generation logic is exercised.

  Usage:
    node scripts/seed-dev-test-data.js
    node scripts/seed-dev-test-data.js --count 2
*/

const request = require('supertest');
const app = require('../index');

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

async function main() {
  const count = Math.max(1, Number(argValue('--count', '1')) || 1);
  const today = '2026-01-16';

  // Create a couple suppliers (optional)
  await request(app).post('/suppliers').send({ name: 'Vatsin Granite Quarry', contact: 'Ops', material: 'Granite' });
  await request(app).post('/suppliers').send({ name: 'Kuppam Stone Co', contact: 'Sales', material: 'Granite' });

  const materials = [
    { name: 'Paradiso Multi', supplier: 'Vatsin Granite Quarry', quarry: 'Paradiso Quarry' },
    { name: 'Paradiso Classic', supplier: 'Vatsin Granite Quarry', quarry: 'Paradiso Quarry' },
    { name: 'Paradiso Bash', supplier: 'Vatsin Granite Quarry', quarry: 'Paradiso Quarry' },
    { name: 'Kuppam Green', supplier: 'Kuppam Stone Co', quarry: 'Kuppam Quarry' },
    { name: 'Kuppam White', supplier: 'Kuppam Stone Co', quarry: 'Kuppam Quarry' }
  ];

  const created = [];

  for (let round = 0; round < count; round++) {
    for (const m of materials) {
      const cq = await request(app).post('/qbids').send({
        supplier: m.supplier,
        quarry: m.quarry,
        weight_kg: 12000 + round,
        size_mm: '3000x2000x1600',
        grade: 'A',
        received_date: today,
        material_type: m.name,
        splitable_blk_count: 3,
        stone_type: 'granite',
        gross_cost: 100000,
        transport_cost: 10000,
        other_cost: 1000
      });
      if (cq.status !== 201) {
        throw new Error(`Failed to create QBID for ${m.name}: ${cq.status} ${JSON.stringify(cq.body)}`);
      }
      const qbid = cq.body.qbid;

      // Split to generate blocks using auto pattern
      const split = await request(app).post(`/blocks/${encodeURIComponent(qbid)}/split`).send({});
      if (split.status !== 201) {
        throw new Error(`Failed to split blocks for ${qbid}: ${split.status} ${JSON.stringify(split.body)}`);
      }
      const blockIds = split.body.created || [];

      // Create a slab + event + dispatch for the first block
      if (blockIds[0]) {
        const cs = await request(app).post('/slabs').send({
          block_id: blockIds[0],
          thickness_mm: 20,
          machine_id: 'GANG-1',
          slabs_yield: 12,
          yard_location: 'Yard A',
          status: 'processing',
          qc_status: 'pending',
          stone_type: 'granite'
        });
        if (cs.status !== 201) {
          throw new Error(`Failed to create slab for ${blockIds[0]}: ${cs.status} ${JSON.stringify(cs.body)}`);
        }
        const slid = cs.body.slid;

        await request(app).post('/events').send({
          ref_type: 'qbids',
          ref_id: qbid,
          event_type: 'SEED',
          payload: { material: m.name, blocks: blockIds.length, slid }
        });

        // Create tiles from slab (inherits stone_type)
        await request(app).post('/tiles').send({
          slid,
          thickness_mm: 20,
          length_mm: 600,
          width_mm: 600,
          finish: 'polished',
          yield_count: 30,
          batch_id: `BATCH-${round + 1}`,
          yard_location: 'Yard A',
          status: 'ready',
          qc_status: 'passed'
        });

        // Dispatch the slab
        await request(app).post('/dispatch').send({
          slid,
          customer: 'ACME Imports',
          bundle_no: `BND-${round + 1}`,
          container_no: `CONT-${round + 1}`
        });
      }

      created.push({ qbid, material: m.name, blocks: blockIds.length });
    }
  }

  console.log(`Seeded ${created.length} QBID(s). Sample:`);
  for (const row of created.slice(0, 8)) {
    console.log(` - ${row.qbid} (${row.material}) blocks=${row.blocks}`);
  }
}

main().catch((e) => {
  console.error('seed-dev-test-data failed:', e);
  process.exit(1);
});
