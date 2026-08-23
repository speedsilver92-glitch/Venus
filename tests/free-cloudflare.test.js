import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('free Cloudflare config uses Durable Objects and no Containers', () => {
  const config = JSON.parse(
    fs.readFileSync('wrangler.jsonc', 'utf8')
  );

  assert.equal(config.name, 'privora-messenger');
  assert.equal(config.main, 'worker/index.js');

  assert.ok(config.durable_objects);
  assert.ok(
    config.durable_objects.bindings.some(
      binding =>
        binding.name === 'PRIVORA_ROOM' &&
        binding.class_name === 'PrivoraRoom'
    )
  );

  assert.equal(config.containers, undefined);
});

test('worker does not use Cloudflare Containers', () => {
  const worker = fs.readFileSync(
    'worker/index.js',
    'utf8'
  );

  assert.match(worker, /export class PrivoraRoom/);
  assert.match(worker, /env\.PRIVORA_ROOM/);

  assert.doesNotMatch(
    worker,
    /@cloudflare\/containers/
  );

  assert.doesNotMatch(
    worker,
    /PrivoraContainer/
  );

  assert.doesNotMatch(
    worker,
    /defaultPort\s*=\s*3001/
  );
});