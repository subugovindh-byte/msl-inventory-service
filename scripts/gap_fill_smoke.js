const { spawn } = require('child_process');
const http = require('http');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request(
      {
        hostname: '127.0.0.1',
        port: Number(process.env.PORT || 4001),
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

async function waitForServer(timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await req('GET', '/health');
      if (r.status && r.status < 500) return;
    } catch {
      // ignore
    }
    await sleep(200);
  }
  throw new Error('server did not become ready on port 4002');
}

(async () => {
  const port = 4902;
  process.env.PORT = String(port);
  const server = spawn('node', ['index.js'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port) },
  });
  try {
    await waitForServer();

    const suffix = String(Date.now()).slice(-5);
    const qbid = `qbid-parm-${suffix}`;

    let r = await req('POST', '/qbids', {
      qbid,
      splitable_blk_count: 3,
      material_type: 'PARM',
    });
    console.log('create qbid:', r);
    if (r.status >= 400) throw new Error('POST /qbids failed');

    const createdQbid = (r.json && r.json.qbid) || qbid;

    r = await req('POST', `/blocks/generate/${encodeURIComponent(createdQbid)}`);
    console.log('generate1:', r);

    let children = await req('GET', `/blocks/${encodeURIComponent(createdQbid)}/children`);
    console.log('children1:', children);

    const created = (r.json && r.json.created) || [];
    const toDelete = created.find((id) => /-B$/.test(id)) || created[1];
    if (!toDelete) throw new Error('no created block to delete');

    const del = await req('DELETE', `/blocks/${encodeURIComponent(toDelete)}`);
    console.log('delete:', del);

    const r2 = await req('POST', `/blocks/generate/${encodeURIComponent(createdQbid)}`);
    console.log('generate2:', r2);

    children = await req('GET', `/blocks/${encodeURIComponent(createdQbid)}/children`);
    console.log('children2:', children);

    process.exit(0);
  } finally {
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
