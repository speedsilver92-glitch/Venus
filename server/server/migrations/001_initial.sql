-- Production migration target for replacing the JSON development store.
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, username text UNIQUE NOT NULL, display_name text NOT NULL,
  password_hash text NOT NULL, profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chats (
  id text PRIMARY KEY, type text NOT NULL, title text NOT NULL DEFAULT '',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb, created_by text REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chat_members (
  chat_id text REFERENCES chats(id) ON DELETE CASCADE, user_id text REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member', PRIMARY KEY(chat_id,user_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY, chat_id text REFERENCES chats(id) ON DELETE CASCADE, sender_id text,
  kind text NOT NULL DEFAULT 'text', payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL, delivered_at timestamptz, expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS messages_chat_created_idx ON messages(chat_id, created_at DESC);
