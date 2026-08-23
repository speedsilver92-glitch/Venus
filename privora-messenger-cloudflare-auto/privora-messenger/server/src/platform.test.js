import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePermissions, createInviteCode, applyPollVote, canPostToChat } from './platform.js';

test('normalizePermissions clamps slow mode and applies safe defaults', () => {
  const p = normalizePermissions({ slowModeSeconds: 99999, allowInvites: false });
  assert.equal(p.slowModeSeconds, 3600);
  assert.equal(p.allowInvites, false);
  assert.equal(p.allowMedia, true);
});

test('createInviteCode makes short URL-safe codes', () => {
  const code = createInviteCode();
  assert.match(code, /^[A-Za-z0-9_-]{10,20}$/);
});

test('applyPollVote replaces a non-multiple-choice vote', () => {
  const poll = { multiple: false, options: [{ id: 'a', voters: ['u'] }, { id: 'b', voters: [] }] };
  const result = applyPollVote(poll, 'u', 'b');
  assert.deepEqual(result.options[0].voters, []);
  assert.deepEqual(result.options[1].voters, ['u']);
});

test('channel posting can be restricted to admins', () => {
  const chat = { type: 'channel', members: ['owner','member'], admins: ['owner'], permissions: { onlyAdminsCanPost: true } };
  assert.equal(canPostToChat(chat, 'owner'), true);
  assert.equal(canPostToChat(chat, 'member'), false);
});
