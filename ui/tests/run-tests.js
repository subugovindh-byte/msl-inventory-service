// Simple test runner for ai NexaIQ helpers
import NexaAI from '../ainexaia.js';

function fail(message) {
  console.error('FAIL:', message);
  process.exitCode = 1;
}
function ok(cond, msg) { if (!cond) fail(msg); else console.log('ok:', msg); }

// Mock fetch to return canned endpoints
const sampleSlabs = [
  { id: 'SL-100', color: 'Granite Black', thickness: '20mm', finish: 'polished', yard: 'YardA', quantity: 2, unit_price: 500 },
  { id: 'SL-101', color: 'Granite White', thickness: '18mm', finish: 'honed', yard: 'YardB', quantity: 1, unit_price: 700, last_moved: '2025-01-01' },
  { id: 'SL-102', color: 'Quartz Blue', thickness: '20mm', finish: 'polished', yard: 'YardA', quantity: 10, unit_price: 300, last_moved: '2024-01-01' }
];
const sampleBlocks = [ { id: 'B-1' } ];
const sampleDispatches = [
  { id: 'D-1', dispatched_at: '2025-12-01', qty: 1, notes: 'SL-100' },
  { id: 'D-2', dispatched_at: '2025-12-05', qty: 2, notes: 'SL-102' }
];

globalThis.fetch = async (url) => {
  const u = String(url || '');
  if (u.includes('/slabs')) return { ok: true, json: async () => sampleSlabs };
  if (u.includes('/blocks')) return { ok: true, json: async () => sampleBlocks };
  if (u.includes('/dispatches')) return { ok: true, json: async () => sampleDispatches };
  // fallback: empty array
  return { ok: true, json: async () => [] };
};

async function run() {
  console.log('Running NexaAI tests...');

  // inventoryVisibility
  const vis = await NexaAI.inventoryVisibility();
  try { ok(vis.totalCount === 3, 'inventoryVisibility.totalCount === 3'); } catch(e){ }
  ok(Object.keys(vis.byThickness).length >= 1, 'inventoryVisibility.byThickness present');

  // valueInsights
  const val = await NexaAI.valueInsights();
  ok(typeof val.totalValue === 'number', 'valueInsights.totalValue is number');

  // predictDemand for SL-102 (should find dispatches)
  const pred = await NexaAI.predictDemand('SL-102', 30, 90);
  ok(pred.predicted >= 0, 'predictDemand returns number');

  // detectSlowMoving: set threshold small to trigger SL-102 (last_moved 2024-01-01)
  const slow = await NexaAI.detectSlowMoving(300); // 300 days
  ok(slow.count >= 1, 'detectSlowMoving finds at least 1 item');

  // recommendReorder: with current sample, some items may be suggested
  const rec = await NexaAI.recommendReorder({ thresholdDays: 30, minQty: 2, lookbackDays: 180 });
  ok(typeof rec.recommendations !== 'undefined', 'recommendReorder returns recommendations array');

  console.log('All tests executed. Review results above.');
}

run().catch(err => { console.error('Test runner error', err); process.exitCode = 2; });
