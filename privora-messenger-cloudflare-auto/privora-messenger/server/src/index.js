import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';
import { authMiddleware, signToken, verifyToken } from './auth.js';
import { readStore, updateStore } from './store.js';
import { builtinBotReply, canPostToChat, normalizePermissions } from './platform.js';
import { installAdvancedFeatures, makeSession } from './advanced.js';
import { corsOptionsFromOrigin } from './runtime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '';
const CORS_OPTIONS = corsOptionsFromOrigin(CLIENT_ORIGIN);
const CLIENT_DIST = path.resolve(__dirname, '..', '..', 'client', 'dist');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, CORS_OPTIONS ? { cors: CORS_OPTIONS } : {});

if (CORS_OPTIONS) app.use(cors(CORS_OPTIONS));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/auth', rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: true, legacyHeaders: false }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
      cb(null, `${Date.now()}-${nanoid(8)}-${safe}`);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 }
});

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function defaultSettings() {
  return {
    readReceipts: true,
    typingIndicators: true,
    lastSeen: 'contacts',
    discoverByUsername: true,
    defaultAutoDeleteSeconds: 0
  };
}

function userCanAccessChat(userId, chat) {
  return Boolean(chat?.members?.includes(userId));
}

function enrichChat(chat, userId, data) {
  const members = chat.members.map(id => publicUser(data.users.find(u => u.id === id))).filter(Boolean);
  const lastMessage = data.messages
    .filter(m => m.chatId === chat.id && !m.hiddenFor?.includes(userId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
  return { ...chat, members, lastMessage };
}

function activeMessages(messages) {
  const now = Date.now();
  return messages.filter(m => !m.expiresAt || new Date(m.expiresAt).getTime() > now);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'Privora', version: '0.3.0' }));

app.post('/api/auth/register', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const displayName = String(req.body.displayName || '').trim();
  const password = String(req.body.password || '');

  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-24 characters: letters, numbers, underscore.' });
  }
  if (displayName.length < 2 || displayName.length > 40) {
    return res.status(400).json({ error: 'Display name must be 2-40 characters.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const data = readStore();
  if (data.users.some(u => u.username === username)) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  const user = {
    id: nanoid(),
    username,
    displayName,
    passwordHash: await bcrypt.hash(password, 12),
    avatar: '',
    bio: '',
    createdAt: new Date().toISOString(),
    settings: defaultSettings(),
    twoFactorEnabled: false
  };

  const savedChat = {
    id: nanoid(),
    type: 'saved',
    title: 'Saved Messages',
    members: [user.id],
    createdBy: user.id,
    createdAt: new Date().toISOString(),
    pinnedBy: [user.id],
    mutedBy: [],
    roles: { [user.id]: 'owner' },
    permissions: normalizePermissions({}),
    topics: [], joinRequests: []
  };

  const session = makeSession(user.id, req);
  updateStore(store => {
    store.users.push(user);
    store.chats.push(savedChat);
    store.sessions ||= []; store.sessions.push(session);
  });

  res.status(201).json({ token: signToken(user, session.id), user: publicUser(user), sessionId: session.id });
});

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = readStore().users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  const session = makeSession(user.id, req);
  updateStore(store => { store.sessions ||= []; store.sessions.push(session); });
  res.json({ token: signToken(user, session.id), user: publicUser(user), sessionId: session.id });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = readStore().users.find(u => u.id === req.auth.sub);
  if (!user) return res.status(404).json({ error: 'User no longer exists.' });
  res.json(publicUser(user));
});

app.put('/api/me', authMiddleware, (req, res) => {
  const displayName = String(req.body.displayName || '').trim();
  const bio = String(req.body.bio || '').trim().slice(0, 160);
  const avatar = String(req.body.avatar || '').trim().slice(0, 500);
  if (displayName.length < 2 || displayName.length > 40) return res.status(400).json({ error: 'Invalid display name.' });

  const user = updateStore(store => {
    const target = store.users.find(u => u.id === req.auth.sub);
    Object.assign(target, { displayName, bio, avatar });
    return publicUser(target);
  });
  res.json(user);
});

app.put('/api/me/settings', authMiddleware, (req, res) => {
  const allowed = ['readReceipts', 'typingIndicators', 'lastSeen', 'discoverByUsername', 'defaultAutoDeleteSeconds', 'allowCalls', 'linkPreviews', 'showProfilePhotos'];
  const settings = updateStore(store => {
    const user = store.users.find(u => u.id === req.auth.sub);
    user.settings ||= defaultSettings();
    for (const key of allowed) {
      if (key in req.body) user.settings[key] = req.body[key];
    }
    return user.settings;
  });
  res.json(settings);
});

app.get('/api/users', authMiddleware, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json([]);
  const me = req.auth.sub;
  const users = readStore().users
    .filter(u => u.id !== me && u.settings?.discoverByUsername !== false)
    .filter(u => u.username.includes(q) || u.displayName.toLowerCase().includes(q))
    .slice(0, 20)
    .map(publicUser);
  res.json(users);
});

app.get('/api/chats', authMiddleware, (req, res) => {
  const data = readStore();
  const chats = data.chats
    .filter(chat => userCanAccessChat(req.auth.sub, chat))
    .map(chat => enrichChat(chat, req.auth.sub, data))
    .sort((a, b) => {
      const ap = a.pinnedBy?.includes(req.auth.sub) ? 1 : 0;
      const bp = b.pinnedBy?.includes(req.auth.sub) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const ad = a.lastMessage?.createdAt || a.createdAt;
      const bd = b.lastMessage?.createdAt || b.createdAt;
      return bd.localeCompare(ad);
    });
  res.json(chats);
});

app.post('/api/chats/direct', authMiddleware, (req, res) => {
  const otherUserId = String(req.body.userId || '');
  const data = readStore();
  const other = data.users.find(u => u.id === otherUserId);
  if (!other || other.id === req.auth.sub) return res.status(400).json({ error: 'Invalid user.' });

  let chat = data.chats.find(c => c.type === 'dm' && c.members.length === 2 && c.members.includes(req.auth.sub) && c.members.includes(otherUserId));
  if (!chat) {
    chat = {
      id: nanoid(),
      type: 'dm',
      title: '',
      members: [req.auth.sub, otherUserId],
      createdBy: req.auth.sub,
      createdAt: new Date().toISOString(),
      pinnedBy: [],
      mutedBy: []
    };
    updateStore(store => store.chats.push(chat));
  }
  const freshData = readStore();
  chat.members.forEach(id => {
    io.in(`user:${id}`).socketsJoin(`chat:${chat.id}`);
    io.to(`user:${id}`).emit('chat-created', enrichChat(chat, id, freshData));
  });
  res.json(enrichChat(chat, req.auth.sub, freshData));
});

app.post('/api/chats/group', authMiddleware, (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 60);
  const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds.map(String) : [];
  if (title.length < 2) return res.status(400).json({ error: 'Group name is too short.' });

  const data = readStore();
  const members = [...new Set([req.auth.sub, ...memberIds])].filter(id => data.users.some(u => u.id === id));
  if (members.length < 2) return res.status(400).json({ error: 'Add at least one other person.' });

  const chat = {
    id: nanoid(),
    type: 'group',
    title,
    members,
    admins: [req.auth.sub],
    createdBy: req.auth.sub,
    createdAt: new Date().toISOString(),
    pinnedBy: [],
    mutedBy: []
  };
  updateStore(store => store.chats.push(chat));
  const freshData = readStore();
  chat.members.forEach(id => {
    io.in(`user:${id}`).socketsJoin(`chat:${chat.id}`);
    io.to(`user:${id}`).emit('chat-created', enrichChat(chat, id, freshData));
  });
  res.status(201).json(enrichChat(chat, req.auth.sub, freshData));
});

app.put('/api/chats/:id/preferences', authMiddleware, (req, res) => {
  const result = updateStore(store => {
    const chat = store.chats.find(c => c.id === req.params.id);
    if (!userCanAccessChat(req.auth.sub, chat)) return null;
    if ('pinned' in req.body) {
      chat.pinnedBy ||= [];
      chat.pinnedBy = req.body.pinned
        ? [...new Set([...chat.pinnedBy, req.auth.sub])]
        : chat.pinnedBy.filter(id => id !== req.auth.sub);
    }
    if ('muted' in req.body) {
      chat.mutedBy ||= [];
      chat.mutedBy = req.body.muted
        ? [...new Set([...chat.mutedBy, req.auth.sub])]
        : chat.mutedBy.filter(id => id !== req.auth.sub);
    }
    return chat;
  });
  if (!result) return res.status(404).json({ error: 'Chat not found.' });
  res.json(result);
});

app.get('/api/chats/:id/messages', authMiddleware, (req, res) => {
  const data = readStore();
  const chat = data.chats.find(c => c.id === req.params.id);
  if (!userCanAccessChat(req.auth.sub, chat)) return res.status(404).json({ error: 'Chat not found.' });
  const messages = activeMessages(data.messages)
    .filter(m => m.chatId === chat.id && !m.hiddenFor?.includes(req.auth.sub))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-500);
  res.json(messages);
});

app.get('/api/search', authMiddleware, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json([]);
  const data = readStore();
  const accessible = new Set(data.chats.filter(c => c.members.includes(req.auth.sub)).map(c => c.id));
  const results = activeMessages(data.messages)
    .filter(m => accessible.has(m.chatId) && !m.encrypted && !m.deletedAt && String(m.content || '').toLowerCase().includes(q))
    .slice(-100)
    .reverse();
  res.json(results);
});

app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received.' });
  res.status(201).json({
    url: `/api/files/${req.file.filename}`,
    storedName: req.file.filename,
    size: req.file.size,
    mimetype: req.file.mimetype
  });
});

app.get('/api/files/:name', authMiddleware, (req, res) => {
  const safeName = path.basename(req.params.name);
  const data = readStore();
  const message = data.messages.find(m => m.attachment?.storedName === safeName);
  const chat = message ? data.chats.find(c => c.id === message.chatId) : null;
  if (!message || !userCanAccessChat(req.auth.sub, chat)) {
    return res.status(404).json({ error: 'File not found.' });
  }
  const filePath = path.join(UPLOAD_DIR, safeName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found.' });
  res.sendFile(filePath);
});

installAdvancedFeatures({ app, io, authMiddleware, readStore, updateStore, publicUser, userCanAccessChat, enrichChat });

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    socket.user = verifyToken(token);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', socket => {
  const userId = socket.user.sub;
  socket.join(`user:${userId}`);

  const data = readStore();
  data.chats.filter(c => c.members.includes(userId)).forEach(c => socket.join(`chat:${c.id}`));
  socket.broadcast.emit('presence', { userId, online: true });

  socket.on('join-chat', chatId => {
    const chat = readStore().chats.find(c => c.id === chatId);
    if (userCanAccessChat(userId, chat)) socket.join(`chat:${chatId}`);
  });

  socket.on('typing', payload => {
    const chat = readStore().chats.find(c => c.id === payload?.chatId);
    if (!userCanAccessChat(userId, chat)) return;
    socket.to(`chat:${chat.id}`).emit('typing', { chatId: chat.id, userId, typing: Boolean(payload.typing) });
  });

  socket.on('send-message', (payload, ack = () => {}) => {
    try {
      const data = readStore();
      const chat = data.chats.find(c => c.id === payload?.chatId);
      if (!userCanAccessChat(userId, chat)) return ack({ ok: false, error: 'Chat not found.' });
      if (!canPostToChat(chat, userId)) return ack({ ok: false, error: 'Only admins can post here.' });

      const kind = ['text','poll','location','contact','sticker','gif','system'].includes(payload.kind) ? payload.kind : 'text';
      const content = typeof payload.content === 'string' ? payload.content.slice(0, 20000) : '';
      const attachment = payload.attachment || null;
      const poll = kind === 'poll' && payload.poll ? {
        question: String(payload.poll.question || '').trim().slice(0, 300),
        quiz: Boolean(payload.poll.quiz), multiple: Boolean(payload.poll.multiple), closed: false,
        correctOptionId: payload.poll.quiz ? payload.poll.correctOptionId || null : null,
        options: (payload.poll.options || []).slice(0, 12).map((o, i) => ({ id: String(o.id || `o${i}`), text: String(o.text || '').slice(0, 120), voters: [] }))
      } : null;
      if (!content && !attachment && !poll && !payload.meta) return ack({ ok: false, error: 'Message is empty.' });
      if (attachment && chat.permissions?.allowMedia === false && !chat.admins?.includes(userId)) return ack({ ok: false, error: 'Media is disabled in this chat.' });
      if (poll && chat.permissions?.allowPolls === false && !chat.admins?.includes(userId)) return ack({ ok: false, error: 'Polls are disabled in this chat.' });

      const slow = Number(chat.permissions?.slowModeSeconds || 0);
      if (slow && !chat.admins?.includes(userId)) {
        const last = data.messages.filter(m => m.chatId === chat.id && m.senderId === userId && !m.scheduledFor).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (last && Date.now() - new Date(last.createdAt).getTime() < slow * 1000) return ack({ ok: false, error: `Slow mode: wait ${slow}s between messages.` });
      }

      const seconds = Math.max(0, Math.min(Number(payload.autoDeleteSeconds || 0), 30 * 24 * 3600));
      const now = new Date();
      const scheduledAt = payload.scheduledAt && new Date(payload.scheduledAt).getTime() > Date.now() + 1000 ? new Date(payload.scheduledAt).toISOString() : null;
      const message = {
        id: nanoid(), chatId: chat.id, senderId: userId, content,
        encrypted: Boolean(payload.encrypted), crypto: payload.encrypted ? payload.crypto || null : null,
        attachment, replyToId: payload.replyToId || null, forwardOfId: payload.forwardOfId || null,
        topicId: payload.topicId || null, kind, poll, meta: payload.meta || null, silent: Boolean(payload.silent),
        reactions: {}, createdAt: scheduledAt || now.toISOString(), queuedAt: scheduledAt ? now.toISOString() : null,
        scheduledFor: scheduledAt, deliveredAt: scheduledAt ? null : now.toISOString(), editedAt: null, deletedAt: null,
        expiresAt: seconds && !scheduledAt ? new Date(Date.now() + seconds * 1000).toISOString() : null,
        autoDeleteSeconds: seconds, hiddenFor: []
      };
      updateStore(store => store.messages.push(message));
      if (!scheduledAt) io.to(`chat:${chat.id}`).emit('message', message);
      else io.to(`user:${userId}`).emit('scheduled-message', message);
      ack({ ok: true, message });

      if (!scheduledAt && !message.encrypted && kind === 'text' && content.startsWith('/')) {
        const [command, ...args] = content.trim().split(/\s+/);
        const reply = builtinBotReply(command, args);
        if (reply) {
          const botMessage = {
            id: nanoid(), chatId: chat.id, senderId: 'bot:privora', content: reply, encrypted: false, crypto: null,
            attachment: null, replyToId: message.id, forwardOfId: null, topicId: payload.topicId || null,
            kind: 'text', poll: null, meta: { botName: 'Privora Bot' }, silent: false, reactions: {},
            createdAt: new Date().toISOString(), deliveredAt: new Date().toISOString(), editedAt: null, deletedAt: null,
            expiresAt: null, autoDeleteSeconds: 0, hiddenFor: []
          };
          updateStore(store => store.messages.push(botMessage));
          io.to(`chat:${chat.id}`).emit('message', botMessage);
        }
      }
    } catch (err) {
      console.error(err);
      ack({ ok: false, error: 'Could not send message.' });
    }
  });

  socket.on('edit-message', (payload, ack = () => {}) => {
    const updated = updateStore(store => {
      const message = store.messages.find(m => m.id === payload?.messageId);
      if (!message || message.senderId !== userId || message.deletedAt) return null;
      if (message.encrypted) {
        message.content = String(payload.content || '').slice(0, 20000);
        message.crypto = payload.crypto || null;
      } else {
        message.content = String(payload.content || '').slice(0, 20000);
      }
      message.editedAt = new Date().toISOString();
      return message;
    });
    if (!updated) return ack({ ok: false, error: 'Cannot edit that message.' });
    io.to(`chat:${updated.chatId}`).emit('message-updated', updated);
    ack({ ok: true });
  });

  socket.on('delete-message', (payload, ack = () => {}) => {
    const updated = updateStore(store => {
      const message = store.messages.find(m => m.id === payload?.messageId);
      if (!message || message.senderId !== userId) return null;
      message.content = '';
      message.attachment = null;
      message.deletedAt = new Date().toISOString();
      return message;
    });
    if (!updated) return ack({ ok: false, error: 'Cannot delete that message.' });
    io.to(`chat:${updated.chatId}`).emit('message-updated', updated);
    ack({ ok: true });
  });

  socket.on('react', payload => {
    const allowed = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
    if (!allowed.includes(payload?.emoji)) return;
    const updated = updateStore(store => {
      const message = store.messages.find(m => m.id === payload?.messageId);
      if (!message) return null;
      const chat = store.chats.find(c => c.id === message.chatId);
      if (!userCanAccessChat(userId, chat)) return null;
      message.reactions ||= {};
      const users = new Set(message.reactions[payload.emoji] || []);
      users.has(userId) ? users.delete(userId) : users.add(userId);
      message.reactions[payload.emoji] = [...users];
      return message;
    });
    if (updated) io.to(`chat:${updated.chatId}`).emit('message-updated', updated);
  });

  socket.on('read', payload => {
    const chat = readStore().chats.find(c => c.id === payload?.chatId);
    if (!userCanAccessChat(userId, chat)) return;
    const receipt = { chatId: chat.id, userId, messageId: payload.messageId, at: new Date().toISOString() };
    updateStore(store => {
      store.receipts = store.receipts.filter(r => !(r.chatId === chat.id && r.userId === userId));
      store.receipts.push(receipt);
    });
    socket.to(`chat:${chat.id}`).emit('read', receipt);
  });

  socket.on('disconnect', () => {
    socket.broadcast.emit('presence', { userId, online: false, lastSeenAt: new Date().toISOString() });
  });
});

setInterval(() => {
  const due = [];
  updateStore(store => {
    const now = Date.now();
    for (const message of store.messages) {
      if (message.scheduledFor && !message.deliveredAt && new Date(message.scheduledFor).getTime() <= now) {
        message.deliveredAt = new Date().toISOString();
        if (message.autoDeleteSeconds) message.expiresAt = new Date(now + message.autoDeleteSeconds * 1000).toISOString();
        due.push(structuredClone(message));
      }
    }
  });
  due.forEach(message => io.to(`chat:${message.chatId}`).emit('message', message));
}, 1000).unref();

setInterval(() => {
  updateStore(store => {
    const now = Date.now();
    store.messages = store.messages.filter(m => !m.expiresAt || new Date(m.expiresAt).getTime() > now);
  });
}, 60_000).unref();

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
    if (!String(req.headers.accept || '').includes('text/html')) return next();
    return res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

server.listen(PORT, HOST, () => {
  if (!process.env.JWT_SECRET) console.warn('[Privora] Using development JWT secret. Set JWT_SECRET before deploying publicly.');
  console.log(`[Privora] Web app + API + realtime server listening on ${HOST}:${PORT}`);
});
