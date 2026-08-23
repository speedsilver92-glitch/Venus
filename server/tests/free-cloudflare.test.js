import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), 'utf8');

test('free Cloudflare config has no Containers and uses SQLite Durable Objects', () => {
  const config = read('wrangler.jsonc');
  assert.doesNotMatch(config, /"containers"/);
  assert.match(config, /"class_name"\s*:\s*"PrivoraRoom"/);
  assert.match(config, /"new_sqlite_classes"\s*:\s*\[\s*"PrivoraRoom"\s*\]/);
  assert.match(config, /"directory"\s*:\s*"\.\/client\/dist"/);
});

test('client uses native WebSocket compatibility layer instead of socket.io-client', () => {
  const app = read('client/src/App.jsx');
  const realtime = read('client/src/lib/realtime.js');
  assert.doesNotMatch(app, /socket\.io-client/);
  assert.match(app, /\.\/lib\/realtime\.js/);
  assert.match(realtime, /new WebSocket/);
});

test('worker exposes API and WebSocket endpoints through Durable Object', () => {
  const worker = read('worker/index.js');
  assert.match(worker, /export class PrivoraRoom/);
  assert.match(worker, /pathname === '\/ws'/);
  assert.match(worker, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /acceptWebSocket/);
});
