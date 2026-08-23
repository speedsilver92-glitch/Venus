import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

test('Cloudflare config deploys the Docker app as one container', () => {
  const config = JSON.parse(read('wrangler.jsonc'));
  assert.equal(config.name, 'privora-messenger');
  assert.equal(config.main, 'worker/index.js');
  assert.equal(config.containers?.[0]?.image, './Dockerfile');
  assert.equal(config.containers?.[0]?.class_name, 'PrivoraContainer');
  assert.equal(config.containers?.[0]?.max_instances, 1);
  assert.equal(config.durable_objects?.bindings?.[0]?.name, 'PRIVORA_CONTAINER');
  assert.deepEqual(config.secrets?.required, ['JWT_SECRET']);
});

test('Cloudflare edge worker forwards all traffic to a stable container instance', () => {
  const worker = read('worker/index.js');
  assert.match(worker, /defaultPort\s*=\s*3001/);
  assert.match(worker, /getContainer\(env\.PRIVORA_CONTAINER,\s*['"]privora-primary['"]\)/);
  assert.match(worker, /JWT_SECRET:\s*env\.JWT_SECRET/);
  assert.match(worker, /\.fetch\(request\)/);
});

test('main branch pushes run tests then deploy to Cloudflare', () => {
  const workflow = read('.github/workflows/cloudflare-deploy.yml');
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /npm run test/);
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
