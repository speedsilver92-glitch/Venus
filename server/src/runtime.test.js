import test from 'node:test';
import assert from 'node:assert/strict';
import { corsOptionsFromOrigin } from './runtime.js';

test('same-origin mode does not enable CORS when CLIENT_ORIGIN is omitted', () => {
  assert.equal(corsOptionsFromOrigin(''), null);
  assert.equal(corsOptionsFromOrigin(undefined), null);
});

test('explicit CLIENT_ORIGIN returns a restrictive CORS policy', () => {
  assert.deepEqual(corsOptionsFromOrigin('https://chat.example.com'), {
    origin: 'https://chat.example.com',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  });
});
