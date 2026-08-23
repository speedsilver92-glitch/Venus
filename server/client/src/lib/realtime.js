function wsBase() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL.replace(/\/$/, '');
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}`;
}

export function io() {
  const handlers = new Map();
  const pending = new Map();
  let seq = 0;
  let closedByUser = false;
  let socket;

  const api = {
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
      return api;
    },
    off(event, fn) {
      handlers.get(event)?.delete(fn);
      return api;
    },
    emit(event, payload, ack) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        if (ack) ack({ ok: false, error: 'offline' });
        return api;
      }
      const id = ack ? `a${Date.now()}_${++seq}` : undefined;
      if (ack) pending.set(id, ack);
      socket.send(JSON.stringify({ event, payload, id }));
      return api;
    },
    disconnect() {
      closedByUser = true;
      socket?.close(1000, 'client disconnect');
    }
  };

  function dispatch(event, payload) {
    handlers.get(event)?.forEach(fn => {
      try { fn(payload); } catch (err) { console.error('Privora realtime handler failed', err); }
    });
  }

  function connect() {
    const token = localStorage.getItem('privora_token') || '';
    const url = `${wsBase()}/ws?token=${encodeURIComponent(token)}`;
    socket = new WebSocket(url);
    socket.addEventListener('open', () => dispatch('connect'));
    socket.addEventListener('message', event => {
      try {
        const data = JSON.parse(event.data);
        if (data.ack && pending.has(data.ack)) {
          const fn = pending.get(data.ack); pending.delete(data.ack); fn(data.payload); return;
        }
        if (data.event) dispatch(data.event, data.payload);
      } catch (err) { console.warn('Invalid Privora realtime frame', err); }
    });
    socket.addEventListener('close', event => {
      if (event.code === 4401) dispatch('connect_error', new Error('unauthorized'));
      if (!closedByUser) setTimeout(connect, 1500);
    });
    socket.addEventListener('error', () => dispatch('connect_error', new Error('connection failed')));
  }

  connect();
  return api;
}
