import crypto from 'node:crypto';

function id(size = 12) { return crypto.randomBytes(size).toString('base64url').slice(0, size); }

export function makeSystemMessage(chatId, content, extra = {}) {
  return {
    id: id(14), chatId, senderId: 'system', content, encrypted: false,
    crypto: null, attachment: null, replyToId: null, reactions: {},
    createdAt: new Date().toISOString(), editedAt: null, deletedAt: null,
    expiresAt: null, hiddenFor: [], kind: 'system', ...extra
  };
}

export function builtinBotReply(command, args = []) {
  const cmd = command.toLowerCase();
  if (cmd === '/help') return 'Privora Bot: /help, /roll, /coin, /echo <text>, /choose a | b | c, /privacy, /id';
  if (cmd === '/roll') return `🎲 ${1 + Math.floor(Math.random() * 6)}`;
  if (cmd === '/coin') return Math.random() > .5 ? '🪙 Heads' : '🪙 Tails';
  if (cmd === '/echo') return args.join(' ') || 'Give me something to echo.';
  if (cmd === '/choose') {
    const choices = args.join(' ').split('|').map(x => x.trim()).filter(Boolean);
    return choices.length ? `✨ I choose: ${choices[Math.floor(Math.random() * choices.length)]}` : 'Use: /choose pizza | sushi | tacos';
  }
  if (cmd === '/privacy') return 'Privacy tip: verify Secure Room Codes out-of-band. Production E2EE still needs an audited Signal/MLS implementation.';
  if (cmd === '/id') return 'Your Privora identity is the signed-in account plus this device session.';
  return null;
}

export function normalizePermissions(input = {}) {
  return {
    onlyAdminsCanPost: Boolean(input.onlyAdminsCanPost),
    allowInvites: input.allowInvites !== false,
    allowMedia: input.allowMedia !== false,
    allowPolls: input.allowPolls !== false,
    allowLinks: input.allowLinks !== false,
    slowModeSeconds: Math.max(0, Math.min(Number(input.slowModeSeconds || 0), 3600))
  };
}

export function createInviteCode() { return id(12); }

export function canPostToChat(chat, userId) {
  if (!chat?.members?.includes(userId)) return false;
  if (chat.type === 'channel' || chat.permissions?.onlyAdminsCanPost) return Boolean(chat.admins?.includes(userId));
  return true;
}

export function applyPollVote(poll, userId, optionId) {
  const copy = structuredClone(poll);
  if (!copy.multiple) copy.options.forEach(o => { o.voters = (o.voters || []).filter(id => id !== userId); });
  const option = copy.options.find(o => o.id === optionId);
  if (!option) return copy;
  option.voters ||= [];
  option.voters = option.voters.includes(userId) ? option.voters.filter(id => id !== userId) : [...option.voters, userId];
  return copy;
}
