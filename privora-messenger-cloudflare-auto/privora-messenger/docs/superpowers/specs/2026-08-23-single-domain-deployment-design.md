# Privora Single-Domain Deployment Design

## Goal
Run Privora as one public web service where the React application, REST API, Socket.IO realtime transport, protected uploads, and WebRTC signaling all use the same HTTPS origin. Production must not require a localhost URL in client code.

## Architecture
The browser uses relative `/api/...` requests and Socket.IO's current-origin default. In development, Vite proxies `/api` and `/socket.io` to the Node server. In production, Express serves `client/dist` after API and Socket.IO setup and falls back to `index.html` for client-side routes.

A multi-stage Docker image builds the React client and starts only the Express/Socket.IO server. The server binds to `0.0.0.0` and uses the platform-provided `PORT`. Optional `CLIENT_ORIGIN` enables explicit cross-origin development/integration; when omitted, the app is same-origin and does not need permissive CORS.

## Security and deployment constraints
- Public deployments must use HTTPS at the reverse proxy/platform edge.
- `JWT_SECRET` must be set to a strong random value.
- WebSocket upgrade traffic for `/socket.io` must be forwarded by the host.
- Protected uploads remain behind authenticated API routes; no public upload directory is introduced.
- The JSON data store remains a prototype limitation and is not made production-safe by this deployment change.
- WebRTC across difficult NATs still requires TURN; single-origin hosting does not replace TURN.

## Developer experience
`npm run dev` keeps the two-process Vite + Node workflow, but the browser still uses same-origin relative URLs through Vite proxies. `npm run build` builds the client. `npm start` serves the built client and backend from one port.

## Verification
Tests cover origin-policy behavior. Build verification checks the React bundle. Static scans ensure client source contains no hard-coded `localhost`, `127.0.0.1`, port 5173, or port 3001 URL. Server syntax and existing platform tests must remain green.
