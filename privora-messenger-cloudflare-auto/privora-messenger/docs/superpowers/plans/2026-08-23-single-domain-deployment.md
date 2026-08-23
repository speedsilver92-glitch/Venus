# Privora Single-Domain Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Privora deploy as one public HTTPS-origin web service with no production localhost dependency.

**Architecture:** Client API calls become relative and Socket.IO connects to the current origin. Vite proxies those paths during development; Express serves the built React bundle in production. A multi-stage Docker image produces a portable deployment artifact.

**Tech Stack:** React 19, Vite 6, Express 5, Socket.IO 4, Node.js 20+, Docker

**Spec:** `docs/superpowers/specs/2026-08-23-single-domain-deployment-design.md`

## Global Constraints
- Production client code must not require hard-coded localhost URLs.
- One public origin serves frontend, REST API, Socket.IO, protected media, and signaling.
- Public deployment requires HTTPS, a strong `JWT_SECRET`, and WebSocket forwarding.
- Existing local JSON store and STUN-only WebRTC limitations remain explicitly documented.

---

### Task 1: Same-origin runtime policy

**Files:**
- Create: `server/src/runtime.js`
- Create: `server/src/runtime.test.js`
- Modify: `server/src/index.js`

**Interfaces:**
- Produces: `corsOptionsFromOrigin(origin)` returning either `null` for same-origin mode or an Express/Socket.IO-compatible CORS options object.

- [ ] **Step 1: Write failing tests** for omitted origin and explicit origin behavior.
- [ ] **Step 2: Run `node --test server/src/runtime.test.js`** and verify failure because `runtime.js` is missing.
- [ ] **Step 3: Implement `corsOptionsFromOrigin`** and use it in Express and Socket.IO.
- [ ] **Step 4: Run the test** and verify PASS.

### Task 2: Relative client transport

**Files:**
- Modify: `client/src/lib/api.js`
- Modify: `client/src/App.jsx`
- Modify: `client/vite.config.js`

**Interfaces:**
- REST requests use relative `/api/...` by default.
- Socket.IO uses browser current origin by default.
- Vite proxies `/api` and `/socket.io` to the development backend.

- [ ] **Step 1: Add a source scan assertion** that fails while client source contains hard-coded localhost.
- [ ] **Step 2: Replace the API base with an optional `VITE_API_URL` override defaulting to an empty string.**
- [ ] **Step 3: Make Socket.IO use `API_URL || undefined`.**
- [ ] **Step 4: Add Vite proxy configuration for REST and WebSocket traffic.**
- [ ] **Step 5: Re-run the source scan** and verify PASS.

### Task 3: Production static serving

**Files:**
- Modify: `server/src/index.js`
- Modify: `package.json`

**Interfaces:**
- `npm run build` creates `client/dist`.
- `npm start` serves `client/dist` and all backend routes on one port.

- [ ] **Step 1: Resolve `client/dist` from the server module path.**
- [ ] **Step 2: Serve static assets only when the build exists.**
- [ ] **Step 3: Add HTML fallback for non-API GET requests.**
- [ ] **Step 4: Bind the HTTP server to `HOST` defaulting to `0.0.0.0`.**
- [ ] **Step 5: Update startup logging to avoid claiming a localhost production URL.**

### Task 4: Portable Docker deployment

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Modify: `server/.env.example`
- Modify: `README.md`

**Interfaces:**
- Docker build compiles the client, then starts the Node server with one exposed port.

- [ ] **Step 1: Add a multi-stage Node 20 Dockerfile.**
- [ ] **Step 2: Add `.dockerignore` excluding dependencies, runtime data, and secrets.**
- [ ] **Step 3: Update environment examples for `PORT`, `HOST`, `JWT_SECRET`, and optional `CLIENT_ORIGIN`.**
- [ ] **Step 4: Rewrite run/deploy docs for public single-domain hosting.**

### Task 5: Verification and package

**Files:**
- Verify all changed files
- Create: `privora-messenger-public.zip`

**Interfaces:**
- Deliverable is a self-contained VS Code project ZIP.

- [ ] **Step 1: Run all Node tests.**
- [ ] **Step 2: Run server syntax checks.**
- [ ] **Step 3: Install dependencies and run the client build if the environment permits.**
- [ ] **Step 4: Scan production client source for forbidden localhost URL references.**
- [ ] **Step 5: Package the verified project into the public deployment ZIP.**
