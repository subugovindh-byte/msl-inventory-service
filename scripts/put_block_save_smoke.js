const { spawn } = require('child_process');
const http = require('http');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function req(method, port, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': data.length }
          : {},
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = null;
          try {
            json = buf ? JSON.parse(buf) : null;
          } catch {
            json = buf;
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function waitForHealth(port, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await req('GET', port, '/health');
      if (r.status && r.status < 500) return;
    } catch {
      // ignore
    }
    await sleep(200);
  }
  throw new Error('server did not become ready');
}

(async () => {
  const port = 4911;
  const server = spawn('node', ['index.js'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port) },
  });

  try {
    await waitForHealth(port);

    const q = await req('POST', port, '/qbids', {
      material_type: 'PARM',
      splitable_blk_count: 1,
    });
    const qbid = q.json && q.json.qbid;
    if (!qbid) throw new Error('QBID create failed: ' + JSON.stringify(q));

    const gen = await req('POST', port, `/blocks/generate/${encodeURIComponent(qbid)}`);
    const blockId = gen.json && gen.json.created && gen.json.created[0];
    if (!blockId) throw new Error('Generate failed: ' + JSON.stringify(gen));

    const upd = await req('PUT', port, `/blocks/${encodeURIComponent(blockId)}`, {
      status: 'TestSave',
      yard_location: 'Y1',
    });
    console.log('PUT result:', upd);

    const get = await req('GET', port, `/blocks/${encodeURIComponent(blockId)}`);
    console.log('GET result:', get);

    process.exit(0);
  } finally {
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
