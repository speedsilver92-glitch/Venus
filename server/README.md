# Privora Messenger 0.3 — single-domain public deployment

Privora is a Telegram-inspired privacy messenger prototype. Version 0.3 keeps the Telegram+ feature set from 0.2 and removes the production dependency on separate localhost frontend/backend addresses.

## What changed in 0.3

- The browser uses relative `/api/...` requests by default.
- Socket.IO connects to the page's current origin automatically.
- Express serves the built React app, REST API, protected media and realtime transport from one public domain.
- Production same-origin mode does not enable CORS unless `CLIENT_ORIGIN` is explicitly set.
- The server binds to `0.0.0.0` and respects a host-provided `PORT`.
- A Dockerfile builds the React app and runs one production Node service.
- Vite proxies API and WebSocket traffic only during local development.

## Development in VS Code

```bash
npm install
npm run dev
```

Development still uses Vite plus the Node server internally, but the browser code itself talks to relative paths. You do not configure a localhost API URL.

## Production-style run on one port

```bash
npm install
npm run build
```

Set a strong JWT secret, then start the app:

Windows PowerShell:

```powershell
$env:JWT_SECRET="replace-this-with-a-long-random-secret"
npm start
```

Linux/macOS:

```bash
JWT_SECRET='replace-this-with-a-long-random-secret' npm start
```

The single Node process serves both the website and backend. On a real host, its HTTPS domain becomes the URL users visit; there is no separate frontend API hostname to configure.

## Docker deployment

Build:

```bash
docker build -t privora .
```

Run behind an HTTPS-capable platform/reverse proxy:

```bash
docker run --rm -p 3001:3001 \
  -e JWT_SECRET='replace-this-with-a-long-random-secret' \
  privora
```

For a real public deployment, point your platform/domain at this one container/service. The host must support WebSocket upgrades for Socket.IO. Use HTTPS in public deployments.

## Environment variables

- `PORT`: listening port; hosting platforms commonly inject this.
- `HOST`: defaults to `0.0.0.0`.
- `JWT_SECRET`: required for any public deployment.
- `CLIENT_ORIGIN`: optional. Leave blank for same-origin hosting. Set it only if you intentionally separate the frontend origin.

## Telegram+ features included

Accounts, DMs, groups, Saved Messages, channels, realtime messaging, presence, typing/read receipts, Secure Room AES-GCM demo, files/images/voice notes, reactions, edit/delete/replies, auto-delete, polls/quizzes, scheduled and silent messages, forwarding, contacts, location sharing, stickers, public/private communities, invite codes, join requests, roles/permissions, slow mode, topics, built-in bot commands, mini-app demos, media browser, WebRTC voice/video calls, group mesh calls, screen sharing, browser notifications, offline queue, device/session records, push-subscription storage hooks, themes, accent controls, density/fonts/bubbles/wallpapers and local PIN lock.

## Important production limitations

Single-domain deployment makes Privora publishable, but it does **not** magically make the prototype production-secure or Telegram-scale. Before treating it as a real private messenger, replace the JSON store with PostgreSQL, use Redis for horizontal realtime scale, move media to private object storage, add backups/monitoring/abuse controls, configure TURN/SFU infrastructure for reliable calls, implement real WebAuthn/TOTP and push delivery, and use an audited Signal/MLS-class E2EE implementation rather than the Secure Room demo.

The server also needs persistent storage if you keep the current JSON database or local uploads. Ephemeral hosts can erase those files on restart/redeploy.

## Public deployment checklist

- Use HTTPS.
- Set a strong random `JWT_SECRET`.
- Keep `CLIENT_ORIGIN` blank for the recommended one-domain setup.
- Enable WebSocket forwarding.
- Attach persistent storage or migrate data/media to managed services.
- Configure TURN before expecting calls to work reliably across arbitrary networks.
- Do not market the Secure Room demo as audited production E2EE.

## Automatic Cloudflare deployment (v0.4)

Privora now includes a Cloudflare Containers deployment and GitHub Actions CD pipeline. Every push to the `main` branch runs the test suite, builds the React client, builds the Docker image through Wrangler, uploads it to Cloudflare, and rolls out the new Privora container automatically.

Cloudflare Containers currently requires a Workers Paid plan. The deployment uses one named container instance because this starter still stores its prototype JSON database and uploads on the container filesystem. Before using Privora for real users, move persistent data to PostgreSQL/D1 and object uploads to R2 (or another durable store), because application container files should not be treated as the durable source of truth across deployments.

### One-time GitHub setup

In your GitHub repository, open **Settings → Secrets and variables → Actions** and create these repository secrets:

- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN` — a scoped Cloudflare API token with permission to deploy Workers/Containers.
- `PRIVORA_JWT_SECRET` — a long random value used to sign Privora login tokens. Generate one with `openssl rand -hex 32` or another cryptographically secure password generator.

Do not commit any of those values to Git. The workflow creates a temporary secrets file only inside the GitHub runner, passes it to Wrangler, and removes it afterward.

Then push the project to the `main` branch. `.github/workflows/cloudflare-deploy.yml` handles all later deployments automatically:

```bash
git add .
git commit -m "update Privora"
git push origin main
```

You can also trigger a deployment manually from **GitHub → Actions → Deploy Privora to Cloudflare → Run workflow**.

### Cloudflare files

- `wrangler.jsonc` — Cloudflare Worker, Durable Object and Container configuration.
- `worker/index.js` — forwards HTTP, Socket.IO WebSockets, and signaling traffic to the Privora Node container.
- `Dockerfile` — builds the React client and runs the Node/Express backend.
- `.github/workflows/cloudflare-deploy.yml` — tests, builds and deploys on every push to `main`.

The first successful deploy gives you a Cloudflare Worker URL. A custom domain can then be attached in Cloudflare Workers & Pages settings without changing the Privora frontend API URLs because the app uses same-origin requests.

## v0.5 Free Cloudflare deployment

Privora can now deploy without Cloudflare Containers. Production uses Cloudflare Workers Static Assets for the React build and a SQLite-backed Durable Object for API state and native WebSocket realtime messaging/call signaling. This architecture is compatible with the Workers Free plan within Cloudflare's free-tier limits.

The production deployment no longer uses `Dockerfile` or `@cloudflare/containers`. Those older prototype files may remain in the repository for reference, but `wrangler.jsonc` does not load them.

Required GitHub Actions secrets remain:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `PRIVORA_JWT_SECRET`

Attachments are the one intentionally limited feature in the free migration: `/api/upload` returns a clear message until an R2 bucket is connected. Text chat, DMs, groups/channels, polls, contacts, location messages, invites, topics, roles, reactions, scheduled messages, native realtime WebSockets, and WebRTC signaling are handled by the Worker/Durable Object backend.
