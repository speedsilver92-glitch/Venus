import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { createInviteCode, normalizePermissions, applyPollVote, makeSystemMessage } from './platform.js';

export function installAdvancedFeatures({ app, io, authMiddleware, readStore, updateStore, publicUser, userCanAccessChat, enrichChat }) {
  function requireChat(req, res, admin = false) {
    const data = readStore();
    const chat = data.chats.find(c => c.id === req.params.id);
    if (!userCanAccessChat(req.auth.sub, chat)) { res.status(404).json({ error: 'Chat not found.' }); return null; }
    if (admin && !chat.admins?.includes(req.auth.sub)) { res.status(403).json({ error: 'Admin permission required.' }); return null; }
    return { data, chat };
  }

  function notifyChat(chatId, event, payload) { io.to(`chat:${chatId}`).emit(event, payload); }

  app.get('/api/mini-apps', authMiddleware, (_req, res) => res.json([
    { id: 'notes', name: 'Private Notes', icon: '📝', description: 'Local-only encrypted-feeling scratchpad; stored in this browser.' },
    { id: 'tasks', name: 'Task Board', icon: '✅', description: 'Shared-looking local task list for quick planning.' },
    { id: 'dice', name: 'Party Dice', icon: '🎲', description: 'Dice, coin and random choice utilities.' },
    { id: 'vault', name: 'Vault Generator', icon: '🔐', description: 'Generate strong room codes and passwords locally.' }
  ]));

  app.post('/api/chats/community', authMiddleware, (req, res) => {
    const title = String(req.body.title || '').trim().slice(0, 80);
    const type = req.body.type === 'channel' ? 'channel' : 'group';
    const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds.map(String) : [];
    const data = readStore();
    if (title.length < 2) return res.status(400).json({ error: 'Name is too short.' });
    const members = [...new Set([req.auth.sub, ...memberIds])].filter(id => data.users.some(u => u.id === id));
    const chat = {
      id: nanoid(), type, title, description: String(req.body.description || '').trim().slice(0, 500),
      members, admins: [req.auth.sub], roles: { [req.auth.sub]: 'owner' }, createdBy: req.auth.sub,
      createdAt: new Date().toISOString(), pinnedBy: [], mutedBy: [], public: Boolean(req.body.public),
      inviteCode: createInviteCode(), joinRequests: [], topics: [], permissions: normalizePermissions({
        ...req.body.permissions, onlyAdminsCanPost: type === 'channel' ? true : req.body.permissions?.onlyAdminsCanPost
      })
    };
    updateStore(store => store.chats.push(chat));
    const fresh = readStore();
    chat.members.forEach(id => {
      io.in(`user:${id}`).socketsJoin(`chat:${chat.id}`);
      io.to(`user:${id}`).emit('chat-created', enrichChat(chat, id, fresh));
    });
    res.status(201).json(enrichChat(chat, req.auth.sub, fresh));
  });

  app.put('/api/chats/:id/manage', authMiddleware, (req, res) => {
    const found = requireChat(req, res, true); if (!found) return;
    const updated = updateStore(store => {
      const chat = store.chats.find(c => c.id === req.params.id);
      if ('title' in req.body) chat.title = String(req.body.title || '').trim().slice(0, 80) || chat.title;
      if ('description' in req.body) chat.description = String(req.body.description || '').trim().slice(0, 500);
      if ('public' in req.body) chat.public = Boolean(req.body.public);
      if (req.body.permissions) chat.permissions = normalizePermissions({ ...chat.permissions, ...req.body.permissions });
      if (req.body.memberId && req.body.role) {
        chat.roles ||= {}; chat.admins ||= [];
        const role = ['owner','admin','moderator','member'].includes(req.body.role) ? req.body.role : 'member';
        chat.roles[req.body.memberId] = role;
        if (['owner','admin'].includes(role)) chat.admins = [...new Set([...chat.admins, req.body.memberId])];
        else chat.admins = chat.admins.filter(id => id !== req.body.memberId || id === chat.createdBy);
      }
      return chat;
    });
    notifyChat(updated.id, 'chat-updated', updated);
    res.json(updated);
  });

  app.post('/api/chats/:id/topics', authMiddleware, (req, res) => {
    const found = requireChat(req, res); if (!found) return;
    if (!['group','channel'].includes(found.chat.type)) return res.status(400).json({ error: 'Topics are for groups/channels.' });
    const title = String(req.body.title || '').trim().slice(0, 60);
    if (title.length < 2) return res.status(400).json({ error: 'Topic title is too short.' });
    const topic = { id: nanoid(10), title, icon: String(req.body.icon || '💬').slice(0, 8), createdBy: req.auth.sub, createdAt: new Date().toISOString() };
    updateStore(store => store.chats.find(c => c.id === req.params.id).topics = [...(store.chats.find(c => c.id === req.params.id).topics || []), topic]);
    notifyChat(req.params.id, 'topic-created', topic);
    res.status(201).json(topic);
  });

  app.post('/api/chats/:id/invite', authMiddleware, (req, res) => {
    const found = requireChat(req, res); if (!found) return;
    if (found.chat.permissions?.allowInvites === false && !found.chat.admins?.includes(req.auth.sub)) return res.status(403).json({ error: 'Invites are disabled.' });
    const code = updateStore(store => {
      const chat = store.chats.find(c => c.id === req.params.id);
      if (req.body.rotate || !chat.inviteCode) chat.inviteCode = createInviteCode();
      return chat.inviteCode;
    });
    res.json({ code, link: `privora://join/${code}` });
  });

  app.post('/api/invites/:code/join', authMiddleware, (req, res) => {
    const result = updateStore(store => {
      const chat = store.chats.find(c => c.inviteCode === req.params.code);
      if (!chat) return { error: 'Invite not found.' };
      if (chat.members.includes(req.auth.sub)) return { chat, joined: true };
      if (chat.public || chat.autoApproveInvites) {
        chat.members.push(req.auth.sub); chat.roles ||= {}; chat.roles[req.auth.sub] = 'member';
        store.messages.push(makeSystemMessage(chat.id, 'A new member joined via invite link.'));
        return { chat, joined: true };
      }
      chat.joinRequests ||= [];
      if (!chat.joinRequests.includes(req.auth.sub)) chat.joinRequests.push(req.auth.sub);
      return { chat, joined: false };
    });
    if (result.error) return res.status(404).json({ error: result.error });
    if (result.joined) {
      io.in(`user:${req.auth.sub}`).socketsJoin(`chat:${result.chat.id}`);
      notifyChat(result.chat.id, 'member-joined', { userId: req.auth.sub });
    } else result.chat.admins?.forEach(id => io.to(`user:${id}`).emit('join-request', { chatId: result.chat.id, userId: req.auth.sub }));
    res.json({ joined: result.joined, chatId: result.chat.id });
  });

  app.post('/api/chats/:id/join-requests/:userId', authMiddleware, (req, res) => {
    const found = requireChat(req, res, true); if (!found) return;
    const approve = req.body.approve !== false;
    const chat = updateStore(store => {
      const c = store.chats.find(x => x.id === req.params.id); c.joinRequests ||= [];
      c.joinRequests = c.joinRequests.filter(id => id !== req.params.userId);
      if (approve && !c.members.includes(req.params.userId) && store.users.some(u => u.id === req.params.userId)) {
        c.members.push(req.params.userId); c.roles ||= {}; c.roles[req.params.userId] = 'member';
      }
      return c;
    });
    if (approve) { io.in(`user:${req.params.userId}`).socketsJoin(`chat:${chat.id}`); io.to(`user:${req.params.userId}`).emit('join-approved', { chatId: chat.id }); }
    notifyChat(chat.id, 'chat-updated', chat);
    res.json({ ok: true });
  });

  app.get('/api/chats/:id/media', authMiddleware, (req, res) => {
    const found = requireChat(req, res); if (!found) return;
    const items = found.data.messages.filter(m => m.chatId === found.chat.id && m.attachment && !m.deletedAt).map(m => ({ messageId: m.id, createdAt: m.createdAt, attachment: m.attachment, senderId: m.senderId }));
    res.json(items.slice(-500).reverse());
  });

  app.get('/api/chats/:id/members', authMiddleware, (req, res) => {
    const found = requireChat(req, res); if (!found) return;
    res.json(found.chat.members.map(id => ({ ...publicUser(found.data.users.find(u => u.id === id)), role: found.chat.roles?.[id] || (found.chat.admins?.includes(id) ? 'admin' : 'member') })).filter(x => x.id));
  });

  app.get('/api/sessions', authMiddleware, (req, res) => {
    const sessions = (readStore().sessions || []).filter(s => s.userId === req.auth.sub).map(({ tokenHash, ...safe }) => safe);
    res.json(sessions);
  });

  app.delete('/api/sessions/:id', authMiddleware, (req, res) => {
    updateStore(store => { store.sessions ||= []; store.sessions = store.sessions.filter(s => !(s.id === req.params.id && s.userId === req.auth.sub)); });
    io.to(`user:${req.auth.sub}`).emit('session-revoked', { sessionId: req.params.id });
    res.json({ ok: true });
  });

  app.post('/api/push-subscriptions', authMiddleware, (req, res) => {
    updateStore(store => {
      const user = store.users.find(u => u.id === req.auth.sub); user.pushSubscriptions ||= [];
      const endpoint = String(req.body.endpoint || '').slice(0, 1000);
      if (endpoint && !user.pushSubscriptions.some(s => s.endpoint === endpoint)) user.pushSubscriptions.push({ ...req.body, createdAt: new Date().toISOString() });
    });
    res.status(201).json({ ok: true, note: 'Subscription stored. Add VAPID/web-push credentials to deliver outside the browser.' });
  });

  io.on('connection', socket => {
    const userId = socket.user?.sub;
    if (!userId) return;

    socket.on('webrtc-signal', payload => {
      const { chatId, targetUserId, signal, kind } = payload || {};
      const chat = readStore().chats.find(c => c.id === chatId);
      if (!userCanAccessChat(userId, chat) || !chat.members.includes(targetUserId)) return;
      io.to(`user:${targetUserId}`).emit('webrtc-signal', { chatId, fromUserId: userId, signal, kind });
    });

    socket.on('call-state', payload => {
      const chat = readStore().chats.find(c => c.id === payload?.chatId);
      if (!userCanAccessChat(userId, chat)) return;
      socket.to(`chat:${chat.id}`).emit('call-state', { ...payload, userId });
    });

    socket.on('poll-vote', (payload, ack = () => {}) => {
      const updated = updateStore(store => {
        const m = store.messages.find(x => x.id === payload?.messageId && x.kind === 'poll');
        const chat = m && store.chats.find(c => c.id === m.chatId);
        if (!m || !userCanAccessChat(userId, chat) || m.poll?.closed) return null;
        m.poll = applyPollVote(m.poll, userId, payload.optionId); return m;
      });
      if (!updated) return ack({ ok: false, error: 'Poll unavailable.' });
      notifyChat(updated.chatId, 'message-updated', updated); ack({ ok: true });
    });
  });
}

export function makeSession(userId, req = {}) {
  return {
    id: nanoid(12), userId, createdAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(),
    deviceName: String(req.body?.deviceName || req.headers['user-agent'] || 'Unknown device').slice(0, 160),
    ipHint: crypto.createHash('sha256').update(String(req.ip || '')).digest('hex').slice(0, 10)
  };
}
