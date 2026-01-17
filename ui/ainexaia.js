/**
 * AI NexaIQ client-side helper (enhanced heuristics)
 * Implements key features requested for stone businesses in a conservative,
 * best-effort manner using local inventory/dispatch endpoints when available.
 */

async function fetchJSON(path) {
  try {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

console.debug && console.debug('ainexaia.js initializing NexaAI');
const NexaAI = {
  name: 'AI NexaIQ',

  // resilient fetcher for common endpoints
  async list(endpoint) {
    const tries = [`/api/${endpoint}`, `/${endpoint}`, `/api/${endpoint.replace(/s$/, '')}`];
    for (const p of tries) {
      const data = await fetchJSON(p);
      if (!data) continue;
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.rows)) return data.rows;
      if (data.items && Array.isArray(data.items)) return data.items;
    }
    return [];
  },
  async listQbids() { return this.list('qbids'); },
  async listBlocks() { return this.list('blocks'); },
  async listSlabs() { return this.list('slabs'); },
  async listDispatches() { return this.list('dispatches'); },
  async listSuppliers() { return this.list('suppliers'); },

  // Real-Time Slab & Block Visibility
  async inventoryVisibility() {
    const [blocks, slabs] = await Promise.all([this.listBlocks(), this.listSlabs()]);
    const byThickness = {}, byFinish = {}, byYard = {};
    let totalValue = 0, totalCount = 0;
    for (const s of slabs) {
      const qty = Number(s.quantity || s.qty || s.stock_qty || 1) || 1;
      totalCount += qty;
      const thickness = (s.thickness || s.thk || 'unknown').toString();
      const finish = (s.finish || s.finish_type || s.surface || 'unknown').toString();
      const yard = (s.yard || s.location || s.site || 'unknown').toString();
      byThickness[thickness] = (byThickness[thickness] || 0) + qty;
      byFinish[finish] = (byFinish[finish] || 0) + qty;
      byYard[yard] = byYard[yard] || { count: 0, value: 0 };
      byYard[yard].count += qty;
      let v = 0;
      if (typeof s.value === 'number') v = s.value; // assume value field represents total value for this record
      else if (typeof s.unit_price === 'number') v = (s.unit_price * qty);
      else if (typeof s.weight_kg === 'number' && typeof s.unit_price === 'number') v = s.weight_kg * s.unit_price;
      byYard[yard].value = Number((byYard[yard].value + v).toFixed(2));
      totalValue += v;
    }
    return { totalCount, totalValue: Number(totalValue.toFixed(2)), byThickness, byFinish, byYard, blocksCount: (blocks||[]).length };
  },

  // Inventory value & capital analysis
  async valueInsights() {
    const slabs = await this.listSlabs();
    let total = 0;
    const byYard = {};
    for (const s of slabs) {
      const qty = Number(s.quantity || s.qty || s.stock_qty || 1) || 1;
      let v = 0;
      if (typeof s.value === 'number') v = s.value;
      else if (typeof s.unit_price === 'number') v = s.unit_price * qty;
      else if (typeof s.weight_kg === 'number' && typeof s.unit_price === 'number') v = s.weight_kg * s.unit_price;
      total += v;
      const yard = (s.yard || s.location || s.site || 'unknown').toString();
      byYard[yard] = (byYard[yard] || 0) + v;
    }
    return { totalValue: Number(total.toFixed(2)), byYard };
  },

  // Friendly inventory summary used by the UI
  async summarizeInventory() {
    try {
      const vis = await this.inventoryVisibility();
      const val = await this.valueInsights();
      const rec = await this.recommendReorder({ thresholdDays: 30, minQty: 5 });
      const qbids = await this.listQbids();
      const blocks = await this.listBlocks();
      const yards = Object.keys(vis.byYard || {}).length;
      const lowCount = Array.isArray(rec.recommendations) ? rec.recommendations.length : 0;
      const msg = `Inventory summary: ${vis.totalCount} slabs across ${yards} yards. Estimated value $${val.totalValue}. QBIDs: ${Array.isArray(qbids)? qbids.length:0}. Blocks: ${Array.isArray(blocks)? blocks.length:0}. Low-stock SKUs flagged: ${lowCount}.`;
      return { message: msg, counts: { slabs: vis.totalCount, yards, qbids: Array.isArray(qbids)? qbids.length:0, blocks: Array.isArray(blocks)? blocks.length:0, lowStock: lowCount, totalValue: val.totalValue }, visibility: vis };
    } catch (e) {
      return { message: 'Nexa summary is unavailable.', error: String(e) };
    }
  },

  // Simple demand forecasting using dispatch history and lookback window
  async predictDemand(itemIdentifier, days = 30, lookbackDays = 90) {
    const dispatches = await this.listDispatches();
    if (!dispatches.length) return { item: itemIdentifier, predicted: 0, reason: 'no dispatch data' };
    const textId = String(itemIdentifier).toLowerCase();
    const now = Date.now();
    const cutoff = now - (lookbackDays * 24*60*60*1000);
    // sum quantities for matching dispatches in the lookback window
    const matches = dispatches.filter(d => JSON.stringify(d).toLowerCase().includes(textId));
    const recent = matches.filter(d => {
      const t = d.dispatched_at || d.date || d.created_at || d.timestamp;
      if (!t) return true;
      return new Date(t).getTime() >= cutoff;
    });
    const totalQty = recent.reduce((sum, d) => sum + (Number(d.qty || d.quantity || d.count || 1) || 0), 0);
    const perDay = totalQty / Math.max(1, lookbackDays);
    return { item: itemIdentifier, predicted: Math.round(perDay * days), perDay, sample: recent.slice(0,5) };
  },

  // Smart reorder & quarry planning
  async recommendReorder({ thresholdDays = 30, minQty = 5, lookbackDays = 90 } = {}) {
    const slabs = await this.listSlabs();
    const dispatches = await this.listDispatches();
    const now = Date.now();
    const cutoff = now - lookbackDays * 24*60*60*1000;

    // canonical SKU key: material/color|thickness|finish
    const skuKey = (s) => `${(s.color||s.material||s.name||'unknown').toString().toLowerCase()}|${(s.thickness||s.thk||'unk')}|${(s.finish||s.finish_type||'unk').toString().toLowerCase()}`;

    // build demand counts per SKU key
    const demandCounts = {};
    for (const d of dispatches) {
      const t = d.dispatched_at || d.date || d.created_at || d.timestamp;
      if (t && new Date(t).getTime() < cutoff) continue;
      const text = JSON.stringify(d).toLowerCase();
      const dispatchedQty = Number(d.qty || d.quantity || d.count || 1) || 1;
      for (const s of slabs) {
        const key = skuKey(s);
        if (text.includes((s.id||s.slid||s.qbid||'').toString().toLowerCase()) || text.includes((s.color||s.material||'').toString().toLowerCase())) {
          demandCounts[key] = (demandCounts[key]||0) + dispatchedQty;
        }
      }
    }

    // group slabs by SKU and keep a readable label (SLID/ID/name/material)
    const groups = {};
    for (const s of slabs) {
      const key = skuKey(s);
      const cnt = Number(s.quantity || s.qty || s.stock_qty || 1) || 1;
      const sampleLabel = (s.slid || s.id || s.qbid || s.name || s.color || s.material || key).toString();
      if (!groups[key]) groups[key] = { items: [], stock: 0, label: sampleLabel };
      groups[key].stock += cnt;
      groups[key].items.push(s);
    }

    const recommendations = [];
    const lookback = lookbackDays;
    for (const key of Object.keys(groups)) {
      const g = groups[key];
      const recentDemand = demandCounts[key] || 0;
      const avgDaily = recentDemand / Math.max(1, lookback);
      const example = g.items[0] || {};
      const lead = Math.max(7, Number(example.lead_time_days || example.supplier_lead || 14));
      const safety = Math.ceil(avgDaily * Math.min(14, lead));
      const reorderPoint = Math.ceil(avgDaily * lead + safety);
      const suggestedRaw = Math.ceil(Math.max(0, reorderPoint - g.stock));
      // Prefer suggesting the calculated delta; only fall back to minQty when stock is already below minQty
      let suggested = suggestedRaw;
      if (suggestedRaw < minQty && g.stock <= minQty) suggested = minQty;
      // include recommendation when stock is low or suggested is non-zero
      if (g.stock <= minQty || g.stock <= reorderPoint || suggested > 0) {
        recommendations.push({ key, label: g.label || key, stock: g.stock, avgDaily: Number(avgDaily.toFixed(3)), leadDays: lead, safety, reorderPoint, suggested });
      }
    }
    return { recommendations, message: `${recommendations.length} SKU groups flagged for reorder or low stock` };
  },

  // Slow-moving & dead stock identification
  async detectSlowMoving(days = 90) {
    const slabs = await this.listSlabs();
    const now = Date.now();
    const slow = [];
    for (const s of slabs) {
      const last = s.last_moved || s.last_dispatched || s.received_date || s.updated_at || s.updatedAt || s.updated;
      if (!last) continue;
      const lastTs = new Date(last).getTime();
      if ((now - lastTs) > days * 24*60*60*1000) {
        slow.push({ id: s.id || s.slid || s.qbid || '(unknown)', daysSince: Math.round((now - lastTs)/(24*60*60*1000)), item: s });
      }
    }
    return { slow, count: slow.length };
  },

  // Multi-yard balancing
  async balanceAcrossYards() {
    const slabs = await this.listSlabs();
    const yardMap = {};
    for (const s of slabs) {
      const y = (s.yard || s.location || s.site || 'unknown').toString();
      const cnt = Number(s.quantity || s.qty || s.stock_qty || 1) || 1;
      yardMap[y] = (yardMap[y] || 0) + cnt;
    }
    const yards = Object.keys(yardMap);
    if (!yards.length) return { yards: {} };
    const total = Object.values(yardMap).reduce((a,b)=>a+b,0);
    const avg = total / yards.length;
    const result = { total, avg: Number(avg.toFixed(2)), yards: {} };
    for (const y of yards) result.yards[y] = { count: yardMap[y], delta: Math.round(yardMap[y]-avg) };
    return result;
  },

  // human-friendly insights entry point
  async answerQuestion(text) {
    const raw = String(text || '').trim();
    const q = raw.toLowerCase();
    if (!q) return 'Please ask a question about inventory.';

    // lightweight help + routing (avoid returning inventory summary for every prompt)
    const wantsHelp =
      q === 'help' ||
      q === '?' ||
      q.includes('what can you do') ||
      q.includes('how to use') ||
      q.includes('commands') ||
      q.includes('examples');
    if (wantsHelp) {
      return 'Try: “inventory summary”, “reorder suggestions”, “inventory value”, “slow moving”, “blocks count”, “slabs count”, or ask about “dispatches” / “suppliers”.';
    }

    // view-oriented intents
    if (/\bqbid\b/.test(q)) {
      return 'QBIDs link blocks to slabs. Open QBIDs and search by QBID to see related blocks/slabs.';
    }
    if (/\bblock(s)?\b/.test(q)) {
      try {
        const blocks = await this.listBlocks();
        return `Blocks: ${blocks.length} records. Tip: open Blocks and search by Block ID or QBID.`;
      } catch (e) {
        return 'Open Blocks view and search by Block ID or QBID.';
      }
    }
    if (/\bslab(s)?\b|\bslid\b/.test(q)) {
      try {
        const slabs = await this.listSlabs();
        return `Slabs: ${slabs.length} records. Tip: open Slabs and filter by thickness/finish/yard or search by SLID.`;
      } catch (e) {
        return 'Open Slabs view and filter by thickness/finish/yard (or search by SLID).';
      }
    }
    if (/\bdispatch(es)?\b/.test(q)) {
      try {
        const rows = await this.listDispatches();
        return `Dispatches: ${rows.length} records. Tip: open Dispatches and search by container/order fields.`;
      } catch (e) {
        return 'Open Dispatches view to review shipments and containers.';
      }
    }
    if (/\bsupplier(s)?\b/.test(q)) {
      try {
        const rows = await this.listSuppliers();
        return `Suppliers: ${rows.length} records. Tip: open Suppliers and search by name/code.`;
      } catch (e) {
        return 'Open Suppliers view and search by name/code.';
      }
    }
    if (/\b(tile|tiles|cobble|cobbles|monument|monuments|event|events)\b/.test(q)) {
      return 'Open the matching view (Tiles/Cobbles/Monuments/Events) and use the grid search + filters; tell me what field you want to filter on.';
    }

    if (/running low|which .* low|what is low|what's low/.test(q)) {
      const rec = await this.recommendReorder({ thresholdDays:30, minQty:5 });
      if (!rec.recommendations.length) return 'No obvious low-stock SKUs detected with available data.';
      return `Found ${rec.recommendations.length} SKU groups potentially low: ${rec.recommendations.slice(0,6).map(r=>r.key).join(', ')}.`;
    }
    if (q.includes('reorder') || q.includes('what should i reorder')) {
      const rec = await this.recommendReorder({ thresholdDays:30, minQty:5 });
      if (!rec.recommendations.length) return 'No reorder suggestions found.';
      return `Reorder suggestions: ${rec.recommendations.slice(0,6).map(r=>`${r.key} → qty:${r.suggested}`).join('; ')}`;
    }
    if (q.includes('haven\'t moved') || q.includes('not moved') || q.includes('slow-moving') || q.includes('dead stock')) {
      const slow = await this.detectSlowMoving(90);
      return slow.count ? `Detected ${slow.count} slow-moving items. Examples: ${slow.slow.slice(0,5).map(s=>s.id).join(', ')}` : 'No slow-moving items detected.';
    }
    if (q.includes('value') || q.includes('capital') || q.includes('money locked')) {
      const stats = await this.valueInsights();
      const byY = Object.entries(stats.byYard||{}).map(([y,v])=>`${y}: $${Number(v.toFixed? v.toFixed(2): v)}`).join('; ');
      return `Estimated total inventory value: $${stats.totalValue}. Breakdown: ${byY}`;
    }
    if (q.includes('forecast') || q.includes('predict') || q.includes('demand')) {
      const m = q.match(/([A-Za-z0-9\-]{2,})/);
      const id = m ? m[0] : null;
      if (!id) return 'To forecast demand, include an item id or name.';
      const p = await this.predictDemand(id, 30);
      return `Predicted ${p.predicted} units over 30 days (approx ${Number(p.perDay||0).toFixed(2)} per day).`;
    }

    // Only show inventory visibility/summary when explicitly asked
    const wantsInventorySummary =
      /\b(inventory|summary|overview|visibility)\b/.test(q) ||
      q.includes('top thickness') ||
      q.includes('by thickness') ||
      q.includes('inventory slabs');
    if (wantsInventorySummary) {
      const vis = await this.inventoryVisibility();
      return `Inventory: ${vis.totalCount} slabs across ${Object.keys(vis.byYard || {}).length} yards. Top thicknesses: ${Object.entries(vis.byThickness || {}).slice(0, 4).map(([k, v]) => `${k}(${v})`).join(', ')}`;
    }

    // fallback: guidance (don’t default to inventory summary)
    return 'I can help with inventory summary/visibility, reorder suggestions, inventory value, slow-moving items, and quick counts (blocks/slabs/dispatches/suppliers). Type “help” for examples.';
  }
};

// Expose on window for convenience
try { window.NexaAI = NexaAI; console.debug && console.debug('ainexaia: attached NexaAI to window'); } catch (e) {}

export default NexaAI;
