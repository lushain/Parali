// Load the bundled file exactly as CommonJS, as it is packaged for Node 22 Lambda.
// The health route performs no cloud call and needs no credentials.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parali-lambda-'));
const file = path.join(dir, 'index.cjs');
fs.copyFileSync(path.resolve('infra/build/index.js'), file);
process.env.SESSION_TABLE = 'local-smoke-test';
process.env.AI_PROVIDER = 'aws';
const { handler } = require(file);
handler({ requestContext: { http: { method: 'GET' } }, rawPath: '/api/health', headers: {} }).then(result => {
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { ok: true, provider: 'aws' });
  console.log('Bundled Lambda health smoke test passed (no AWS calls).');
  fs.unlinkSync(file);
  fs.rmdirSync(dir);
}).catch(error => { console.error(error.message); process.exitCode = 1; });
