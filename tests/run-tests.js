/* Minimal API test runner using supertest; exits non-zero on failure */
const request = require('supertest');
const assert = require('assert');
const app = require('../index');

async function run() {
  let failures = 0;
  function ok(cond, msg) { if (!cond) { console.error('FAIL:', msg); failures++; } else { console.log('PASS:', msg); } }

  try {
    // Root
    const r0 = await request(app).get('/');
    ok(r0.status === 200, 'GET / status 200');
    ok(r0.body && r0.body.service === 'modernex-inventory', 'GET / returns service name');

    // Materials
    const rm = await request(app).get('/api/materials');
    ok(rm.status === 200, 'GET /api/materials status 200');
    ok(Array.isArray(rm.body), 'GET /api/materials returns array');
    const materialId = rm.body[0] ? rm.body[0].id : null;

    // Suppliers (CRUD + reference protection)
    const supplierName = `SupplierE2E-${Date.now()}`;
    const sCreate = await request(app)
      .post('/suppliers')
      .send({ name: supplierName, contact: 'QA', notes: 'created by tests' });
    ok(sCreate.status === 201, 'POST /suppliers creates');
    ok(sCreate.body && sCreate.body.id, 'POST /suppliers returns id');
    const supplierId = sCreate.body.id;

    const sList = await request(app).get('/api/suppliers');
    ok(sList.status === 200 && Array.isArray(sList.body), 'GET /api/suppliers returns array');
    ok(sList.body.some(s => s.id === supplierId && s.name === supplierName), 'Supplier appears in /api/suppliers');

    const sUpdate = await request(app)
      .put(`/suppliers/${supplierId}`)
      .send({ contact: 'QA2', notes: 'updated by tests' });
    ok(sUpdate.status === 200, 'PUT /suppliers/:id updates');
    ok(sUpdate.body && sUpdate.body.id === supplierId && sUpdate.body.contact === 'QA2', 'Supplier update persisted');

    // Create a QBID using supplier_id and verify supplier_name resolves from suppliers
    const sQbid = await request(app)
      .post('/qbids')
      .send({
        supplier_id: supplierId,
        quarry: 'SQ',
        weight_kg: 10,
        size_mm: '10x10x10',
        grade: 'A',
        received_date: '2026-01-04',
        material_id: materialId,
        splitable_blk_count: 1
      });
    ok(sQbid.status === 201, 'POST /qbids (supplier_id) creates');
    const sQbidId = sQbid.body && sQbid.body.qbid;
    ok(sQbidId && /^qbid-[a-z0-9]+-\d{5}$/i.test(sQbidId), 'POST /qbids (supplier_id) returns qbid');

    const sQbidGet = await request(app).get(`/qbids/${sQbidId}`);
    ok(sQbidGet.status === 200, 'GET /qbids/:qbid (supplier_id) returns');
    ok(sQbidGet.body && sQbidGet.body.supplier_id === supplierId, 'QBID supplier_id persisted');
    ok(sQbidGet.body && sQbidGet.body.supplier_name === supplierName, 'QBID supplier_name resolves');

    // Delete supplier should be denied while referenced by QBID
    const sDelDenied = await request(app).delete(`/suppliers/${supplierId}`);
    ok(sDelDenied.status === 400, 'DELETE /suppliers denied when in use by QBIDs');

    // Cleanup supplier test: delete QBID then supplier
    const sQbidDel = await request(app).delete(`/qbids/${sQbidId}`);
    ok(sQbidDel.status === 200, 'DELETE QBID (supplier_id)');
    const sDel = await request(app).delete(`/suppliers/${supplierId}`);
    ok(sDel.status === 200, 'DELETE supplier after QBID removed');

    // Create a QBID
    const payloadQ = {
      supplier: 'TestCo', quarry: 'QX', weight_kg: 1000,
      size_mm: '1000x500x500', grade: 'A', received_date: '2026-01-04',
      material_id: materialId, splitable_blk_count: 2
    };
    const cq = await request(app).post('/qbids').send(payloadQ);
    ok(cq.status === 201, 'POST /qbids creates');
    const qbid = cq.body.qbid; ok(qbid && /^qbid-[a-z0-9]+-\d{5}$/i.test(qbid), 'POST /qbids returns qbid');

    // Auto-calc weight_kg from size_mm + stone_type when weight_kg omitted
    const auto1 = await request(app).post('/qbids').send({
      supplier: 'AutoWt', quarry: 'AQ',
      // 1000mm cube => 1m^3; granite ~ 2700 kg/m^3
      size_mm: '1000x1000x1000',
      stone_type: 'granite',
      grade: 'A', received_date: '2026-01-04',
      material_id: materialId, splitable_blk_count: 1
    });
    ok(auto1.status === 201, 'POST /qbids auto weight creates');
    const autoQbid1 = auto1.body && auto1.body.qbid;
    const auto1Get = await request(app).get(`/qbids/${autoQbid1}`);
    ok(auto1Get.status === 200, 'GET /qbids/:qbid (auto weight) returns');
    ok(Number(auto1Get.body.weight_kg) === 2700, 'Auto weight_kg computed for granite 1000^3mm');

    // Auto-calc on PUT when setting stone_type and weight_kg is not provided
    const auto2 = await request(app).post('/qbids').send({
      supplier: 'AutoWt2', quarry: 'AQ2',
      size_mm: '1000x1000x1000',
      grade: 'A', received_date: '2026-01-04',
      material_id: materialId, splitable_blk_count: 1
    });
    ok(auto2.status === 201, 'POST /qbids (auto weight via PUT) creates');
    const autoQbid2 = auto2.body && auto2.body.qbid;
    const putType = await request(app).put(`/qbids/${autoQbid2}`).send({ stone_type: 'granite' });
    ok(putType.status === 200, 'PUT /qbids/:qbid sets stone_type (auto weight)');
    const auto2Get = await request(app).get(`/qbids/${autoQbid2}`);
    ok(auto2Get.status === 200, 'GET /qbids/:qbid (auto weight via PUT) returns');
    ok(Number(auto2Get.body.weight_kg) === 2700, 'Auto weight_kg computed on stone_type update');

    // Recompute on size change even if client sends previous weight_kg (UI often submits all fields)
    const auto3 = await request(app).post('/qbids').send({
      supplier: 'AutoWt3', quarry: 'AQ3',
      size_mm: '1000x1000x1000',
      stone_type: 'granite',
      grade: 'A', received_date: '2026-01-04',
      material_id: materialId, splitable_blk_count: 1
    });
    ok(auto3.status === 201, 'POST /qbids (auto weight size-change) creates');
    const autoQbid3 = auto3.body && auto3.body.qbid;
    const auto3Get1 = await request(app).get(`/qbids/${autoQbid3}`);
    ok(auto3Get1.status === 200, 'GET /qbids/:qbid (auto3) returns');
    ok(Number(auto3Get1.body.weight_kg) === 2700, 'Auto3 initial weight_kg computed');
    const putSize = await request(app).put(`/qbids/${autoQbid3}`).send({
      size_mm: '2000x2000x2000',
      // simulate UI resubmitting weight_kg unchanged
      weight_kg: 2700
    });
    ok(putSize.status === 200, 'PUT /qbids/:qbid updates size_mm (auto3)');
    const auto3Get2 = await request(app).get(`/qbids/${autoQbid3}`);
    ok(auto3Get2.status === 200, 'GET /qbids/:qbid (auto3 after size change) returns');
    ok(Number(auto3Get2.body.weight_kg) === 21600, 'Auto3 weight_kg recomputed after size change');

    // Confirm GET QBID
    const gq = await request(app).get(`/qbids/${qbid}`);
    ok(gq.status === 200, 'GET /qbids/:qbid returns');

    // Set stone_type before children and verify
    const setType = await request(app).put(`/qbids/${qbid}`).send({ stone_type: 'granite' });
    ok(setType.status === 200, 'PUT /qbids/:qbid sets stone_type');
    const gq2 = await request(app).get(`/qbids/${qbid}`);
    ok(gq2.status === 200 && gq2.body.stone_type === 'granite', 'QBID stone_type persisted');

    // Update QBID before children
    const uq = await request(app).put(`/qbids/${qbid}`).send({
      supplier: 'TestCo Updated', quarry: 'QY', weight_kg: 2000, size_mm: '2000x1000x800', grade: 'B', received_date: '2026-01-04', material_id: materialId, splitable_blk_count: 2
    });
    ok(uq.status === 200, 'PUT /qbids/:qbid updates before children');

    // Create blocks up to cap
    const b1 = await request(app).post('/blocks').send({ block_id: `${qbid}-BLOCK-TEST-001`, parent_qbid: qbid });
    ok(b1.status === 201, 'POST /blocks under parent (1)');
    const b2 = await request(app).post('/blocks').send({ block_id: `${qbid}-BLOCK-TEST-002`, parent_qbid: qbid });
    ok(b2.status === 201, 'POST /blocks under parent (2)');
    const b3 = await request(app).post('/blocks').send({ block_id: `${qbid}-BLOCK-TEST-003`, parent_qbid: qbid });
    ok(b3.status === 400, 'POST /blocks denied over cap');

    // stone_type update after children exist should now be denied (locked)
    const typeAfterChildren = await request(app).put(`/qbids/${qbid}`).send({ stone_type: 'marble' });
    ok(typeAfterChildren.status === 400, 'PUT /qbids stone_type denied after children');

    // QBID update should now be denied due to children
    const uqDenied = await request(app).put(`/qbids/${qbid}`).send({ supplier: 'Another' });
    ok(uqDenied.status === 400, 'PUT /qbids denied when children exist');

    // Verify blocks are present and can be retrieved
    const blocks = await request(app).get('/api/blocks');
    ok(blocks.status === 200 && Array.isArray(blocks.body), 'GET /api/blocks returns array');
    const bFound = blocks.body.find(b => b.block_id === `${qbid}-BLOCK-TEST-001`);
    ok(bFound, 'block exists in API');

    // Cleanup: delete blocks then parent QBID
    const del1 = await request(app).delete(`/blocks/${qbid}-BLOCK-TEST-001`);
    ok(del1.status === 200, 'DELETE block 1');
    const del2 = await request(app).delete(`/blocks/${qbid}-BLOCK-TEST-002`);
    ok(del2.status === 200, 'DELETE block 2');
    const delQ = await request(app).delete(`/qbids/${qbid}`);
    ok(delQ.status === 200, 'DELETE QBID after children removed');

    // Split endpoint flow
    const payloadQ2 = {
      supplier: 'SplitCo', quarry: 'QZ', weight_kg: 500,
      size_mm: '1000x500x300', grade: 'A', received_date: '2026-01-04',
      material_id: materialId, splitable_blk_count: 3
    };
    const cq2 = await request(app).post('/qbids').send(payloadQ2);
    ok(cq2.status === 201, 'POST /qbids (split flow)');
    const qbid2 = cq2.body.qbid; ok(qbid2 && /^qbid-[a-z0-9]+-\d{5}$/i.test(qbid2), 'qbid created for split');

    const split1 = await request(app).post(`/blocks/${qbid2}/split`).send({});
    ok(split1.status === 201, 'POST /blocks/:qbid/split creates');
    ok(Array.isArray(split1.body.created) && split1.body.created.length === 3, 'split created 3 children');

    const splitAgain = await request(app).post(`/blocks/${qbid2}/split`).send({});
    ok(splitAgain.status === 400, 'split denied when children already exist');

    // Admin set-split-cap event logging
    const setCap = await request(app).post('/admin/set-split-cap').send({ qbid: qbid2, cap: 5 });
    ok(setCap.status === 200, 'POST /admin/set-split-cap updates');

    const eventsResp = await request(app).get('/api/events');
    ok(eventsResp.status === 200 && Array.isArray(eventsResp.body), 'GET /api/events returns array');
    const capEvent = eventsResp.body.find(e => e.ref_type === 'qbids' && e.ref_id === qbid2 && e.event_type === 'ADMIN_SET_SPLIT_CAP');
    ok(!!capEvent, 'cap change event logged');
    let payloadObj = {};
    try { payloadObj = JSON.parse(capEvent.payload || '{}'); } catch (_) {}
    ok(payloadObj && Number(payloadObj.new_cap) === 5, 'event payload new_cap = 5');

    // Cleanup second flow: delete split children then QBID
    const childrenResp = await request(app).get(`/blocks/${qbid2}/children`);
    ok(childrenResp.status === 200, 'GET /blocks/:qbid/children returns');
    const children = childrenResp.body.children || [];
    for (const child of children) {
      const delC = await request(app).delete(`/blocks/${child.block_id}`);
      ok(delC.status === 200, `DELETE child ${child.block_id}`);
    }
    const delQ2 = await request(app).delete(`/qbids/${qbid2}`);
    ok(delQ2.status === 200, 'DELETE QBID (split flow)');

    // Generate blocks endpoint should create up to cap and be visible via /api/blocks
    const cq3 = await request(app).post('/qbids').send({ supplier: 'GenCo', quarry: 'GQ', weight_kg: 100, size_mm: '100x50x50', grade: 'A', received_date: '2026-01-04', material_id: materialId, splitable_blk_count: 2 });
    ok(cq3.status === 201, 'POST /qbids (generate flow)');
    const qbid3 = cq3.body.qbid; ok(qbid3 && /^qbid-[a-z0-9]+-\d{5}$/i.test(qbid3), 'qbid created for generate');
    const gen = await request(app).post(`/blocks/generate/${qbid3}`).send({});
    ok(gen.status === 200, 'POST /blocks/generate/:qbid');
    ok(Array.isArray(gen.body.created) && gen.body.created.length === 2, 'generate created 2 children (cap=2)');
    const children3 = await request(app).get(`/blocks/${qbid3}/children`);
    ok(children3.status === 200 && Array.isArray(children3.body.children) && children3.body.children.length === 2, 'children visible via /blocks/:qbid/children');
    const allBlocks = await request(app).get('/api/blocks');
    const countInApi = allBlocks.body.filter(b => b.parent_qbid === qbid3).length;
    ok(countInApi === 2, 'generated blocks appear in /api/blocks');
    // cleanup
    for (const child of children3.body.children) { await request(app).delete(`/blocks/${child.block_id}`); }
    await request(app).delete(`/qbids/${qbid3}`);

    // Slab create + update flow
    const cq4 = await request(app).post('/qbids').send({ supplier: 'SlabCo', quarry: 'SQ', weight_kg: 150, size_mm: '100x50x25', grade: 'B', received_date: '2026-01-04', material_id: materialId, splitable_blk_count: 1 });
    ok(cq4.status === 201, 'POST /qbids (slab flow)');
    const qbid4 = cq4.body.qbid;
    const cb4 = await request(app).post('/blocks').send({ block_id: `${qbid4}-BLOCK-TEST-010`, parent_qbid: qbid4 });
    ok(cb4.status === 201, 'POST /blocks for slab flow');
    const cs = await request(app).post('/slabs').send({ block_id: `${qbid4}-BLOCK-TEST-010`, thickness_mm: 20, machine_id: 'M1', slabs_yield: 5 });
    ok(cs.status === 201, 'POST /slabs creates');
    const slid = cs.body.slid;
    const us = await request(app).put(`/slabs/${slid}`).send({ yard_location: 'Yard B', status: 'finished', qc_status: 'passed' });
    ok(us.status === 200, 'PUT /slabs/:slid updates');
    const slabsList = await request(app).get('/api/slabs');
    const sRow = slabsList.body.find(s => s.slid === slid);
    ok(sRow && sRow.yard_location === 'Yard B' && sRow.status === 'finished' && sRow.qc_status === 'passed', 'slab fields persisted after update');

    // Derived + dispatch flow: cobbles, monuments, events, dispatches
    const cqD = await request(app).post('/qbids').send({ supplier: 'DeriveCo', quarry: 'DQ', weight_kg: 777, size_mm: '777x777x777', grade: 'A', received_date: '2026-01-04', material_id: materialId, splitable_blk_count: 1, material_type: 'Kuppam Green' });
    ok(cqD.status === 201, 'POST /qbids (derived dispatch flow)');
    const qbidD = cqD.body.qbid;
    ok(qbidD && /^qbid-[a-z0-9]+-\d{5}$/i.test(qbidD), 'qbid created for derived dispatch');

    const blockIdD = `${qbidD}-BLOCK-DISP-001`;
    const bD = await request(app).post('/blocks').send({ block_id: blockIdD, parent_qbid: qbidD });
    ok(bD.status === 201, 'POST /blocks for derived dispatch');

    const cob = await request(app).post('/cobbles').send({ block_id: blockIdD, length_mm: 100, width_mm: 100, height_mm: 80, shape: 'square', finish: 'tumbled', pieces_count: 50, batch_id: 'B-C1', yard_location: 'Yard A', status: 'ready', qc_status: 'passed' });
    ok(cob.status === 201 && cob.body && cob.body.cobble_id, 'POST /cobbles creates');
    const cobbleId = cob.body.cobble_id;

    const mon = await request(app).post('/monuments').send({ block_id: blockIdD, length_mm: 1800, width_mm: 800, height_mm: 1000, style: 'classic', customer: 'ClientX', order_no: 'ORD-D001', batch_id: 'B-M1', yard_location: 'Yard A', status: 'ready', qc_status: 'passed' });
    ok(mon.status === 201 && mon.body && mon.body.monument_id, 'POST /monuments creates');
    const monumentId = mon.body.monument_id;

    const ev = await request(app).post('/events').send({ ref_type: 'cobbles', ref_id: cobbleId, event_type: 'QA', payload: { ok: true } });
    ok(ev.status === 201 && ev.body && ev.body.id, 'POST /events for cobble');
    const evList = await request(app).get('/api/events');
    ok(evList.status === 200 && Array.isArray(evList.body), 'GET /api/events returns array (post-derived)');
    ok(evList.body.some(e => e.ref_type === 'cobbles' && e.ref_id === cobbleId && e.event_type === 'QA'), 'Derived event present in /api/events');

    const dCob = await request(app).post('/dispatch').send({ item_type: 'cobble', item_id: cobbleId, customer: 'ACME', bundle_no: 'BND-C1', container_no: 'CONT-C1' });
    ok(dCob.status === 201 && dCob.body && dCob.body.id, 'POST /dispatch cobble creates');
    const dCobAgain = await request(app).post('/dispatch').send({ item_type: 'cobble', item_id: cobbleId, customer: 'ACME' });
    ok(dCobAgain.status === 400, 'POST /dispatch cobble denied duplicate');

    const dMon = await request(app).post('/dispatch').send({ item_type: 'monument', item_id: monumentId, customer: 'ACME', bundle_no: 'BND-M1', container_no: 'CONT-M1' });
    ok(dMon.status === 201 && dMon.body && dMon.body.id, 'POST /dispatch monument creates');
    const dMonAgain = await request(app).post('/dispatch').send({ item_type: 'monument', item_id: monumentId, customer: 'ACME' });
    ok(dMonAgain.status === 400, 'POST /dispatch monument denied duplicate');

    const dispList = await request(app).get('/api/dispatches');
    ok(dispList.status === 200 && Array.isArray(dispList.body), 'GET /api/dispatches returns array');
    ok(dispList.body.some(d => d.item_type === 'cobble' && d.item_id === cobbleId), 'Cobble dispatch present in /api/dispatches');
    ok(dispList.body.some(d => d.item_type === 'monument' && d.item_id === monumentId), 'Monument dispatch present in /api/dispatches');

    // cleanup derived dispatch flow
    try { await request(app).delete(`/dispatches/${dCob.body.id}`); } catch (_) {}
    try { await request(app).delete(`/dispatches/${dMon.body.id}`); } catch (_) {}
    try { if (ev.body && ev.body.id) await request(app).delete(`/events/${ev.body.id}`); } catch (_) {}
    try { await request(app).delete(`/cobbles/${cobbleId}`); } catch (_) {}
    try { await request(app).delete(`/monuments/${monumentId}`); } catch (_) {}
    try { await request(app).delete(`/blocks/${blockIdD}`); } catch (_) {}
    try { await request(app).delete(`/qbids/${qbidD}`); } catch (_) {}

    // Pavers flow
    const cqP = await request(app).post('/qbids').send({ supplier: 'PaverCo', quarry: 'PQ', weight_kg: 333, size_mm: '333x333x333', grade: 'A', received_date: '2026-01-04', material_id: materialId, splitable_blk_count: 1 });
    ok(cqP.status === 201, 'POST /qbids (pavers flow)');
    const qbidP = cqP.body.qbid;
    const blockIdP = `${qbidP}-BLOCK-PAV-001`;
    const bP = await request(app).post('/blocks').send({ block_id: blockIdP, parent_qbid: qbidP });
    ok(bP.status === 201, 'POST /blocks for pavers flow');

    // Negative: cannot create pavers from a SLID when slab stone_type is missing
    const slabNoType = await request(app).post('/slabs').send({ block_id: blockIdP, thickness_mm: 61, machine_id: 'MP0', slabs_yield: 1 });
    ok(slabNoType.status === 201 && slabNoType.body && slabNoType.body.slid, 'POST /slabs for pavers negative (no stone_type)');
    const slidNoType = slabNoType.body.slid;
    const pavNoType = await request(app).post('/pavers').send({ slid: slidNoType, thickness_mm: 60, length_mm: 200, width_mm: 100, height_mm: 60, finish: 'tumbled', pattern: 'rect', pieces_count: 20 });
    ok(pavNoType.status === 400, 'POST /pavers rejected when slab stone_type missing');

    // Negative: cannot create pavers from a slab reserved for another family (e.g., tiles)
    const slabTiles = await request(app).post('/slabs').send({ block_id: blockIdP, thickness_mm: 62, machine_id: 'MP1', slabs_yield: 1, stone_type: 'tiles' });
    ok(slabTiles.status === 201 && slabTiles.body && slabTiles.body.slid, 'POST /slabs tiles-marked for reservation negative');
    const slidTilesReserved = slabTiles.body.slid;
    const pavFromTilesSlab = await request(app).post('/pavers').send({ slid: slidTilesReserved, thickness_mm: 60, length_mm: 200, width_mm: 100, height_mm: 60, finish: 'tumbled', pattern: 'rect', pieces_count: 20 });
    ok(pavFromTilesSlab.status === 400, 'POST /pavers denied for tiles-marked SLID');

    // Negative: cannot create pavers when SLID already used by tiles (exclusivity)
    const slabForTileThenPaver = await request(app).post('/slabs').send({ block_id: blockIdP, thickness_mm: 63, machine_id: 'MP2', slabs_yield: 1, stone_type: 'tiles' });
    ok(slabForTileThenPaver.status === 201 && slabForTileThenPaver.body && slabForTileThenPaver.body.slid, 'POST /slabs for exclusivity negative');
    const slidTileUsed = slabForTileThenPaver.body.slid;
    const mkTile = await request(app).post('/tiles').send({ slid: slidTileUsed, thickness_mm: 10, length_mm: 300, width_mm: 300, finish: 'polished', yield_count: 1 });
    ok(mkTile.status === 201 && mkTile.body && mkTile.body.tile_id, 'POST /tiles created to consume SLID');
    const pavAfterTile = await request(app).post('/pavers').send({ slid: slidTileUsed, thickness_mm: 60, length_mm: 200, width_mm: 100, height_mm: 60, finish: 'tumbled', pattern: 'rect', pieces_count: 20 });
    ok(pavAfterTile.status === 400, 'POST /pavers denied when SLID already used by tiles');
    const slabP = await request(app).post('/slabs').send({ block_id: blockIdP, thickness_mm: 60, machine_id: 'MP', slabs_yield: 1, stone_type: 'pavers' });
    ok(slabP.status === 201 && slabP.body && slabP.body.slid, 'POST /slabs for pavers creates SLID');
    const slidP = slabP.body.slid;

    const pav = await request(app).post('/pavers').send({ slid: slidP, thickness_mm: 60, length_mm: 200, width_mm: 100, height_mm: 60, finish: 'tumbled', pattern: 'rect', pieces_count: 20, batch_id: 'B-P1', yard_location: 'Yard A', status: 'ready', qc_status: 'passed' });
    ok(pav.status === 201 && pav.body && pav.body.paver_id, 'POST /pavers creates');
    const paverId = pav.body.paver_id;
    ok(/^PAV-[A-Z0-9]+$/.test(paverId), 'paver_id has PAV-* format');

    const pList = await request(app).get('/api/pavers');
    ok(pList.status === 200 && Array.isArray(pList.body), 'GET /api/pavers returns array');
    ok(pList.body.some(p => p.paver_id === paverId), 'paver appears in /api/pavers');

    const dPav = await request(app).post('/dispatch').send({ item_type: 'paver', item_id: paverId, customer: 'ACME', bundle_no: 'BND-P1', container_no: 'CONT-P1' });
    ok(dPav.status === 201 && dPav.body && dPav.body.id, 'POST /dispatch paver creates');
    const dPavAgain = await request(app).post('/dispatch').send({ item_type: 'paver', item_id: paverId, customer: 'ACME' });
    ok(dPavAgain.status === 400, 'POST /dispatch paver denied duplicate');

    // Reserved family enforcement: cannot create tiles from a pavers-marked slab
    const tileFromPaverSlab = await request(app).post('/tiles').send({ slid: slidP, thickness_mm: 10, length_mm: 300, width_mm: 300, finish: 'polished', yield_count: 1 });
    ok(tileFromPaverSlab.status === 400, 'POST /tiles denied for pavers-marked SLID');

    // Negative: cannot update a paver to a reserved SLID (e.g., a tiles-marked slab)
    const updateToTilesSlid = await request(app).put(`/pavers/${paverId}`).send({ slid: slidTilesReserved });
    ok(updateToTilesSlid.status === 400, 'PUT /pavers denied when assigning tiles-marked SLID');

    // Negative: cannot update a paver to a SLID already used by tiles
    const updateToTileUsedSlid = await request(app).put(`/pavers/${paverId}`).send({ slid: slidTileUsed });
    ok(updateToTileUsedSlid.status === 400, 'PUT /pavers denied when assigning SLID already used by tiles');

    // cleanup pavers flow
    try { if (dPav.body && dPav.body.id) await request(app).delete(`/dispatches/${dPav.body.id}`); } catch (_) {}
    try { await request(app).delete(`/pavers/${paverId}`); } catch (_) {}
    try { await request(app).delete(`/slabs/${slidP}`); } catch (_) {}
    try { if (mkTile.body && mkTile.body.tile_id) await request(app).delete(`/tiles/${mkTile.body.tile_id}`); } catch (_) {}
    try { await request(app).delete(`/slabs/${slidTileUsed}`); } catch (_) {}
    try { await request(app).delete(`/slabs/${slidTilesReserved}`); } catch (_) {}
    try { await request(app).delete(`/slabs/${slidNoType}`); } catch (_) {}
    try { await request(app).delete(`/blocks/${blockIdP}`); } catch (_) {}
    try { await request(app).delete(`/qbids/${qbidP}`); } catch (_) {}

    // Test: slab stone_type enforcement for derived products
    const cq5 = await request(app).post('/qbids').send({ supplier: 'SlabTypeCo', quarry: 'STQ', weight_kg: 200, size_mm: '200x100x50', grade: 'B', received_date: '2026-01-04', material_id: materialId, splitable_blk_count: 1 });
    ok(cq5.status === 201, 'POST /qbids for slab stone_type test');
    const qbid5 = cq5.body.qbid;
    const cb5 = await request(app).post('/blocks').send({ block_id: `${qbid5}-BLOCK-T1`, parent_qbid: qbid5 });
    ok(cb5.status === 201, 'POST /blocks for slab stone_type test');
    const cs2 = await request(app).post('/slabs').send({ block_id: `${qbid5}-BLOCK-T1`, thickness_mm: 20, machine_id: 'M2', slabs_yield: 2, stone_type: 'granite' });
    ok(cs2.status === 201, 'POST /slabs creates with stone_type granite');
    const slid2 = cs2.body.slid;
    // Attempt to create a tile with conflicting stone_type -> should be rejected
    const tileBad = await request(app).post('/tiles').send({ slid: slid2, thickness_mm: 10, length_mm: 600, width_mm: 600, finish: 'polished', yield_count: 4, stone_type: 'marble' });
    ok(tileBad.status === 400, 'POST /tiles rejected for slab stone_type mismatch');
    // Creating a tile without explicit stone_type should inherit slab's granite and succeed
    const tileOk = await request(app).post('/tiles').send({ slid: slid2, thickness_mm: 10, length_mm: 600, width_mm: 600, finish: 'polished', yield_count: 4 });
    ok(tileOk.status === 201, 'POST /tiles allowed when stone_type inherits from slab');
    // cleanup created resources for this test
    try { if (tileOk.body && tileOk.body.tile_id) await request(app).delete(`/tiles/${tileOk.body.tile_id}`); } catch(_) {}
    await request(app).delete(`/slabs/${slid2}`);
    await request(app).delete(`/blocks/${qbid5}-BLOCK-T1`);
    await request(app).delete(`/qbids/${qbid5}`);
    // cleanup
    await request(app).delete(`/slabs/${slid}`);
    await request(app).delete(`/blocks/${qbid4}-BLOCK-TEST-010`);
    await request(app).delete(`/qbids/${qbid4}`);
  } catch (err) {
    console.error('Unexpected test error:', err);
    failures++;
  }

  if (failures) {
    console.error(`Tests failed: ${failures}`);
    process.exit(1);
  } else {
    console.log('All tests passed');
    process.exit(0);
  }
}

run();
