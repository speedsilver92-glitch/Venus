const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });

const now = () => new Date().toISOString();
const uid = (prefix = '') => prefix + crypto.randomUUID();
const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);

  return btoa(s)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  return b64url(
    await crypto.subtle.sign('HMAC', key, enc.encode(text))
  );
}

async function issueToken(secret, userId) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 30;
  const body = `${userId}.${exp}`;

  return `${body}.${await hmac(secret, body)}`;
}

async function verifyToken(secret, token) {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [userId, exp, sig] = parts;

  if (Number(exp) < Date.now()) return null;

  const expected = await hmac(
    secret,
    `${userId}.${exp}`
  );

  return expected === sig ? userId : null;
}

async function passwordHash(password, saltBytes) {
  const salt =
    saltBytes ||
    crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    key,
    256
  );

  return {
    salt: b64url(salt),
    hash: b64url(bits)
  };
}

function fromB64url(s) {
  s = s
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  while (s.length % 4) s += '=';

  const raw = atob(s);

  return Uint8Array.from(
    raw,
    c => c.charCodeAt(0)
  );
}

function publicUser(u) {
  if (!u) return null;

  const {
    passwordHash,
    passwordSalt,
    ...safe
  } = u;

  return safe;
}

function defaultSettings() {
  return {
    readReceipts: true,
    lastSeen: 'contacts',
    calls: 'everyone',
    groups: 'everyone'
  };
}

function canAccess(chat, userId) {
  return Boolean(
    chat?.memberIds?.includes(userId)
  );
}

export class PrivoraRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async state() {
    return (
      (await this.ctx.storage.get('app')) || {
        users: [],
        chats: [],
        messages: [],
        sessions: [],
        push: []
      }
    );
  }

  async save(state) {
    await this.ctx.storage.put('app', state);
  }

  async userId(request) {
    const header =
      request.headers.get('authorization') || '';

    const token = header.startsWith('Bearer ')
      ? header.slice(7)
      : new URL(request.url).searchParams.get('token');

    return verifyToken(
      this.env.JWT_SECRET,
      token
    );
  }

  send(ws, event, payload) {
    try {
      ws.send(
        JSON.stringify({
          event,
          payload
        })
      );
    } catch {}
  }

  ack(ws, id, payload) {
    if (id) {
      try {
        ws.send(
          JSON.stringify({
            ack: id,
            payload
          })
        );
      } catch {}
    }
  }

  socketsForUser(userId) {
    return this.ctx
      .getWebSockets()
      .filter(
        ws =>
          ws.deserializeAttachment?.()?.userId ===
          userId
      );
  }

  broadcastUser(userId, event, payload) {
    for (const ws of this.socketsForUser(userId)) {
      this.send(ws, event, payload);
    }
  }

  broadcastChat(
    state,
    chatId,
    event,
    payload,
    exceptUserId = null
  ) {
    const chat = state.chats.find(
      c => c.id === chatId
    );

    if (!chat) return;

    for (const userId of chat.memberIds) {
      if (userId !== exceptUserId) {
        this.broadcastUser(
          userId,
          event,
          payload
        );
      }
    }
  }

  enrichChat(state, chat, viewerId) {
    const members = chat.memberIds
      .map(id =>
        publicUser(
          state.users.find(
            u => u.id === id
          )
        )
      )
      .filter(Boolean);

    const lastMessage = [...state.messages]
      .reverse()
      .find(
        m =>
          m.chatId === chat.id &&
          (!m.scheduledAt ||
            new Date(m.scheduledAt) <=
              new Date())
      );

    return {
      ...chat,
      members,
      lastMessage,
      preferences:
        chat.preferences?.[viewerId] || {}
    };
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      return this.openSocket(request);
    }

    if (url.pathname.startsWith('/api/')) {
      return this.api(request, url);
    }

    return json(
      { error: 'Not found' },
      404
    );
  }

  async openSocket(request) {
    const userId =
      await this.userId(request);

    if (!userId) {
      return new Response(
        'Unauthorized',
        { status: 401 }
      );
    }

    const pair = new WebSocketPair();

    const client = pair[0];
    const server = pair[1];

    server.serializeAttachment({
      userId
    });

    this.ctx.acceptWebSocket(server);

    const state = await this.state();

    for (const u of state.users) {
      if (u.id !== userId) {
        this.broadcastUser(
          u.id,
          'presence',
          {
            userId,
            online: true
          }
        );
      }
    }

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async webSocketClose(ws) {
    const userId =
      ws.deserializeAttachment?.()?.userId;

    if (!userId) return;

    const state = await this.state();

    for (const u of state.users) {
      if (u.id !== userId) {
        this.broadcastUser(
          u.id,
          'presence',
          {
            userId,
            online: false
          }
        );
      }
    }
  }

  async webSocketMessage(ws, raw) {
    let frame;

    try {
      frame = JSON.parse(
        typeof raw === 'string'
          ? raw
          : new TextDecoder().decode(raw)
      );
    } catch {
      return;
    }

    const userId =
      ws.deserializeAttachment?.()?.userId;

    if (!userId) return;

    const state = await this.state();
    const p = frame.payload || {};

    const chat = state.chats.find(
      c => c.id === p.chatId
    );

    const finish = async (
      payload = { ok: true }
    ) => {
      await this.save(state);
      this.ack(
        ws,
        frame.id,
        payload
      );
    };

    if (frame.event === 'join-chat') {
      return this.ack(
        ws,
        frame.id,
        { ok: true }
      );
    }

    if (frame.event === 'typing') {
      if (canAccess(chat, userId)) {
        this.broadcastChat(
          state,
          chat.id,
          'typing',
          {
            chatId: chat.id,
            userId,
            typing: Boolean(p.typing)
          },
          userId
        );
      }

      return;
    }

    if (frame.event === 'send-message') {
      if (
        !chat ||
        !canAccess(chat, userId)
      ) {
        return this.ack(
          ws,
          frame.id,
          {
            ok: false,
            error: 'Chat not found'
          }
        );
      }

      if (
        chat.permissions
          ?.onlyAdminsCanPost &&
        !chat.admins?.includes(userId)
      ) {
        return this.ack(
          ws,
          frame.id,
          {
            ok: false,
            error:
              'Only admins can post'
          }
        );
      }

      const message = {
        id: uid('m_'),
        chatId: chat.id,
        senderId: userId,
        content: p.content || '',
        kind: p.kind || 'text',
        meta: p.meta || null,
        poll: p.poll || null,
        attachment:
          p.attachment || null,
        encrypted:
          Boolean(p.encrypted),
        crypto: p.crypto || null,
        forwardOfId:
          p.forwardOfId || null,
        replyToId:
          p.replyToId || null,
        silent: Boolean(p.silent),
        scheduledAt:
          p.scheduledAt || null,
        reactions: {},
        reads: [userId],
        createdAt: now(),
        editedAt: null,
        deletedAt: null
      };

      state.messages.push(message);

      if (
        message.scheduledAt &&
        new Date(message.scheduledAt) >
          new Date()
      ) {
        const alarms =
          state.messages
            .filter(
              m =>
                m.scheduledAt &&
                new Date(
                  m.scheduledAt
                ) > new Date()
            )
            .map(
              m =>
                +new Date(
                  m.scheduledAt
                )
            );

        if (alarms.length) {
          await this.ctx.storage.setAlarm(
            Math.min(...alarms)
          );
        }

        await finish({
          ok: true,
          message,
          scheduled: true
        });

        return;
      }

      this.broadcastChat(
        state,
        chat.id,
        'message',
        message
      );

      await finish({
        ok: true,
        message
      });

      return;
    }

    if (
      frame.event === 'edit-message' ||
      frame.event === 'delete-message' ||
      frame.event === 'react' ||
      frame.event === 'poll-vote'
    ) {
      const m =
        state.messages.find(
          x =>
            x.id === p.messageId
        );

      if (
        !m ||
        !canAccess(
          state.chats.find(
            c =>
              c.id === m.chatId
          ),
          userId
        )
      ) {
        return this.ack(
          ws,
          frame.id,
          {
            ok: false,
            error:
              'Message not found'
          }
        );
      }

      if (
        frame.event ===
        'edit-message'
      ) {
        if (
          m.senderId !== userId
        ) {
          return this.ack(
            ws,
            frame.id,
            {
              ok: false,
              error: 'Not allowed'
            }
          );
        }

        m.content =
          p.content ?? m.content;

        m.crypto =
          p.crypto ?? m.crypto;

        m.editedAt = now();
      }

      if (
        frame.event ===
        'delete-message'
      ) {
        if (
          m.senderId !== userId
        ) {
          return this.ack(
            ws,
            frame.id,
            {
              ok: false,
              error: 'Not allowed'
            }
          );
        }

        m.content = '';
        m.attachment = null;
        m.deletedAt = now();
      }

      if (
        frame.event === 'react'
      ) {
        m.reactions ||= {};

        const list = new Set(
          m.reactions[p.emoji] || []
        );

        list.has(userId)
          ? list.delete(userId)
          : list.add(userId);

        m.reactions[p.emoji] = [
          ...list
        ];
      }

      if (
        frame.event ===
          'poll-vote' &&
        m.poll
      ) {
        m.poll.votes ||= {};

        const voters = new Set(
          m.poll.votes[
            p.optionId
          ] || []
        );

        if (m.poll.multiple) {
          voters.has(userId)
            ? voters.delete(userId)
            : voters.add(userId);
        } else {
          for (
            const k of Object.keys(
              m.poll.votes
            )
          ) {
            m.poll.votes[k] = (
              m.poll.votes[k] || []
            ).filter(
              id =>
                id !== userId
            );
          }

          voters.add(userId);
        }

        m.poll.votes[
          p.optionId
        ] = [...voters];
      }

      this.broadcastChat(
        state,
        m.chatId,
        'message-updated',
        m
      );

      await finish({
        ok: true,
        message: m
      });

      return;
    }

    if (frame.event === 'read') {
      if (
        chat &&
        canAccess(chat, userId)
      ) {
        this.broadcastChat(
          state,
          chat.id,
          'read',
          {
            chatId: chat.id,
            userId,
            messageId:
              p.messageId,
            at: now()
          },
          userId
        );
      }

      return;
    }

    if (
      frame.event ===
      'webrtc-signal'
    ) {
      if (
        !chat ||
        !canAccess(chat, userId) ||
        !chat.memberIds.includes(
          p.targetUserId
        )
      ) {
        return;
      }

      this.broadcastUser(
        p.targetUserId,
        'webrtc-signal',
        {
          chatId: chat.id,
          fromUserId: userId,
          signal: p.signal,
          kind: p.kind
        }
      );

      return;
    }

    if (
      frame.event ===
      'call-state'
    ) {
      if (
        chat &&
        canAccess(chat, userId)
      ) {
        this.broadcastChat(
          state,
          chat.id,
          'call-state',
          {
            ...p,
            userId
          },
          userId
        );
      }

      return;
    }
  }

  async alarm() {
    const state =
      await this.state();

    const t = Date.now();

    let next = null;
    let changed = false;

    for (const m of state.messages) {
      if (m.scheduledAt) {
        const when =
          +new Date(m.scheduledAt);

        if (when <= t) {
          m.scheduledAt = null;

          this.broadcastChat(
            state,
            m.chatId,
            'message',
            m
          );

          changed = true;
        } else {
          next =
            next == null
              ? when
              : Math.min(
                  next,
                  when
                );
        }
      }
    }

    if (changed) {
      await this.save(state);
    }

    if (next) {
      await this.ctx.storage.setAlarm(
        next
      );
    }
  }

  async api(request, url) {
    const state =
      await this.state();

    const method = request.method;
    const path = url.pathname;

    const body = async () => {
      try {
        return await request.json();
      } catch {
        return {};
      }
    };

    if (
      path === '/api/health'
    ) {
      return json({
        ok: true,
        app: 'Privora',
        version: '0.5.0',
        platform:
          'Cloudflare Workers Free + Durable Objects'
      });
    }

    if (
      path ===
        '/api/auth/register' &&
      method === 'POST'
    ) {
      const b = await body();

      const username = String(
        b.username || ''
      )
        .trim()
        .toLowerCase();

      const displayName = String(
        b.displayName || ''
      ).trim();

      const password = String(
        b.password || ''
      );

      if (
        !/^[a-z0-9_]{3,24}$/.test(
          username
        )
      ) {
        return json(
          {
            error:
              'Username must be 3-24 letters, numbers or underscores.'
          },
          400
        );
      }

      if (
        password.length < 8
      ) {
        return json(
          {
            error:
              'Password must be at least 8 characters.'
          },
          400
        );
      }

      if (
        state.users.some(
          u =>
            u.username ===
            username
        )
      ) {
        return json(
          {
            error:
              'Username already exists.'
          },
          409
        );
      }

      const h =
        await passwordHash(
          password
        );

      const user = {
        id: uid('u_'),
        username,
        displayName:
          displayName ||
          username,
        bio: '',
        avatar: '',
        settings:
          defaultSettings(),
        passwordHash:
          h.hash,
        passwordSalt:
          h.salt,
        createdAt: now()
      };

      state.users.push(user);

      const saved = {
        id: uid('c_'),
        type: 'saved',
        title:
          'Saved Messages',
        memberIds: [user.id],
        admins: [user.id],
        permissions: {},
        preferences: {},
        topics: [],
        createdAt: now()
      };

      state.chats.push(saved);

      const token =
        await issueToken(
          this.env.JWT_SECRET,
          user.id
        );

      state.sessions.push({
        id: uid('s_'),
        userId: user.id,
        createdAt: now(),
        current: true
      });

      await this.save(state);

      return json(
        {
          token,
          user:
            publicUser(user)
        },
        201
      );
    }

    if (
      path ===
        '/api/auth/login' &&
      method === 'POST'
    ) {
      const b = await body();

      const user =
        state.users.find(
          u =>
            u.username ===
            String(
              b.username || ''
            )
              .trim()
              .toLowerCase()
        );

      if (!user) {
        return json(
          {
            error:
              'Invalid username or password.'
          },
          401
        );
      }

      const h =
        await passwordHash(
          String(
            b.password || ''
          ),
          fromB64url(
            user.passwordSalt
          )
        );

      if (
        h.hash !==
        user.passwordHash
      ) {
        return json(
          {
            error:
              'Invalid username or password.'
          },
          401
        );
      }

      const token =
        await issueToken(
          this.env.JWT_SECRET,
          user.id
        );

      state.sessions.push({
        id: uid('s_'),
        userId: user.id,
        createdAt: now(),
        current: true
      });

      await this.save(state);

      return json({
        token,
        user:
          publicUser(user)
      });
    }

    const userId =
      await this.userId(request);

    if (!userId) {
      return json(
        {
          error:
            'Unauthorized'
        },
        401
      );
    }

    const me =
      state.users.find(
        u => u.id === userId
      );

    if (!me) {
      return json(
        {
          error:
            'Unauthorized'
        },
        401
      );
    }

    if (
      path === '/api/me' &&
      method === 'GET'
    ) {
      return json(
        publicUser(me)
      );
    }

    if (
      path === '/api/me' &&
      method === 'PUT'
    ) {
      const b = await body();

      for (const k of [
        'displayName',
        'bio',
        'avatar'
      ]) {
        if (k in b) {
          me[k] = String(
            b[k] || ''
          ).slice(
            0,
            k === 'bio'
              ? 280
              : 500
          );
        }
      }

      await this.save(state);

      return json(
        publicUser(me)
      );
    }

    if (
      path ===
        '/api/me/settings' &&
      method === 'PUT'
    ) {
      me.settings = {
        ...(me.settings || {}),
        ...(await body())
      };

      await this.save(state);

      return json(
        me.settings
      );
    }

    if (
      path === '/api/users' &&
      method === 'GET'
    ) {
      const q = (
        url.searchParams.get(
          'q'
        ) || ''
      ).toLowerCase();

      return json(
        state.users
          .filter(
            u =>
              u.id !== userId &&
              (
                u.username.includes(
                  q
                ) ||
                u.displayName
                  .toLowerCase()
                  .includes(q)
              )
          )
          .slice(0, 20)
          .map(publicUser)
      );
    }

    if (
      path === '/api/chats' &&
      method === 'GET'
    ) {
      return json(
        state.chats
          .filter(c =>
            canAccess(
              c,
              userId
            )
          )
          .map(c =>
            this.enrichChat(
              state,
              c,
              userId
            )
          )
          .sort((a, b) =>
            String(
              b.lastMessage
                ?.createdAt ||
                b.createdAt
            ).localeCompare(
              String(
                a.lastMessage
                  ?.createdAt ||
                  a.createdAt
              )
            )
          )
      );
    }

    if (
      path ===
        '/api/chats/direct' &&
      method === 'POST'
    ) {
      const b = await body();

      const other =
        state.users.find(
          u =>
            u.id === b.userId
        );

      if (!other) {
        return json(
          {
            error:
              'User not found'
          },
          404
        );
      }

      let chat =
        state.chats.find(
          c =>
            c.type ===
              'direct' &&
            c.memberIds.length ===
              2 &&
            c.memberIds.includes(
              userId
            ) &&
            c.memberIds.includes(
              other.id
            )
        );

      if (!chat) {
        chat = {
          id: uid('c_'),
          type: 'direct',
          title: '',
          memberIds: [
            userId,
            other.id
          ],
          admins: [],
          permissions: {},
          preferences: {},
          topics: [],
          createdAt: now()
        };

        state.chats.push(
          chat
        );

        for (
          const id of
          chat.memberIds
        ) {
          this.broadcastUser(
            id,
            'chat-created',
            this.enrichChat(
              state,
              chat,
              id
            )
          );
        }

        await this.save(
          state
        );
      }

      return json(
        this.enrichChat(
          state,
          chat,
          userId
        )
      );
    }

    if (
      (
        path ===
          '/api/chats/group' ||
        path ===
          '/api/chats/community'
      ) &&
      method === 'POST'
    ) {
      const b = await body();

      const type =
        path.endsWith(
          'community'
        )
          ? b.type ===
            'channel'
            ? 'channel'
            : 'group'
          : 'group';

      const memberIds = [
        ...new Set([
          userId,
          ...(b.memberIds ||
            [])
        ])
      ].filter(id =>
        state.users.some(
          u => u.id === id
        )
      );

      const chat = {
        id: uid('c_'),
        type,
        title: String(
          b.title ||
            'New group'
        ).slice(0, 80),
        description: String(
          b.description || ''
        ).slice(0, 300),
        public: Boolean(
          b.public
        ),
        memberIds,
        admins: [userId],
        roles: {
          [userId]: 'admin'
        },
        permissions: {
          allowMedia: true,
          allowPolls: true,
          onlyAdminsCanPost:
            type === 'channel',
          slowModeSeconds: 0
        },
        preferences: {},
        topics: [],
        inviteCode: uid(
          ''
        ).slice(0, 8),
        joinRequests: [],
        createdAt: now()
      };

      state.chats.push(chat);

      for (
        const id of memberIds
      ) {
        this.broadcastUser(
          id,
          'chat-created',
          this.enrichChat(
            state,
            chat,
            id
          )
        );
      }

      await this.save(state);

      return json(
        this.enrichChat(
          state,
          chat,
          userId
        ),
        201
      );
    }

    const msgMatch =
      path.match(
        /^\/api\/chats\/([^/]+)\/messages$/
      );

    if (
      msgMatch &&
      method === 'GET'
    ) {
      const chat =
        state.chats.find(
          c =>
            c.id ===
            msgMatch[1]
        );

      if (
        !canAccess(
          chat,
          userId
        )
      ) {
        return json(
          {
            error:
              'Not found'
          },
          404
        );
      }

      return json(
        state.messages
          .filter(
            m =>
              m.chatId ===
                chat.id &&
              (
                !m.scheduledAt ||
                +new Date(
                  m.scheduledAt
                ) <= Date.now()
              )
          )
          .slice(-300)
      );
    }

    const pref =
      path.match(
        /^\/api\/chats\/([^/]+)\/preferences$/
      );

    if (
      pref &&
      method === 'PUT'
    ) {
      const chat =
        state.chats.find(
          c =>
            c.id === pref[1]
        );

      if (
        !canAccess(
          chat,
          userId
        )
      ) {
        return json(
          {
            error:
              'Not found'
          },
          404
        );
      }

      chat.preferences ||=
        {};

      chat.preferences[
        userId
      ] = {
        ...(chat.preferences[
          userId
        ] || {}),
        ...(await body())
      };

      await this.save(state);

      return json(
        chat.preferences[
          userId
        ]
      );
    }

    if (
      path === '/api/search' &&
      method === 'GET'
    ) {
      const q = (
        url.searchParams.get(
          'q'
        ) || ''
      ).toLowerCase();

      return json(
        state.messages
          .filter(
            m =>
              m.content
                ?.toLowerCase()
                .includes(q) &&
              canAccess(
                state.chats.find(
                  c =>
                    c.id ===
                    m.chatId
                ),
                userId
              )
          )
          .slice(-50)
      );
    }

    if (
      path ===
        '/api/mini-apps' &&
      method === 'GET'
    ) {
      return json([
        {
          id: 'notes',
          name:
            'Private Notes',
          icon: '📝',
          description:
            'Local encrypted-friendly notes.'
        },
        {
          id: 'tasks',
          name:
            'Task Board',
          icon: '✅',
          description:
            'Simple local tasks.'
        },
        {
          id: 'vault',
          name:
            'Vault Generator',
          icon: '🔐',
          description:
            'Generate random secrets locally.'
        }
      ]);
    }

    const media =
      path.match(
        /^\/api\/chats\/([^/]+)\/media$/
      );

    if (
      media &&
      method === 'GET'
    ) {
      const chat =
        state.chats.find(
          c =>
            c.id ===
            media[1]
        );

      if (
        !canAccess(
          chat,
          userId
        )
      ) {
        return json(
          {
            error:
              'Not found'
          },
          404
        );
      }

      return json(
        state.messages
          .filter(
            m =>
              m.chatId ===
                chat.id &&
              m.attachment
          )
          .map(m => ({
            messageId: m.id,
            attachment:
              m.attachment,
            createdAt:
              m.createdAt
          }))
      );
    }

    const members =
      path.match(
        /^\/api\/chats\/([^/]+)\/members$/
      );

    if (
      members &&
      method === 'GET'
    ) {
      const chat =
        state.chats.find(
          c =>
            c.id ===
            members[1]
        );

      if (
        !canAccess(
          chat,
          userId
        )
      ) {
        return json(
          {
            error:
              'Not found'
          },
          404
        );
      }

      return json(
        chat.memberIds.map(
          id => ({
            ...publicUser(
              state.users.find(
                u =>
                  u.id === id
              )
            ),
            role:
              chat.roles?.[
                id
              ] ||
              (
                chat.admins?.includes(
                  id
                )
                  ? 'admin'
                  : 'member'
              )
          })
        )
      );
    }

    const invite =
      path.match(
        /^\/api\/chats\/([^/]+)\/invite$/
      );

    if (
      invite &&
      method === 'POST'
    ) {
      const chat =
        state.chats.find(
          c =>
            c.id ===
            invite[1]
        );

      if (
        !canAccess(
          chat,
          userId
        )
      ) {
        return json(
          {
            error:
              'Not found'
          },
          404
        );
      }

      const b = await body();

      if (
        b.rotate &&
        chat.admins?.includes(
          userId
        )
      ) {
        chat.inviteCode =
          uid('').slice(0, 8);
      }

      await this.save(state);

      return json({
        code:
          chat.inviteCode
      });
    }

    const join =
      path.match(
        /^\/api\/invites\/([^/]+)\/join$/
      );

    if (
      join &&
      method === 'POST'
    ) {
      const chat =
        state.chats.find(
          c =>
            c.inviteCode ===
            join[1]
        );

      if (!chat) {
        return json(
          {
            error:
              'Invalid invite code'
          },
          404
        );
      }

      if (
        !chat.memberIds.includes(
          userId
        )
      ) {
        chat.memberIds.push(
          userId
        );

        chat.roles ||= {};

        chat.roles[userId] =
          'member';

        this.broadcastUser(
          userId,
          'chat-created',
          this.enrichChat(
            state,
            chat,
            userId
          )
        );

        await this.save(
          state
        );
      }

      return json({
        joined: true,
        chat:
          this.enrichChat(
            state,
            chat,
            userId
          )
      });
    }

    const topics =
      path.match(
        /^\/api\/chats\/([^/]+)\/topics$/
      );

    if (
      topics &&
      method === 'POST'
    ) {
      const chat =
        state.chats.find(
          c =>
            c.id ===
            topics[1]
        );

      if (
        !chat?.admins?.includes(
          userId
        )
      ) {
        return json(
          {
            error:
              'Admin required'
          },
          403
        );
      }

      const b = await body();

      const topic = {
        id: uid('t_'),
        title: String(
          b.title || 'Topic'
        ).slice(0, 60),
        icon:
          b.icon || '💬'
      };

      chat.topics ||= [];

      chat.topics.push(
        topic
      );

      this.broadcastChat(
        state,
        chat.id,
        'topic-created',
        topic
      );

      await this.save(state);

      return json(
        topic,
        201
      );
    }

    const manage =
      path.match(
        /^\/api\/chats\/([^/]+)\/manage$/
      );

    if (
      manage &&
      method === 'PUT'
    ) {
      const chat =
        state.chats.find(
          c =>
            c.id ===
            manage[1]
        );

      if (
        !chat?.admins?.includes(
          userId
        )
      ) {
        return json(
          {
            error:
              'Admin required'
          },
          403
        );
      }

      const b = await body();

      if (b.permissions) {
        chat.permissions = {
          ...(chat.permissions ||
            {}),
          ...b.permissions
        };
      }

      if (
        b.memberId &&
        chat.memberIds.includes(
          b.memberId
        )
      ) {
        chat.roles ||= {};

        chat.roles[
          b.memberId
        ] =
          b.role || 'member';

        chat.admins = (
          chat.admins || []
        ).filter(
          id =>
            id !== b.memberId
        );

        if (
          b.role === 'admin'
        ) {
          chat.admins.push(
            b.memberId
          );
        }
      }

      this.broadcastChat(
        state,
        chat.id,
        'chat-updated',
        this.enrichChat(
          state,
          chat,
          userId
        )
      );

      await this.save(state);

      return json(
        this.enrichChat(
          state,
          chat,
          userId
        )
      );
    }

    if (
      path ===
        '/api/sessions' &&
      method === 'GET'
    ) {
      return json(
        state.sessions.filter(
          s =>
            s.userId ===
            userId
        )
      );
    }

    if (
      path ===
        '/api/push-subscriptions' &&
      method === 'POST'
    ) {
      state.push.push({
        id: uid('p_'),
        userId,
        subscription:
          await body(),
        createdAt: now()
      });

      await this.save(state);

      return json({
        ok: true
      });
    }

    if (
      path === '/api/upload' &&
      method === 'POST'
    ) {
      return json(
        {
          error:
            'Free v0.5 keeps messaging free; attachment storage needs an R2 bucket. Text, polls, contacts, locations and calls work without it.'
        },
        501
      );
    }

    return json(
      {
        error: 'Not found'
      },
      404
    );
  }
}

export default {
  async fetch(request, env) {
    const url =
      new URL(request.url);

    if (
      url.pathname === '/ws' ||
      url.pathname.startsWith(
        '/api/'
      )
    ) {
      const id =
        env.PRIVORA_ROOM.idFromName(
          'privora-global'
        );

      return env.PRIVORA_ROOM
        .get(id)
        .fetch(request);
    }

    return env.ASSETS.fetch(
      request
    );
  }
};
