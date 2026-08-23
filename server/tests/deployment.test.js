import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

test('Cloudflare config stays on the free Workers architecture', () => {
  const config = JSON.parse(read('wrangler.jsonc'));
  assert.equal(config.name, 'privora-messenger');
  assert.equal(config.main, 'worker/index.js');
  assert.equal(config.containers, undefined);
  assert.equal(config.durable_objects?.bindings?.[0]?.name, 'PRIVORA_ROOM');
  assert.equal(config.durable_objects?.bindings?.[0]?.class_name, 'PrivoraRoom');
  assert.deepEqual(config.migrations?.[0]?.new_sqlite_classes, ['PrivoraRoom']);
  assert.equal(config.assets?.directory, './client/dist');
  assert.equal(config.assets?.not_found_handling, 'single-page-application');
});

test('Cloudflare Worker routes API and websocket traffic to Durable Object', () => {
  const worker = read('worker/index.js');
  assert.match(worker, /export class PrivoraRoom/);
  assert.match(worker, /idFromName\(['"]privora-global['"]\)/);
  assert.match(worker, /acceptWebSocket/);
  assert.match(worker, /env\.ASSETS\.fetch\(request\)/);
  assert.doesNotMatch(worker, /@cloudflare\/containers/);
});

test('main branch pushes run tests then deploy to Cloudflare', () => {
  const workflow = read('.github/workflows/cloudflare-deploy.yml');
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /npm (?:run test|test)/);
  assert.match(workflow, /npm run build/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /PRIVORA_JWT_SECRET/);
  assert.match(workflow, /wrangler deploy/);
});

test('local and deployment secret files are ignored by git', () => {
  const gitignore = read('.gitignore');
  assert.match(gitignore, /\.dev\.vars/);
  assert.match(gitignore, /deploy-secrets/);
});
